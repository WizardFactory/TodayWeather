#!/usr/bin/env python3
"""Integrated check of the server2 log pipeline on a DISPOSABLE Linux host (root).

It installs the pipeline with install.sh, runs the real server2 binary under
server2.service and the real collector under server2-logs.service, and points the
real AWS host names (S3 and CloudWatch Logs in the configured region) at
standin.py through /etc/hosts and a test CA added to the system trust store. The
product units and rendered configuration are not changed for the test; only the
collector gets dummy AWS credentials through a test drop-in, because this host
has no instance role.

The host is modified (packages are not installed, but users, units, /etc/hosts,
the CA store and the server2 journal namespace are). Run it only in a throwaway
VM, never on a server2 host:

  python3 -I linux_check.py --disposable-host --server-binary BIN \\
      --collector-tarball TAR --report OUT.json
"""
import argparse
import collections
import gzip
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import render  # noqa: E402
import aws_templates  # noqa: E402

REGION = 'ap-northeast-2'
BUCKET = 'server2-logs-check'
GROUP = '/server2/check'
PREFIX = 'logs/server2'
PORT = 18080
WORK = Path('/var/tmp/server2-logging-check')
SYNTHETIC = 'SYNTHETIC-PRIVATE-2802'
SECRETS = {  # provider-key names from server2/.env with synthetic values
    'DONGNAE_SECRET_KEYS': SYNTHETIC + '-dongnae', 'AIRKOREA_SECRET_KEYS': SYNTHETIC + '-airkorea',
    'VC_SECRET_KEY': SYNTHETIC + '-vc', 'GOOGLE_SECRET_KEY': SYNTHETIC + '-google',
    'AWS_SECRET_KEY': SYNTHETIC + '-aws',
}
HOSTS_MARK = '# server2-logging-check'
STANDIN_UNIT = 'server2-logging-standin.service'
SYSTEMD_ENV = {'PATH', 'LANG', 'LANGUAGE', 'LC_ALL', 'USER', 'LOGNAME', 'HOME', 'SHELL', 'INVOCATION_ID',
               'JOURNAL_STREAM', 'SYSTEMD_EXEC_PID', 'RUNTIME_DIRECTORY', 'STATE_DIRECTORY', 'MEMORY_PRESSURE_WATCH',
               'MEMORY_PRESSURE_WRITE', 'CREDENTIALS_DIRECTORY', 'NOTIFY_SOCKET', 'TERM', 'LOG_NAMESPACE'}
# No static AWS key anywhere: the collector takes credentials from the instance role
# through the IMDS stand-in, as on EC2 (LP-3).
IMDS_UNIT = 'server2-logging-imds.service'
IMDS_STATE = WORK / 'imds'
STANDIN_KEY_ID = 'ASIASTANDIN'
INSTANCE_A, INSTANCE_B = 'i-0c0ffee0000000001', 'i-0c0ffee0000000002'


def set_identity(instance_id, life_cycle='on-demand'):
    (IMDS_STATE / 'instance-id').write_text(instance_id + '\n')
    (IMDS_STATE / 'life-cycle').write_text(life_cycle + '\n')


def setup_imds():
    """EC2 instance metadata stand-in on 169.254.169.254:80 (loopback alias)."""
    run('ip', 'addr', 'add', '169.254.169.254/32', 'dev', 'lo', check=False)
    systemctl('stop', IMDS_UNIT, check=False)
    systemctl('reset-failed', IMDS_UNIT, check=False)
    shutil.rmtree(IMDS_STATE, ignore_errors=True)
    IMDS_STATE.mkdir(parents=True)
    set_identity(INSTANCE_A)
    run('systemd-run', '--unit', IMDS_UNIT, '/usr/bin/python3', '-I', str(HERE / 'imds_standin.py'), '--state', str(IMDS_STATE))
    for _ in range(200):
        if (IMDS_STATE / 'ready').exists():
            return
        time.sleep(0.1)
    raise SystemExit('IMDS stand-in did not start')


def current_identity():
    return (IMDS_STATE / 'instance-id').read_text().strip()


def run(*args, check=True, **kwargs):
    return subprocess.run(args, check=check, text=True, capture_output=True, **kwargs)


def systemctl(*args, check=True):
    return run('systemctl', *args, check=check)


class Report:
    def __init__(self):
        self.scenarios = []

    def scenario(self, name, criteria):
        entry = {'id': name, 'criteria': criteria, 'checks': [], 'observations': {}}
        self.scenarios.append(entry)
        return entry

    @staticmethod
    def check(entry, name, ok, detail=''):
        entry['checks'].append({'check': name, 'passed': bool(ok), 'detail': detail})
        print(('PASS ' if ok else 'FAIL ') + entry['id'] + ': ' + name + (f' ({detail})' if detail and not ok else ''), flush=True)

    def passed(self):
        return all(c['passed'] for s in self.scenarios for c in s['checks']) and bool(self.scenarios)


def write_env(values):
    path = Path('/opt/server2/config/.env')
    text = ''.join(f'{k}={v}\n' for k, v in values.items())
    path.write_text(text)
    shutil.chown(path, 'root', 'server2')
    path.chmod(0o640)


def server_env(**logging):
    values = {'PORT': str(PORT), 'SERVER2_GATEWAY_LEGACY_URL': 'http://127.0.0.1:9', 'SERVER2_LOG_LEVEL': 'debug',
              'SERVER2_S3_BUCKET': BUCKET, 'SERVER2_S3_REGION': REGION}
    values.update(SECRETS)
    values.update({k: v for k, v in logging.items() if v is not None})
    return values


def setup_tls_and_hosts():
    tls = WORK / 'tls'
    tls.mkdir(parents=True, exist_ok=True)
    names = [f's3.{REGION}.amazonaws.com', f'{BUCKET}.s3.{REGION}.amazonaws.com', f'logs.{REGION}.amazonaws.com']
    run('openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(tls / 'ca.key'), '-out', str(tls / 'ca.crt'),
        '-days', '2', '-subj', '/CN=server2 logging check CA')
    (tls / 'ext.cnf').write_text('subjectAltName=' + ','.join('DNS:' + n for n in names) + '\n')
    run('openssl', 'req', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(tls / 'srv.key'), '-out', str(tls / 'srv.csr'),
        '-subj', '/CN=standin')
    run('openssl', 'x509', '-req', '-in', str(tls / 'srv.csr'), '-CA', str(tls / 'ca.crt'), '-CAkey', str(tls / 'ca.key'),
        '-CAcreateserial', '-out', str(tls / 'srv.crt'), '-days', '2', '-extfile', str(tls / 'ext.cnf'))
    shutil.copy(tls / 'ca.crt', '/usr/local/share/ca-certificates/server2-logging-check.crt')
    run('update-ca-certificates')
    hosts = [l for l in Path('/etc/hosts').read_text().splitlines() if HOSTS_MARK not in l]
    hosts.append('127.0.0.1 ' + ' '.join(names) + ' ' + HOSTS_MARK)
    Path('/etc/hosts').write_text('\n'.join(hosts) + '\n')


