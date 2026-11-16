#!/usr/bin/env python3
"""Integrated LP-6 (#2983) check of the qualification host on a DISPOSABLE Linux VM (root).

It prepares a real bundle (journal, plan, generation grant) from the given server binary,
the pinned collector archive and this checkout's host files, applies the launch user
data, streams the bundle into the real remote receiver (which runs `install-host`) and
lets the real candidate, guard, reader and collector units run. The real host names of
S3 (the run's buckets), the production origin and the providers are pointed at loopback
stand-ins through /etc/hosts and a test CA; instance metadata is the LP-3 stand-in on
169.254.169.254. Outbound TCP to anything but loopback and the metadata address is
rejected for the duration, so no live provider or production read can happen.

Scenarios (one run ID each, the host reset in between):
  provider-rejection  providers answer 401: the rejection is counted and shipped, the guard
                 does not stop and acquisition keeps running (SR-3); the retention stop drains
                 the collector, and the stand-in holds server, guard, reader and collector
                 records, none with a synthetic key, URL or response body (LP6-AC1, AC2, AC4)
  storage-authorization  the run's data buckets answer 403 once acquisition runs: the guard
                 stops with s3_authorization and its stop record is shipped (SR-3)
  config-change  the destination is unreachable; a changed .env stops acquisition as
                 before; after recovery the records still arrive (LP6-AC3)
  frozen-guard   the collector is stopped; a frozen guard is killed by its watchdog and
                 acquisition stops; the restarted collector ships what it missed (LP6-AC3)
  collector-broken  the collector cannot start; installation still starts acquisition (LP6-AC3)
  tampered       a changed collector file in the bundle is refused before anything starts (LP6-AC5)

The host is modified (units, /etc/hosts, CA store, iptables, journal namespace), so run
it only in a throwaway VM, never on a qualification or server2 host:

  python3 -I linux_check.py --disposable-host --server-binary BIN \\
      --collector-tarball TAR --source-commit SHA --report OUT.json
"""
import argparse
import gzip
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOGGING = HERE.parent / 'logging'
SERVER2 = HERE.parents[1]
sys.path.insert(0, str(HERE))
import state  # noqa: E402
import coordinator  # noqa: E402
import remote  # noqa: E402

REGION = 'ap-northeast-2'
WORK = Path('/var/tmp/server2-shadow-check')
TLS = WORK / 'tls'
STANDIN_STATE = WORK / 'standin'
PEER_STATE = WORK / 'peers'
IMDS_STATE = WORK / 'imds'
UNITS_DIR = Path('/etc/systemd/system')
HOSTS_MARK = '# server2-shadow-check'
RULE = 'server2-shadow-check'
SYNTHETIC = 'SYNTHETIC-PRIVATE-2802'
SECRETS = {name: f'{SYNTHETIC}-{name.lower()}' for name in (
    'DONGNAE_SECRET_KEYS', 'AIRKOREA_SECRET_KEYS', 'VC_SECRET_KEY', 'GOOGLE_SECRET_KEY', 'GEOCODER_GOOGLE_KEY',
    'GEOCODER_KAKAO_KEYS', 'KAKAO_SECRET_KEYS', 'OWM_SECRET_KEY', 'WAQI_SECRET_KEY', 'AWS_SECRET_KEY')}
PRODUCTION = 'todayweather.wizardfactory.net'
PROVIDERS = ('apis.data.go.kr', 'apihub.kma.go.kr', 'www.weather.go.kr', 'www.kma.go.kr', 'www.airkorea.or.kr',
             'poisonmap.mfds.go.kr', 'oauth2.googleapis.com', 'maps.googleapis.com', 'www.googleapis.com',
             'airquality.googleapis.com', 'fcm.googleapis.com', 'dapi.kakao.com', 'api.waqi.info',
             'weather.visualcrossing.com', 'api.openweathermap.org', 'api.openai.com')
MARKER = 'PEER-BODY-MARKER-2983'
RUNS = ('lp6-provider', 'lp6-storage', 'lp6-config', 'lp6-frozen', 'lp6-broken', 'lp6-tampered')
SOURCES = {'server', 'guard', 'reader', 'collector'}


def run(*args, check=True, **kwargs):
    return subprocess.run(args, check=check, text=True, capture_output=True, **kwargs)


def systemctl(*args, check=False):
    return run('systemctl', *args, check=check)


def prop(unit, name):
    return systemctl('show', '--property=' + name, '--value', unit).stdout.strip()


def wait_until(predicate, seconds, step=0.5):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        value = predicate()
        if value:
            return value
        time.sleep(step)
    return predicate()


