#!/usr/bin/env python3
"""Owned loopback native-HTTP rainfall proof; never builds or reaches a cloud endpoint.

Pass an already built, retained rainfall_handover_smoke executable and a new output
folder. The example code injects a fixed clock and provider-denying dependencies into
normal Gateway/DirectRoutes/KmaBackend; this does not test process signals or the
RuntimeServices production factory. Every run/failure and binary hash is retained.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

SERVER2 = Path(__file__).resolve().parents[1]
PATH = '/v000903/kma/addr/%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C/%EC%A2%85%EB%A1%9C%EA%B5%AC/%EC%B2%AD%EC%9A%B4%ED%9A%A8%EC%9E%90%EB%8F%99'
KEY = 'index/v2/statistics/rns/state.json'


def http(url, method='GET', headers=None):
    request = urllib.request.Request(url, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, response.read(), dict(response.headers)
    except urllib.error.HTTPError as error:
        return error.code, error.read(), dict(error.headers)


def pressure_current(current):
    """The selected active pressure response retains core weather and never leaks baseline stats."""
    assert current.get('rn1') == .5 and current.get('pty') == 1, ('pressure core weather', current)
    if 'rnsHit' in current or 'rnsCount' in current:
        assert [current.get('rnsHit'), current.get('rnsCount')] == [3, 5], ('pressure acknowledged counters', current)
        return 'acknowledged3/5'
    assert 'cityMinAws' not in current, ('pressure partial station fields', current)
    return 'stationpartial; rnsHit/rnsCount/cityMinAws absent'



DIAGNOSTIC_PREFIX = b'RAINFALL_DIAGNOSTIC '
DIAGNOSTIC_EVENTS = frozenset((
    'public_enter', 'public_return', 'public_drop', 'public_dropped_pending',
    'prepare_enter', 'prepare_ready', 'prepare_dropped_pending',
    'snapshot_enter', 'snapshot_ready', 'snapshot_dropped_pending',
    'as_of_enter', 'as_of_return', 'assembly_read_enter', 'assembly_read_return',
    'summary_enter', 'summary_return', 'chain_finished', 'chain_check_return', 'store_drop'))


def diagnostic_record(value):
    """Validate bounded owned-example observations without interpreting a phase as success."""
    assert value['schema'] == 1 and value['request_capacity'] == 16 and value['io_capacity'] == 64
    assert value['reason'] in ('response', 'drain', 'terminal', 'control')
    assert all(type(value[field]) is bool for field in ('terminal_candidate', 'terminal_rainfall_drained', 'terminal_recorded_public_inactive'))
    assert type(value['association_invalidated']) is bool
    assert value['request_overflow'] == 0 or value['association_invalidated']
    requests, io = value['requests'], value['server_io']
    assert isinstance(requests, list) and len(requests) <= 16
    assert isinstance(io, list) and len(io) <= 64
    for counter in ('request_overflow', 'io_overflow', 'unassociated_source_calls'):
        assert type(value[counter]) is int and value[counter] >= 0
    for i, request in enumerate(requests):
        assert request['slot'] == i
        assert type(request['active']) is bool and type(request['association_ambiguous']) is bool
        assert type(request['http_status']) is int and 0 <= request['http_status'] <= 599
        assert type(request['source_answer']) is int and 0 <= request['source_answer'] <= 3
        assert type(request['first_read_method']) is int and 0 <= request['first_read_method'] <= 20
        remaining = request['remaining_ns_plus_one']
        assert isinstance(remaining, list) and len(remaining) == 4
        assert all(type(at) is int and 0 <= at < 2**64 for at in remaining)
        events = request['events_ns']
        assert isinstance(events, dict) and set(events) <= DIAGNOSTIC_EVENTS
        assert all(type(at) is int and 0 <= at < 2**64 for at in events.values())
        if value['association_invalidated'] or request['association_ambiguous']:
            assert request['association_ambiguous']
            assert request['http_status'] == request['source_answer'] == request['first_read_method'] == 0
            assert events == {} and remaining == [0, 0, 0, 0]
    for i, event in enumerate(io):
        assert event['slot'] == i and event['method'] in (1, 2, 3)
        assert all(type(event[field]) is int and 0 <= event[field] < 2**64
                   for field in ('start_ns_plus_one', 'end_ns_plus_one'))
        assert type(event['result']) is int and 0 <= event['result'] <= 599
    if value['terminal_candidate']:
        assert value['reason'] == 'terminal' and value['terminal_rainfall_drained'] and value['terminal_recorded_public_inactive']
        assert all(not request['active'] for request in requests)
        slot = value['terminal_drain_io_slot']
        assert type(slot) is int and 0 <= slot < len(io)
        assert io[slot]['method'] == 3 and io[slot]['result'] == 1 and io[slot]['end_ns_plus_one'] > 0
    else:
        assert value['reason'] != 'terminal'
    return value


def terminal_eligibility(records, terminal_children, incomplete=False):
    """Only a final real-drain snapshot plus the runner's closed/reaped sequence can seal a child."""
    last = {record['log']: record['observation'] for record in records}
    result = {}
    for log in sorted(set(last) | set(terminal_children)):
        value, sequence = last.get(log), terminal_children.get(log, {})
        reason = None
        if incomplete:
            reason = 'incomplete/truncated/invalid diagnostic collection'
        elif not value or value['reason'] != 'terminal' or not value['terminal_candidate']:
            reason = 'missing final terminal diagnostic snapshot'
        elif not (sequence.get('no_further_requests') is True and sequence.get('reaped') is True
                  and sequence.get('terminal_http_status') == 200 and sequence.get('terminal_drained') is True
                  and sequence.get('terminal_candidate') is True):
            reason = 'runner terminal drain/sealed request sequence/child reap not verified'
        elif sequence.get('runner_requests') != len(value['requests']) or value['request_overflow']:
            reason = 'request count mismatch or recorder overflow at terminal'
        elif not value['terminal_rainfall_drained'] or not value['terminal_recorded_public_inactive'] or any(request['active'] for request in value['requests']):
            reason = 'terminal lacks real rainfall drain/recorded public inactivity'
        result[log] = {'verified': reason is None, 'reason': reason,
                       'scope': 'observed example trace/rainfall permits only; no global CPU/assembly/wire completion proof'}
    return result


