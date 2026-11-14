#!/usr/bin/env python3
"""Validate the server2 log destination settings and render the collector configuration.

Runs as the collector unit's start condition (`ExecCondition`), before the collector
(Vector) starts. It reads only the allowlisted names below, from its own environment
first and then from the server's `.env` file with the dotenv 10.0.0 rules that
server2 uses. No other value of that file is kept, printed or passed on: the
provider keys stay out of the collector's process and configuration.

Exit codes follow systemd's ExecCondition contract:
  0    a remote destination is selected; the configuration was written and the
       collector start record printed (stdout goes to the server2 journal)
  1    `local` is the only destination; the collector is skipped and the journal
       remains the only copy
  255  invalid settings; the unit fails with a message that names the variable
       but never its value. The server unit does not depend on this unit.
"""
import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path

ALLOWED = (
    'SERVER2_LOG_SINKS', 'SERVER2_LOG_S3_LEVEL', 'SERVER2_LOG_CLOUDWATCH_LEVEL',
    'SERVER2_LOG_S3_PREFIX', 'SERVER2_LOG_CLOUDWATCH_GROUP', 'SERVER2_S3_BUCKET', 'SERVER2_S3_REGION',
)
DESTINATIONS = ('local', 's3', 'cloudwatch')
LEVELS = {'debug': 0, 'info': 1, 'warn': 2, 'error': 3}
DEFAULT_REGION = 'ap-northeast-2'
DEFAULTS = {'SERVER2_LOG_SINKS': 'local', 'SERVER2_LOG_S3_LEVEL': 'info', 'SERVER2_LOG_CLOUDWATCH_LEVEL': 'warn'}
# The journal namespace and units whose output is shipped; their `source` names.
NAMESPACE = 'server2'
UNITS = {'server2.service': 'server', 'server2-logs.service': 'collector'}
# First segments of the weather data prefixes in the same bucket (staging role policy).
# A log prefix inside them would put the log lifecycle rule over weather records.
RESERVED_PREFIXES = ('raw', 'index', 'packs', 'summary', 'state', 'budgets', 'geocode')
COLLECTOR_SCHEMA = 1
S3_BATCH_SECONDS = 60
CLOUDWATCH_BATCH_SECONDS = 1


class SettingError(Exception):
    """One invalid setting. The message names the variable and the rule, never the value."""

    def __init__(self, variable, problem):
        super().__init__(f'{variable}: {problem}')
        self.variable = variable


# ECMAScript `\s`/`trim` (server2/src/world/js.rs `is_js_space`): U+FEFF is a space,
# U+0085 is not. Python's own `\s` and `str.strip()` differ, so they are not used.
JS_SPACE = ('\t\n\x0b\x0c\r \xa0\u1680\u2028\u2029\u202f\u205f\u3000\ufeff'
            + ''.join(chr(c) for c in range(0x2000, 0x200b)))


def _parse_line(line):
    r"""One line, as server2/src/dotenv.rs `parse_line`: `^\s*([\w.-]+)\s*=\s*(.*)?\s*$`
    with JavaScript semantics, then the quote or trim rule."""
    rest = line.lstrip(JS_SPACE)
    end = 0
    while end < len(rest) and rest[end].isascii() and (rest[end].isalnum() or rest[end] in '_.-'):
        end += 1
    if end == 0:
        return None
    key, rest = rest[:end], rest[end:].lstrip(JS_SPACE)
    if not rest.startswith('='):
        return None
    rest = rest[1:].lstrip(JS_SPACE)
    # `(.*)?` stops at U+2028/U+2029; `\s*$` must then consume everything after it.
    cut = min([i for i in (rest.find('\u2028'), rest.find('\u2029')) if i >= 0], default=len(rest))
    value, tail = rest[:cut], rest[cut:]
    if tail.strip(JS_SPACE):
        return None
    if len(value) >= 2 and value[0] == value[-1] == '"':
        value = value[1:-1].replace('\\n', '\n')
    elif len(value) >= 2 and value[0] == value[-1] == "'":
        value = value[1:-1]
    else:
        value = value.strip(JS_SPACE)
    return key, value


def parse_dotenv(text, names=ALLOWED):
    """dotenv 10.0.0 `parse`, as server2/src/dotenv.rs implements it, kept to `names`."""
    values = {}
    for line in re.split(r'\r\n|\n|\r', text):
        parsed = _parse_line(line)
        if parsed and parsed[0] in names:
            values[parsed[0]] = parsed[1]
    return values


def lookup(environ, file_values):
    """Process environment wins over the file, even when empty (dotenv `config`)."""
    return {name: environ[name] if name in environ else file_values.get(name) for name in ALLOWED}


def _level(values, name):
    value = values.get(name)
    value = DEFAULTS[name] if value is None or value == '' else value
    if value not in LEVELS:
        raise SettingError(name, 'unknown level; allowed: ' + ', '.join(LEVELS))
    return value