class Report:
    def __init__(self):
        self.scenarios = []

    def scenario(self, name, criteria):
        entry = {'id': name, 'criteria': criteria, 'checks': [], 'observations': {}}
        self.scenarios.append(entry)
        return entry

    @staticmethod
    def check(entry, name, ok, detail=''):
        entry['checks'].append({'check': name, 'passed': bool(ok), 'detail': str(detail)[:2000]})
        print(('PASS ' if ok else 'FAIL ') + entry['id'] + ': ' + name + (f' ({detail})' if detail and not ok else ''), flush=True)

    def passed(self):
        return bool(self.scenarios) and all(c['passed'] for s in self.scenarios for c in s['checks'])


def bucket_names():
    return [f'server2-shadow-{r}-{kind}' for r in RUNS for kind in ('raw', 'state')]


def setup_network():
    """Test CA, /etc/hosts and an egress block: nothing leaves the VM during the check."""
    TLS.mkdir(parents=True, exist_ok=True)
    s3_names = [f's3.{REGION}.amazonaws.com'] + [f'{b}.s3.{REGION}.amazonaws.com' for b in bucket_names()]
    peer_names = [PRODUCTION, *PROVIDERS]
    run('openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(TLS / 'ca.key'),
        '-out', str(TLS / 'ca.crt'), '-days', '2', '-subj', '/CN=server2 shadow check CA')
    (TLS / 'ext.cnf').write_text('subjectAltName=' + ','.join('DNS:' + n for n in s3_names + peer_names) + '\n')
    run('openssl', 'req', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(TLS / 'srv.key'), '-out', str(TLS / 'srv.csr'),
        '-subj', '/CN=standin')
    run('openssl', 'x509', '-req', '-in', str(TLS / 'srv.csr'), '-CA', str(TLS / 'ca.crt'), '-CAkey', str(TLS / 'ca.key'),
        '-CAcreateserial', '-out', str(TLS / 'srv.crt'), '-days', '2', '-extfile', str(TLS / 'ext.cnf'))
    shutil.copy(TLS / 'ca.crt', '/usr/local/share/ca-certificates/server2-shadow-check.crt')
    run('update-ca-certificates')
    hosts = [line for line in Path('/etc/hosts').read_text().splitlines() if HOSTS_MARK not in line]
    hosts.append('127.0.0.1 ' + ' '.join(s3_names) + ' ' + HOSTS_MARK)
    hosts.append('127.0.0.2 ' + ' '.join(peer_names) + ' ' + HOSTS_MARK)
    Path('/etc/hosts').write_text('\n'.join(hosts) + '\n')
    remove_egress_block()
    run('iptables', '-I', 'OUTPUT', '1', '-p', 'tcp', '--syn', '!', '-d', '127.0.0.0/8',
        '-m', 'comment', '--comment', RULE, '-j', 'REJECT')
    run('iptables', '-I', 'OUTPUT', '1', '-p', 'tcp', '-d', '169.254.169.254',
        '-m', 'comment', '--comment', RULE, '-j', 'ACCEPT')


def egress_rejected():
    """Packets of outbound connection attempts the block rejected (to unmapped hosts)."""
    out = run('iptables', '-L', 'OUTPUT', '-v', '-n', '-x').stdout
    return sum(int(line.split()[0]) for line in out.splitlines() if RULE in line and 'REJECT' in line)


def remove_egress_block():
    while True:
        rules = run('iptables', '-S', 'OUTPUT').stdout.splitlines()
        mine = [r for r in rules if RULE in r]
        if not mine:
            return
        run('iptables', *mine[0].replace('-A ', '-D ', 1).split())


CHECK_UNITS = ('server2-shadow-check-standin.service', 'server2-shadow-check-peers.service', 'server2-shadow-check-imds.service')


def start_service(unit, argv, ready):
    systemctl('stop', unit)
    systemctl('reset-failed', unit)
    ready.unlink(missing_ok=True)
    run('systemd-run', '--unit', unit, *argv)
    if not wait_until(ready.exists, 10, 0.1):
        raise SystemExit(unit + ' did not start')


