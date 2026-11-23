"""Opt-in driver for a dedicated-key, 24-hour disposable Linux rehearsal."""

from collections import defaultdict
from datetime import datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import re
import socket
import ssl
import subprocess
import sys
import time

import coordinator
import guard
from rehearsal_deadline import arm_startup_stop, arm_stop
from rehearsal_inputs import _check_environment, _read_private, validated_config
from rehearsal_measurement import write_measurement
from rehearsal_network import DENIALS, PROVIDER, TABLE, enforce_network, plan_network
from rehearsal_observation import ObserveHost, OperationCounts
from rehearsal_projection import DAY
from rehearsal_schedule import collect_day
import state


RUN_ID = 'sr6-rehearsal'
NAME = 'server2-shadow-' + RUN_ID
STARTUP_MARGIN = 360
START_LEAD = 5
KST = timezone(timedelta(hours=9))
WORKLOAD = tuple(f'{NAME}-{kind}.service' for kind in ('candidate', 'reader', 'guard'))
PREFLIGHT_ERRORS = (OSError, ValueError, OverflowError, KeyError, TypeError, SystemExit)
HOST_ERRORS = (OSError, ValueError, OverflowError, KeyError, IndexError, RuntimeError,
               subprocess.SubprocessError, SystemExit, KeyboardInterrupt)
TEST_CA = Path('/usr/local/share/ca-certificates/server2-shadow-check.crt')
INPUT_FIELDS = {
    'schema', 'config_file', 'dedicated_key_file', 'reader_file', 'artifact_sha256',
    'daily_calls', 'allowance', 'cost_policy', 'paid_policy', 'native_families',
}


def read_inputs(args, host):
    spec = json.loads(_read_private(args.rehearsal_input))
    if type(spec) is not dict or spec.keys() != INPUT_FIELDS or type(spec['schema']) is not int or spec['schema'] != 1:
        raise ValueError('invalid rehearsal plan schema')
    paths = {}
    for field in ('config_file', 'dedicated_key_file', 'reader_file'):
        value = spec[field]
        if type(value) is not str or not value:
            raise ValueError('invalid rehearsal input file')
        paths[field] = args.rehearsal_input.parent / value
    pins = spec['artifact_sha256']
    if (type(pins) is not dict or pins.keys() != {'server', 'collector'}
            or any(type(pin) is not str or not re.fullmatch('[0-9a-f]{64}', pin) for pin in pins.values())):
        raise ValueError('invalid rehearsal artifact hashes')
    for name, path in (('server', args.server_binary), ('collector', args.collector_tarball)):
        if path.is_symlink() or not path.is_file() or coordinator.artifact_hash(path) != pins[name]:
            raise ValueError('rehearsal artifact hash mismatch')

    reader = json.loads(_read_private(paths['reader_file']))
    sys.path.insert(0, str(host.SERVER2 / 'tools/shadow'))
    try:
        import paired_read
    finally:
        sys.path.pop(0)
    paired_read.validate(reader, 'http://127.0.0.1:3000', paired_read.PRODUCTION)
    if reader['candidate_sha256'] != pins['server'] or reader['duration_seconds'] < DAY + START_LEAD + 10:
        raise ValueError('reader does not cover the bound candidate and day')

    config, quota_caps, receipt = validated_config(
        paths['config_file'], paths['dedicated_key_file'],
        daily_calls=spec['daily_calls'], environment={'SERVER2_NATIVE_FAMILIES': ','.join(spec['native_families'])},
    )
    # The runtime advances the authority in 50-unit blocks before issuing requests.
    if not any(row['planned'] >= 50 and row['api'].startswith('B552584/') for row in receipt['daily_calls']):
        raise ValueError('no approved AirKorea calls')
    if not any(row['planned'] >= 50 and not row['api'].startswith('B552584/') for row in receipt['daily_calls']):
        raise ValueError('no approved KMA calls')
    if state.validate_cost_policy(spec['cost_policy'], int(time.time()))['ceiling'] != 300:
        raise ValueError('rehearsal requires the frozen 300 USD ceiling')
    return spec | {'config': config, 'reader': reader, 'quotas': quota_caps, 'preflight': receipt}


def confirm_quota_days(rows, earliest, end):
    """Require explicit per-API reservations for every KST date acquisition could touch."""
    first = datetime.fromtimestamp(earliest, KST).date()
    last = datetime.fromtimestamp(end, KST).date()
    days = {(first + timedelta(days=i)).isoformat() for i in range((last - first).days + 1)}
    api_days = defaultdict(set)
    for row in rows:
        api_days[row['api']].add(row['kst_day'])
    if any(covered != days for covered in api_days.values()):
        raise ValueError('quota plan does not cover the actual KST dates')


