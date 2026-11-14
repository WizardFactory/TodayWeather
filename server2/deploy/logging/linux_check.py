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
TEST_CREDENTIALS = {'AWS_ACCESS_KEY_ID': 'standin-test', 'AWS_SECRET_ACCESS_KEY': 'standin-test',
                    'AWS_EC2_METADATA_DISABLED': 'true'}


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
    """Stop both units and empty the server2 journal namespace and collector state."""
    for unit in ('server2.service', 'server2-logs.service'):
        systemctl('stop', unit, check=False)
        systemctl('reset-failed', unit, check=False)
    # Rotate, then delete every archived file: the namespace keeps running and the
    # new active file is empty. (Restarting the namespace repeatedly trips its start limit.)
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


def delivered(state):
    """Lines received by the stand-in, grouped by destination and source."""
    result = {'s3': collections.defaultdict(list), 'cloudwatch': collections.defaultdict(list)}
    keys, streams = [], []
    for path in sorted((state / 's3').rglob('*')) if (state / 's3').exists() else []:
        if path.is_file():
            key = str(path.relative_to(state / 's3'))
            keys.append(key)
            source = key.split('/')[2] if key.startswith(PREFIX + '/') else '?'
            result['s3'][source] += gzip.decompress(path.read_bytes()).decode().splitlines()
    group_dir = state / 'cloudwatch' / GROUP.strip('/')
    for path in sorted(group_dir.rglob('*.jsonl')) if group_dir.exists() else []:
        stream = str(path.relative_to(group_dir))[:-len('.jsonl')]
        streams.append(stream)
        result['cloudwatch'][stream.split('/')[0]] += [json.loads(l)['message'] for l in path.read_text().splitlines()]
    operations = [json.loads(l) for l in (state / 'operations.jsonl').read_text().splitlines()] \
        if (state / 'operations.jsonl').exists() else []
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


def delivery_scenario(report, name, criteria, sinks, s3_level, cloudwatch_level, burst=0):
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
    # The server stops first. The pause lets the collector read the server's last
    # records: on SIGTERM Vector stops reading at once, so without it those records
    # stay local only. Shipping them at shutdown is LP-4 (#2981), not checked here.
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
    machine = Path('/etc/machine-id').read_text().strip()
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip().replace('-', '')
    for destination, level in (('s3', s3_level), ('cloudwatch', cloudwatch_level)):
        if destination in sinks:
            expected = sorted(l for l in server_lines if server_record_level(l) is not None
                              and render.LEVELS[server_record_level(l)] >= render.LEVELS[level])
            got = sorted(received[destination]['server'])
            check(f'{destination} holds exactly the server records at or above {level}', got == expected,
                  f'expected {len(expected)} got {len(got)}')
            starts = [json.loads(l) for l in received[destination]['collector']]
            check(f'{destination} holds the collector start record',
                  len(starts) == 1 and starts[0]['event'] == 'collector.started' and starts[0]['sinks'] == sinks
                  and starts[0]['collector_version'] == 'vector 0.61.0' and starts[0]['instance_id'] == machine,
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
    allowed = {('s3', 'PutObject'), ('logs', 'DescribeLogStreams'), ('logs', 'CreateLogStream'), ('logs', 'PutLogEvents')}
    used = {(o['service'], o['action']) for o in operations}
    check('only the documented AWS actions were used', used <= allowed, str(sorted(used - allowed)))
    check('no object was overwritten', ('s3', 'Overwrite') not in used)
    text = all_received_text(state) if state.exists() else ''
    check('destinations hold no synthetic sensitive value', SYNTHETIC not in text)
    if remote:
        names = set(vector_environ or {})
        file_names = set(server_env()) - set(render.ALLOWED)
        check('collector environment holds no .env value', vector_environ is not None
              and not any(SYNTHETIC in v for v in vector_environ.values()) and not (names & file_names),
              str(sorted(names)))
        check('collector environment holds only systemd and test credential names',
              names <= SYSTEMD_ENV | set(TEST_CREDENTIALS), str(sorted(names - SYSTEMD_ENV - set(TEST_CREDENTIALS))))
    else:
        result = systemctl('show', '-p', 'ConditionResult', '--value', 'server2-logs.service').stdout.strip()
        check('collector is skipped when only local is selected', result == 'no', result)
        check('local-only start explains that nothing is shipped',
              any('only the local journal is selected' in l for l in collector_lines))
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
    dropin = Path('/etc/systemd/system/server2-logs.service.d/zz-check-credentials.conf')
    dropin.parent.mkdir(parents=True, exist_ok=True)
    dropin.write_text('[Service]\n' + ''.join(f'Environment={k}={v}\n' for k, v in TEST_CREDENTIALS.items()))
    systemctl('daemon-reload')
    setup_tls_and_hosts()
    report = Report()
    delivery_scenario(report, 'local-only', ['AC1', 'AC2'], ['local'], 'info', 'warn')
    delivery_scenario(report, 's3-only', ['AC1', 'AC2', 'AC4', 'AC5'], ['s3'], 'info', 'warn')
    delivery_scenario(report, 'cloudwatch-only', ['AC1', 'AC2', 'AC4', 'AC5'], ['cloudwatch'], 'info', 'warn')
    delivery_scenario(report, 'all-destinations', ['AC1', 'AC2', 'AC4', 'AC5'], ['local', 's3', 'cloudwatch'], 'debug', 'error', burst=300)
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
