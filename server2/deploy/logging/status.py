#!/usr/bin/env python3
"""Collector loss visibility (LP-2, #2979): status records and journal overrun detection.

Prints collector records (collector_schema 1) to stdout. They land in the server2
journal namespace and the collector ships them to every remote destination, at
every level, like the start record.

  status.py start    collector start (ExecStartPre, before Vector reads):
                     report records that left the journal before they were shipped
  status.py periodic server2-logs-status.timer, every 60 s while the collector runs:
                     per-destination counters from the loopback metrics endpoint,
                     plus the same overrun check

A journal overrun is detected from each destination's checkpoint: when the oldest
entry still in the server2 namespace is newer than the next entry the reader
needs, the entries in between were rotated away undelivered. Each gap is
reported once; the cumulative count per destination persists in the collector
state directory. Records contain counts and times only.
"""
import argparse
import datetime
import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

METRICS_URL = 'http://127.0.0.1:9598/metrics'
DESTINATIONS = ('s3', 'cloudwatch')
# The units the collector's readers include (render.UNITS). Positions are compared only
# with their entries: journald's own lines in the namespace ("Journal started/stopped")
# are never read, so a reader can never reach them.
READ_UNITS = ('server2.service', 'server2-logs.service', 'server2-logs-status.service')
UNIT_MATCHES = [f'_SYSTEMD_UNIT={unit}' for unit in READ_UNITS]
COLLECTOR_SCHEMA = 1
_SAMPLE = re.compile(r'^(\w+)\{([^}]*)\}\s+([0-9.eE+-]+)(?:\s+\d+)?$')


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%fZ')