def start_standin(state):
    systemctl('stop', STANDIN_UNIT, check=False)
    systemctl('reset-failed', STANDIN_UNIT, check=False)
    shutil.rmtree(state, ignore_errors=True)
    tls = WORK / 'tls'
    run('systemd-run', '--unit', STANDIN_UNIT, '/usr/bin/python3', '-I', str(HERE / 'standin.py'), '--state', str(state),
        '--port', '443', '--bucket', BUCKET, '--log-group', GROUP, '--tls-cert', str(tls / 'srv.crt'),
        '--tls-key', str(tls / 'srv.key'))
    for _ in range(50):
        if (state / 'ready').exists():
            return
        time.sleep(0.1)
    raise SystemExit('stand-in did not start')


def reset_host():
    """Stop the units and empty the server2 journal namespace and collector state."""
    for unit in ('server2-logs-watch.service', 'server2.service', 'server2-logs.service', 'server2-logs-status.service'):
        systemctl('stop', unit, check=False)
        systemctl('reset-failed', unit, check=False)
    # Rotate, then delete every archived file: the namespace keeps running and the
    # new active file is empty. (Restarting the namespace repeatedly trips its start limit.)
    # The namespace daemon exits when idle; rotation needs it running.
    systemctl('start', 'systemd-journald@server2.service', check=False)
    run('journalctl', '--namespace=server2', '--rotate', check=False)
    time.sleep(1.5)
    run('journalctl', '--namespace=server2', '--vacuum-time=1s', check=False)
    shutil.rmtree('/var/lib/private/server2-logs', ignore_errors=True)
    shutil.rmtree('/run/server2-logs', ignore_errors=True)


