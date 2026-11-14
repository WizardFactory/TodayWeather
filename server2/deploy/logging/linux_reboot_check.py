#!/usr/bin/env python3
"""Surviving-disk check of the server2 log pipeline across a real reboot (LP-3, #2980).

Run on the same DISPOSABLE Linux host as linux_check.py (after it installed the pipeline):

  python3 -I linux_reboot_check.py --disposable-host before --report OUT.json
  (reboot the host)
  python3 -I linux_reboot_check.py --disposable-host after --report OUT.json

`before` (S3 fails from the start, so S3 has no saved position) or `before-partial` (S3
confirms the first records, then fails, so its saved position is inside the boot) installs
the instance-metadata and destination stand-ins as boot-time units
(started before the collector), makes S3 fail, writes records, and leaves the host for a
normal reboot: the collector's stop drain then gives up on S3 after its deadline, so the
previous boot's records are still unshipped to S3 when the host comes back.
`after` checks that the collector, started by the boot alone, ships the previous boot's
remainder from where it stopped (under the previous boot's keys) and the new boot's
records, each exactly once, and that a later restart has no backlog left.
"""
import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import linux_check as lc  # noqa: E402

STATE = lc.WORK / 'reboot'
STANDIN_STATE = STATE / 'standin'
IMDS_STATE = STATE / 'imds'
BIN = STATE / 'bin'  # copies on the host disk: a shared folder may mount after these units start


def wait_ready(state):
    """Start-up waits until the stand-in serves, so the collector never starts first."""
    return ("/bin/sh -c 'for i in $(seq 200); do [ -e %s/ready ] && exit 0; sleep 0.1; done; exit 1'" % state)


UNITS = {
    'server2-logging-imds-boot.service': f'''[Unit]
Description=TEST instance metadata stand-in (reboot check)
Before=server2-logs.service
[Service]
ExecStartPre=-/usr/sbin/ip addr add 169.254.169.254/32 dev lo
ExecStartPre=/bin/rm -f {IMDS_STATE}/ready
ExecStart=/usr/bin/python3 -I {BIN}/imds_standin.py --state {IMDS_STATE}
ExecStartPost={wait_ready(IMDS_STATE)}
[Install]
WantedBy=multi-user.target
''',
    'server2-logging-standin-boot.service': f'''[Unit]
Description=TEST S3 and CloudWatch Logs stand-in (reboot check)
Before=server2-logs.service
[Service]
ExecStartPre=/bin/rm -f {STANDIN_STATE}/ready
ExecStart=/usr/bin/python3 -I {BIN}/standin.py --state {STANDIN_STATE} --port 443 --bucket {lc.BUCKET} --log-group {lc.GROUP} --tls-cert {lc.WORK}/tls/srv.crt --tls-key {lc.WORK}/tls/srv.key
ExecStartPost={wait_ready(STANDIN_STATE)}
[Install]
WantedBy=multi-user.target
''',
}


def server_lines_by_boot():
    """Server records at info or above, per boot, from the local journal."""
    out = lc.run('journalctl', '--namespace=server2', '-u', 'server2.service', '-o', 'json', '--no-pager',
                 '--output-fields=MESSAGE,_BOOT_ID').stdout
    result = {}
    for raw in out.splitlines():
        entry = json.loads(raw)
        message = entry.get('MESSAGE')
        if isinstance(message, list):
            message = bytes(message).decode('utf-8', 'replace')
        if lc.server_record_level(message) in ('info', 'warn', 'error'):
            result.setdefault(entry['_BOOT_ID'], []).append(message)
    return result


def boot_id():
    return Path('/proc/sys/kernel/random/boot_id').read_text().strip().replace('-', '')


def before(report, partial=False):
    entry = report.scenario('reboot-before-partial' if partial else 'reboot-before', ['LP3-AC5'])
    check = lambda n, ok, d='': report.check(entry, n, ok, d)
    for unit in ('server2-logging-imds.service', lc.STANDIN_UNIT):
        lc.systemctl('stop', unit, check=False)  # transient units of linux_check
    lc.reset_host()
    shutil.rmtree(STATE, ignore_errors=True)
    IMDS_STATE.mkdir(parents=True)
    BIN.mkdir()
    for name in ('imds_standin.py', 'standin.py'):
        shutil.copy(HERE / name, BIN / name)
    (IMDS_STATE / 'instance-id').write_text(lc.INSTANCE_A + '\n')
    (IMDS_STATE / 'life-cycle').write_text('on-demand\n')
    for name, text in UNITS.items():
        Path('/etc/systemd/system', name).write_text(text)
    lc.systemctl('daemon-reload')
    lc.systemctl('enable', '--now', *UNITS)
    for path in (IMDS_STATE / 'ready', STANDIN_STATE / 'ready'):
        check(f'{path.parent.name} stand-in ready', lc.wait_until(path.exists, 20) is not None)
    if not partial:
        (STANDIN_STATE / 'fail-s3').touch()  # S3 stays down through the reboot
    lc.write_env(lc.logging_env())
    lc.systemctl('start', 'server2-logs.service', 'server2.service')
    check('server healthy', lc.wait_health())
    if partial:
        # S3 confirms the first records, so its saved position is inside this boot.
        for i in range(5):
            lc.http(f'/weather/v000903/coord/31.{i},127.0')
        first = list(server_lines_by_boot().get(boot_id(), []))
        confirmed = lc.wait_until(lambda: set(first) <= set(lc.delivered(STANDIN_STATE)[0]['s3']['server'])
                                  and Path('/var/lib/private/server2-logs/journal_s3/checkpoint.txt').exists(), 120)
        check('S3 confirmed the first records of this boot', confirmed is not None, str(confirmed))
        (STANDIN_STATE / 'fail-s3').touch()  # then S3 fails through the reboot
    for i in range(10):
        lc.http(f'/weather/v000903/coord/30.{i},127.0')
    time.sleep(3)
    lines = server_lines_by_boot().get(boot_id(), [])
    shipped = set(lc.delivered(STANDIN_STATE)[0]['s3']['server'])
    (STATE / 'before.json').write_text(json.dumps({'boot': boot_id()}))
    entry['observations'].update(boot=boot_id(), records=len(lines), s3_confirmed_before_reboot=len(shipped))
    check('records written while S3 fails', len(lines) > 10, str(len(lines)))
    check('S3 lacks part of this boot', len(shipped) < len(lines) and (partial or not shipped), f'{len(shipped)}/{len(lines)}')
    return entry