def start_standins(run_id):
    """Destination and data buckets of one run, production/provider peer, instance metadata."""
    shutil.rmtree(STANDIN_STATE, ignore_errors=True)
    start_service('server2-shadow-check-standin.service',
                  ['/usr/bin/python3', '-I', str(LOGGING / 'standin.py'), '--state', str(STANDIN_STATE), '--port', '443',
                   '--bucket', f'server2-shadow-{run_id}-state', '--data-bucket', f'server2-shadow-{run_id}-raw',
                   '--tls-cert', str(TLS / 'srv.crt'), '--tls-key', str(TLS / 'srv.key')], STANDIN_STATE / 'ready')
    # Restarted for every run: each check run creates a new test CA and certificate.
    start_service('server2-shadow-check-peers.service',
                  ['/usr/bin/python3', '-I', str(HERE / 'check_peers.py'), '--state', str(PEER_STATE),
                   '--address', '127.0.0.2', '--tls-cert', str(TLS / 'srv.crt'), '--tls-key', str(TLS / 'srv.key')],
                  PEER_STATE / 'ready')
    if prop('server2-shadow-check-imds.service', 'ActiveState') != 'active':
        run('ip', 'addr', 'add', '169.254.169.254/32', 'dev', 'lo', check=False)
        IMDS_STATE.mkdir(parents=True, exist_ok=True)
        (IMDS_STATE / 'instance-id').write_text('i-0c0ffee0000002983\n')
        (IMDS_STATE / 'life-cycle').write_text('on-demand\n')
        start_service('server2-shadow-check-imds.service',
                      ['/usr/bin/python3', '-I', str(LOGGING / 'imds_standin.py'), '--state', str(IMDS_STATE)],
                      IMDS_STATE / 'ready')


def reset_host():
    """Remove every earlier run's units, the namespace journal and the collector state."""
    for run_id in RUNS:
        name = 'server2-shadow-' + run_id
        units = sorted(p.name for p in UNITS_DIR.glob(name + '-*'))
        if units:
            systemctl('stop', *units)
            systemctl('disable', *units)
            systemctl('reset-failed', *units)
            for unit in units:
                (UNITS_DIR / unit).unlink()
        shutil.rmtree(Path('/opt/server2-shadow') / run_id, ignore_errors=True)
        shutil.rmtree(Path('/opt/server2-shadow-stage') / run_id, ignore_errors=True)
    Path('/etc/systemd/journald@server2.conf').unlink(missing_ok=True)
    systemctl('daemon-reload')
    systemctl('start', 'systemd-journald@server2.service')
    run('journalctl', '--namespace=server2', '--rotate', check=False)
    time.sleep(1.5)
    run('journalctl', '--namespace=server2', '--vacuum-time=1s', check=False)
    systemctl('stop', 'systemd-journald@server2.service')
    if Path('/var/lib/server2-logs').is_file():
        Path('/var/lib/server2-logs').unlink()
    shutil.rmtree('/var/lib/server2-logs', ignore_errors=True)
    shutil.rmtree('/run/server2-logs', ignore_errors=True)
    (PEER_STATE / 'provider-status').unlink(missing_ok=True)


def policies(now):
    cost = dict(schema=2, observed_at=now - 60, prices_sha256='d' * 64, rates={
        'ec2_hour': '0.026', 'ipv4_hour': '0.005', 'gp3_gb_month': '0.0912', 's3_gb_month': '0.025',
        's3_read': '0.00000035', 's3_write': '0.0000045', 'cpu_vcpu_hour': '0.05', 'outbound_gb': '0.126'},
        ceiling_usd='300', prior_spend_usd='0', finish_reserve_usd='5')
    paid = dict(schema=1, observed_at=now - 60, prices_sha256='e' * 64,
                usd_per_unit={p: '0.001' for p in state.PAID_PROVIDERS},
                grants={g: {p: 100 for p in state.PAID_PROVIDERS} for g in state.GENERATIONS})
    return cost, paid