def http(path, method='GET', body=None, headers=None):
    request = urllib.request.Request(f'http://127.0.0.1:{PORT}{path}', data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as exc:
        return exc.code


def http_body(path):
    """Status and body digest of one request, for comparing responses across conditions."""
    import hashlib
    request = urllib.request.Request(f'http://127.0.0.1:{PORT}{path}')
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, hashlib.sha256(response.read()).hexdigest()
    except urllib.error.HTTPError as exc:
        return exc.code, hashlib.sha256(exc.read()).hexdigest()


FIXED_REQUESTS = ('/health', '/weather/v000903/coord/37.5,127.0', '/no/such/path')


def stop_seconds(unit):
    began = time.monotonic()
    systemctl('stop', unit)
    return round(time.monotonic() - began, 2)


def logging_env(sinks='local,s3,cloudwatch', s3_level='info', cloudwatch_level='info'):
    return server_env(SERVER2_LOG_SINKS=sinks, SERVER2_LOG_S3_LEVEL=s3_level, SERVER2_LOG_CLOUDWATCH_LEVEL=cloudwatch_level,
                      SERVER2_LOG_S3_PREFIX=PREFIX, SERVER2_LOG_CLOUDWATCH_GROUP=GROUP)


def wait_until(predicate, seconds):
    began = time.monotonic()
    while time.monotonic() - began < seconds:
        if predicate():
            return round(time.monotonic() - began, 1)
        time.sleep(0.5)
    return None


def isolation_scenario(report):
    """LP-2 AC1: the collector stopped, or S3, CloudWatch or both failing (each failure
    observed at the stand-in first), change neither responses nor the server's stop time
    (HTTP-only mode: 6 s bound) (CX-LP2-005)."""
    entry = report.scenario('isolation', ['LP2-AC1'])
    check = lambda n, ok, d='': report.check(entry, n, ok, d)
    state = WORK / 'standin-isolation'
    results = {}
    failing_sets = {'baseline': (), 'collector stopped': (), 's3 failing': ('s3',),
                    'cloudwatch failing': ('logs',), 'both failing': ('s3', 'logs')}
    for condition, failing in failing_sets.items():
        reset_host()
        start_standin(state)
        write_env(logging_env())
        for service in failing:
            (state / f'fail-{service}').touch()
        systemctl('start', 'server2-logs.service', check=False)
        systemctl('start', 'server2.service')
        check(f'{condition}: server healthy', wait_health())
        if condition == 'collector stopped':
            systemctl('stop', 'server2-logs.service')
            check(f'{condition}: collector inactive', wait_unit('server2-logs.service', {'inactive'}) == 'inactive')
        else:
            check(f'{condition}: collector active', wait_unit('server2-logs.service', {'active'}) == 'active')
        for service in failing:
            refused = wait_until(lambda: any(o['service'] == service and o['action'] == 'Unavailable'
                                             for o in delivered(state)[3]), 80)
            check(f'{condition}: the stand-in refused {service} before the comparison', refused is not None)
        responses = [http_body(p) for p in FIXED_REQUESTS]
        seconds = stop_seconds('server2.service')
        results[condition] = {'responses': responses, 'stop_seconds': seconds}
    reset_host()
    entry['observations']['conditions'] = results
    for condition in failing_sets:
        if condition == 'baseline':
            continue
        check(f'{condition}: responses equal the baseline', results[condition]['responses'] == results['baseline']['responses'])
        check(f'{condition}: server stops within the 6 s HTTP-only bound', results[condition]['stop_seconds'] < 6,
              str(results[condition]['stop_seconds']))
    systemctl('stop', STANDIN_UNIT, check=False)
    return entry


def status_records():
    """Status records written by the timer: (journal realtime seconds, record)."""
    out = run('journalctl', '--namespace=server2', '-u', 'server2-logs-status.service', '-o', 'json',
              '--output-fields=MESSAGE').stdout
    records = []
    for line in out.splitlines():
        entry = json.loads(line)
        message = entry.get('MESSAGE')
        if isinstance(message, str) and '"collector_schema"' in message:
            records.append((int(entry['__REALTIME_TIMESTAMP']) / 1e6, json.loads(message)))
    return records


def next_status(count, seconds=80):
    """Wait for the timer to write status record number count + 1; never start it by hand."""
    wait_until(lambda: len(status_records()) > count, seconds)
    records = status_records()
    return records[count][1] if len(records) > count else {}


def ordered_subsequence(part, whole):
    position = 0
    for line in part:
        try:
            position = whole.index(line, position) + 1
        except ValueError:
            return False
    return True


def outage_scenario(report):
    """LP-2 AC2/AC3: one destination down, the other continues; after recovery (and a collector
    restart during the outage) every journal record arrives exactly once, in order."""
    entry = report.scenario('outage-and-redelivery', ['LP2-AC2', 'LP2-AC3'])
    check = lambda n, ok, d='': report.check(entry, n, ok, d)
    state = WORK / 'standin-outage'
    reset_host()
    start_standin(state)
    write_env(logging_env())
    systemctl('start', 'server2-logs.service', check=False)
    systemctl('start', 'server2.service')
    check('server healthy', wait_health())
    (state / 'fail-s3').touch()
    for i in range(10):
        http(f'/weather/v000903/coord/36.{i},127.0')
    time.sleep(1)
    newest = [l for l in journal('server2.service') if server_record_level(l) in ('info', 'warn', 'error')][-1]
    seconds = wait_until(lambda: newest in delivered(state)[0]['cloudwatch']['server'], 15)
    entry['observations']['cloudwatch_while_s3_down_seconds'] = seconds
    check('CloudWatch keeps receiving while S3 fails', seconds is not None and seconds <= 10, str(seconds))
    time.sleep(125)  # an S3 batch closes and fails; S3 falls behind its 120 s window
    check('S3 refused uploads during the outage', any(o['action'] == 'Unavailable' for o in delivered(state)[3]))
    during = next_status(len(status_records()))  # the timer's next record (CX-LP2-006)
    entry['observations']['status_during_outage'] = during
    check('the status record shows S3 behind while it fails, CloudWatch current',
          during.get('level') == 'warn' and during['destinations']['s3']['behind'] is True
          and during['destinations']['s3']['unshipped_seconds'] > 120
          and during['destinations']['cloudwatch']['behind'] is False, json.dumps(during)[:300])
    systemctl('restart', 'server2-logs.service')  # a collector restart during the outage
    for i in range(10):
        http(f'/weather/v000903/coord/35.{i},127.0')
    (state / 'fail-s3').unlink()
    wanted = [l for l in journal('server2.service') if server_record_level(l) in ('info', 'warn', 'error')]
    seconds = wait_until(lambda: set(wanted) <= set(delivered(state)[0]['s3']['server']), 150)
    entry['observations']['s3_recovery_seconds'] = seconds
    check('after recovery S3 holds every journal record', seconds is not None, str(seconds))
    after = next_status(len(status_records()))
    entry['observations']['status_after_recovery'] = after
    check('after recovery the status shows S3 current', after.get('destinations', {}).get('s3', {}).get('behind') is False,
          json.dumps(after)[:300])
    systemctl('stop', 'server2.service'); time.sleep(1); systemctl('stop', 'server2-logs.service')
    systemctl('stop', STANDIN_UNIT)
    server_lines = [l for l in journal('server2.service') if server_record_level(l) in ('info', 'warn', 'error')]
    received, keys, streams, _ = delivered(state)
    for destination in ('s3', 'cloudwatch'):
        got = received[destination]['server']
        check(f'{destination}: every record exactly once', sorted(got) == sorted(server_lines),
              f'expected {len(server_lines)} got {len(got)} unique {len(set(got))}')
    check('cloudwatch: records in journal order', received['cloudwatch']['server'] == server_lines)
    objects = []
    for key in keys:
        if '/server/' in key:
            objects.append(gzip.decompress((state / 's3' / key).read_bytes()).decode().splitlines())
    check('s3: lines in journal order within every object', objects and all(ordered_subsequence(o, server_lines) for o in objects))
    statuses = [json.loads(l) for d in ('s3', 'cloudwatch') for l in received[d]['collector']]
    timed = status_records()
    gaps = [round(b[0] - a[0], 1) for a, b in zip(timed, timed[1:])]
    entry['observations']['status_intervals_seconds'] = gaps
    # The status service only runs while the collector is active, so the tick that falls in
    # the restart (whose stop drain waits for S3) is skipped once; the cadence resumes after.
    long_gaps = [g for g in gaps if g > 80]
    check('the timer wrote a status record every 60 s, resuming after the collector restart',
          len(timed) >= 3 and all(50 <= g <= 80 for g in gaps if g <= 80) and len(long_gaps) <= 1
          and all(g <= 150 for g in long_gaps) and gaps and gaps[-1] <= 80, str(gaps))
    for destination in ('s3', 'cloudwatch'):
        shipped = [json.loads(l) for l in received[destination]['collector']]
        check(f'every timer status record reached {destination}',
              all(record in shipped for _, record in timed), f'{len(timed)} written')
    entry['observations']['collector_events'] = sorted({r['event'] for r in statuses})
    return entry


def restart_scenario(report):
    """LP-2 AC3 (CX-LP2-001): a collector restart right after records were read but before
    their S3 object closed resends nothing, and a combined stop (server then collector)
    ships the server's final records."""
    entry = report.scenario('restart-exactly-once', ['LP2-AC3'])
    check = lambda n, ok, d='': report.check(entry, n, ok, d)
    state = WORK / 'standin-restart'
    reset_host()
    start_standin(state)
    write_env(logging_env())
    systemctl('start', 'server2-logs.service', check=False)
    systemctl('start', 'server2.service')
    check('server healthy', wait_health())
    for i in range(5):
        http(f'/weather/v000903/coord/33.{i},127.0')
    time.sleep(3)  # read, but the S3 object (50 s window) is still open
    seconds = stop_seconds('server2-logs.service')
    entry['observations']['collector_stop_seconds'] = seconds
    check('the collector stop waited for confirmation and stayed within its bound', seconds < 100, str(seconds))
    drained = [json.loads(l) for l in journal('server2-logs.service') if '"collector.drained"' in l]
    check('the stop confirmed every destination', drained and drained[-1]['level'] == 'info', json.dumps(drained[-1:])[:300])
    systemctl('start', 'server2-logs.service')
    for i in range(5):
        http(f'/weather/v000903/coord/32.{i},127.0')
    time.sleep(2)
    began = time.monotonic()
    systemctl('stop', 'server2.service', 'server2-logs.service')  # one transaction: server first
    entry['observations']['combined_stop_seconds'] = round(time.monotonic() - began, 1)
    systemctl('stop', STANDIN_UNIT)
    server_lines = [l for l in journal('server2.service') if server_record_level(l) in ('info', 'warn', 'error')]
    received = delivered(state)[0]
    for destination in ('s3', 'cloudwatch'):
        got = received[destination]['server']
        check(f'{destination}: every record exactly once across the restart', sorted(got) == sorted(server_lines),
              f'expected {len(server_lines)} got {len(got)} unique {len(set(got))}')
    shutdown = [l for l in server_lines if '"stage":"shutdown"' in l or '"stage":"runtime_teardown"' in l]
    check('the server\'s final records were shipped at the combined stop',
          shutdown and all(l in received['s3']['server'] and l in received['cloudwatch']['server'] for l in shutdown),
          f'{len(shutdown)} shutdown records')
    return entry


def overrun_scenario(report):
    """LP-2 AC4: records rotated away before delivery are reported with their time range and a
    counter; the counters endpoint is loopback only."""
    entry = report.scenario('journal-overrun', ['LP2-AC4'])
    check = lambda n, ok, d='': report.check(entry, n, ok, d)
    state = WORK / 'standin-overrun'
    reset_host()
    start_standin(state)
    write_env(logging_env())
    systemctl('start', 'server2-logs.service', check=False)
    systemctl('start', 'server2.service')
    check('server healthy', wait_health())
    listening = lambda: [line.split()[3] for line in run('ss', '-ltnH', 'sport = :9598').stdout.splitlines() if line.strip()]
    wait_until(lambda: listening(), 15)  # the endpoint opens a moment after the collector starts
    local = listening()
    check('counters endpoint listens on loopback only', local == ['127.0.0.1:9598'], ' '.join(local) or 'no listener')
    external = run('hostname', '-I').stdout.split()[0]
    refused = run('curl', '-s', '-o', '/dev/null', '-m', '3', f'http://{external}:9598/metrics', check=False).returncode != 0
    check('counters endpoint is not reachable on the host address', refused, external)
    (state / 'fail-s3').touch()
    for i in range(5):
        http(f'/weather/v000903/coord/34.{i},127.0')
    time.sleep(2)
    systemctl('stop', 'server2-logs.service')
    # Simulate an outage longer than the journal cap: rotate and delete the archived entries.
    run('journalctl', '--namespace=server2', '--rotate', check=False)
    time.sleep(1.5)
    run('journalctl', '--namespace=server2', '--vacuum-time=1s', check=False)
    (state / 'fail-s3').unlink()
    systemctl('start', 'server2-logs.service')
    systemctl('start', 'server2-logs-status.service')
    collector = [json.loads(l) for l in journal('server2-logs.service') if '"collector_schema"' in l]
    overruns = [r for r in collector if r['event'] == 'collector.journal_overrun' and r['destination'] == 's3']
    check('an overrun record names the lost time range', len(overruns) == 1 and overruns[0]['lost_from'] < overruns[0]['lost_until'],
          json.dumps(overruns)[:300])
    status = [json.loads(l) for l in journal('server2-logs-status.service') if '"collector_schema"' in l]
    check('the status record counts the overrun', status and status[-1]['destinations']['s3']['journal_overruns'] >= 1
          and status[-1]['level'] == 'warn', json.dumps(status[-1:])[:300])
    got = wait_until(lambda: any(json.loads(l)['event'] == 'collector.journal_overrun' and json.loads(l)['destination'] == 's3'
                                 for l in delivered(state)[0]['s3']['collector']), 75)
    check('the overrun record reaches S3', got is not None, str(got))
    shipped = [json.loads(l) for l in delivered(state)[0]['cloudwatch']['collector']]
    check('the S3 overrun record reaches CloudWatch',  # GEM-LP2-003: the record for the failing destination
          any(r['event'] == 'collector.journal_overrun' and r['destination'] == 's3' for r in shipped))
    systemctl('stop', 'server2.service'); systemctl('stop', 'server2-logs.service'); systemctl('stop', STANDIN_UNIT)
    return entry


def wait_health():
    for _ in range(100):
        try:
            if http('/health') == 200:
                return True
        except OSError:
            pass
        time.sleep(0.1)
    return False


def wait_unit(unit, states, seconds=20):
    for _ in range(seconds * 10):
        state = systemctl('show', '-p', 'ActiveState', '--value', unit, check=False).stdout.strip()
        if state in states:
            return state
        time.sleep(0.1)
    return state


def traffic():
    """Requests that carry the synthetic value in URL, header and body."""
    statuses = [http('/health'),
                http(f'/weather/v000903/coord/37.5,127.0?key={SYNTHETIC}', headers={'Authorization': SYNTHETIC}),
                http('/v000902/push', 'POST', json.dumps({'fcmToken': SYNTHETIC}).encode(), {'Content-Type': 'application/json'}),
                http(f'/no/such/{SYNTHETIC}')]
    return statuses


def journal(unit):
    out = run('journalctl', '--namespace=server2', '-u', unit, '-o', 'json', '--no-pager', '--output-fields=MESSAGE,_BOOT_ID').stdout
    lines = []
    for raw in out.splitlines():
        entry = json.loads(raw)
        message = entry.get('MESSAGE')
        if isinstance(message, list):
            message = bytes(message).decode('utf-8', 'replace')
        lines.append(message)
    return lines


def server_record_level(line):
    try:
        parsed = json.loads(line)
    except ValueError:
        return None
    if isinstance(parsed, dict) and parsed.get('schema') == 1 and parsed.get('level') in render.LEVELS:
        return parsed['level']
    return None


def _parsed(lines):
    """JSON lines; a line torn by a power-off of the host (LP-4 check) is skipped."""
    for line in lines:
        try:
            yield json.loads(line)
        except ValueError:
            continue


def delivered(state):
    """Lines received by the stand-in, grouped by destination and source."""
    result = {'s3': collections.defaultdict(list), 'cloudwatch': collections.defaultdict(list)}
    keys, streams = [], []
    for path in sorted((state / 's3').rglob('*')) if (state / 's3').exists() else []:
        if path.is_file() and not path.name.startswith('.'):
            key = str(path.relative_to(state / 's3'))
            keys.append(key)
            source = key.split('/')[2] if key.startswith(PREFIX + '/') else '?'
            result['s3'][source] += gzip.decompress(path.read_bytes()).decode().splitlines()
    group_dir = state / 'cloudwatch' / GROUP.strip('/')
    for path in sorted(group_dir.rglob('*.jsonl')) if group_dir.exists() else []:
        stream = str(path.relative_to(group_dir))[:-len('.jsonl')]
        streams.append(stream)
        text = path.read_text()
        complete = text[:text.rfind('\n') + 1]  # the stand-in may be appending right now
        result['cloudwatch'][stream.split('/')[0]] += [item['message'] for item in _parsed(complete.splitlines())]
    log = (state / 'operations.jsonl').read_text() if (state / 'operations.jsonl').exists() else ''
    operations = list(_parsed(log[:log.rfind('\n') + 1].splitlines()))
    return result, keys, streams, operations


def all_received_text(state):
    texts = []
    for path in state.rglob('*'):
        if path.is_file():
            data = path.read_bytes()
            if path.suffix == '.gz':
                data = gzip.decompress(data)
            texts.append(data.decode('utf-8', 'replace'))
    return '\n'.join(texts)


def delivery_scenario(report, name, criteria, sinks, s3_level, cloudwatch_level, burst=0, timed=()):
    entry = report.scenario(name, criteria)
    check = lambda n, ok, d='': report.check(entry, n, ok, d)
    state = WORK / ('standin-' + name)
    reset_host()
    check('journal namespace starts empty', not journal('server2.service') and not journal('server2-logs.service'))
    start_standin(state)
    logging = dict(SERVER2_LOG_SINKS=','.join(sinks), SERVER2_LOG_S3_LEVEL=s3_level,
                   SERVER2_LOG_CLOUDWATCH_LEVEL=cloudwatch_level, SERVER2_LOG_S3_PREFIX=PREFIX,
                   SERVER2_LOG_CLOUDWATCH_GROUP=GROUP)
    # A first start with an invalid gateway setting makes the server write an
    # error-level record and exit; the second start is the valid one.
    invalid = server_env(**logging)
    del invalid['SERVER2_GATEWAY_LEGACY_URL']
    write_env(invalid)
    systemctl('start', 'server2-logs.service', check=False)
    systemctl('start', 'server2.service')
    for _ in range(100):
        if any(server_record_level(l) == 'error' for l in journal('server2.service')):
            break
        time.sleep(0.1)
    systemctl('stop', 'server2.service')
    systemctl('reset-failed', 'server2.service', check=False)
    write_env(server_env(**logging))
    systemctl('start', 'server2.service')
    check('server healthy', wait_health())
    entry['observations']['statuses'] = traffic()
    # A burst of requests (each writes several records at info/debug/warn).
    entry['observations']['burst_statuses'] = dict(collections.Counter(
        http(f'/weather/v000903/coord/37.{i},127.0') for i in range(burst)))
    remote = [d for d in sinks if d != 'local']
    vector_environ = None
    if remote:
        pid = systemctl('show', '-p', 'MainPID', '--value', 'server2-logs.service').stdout.strip()
        if pid not in ('', '0'):
            raw = Path(f'/proc/{pid}/environ').read_bytes().split(b'\0')
            vector_environ = dict(item.decode().split('=', 1) for item in raw if b'=' in item)
            status = Path(f'/proc/{pid}/status').read_text()
            entry['observations']['collector_rss_kib'] = int(re.search(r'VmHWM:\s+(\d+)', status).group(1))
            rendered = Path('/run/server2-logs/vector.json').read_text()
            check('rendered configuration holds no .env secret', SYNTHETIC not in rendered)
    # Delivery while both units run (CX-LP1-003, CX-LP1-005). One clock starts before a
    # new request; each destination is then watched independently for the newest record
    # that request produced at or above its level.
    bounds = {'s3': 60, 'cloudwatch': 10}  # LP-4: the loss bound without a notice
    remote_levels = {d: lv for d, lv in (('s3', s3_level), ('cloudwatch', cloudwatch_level)) if d in sinks}
    if remote_levels:
        time.sleep(1.5)  # a preceding burst can exhaust the server's own per-second rate limit
        before = len(journal('server2.service'))
        began = time.monotonic()
        http('/weather/v000903/coord/36.1,128.6')
        time.sleep(0.5)
        produced = journal('server2.service')[before:]
        targets = {}
        for destination, level in remote_levels.items():
            wanted = [l for l in produced if server_record_level(l) is not None
                      and render.LEVELS[server_record_level(l)] >= render.LEVELS[level]]
            if wanted:
                targets[destination] = wanted[-1]
            elif destination in timed:
                check(f'{destination} has a new record to time at level {level}', False, 'no record produced')
            else:
                # Declared exclusion, e.g. CloudWatch at `error`: a request writes no error record.
                entry['observations'][f'{destination}_running_delivery_seconds'] = 'excluded: no runtime record at this level'
        arrived = {}
        while len(arrived) < len(targets) and time.monotonic() - began < max(bounds.values()) + 5:
            received = delivered(state)[0]
            for destination, line in targets.items():
                if destination not in arrived and line in received[destination]['server']:
                    arrived[destination] = round(time.monotonic() - began, 1)
            time.sleep(0.25)
        for destination in set(timed) - set(remote_levels):
            check(f'{destination} is selected for timing', False, 'timed destination not selected')
        for destination in targets:
            seconds = arrived.get(destination)
            entry['observations'][f'{destination}_running_delivery_seconds'] = seconds
            check(f'{destination} receives a new record while running, within {bounds[destination]} s of the request',
                  seconds is not None and seconds <= bounds[destination], str(seconds))
    # The server stops first; the collector's stop drain (LP-2) then waits until the
    # destinations confirmed everything, so the final records are shipped.
    systemctl('stop', 'server2.service')
    time.sleep(1)
    began = time.monotonic()
    systemctl('stop', 'server2-logs.service')
    entry['observations']['collector_stop_seconds'] = round(time.monotonic() - began, 3)
    systemctl('stop', STANDIN_UNIT)
    server_lines = journal('server2.service')
    collector_lines = journal('server2-logs.service')
    readiness = [l for l in server_lines if l.startswith('server2 public=')]
    levels = collections.Counter(server_record_level(l) for l in server_lines)
    entry['observations']['journal_levels'] = {str(k): v for k, v in levels.items()}
    entry['observations']['journal_lines'] = len(server_lines)
    check('journal holds server records of every level used', all(levels[l] for l in ('error', 'warn', 'info', 'debug')),
          str(dict(levels)))
    check('journal holds the stdout readiness line', bool(readiness))
    received, keys, streams, operations = delivered(state)
    entry['observations'].update(s3_keys=keys, cloudwatch_streams=streams,
                                 operations=collections.Counter(f"{o['service']}:{o['action']}" for o in operations))
    machine = current_identity()  # the instance ID from instance metadata (LP-3)
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip().replace('-', '')
    for destination, level in (('s3', s3_level), ('cloudwatch', cloudwatch_level)):
        if destination in sinks:
            expected = sorted(l for l in server_lines if server_record_level(l) is not None
                              and render.LEVELS[server_record_level(l)] >= render.LEVELS[level])
            got = sorted(received[destination]['server'])
            check(f'{destination} holds exactly the server records at or above {level}', got == expected,
                  f'expected {len(expected)} got {len(got)}')
            starts = [r for r in map(json.loads, received[destination]['collector']) if r['event'] == 'collector.started']
            check(f'{destination} holds the collector start record',
                  len(starts) == 1 and starts[0]['event'] == 'collector.started' and starts[0]['sinks'] == sinks
                  and starts[0]['collector_version'] == 'vector 0.61.0' and starts[0]['instance_id'] == machine
                  and starts[0]['instance_life_cycle'] == 'on-demand' and starts[0]['boot_id'] == boot,
                  json.dumps(starts)[:300])
            check(f'{destination} holds no readiness line', not any(l in received[destination]['server'] for l in readiness))
        else:
            check(f'{destination} received nothing', not any(o['service'] == ('s3' if destination == 's3' else 'logs')
                                                          for o in operations))
    if 's3' in sinks:
        pattern = re.compile(rf'^{re.escape(PREFIX)}/(server|collector)/dt=\d{{4}}-\d\d-\d\d/hour=\d\d/{machine}/{boot}-\d{{8}}T\d{{6}}Z-[0-9a-f-]{{36}}\.ndjson\.gz$')
        check('S3 keys follow the naming contract', keys and all(pattern.match(k) for k in keys), str(keys[:3]))
    if 'cloudwatch' in sinks:
        check('CloudWatch streams follow the naming contract',
              sorted(streams) == sorted(f'{s}/{machine}/{boot}' for s in ('collector', 'server')), str(streams))
    # The role policy template (LP-5) is the authority for what the collector may call.
    allowed = aws_templates.allowed_actions()
    used = {(o['service'], o['action']) for o in operations}
    check('only actions granted by the role policy template were used', used <= allowed, str(sorted(used - allowed)))
    check('no object was overwritten', ('s3', 'Overwrite') not in used)
    if remote:
        check('every request was signed with the instance-role key from instance metadata',
              operations and all(o['key_id'] == STANDIN_KEY_ID for o in operations
                                 if o['action'] not in ('Unavailable', 'Overwrite')),
              str({o['key_id'] for o in operations}))
    # Every destination, the local journal included (GEM-LP1-003).
    text = (all_received_text(state) if state.exists() else '') + '\n'.join(server_lines + collector_lines)
    check('destinations, the local journal included, hold no synthetic sensitive value', SYNTHETIC not in text)
    if remote:
        names = set(vector_environ or {})
        file_names = set(server_env()) - set(render.ALLOWED)
        check('collector environment holds no .env value', vector_environ is not None
              and not any(SYNTHETIC in v for v in vector_environ.values()) and not (names & file_names),
              str(sorted(names)))
        check('collector environment holds only systemd names (no AWS key)',
              names <= SYSTEMD_ENV, str(sorted(names - SYSTEMD_ENV)))
    else:
        result = systemctl('show', '-p', 'ConditionResult', '--value', 'server2-logs.service').stdout.strip()
        check('collector is skipped when only local is selected', result == 'no', result)
        check('local-only start explains that nothing is shipped',
              any('only the local journal is selected' in l for l in collector_lines))
    return entry


def server_records():
    """Server records at info or above with their journal sequence numbers, oldest first."""
    out = run('journalctl', '--namespace=server2', '-u', 'server2.service', '-o', 'json', '--no-pager',
              '--output-fields=MESSAGE,__CURSOR').stdout
    records = []
    for raw in out.splitlines():
        entry = json.loads(raw)
        message = entry.get('MESSAGE')
        if isinstance(message, list):
            message = bytes(message).decode('utf-8', 'replace')
        if server_record_level(message) in ('info', 'warn', 'error'):
            records.append((int(dict(p.split('=', 1) for p in entry['__CURSOR'].split(';'))['i'], 16), message))
    return records


def replacement_scenario(report):
    """LP-3: two instance IDs in the same hour (an interrupted instance and its replacement,
    with the identical configuration) write disjoint streams and keys, each holding exactly
    that instance's records, and nothing is overwritten (CX-LP3-006, GEM-LP3-004). The two
    instances are simulated on one host against one destination stand-in: the journal and
    collector state are emptied between them, as on a new instance."""
    entry = report.scenario('instance-replacement', ['LP3-AC2'])
    check = lambda n, ok, d='': report.check(entry, n, ok, d)
    state = WORK / 'standin-replacement'
    reset_host()
    start_standin(state)
    write_env(logging_env())
    written = {}
    for instance in (INSTANCE_A, INSTANCE_B):
        set_identity(instance)
        reset_host()  # a new instance's empty disk: no journal, no collector state
        before = {message for _, message in server_records()}
        systemctl('start', 'server2-logs.service')
        systemctl('start', 'server2.service')
        check(f'{instance}: server healthy', wait_health())
        for i in range(3):
            http(f'/weather/v000903/coord/31.{i},127.0')
        systemctl('stop', 'server2.service', 'server2-logs.service')  # server first, then the drain
        written[instance] = [message for _, message in server_records() if message not in before]
    systemctl('stop', STANDIN_UNIT)
    set_identity(INSTANCE_A)
    received, keys, streams, operations = delivered(state)
    hours = {re.search(r'hour=(\d\d)', k).group(1) for k in keys}
    entry['observations'].update(hours=sorted(hours), streams=sorted(streams), keys=len(keys))
    check('both instances wrote in the same hour', len(hours) == 1, str(sorted(hours)))
    for instance in (INSTANCE_A, INSTANCE_B):
        other = INSTANCE_B if instance == INSTANCE_A else INSTANCE_A
        for source in ('server', 'collector'):
            check(f'{instance}: its own {source} stream and {source} keys',
                  f'{source}/{instance}/' in ' '.join(streams) and any(f'/{source}/' in k and f'/{instance}/' in k for k in keys))
        own_keys = [k for k in keys if '/server/' in k and f'/{instance}/' in k]
        in_keys = [line for k in own_keys for line in gzip.decompress((state / 's3' / k).read_bytes()).decode().splitlines()]
        group_dir = state / 'cloudwatch' / GROUP.strip('/')
        in_streams = [json.loads(l)['message'] for path in group_dir.glob(f'server/{instance}/*.jsonl')
                      for l in path.read_text().splitlines()]
        check(f'{instance}: its S3 keys hold exactly its records', sorted(in_keys) == sorted(written[instance]),
              f'expected {len(written[instance])} got {len(in_keys)}')
        check(f'{instance}: its CloudWatch stream holds exactly its records', sorted(in_streams) == sorted(written[instance]),
              f'expected {len(written[instance])} got {len(in_streams)}')
        check(f'{instance}: no record of {other} under its names', not set(in_keys + in_streams) & set(written[other]))
    check('no object was overwritten', not any(o['action'] == 'Overwrite' for o in operations))
    started = [json.loads(l) for l in received['s3']['collector'] if '"collector.started"' in l]
    check('each instance announced itself in its start record', {r['instance_id'] for r in started} == {INSTANCE_A, INSTANCE_B})
    return entry


def abrupt_stop_scenario(report):
    """LP-3 (CX-LP3-005): the collector is killed while S3 has received a server object but
    its confirmation is delayed. After the automatic restart, nothing is lost, and every
    repeated record lies after the position each destination had saved at the kill: the
    documented repeat bound (records read but not yet confirmed in journal order)."""
    entry = report.scenario('abrupt-stop', ['LP3-AC5'])
    check = lambda n, ok, d='': report.check(entry, n, ok, d)
    state = WORK / 'standin-abrupt'
    reset_host()
    start_standin(state)
    write_env(logging_env())
    systemctl('start', 'server2-logs.service')
    systemctl('start', 'server2.service')
    check('server healthy', wait_health())
    for i in range(5):  # S3 confirms a first object, so its saved position is inside the records
        http(f'/weather/v000903/coord/35.{i},127.0')
    confirmed = wait_until(lambda: Path('/var/lib/private/server2-logs/journal_s3/checkpoint.txt').exists()
                           and any(o['action'] == 'PutObject' and '/server/' in o['key'] for o in delivered(state)[3]), 90)
    check('S3 confirmed a first server object', confirmed is not None, str(confirmed))
    (state / 'delay-s3').write_text('45')
    for i in range(10):
        http(f'/weather/v000903/coord/32.{i},127.0')
    stored = wait_until(lambda: any(o['action'] == 'DelayedConfirmation' for o in delivered(state)[3]), 90)
    check('S3 received a server object whose confirmation is delayed', stored is not None, str(stored))
    for i in range(5):  # more records after the delayed object
        http(f'/weather/v000903/coord/33.{i},127.0')
    time.sleep(3)
    def saved_position(destination):
        # The collector rewrites the file in place; read until a complete cursor is seen.
        path = Path(f'/var/lib/private/server2-logs/journal_{destination}/checkpoint.txt')
        for _ in range(50):
            fields = dict(p.split('=', 1) for p in (path.read_text() if path.exists() else '').strip().split(';') if '=' in p)
            if 'i' in fields:
                return int(fields['i'], 16)
            time.sleep(0.02)
        return 0  # nothing confirmed yet: every record is in the window
    saved = {destination: saved_position(destination) for destination in ('s3', 'cloudwatch')}
    pid = systemctl('show', '-p', 'MainPID', '--value', 'server2-logs.service').stdout.strip()
    systemctl('kill', '-s', 'SIGKILL', '--kill-whom=main', 'server2-logs.service')
    (state / 'delay-s3').unlink()
    restarted = wait_until(lambda: systemctl('show', '-p', 'MainPID', '--value', 'server2-logs.service').stdout.strip()
                           not in ('', '0', pid), 30)
    check('the collector restarted by itself after the kill', restarted is not None, str(restarted))
    for i in range(3):
        http(f'/weather/v000903/coord/34.{i},127.0')
    systemctl('stop', 'server2.service')
    systemctl('stop', 'server2-logs.service')
    systemctl('stop', STANDIN_UNIT)
    records = server_records()
    received = delivered(state)[0]
    entry['observations'].update(saved_positions=saved, killed_pid=pid)
    for destination in ('s3', 'cloudwatch'):
        got = collections.Counter(received[destination]['server'])
        expected = [message for _, message in records]
        missing = [m for m in expected if m not in got]
        repeated = {m for m, n in got.items() if n > 1}
        window = {m for seq, m in records if seq > saved[destination]}
        entry['observations'][f'{destination}_repeated'] = len(repeated)
        entry['observations'][f'{destination}_window'] = len(window)
        check(f'{destination}: nothing lost', not missing, f'{len(missing)} missing')
        check(f'{destination}: every repeat lies after the position saved at the kill', repeated <= window,
              f'{len(repeated - window)} outside')
    check('the S3 window excludes the records confirmed before the delay', 0 < entry['observations']['s3_window'] < len(records),
          f"{entry['observations']['s3_window']} of {len(records)}")
    check('the delayed S3 object was sent again (the bound was exercised)', entry['observations']['s3_repeated'] > 0)
    return entry


WATCH_UNIT = 'server2-logs-watch.service'


def unit_inactive_since(unit, field='InactiveEnterTimestampMonotonic'):
    """Monotonic seconds (CLOCK_MONOTONIC) of a unit's last state change, or None."""
    value = systemctl('show', '-p', field, '--value', unit).stdout.strip()
    return int(value) / 1e6 if value and value != '0' else None


def spot_interruption_scenario(report):
    """LP-4 (#2981): a Spot interruption notice stops the server, then the collector,
    inside the documented budget; the notice record reaches every destination before the
    server's shutdown records, and every server record up to the server's stop arrives."""
    entry = report.scenario('spot-interruption', ['LP4-AC1', 'LP4-AC2'])
    check = lambda n, ok, d='': report.check(entry, n, ok, d)
    state = WORK / 'standin-interruption'
    reset_host()
    start_standin(state)
    set_identity(INSTANCE_A, 'spot')
    (IMDS_STATE / 'instance-action').unlink(missing_ok=True)
    write_env(logging_env())
    systemctl('start', 'server2-logs.service', 'server2.service')
    systemctl('restart', WATCH_UNIT)
    check('server healthy', wait_health())
    check('the watcher is watching', wait_until(lambda: any('watching for a Spot interruption notice' in l
                                                             for l in journal(WATCH_UNIT)), 20) is not None)
    for i in range(20):
        http(f'/weather/v000903/coord/36.{i},127.0')
    began = time.monotonic()
    action_time = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + 120))
    (IMDS_STATE / 'instance-action').write_text(json.dumps({'action': 'terminate', 'time': action_time}))
    published_at = time.time()
    stopped = wait_until(lambda: wait_unit('server2-logs.service', {'inactive', 'failed'}, 1) in ('inactive', 'failed'), 130)
    total = round(time.monotonic() - began, 1)
    server_stop, collector_stop = unit_inactive_since('server2.service'), unit_inactive_since('server2-logs.service')
    collector_stopping = unit_inactive_since('server2-logs.service', 'ActiveExitTimestampMonotonic')  # it began to stop
    (IMDS_STATE / 'instance-action').unlink(missing_ok=True)
    set_identity(INSTANCE_A)
    systemctl('stop', STANDIN_UNIT)
    entry['observations'].update(notice_to_collector_stop_seconds=total,
                                 server_stopped_before_collector_by_seconds=round(collector_stop - server_stop, 1)
                                 if server_stop and collector_stop else None)
    check('the server and the collector stopped', stopped is not None)
    check('notice to collector stop within the 81 s budget (two-minute notice)', total <= 81, str(total))
    check('the server unit had stopped before the collector began to stop', server_stop is not None
          and collector_stopping is not None and server_stop <= collector_stopping, f'{server_stop} {collector_stopping}')
    watch_lines = journal(WATCH_UNIT)
    notices = [json.loads(l) for l in watch_lines if '"collector.interruption_notice"' in l]
    check('one interruption record with the announced action and time', len(notices) == 1
          and notices[0]['action'] == 'terminate' and notices[0]['action_time'] == action_time, str(notices)[:200])
    if notices:
        import datetime
        seen = datetime.datetime.strptime(notices[0]['timestamp'], '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=datetime.timezone.utc)
        detection = round(seen.timestamp() - published_at, 1)
        entry['observations']['detection_seconds'] = detection
        check('the notice was seen within 6 s of its publication', detection <= 6, str(detection))
    # Every server record up to the unit's stop, at each destination. The server's shutdown
    # records are identified by their own fields, not by time (CX-LP4-005), and the notice
    # record must come before each of them at each destination.
    records = server_records()
    received = delivered(state)[0]
    notice_line = next((l for l in watch_lines if '"collector.interruption_notice"' in l), None)
    shutdown = [json.loads(m) for _, m in records if json.loads(m).get('component') == 'process'
                and json.loads(m).get('stage') in ('shutdown', 'runtime_teardown')]
    entry['observations']['server_shutdown_records'] = len(shutdown)
    check('the server wrote shutdown records', len(shutdown) > 0)
    progress = [json.loads(l) for l in watch_lines if '"collector.interruption_progress"' in l]
    check('the stop progress record says the server stopped', len(progress) == 1 and progress[0]['server_stop'] == 'ok',
          str(progress)[:200])
    for destination in ('s3', 'cloudwatch'):
        got = set(received[destination]['server'])
        missing = [m for _, m in records if m not in got]
        check(f'{destination}: every server record up to the stop arrived', not missing, f'{len(missing)} missing')
        collector_lines = [json.loads(l) for l in received[destination]['collector'] if l.startswith('{')]
        notice_at = [r['timestamp'] for r in collector_lines if r.get('event') == 'collector.interruption_notice']
        shipped_shutdown = [json.loads(m) for m in received[destination]['server']
                            if json.loads(m).get('component') == 'process' and json.loads(m).get('stage') in ('shutdown', 'runtime_teardown')]
        check(f'{destination}: the interruption record arrived', notice_line in received[destination]['collector'] and len(notice_at) == 1)
        check(f'{destination}: the interruption record precedes every shutdown record',
              notice_at and shipped_shutdown and all(notice_at[0] < r['timestamp'] for r in shipped_shutdown),
              f'{notice_at} vs {[r["timestamp"] for r in shipped_shutdown]}')
        check(f'{destination}: the stop progress record arrived', any(r.get('event') == 'collector.interruption_progress' for r in collector_lines))
    return entry


def slow_upload_scenario(report):
    """LP-4 (CX-LP4-007): with every S3 upload answered 5 s late (half the 10 s request bound),
    a new record still reaches S3 within 60 s."""
    entry = report.scenario('s3-slow-upload', ['LP4-AC4'])
    check = lambda n, ok, d='': report.check(entry, n, ok, d)
    state = WORK / 'standin-slow'
    reset_host()
    start_standin(state)
    (state / 'slow-s3').write_text('5')
    write_env(logging_env(sinks='s3'))
    systemctl('start', 'server2-logs.service', 'server2.service')
    check('server healthy', wait_health())
    time.sleep(1.5)
    before = len(journal('server2.service'))
    began = time.monotonic()
    http('/weather/v000903/coord/35.5,127.0')
    time.sleep(0.5)
    produced = [l for l in journal('server2.service')[before:] if server_record_level(l) in ('info', 'warn', 'error')]
    target = produced[-1] if produced else None
    arrived = wait_until(lambda: target in delivered(state)[0]['s3']['server'], 75)
    seconds = round(time.monotonic() - began, 1) if arrived is not None else None
    entry['observations']['s3_delivery_seconds_with_5_s_upload'] = seconds
    check('a record reaches S3 within 60 s although each upload is answered 5 s late', seconds is not None and seconds <= 60, str(seconds))
    attempts = collections.Counter(o['key'] for o in delivered(state)[3] if o['action'] == 'PutObject')
    entry['observations']['upload_attempts_per_object'] = sorted(set(attempts.values()))
    check('no upload was retried (one PutObject per key)', attempts and set(attempts.values()) == {1}, str(dict(attempts))[:200])
    (state / 'slow-s3').unlink()
    systemctl('stop', 'server2.service', 'server2-logs.service')
    systemctl('stop', STANDIN_UNIT)
    return entry


def watcher_idle_scenario(report):
    """LP-4: on an On-Demand instance and without instance metadata the watcher exits
    successfully and stops nothing."""
    entry = report.scenario('interruption-watcher-idle', ['LP4-AC5'])
    check = lambda n, ok, d='': report.check(entry, n, ok, d)
    reset_host()
    write_env(server_env(SERVER2_LOG_SINKS='local'))
    systemctl('start', 'server2.service')
    check('server healthy', wait_health())
    for name, prepare, seconds in (('on-demand', lambda: set_identity(INSTANCE_A, 'on-demand'), 20),
                                   ('no instance metadata', lambda: systemctl('stop', IMDS_UNIT), 90)):
        prepare()
        systemctl('reset-failed', WATCH_UNIT, check=False)
        systemctl('restart', WATCH_UNIT)
        finished = wait_until(lambda: systemctl('show', '-p', 'ActiveState', '--value', WATCH_UNIT).stdout.strip()
                              in ('inactive', 'failed'), seconds)
        result = systemctl('show', '-p', 'Result', '--value', WATCH_UNIT).stdout.strip()
        check(f'{name}: the watcher ended without error', finished is not None and result == 'success', result)
        check(f'{name}: it says why it is idle', any('server2 interruption watcher: idle' in l for l in journal(WATCH_UNIT)))
        check(f'{name}: the server keeps running', systemctl('is-active', 'server2.service', check=False).stdout.strip() == 'active')
        entry['observations'][f'{name}_seconds'] = finished
    setup_imds()
    systemctl('stop', 'server2.service')
    return entry


def spot_warning_scenario(report):
    """LP-3: with only the local journal selected, a Spot instance warns at collector start."""
    entry = report.scenario('spot-local-only-warning', ['LP3-AC4'])
    check = lambda n, ok, d='': report.check(entry, n, ok, d)
    for life_cycle, expected in (('spot', True), ('on-demand', False)):
        reset_host()
        set_identity(INSTANCE_A, life_cycle)
        write_env(server_env(SERVER2_LOG_SINKS='local'))
        systemctl('start', 'server2-logs.service', check=False)
        warned = any('"collector.local_only_on_spot"' in l for l in journal('server2-logs.service'))
        check(f'{life_cycle}: warning {"written" if expected else "absent"}', warned == expected)
    set_identity(INSTANCE_A)
    reset_host()
    return entry


def invalid_scenario(report, name, logging, variable, secret_value):
    entry = report.scenario(name, ['AC3'])
    check = lambda n, ok, d='': report.check(entry, n, ok, d)
    reset_host()
    write_env(server_env(**logging))
    systemctl('start', 'server2-logs.service', check=False)
    started = systemctl('start', 'server2.service', check=False)
    check('server unit starts', started.returncode == 0, started.stderr.strip())
    state = wait_unit('server2-logs.service', {'failed'})
    check('collector unit fails', state == 'failed', state)
    check('server unit is active', wait_unit('server2.service', {'active'}) == 'active')
    check('server answers /health 200', wait_health())
    lines = journal('server2-logs.service') + run('journalctl', '-u', 'server2-logs.service', '--no-pager', '-o', 'cat').stdout.splitlines()
    message = [l for l in lines if 'invalid setting' in l]
    check('message names the variable', any(variable in l for l in message), str(message[:1]))
    check('message does not echo the value', message and not any(secret_value in l for l in lines))
    systemctl('stop', 'server2.service')
    return entry


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--disposable-host', action='store_true', required=True)
    parser.add_argument('--server-binary', required=True)
    parser.add_argument('--collector-tarball', required=True)
    parser.add_argument('--report', required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('run as root on a disposable host')
    WORK.mkdir(parents=True, exist_ok=True)
    run('bash', str(HERE / 'install.sh'), '--collector-tarball', args.collector_tarball)
    shutil.copy(args.server_binary, '/opt/server2/bin/server2')
    os.chmod('/opt/server2/bin/server2', 0o755)
    # Earlier versions of this check used a credential drop-in; LP-3 uses instance metadata only.
    Path('/etc/systemd/system/server2-logs.service.d/zz-check-credentials.conf').unlink(missing_ok=True)
    systemctl('daemon-reload')
    setup_tls_and_hosts()
    setup_imds()
    report = Report()
    delivery_scenario(report, 'local-only', ['AC1', 'AC2'], ['local'], 'info', 'warn')
    delivery_scenario(report, 's3-only', ['AC1', 'AC2', 'AC4', 'AC5'], ['s3'], 'info', 'warn', timed=('s3',))
    delivery_scenario(report, 'cloudwatch-only', ['AC1', 'AC2', 'AC4', 'AC5'], ['cloudwatch'], 'info', 'warn', timed=('cloudwatch',))
    delivery_scenario(report, 'all-destinations', ['AC1', 'AC2', 'AC4', 'AC5'], ['local', 's3', 'cloudwatch'], 'debug', 'error', burst=300, timed=('s3',))
    replacement_scenario(report)
    abrupt_stop_scenario(report)
    spot_interruption_scenario(report)
    watcher_idle_scenario(report)
    slow_upload_scenario(report)
    spot_warning_scenario(report)
    isolation_scenario(report)
    restart_scenario(report)
    outage_scenario(report)
    overrun_scenario(report)
    invalid_scenario(report, 'invalid-destination', dict(SERVER2_LOG_SINKS='s3,' + SYNTHETIC), 'SERVER2_LOG_SINKS', SYNTHETIC)
    invalid_scenario(report, 'invalid-level', dict(SERVER2_LOG_SINKS='cloudwatch', SERVER2_LOG_CLOUDWATCH_GROUP=GROUP,
                                                   SERVER2_LOG_CLOUDWATCH_LEVEL=SYNTHETIC), 'SERVER2_LOG_CLOUDWATCH_LEVEL', SYNTHETIC)
    invalid_scenario(report, 'missing-prefix', dict(SERVER2_LOG_SINKS='s3'), 'SERVER2_LOG_S3_PREFIX', SECRETS['VC_SECRET_KEY'])
    reset_host()
    systemctl('stop', STANDIN_UNIT, check=False)
    environment = {'kernel': run('uname', '-srm').stdout.strip(),
                   'systemd': run('systemctl', '--version').stdout.splitlines()[0],
                   'collector': run('/opt/server2/logging/vector', '--version').stdout.strip(),
                   'server_binary_sha256': run('sha256sum', args.server_binary).stdout.split()[0]}
    result = {'passed': report.passed(), 'environment': environment, 'scenarios': report.scenarios}
    Path(args.report).write_text(json.dumps(result, indent=1, default=dict) + '\n')
    print('RESULT', 'PASS' if result['passed'] else 'FAIL')
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
