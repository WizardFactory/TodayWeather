#!/usr/bin/env python3
"""Local AWS CLI stand-in for the offline shadow finish replay."""

import argparse
import json
import os
import re
import stat
import sys
import tempfile
import time
from pathlib import Path


INPUT = 'SHADOW_FINISH_AWS_FIXTURE'


class ReplyError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def require(condition, message):
    if not condition:
        raise ValueError(message)


def private_file(path):
    info = path.lstat()
    return stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and info.st_mode & 0o077 == 0


def arguments(argv):
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--no-cli-pager', action='store_true')
    parser.add_argument('--no-paginate', action='store_true')
    parser.add_argument('--output', choices=['json'], required=True)
    parser.add_argument('--region', required=True)
    parser.add_argument('--cli-connect-timeout')
    parser.add_argument('--cli-read-timeout')
    parser.add_argument('--profile')
    options, remaining = parser.parse_known_args(argv)
    require(options.no_cli_pager and options.no_paginate, 'expected explicit CLI bounds')
    _, command, *items = remaining
    if command == 'get-object':
        transfer = argparse.ArgumentParser(add_help=False)
        for flag in ('bucket', 'key', 'version-id', 'range'):
            transfer.add_argument('--' + flag, required=True)
        transfer.add_argument('destination', type=Path)
        got = transfer.parse_args(items)
        return options.region, command, dict(Bucket=got.bucket, Key=got.key,
               VersionId=got.version_id, Range=got.range), got.destination
    require(len(items) == 2 and items[0] == '--cli-input-json' and items[1].startswith('file://'),
            'expected JSON request file')
    source = Path(items[1].removeprefix('file://'))
    require(source.is_absolute() and source.name.startswith('.aws-input-') and private_file(source),
            'invalid request file')
    payload = json.loads(source.read_bytes())
    require(type(payload) is dict, 'expected JSON object')
    return options.region, command, payload, None


def save(path, value):
    fd, name = tempfile.mkstemp(prefix='.fake-aws-', dir=path.parent)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream)
    Path(name).replace(path)


def pause_get(root):
    ordinal = os.environ.get('SHADOW_FINISH_AWS_PAUSE_GET')
    if ordinal is None:
        return False
    require(ordinal.isdecimal() and int(ordinal) > 0, 'invalid GET fault ordinal')
    with (root / 'aws-calls.jsonl').open() as calls:
        count = sum(json.loads(line)['command'] == 'get-object' for line in calls)
    return count == int(ordinal)


def s3_reply(command, parameters, destination, fixture, root):
    bucket = parameters['Bucket']
    if bucket not in fixture['buckets']:
        raise ReplyError('NoSuchBucket')
    versions = [row for row in fixture['versions'] if row['bucket'] == bucket]
    if command == 'get-bucket-versioning':
        return {'Status': 'Enabled'}
    if command == 'get-bucket-tagging':
        return {'TagSet': [{'Key': 'ShadowRunId', 'Value': fixture['resources']['run_id']}]}
    if command == 'list-object-versions':
        prefix = parameters.get('Prefix', '')
        cursor = parameters.get('KeyMarker'), parameters.get('VersionIdMarker')
        identity = lambda row: (row['key'], row['version'])
        rows = sorted((row for row in versions if row['key'].startswith(prefix)), key=identity)
        if cursor != (None, None):
            rows = [row for row in rows if identity(row) > cursor]
        limit = parameters['MaxKeys']
        require(type(limit) is int and 1 <= limit <= 1000, 'invalid version page limit')
        truncated = len(rows) > limit
        result = {'IsTruncated': truncated, 'Versions': [], 'DeleteMarkers': []}
        page = rows[:limit]
        for row in page:
            listed = {'Key': row['key'], 'VersionId': row['version']}
            if row['kind'] == 'delete_marker':
                result['DeleteMarkers'].append(listed)
            else:
                result['Versions'].append(dict(listed, Size=row['size']))
        if truncated:
            result['NextKeyMarker'], result['NextVersionIdMarker'] = identity(page[-1])
        return result
    if command == 'delete-objects':
        requested = parameters['Delete']['Objects']
        exact = {(row['Key'], row['VersionId']) for row in requested}
        observed = {(row['key'], row['version']) for row in versions}
        require(fixture['instance_state'] == 'terminated' and exact <= observed, 'invalid exact delete')
        fixture['versions'] = [row for row in fixture['versions']
                               if row['bucket'] != bucket or (row['key'], row['version']) not in exact]
        return {'Deleted': requested}
    if command == 'delete-bucket':
        if versions:
            raise ReplyError('BucketNotEmpty')
        require(fixture['instance_state'] == 'terminated', 'instance is still writing')
        fixture['buckets'].remove(bucket)
        return None
    require(command in ('get-object', 'head-object'), 'unsupported S3 fixture command')
    matches = [row for row in versions if row['key'] == parameters['Key']
               and row['version'] == parameters['VersionId'] and row['kind'] == 'object']
    if len(matches) != 1:
        raise ReplyError('NoSuchVersion')
    row = matches[0]
    result = dict(VersionId=row['version'], ContentLength=row['size'],
                  Metadata=row.get('metadata', {}), LastModified='2026-11-15T01:00:50Z')
    if command == 'head-object':
        return result
    span = re.fullmatch(r'bytes=(\d+)-(\d+)', parameters['Range'])
    require(span is not None, 'invalid explicit byte range')
    first, last = map(int, span.groups())
    require(0 <= first <= last < row['size'], 'byte range outside original')
    original = (root / row['path']).resolve(strict=True)
    require(original.is_relative_to(root) and original.is_file(), 'fixture object escaped its root')
    require(destination.is_absolute() and private_file(destination), 'unsafe requested output')
    length = last - first + 1
    with original.open('rb') as source, destination.open('wb') as output:
        source.seek(first)
        remaining = length
        if pause_get(root):
            require(length > 1, 'cannot interrupt a one-byte GET after a partial write')
            partial = source.read(min(1024, length - 1))
            require(partial, 'fixture GET could not write a prefix')
            output.write(partial)
            output.flush()
            os.fsync(output.fileno())
            remaining -= len(partial)
            save(root / 'paused-get.json', dict(bucket=bucket, key=row['key'], version=row['version'],
                                               requested=length, written=len(partial),
                                               destination=str(destination)))
            time.sleep(20)
        while remaining:
            data = source.read(min(1024 * 1024, remaining))
            require(data, 'fixture original shorter than declared')
            output.write(data)
            remaining -= len(data)
    return dict(result, ContentLength=length, ContentRange=f"bytes {first}-{last}/{row['size']}")


