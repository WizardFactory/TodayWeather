#!/usr/bin/env python3
"""Rehearse the real shadow finish CLI with an interrupted local AWS CLI stand-in."""

import argparse
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

from shadow_finish_fixture import FULL_ATTEMPTS, FULL_BODY_BYTES, build_fixture
from test_shadow_supervisor import J, operator, owned_resources, provision, provisioning_plan, state


INTERRUPTED_GET = 2


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def charged(journal_path):
    with J(journal_path) as journal:
        reads, writes, body_bytes = journal.db.execute(
            'SELECT reads,writes,export_bytes FROM control WHERE id=1'
        ).fetchone()
        work, cleanup = journal.db.execute('SELECT work,cleanup FROM transfer WHERE id=1').fetchone()
    return dict(reads=reads, writes=writes, body_bytes=body_bytes,
                work_envelope_bytes=work, cleanup_envelope_bytes=cleanup)


def cli(command, env, output, phase, timeout, *, pause=None):
    """Record each invocation, killing only the rehearsal's separate process group."""
    stdout = output / f'{phase}.stdout'
    stderr = output / f'{phase}.stderr'
    with stdout.open('w') as out, stderr.open('w') as err:
        process = subprocess.Popen(command, env=env, stdout=out, stderr=err, start_new_session=True)
        try:
            if pause is not None:
                deadline = time.monotonic() + min(timeout, 25)
                while not pause.exists() and process.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.02)
                require(pause.exists() and process.poll() is None,
                        f'{phase} did not reach an in-flight GET, inspect {stdout.name} and {stderr.name}')
                event = json.loads(pause.read_bytes())
                partial = Path(event['destination'])
                receipts = list(partial.parent.parent.glob('*/receipt.json'))
                require(len(receipts) == INTERRUPTED_GET - 1,
                        'interruption requires the earlier GET to have a durable receipt')
                require(0 < event['written'] == partial.stat().st_size < event['requested'],
                        'interruption requires a short write in the pending GET')
                receipt = json.loads(receipts[0].read_bytes())['object']
                event['verified_before_interruption'] = identity(receipt)
                os.killpg(process.pid, signal.SIGKILL)
                require(process.wait(timeout=10) == -signal.SIGKILL, 'finish did not stop at the barrier')
                write_json(output / f'{phase}.json', dict(returncode=process.returncode, in_flight=event))
                return event
            process.wait(timeout=timeout)
            write_json(output / f'{phase}.json', dict(returncode=process.returncode))
            require(process.returncode == 0, f'{phase} failed, inspect {stdout.name} and {stderr.name}')
            return json.loads(stdout.read_text())
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=10)


def identity(row):
    return row['bucket'], row['key'], row['version']


def get_counts(log):
    calls = [json.loads(line) for line in log.read_text().splitlines()]
    counts = Counter()
    for call in calls:
        if call['command'] == 'get-object':
            request = call['parameters']
            counts[request['Bucket'], request['Key'], request['VersionId']] += 1
    return calls, counts


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify_output(finish, report, fixture):
    require(report['host_evidence']['complete'] and report['cleanup']['complete'], 'finish incomplete')
    files = finish / report['host_evidence']['directory'] / 'files'
    pairs = {p.name: dict(sha256=digest(p), size=p.stat().st_size) for p in files.iterdir()}
    require(pairs == fixture['expected_pairs'], 'paired file inventory or bytes differ')
    originals = finish / 'sources'
    exported = json.loads((originals / 'manifest.json').read_bytes())
    require(exported['inventory_complete'] and exported['complete'], 'source inventory incomplete')
    versions = {identity(row): row for row in fixture['versions']}
    require(len(exported['objects']) == len(versions), 'source version count differs')
    require({identity(row) for row in exported['objects']} == versions.keys(), 'source version IDs differ')
    for row in exported['objects']:
        wanted = versions[identity(row)]
        if wanted['kind'] == 'delete_marker':
            require(row['status'] == 'delete_marker', 'delete marker missing')
        else:
            path = originals / row['file']
            actual_sha = digest(path)
            require(row['status'] == 'exported' and path.stat().st_size == wanted['size']
                    and actual_sha == row['sha256'] == wanted['sha256'], 'original object bytes differ')
    return dict(paired_files=len(pairs), source_versions=len(versions),
                inventory_sha256=exported['inventory_sha256'])