def iso(realtime_usec):
    return datetime.datetime.fromtimestamp(realtime_usec / 1e6, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%fZ')


def parse_cursor(cursor):
    """journald cursor 's=<id>;i=<seq hex>;b=..;m=..;t=<realtime hex>;x=..' -> (id, seq, realtime)."""
    fields = dict(part.split('=', 1) for part in cursor.strip().split(';') if '=' in part)
    return fields['s'], int(fields['i'], 16), int(fields['t'], 16)


# A destination is behind when its oldest unconfirmed record is older than twice its
# normal delivery window (S3 objects close every 60 s; CloudWatch batches within 1-10 s).
BEHIND_SECONDS = {'s3': 120, 'cloudwatch': 20}


class JournalError(Exception):
    """journalctl failed; distinct from an empty result (CX-LP2-004)."""


def _first_cursor(arguments):
    """Cursor of the first entry journalctl prints, None when it prints none."""
    process = subprocess.Popen(['journalctl', *arguments, '-o', 'json', '--output-fields=__CURSOR'],
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    line = process.stdout.readline()
    if line.strip():
        process.kill()
        process.wait()
        return json.loads(line)['__CURSOR']
    process.wait(timeout=30)
    if process.returncode != 0:
        raise JournalError('journalctl failed')
    return None


def first_entry_after(cursor, namespace='server2'):
    return _first_cursor([f'--namespace={namespace}', f'--after-cursor={cursor}', *UNIT_MATCHES])


def oldest_entry(namespace='server2'):
    return _first_cursor([f'--namespace={namespace}'])


def first_entry_of_current_boot(namespace='server2'):
    """Where a reader without a checkpoint starts: it reads the current boot from its start."""
    return _first_cursor([f'--namespace={namespace}', '--boot', *UNIT_MATCHES])


def newest_entry(namespace='server2', timeout=30):
    result = subprocess.run(['journalctl', f'--namespace={namespace}', '-o', 'json', '--output-fields=__CURSOR', '-n', '1',
                             *UNIT_MATCHES], capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise JournalError('journalctl failed')
    lines = [l for l in result.stdout.splitlines() if l.strip()]
    return json.loads(lines[-1])['__CURSOR'] if lines else None


def checkpoint(state_dir, destination, source=None):
    try:
        return (Path(state_dir) / (source or f'journal_{destination}') / 'checkpoint.txt').read_text().strip() or None
    except FileNotFoundError:
        return None


def journal_boots(namespace='server2'):
    """Boot IDs of the namespace, oldest first."""
    result = subprocess.run(['journalctl', f'--namespace={namespace}', '--list-boots', '--no-pager', '-q'],
                            capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        raise JournalError('journalctl --list-boots failed')
    return [m.group(1) for m in re.finditer(r'^\s*-?\d+\s+([0-9a-f]{32})\b', result.stdout, re.M)]


def current_boot():
    return Path('/proc/sys/kernel/random/boot_id').read_text().strip().replace('-', '')


def boot_of(cursor):
    return dict(part.split('=', 1) for part in cursor.strip().split(';') if '=' in part).get('b')


def backlog_plan(state_dir):
    """The earlier-boot plan written by render.py (LP-3), rotated items included."""
    try:
        return json.loads((Path(state_dir) / 'backlog.json').read_text())
    except (FileNotFoundError, ValueError):
        return {}


def backlog(state_dir, boots=None):
    """Earlier-boot readers still shipping. A boot that left the journal (rotated, possibly
    while the collector runs) has no reader any more: it is never queried (GEM-LP3-001);
    its loss is reported by the overrun check."""
    plan = backlog_plan(state_dir)
    if not any(plan.values()):
        return {}
    boots = journal_boots() if boots is None else boots
    return {d: [i for i in items if not i.get('rotated') and i['boot'] in boots] for d, items in plan.items()}


def item_position(state_dir, item):
    """(sequence ID, first sequence number needed, realtime) of a backlog reader, or None."""
    text = checkpoint(state_dir, None, item['source'])
    if text:
        seq_id, seq, realtime = parse_cursor(text)
        return seq_id, seq + 1, realtime
    return tuple(item['needed']) if item.get('needed') else None


def main_position(state_dir, destination, previous, plan):
    """(sequence ID, first sequence number needed, realtime) of the current-boot reader.

    When its checkpoint (or baseline) is in an earlier boot that a backlog reader ships,
    the current-boot reader has confirmed nothing of this boot yet and needs it from its
    first entry (GEM-LP3-002); the earlier part is the backlog reader's."""
    text = checkpoint(state_dir, destination)
    if text:
        seq_id, seq, realtime = parse_cursor(text)
        position, boot = (seq_id, seq + 1, realtime), boot_of(text)
    elif previous.get(destination, {}).get('baseline'):
        baseline = previous[destination]['baseline']
        position, boot = parse_cursor(baseline), boot_of(baseline)
    else:
        return None
    if boot in {item['boot'] for item in plan.get(destination, [])} and boot != current_boot():
        first = first_entry_of_current_boot()
        return parse_cursor(first) if first else None
    return position


def last_entry_of_boot(boot, namespace='server2', timeout=30):
    result = subprocess.run(['journalctl', f'--namespace={namespace}', f'--boot={boot}', '-o', 'json',
                             '--output-fields=__CURSOR', '-n', '1', *UNIT_MATCHES],
                            capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise JournalError('journalctl failed')
    lines = [l for l in result.stdout.splitlines() if l.strip()]
    return json.loads(lines[-1])['__CURSOR'] if lines else None


def backlog_age(state_dir, item, now_usec):
    """Age of the oldest unconfirmed entry of an earlier-boot reader, 0 when it is done."""
    text = checkpoint(state_dir, None, item['source'])
    arguments = ['--namespace=server2', f"--boot={item['boot']}"] + ([f'--after-cursor={text}'] if text else []) + UNIT_MATCHES
    following = _first_cursor(arguments)
    if following is None:
        return 0
    return max(0, int((now_usec - parse_cursor(following)[2]) / 1e6))


def unshipped_seconds(state_dir, destination, previous, now_usec):
    """Age of the oldest entry the destination has not confirmed, or 0 when it is current.

    Vector retries a failing destination indefinitely and counts an error only when it
    gives up, so this age is what shows an outage while it lasts. A failed journal query
    raises JournalError rather than reporting the destination as current."""
    plan = backlog_plan(state_dir)
    text = checkpoint(state_dir, destination)
    baseline = previous.get(destination, {}).get('baseline')
    covered = {item['boot'] for item in plan.get(destination, [])}
    position_boot = boot_of(text) if text else boot_of(baseline) if baseline else None
    if position_boot in covered and position_boot != current_boot():
        # The current-boot reader has confirmed nothing of this boot yet (GEM-LP3-002).
        first = first_entry_of_current_boot()
        age = 0 if first is None else max(0, int((now_usec - parse_cursor(first)[2]) / 1e6))
    elif text:
        following = first_entry_after(text)
        age = 0 if following is None else max(0, int((now_usec - parse_cursor(following)[2]) / 1e6))
    elif baseline:
        _, _, realtime = parse_cursor(baseline)
        age = max(0, int((now_usec - realtime) / 1e6))
    else:
        return None
    # An earlier boot still being shipped (surviving disk) is the oldest unconfirmed part.
    for item in backlog(state_dir).get(destination, []):
        age = max(age, backlog_age(state_dir, item, now_usec))
    return age


def overruns(state_dir, oldest_cursor, previous, active):
    """New gaps per active destination: [(destination, lost_from_usec, lost_until_usec, (id, seq, time))].

    The reader needs the entry after its checkpoint; a reader with no acknowledged delivery
    yet needs everything from its baseline. A destination needs the earliest position of
    its readers: the current-boot reader and every earlier-boot reader, a rotated one
    included (CX-LP3-004). Only the part not reported before is new (CX-LP2-002): while
    the journal start keeps moving, each report continues the last one.
    """
    if oldest_cursor is None:
        return []
    oldest_id, oldest_seq, oldest_time = parse_cursor(oldest_cursor)
    plan = backlog_plan(state_dir)
    found = []
    for destination in active:
        entry = previous.get(destination, {})
        candidates = [main_position(state_dir, destination, previous, plan)]
        candidates += [item_position(state_dir, item) for item in plan.get(destination, [])]
        candidates = [c for c in candidates if c and c[0] == oldest_id]
        if not candidates:
            continue
        seq_id, needed, realtime = min(candidates, key=lambda c: c[1])
        if needed >= oldest_seq:
            continue
        reported = entry.get('reported_until')
        if reported and reported[0] == seq_id and reported[1] > needed:
            if reported[1] >= oldest_seq:
                continue  # this gap was already reported in full
            needed, realtime = reported[1], reported[2]
        found.append((destination, realtime, oldest_time, (seq_id, oldest_seq, oldest_time)))
    return found


def set_baselines(state_dir, oldest_cursor, state, active):
    """Remember where an active reader without a checkpoint starts, so a later loss is visible.

    An inactive destination keeps its checkpoint; when it is selected again, the collector
    resumes there, and records rotated out meanwhile are reported as an overrun."""
    if oldest_cursor is None:
        return
    for destination in active:
        entry = state.setdefault(destination, {'count': 0})
        if checkpoint(state_dir, destination):
            entry.pop('baseline', None)
        elif not entry.get('baseline'):
            entry['baseline'] = oldest_cursor


def load_state(path):
    try:
        return json.loads(Path(path).read_text())
    except (FileNotFoundError, ValueError):
        return {}


def save_state(path, state):
    path = Path(path)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(state, sort_keys=True))
    temporary.replace(path)


def report_overruns(state_dir, active):
    """Print one record per new gap and return the cumulative counts of the active destinations."""
    state_file = Path(state_dir) / 'overrun-state.json'
    state = load_state(state_file)
    oldest = oldest_entry()
    for destination, lost_from, lost_until, boundary in overruns(state_dir, oldest, state, active):
        entry = state.setdefault(destination, {'count': 0})
        entry['count'] += 1
        entry['reported_until'] = list(boundary)
        if not checkpoint(state_dir, destination):
            # Without a checkpoint the reader starts at the oldest remaining entry; measure
            # its unconfirmed age from there, not from the rotated-out baseline (GEM-LP2-002).
            entry['baseline'] = oldest
        print(json.dumps({'collector_schema': COLLECTOR_SCHEMA, 'timestamp': now(), 'level': 'warn',
                          'event': 'collector.journal_overrun', 'destination': destination,
                          'lost_from': iso(lost_from), 'lost_until': iso(lost_until),
                          'overrun_count': entry['count']}, sort_keys=True), flush=True)
    # A new baseline is where a reader without a checkpoint starts: the current boot's first
    # remaining entry, not an earlier boot it never reads (LP-3).
    set_baselines(state_dir, first_entry_of_current_boot() if oldest else None, state, active)
    save_state(state_file, state)
    prune_backlog(state_dir, active)
    return {d: state.get(d, {}).get('count', 0) for d in active}


def prune_backlog(state_dir, active):
    """After the overrun check has accounted for them, drop the planned boots of active
    destinations that left the journal (CX-LP3-004)."""
    plan = backlog_plan(state_dir)
    if not any(plan.get(d) for d in active):
        return
    boots = journal_boots()
    kept = {d: [i for i in items if d not in active or (not i.get('rotated') and i['boot'] in boots)]
            for d, items in plan.items()}
    kept = {d: items for d, items in kept.items() if items}
    if kept != plan:
        save_state(Path(state_dir) / 'backlog.json', kept)


def drain(state_dir, active, timeout, poll=0.5):
    """Wait until every active reader has confirmed delivery up to the newest journal entry
    present now, so the collector can be stopped without unconfirmed in-flight records.

    On SIGTERM the collector flushes what it has read, but its checkpoint only covers
    deliveries confirmed before the stop, so a restart would resend the rest (CX-LP2-001).
    One deadline covers the target lookup and the wait (CX-LP2-009). Only a checkpoint
    with the target's sequence ID can confirm it (CX-LP2-008). A failing destination is
    not waited for beyond the deadline; its undelivered records stay in the journal."""
    deadline = time.monotonic() + timeout
    began = time.monotonic()
    target = newest_entry(timeout=max(1.0, deadline - time.monotonic()))
    if target is None:
        return {d: {'drained': True, 'waited_seconds': round(time.monotonic() - began, 1)} for d in active}
    # Readers and their targets: each destination's main reader up to the journal end, and
    # each earlier-boot reader (LP-3) up to its boot's last entry.
    targets = {(d, None): parse_cursor(target) for d in active}
    for destination in active:
        for item in backlog(state_dir).get(destination, []):
            last = last_entry_of_boot(item['boot'], timeout=max(1.0, deadline - time.monotonic()))
            if last:
                targets[(destination, item['source'])] = parse_cursor(last)
    pending = set(targets)
    while pending:
        for key in sorted(pending, key=str):
            text = checkpoint(state_dir, key[0], key[1])
            if text:
                seq_id, seq, _ = parse_cursor(text)
                if seq_id == targets[key][0] and seq >= targets[key][1]:
                    pending.discard(key)
        if not pending or time.monotonic() >= deadline:
            break
        time.sleep(min(poll, max(0.0, deadline - time.monotonic())))
    waited = round(time.monotonic() - began, 1)
    return {d: {'drained': not any(k[0] == d for k in pending), 'waited_seconds': waited} for d in active}


def counters(text):
    """Per-destination totals from the Prometheus text of the collector."""
    totals = {d: {'sent_events': 0, 'failed_requests': 0, 'dropped_events': 0} for d in DESTINATIONS}
    for line in text.splitlines():
        match = _SAMPLE.match(line.strip())
        if not match:
            continue
        name, labels, value = match.group(1), match.group(2), float(match.group(3))
        component = re.search(r'component_id="([^"]+)"', labels)
        if not component or component.group(1) not in totals:
            continue
        entry = totals[component.group(1)]
        if name == 'vector_component_sent_events_total':
            entry['sent_events'] += value
        elif name == 'vector_component_errors_total':
            entry['failed_requests'] += value
        elif name == 'vector_component_discarded_events_total' and 'intentional="false"' in labels:
            entry['dropped_events'] += value
        elif name == 'vector_buffer_discarded_events_total':
            entry['dropped_events'] += value
    return {d: {k: int(v) for k, v in e.items()} for d, e in totals.items()}


def active_destinations(config):
    try:
        return [d for d in DESTINATIONS if d in json.loads(Path(config).read_text())['sinks']]
    except (OSError, ValueError, KeyError):
        return []


def main(argv=None):
    parser = argparse.ArgumentParser(description='Collector loss visibility records.')
    parser.add_argument('moment', choices=('start', 'periodic', 'drain'))
    parser.add_argument('--state', default='/var/lib/server2-logs', help='collector state directory')
    parser.add_argument('--config', default='/run/server2-logs/vector.json', help='rendered collector configuration')
    parser.add_argument('--timeout', type=float, default=75, help='drain: seconds to wait for confirmations')
    parser.add_argument('--main-pid', help='drain: the collector process (systemd ${MAINPID}); empty when it has already exited')
    args = parser.parse_args(argv)
    active = active_destinations(args.config)
    if args.moment == 'drain' and args.main_pid == '':
        # The collector exited by itself (systemd knows no main process any more): nobody
        # is left to confirm deliveries, so waiting would only delay its restart.
        print(json.dumps({'collector_schema': COLLECTOR_SCHEMA, 'timestamp': now(), 'level': 'warn',
                          'event': 'collector.drained', 'destinations': None, 'error': 'collector already exited'},
                         sort_keys=True), flush=True)
        return 0
    if args.moment == 'drain':
        try:
            result = drain(args.state, active, args.timeout)
        except (OSError, ValueError, KeyError, JournalError, subprocess.TimeoutExpired) as exc:
            result, error = None, type(exc).__name__
        complete = result is not None and all(r['drained'] for r in result.values())
        record = {'collector_schema': COLLECTOR_SCHEMA, 'timestamp': now(), 'level': 'info' if complete else 'warn',
                  'event': 'collector.drained', 'destinations': result}
        if result is None:
            record['error'] = error
        print(json.dumps(record, sort_keys=True), flush=True)
        return 0  # never block the stop; the record says what was not confirmed
    try:
        overrun_counts = report_overruns(args.state, active)
    except (OSError, ValueError, KeyError, JournalError, subprocess.TimeoutExpired) as exc:
        print(f'server2 log collector: overrun check failed ({type(exc).__name__})', file=sys.stderr)
        overrun_counts = None
    if args.moment == 'start':
        return 0
    totals = None
    for attempt in range(5):  # the endpoint opens a moment after the collector starts
        try:
            with urllib.request.urlopen(METRICS_URL, timeout=5) as response:
                totals = counters(response.read().decode())
            break
        except OSError as exc:
            error = type(exc).__name__
            time.sleep(1)
    if totals is None:
        print(f'server2 log collector: metrics endpoint unavailable ({error})', file=sys.stderr)
    destinations = {}
    previous = load_state(Path(args.state) / 'overrun-state.json')
    now_usec = int(time.time() * 1e6)
    for destination in active:
        entry = dict(totals[destination]) if totals else {}
        entry['journal_overruns'] = overrun_counts.get(destination) if overrun_counts is not None else None
        try:
            entry['unshipped_seconds'] = unshipped_seconds(args.state, destination, previous, now_usec)
        except (OSError, ValueError, KeyError, JournalError, subprocess.TimeoutExpired):
            entry['unshipped_seconds'] = None
        entry['behind'] = entry['unshipped_seconds'] is None or entry['unshipped_seconds'] > BEHIND_SECONDS[destination]
        destinations[destination] = entry
    lossy = totals is None or overrun_counts is None or any(
        e.get('failed_requests') or e.get('dropped_events') or e.get('journal_overruns') or e.get('behind')
        for e in destinations.values())
    print(json.dumps({'collector_schema': COLLECTOR_SCHEMA, 'timestamp': now(), 'level': 'warn' if lossy else 'info',
                      'event': 'collector.status', 'metrics_available': totals is not None,
                      'destinations': destinations}, sort_keys=True), flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