def prepare(args, run_id, interface):
    """A real plan, journal and generation grant; returns the bundle directory."""
    work = WORK / 'runs' / run_id
    shutil.rmtree(work, ignore_errors=True)
    source = work / 'source'
    source.mkdir(parents=True)
    os.chmod(work, 0o700)
    shutil.copy(args.server_binary, source / 'server2')
    shutil.copy(args.collector_tarball, source / 'collector.tar.gz')
    for name in ('paired_read.py',):
        shutil.copy(SERVER2 / 'tools/shadow' / name, source / name)
    for name in ('guard.py', 'coordinator.py', 'state.py', 'bootstrap.sh'):
        shutil.copy(HERE / name, source / name)
    for name in ('collector.json', 'render.py', 'status.py'):
        shutil.copy(LOGGING / name, source / name)
    # Key lists are JSON arrays of keys of at least 20 characters, as in server2/.env.
    (source / 'config.env').write_text(''.join(f'{k}={json.dumps([v]) if k.endswith("_KEYS") else v}\n' for k, v in SECRETS.items())
                                       + 'SERVER2_LOG_LEVEL=info\n')
    binary = coordinator.artifact_hash(source / 'server2')
    reader = dict(schema=1, duration_seconds=3600, max_attempts=6000, min_spacing_seconds=1, candidate_sha256=binary,
                  cases=[dict(id='seoul', method='GET', path='/weather/v000903/coord/37.566,126.978',
                              interval_seconds=20, conditional=False)])
    (source / 'reader.json').write_text(json.dumps(reader))
    for path in source.iterdir():
        path.chmod(0o600)
    now = int(time.time())
    cost, paid = policies(now)
    plan = dict(schema=4, run_id=run_id, source_commit=args.source_commit, port=3000, interface=interface,
                artifacts={n: coordinator.artifact_hash(source / n) for n in coordinator.HOST_ARTIFACTS},
                cost_policy=cost, paid_policy=paid, native_families=['kma'])
    sha = hashlib.sha256(state.canonical(plan).encode()).hexdigest()
    with state.Journal(work / 'journal', create=True, run_id=run_id, manifest_sha=sha, epoch=now) as journal:
        launch = coordinator.prepare_generation(journal, plan, source, work / 'bundle', 'initial',
                                                dict(reads=5000, writes=5000, put_bytes=64 * 1024 ** 2), now=now)
    return work / 'bundle', launch


def launch_user_data(launch):
    script = __import__('base64').b64decode(state.launch_user_data(launch['plan']['run_id'], launch['epoch'])).decode()
    return run('bash', '-s', input=script, check=False)


def receive(bundle, run_id):
    """Stream the bundle into the real receiver, as remote.install_remote does over SSH."""
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w') as archive:
        for name in sorted(coordinator.HOST_ARTIFACTS | {'launch.json'}):
            archive.add(bundle / name, arcname=name, recursive=False)
    started = time.monotonic()
    result = subprocess.run(['/usr/bin/python3', '-c', remote.RECEIVER, run_id], input=stream.getvalue(),
                            capture_output=True, timeout=300)
    return result, time.monotonic() - started


def retention_stop(name):
    """The remote stop of retain_host_evidence: acquisition, then the collector (150 s SSH bound)."""
    started = time.monotonic()
    command = (f'/usr/bin/systemctl stop {name}-reader.service {name}-candidate.service {name}-guard.service'
               f' && /usr/bin/systemctl stop {name}-logs.service')
    result = subprocess.run(['/bin/sh', '-c', command], capture_output=True, text=True, timeout=150)
    states = {s: prop(f'{name}-{s}.service', 'ActiveState') for s in ('candidate', 'reader', 'guard', 'logs')}
    return result.returncode, time.monotonic() - started, states


def destination(run_id):
    """Every record line the stand-in received under logs/server2, with its source."""
    base = STANDIN_STATE / 's3' / coordinator.LOG_PREFIX
    records, raw, keys = [], b'', []
    for path in sorted(base.rglob('*')) if base.exists() else []:
        if not path.is_file() or path.name.startswith('.'):
            continue
        relative = str(path.relative_to(base))
        keys.append(relative)
        data = gzip.decompress(path.read_bytes())
        raw += data
        for line in data.decode().splitlines():
            records.append((relative.split('/', 1)[0], line))
    operations = []
    log = STANDIN_STATE / 'operations.jsonl'
    if log.exists():
        operations = [json.loads(line) for line in log.read_text().splitlines()]
    return records, raw, keys, operations


def parsed(line):
    try:
        value = json.loads(line)
    except ValueError:
        return None
    return value if type(value) is dict else None


def privacy_checks(report, entry, raw):
    text = raw.decode(errors='replace')
    leaked = [v for v in SECRETS.values() if v in text] + [m for m in (SYNTHETIC, MARKER, 'http://', 'https://', '127.0.0.1:3000') if m in text]
    report.check(entry, 'no synthetic key, URL or response body at the destination (LP6-AC4)', not leaked, leaked)