def rehearse(output, attempts, body_bytes, timeout):
    # Use only the synthetic run and a literal local AWS executable.
    cloud = output / 'cloud'
    finish = output / 'finish'
    journal_path = output / 'journal'
    epoch = int(time.time()) - 168 * 3600 - 10
    fixture = build_fixture(cloud, attempts=attempts, body_bytes=body_bytes, epoch=epoch)
    resources = owned_resources()
    require(resources['run_id'] == fixture['run_id'], 'fixture run mismatch')
    manifest = cloud / 'fixture.json'
    write_json(manifest, dict(resources=resources, versions=fixture['versions'],
                             instance_state='running', buckets=resources['buckets']))
    with J(journal_path, create=True, run_id=resources['run_id'], manifest_sha='a' * 64, epoch=epoch) as j:
        provision.freeze_plan(j, provisioning_plan(), epoch + 1)
        j.prepare_request('host-install', 'HostInstall', {'launch_sha256': fixture['launch_sha256']},
                          'fixture', now=epoch + 2)
        j.record_receipt('host-install', state.CloudResult('empty_success', 'HostInstall'))
        j.record_cleanup_ownership(operator.resource_digest(resources), resources['instance'], resources=resources)

    aws_cli = Path(__file__).with_name('shadow_finish_fake_aws.py').resolve(strict=True)
    command = [sys.executable, '-B', '-E', '-s', str(Path(provision.__file__).resolve()),
               'finish', '--execute', '--state', str(journal_path), '--output', str(finish),
               '--aws-executable', str(aws_cli)]
    env = {k: v for k, v in os.environ.items() if not k.startswith(('AWS_', 'SHADOW_FINISH_AWS_'))}
    env['SHADOW_FINISH_AWS_FIXTURE'] = str(manifest)
    env['PYTHONDONTWRITEBYTECODE'] = '1'
    env['PATH'] = str(Path(sys.executable).parent) + os.pathsep + os.defpath
    paused = cli(command, dict(env, SHADOW_FINISH_AWS_PAUSE_GET=str(INTERRUPTED_GET)), output,
                 'interrupted', timeout, pause=cloud / 'paused-get.json')
    before_cleanup = charged(journal_path)
    log = cloud / 'aws-calls.jsonl'
    calls, before = get_counts(log)
    require(sum(before.values()) == INTERRUPTED_GET, 'wrong interrupted GET ordinal')
    require(before_cleanup['body_bytes'] == sum(v.get('size', 0) * before[identity(v)]
                                                for v in fixture['versions']),
            'interruption lost durable body charges')
    require(all(call['command'] != 'terminate-instances' for call in calls),
            'host terminated before evidence audit')

    report = cli(command, env, output, 'resumed', timeout)
    verified = verify_output(finish, report, fixture)
    calls, after = get_counts(log)
    interrupted_version = identity(paused)
    expected = Counter({identity(v): 1 for v in fixture['versions']
                        if v['kind'] == 'object' and v['size'] > 0})
    expected[interrupted_version] += 1
    require(after == expected, 'GET replayed for verified bytes or failed to retry the interrupted version')
    expected_bytes = sum(v.get('size', 0) * expected[identity(v)] for v in fixture['versions'])
    final_charges = charged(journal_path)
    require(final_charges['body_bytes'] == expected_bytes, 'unexpected durable original body charge')
    operations = [call['command'] for call in calls]
    termination = operations.index('terminate-instances')
    deletion = operations.index('delete-objects')
    require('describe-instances' in operations[termination + 1:deletion],
            'deletion lacked independent writer-fence observation')

    replay = cli(command, env, output, 'replayed', timeout)
    require(replay['host_evidence']['complete'] and replay['cleanup']['complete']
            and replay['host_evidence']['directory'] == report['host_evidence']['directory']
            and replay['cleanup']['source_inventory_sha256'] == verified['inventory_sha256'],
            'terminal replay changed the retained outcome')
    replay_calls, replay_gets = get_counts(log)
    require(replay_gets == after, 'terminal replay issued GET requests')
    require(not any(call['command'].startswith(('terminate-', 'delete-', 'remove-'))
                    for call in replay_calls[len(calls):]), 'terminal replay repeated cleanup effects')
    replay_charges = charged(journal_path)
    require(replay_charges['body_bytes'] == final_charges['body_bytes'], 'terminal replay charged body bytes')
    return dict(verified, attempts=attempts, fixture_body_bytes=attempts * body_bytes,
                interrupted_version=interrupted_version,
                verified_before_interruption=paused['verified_before_interruption'],
                gets_before_resume=sum(before.values()),
                gets_after_resume=sum(after.values()), gets_after_replay=sum(replay_gets.values()),
                charged_at_interrupt=before_cleanup, charged_after_finish=final_charges,
                charged_after_replay=replay_charges)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path, help='fresh private evidence directory')
    parser.add_argument('--attempts', default=FULL_ATTEMPTS, type=int)
    parser.add_argument('--body-bytes', default=FULL_BODY_BYTES, type=int)
    parser.add_argument('--timeout', default=600, type=int, help='seconds per successful CLI invocation')
    args = parser.parse_args()
    if not 1 <= args.attempts <= FULL_ATTEMPTS or args.body_bytes < 8 or args.timeout <= 0:
        parser.error('invalid rehearsal limits')
    os.umask(0o077)
    output = args.output.resolve()
    output.mkdir(mode=0o700)
    try:
        summary = rehearse(output, args.attempts, args.body_bytes, args.timeout)
    except (KeyError, OSError, TypeError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        write_json(output / 'failure.json', dict(error=str(error)))
        print(f'Rehearsal failed. See {output / "failure.json"}', file=sys.stderr)
        return 1
    write_json(output / 'summary.json', summary)
    print(json.dumps(summary, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