def invalidate_diagnostics(records, terminal_children, incomplete=False):
    """Overflow revokes every snapshot from that child, including already returned raw lines."""
    eligibility = terminal_eligibility(records, terminal_children, incomplete)
    overflowed, ambiguous = set(), {}
    for record in records:
        log, value = record['log'], record['observation']
        if value['association_invalidated'] or value['request_overflow']:
            overflowed.add(log)
        for request in value['requests']:
            if request['association_ambiguous']:
                ambiguous.setdefault(log, set()).add(request['slot'])
    for record in records:
        log, value = record['log'], record['observation']
        terminal = eligibility[log]
        revoke_all = not terminal['verified'] or log in overflowed
        value['terminal_verified'] = terminal['verified']
        value['association_interpretable'] = not revoke_all
        if revoke_all:
            value['association_invalidated'] = True
            value['invalidation_reason'] = terminal['reason'] if not terminal['verified'] else 'request overflow in this child; earlier snapshots revoked'
        for request in value['requests']:
            request['association_interpretable'] = not (revoke_all or request['slot'] in ambiguous.get(log, set()))
            if not request['association_interpretable']:
                request.update(association_ambiguous=True, http_status=0, source_answer=0,
                               first_read_method=0, events_ns={}, remaining_ns_plus_one=[0, 0, 0, 0])
    return records