def supervision_checks(report, entry, name, launch):
    for suffix in ('candidate', 'guard', 'reader'):
        unit = f'{name}-{suffix}.service'
        report.check(entry, f'{suffix}: Restart=no, TimeoutStopSec=10, LogNamespace=server2',
                     prop(unit, 'Restart') == 'no' and prop(unit, 'TimeoutStopUSec') == '10s' and prop(unit, 'LogNamespace') == 'server2',
                     (prop(unit, 'Restart'), prop(unit, 'TimeoutStopUSec'), prop(unit, 'LogNamespace')))
        report.check(entry, f'{suffix}: no dependency on or ordering after the collector',
                     f'{name}-logs.service' not in ' '.join(prop(unit, p) for p in ('Requires', 'Wants', 'BindsTo', 'Requisite', 'PartOf', 'After')))
    guard = f'{name}-guard.service'
    report.check(entry, 'guard watchdog 30 s with SIGKILL', prop(guard, 'WatchdogUSec') == '30s' and prop(guard, 'WatchdogSignal') == '9',
                 (prop(guard, 'WatchdogUSec'), prop(guard, 'WatchdogSignal')))
    for timer, hours in (('stop', 168), ('poweroff', 170)):
        expected = time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime(launch['epoch'] + hours * 3600))
        content = (UNITS_DIR / f'{name}-{timer}.timer').read_text()
        report.check(entry, f'{timer} deadline at epoch + {hours} h', f'OnCalendar={expected}\n' in content, content)
    stop = (UNITS_DIR / f'{name}-stop.service').read_text()
    report.check(entry, 'the 168 h stop leaves the collector running', 'logs.service' not in stop, stop)


def install(report, entry, args, run_id, interface):
    bundle, launch = prepare(args, run_id, interface)
    user_data = launch_user_data(launch)
    report.check(entry, 'launch user data armed the expiry timer', user_data.returncode == 0, user_data.stderr[-500:])
    result, seconds = receive(bundle, run_id)
    stdout = result.stdout.decode(errors='replace')
    receipt = parsed(stdout.strip()) if stdout.count('\n') == 1 else None
    entry['observations']['install_seconds'] = round(seconds, 1)
    entry['observations']['install_output_bytes'] = len(result.stdout)
    return launch, result, receipt


def decision(root):
    try:
        return json.loads((root / 'state/decision.json').read_text())
    except (OSError, ValueError):
        return None


def wait_stop(root, seconds=120):
    path = root / 'state/decision.json'
    def stopped():
        try:
            return json.loads(path.read_text()).get('stop')
        except (OSError, ValueError):
            return None
    return wait_until(stopped, seconds)


def delivery_checks(report, entry, run_id, expect):
    records, raw, keys, operations = destination(run_id)
    by_source = {}
    for source, line in records:
        by_source.setdefault(source, []).append(line)
    entry['observations']['records_per_source'] = {k: len(v) for k, v in sorted(by_source.items())}
    entry['observations']['objects'] = len(keys)
    report.check(entry, 'only the four sources under logs/server2', set(by_source) <= SOURCES, sorted(by_source))
    actions = sorted({(o.get('service'), o.get('action'), o.get('bucket')) for o in operations
                      if o.get('bucket') == f'server2-shadow-{run_id}-state'})
    report.check(entry, 'the collector only puts objects into the state bucket', actions == [('s3', 'PutObject', f'server2-shadow-{run_id}-state')], actions)
    for source in expect:
        report.check(entry, f'{source} records at the destination (LP6-AC1)', by_source.get(source), sorted(by_source))
    privacy_checks(report, entry, raw)
    return by_source


