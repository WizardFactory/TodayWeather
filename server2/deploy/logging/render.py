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
UNITS = {'server2.service': 'server', 'server2-logs.service': 'collector',
         'server2-logs-status.service': 'collector'}
# Loopback-only Prometheus endpoint with the collector's own counters (LP-2, #2979).
METRICS_ADDRESS = '127.0.0.1:9598'
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


IMDS = 'http://169.254.169.254'
LIFE_CYCLES = ('spot', 'on-demand', 'scheduled')


def instance_identity(timeout=1.0, base=IMDS):
    """(instance ID, life cycle) from EC2 instance metadata (IMDSv2), or (machine ID, 'unknown')
    on a host without instance metadata (LP-3, #2980)."""
    import urllib.request
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        token_request = urllib.request.Request(base + '/latest/api/token', method='PUT',
                                               headers={'X-aws-ec2-metadata-token-ttl-seconds': '60'})
        with opener.open(token_request, timeout=timeout) as response:
            token = response.read().decode()
        def get(path):
            request = urllib.request.Request(base + path, headers={'X-aws-ec2-metadata-token': token})
            with opener.open(request, timeout=timeout) as response:
                return response.read().decode().strip()
        instance_id = get('/latest/meta-data/instance-id')
        life_cycle = get('/latest/meta-data/instance-life-cycle')
        if re.fullmatch(r'i-[0-9a-f]{8,17}', instance_id) and life_cycle in LIFE_CYCLES:
            return instance_id, life_cycle
    except (OSError, ValueError):
        pass
    return machine_id(), 'unknown'