def settings(values):
    """Validated destination settings from looked-up values."""
    raw = values.get('SERVER2_LOG_SINKS')
    raw = DEFAULTS['SERVER2_LOG_SINKS'] if raw is None else raw
    items = [item.strip() for item in raw.split(',')]
    if not raw.strip() or any(not item for item in items):
        raise SettingError('SERVER2_LOG_SINKS', 'empty destination; list local, s3 and/or cloudwatch separated by commas')
    if any(item not in DESTINATIONS for item in items):
        raise SettingError('SERVER2_LOG_SINKS', 'unknown destination; allowed: ' + ', '.join(DESTINATIONS))
    sinks = [d for d in DESTINATIONS if d in items]
    result = {'sinks': sinks, 's3_level': _level(values, 'SERVER2_LOG_S3_LEVEL'),
              'cloudwatch_level': _level(values, 'SERVER2_LOG_CLOUDWATCH_LEVEL')}
    remote = [d for d in sinks if d != 'local']
    if remote:
        # server2's own default for SERVER2_S3_REGION (src/storage/settings.rs), reused for CloudWatch Logs.
        region = values.get('SERVER2_S3_REGION') or DEFAULT_REGION
        if not re.fullmatch(r'[a-z]{2}(-[a-z]+)+-[0-9]', region):
            raise SettingError('SERVER2_S3_REGION', 'not an AWS region name')
        result['region'] = region
    if 's3' in sinks:
        bucket = values.get('SERVER2_S3_BUCKET') or ''
        if not bucket:
            raise SettingError('SERVER2_S3_BUCKET', 'required for the s3 destination')
        if not re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]', bucket) or '..' in bucket:
            raise SettingError('SERVER2_S3_BUCKET', 'not an S3 bucket name')
        prefix = values.get('SERVER2_LOG_S3_PREFIX') or ''
        if not prefix:
            raise SettingError('SERVER2_LOG_S3_PREFIX', 'required for the s3 destination')
        segments = prefix.split('/')
        if (not re.fullmatch(r'[A-Za-z0-9._/-]{1,200}', prefix) or any(s in ('', '.', '..') for s in segments)):
            raise SettingError('SERVER2_LOG_S3_PREFIX', 'use letters, digits, ".", "_", "-" and single "/" between segments, without a leading or trailing "/"')
        if segments[0] in RESERVED_PREFIXES:
            raise SettingError('SERVER2_LOG_S3_PREFIX', 'must not start inside a weather data prefix: ' + ', '.join(RESERVED_PREFIXES))
        result.update(bucket=bucket, prefix=prefix)
    if 'cloudwatch' in sinks:
        group = values.get('SERVER2_LOG_CLOUDWATCH_GROUP') or ''
        if not group:
            raise SettingError('SERVER2_LOG_CLOUDWATCH_GROUP', 'required for the cloudwatch destination')
        if not re.fullmatch(r'[A-Za-z0-9._/#-]{1,512}', group) or group.startswith('aws/'):
            # AWS reserves names starting with aws/ (CreateLogGroup), CX-LP5-003.
            raise SettingError('SERVER2_LOG_CLOUDWATCH_GROUP', 'not a CloudWatch Logs group name (aws/ is reserved)')
        result['group'] = group
    return result


def machine_id(path='/etc/machine-id'):
    value = Path(path).read_text().strip()
    if not re.fullmatch(r'[0-9a-f]{32}', value):
        raise SettingError('machine-id', 'unreadable host identity')
    return value


def _filter_program(min_level):
    """VRL: keep a server schema-1 record at or above `min_level`, or a collector record.

    Everything else (the stdout readiness line, abort messages, the collector's own
    diagnostics) is dropped from this destination and stays in the journal only.
    The shipped message is the original line, unchanged.
    """
    units = ' else '.join(f'if unit == "{u}" {{ "{s}" }}' for u, s in UNITS.items())
    ranks = ' else '.join(f'if level == "{name}" {{ {rank} }}' for name, rank in LEVELS.items())
    return f'''
unit = string(._SYSTEMD_UNIT) ?? ""
source = {units} else {{ abort }}
line = string(.message) ?? ""
parsed = object(parse_json(line) ?? null) ?? {{}}
if source == "server" {{
  if parsed.schema != 1 {{ abort }}
  level = string(parsed.level) ?? ""
  rank = {ranks} else {{ -1 }}
  if rank < {LEVELS[min_level]} {{ abort }}
}} else {{
  if parsed.collector_schema != {COLLECTOR_SCHEMA} {{ abort }}
}}
boot = downcase(string(._BOOT_ID) ?? "unknown")
. = {{"message": line, "timestamp": .timestamp, "log_source": source, "log_boot": boot}}
'''.strip()