def _resolve(run_command, name, *, ipv4_only=False):
    output = run_command('getent', 'ahostsv4' if ipv4_only else 'ahosts', name, timeout=10).stdout
    return sorted({line.split()[0] for line in output.splitlines() if line.strip()})


def _tls(context, address, name):
    with socket.create_connection((address, 443), timeout=5) as tcp:
        with context.wrap_socket(tcp, server_hostname=name):
            return True


def denial_probes(run_command):
    def counts():
        result = run_command('nft', '-j', 'list', 'chain', 'inet', TABLE, 'output', timeout=5)
        counters = {}
        for item in json.loads(result.stdout)['nftables']:
            rule = item.get('rule', {})
            tag = rule.get('comment')
            if tag in DENIALS:
                counters[tag] = next(expr['counter']['packets'] for expr in rule['expr'] if 'counter' in expr)
        if counters.keys() != DENIALS:
            raise ValueError('expected independent egress counters')
        return counters

    before = counts()
    for family, kind, address in ((socket.AF_INET, socket.SOCK_STREAM, '192.0.2.1'),
                                  (socket.AF_INET, socket.SOCK_DGRAM, '192.0.2.1'),
                                  (socket.AF_INET6, socket.SOCK_STREAM, '::1')):
        with socket.socket(family, kind) as probe:
            probe.settimeout(0.5)
            try:
                probe.connect((address, 9))
                if kind == socket.SOCK_DGRAM:
                    probe.send(b'blocked-rehearsal-probe')
            except OSError:
                pass
    after = counts()
    return {tag: after[tag] > before[tag] for tag in DENIALS}


def _systemd(host, *args, check=True, timeout=10):
    return host.run('systemctl', *args, check=check, timeout=timeout)


def _states(host, units):
    return {
        unit: _systemd(host, 'show', '--property=ActiveState', '--value', unit, timeout=5).stdout.strip()
        for unit in units
    }


def _confirm_stopped(host, seconds=35):
    return host.wait_until(lambda: all(status in ('failed', 'inactive')
                                     for status in _states(host, WORKLOAD).values()), seconds, 0.5) is True


def _request_stop(host):
    return _systemd(host, 'start', '--no-block', f'{NAME}-stop.service', check=False).returncode == 0


def _drain_collector(host):
    unit = f'{NAME}-logs.service'
    invocation = _systemd(host, 'show', '-p', 'InvocationID', '--value', unit).stdout.strip()
    stop = _systemd(host, 'stop', unit, check=False, timeout=105)
    if stop.returncode or not re.fullmatch('[0-9a-f]{32}', invocation):
        return False
    result = host.run('journalctl', '--namespace=server2', '-u', unit, f'_SYSTEMD_INVOCATION_ID={invocation}',
                      '--grep=collector[.]drained', '-o', 'cat', '-n', '1', '--no-pager', timeout=5)
    record = host.parsed(result.stdout.strip()) or {}
    destinations = record.get('destinations')
    return (record.get('event') == 'collector.drained' and isinstance(destinations, dict)
            and set(destinations) == {'s3'} and isinstance(destinations['s3'], dict)
            and destinations['s3'].get('drained') is True)


def _deadline_ran(host):
    result = _systemd(host, 'show', '--property=LastTriggerUSecMonotonic', '--value',
                      f'{NAME}-deadline.timer', check=False, timeout=5)
    return result.returncode == 0 and result.stdout.strip() not in ('', '0', 'n/a')


def _clock():
    return time.clock_gettime(time.CLOCK_BOOTTIME)


def _prepare_output(args, host):
    out = args.output_dir
    if args.report.parent.resolve() != out.resolve() or args.report.name in {'measurement.json', 'finish'}:
        raise ValueError('report must be an unused file within the new rehearsal output directory')
    if out.resolve().is_relative_to(host.WORK.resolve()) or out.resolve().is_relative_to(host.INSTALL_ROOT.resolve()):
        raise ValueError('rehearsal output must be outside installed host and fixture paths')
    out.mkdir(mode=0o700, exist_ok=False)


def _snapshot_hashes(bundle):
    return {key: coordinator.artifact_hash(bundle / name) for key, name in {
        'server': 'server2', 'collector': 'collector.tar.gz', 'launch': 'launch.json', 'reader': 'reader.json',
    }.items()}