def _journal_cursor(arguments):
    """Last cursor of the read units' entries for `arguments` (-n 1), or None."""
    import subprocess
    # Only entries of the read units: journald's own lines ("Journal stopped") are never read.
    matches = [f'_SYSTEMD_UNIT={unit}' for unit in UNITS]
    result = subprocess.run(['journalctl', f'--namespace={NAMESPACE}', *arguments, '-o', 'json',
                             '--output-fields=__CURSOR', '-n', '1', *matches], capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        raise OSError('journalctl failed')
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    return json.loads(lines[-1])['__CURSOR'] if lines else None


def journal_boots():
    """Boot IDs of the server2 namespace, oldest first (none for an empty namespace).

    A failing journalctl fails the start instead of returning no boots: an empty list
    would drop the saved backlog plan."""
    import subprocess
    result = subprocess.run(['journalctl', f'--namespace={NAMESPACE}', '--list-boots', '--no-pager', '-q'],
                            capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        raise OSError('journalctl --list-boots failed')
    return [m.group(1) for m in re.finditer(r'^\s*-?\d+\s+([0-9a-f]{32})\b', result.stdout, re.M)]


def _cursor_fields(cursor):
    return dict(part.split('=', 1) for part in cursor.strip().split(';') if '=' in part)


def _write_owned(state_dir, path, text):
    """Write a reader checkpoint owned like the state directory: this start step runs as
    root, the collector as the unit's dynamic user, which must be able to update it."""
    owner = state_dir.stat()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    for item in (path.parent, path):
        os.chown(item, owner.st_uid, owner.st_gid)


def _journal_first_cursor(arguments):
    """First cursor journalctl prints for `arguments`, or None."""
    import subprocess
    process = subprocess.Popen(['journalctl', f'--namespace={NAMESPACE}', *arguments, '-o', 'json',
                                '--output-fields=__CURSOR'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    line = process.stdout.readline()
    if line.strip():
        process.kill()
        process.wait()
        return json.loads(line)['__CURSOR']
    process.wait(timeout=30)
    if process.returncode != 0:
        raise OSError('journalctl failed')
    return None


def save_state_json(path, value):
    """Replace a state file atomically (write, fsync, rename), so an interrupted write
    leaves either the old or the new content, never a truncated file (CX-LP3-002)."""
    path = Path(path)
    temporary = path.with_name('.' + path.name + '.tmp')
    with open(temporary, 'w') as handle:
        handle.write(json.dumps(value, sort_keys=True))
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(path)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def _load_state_json(path):
    """(value, readable): a missing file is an empty state; an unreadable one is kept aside
    as <name>.corrupt and reported, never silently treated as empty."""
    try:
        return json.loads(path.read_text()), True
    except FileNotFoundError:
        return {}, True
    except ValueError:
        path.replace(path.with_name(path.name + '.corrupt'))
        return {}, False


def _position(cursor, after):
    """(sequence ID, first sequence number still needed, realtime) of a cursor."""
    fields = _cursor_fields(cursor)
    return [fields['s'], int(fields['i'], 16) + (1 if after else 0), int(fields['t'], 16)]


def _warn(event, **fields):
    import datetime
    print(json.dumps(dict(collector_schema=COLLECTOR_SCHEMA, level='warn', event=event,
                          timestamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%fZ'),
                          **fields), sort_keys=True), flush=True)


def plan_backlog(state_dir, destinations, current_boot, boots=None, last_cursor=_journal_cursor, first_cursor=None):
    """Earlier boots each destination still has to ship (surviving disk, LP-3).

    Vector reads only the current boot on systemd 250-257, so a destination whose position
    is in an earlier boot gets one extra reader per earlier boot still in the journal: the
    reader of the position's boot starts where the checkpoint stopped, a later boot (or,
    without a checkpoint, the boot in which the reader started) from its first entry. When
    the position's boot rotated out, every remaining earlier boot is planned (CX-LP3-001).
    The plan persists in backlog.json until each reader has reached its boot's last entry,
    so a restart in between keeps the remaining backlog. A planned boot that rotates out
    stays in the plan, marked `rotated`, until status.py has reported the loss (CX-LP3-004).
    Each item keeps `needed`, the first position its reader needs, for that report."""
    first_cursor = first_cursor or _journal_first_cursor
    state_dir = Path(state_dir)
    state_dir.mkdir(parents=True, exist_ok=True)
    plan_file, starts_file = state_dir / 'backlog.json', state_dir / 'reader-start.json'
    plan, plan_ok = _load_state_json(plan_file)
    # Boot in which a reader without a checkpoint started: it reads that boot from its
    # first entry, so a reader that never confirmed anything before a reboot (a destination
    # failing throughout) still has that whole boot to ship.
    starts, starts_ok = _load_state_json(starts_file)
    recovering = not (plan_ok and starts_ok)
    if recovering:
        # What was shipped is unknown: plan every earlier boot still in the journal. Readers
        # resume from their own saved positions; the rest can repeat records, never lose them.
        _warn('collector.backlog_state_recovered',
              message='backlog state was unreadable; every earlier boot in the journal is shipped again')
    boots = journal_boots() if boots is None else boots
    earlier = boots[:boots.index(current_boot)] if current_boot in boots else list(boots)
    for destination in destinations:
        try:
            checkpoint = (state_dir / f'journal_{destination}' / 'checkpoint.txt').read_text().strip()
        except FileNotFoundError:
            checkpoint = ''
        pending = {item['boot']: item for item in plan.get(destination, [])}
        if checkpoint:
            starts.pop(destination, None)
            boot = _cursor_fields(checkpoint).get('b')
        else:
            boot = starts.setdefault(destination, current_boot)
        if recovering:
            wanted = earlier
        elif boot == current_boot:
            wanted = []
        elif boot in earlier:
            wanted = earlier[earlier.index(boot):]
        else:
            wanted = earlier  # the position's boot rotated out: everything that remains
        for later in wanted:
            if later in pending:
                continue
            source = f'backlog_{destination}_{later[:12]}'
            seed = state_dir / source / 'checkpoint.txt'
            if checkpoint and later == boot and not seed.exists():
                _write_owned(state_dir, seed, checkpoint + '\n')
            if seed.exists():
                needed = _position(seed.read_text().strip(), after=True)
            else:
                first = first_cursor([f'--boot={later}'])
                if first is None:
                    continue  # nothing of this boot is left
                needed = _position(first, after=False)
            pending[later] = {'boot': later, 'source': source, 'needed': needed}
        remaining = []
        for item in pending.values():
            if item['boot'] not in boots:
                item['rotated'] = True  # kept until status.py reports the loss
                remaining.append(item)
                continue
            last = last_cursor([f"--boot={item['boot']}"])
            if last is None:
                continue  # the boot holds no entry of the read units: nothing to ship (GEM-LP3-003)
            try:
                done = (state_dir / item['source'] / 'checkpoint.txt').read_text().strip()
            except FileNotFoundError:
                done = ''
            if done:
                done_fields, last_fields = _cursor_fields(done), _cursor_fields(last)
                # Sequence numbers compare only within one sequence ID (CX-LP3-003).
                if done_fields['s'] == last_fields['s'] and int(done_fields['i'], 16) >= int(last_fields['i'], 16):
                    continue  # this boot is shipped
            remaining.append(item)
        if remaining:
            plan[destination] = sorted(remaining, key=lambda item: boots.index(item['boot']) if item['boot'] in boots else -1)
        else:
            plan.pop(destination, None)
    # A destination that is not selected now keeps its plan for when it is selected again
    # (GEM-LP3-003); only the selected ones get readers.
    save_state_json(plan_file, plan)
    save_state_json(starts_file, starts)
    return {d: items for d, items in plan.items() if d in destinations}


def readers(plan):
    """Plan items that still have a reader (a rotated boot has none)."""
    return {d: [item for item in items if not item.get('rotated')] for d, items in (plan or {}).items()}


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


def collector_config(config, instance_id, state_dir, backlog=None):
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
        inputs = [f'journal_{destination}']
        for item in readers(backlog).get(destination, []):
            # An earlier boot's unshipped records (surviving disk): Vector's own boot
            # argument is overridden by the later --boot.
            sources[item['source']] = {
                'type': 'journald', 'journal_namespace': NAMESPACE, 'include_units': list(UNITS),
                'current_boot_only': True, 'since_now': False, 'extra_args': [f"--boot={item['boot']}"],
            }
            inputs.append(item['source'])
        transforms[f'select_{destination}'] = {
            'type': 'remap', 'inputs': inputs, 'drop_on_abort': True,
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
    # The collector's own counters (sent, failed, dropped per component) on loopback only;
    # status.py reads them and ships a summary record (LP-2, #2979).
    sources['collector_metrics'] = {'type': 'internal_metrics', 'scrape_interval_secs': 10}
    sinks['collector_metrics_endpoint'] = {'type': 'prometheus_exporter', 'inputs': ['collector_metrics'],
                                           'address': METRICS_ADDRESS}
    return {'data_dir': str(state_dir), 'timezone': 'UTC', 'api': {'enabled': False},
            'sources': sources, 'transforms': transforms, 'sinks': sinks}


def start_record(config, instance_id, boot_id, version, timestamp, life_cycle='unknown', backlog=None):
    """The collector's first record after each start (collector record format, schema 1)."""
    record = {'collector_schema': COLLECTOR_SCHEMA, 'timestamp': timestamp, 'level': 'info',
              'event': 'collector.started', 'collector_version': version,
              'sinks': config['sinks'], 'instance_id': instance_id, 'boot_id': boot_id,
              'instance_life_cycle': life_cycle}
    if backlog:
        record['backlog_boots'] = {d: [item['boot'] for item in items] for d, items in sorted(readers(backlog).items()) if items}
    return record


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
            if instance_identity()[1] == 'spot':
                import datetime
                print(json.dumps({'collector_schema': COLLECTOR_SCHEMA, 'level': 'warn', 'event': 'collector.local_only_on_spot',
                                  'timestamp': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%fZ'),
                                  'message': 'logs are kept only on this Spot instance and are lost if it is interrupted'},
                                 sort_keys=True), flush=True)
            return 1
        manifest = json.loads(Path(args.version_file).read_text())
        version = f"vector {manifest['version']}"
        instance_id, life_cycle = instance_identity()
        boot_id = Path('/proc/sys/kernel/random/boot_id').read_text().strip().replace('-', '')
        backlog = plan_backlog(args.state, [d for d in config['sinks'] if d != 'local'], boot_id)
        rendered = collector_config(config, instance_id, args.state, backlog)
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
    print(json.dumps(start_record(config, instance_id, boot_id, version, now, life_cycle, backlog), sort_keys=True), flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
