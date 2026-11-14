#!/usr/bin/env python3
"""Fresh-host check of the boot configuration (LP-3, #2980), on a NEW disposable Linux VM.

  python3 -I linux_fresh_check.py --disposable-host --user-data DIR/user-data.sh.gz \\
      --server-binary PATH --report OUT.json

The VM has nothing of server2 installed. The check prepares only the test surroundings
(instance-metadata stand-in with an instance role, destination stand-ins behind the real
AWS host names), then runs the generated user data as root, as cloud-init does at first
boot, and checks that the collector is installed (pinned release downloaded and verified),
started and shipping from its first record with instance-role credentials only: no SSH
step and no AWS key on the host. The release procedure then installs server2 and its
.env; the server's records from its first one reach the destinations exactly once.
The user data must be generated for local,s3,cloudwatch with linux_check's bucket,
prefix and group, for a commit that is on GitHub (the files are downloaded from it).
"""
import argparse
import gzip
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import linux_check as lc  # noqa: E402
import render  # noqa: E402

STATE = lc.WORK / 'standin-fresh'


def check_fresh(report):
    entry = report.scenario('fresh-host-boot-configuration', ['LP3-AC1', 'LP3-AC3'])
    return entry, (lambda n, ok, d='': report.check(entry, n, ok, d))


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--disposable-host', action='store_true', required=True)
    parser.add_argument('--user-data', required=True)
    parser.add_argument('--server-binary', required=True)
    parser.add_argument('--report', required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('run as root on a disposable host')
    report = lc.Report()
    entry, check = check_fresh(report)
    check('nothing of server2 is installed yet', not Path('/opt/server2').exists()
          and not Path('/etc/systemd/system/server2-logs.service').exists())
    lc.WORK.mkdir(parents=True, exist_ok=True)
    lc.setup_tls_and_hosts()
    lc.setup_imds()  # instance i-0c0ffee0000000001, On-Demand, instance role tw-server2-runtime
    lc.start_standin(STATE)
    script = gzip.decompress(Path(args.user_data).read_bytes())
    began = time.monotonic()
    result = subprocess.run(['bash', '-s'], input=script, capture_output=True)
    entry['observations'].update(user_data_bytes=len(script), user_data_seconds=round(time.monotonic() - began, 1),
                                 user_data_tail=result.stdout.decode(errors='replace').splitlines()[-2:])
    check('the user data ran to completion as root', result.returncode == 0, result.stderr.decode(errors='replace')[-500:])
    check('the collector was downloaded and verified against the pin',
          lc.run('/opt/server2/logging/vector', '--version', check=False).stdout.startswith('vector 0.61.0'))
    for unit in ('server2.service', 'server2-logs.service', 'server2-logs-status.timer'):
        check(f'{unit} is enabled for every boot', lc.systemctl('is-enabled', unit, check=False).stdout.strip() == 'enabled')
    check('the collector is running', lc.wait_unit('server2-logs.service', {'active'}, 30) == 'active')
    starts = [json.loads(l) for l in lc.journal('server2-logs.service') if '"collector.started"' in l]
    entry['observations']['start_record'] = starts[-1] if starts else None
    check('the start record names the instance from instance metadata',
          len(starts) == 1 and starts[0]['instance_id'] == lc.INSTANCE_A and starts[0]['instance_life_cycle'] == 'on-demand'
          and starts[0]['sinks'] == ['local', 's3', 'cloudwatch'], json.dumps(starts)[:300])
    pid = lc.systemctl('show', '-p', 'MainPID', '--value', 'server2-logs.service').stdout.strip()
    environ = dict(i.decode().split('=', 1) for i in Path(f'/proc/{pid}/environ').read_bytes().split(b'\0') if b'=' in i)
    names = set(environ)
    entry['observations']['collector_environment'] = sorted(names)
    check('the collector environment holds no AWS key, only systemd names and the destination settings',
          names <= lc.SYSTEMD_ENV | set(render.ALLOWED) and not any(n.startswith('AWS_') for n in names), str(sorted(names)))
    check('no AWS credentials file on the host', not any(Path(p).exists() for p in ('/root/.aws', '/etc/aws')))
    # The release procedure: server binary and .env (no logging names in it), then start.
    shutil.copy(args.server_binary, '/opt/server2/bin/server2')
    os.chmod('/opt/server2/bin/server2', 0o755)
    lc.write_env(lc.server_env())
    lc.systemctl('start', 'server2.service')
    check('server healthy', lc.wait_health())
    for i in range(5):
        lc.http(f'/weather/v000903/coord/33.{i},126.5')
    lc.systemctl('stop', 'server2.service')
    began = time.monotonic()
    lc.systemctl('stop', 'server2-logs.service')  # the stop drain ships the rest
    entry['observations']['collector_stop_seconds'] = round(time.monotonic() - began, 1)
    lc.systemctl('stop', lc.STANDIN_UNIT)
    server_lines = lc.journal('server2.service')
    received, keys, streams, operations = lc.delivered(STATE)
    first = next((l for l in server_lines if lc.server_record_level(l)), None)
    for destination, level in (('s3', 'info'), ('cloudwatch', 'warn')):
        expected = sorted(l for l in server_lines if lc.server_record_level(l) is not None
                          and render.LEVELS[lc.server_record_level(l)] >= render.LEVELS[level])
        got = sorted(received[destination]['server'])
        check(f'{destination} holds every server record at or above {level}, from the first, exactly once',
              got == expected and bool(expected), f'expected {len(expected)} got {len(got)}')
        check(f'{destination} holds the collector start record',
              any('"collector.started"' in l for l in received[destination]['collector']))
    entry['observations'].update(first_server_record=first and json.loads(first).get('event'), s3_keys=len(keys),
                                 cloudwatch_streams=streams)
    check('every request was signed with the instance-role key from instance metadata',
          operations and all(o['key_id'] == lc.STANDIN_KEY_ID for o in operations if o['action'] != 'Unavailable'),
          str({o['key_id'] for o in operations}))
    imds = [json.loads(l) for l in (lc.IMDS_STATE / 'requests.jsonl').read_text().splitlines()]
    check('instance metadata was read with IMDSv2 tokens only', imds and all(r.get('token') or r.get('token_request') for r in imds))
    environment = {'kernel': lc.run('uname', '-srm').stdout.strip(),
                   'systemd': lc.run('systemctl', '--version').stdout.splitlines()[0],
                   'os': Path('/etc/os-release').read_text().split('PRETTY_NAME=')[1].splitlines()[0].strip('"')}
    out = {'passed': report.passed(), 'environment': environment, 'scenarios': report.scenarios}
    Path(args.report).write_text(json.dumps(out, indent=1, default=dict) + '\n')
    print('RESULT', 'PASS' if out['passed'] else 'FAIL')
    return 0 if out['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