def collect_diagnostics(output, terminal_children):
    """Keep original logs and bounded snapshots; collection errors never replace a product failure."""
    records, errors = [], []
    scanned = 0
    truncated = False
    files = sorted(output.glob('*.stderr.log'))
    for path in files[:32]:
        with path.open('rb') as log:
            while True:
                line = log.readline(64 * 1024 + 1)
                if not line:
                    break
                scanned += len(line)
                if scanned > 16 * 1024 * 1024:
                    truncated = True
                    break
                if not line.startswith(DIAGNOSTIC_PREFIX):
                    continue
                try:
                    assert len(line) <= 64 * 1024, 'diagnostic line exceeds64KiB'
                    if len(records) == 64:
                        truncated = True
                        break
                    value = diagnostic_record(json.loads(line[len(DIAGNOSTIC_PREFIX):]))
                    records.append({'log': path.name, 'observation': value})
                except (AssertionError, ValueError, KeyError, TypeError) as error:
                    if len(errors) < 8:
                        errors.append({'log': path.name, 'error': str(error)[:160]})
        if truncated:
            break
    incomplete = truncated or len(files) > 32 or bool(errors)
    import copy
    views = copy.deepcopy(records)
    eligibility = terminal_eligibility(records, terminal_children, incomplete)
    invalidate_diagnostics(views, terminal_children, incomplete=incomplete)
    return {'raw_snapshots': records, 'snapshots': views, 'terminal_status': eligibility,
            'errors': errors, 'truncated': truncated or len(files) > 32,
            'interpretation': 'Every request view requires a final real-drain terminal snapshot, all recorded public requests inactive, and the runner closed/reaped/no-further-requests sequence. Absent terminal, incomplete collection or overflow revokes all child views including older lines. Raw snapshots/logs remain unmodified.',
            'bounds': {'logs': 32, 'scan_bytes': 16 * 1024 * 1024, 'snapshots': 64, 'line_bytes': 64 * 1024},
            'limits': 'Terminal is only an observed example trace/rainfall-permit cutoff after the runner seals and reaps this child. Later assembly/Drop/wire completion is not proved. No exact offer return, CPU grant or dispatch timestamp. IO is server-scoped; request overlap is ambiguous.'}



def record_failed_pressure(receipt, original, public, endpoint, http_call, read_state):
    """Best-effort bounded observations must not replace the original public failure."""
    receipt['failure_original_http_error'] = repr(original)
    errors = receipt['failure_diagnostic_errors'] = []
    receipt['failure_drain_scope'] = 'rainfall offer/running permits only; does not prove assembly/wire completion; owned child reap recorded separately'
    try:
        status, body, _ = http_call(public + '__owned/rainfall-drain', method='POST')
        receipt['failure_owner_drain_http_status'] = status
        receipt['failure_owner_drain'] = json.loads(body) if status == 200 else body.decode(errors='replace')
        if status != 200:
            errors.append({'phase': 'drain', 'error': 'HTTP ' + str(status)})
    except Exception as error:
        errors.append({'phase': 'drain', 'error': repr(error)[:300]})
    try:
        failed_state, failed_digest = read_state(endpoint)
        receipt['failure_authority'] = {'revision': failed_state['revision'],
            'first_counters': [failed_state['rows'][0]['rns_hit'], failed_state['rows'][0]['rns_count']],
            'checkpoint_sha256': failed_digest}
    except Exception as error:
        errors.append({'phase': 'authority', 'error': repr(error)[:300]})


def acknowledged_after_drain(server, endpoint, retire, start, request):
    """A real quiesced owner is retired before a fresh child reads the same authority."""
    retire(server)
    successor, public = start(endpoint)
    assert successor is not server, 'after-drain verification requires a fresh native child'
    result = request(public, 'pressure-after-drain', (3, 5))
    return successor, public, result