def provider_rejection(report, args, interface):
    run_id = 'lp6-provider'; name = 'server2-shadow-' + run_id; root = Path('/opt/server2-shadow') / run_id
    entry = report.scenario('provider-rejection', ['LP6-AC1', 'LP6-AC2', 'LP6-AC3', 'LP6-AC4', 'SR3'])
    reset_host(); start_standins(run_id)
    launch, result, receipt = install(report, entry, args, run_id, interface)
    report.check(entry, 'install-host answered one JSON object: started', receipt is not None and receipt.get('status') == 'started',
                 result.stdout[-500:] + result.stderr[-1500:])
    if receipt is None or receipt.get('status') != 'started':
        return
    supervision_checks(report, entry, name, launch)
    report.check(entry, 'collector running', wait_until(lambda: prop(f'{name}-logs.service', 'ActiveState') == 'active', 20))
    # SR-3: a provider rejection is evidence, never a stop. Wait for the guard to see it.
    def counted():
        d = (decision(root) or {}).get('diagnostics') or {}
        return d.get('auth_failures', 0) + d.get('quota_failures', 0) > 0
    started = time.monotonic()
    seen = wait_until(counted, 180)
    entry['observations']['rejection_seen_seconds'] = round(time.monotonic() - started, 1)
    time.sleep(30)  # three more guard samples with the rejection counted
    latest = decision(root) or {}
    entry['observations']['guard_stop'] = latest.get('stop')
    entry['observations']['guard_diagnostics'] = latest.get('diagnostics')
    report.check(entry, 'the guard counted the provider rejection', seen, latest.get('diagnostics'))
    report.check(entry, 'the guard did not stop on the provider rejection (SR-3)', latest.get('stop') is None, latest.get('stop'))
    report.check(entry, 'candidate, guard and reader still active', all(
        prop(f'{name}-{s}.service', 'ActiveState') == 'active' for s in ('candidate', 'guard', 'reader')),
        {s: prop(f'{name}-{s}.service', 'ActiveState') for s in ('candidate', 'guard', 'reader')})
    code, seconds, states = retention_stop(name)
    entry['observations']['retention_stop_seconds'] = round(seconds, 1)
    report.check(entry, 'retention stop drained the collector within the SSH bound (150 s)', code == 0 and seconds < 150, (code, seconds))
    report.check(entry, 'all four units inactive or failed', all(v in ('inactive', 'failed') for v in states.values()), states)
    # The guard ships a record only when it stops; a run that did not stop has none.
    by_source = delivery_checks(report, entry, run_id, ('server', 'reader', 'collector'))
    failing = [r for r in map(parsed, by_source.get('server', [])) if r and (r.get('cause') == 'auth' or r.get('status') in (401, 403, 429))]
    report.check(entry, "candidate's rejection record at the destination (LP6-AC2)", failing, by_source.get('server', [])[-5:])
    guard_records = [r for r in map(parsed, by_source.get('guard', [])) if r]
    report.check(entry, 'no guard stop record at the destination', not any(r.get('stop') for r in guard_records), guard_records)
    reader = [r for r in map(parsed, by_source.get('reader', [])) if r]
    report.check(entry, "reader's summary at the destination", any('terminal' in r and 'attempts' in r for r in reader), reader)
    entry['observations']['failing_record'] = failing[:1]
    entry['observations']['guard_record'] = guard_records[:1]
    entry['observations']['reader_record'] = reader[:1]


def storage_authorization(report, args, interface):
    run_id = 'lp6-storage'; name = 'server2-shadow-' + run_id; root = Path('/opt/server2-shadow') / run_id
    entry = report.scenario('storage-authorization', ['LP6-AC2', 'SR3'])
    reset_host(); start_standins(run_id)
    # Providers answer an unusable 200: no provider rejection; only storage is denied.
    (PEER_STATE / 'provider-status').write_text('200\n')
    launch, result, receipt = install(report, entry, args, run_id, interface)
    report.check(entry, 'install-host answered one JSON object: started', receipt is not None and receipt.get('status') == 'started',
                 result.stdout[-500:] + result.stderr[-1500:])
    if receipt is None or receipt.get('status') != 'started':
        return
    time.sleep(15)
    report.check(entry, 'no stop before storage is denied', wait_stop(root, 0) is None, decision(root))
    # The instance role loses access to the run's data buckets (the stand-in answers 403).
    (STANDIN_STATE / 'deny-data').write_text('')
    denied = time.monotonic()
    stop = wait_stop(root, 600)
    seconds = time.monotonic() - denied
    latest = decision(root) or {}
    entry['observations'].update(guard_stop=stop, stop_seconds=round(seconds, 1), guard_diagnostics=latest.get('diagnostics'))
    report.check(entry, 'the guard stopped with s3_authorization', stop == 's3_authorization', (stop, latest.get('diagnostics')))
    report.check(entry, 'the decision keeps the storage-authorization count',
                 ((latest.get('diagnostics') or {}).get('storage_auth_failures') or 0) >= 20, latest.get('diagnostics'))
    report.check(entry, 'candidate and reader stopped', wait_until(lambda: all(
        prop(f'{name}-{s}.service', 'ActiveState') in ('inactive', 'failed') for s in ('candidate', 'reader')), 30))
    code, seconds, states = retention_stop(name)
    entry['observations']['retention_stop_seconds'] = round(seconds, 1)
    report.check(entry, 'retention stop drained the collector within 150 s', code == 0 and seconds < 150, (code, seconds))
    by_source = delivery_checks(report, entry, run_id, ('server', 'guard', 'collector'))
    guard_records = [r for r in map(parsed, by_source.get('guard', [])) if r]
    report.check(entry, "guard's s3_authorization stop record at the destination",
                 any(r.get('stop') == 's3_authorization' for r in guard_records), guard_records)
    denied_records = [r for r in map(parsed, by_source.get('server', [])) if r and r.get('cause') == 'auth' and r.get('component') in ('s3', 'quota', 'history', 'summary')]
    report.check(entry, "candidate's storage-authorization record at the destination", denied_records, by_source.get('server', [])[-5:])
    entry['observations']['guard_record'] = [r for r in guard_records if r.get('stop')][:1]
    entry['observations']['denied_record'] = denied_records[:1]