def collector_config(config, instance_id, state_dir):
    """The Vector configuration: one journal reader per remote destination.

    Each destination has its own journal source and checkpoint, so a destination
    that is down holds back only its own reader; the journal is the buffer.
    End-to-end acknowledgements advance a checkpoint only after delivery.
    """
    sources, transforms, sinks = {}, {}, {}
    for destination in [d for d in config['sinks'] if d != 'local']:
        sources[f'journal_{destination}'] = {
            # Current boot only: Vector rejects reading across boots on systemd 250-257
            # (Ubuntu 24.04 ships 255, Amazon Linux 2023 ships 252).
            'type': 'journald', 'journal_namespace': NAMESPACE, 'include_units': list(UNITS),
            'current_boot_only': True, 'since_now': False,
        }
        transforms[f'select_{destination}'] = {
            'type': 'remap', 'inputs': [f'journal_{destination}'], 'drop_on_abort': True,
            'source': _filter_program(config[f'{destination}_level']),
        }
    common = {'encoding': {'codec': 'text'}, 'healthcheck': {'enabled': False},
              'acknowledgements': {'enabled': True}, 'region': config.get('region')}
    if 's3' in config['sinks']:
        sinks['s3'] = dict(common, **{
            'type': 'aws_s3', 'inputs': ['select_s3'], 'bucket': config['bucket'],
            'key_prefix': f"{config['prefix']}/{{{{ log_source }}}}/dt=%Y-%m-%d/hour=%H/{instance_id}/{{{{ log_boot }}}}-",
            'filename_time_format': '%Y%m%dT%H%M%SZ', 'filename_append_uuid': True,
            'filename_extension': 'ndjson.gz', 'compression': 'gzip',
            'framing': {'method': 'newline_delimited'},
            'batch': {'timeout_secs': S3_BATCH_SECONDS},
        })
    if 'cloudwatch' in config['sinks']:
        sinks['cloudwatch'] = dict(common, **{
            'type': 'aws_cloudwatch_logs', 'inputs': ['select_cloudwatch'], 'group_name': config['group'],
            'stream_name': f'{{{{ log_source }}}}/{instance_id}/{{{{ log_boot }}}}',
            'create_missing_group': False, 'create_missing_stream': True,
            'batch': {'timeout_secs': CLOUDWATCH_BATCH_SECONDS},
        })
    return {'data_dir': str(state_dir), 'timezone': 'UTC', 'api': {'enabled': False},
            'sources': sources, 'transforms': transforms, 'sinks': sinks}


def start_record(config, instance_id, boot_id, version, timestamp):
    """The collector's first record after each start (collector record format, schema 1)."""
    return {'collector_schema': COLLECTOR_SCHEMA, 'timestamp': timestamp, 'level': 'info',
            'event': 'collector.started', 'collector_version': version,
            'sinks': config['sinks'], 'instance_id': instance_id, 'boot_id': boot_id}


def write_atomic(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=path.parent, prefix='.vector-', suffix='.json')
    with os.fdopen(handle, 'w') as f:
        f.write(text)
    os.chmod(temporary, 0o644)
    os.replace(temporary, path)


def main(argv=None, environ=None):
    parser = argparse.ArgumentParser(description='Render the server2 log collector configuration.')
    parser.add_argument('--env-file', required=True, help="server2's .env (only the allowlisted names are read)")
    parser.add_argument('--state', required=True, help='collector data directory (journal checkpoints)')
    parser.add_argument('--output', required=True, help='rendered collector configuration')
    parser.add_argument('--version-file', required=True, help='pinned collector manifest (collector.json)')
    args = parser.parse_args(argv)
    environ = os.environ if environ is None else environ
    try:
        try:
            text = Path(args.env_file).read_text(encoding='utf-8', errors='replace')
        except FileNotFoundError:
            text = ''  # Same as server2: a missing .env means environment-only settings.
        except OSError as exc:
            raise SettingError('env-file', f'unreadable ({type(exc).__name__})') from None
        config = settings(lookup(environ, parse_dotenv(text)))
        if config['sinks'] == ['local']:
            print('server2 log collector: only the local journal is selected; nothing is shipped', file=sys.stderr)
            return 1
        manifest = json.loads(Path(args.version_file).read_text())
        version = f"vector {manifest['version']}"
        instance_id = machine_id()
        boot_id = Path('/proc/sys/kernel/random/boot_id').read_text().strip().replace('-', '')
        rendered = collector_config(config, instance_id, args.state)
        write_atomic(args.output, json.dumps(rendered, indent=1, sort_keys=True) + '\n')
    except SettingError as exc:
        print(f'server2 log collector: invalid setting {exc}; the collector is not started', file=sys.stderr)
        return 255
    except Exception as exc:  # noqa: BLE001 - any other failure must fail the unit, not skip it
        # Exit code 1 would mean "local only, skip" to systemd; name only the error class.
        print(f'server2 log collector: preparation failed ({type(exc).__name__}); the collector is not started',
              file=sys.stderr)
        return 255
    import datetime
    now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%fZ')
    print(json.dumps(start_record(config, instance_id, boot_id, version, now), sort_keys=True), flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