def _run_isolated(args, host, bundle, launch, spec, output, report, operations, started):
    root = host.INSTALL_ROOT / RUN_ID
    fingerprint = _snapshot_hashes(bundle)
    if not args.source_commit or host.launch_user_data(launch).returncode != 0:
        raise ValueError('failed to arm original host deadline')
    startup_deadline = math.ceil(_clock()) + STARTUP_MARGIN
    now = int(time.time())
    confirm_quota_days(spec['preflight']['daily_calls'], now, now + STARTUP_MARGIN + START_LEAD + DAY)
    arm_startup_stop(RUN_ID, deadline=startup_deadline, boottime=_clock, run=host.run)
    started[0] = True
    result, elapsed = host.receive(bundle, RUN_ID)
    # Do not expose the receiver's raw diagnostics for a credentialed bundle.
    receipt = host.parsed(result.stdout.decode(errors='replace').strip())
    if result.returncode != 0 or not receipt or (receipt.get('status') != 'started'
            or receipt.get('launch_sha256') != fingerprint['launch']):
        raise ValueError('rehearsal host binding failed')
    output['install_seconds'] = round(elapsed, 1)
    output['original_deadlines'] = {key: launch['epoch'] + hours * 3600
                                    for key, hours in [('collection_end', 168), ('host_end', 170)]}
    output['artifact_sha256'] = fingerprint
    output['candidate_cases'] = spec['reader']['cases']
    if _clock() >= startup_deadline - START_LEAD:
        raise ValueError('host installation missed the startup deadline')
    start = math.ceil(_clock()) + START_LEAD
    wall_start = round(time.time() + start - _clock())
    if wall_start % 86400 == 0 or (wall_start + 9 * 3600) % 86400 == 0:
        raise ValueError('rehearsal must cross both midnights within the measured hours')
    end = arm_stop(RUN_ID, start_monotonic=start, boottime=_clock, run=host.run)
    output['deadline_boot_seconds'] = end
    output['deadline_utc_epoch'] = wall_start + DAY
    _systemd(host, 'stop', f'{NAME}-startup-deadline.timer')
    deadline_confirmed = False

    def finish_collection():
        nonlocal deadline_confirmed
        if _clock() >= end:
            deadline_confirmed = host.wait_until(lambda: _deadline_ran(host), 5, 0.25) is True
        # Ensure bounded local stop even if the independent timer could not be confirmed.
        return deadline_confirmed or _request_stop(host)

    def publish(measurement):
        # Publish incomplete checkpoints until stop, retrieval, and artifact binding all pass.
        write_measurement(args.output_dir / 'measurement.json', dict(measurement, complete=False),
                          run_id=RUN_ID, source_commit=args.source_commit, artifact_sha256=fingerprint)

    collector = ObserveHost(json.loads((root / 'state/guard.json').read_bytes()), operations)
    measured = collect_day(
        observe=collector, running=lambda: all(s == 'active' for s in _states(host, WORKLOAD).values()),
        request_stop=finish_collection, publish=publish, monotonic=_clock, anchor=(start, wall_start),
    )
    checks = report.scenario('24-hour-rehearsal', ['SR6-AC2'])
    report.check(checks, 'hourly observations cover the full day', measured['complete'])
    report.check(checks, 'independent boot timer invoked the real stop unit', deadline_confirmed)
    stopped = _confirm_stopped(host)
    report.check(checks, 'candidate, guard and reader have stopped', stopped)
    output['unit_states'] = _states(host, WORKLOAD)
    decision = host.decision(root) or {}
    reason = decision.get('stop')
    if isinstance(reason, str) and re.fullmatch('[a-z0-9_]{1,50}', reason):
        output['guard_stop_reason'] = reason
    if stopped:
        final = host.wait_final(RUN_ID, 620)
        report.check(checks, 'the actual reader stop produced a final evidence generation', final is not None)
        if final is not None:
            output['final_index'] = {name: final.get(name) for name in ('generation', 'kind', 'reader', 'attempts')}
            report.check(checks, 'collector drain finished', _drain_collector(host))
            audit = host.bucket_audit(report, checks, RUN_ID)
            if audit['complete']:
                output['failed_phase'] = 'finish-export'
                previous_checks = len(checks['checks'])
                host.finish_cli_check(report, checks, RUN_ID, output=args.output_dir / 'finish', include_originals=True)
                if all(item['passed'] for item in checks['checks'][previous_checks:]):
                    del output['failed_phase']
    return measured, fingerprint