def resource_reply(command, parameters, fixture):
    resources = fixture['resources']
    if command == 'get-caller-identity':
        return {'Account': resources['account']}
    if command in ('describe-instances', 'terminate-instances'):
        require(parameters['InstanceIds'] == [resources['instance']], 'unexpected instance')
        if command == 'terminate-instances':
            fixture['instance_state'] = 'terminated'
            return {'TerminatingInstances': [{'InstanceId': resources['instance']}]}
        name = fixture['instance_state']
        code = {'running': 16, 'terminated': 48}[name]
        return {'Reservations': [{'Instances': [
            {'InstanceId': resources['instance'], 'State': {'Code': code, 'Name': name}}
        ]}]}
    if command == 'list-buckets':
        return {'Buckets': [{'Name': bucket} for bucket in fixture['buckets']]}
    remaining = fixture.setdefault('remaining', {'role': True, 'profile': True, 'group': True, 'volume': True})
    if command in ('get-role', 'get-instance-profile'):
        field, key, kind = (('Role', 'role', 'role') if command == 'get-role'
                            else ('InstanceProfile', 'profile', 'instance-profile'))
        require(parameters[field + 'Name'] == resources[key], 'unexpected IAM resource')
        if not remaining[key]:
            raise ReplyError('NoSuchEntity')
        name = resources[key]
        return {field: {'Arn': f"arn:aws:iam::{resources['account']}:{kind}/{name}",
                        'Tags': [{'Key': 'ShadowRunId', 'Value': resources['run_id']}]}}
    if command == 'describe-security-groups':
        require(parameters['Filters'] == [{'Name': 'group-id', 'Values': [resources['security_group']]}],
                'unexpected group selector')
        return {'SecurityGroups': [{'GroupId': resources['security_group']}] if remaining['group'] else []}
    if command == 'describe-volumes':
        require(parameters['Filters'] == [{'Name': 'volume-id', 'Values': resources['volumes']}],
                'unexpected volume selector')
        volume = dict(VolumeId=resources['volumes'][0], State='available', Attachments=[])
        return {'Volumes': [volume] if remaining['volume'] else []}
    require(fixture['instance_state'] == 'terminated', 'instance is still writing')
    effects = {
        'remove-role-from-instance-profile': ('', {'InstanceProfileName': resources['profile'],
                                                   'RoleName': resources['role']}),
        'delete-role-policy': ('', {'RoleName': resources['role'], 'PolicyName': resources['policy']}),
        'delete-role': ('role', {'RoleName': resources['role']}),
        'delete-instance-profile': ('profile', {'InstanceProfileName': resources['profile']}),
        'delete-security-group': ('group', {'GroupId': resources['security_group']}),
        'delete-volume': ('volume', {'VolumeId': resources['volumes'][0]}),
    }
    require(command in effects, 'unsupported resource fixture command')
    key, exact = effects[command]
    require(parameters == exact, 'unexpected cleanup resource')
    if key:
        remaining[key] = False
    return None


def main():
    try:
        path = Path(os.environ[INPUT])
        require(path.is_absolute() and private_file(path), 'fixture manifest must be private')
        root = path.parent.resolve(strict=True)
        require(stat.S_IMODE(root.stat().st_mode) == 0o700, 'fixture directory must be private')
        region, command, parameters, destination = arguments(sys.argv[1:])
        fixture = json.loads(path.read_bytes())
        require(fixture['resources']['region'] == region, 'unexpected fixture region')
        with (root / 'aws-calls.jsonl').open('a') as calls:
            calls.write(json.dumps(dict(command=command, parameters=parameters)) + '\n')
        if 'Bucket' in parameters:
            result = s3_reply(command, parameters, destination, fixture, root)
        else:
            result = resource_reply(command, parameters, fixture)
        if command.startswith(('delete-', 'terminate-')):
            save(path, fixture)
        if result is not None:
            print(json.dumps(result))
        return 0
    except ReplyError as error:
        operation = ''.join(part.title() for part in command.split('-'))
        print(f'An error occurred ({error.code}) when calling the {operation} operation: synthetic',
              file=sys.stderr)
        return 1
    except (KeyError, OSError, TypeError, ValueError):
        print('invalid offline AWS fixture or request', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