def after(report):
    entry = report.scenario('reboot-after', ['LP3-AC5'])
    check = lambda n, ok, d='': report.check(entry, n, ok, d)
    old_boot, new_boot = json.loads((STATE / 'before.json').read_text())['boot'], boot_id()
    check('the host rebooted', old_boot != new_boot, f'{old_boot} -> {new_boot}')
    check('the collector was started by the boot alone',
          lc.wait_unit('server2-logs.service', {'active'}, 60) == 'active')
    starts = [json.loads(l) for l in lc.journal('server2-logs.service') if '"collector.started"' in l]
    latest = starts[-1] if starts else {}
    entry['observations']['start_record'] = latest
    check('the start record names the previous boot as backlog for S3',
          old_boot in latest.get('backlog_boots', {}).get('s3', []), json.dumps(latest)[:400])
    check('the start record carries the instance ID from instance metadata',
          latest.get('instance_id') == lc.INSTANCE_A and latest.get('boot_id') == new_boot)
    # The server's own start at boot is outside this check (the test binary may need a
    # translation layer that registers late); start it if the boot did not.
    server_state = lc.wait_unit('server2.service', {'active'}, 30)
    entry['observations']['server_started_by_boot'] = server_state == 'active'
    if server_state != 'active':
        lc.systemctl('reset-failed', 'server2.service', check=False)
        lc.systemctl('start', 'server2.service')
    check('server healthy after the reboot', lc.wait_health())
    for i in range(5):
        lc.http(f'/weather/v000903/coord/29.{i},127.0')
    time.sleep(2)
    lines = server_lines_by_boot()
    old_lines, new_lines = lines.get(old_boot, []), lines.get(new_boot, [])
    entry['observations'].update(old_boot_records=len(old_lines), new_boot_records=len(new_lines))
    check('the journal kept the previous boot\'s records', len(old_lines) > 10, str(len(old_lines)))
    (STANDIN_STATE / 'fail-s3').unlink()  # S3 recovers
    seconds = lc.wait_until(lambda: set(old_lines + new_lines) <= set(lc.delivered(STANDIN_STATE)[0]['s3']['server']), 180)
    entry['observations']['s3_catch_up_seconds'] = seconds
    check('S3 received both boots\' records after it recovered', seconds is not None, str(seconds))
    began = time.monotonic()
    lc.systemctl('stop', 'server2.service', 'server2-logs.service')
    entry['observations']['collector_stop_seconds'] = round(time.monotonic() - began, 1)
    lines = server_lines_by_boot()
    everything = lines.get(old_boot, []) + lines.get(new_boot, [])
    received, keys, _streams, operations = lc.delivered(STANDIN_STATE)
    for destination in ('s3', 'cloudwatch'):
        got = received[destination]['server']
        entry['observations'][f'{destination}_repeats'] = len(got) - len(set(got))
        check(f'{destination}: the records of both boots exactly once', sorted(got) == sorted(everything),
              f'expected {len(everything)} got {len(got)} distinct {len(set(got))}')
    old_keys = [k for k in keys if '/server/' in k and f'/{old_boot}-' in k]
    new_keys = [k for k in keys if '/server/' in k and f'/{new_boot}-' in k]
    old_set = set(lines.get(old_boot, []))
    import gzip
    misplaced = [k for k in old_keys + new_keys
                 if any((l in old_set) != (f'/{old_boot}-' in k)
                        for l in gzip.decompress((STANDIN_STATE / 's3' / k).read_bytes()).decode().splitlines())]
    check('each record is under the keys of the boot that wrote it', old_keys and new_keys and not misplaced,
          f'{len(old_keys)} old, {len(new_keys)} new, {len(misplaced)} misplaced')
    check('no object was overwritten', not any(o['action'] == 'Overwrite' for o in operations))
    lc.systemctl('start', 'server2-logs.service')
    time.sleep(3)
    plan = json.loads(Path('/var/lib/private/server2-logs/backlog.json').read_text())
    check('the next start has no backlog left', not any(plan.values()), json.dumps(plan))
    lc.systemctl('stop', 'server2-logs.service')
    lc.systemctl('disable', '--now', *UNITS, check=False)
    for name in UNITS:
        Path('/etc/systemd/system', name).unlink(missing_ok=True)
    lc.systemctl('daemon-reload')
    return entry


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--disposable-host', action='store_true', required=True)
    parser.add_argument('phase', choices=('before', 'before-partial', 'after'))
    parser.add_argument('--report', required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('run as root on a disposable host')
    report = lc.Report()
    if args.phase == 'after':
        after(report)
    else:
        before(report, partial=args.phase == 'before-partial')
    result = {'passed': report.passed(), 'phase': args.phase, 'scenarios': report.scenarios}
    Path(args.report).write_text(json.dumps(result, indent=1, default=dict) + '\n')
    print('RESULT', 'PASS' if result['passed'] else 'FAIL')
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
