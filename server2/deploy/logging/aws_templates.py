#!/usr/bin/env python3
"""Render and check the AWS templates for the log destinations (LP-5, #2982).

Nothing here calls AWS. The owner applies the rendered files with the commands in
docs/operations/server2-logging.md ("Prepare AWS for the destinations").

  python3 -I aws_templates.py --bucket B --prefix logs/server2 --group /server2/production \\
      --region ap-northeast-2 --account 123456789012 --out DIR

Templates (aws/):
  role-policy.template.json       inline policy for the instance role: put log objects under
                                  the one prefix; create/describe streams and put events in
                                  the one log group. No delete, list, read or group admin.
  bucket-lifecycle.template.json  S3 lifecycle limited to the log prefix: current versions
                                  expire after 90 days, noncurrent versions 1 day later,
                                  expired delete markers and incomplete uploads are removed.
  log-group.template.json         the log group with a 30-day retention.
"""
import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import render  # noqa: E402

TEMPLATES = {'role-policy': 'role-policy.template.json', 'bucket-lifecycle': 'bucket-lifecycle.template.json',
             'log-group': 'log-group.template.json'}
WEATHER_POLICY = HERE.parent / 'staging' / 'role-policy.template.json'
S3_RETENTION_DAYS = 90
CLOUDWATCH_RETENTION_DAYS = 30
# Owner-approved grants (#2982). DescribeLogStreams is an addition justified by the LP-1
# record: Vector's CloudWatch sink calls it before writing (docs/evidence/tasks/issue-2978).
EXPECTED_GRANTS = {
    ('s3:PutObject', 'arn:aws:s3:::${BucketName}/${LogPrefix}/*'),
    ('logs:CreateLogStream', 'arn:aws:logs:${Region}:${AccountId}:log-group:${LogGroupName}:log-stream:*'),
    ('logs:PutLogEvents', 'arn:aws:logs:${Region}:${AccountId}:log-group:${LogGroupName}:log-stream:*'),
    ('logs:DescribeLogStreams', 'arn:aws:logs:${Region}:${AccountId}:log-group:${LogGroupName}'),
    ('logs:DescribeLogStreams', 'arn:aws:logs:${Region}:${AccountId}:log-group:${LogGroupName}:*'),
}


def same(value, expected):
    """Equal as JSON, types included (CX-LP5-004): Python's True == 1 == 1.0 must not pass
    where AWS requires an integer period or a boolean flag."""
    return json.dumps(value, sort_keys=True) == json.dumps(expected, sort_keys=True)


def load(name):
    return json.loads((HERE / 'aws' / TEMPLATES[name]).read_text())


def _list(value):
    return value if isinstance(value, list) else [value]


def grants(policy):
    """(action, resource) pairs an Allow policy grants; other statement forms are violations."""
    pairs, problems = set(), []
    for statement in policy.get('Statement', []):
        unknown = set(statement) - {'Sid', 'Effect', 'Action', 'Resource'}
        if statement.get('Effect') != 'Allow' or unknown:
            problems.append(f"statement {statement.get('Sid')}: only Effect=Allow with Action/Resource is expected")
        for action in _list(statement.get('Action', [])):
            for resource in _list(statement.get('Resource', [])):
                pairs.add((action, resource))
    return pairs, problems


def policy_violations(policy):
    """Everything in the role policy that is not exactly an approved grant."""
    pairs, problems = grants(policy)
    problems += [f'unexpected grant {a} on {r}' for a, r in sorted(pairs - EXPECTED_GRANTS)]
    problems += [f'missing grant {a} on {r}' for a, r in sorted(EXPECTED_GRANTS - pairs)]
    if policy.get('Version') != '2012-10-17':
        problems.append('policy Version must be 2012-10-17')
    return problems


def allowed_actions(policy=None):
    """AWS actions as ('s3'|'logs', Name), for comparing with what the collector called."""
    pairs, _ = grants(policy or load('role-policy'))
    return {tuple(action.split(':', 1)) for action, _ in pairs}


def weather_prefixes(path=WEATHER_POLICY):
    """The data prefixes the runtime role can write (the staging role policy)."""
    policy = json.loads(Path(path).read_text())
    prefixes = set()
    for statement in policy['Statement']:
        for resource in _list(statement.get('Resource', [])):
            match = re.fullmatch(r'arn:aws:s3:::\$\{BucketName\}/(.+)\*', resource)
            if match:
                prefixes.add(match.group(1))
    return sorted(prefixes)