def config_change(report, args, interface):
    run_id = 'lp6-config'; name = 'server2-shadow-' + run_id; root = Path('/opt/server2-shadow') / run_id
    entry = report.scenario('config-change', ['LP6-AC3'])
    reset_host(); start_standins(run_id)
    # Providers answer 200 with an unusable body: failures, but no rejected key.
    (PEER_STATE / 'provider-status').write_text('200\n')
    (STANDIN_STATE / 'fail-s3').write_text('')
    launch, result, receipt = install(report, entry, args, run_id, interface)
    report.check(entry, 'install with the destination unreachable: started', receipt is not None and receipt.get('status') == 'started',
                 result.stdout[-500:] + result.stderr[-1500:])
    if receipt is None or receipt.get('status') != 'started':
        return
    time.sleep(15)
    report.check(entry, 'no stop before the change', wait_stop(root, 0) is None, decision(root))
    with (root / 'config/.env').open('a') as stream:
        stream.write('SERVER2_CHECK_CHANGED=1\n')
    changed = time.monotonic()
    stop = wait_stop(root, 40)
    stopped = wait_until(lambda: prop(f'{name}-candidate.service', 'ActiveState') in ('inactive', 'failed'), 40)
    seconds = time.monotonic() - changed
    entry['observations'].update(guard_stop=stop, stop_seconds=round(seconds, 1))
    report.check(entry, 'a changed .env stops acquisition within one sample and the unit stop (25 s)',
                 stop == 'binding_config_sha256' and stopped and seconds <= 25, (stop, seconds))
    (STANDIN_STATE / 'fail-s3').unlink()
    code, seconds, states = retention_stop(name)
    entry['observations']['retention_stop_seconds'] = round(seconds, 1)
    report.check(entry, 'retention stop after recovery drained within 150 s', code == 0 and seconds < 150, (code, seconds))
    by_source = delivery_checks(report, entry, run_id, ('server', 'guard', 'collector'))
    report.check(entry, "guard's stop record shipped after the outage",
                 any((parsed(l) or {}).get('stop') == 'binding_config_sha256' for l in by_source.get('guard', [])))


def frozen_guard(report, args, interface):
    run_id = 'lp6-frozen'; name = 'server2-shadow-' + run_id
    entry = report.scenario('frozen-guard', ['LP6-AC3'])
    reset_host(); start_standins(run_id)
    (PEER_STATE / 'provider-status').write_text('200\n')
    launch, result, receipt = install(report, entry, args, run_id, interface)
    report.check(entry, 'install: started', receipt is not None and receipt.get('status') == 'started',
                 result.stdout[-500:] + result.stderr[-1500:])
    if receipt is None or receipt.get('status') != 'started':
        return
    systemctl('stop', f'{name}-logs.service')
    states = {s: prop(f'{name}-{s}.service', 'ActiveState') for s in ('logs', 'candidate', 'guard', 'reader')}
    # The reader may have ended by its own rule (three consecutive 5xx answers of the
    # candidate, whose providers answer unusable bodies here); candidate and guard run.
    entry['observations']['states_before_freeze'] = states
    report.check(entry, 'collector stopped, candidate and guard still active',
                 (states['logs'], states['candidate'], states['guard']) == ('inactive', 'active', 'active'), states)
    pid = prop(f'{name}-guard.service', 'MainPID')
    os.kill(int(pid), 19)  # SIGSTOP
    frozen = time.monotonic()
    stopped = wait_until(lambda: all(prop(f'{name}-{s}.service', 'ActiveState') in ('inactive', 'failed')
                                     for s in ('candidate', 'guard', 'reader')), 60)
    seconds = time.monotonic() - frozen
    entry['observations']['watchdog_stop_seconds'] = round(seconds, 1)
    report.check(entry, 'the watchdog killed the frozen guard and acquisition stopped (within 30 s + 10 s + one sample)',
                 stopped and seconds <= 52, seconds)
    report.check(entry, 'guard result is the watchdog', prop(f'{name}-guard.service', 'Result') == 'watchdog',
                 prop(f'{name}-guard.service', 'Result'))
    systemctl('start', f'{name}-logs.service')
    code, seconds, states = retention_stop(name)
    report.check(entry, 'restarted collector drained within 150 s', code == 0 and seconds < 150, (code, seconds))
    delivery_checks(report, entry, run_id, ('server', 'collector'))