def diagnostic_controls():
    """Finite synthetic controls, callable explicitly by the coordinator; no processes or HTTP."""
    import copy
    valid = {'schema': 1, 'reason': 'control', 'request_capacity': 16, 'io_capacity': 64,
             'association_invalidated': False, 'terminal_candidate': False, 'terminal_rainfall_drained': False,
             'terminal_recorded_public_inactive': False, 'terminal_drain_io_slot': None,
             'request_overflow': 0, 'io_overflow': 0, 'unassociated_source_calls': 0,
             'requests': [{'slot': 0, 'active': False, 'association_ambiguous': False, 'http_status': 502,
                           'source_answer': 0, 'first_read_method': 0, 'remaining_ns_plus_one': [0, 0, 0, 0],
                           'events_ns': {'public_enter': 0, 'public_return': 3_000_000_000,
                                         'snapshot_dropped_pending': 3_000_000_000}}], 'server_io': []}
    assert diagnostic_record(copy.deepcopy(valid)) == valid
    for change in ('requests', 'server_io', 'event'):
        wrong = copy.deepcopy(valid)
        if change == 'requests': wrong['requests'] *= 17
        elif change == 'server_io': wrong['server_io'] = [{}] * 65
        else: wrong['requests'][0]['events_ns']['invented_cpu_grant'] = 1
        try:
            diagnostic_record(wrong)
        except AssertionError:
            pass
        else:
            raise AssertionError(('must reject invalid diagnostic bounds/event', change))
    events, old, new = [], object(), object()
    endpoint = 'owned-s3-same'
    def retire(child):
        assert child is old
        events.append(('retire', child))
    def start(s3):
        assert events == [('retire', old)] and s3 == endpoint
        events.append(('start', s3))
        return new, 'new-native-public'
    def request(public, name, expected):
        assert events == [('retire', old), ('start', endpoint)]
        assert (public, name, expected) == ('new-native-public', 'pressure-after-drain', (3, 5))
        events.append(('read', public))
        return {'scenario': name, 'http_status': 200}
    successor, public, result = acknowledged_after_drain(old, endpoint, retire, start, request)
    assert successor is new and public == 'new-native-public' and result['http_status'] == 200
    assert [event[0] for event in events] == ['retire', 'start', 'read']
    # A raw line can return before a concurrent overflow. Later overflow must revoke it too.
    before = copy.deepcopy(valid)
    before['requests'][0].update(http_status=200, source_answer=1, first_read_method=3)
    later = copy.deepcopy(valid)
    later['association_invalidated'] = True
    later['request_overflow'] = 1
    later['requests'][0].update(association_ambiguous=True, http_status=0, events_ns={})
    diagnostic_record(later)
    terminal = copy.deepcopy(valid)
    terminal.update(reason='terminal', terminal_candidate=True, terminal_rainfall_drained=True,
                    terminal_recorded_public_inactive=True, terminal_drain_io_slot=0)
    terminal['server_io'] = [{'slot': 0, 'method': 3, 'start_ns_plus_one': 1, 'end_ns_plus_one': 2, 'result': 1}]
    diagnostic_record(terminal)
    sequence = {'no_further_requests': True, 'reaped': True, 'terminal_http_status': 200,
                'terminal_drained': True, 'terminal_candidate': True, 'runner_requests': 1}
    terminal_children = {'other-child.stderr.log': sequence.copy()}
    records = [{'log': 'same-child.stderr.log', 'observation': before},
               {'log': 'same-child.stderr.log', 'observation': later},
               {'log': 'other-child.stderr.log', 'observation': copy.deepcopy(valid)},
               {'log': 'other-child.stderr.log', 'observation': copy.deepcopy(terminal)}]
    invalidate_diagnostics(records, terminal_children)
    assert records[0]['observation']['association_invalidated']
    assert records[0]['observation']['requests'][0]['events_ns'] == {}
    assert records[0]['observation']['requests'][0]['http_status'] == 0
    assert not records[2]['observation']['association_invalidated']
    invalidate_diagnostics(records, terminal_children, incomplete=True)
    assert records[2]['observation']['association_invalidated']
    receipt, original = {}, AssertionError('original pressure HTTP502')
    def failed_http(*args, **kwargs): raise RuntimeError('diagnostic drain failure')
    def failed_state(*args, **kwargs): raise RuntimeError('diagnostic authority failure')
    try:
        try:
            raise original
        except AssertionError as error:
            record_failed_pressure(receipt, error, 'public/', 'same-s3/', failed_http, failed_state)
            raise
    except AssertionError as propagated:
        assert propagated is original
    assert receipt['failure_original_http_error'] == repr(original)
    assert [error['phase'] for error in receipt['failure_diagnostic_errors']] == ['drain', 'authority']
    # A child exit with old apparently valid records is never evidence that no unflushed
    # cancelled overflow occurred. No terminal means every association is unusable.
    missing = [{'log': 'missing.stderr.log', 'observation': copy.deepcopy(valid)}]
    invalidate_diagnostics(missing, {'missing.stderr.log': sequence.copy()})
    assert not missing[0]['observation']['association_interpretable']
    assert missing[0]['observation']['requests'][0]['events_ns'] == {}
    cancelled_history = [{'log': 'cancelled.stderr.log', 'observation': copy.deepcopy(valid)}]
    assert cancelled_history[0]['observation']['request_overflow'] == 0
    invalidate_diagnostics(cancelled_history, {})
    assert cancelled_history[0]['observation']['association_invalidated']
    assert not cancelled_history[0]['observation']['requests'][0]['association_interpretable']
    sealed = [{'log': 'sealed.stderr.log', 'observation': copy.deepcopy(valid)},
              {'log': 'sealed.stderr.log', 'observation': copy.deepcopy(terminal)}]
    invalidate_diagnostics(sealed, {'sealed.stderr.log': sequence.copy()})
    assert all(record['observation']['terminal_verified'] and record['observation']['association_interpretable'] for record in sealed)
    assert sealed[0]['observation']['requests'][0]['events_ns'] == valid['requests'][0]['events_ns']
    return {'controls': 10, 'meaning': 'previous7 +missing-terminal revocation +cancelled-overflow-like unflushed history revocation +valid final real-drain/sealed/reaped terminal; no native execution'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--pressure', choices=['page', 'count', 'rows'], help='Measure exact16MiB physical HTML input profile; no RSS guarantee')
    parser.add_argument('--unit-binary', type=Path, help='Retained cfg(test) executable for explicit same-corpus load-only/Parse-only child measurements')
    args = parser.parse_args()
    if args.unit_binary is not None and not args.pressure:
        parser.error('--unit-binary requires an explicit pressure profile')
    binary = args.binary.resolve(strict=True)
    args.output.mkdir(parents=True, exist_ok=False)
    output = args.output.resolve()
    handles, children, scenarios = [], [], []
    resources = {}
    readers = []
    child_names = {}
    native_children, native_public, terminal_children = {}, {}, {}
    closed_public = set()
    receipt = {'binary': str(binary), 'binary_sha256': hashlib.sha256(binary.read_bytes()).hexdigest(),
               'scenarios': scenarios, 'live_provider_calls': 0, 'mongo_writes': 0, 'child_resources': resources,
               'limitation': 'Code-injected fixed clock/provider denial; normal Gateway/DirectRoutes/KmaBackend TCP path, not RuntimeServices/process signals',
               'runner_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
               'diagnostic_scope': 'Bounded example-only public seams; exact internal offer return/CPU grant unavailable; overlapping request association ambiguous',
               'terminal_children': terminal_children}

    def line_process(command, name, prefix):
        stderr = (output / (name + '.stderr.log')).open('wb')
        handles.append(stderr)
        process = subprocess.Popen(command, cwd=SERVER2, stdout=subprocess.PIPE, stderr=stderr,
                                   text=True, bufsize=1)
        children.append(process)
        child_names[process.pid] = name
        lines = queue.Queue()
        log = (output / (name + '.stdout.log')).open('w')
        handles.append(log)

        def read():
            for line in process.stdout:
                log.write(line)
                log.flush()
                lines.put(line.rstrip())
        reader = threading.Thread(target=read, daemon=True)
        readers.append(reader)
        reader.start()
        end = time.monotonic() + 10
        while time.monotonic() < end:
            try:
                line = lines.get(timeout=.1)
            except queue.Empty:
                if process.poll() is not None:
                    raise AssertionError(f'{name} exited {process.returncode} before readiness')
                continue
            if line.startswith(prefix):
                ready = line[len(prefix):]
                if prefix == 'OWNED_HTTP_READY ':
                    entry = {'runner_requests': 0, 'no_further_requests': False, 'reaped': False,
                             'terminal_http_status': None, 'terminal_drained': False, 'terminal_candidate': False,
                             'errors': [], 'scope': 'final observed example/rainfall trace; child reap separate; no global CPU/assembly/wire completion'}
                    native_children[process.pid] = (ready, entry)
                    closed_public.discard(ready)  # A new PID may reuse a retired child's loopback port.
                    native_public[ready] = entry
                    terminal_children[name + '.stderr.log'] = entry
                return process, ready
        raise AssertionError(f'{name} readiness deadline')

    def retire(process):
        native = native_children.get(process.pid)
        entry = native[1] if native else None
        if entry is not None and not entry['no_further_requests']:
            public = native[0]
            closed_public.add(public)
            entry['no_further_requests'] = True
            if process.returncode is None:
                try:
                    status, body, _ = http(public + '__owned/rainfall-drain', method='POST')
                    entry['terminal_http_status'] = status
                    if status == 200:
                        value = json.loads(body)
                        entry['terminal_drained'] = value.get('drained') is True
                        entry['terminal_candidate'] = value.get('terminal_candidate') is True
                    else:
                        entry['errors'].append('terminal drain HTTP ' + str(status))
                except Exception as error:
                    entry['errors'].append(repr(error)[:300])
            else:
                entry['errors'].append('child exited before final terminal drain')
        if process.returncode is not None:
            if entry is not None: entry['reaped'] = True
            return
        process.terminate()
        try:
            _, status, usage = os.wait4(process.pid, 0)
            process.returncode = os.waitstatus_to_exitcode(status)
            resources[str(process.pid)] = {'name': child_names.get(process.pid), 'max_rss_bytes': usage.ru_maxrss * (1 if sys.platform == 'darwin' else 1024),
                'user_seconds': usage.ru_utime, 'system_seconds': usage.ru_stime,
                'scope': 'actual whole child process peak RSS, not allocation accounting or a64MiB hard bound'}
        except ChildProcessError:
            process.wait(timeout=5)
        if entry is not None:
            entry['reaped'] = process.returncode is not None

    def command(operation, endpoint, name, *tail):
        with (output / (name + '.stdout.log')).open('wb') as stdout, (output / (name + '.stderr.log')).open('wb') as stderr:
            result = subprocess.run([str(binary), operation, endpoint, *tail], cwd=SERVER2,
                                    stdout=stdout, stderr=stderr, timeout=30, check=False)
        assert result.returncode == 0, (name, result.returncode)

    def measure_unit(binary, corpus, phase):
        name = 'physical-' + phase
        selector = 'domestic::kma::source::rainfall_input::tests::measure_owned_pressure_' + phase.replace('-', '_')
        command = [str(binary), selector, '--exact', '--ignored', '--nocapture', '--test-threads=1']
        env = os.environ.copy()
        env['SERVER2_TEST_RAINFALL_CORPUS'] = str(corpus)
        with (output / (name + '.stdout.log')).open('wb') as stdout, (output / (name + '.stderr.log')).open('wb') as stderr:
            process = subprocess.Popen(command, cwd=SERVER2, env=env, stdout=stdout, stderr=stderr)
            children.append(process)
            child_names[process.pid] = name
            begin = time.monotonic()
            while True:
                pid, status, usage = os.wait4(process.pid, os.WNOHANG)
                if pid:
                    process.returncode = os.waitstatus_to_exitcode(status)
                    resources[str(process.pid)] = {'name': name, 'max_rss_bytes': usage.ru_maxrss * (1 if sys.platform == 'darwin' else 1024),
                        'user_seconds': usage.ru_utime, 'system_seconds': usage.ru_stime,
                        'scope': 'actual isolated whole test child peak RSS; load/Parse difference is not exact live heap allocation'}
                    break
                if time.monotonic() - begin > 15:
                    retire(process)
                    raise AssertionError((name, 'actual child retirement deadline'))
                time.sleep(.02)
        text = (output / (name + '.stdout.log')).read_text()
        observations = [json.loads(line.split('rainfall physical measurement: ', 1)[1]) for line in text.splitlines() if 'rainfall physical measurement: ' in line]
        assert process.returncode == 0 and '1 passed' in text and len(observations) == 1, (name, process.returncode)
        return {'argv': command, 'seconds': time.monotonic() - begin, 'observation': observations[0], 'resources': resources[str(process.pid)]}

    def state(endpoint):
        status, body, _ = http(endpoint + 'server2-local/' + KEY, headers={'X-Server2-Test-Key': 'server2-local'})
        assert status == 200, status
        value = json.loads(body)
        digest = hashlib.sha256(body).hexdigest()
        (output / f'checkpoint-{value["revision"]}-{digest}.json').write_bytes(body)
        return value, digest

    def request(endpoint, name, expected=None, partial=False):
        assert endpoint not in closed_public, 'runner may never request a terminal/sealed child again'
        native_public[endpoint]['runner_requests'] += 1
        status, body, headers = http(endpoint + PATH.lstrip('/'))
        (output / (name + '.body')).write_bytes(body)
        (output / (name + '.headers.json')).write_text(json.dumps(headers, indent=2) + '\n')
        assert status == 200, (name, status, body[:300])
        value = json.loads(body)
        current = value['current']
        if expected is not None:
            assert [current.get('rnsHit'), current.get('rnsCount')] == list(expected), (name, current)
        if partial:
            assert 'rnsHit' not in current and 'rnsCount' not in current and 'cityMinAws' not in current
            assert current['rn1'] == .5 and current['pty'] == 1, current
        return {'scenario': name, 'http_status': status, 'body_sha256': hashlib.sha256(body).hexdigest()}

    try:
        peer_command = [sys.executable, 'tests/storage/catalog_peer.py', '--persistent']
        if args.pressure:
            peer_command.append('--rainfall-capacity')
            receipt['owned_peer_profile'] = {'explicit_test_flag': '--rainfall-capacity', 'max_objects': 16384, 'max_store_bytes': 64 * 1024 * 1024, 'max_versions': 512, 'runtime_admission_unchanged': True}
        peer, endpoint = line_process(peer_command, 's3-peer', 'http://')
        endpoint = 'http://' + endpoint
        if args.pressure:
            command('owned-pressure', endpoint, 'pressure-prepare', args.pressure)
            # Retain the same physical identities/bytes even when the selected investigation
            # omits the already measured load-only/Parse-only children.
            corpus = output / 'physical-corpus'
            command('owned-export-pressure', endpoint, 'pressure-export', args.pressure, str(corpus))
            manifest = (corpus / 'manifest.json').read_bytes()
            receipt['physical_corpus'] = {'directory': str(corpus), 'manifest_sha256': hashlib.sha256(manifest).hexdigest()}
            if args.unit_binary is not None:
                unit_binary = args.unit_binary.resolve(strict=True)
                receipt['physical_corpus'].update(unit_binary=str(unit_binary), unit_binary_sha256=hashlib.sha256(unit_binary.read_bytes()).hexdigest())
                receipt['load_only'] = measure_unit(unit_binary, corpus, 'load-only')
                receipt['parse_only'] = measure_unit(unit_binary, corpus, 'parse-only')
            baseline, baseline_public = line_process([str(binary), 'owned-server', endpoint, '1047'], 'pressure-inactive-baseline', 'OWNED_HTTP_READY ')
            begin = time.monotonic()
            try:
                baseline_result = request(baseline_public, 'pressure-inactive-baseline', (3, 4))
                baseline_result['status'] = 'passed inactive original counter control'
            except AssertionError as error:
                baseline_result = {'scenario': 'pressure-inactive-baseline', 'status': 'failed', 'error': repr(error)}
            baseline_result['request_seconds'] = time.monotonic() - begin
            counts = json.loads(http(endpoint + '__catalog/status')[1])
            assert counts.get('PUT ' + KEY, 0) == 0, 'inactive baseline must never create authority'
            baseline_result['rainfall_puts'] = 0
            receipt['inactive_baseline'] = baseline_result
            retire(baseline)
            command('owned-activate', endpoint, 'pressure-activation', args.pressure)
            server, public = line_process([str(binary), 'owned-server', endpoint, '1047'], 'pressure-server', 'OWNED_HTTP_READY ')
            begin = time.monotonic()
            try:
                scenarios.append(request(public, 'pressure'))
            except AssertionError as original_http_error:
                receipt['request_seconds'] = time.monotonic() - begin
                record_failed_pressure(receipt, original_http_error, public, endpoint, http, state)
                raise
            receipt['request_seconds'] = time.monotonic() - begin
            receipt['first_response_statistics'] = pressure_current(json.loads((output / 'pressure.body').read_bytes())['current'])
            current, digest = state(endpoint)
            pair = [current['rows'][0]['rns_hit'], current['rows'][0]['rns_count']]
            assert current['revision'] in (1, 2), current['revision']
            if current['revision'] == 2:
                assert pair == [3, 5], pair
                receipt['pressure_decision'] = 'qualified complete fullwindow allFalse3/5'
            else:
                assert pair == [3, 4], pair
                body = json.loads((output / 'pressure.body').read_bytes())
                assert 'rnsCount' not in body['current'], body['current']
                receipt['pressure_decision'] = 'unavailable/owneddeadline; no authorityincrement; stationpartial'
            status, body, _ = http(public + '__owned/rainfall-drain', method='POST')
            assert status == 200
            receipt['actual_owner_drain'] = json.loads(body)
            assert receipt['actual_owner_drain']['drained'], 'actual owner must retire before successful pressure handoff'
            final_state, final_digest = state(endpoint)
            final_pair = [final_state['rows'][0]['rns_hit'], final_state['rows'][0]['rns_count']]
            receipt['after_drain_authority'] = {'revision': final_state['revision'], 'counters': final_pair, 'checkpoint_sha256': final_digest}
            if final_state['revision'] == 2:
                assert final_pair == [3, 5], final_pair
                server, public, acknowledged = acknowledged_after_drain(
                    server, endpoint, retire,
                    lambda same_s3: line_process([str(binary), 'owned-server', same_s3, '1047'],
                                                 'pressure-after-drain-server', 'OWNED_HTTP_READY '),
                    request)
                receipt['after_drain_sequence'] = 'real drain -> retire old child -> fresh native child/same S3 -> acknowledged read; no reactivation/reset'
                scenarios.append(acknowledged)
            else:
                assert final_state['revision'] == 1 and final_pair == [3, 4], final_state['revision']
            profiles = [json.loads(line) for line in (output / 'pressure-prepare.stdout.log').read_text().splitlines() if line.startswith('{')]
            receipt['physical_profile'] = next(item for item in profiles if item.get('profile') == args.pressure)
            receipt['checkpoint_sha256'] = digest
            receipt['status'] = 'physicaladmitted profile measured; outcome and actualRSS retained; no hardRSS/throughputguarantee'
            return 0
        command('owned-prepare', endpoint, 'prepare')
        server, public = line_process([str(binary), 'owned-server', endpoint, '1047'], 'server-a', 'OWNED_HTTP_READY ')
        scenarios.append(request(public, 'inactive', (3, 4)))
        status, _, _ = http(endpoint + '__catalog/status')
        assert status == 200
        counts = json.loads(http(endpoint + '__catalog/status')[1])
        assert counts.get('PUT ' + KEY, 0) == 0
        command('owned-activate', endpoint, 'activation')
        scenarios.append(request(public, 'qualify', (4, 5)))
        current, digest = state(endpoint)
        assert (current['rows'][0]['rns_hit'], current['rows'][0]['rns_count']) == (4, 5)
        scenarios[-1].update(counters=[4, 5], checkpoint_sha256=digest)
        scenarios.append(request(public, 'repeat', (4, 5)))
        assert state(endpoint)[0]['revision'] == 2
        retire(server)
        server, public = line_process([str(binary), 'owned-server', endpoint, '1048'], 'server-b', 'OWNED_HTTP_READY ')
        scenarios.append(request(public, 'restart', (4, 5)))
        assert state(endpoint)[0]['rows'][0]['rns_count'] == 5
        command('owned-next', endpoint, 'next-hour')
        retire(server)
        server, public = line_process([str(binary), 'owned-server', endpoint, '1147'], 'server-c', 'OWNED_HTTP_READY ')
        scenarios.append(request(public, 'next-false', (4, 6)))
        current, digest = state(endpoint)
        assert (current['rows'][0]['rns_hit'], current['rows'][0]['rns_count']) == (4, 6)
        scenarios[-1].update(counters=[4, 6], checkpoint_sha256=digest)
        status, _, _ = http(endpoint + '__catalog?mode=corrupt&key=' + KEY, method='POST', headers={'X-Server2-Test-Key': 'server2-local'})
        assert status == 204
        scenarios.append(request(public, 'corrupt-partial', partial=True))
        counts = json.loads(http(endpoint + '__catalog/status')[1])
        receipt['s3_counts'] = counts
        assert counts.get('PUT ' + KEY) == 3, counts.get('PUT ' + KEY)
        receipt['request_clocks_kst'] = ['2026-10-17 10:47', '2026-10-17 10:48', '2026-10-17 11:47']
        receipt['input_identities'] = {}
        for file, prefix, label in [('prepare.stderr.log', 'rainfall minute identities: ', 'initial31'), ('next-hour.stderr.log', 'rainfall next minute identities: ', 'next31')]:
            arrays = [json.loads(line[len(prefix):]) for line in (output / file).read_text().splitlines() if line.startswith(prefix)]
            assert len(arrays) == 1 and len(arrays[0]) == 31, (file, len(arrays))
            receipt['input_identities'][label] = arrays[0]
        receipt['status'] = 'completed native HTTP counters/partial sequence; S16 unavailable semantics additionally checked by focused tests'
        return 0
    except BaseException as error:
        receipt['status'] = 'failed'
        receipt['error'] = repr(error)
        raise
    finally:
        for process in reversed(children):
            retire(process)
        receipt['child_exit_codes'] = [process.returncode for process in children]
        for reader in readers:
            reader.join(timeout=2)
        for handle in handles:
            handle.close()
        try:
            receipt['diagnostic_traces'] = collect_diagnostics(output, terminal_children)
        except Exception as diagnostic_error:
            receipt['diagnostic_traces'] = {'collection_error': repr(diagnostic_error)[:300],
                                            'limitation': 'Original product/setup exception is preserved'}
        (output / 'receipt.json').write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + '\n')


if __name__ == '__main__':
    raise SystemExit(main())