def lifecycle_violations(lifecycle, log_prefix, data_prefixes):
    """The lifecycle may only touch the log prefix and must clean up every version."""
    problems, actions = [], set()
    if not log_prefix.strip('/'):
        problems.append('the log prefix is empty')
    for rule in lifecycle.get('Rules', []):
        rule_prefix = (rule.get('Filter') or {}).get('Prefix')
        if set(rule.get('Filter') or {}) != {'Prefix'} or not (rule_prefix or '').strip('/'):
            problems.append(f"rule {rule.get('ID')}: filter must be exactly a non-empty Prefix")
            continue
        if rule_prefix != log_prefix.rstrip('/') + '/':
            problems.append(f"rule {rule.get('ID')}: filter is not the log prefix")
        for data in data_prefixes:
            if data.startswith(rule_prefix) or rule_prefix.startswith(data):
                problems.append(f"rule {rule.get('ID')}: filter overlaps weather prefix {data}")
        if not same(rule.get('Status'), 'Enabled'):
            problems.append(f"rule {rule.get('ID')}: not enabled")
        # Exact fields and values (CX-LP5-001): an extra field such as NewerNoncurrentVersions
        # or Transitions, or a different period, would change what is kept.
        extra = set(rule) - {'ID', 'Status', 'Filter', 'Expiration', 'NoncurrentVersionExpiration',
                             'AbortIncompleteMultipartUpload'}
        if extra:
            problems.append(f"rule {rule.get('ID')}: unexpected fields {sorted(extra)}")
        expiration = rule.get('Expiration')
        if same(expiration, {'Days': S3_RETENTION_DAYS}):
            actions.add('current')
        elif same(expiration, {'ExpiredObjectDeleteMarker': True}):
            actions.add('delete-markers')
        elif expiration is not None:
            problems.append(f"rule {rule.get('ID')}: Expiration must be Days={S3_RETENTION_DAYS} or ExpiredObjectDeleteMarker only")
        noncurrent = rule.get('NoncurrentVersionExpiration')
        if same(noncurrent, {'NoncurrentDays': 1}):
            actions.add('noncurrent')
        elif noncurrent is not None:
            problems.append(f"rule {rule.get('ID')}: NoncurrentVersionExpiration must be NoncurrentDays=1 only")
        multipart = rule.get('AbortIncompleteMultipartUpload')
        if same(multipart, {'DaysAfterInitiation': 1}):
            actions.add('multipart')
        elif multipart is not None:
            problems.append(f"rule {rule.get('ID')}: AbortIncompleteMultipartUpload must be DaysAfterInitiation=1 only")
    for needed in ('current', 'noncurrent', 'delete-markers', 'multipart'):
        if needed not in actions:
            problems.append(f'missing lifecycle action: {needed}')
    if len(lifecycle.get('Rules', [])) != 2 or set(lifecycle) != {'Rules'}:
        problems.append('the lifecycle must be exactly the two reviewed rules')
    return problems


def log_group_violations(group):
    """The log group record: exactly the name, the Standard class and the decided retention."""
    expected = {'logGroupName', 'logGroupClass', 'retentionInDays'}
    problems = [] if set(group) == expected else [f'log group fields must be {sorted(expected)}']
    if not same(group.get('retentionInDays'), CLOUDWATCH_RETENTION_DAYS):
        problems.append(f'log group retention must be {CLOUDWATCH_RETENTION_DAYS} days')
    if not same(group.get('logGroupClass'), 'STANDARD'):
        problems.append('log group class must be STANDARD')
    return problems


def fill(template_text, values):
    text = template_text
    for name, value in values.items():
        text = text.replace('${' + name + '}', value)
    left = re.findall(r'\$\{(\w+)\}', text)
    if left:
        raise ValueError('unfilled placeholder: ' + ', '.join(sorted(set(left))))
    return text


def main(argv=None):
    parser = argparse.ArgumentParser(description='Render the AWS templates for the server2 log destinations.')
    parser.add_argument('--bucket', required=True)
    parser.add_argument('--prefix', required=True, help='SERVER2_LOG_S3_PREFIX')
    parser.add_argument('--group', required=True, help='SERVER2_LOG_CLOUDWATCH_GROUP')
    parser.add_argument('--region', required=True)
    parser.add_argument('--account', required=True)
    parser.add_argument('--out', required=True, help='new directory for the rendered files')
    args = parser.parse_args(argv)
    try:
        # The same validation and normalization the collector applies (CX-LP5-002: an
        # empty region becomes server2's default, exactly as the collector would use it).
        config = render.settings({'SERVER2_LOG_SINKS': 's3,cloudwatch', 'SERVER2_S3_BUCKET': args.bucket,
                                  'SERVER2_LOG_S3_PREFIX': args.prefix, 'SERVER2_LOG_CLOUDWATCH_GROUP': args.group,
                                  'SERVER2_S3_REGION': args.region})
    except render.SettingError as exc:
        print(f'aws_templates: {exc}', file=sys.stderr)
        return 2
    if not re.fullmatch(r'[0-9]{12}', args.account):
        print('aws_templates: --account must be a 12-digit AWS account ID', file=sys.stderr)
        return 2
    values = {'BucketName': config['bucket'], 'LogPrefix': config['prefix'], 'LogGroupName': config['group'],
              'Region': config['region'], 'AccountId': args.account}
    problems = policy_violations(load('role-policy')) + log_group_violations(load('log-group')) + lifecycle_violations(
        json.loads(fill(json.dumps(load('bucket-lifecycle')), values)), config['prefix'], weather_prefixes())
    if problems:
        print('aws_templates: template check failed: ' + '; '.join(problems), file=sys.stderr)
        return 1
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=False)
    for name, file in TEMPLATES.items():
        (out / file.replace('.template', '')).write_text(fill((HERE / 'aws' / file).read_text(), values))
    print(f'aws_templates: rendered {len(TEMPLATES)} files into {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