def collector_broken(report, args, interface):
    run_id = 'lp6-broken'; name = 'server2-shadow-' + run_id; root = Path('/opt/server2-shadow') / run_id
    entry = report.scenario('collector-broken', ['LP6-AC3'])
    reset_host(); start_standins(run_id)
    (PEER_STATE / 'provider-status').write_text('200\n')
    # The collector cannot start: its state directory path is taken by a file.
    Path('/var/lib/server2-logs').write_text('blocked\n')
    launch, result, receipt = install(report, entry, args, run_id, interface)
    report.check(entry, 'install with a failing collector: started', receipt is not None and receipt.get('status') == 'started',
                 result.stdout[-500:] + result.stderr[-1500:])
    states = {s: prop(f'{name}-{s}.service', 'ActiveState') for s in ('candidate', 'guard', 'reader')}
    report.check(entry, 'candidate, guard and reader active although the collector failed', set(states.values()) == {'active'}, states)
    time.sleep(5)
    collector = {p: prop(f'{name}-logs.service', p) for p in ('ActiveState', 'SubState', 'Result')}
    entry['observations']['collector'] = collector
    report.check(entry, 'the collector is not running', collector['ActiveState'] != 'active', collector)
    report.check(entry, 'no stop decision', wait_stop(root, 12) is None, decision(root))
    Path('/var/lib/server2-logs').unlink()
    code, seconds, states = retention_stop(name)
    report.check(entry, 'retention stop completes with the collector failed', code == 0 and seconds < 150, (code, seconds, states))


def tampered(report, args, interface):
    run_id = 'lp6-tampered'; name = 'server2-shadow-' + run_id
    entry = report.scenario('tampered', ['LP6-AC5'])
    reset_host(); start_standins(run_id)
    bundle, launch = prepare(args, run_id, interface)
    launch_user_data(launch)
    (bundle / 'render.py').write_text((bundle / 'render.py').read_text() + '\n# changed\n')
    result, _ = receive(bundle, run_id)
    receipt = parsed(result.stdout.decode(errors='replace').strip())
    report.check(entry, 'install refuses a changed collector file', result.returncode != 0 and receipt == {'error': 'invalid or incomplete evidence'},
                 (result.returncode, result.stdout[-300:]))
    report.check(entry, 'nothing installed or started', not (Path('/opt/server2-shadow') / run_id).exists()
                 and not (UNITS_DIR / f'{name}-candidate.service').exists()
                 and prop(f'{name}-candidate.service', 'ActiveState') in ('inactive', ''))


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--disposable-host', action='store_true', required=True)
    parser.add_argument('--server-binary', required=True, type=Path)
    parser.add_argument('--collector-tarball', required=True, type=Path)
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--scenario', action='append', choices=['provider-rejection', 'storage-authorization', 'config-change', 'frozen-guard', 'collector-broken', 'tampered'])
    args = parser.parse_args()
    if os.geteuid() != 0 or sys.platform != 'linux':
        raise SystemExit('run as root on a disposable Linux VM')
    interface = run('ip', 'route', 'show', 'default').stdout.split(' dev ', 1)[1].split()[0]
    report = Report()
    WORK.mkdir(parents=True, exist_ok=True)
    os.chmod(WORK, 0o700)
    setup_network()
    started = time.time()
    try:
        for scenario, function in (('provider-rejection', provider_rejection), ('storage-authorization', storage_authorization),
                                   ('config-change', config_change),
                                   ('frozen-guard', frozen_guard), ('collector-broken', collector_broken), ('tampered', tampered)):
            if args.scenario and scenario not in args.scenario:
                continue
            try:
                function(report, args, interface)
            except Exception as error:  # a scenario failure is a failed check, never a pass
                entry = report.scenario(scenario + '-error', [])
                report.check(entry, 'scenario completed', False, repr(error))
        requests = [json.loads(line) for line in (PEER_STATE / 'requests.jsonl').read_text().splitlines()] if (PEER_STATE / 'requests.jsonl').exists() else []
        observations = {'peer_hosts': sorted({r['host'] for r in requests}), 'egress_rejected_packets': egress_rejected(),
                        'server_binary_sha256': coordinator.artifact_hash(args.server_binary),
                        'collector_tarball_sha256': coordinator.artifact_hash(args.collector_tarball),
                        'source_commit': args.source_commit, 'machine': os.uname().machine, 'seconds': round(time.time() - started)}
    finally:
        reset_host()
        systemctl('stop', *CHECK_UNITS)
        remove_egress_block()
    result = {'passed': report.passed(), 'observations': observations, 'scenarios': report.scenarios}
    args.report.write_text(json.dumps(result, indent=1, sort_keys=True) + '\n')
    print(('PASS' if result['passed'] else 'FAIL') + f": {sum(len(s['checks']) for s in report.scenarios)} checks", flush=True)
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