def run(args, host):
    """Drive the real guest units; emit sanitized incomplete evidence for any failed phase."""
    stage = 'output-path'
    output = {'schema': 1, 'status': 'incomplete', 'run_id': RUN_ID, 'source_commit': args.source_commit,
              'storage': 'loopback-standin', 'comparison_origin': 'loopback-standin', 'cloud': 'fixture-only'}
    report = host.Report()
    try:
        _prepare_output(args, host)
    except (OSError, ValueError):
        print('INCOMPLETE rehearsal output-path', flush=True)
        return 1

    start_attempted = [False]
    fixture_started = False
    verified = None
    try:
        stage = 'private-preflight'
        try:
            spec = read_inputs(args, host)
        except PREFLIGHT_ERRORS:
            raise ValueError('rehearsal preflight refused') from None
        output['preflight'] = spec['preflight']
        output['price_snapshot_sha256'] = spec['cost_policy']['prices_sha256']
        output['attribution'] = {'provider_requests_by_api': 'unavailable',
                                 'cloud_original_versions': 'fixture-synthesized-latest-only'}
        stage = 'disposable-host-preflight'
        work = host.WORK / 'runs' / RUN_ID
        if (work.exists() or work.is_symlink() or (host.INSTALL_ROOT / RUN_ID).exists()
                or host.STANDIN_STATE.exists()
                or TEST_CA.exists()
                or any(host.UNITS_DIR.glob('server2-shadow-*.service'))):
            raise ValueError('rehearsal requires a fresh disposable guest')
        interface = host.run('ip', 'route', 'show', 'default', timeout=5).stdout.split(' dev ', 1)[1].split()[0]
        provider_pins = _resolve(host.run, PROVIDER, ipv4_only=True)
        plan = plan_network(RUN_ID, interface, provider_pins, [name for name in host.PROVIDERS if name != PROVIDER])
        # Capture public trust before introducing any fixture certificates.
        public_trust = ssl.create_default_context()
        stage = 'host-artifacts'
        host.WORK.mkdir(mode=0o700, exist_ok=False)
        bundle, launch = host.prepare(args, RUN_ID, interface, rehearsal=spec)
        storage = os.statvfs(host.WORK)
        output['guest'] = {'machine': os.uname().machine, 'nproc': os.cpu_count(),
                           'filesystem_capacity_bytes': storage.f_blocks * storage.f_frsize,
                           'filesystem_available_bytes': storage.f_bavail * storage.f_frsize}
        _check_environment(coordinator.candidate_environment(launch))
        quota_file = work / 'quota-caps.json'
        guard.save(quota_file, spec['quotas'])
        stage = 'loopback-fixtures'
        fixture_started = True
        host.setup_test_tls(plan.standin_tls_names)
        host.start_standins(RUN_ID, quota_file=quota_file)
        loopback_trust = ssl.create_default_context(cafile=str(host.TLS / 'ca.crt'))
        operations = OperationCounts(host.STANDIN_STATE / 'operations.jsonl', state_bucket=NAME + '-state')

        def release():
            if not start_attempted[0] or _confirm_stopped(host, seconds=0):
                return True
            _request_stop(host)
            _systemd(host, 'stop', *WORKLOAD, check=False, timeout=35)
            # Stop propagation or unreadable status must keep the egress block in place.
            return _confirm_stopped(host)

        stage = 'disposable-network-binding'
        with enforce_network(
            plan, disposable_host=args.disposable_host, start=args.rehearsal_hours == 24, hosts_path=Path('/etc/hosts'),
            run=host.run, resolve=lambda name: _resolve(host.run, name), inspect_denials=lambda: denial_probes(host.run),
            verify_loopback_tls=lambda address, name: _tls(loopback_trust, address, name),
            verify_provider_tls=lambda address, name: _tls(public_trust, address, name), release=release,
            retain_until_poweroff=True,
        ) as network:
            output['network'] = network
            stage = 'installed-rehearsal'
            measured, fingerprint = _run_isolated(args, host, bundle, launch, spec, output, report, operations, start_attempted)
        if report.passed() and measured['complete']:
            verified = measured, fingerprint
        else:
            output.setdefault('failed_phase', 'verification')
    except HOST_ERRORS:
        output.setdefault('failed_phase', stage)
    finally:
        if fixture_started:
            try:
                _systemd(host, 'stop', *host.CHECK_UNITS, timeout=20)
                if TEST_CA.exists():
                    if TEST_CA.read_bytes() != (host.TLS / 'ca.crt').read_bytes():
                        raise ValueError('rehearsal CA changed')
                    TEST_CA.unlink()
                    host.run('update-ca-certificates', timeout=60)
            except (OSError, ValueError, subprocess.SubprocessError):
                output['failed_phase'] = 'fixture-shutdown'
        if verified and 'failed_phase' not in output:
            try:
                measured, fingerprint = verified
                write_measurement(args.output_dir / 'measurement.json', measured, run_id=RUN_ID,
                                  source_commit=args.source_commit, artifact_sha256=fingerprint)
                output['status'] = 'complete'
            except (OSError, ValueError):
                output['failed_phase'] = 'publish-measurement'
        output['scenarios'] = report.scenarios
        guard.save(args.report, output)
    print(output['status'].upper() + ' rehearsal', flush=True)
    return 0 if output['status'] == 'complete' else 1
