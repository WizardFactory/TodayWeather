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
    return _first_cursor([f'--namespace={namespace}', f'--after-cursor={cursor}'])


def oldest_entry(namespace='server2'):
    return _first_cursor([f'--namespace={namespace}'])


def newest_entry(namespace='server2'):
    result = subprocess.run(['journalctl', f'--namespace={namespace}', '-o', 'json', '--output-fields=__CURSOR', '-n', '1'],
                            capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        raise JournalError('journalctl failed')
    lines = [l for l in result.stdout.splitlines() if l.strip()]
    return json.loads(lines[-1])['__CURSOR'] if lines else None


def checkpoint(state_dir, destination):
    try:
        return (Path(state_dir) / f'journal_{destination}' / 'checkpoint.txt').read_text().strip() or None
    except FileNotFoundError:
        return None


def unshipped_seconds(state_dir, destination, previous, now_usec):
    """Age of the oldest entry the destination has not confirmed, or 0 when it is current.

    Vector retries a failing destination indefinitely and counts an error only when it
    gives up, so this age is what shows an outage while it lasts. A failed journal query
    raises JournalError rather than reporting the destination as current."""
    text = checkpoint(state_dir, destination)
    if text:
        following = first_entry_after(text)
        if following is None:
            return 0
        _, _, realtime = parse_cursor(following)
    elif previous.get(destination, {}).get('baseline'):
        _, _, realtime = parse_cursor(previous[destination]['baseline'])
    else:
        return None
    return max(0, int((now_usec - realtime) / 1e6))


def overruns(state_dir, oldest_cursor, previous, active):
    """New gaps per active destination: [(destination, lost_from_usec, lost_until_usec, (id, seq, time))].

    The reader needs the entry after its checkpoint; a reader with no acknowledged delivery
    yet needs everything from its baseline. Only the part not reported before is new
    (CX-LP2-002): while the journal start keeps moving, each report continues the last one.
    """
    if oldest_cursor is None:
        return []
    oldest_id, oldest_seq, oldest_time = parse_cursor(oldest_cursor)
    found = []
    for destination in active:
        entry = previous.get(destination, {})
        text = checkpoint(state_dir, destination)
        if text:
            seq_id, seq, realtime = parse_cursor(text)
            needed = seq + 1
        elif entry.get('baseline'):
            seq_id, needed, realtime = parse_cursor(entry['baseline'])
        else:
            continue
        if seq_id != oldest_id or needed >= oldest_seq:
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
    set_baselines(state_dir, oldest, state, active)
    save_state(state_file, state)
    return {d: state.get(d, {}).get('count', 0) for d in active}


def drain(state_dir, active, timeout, poll=0.5):
    """Wait until every active reader has confirmed delivery up to the newest journal entry
    present now, so the collector can be stopped without unconfirmed in-flight records.

    On SIGTERM the collector flushes what it has read, but its checkpoint only covers
    deliveries confirmed before the stop, so a restart would resend the rest (CX-LP2-001).
    Bounded by `timeout`: a failing destination is not waited for beyond it; its
    undelivered records stay in the journal and are sent once after the next start."""
    target = newest_entry()
    began = time.monotonic()
    result = {}
    if target is None:
        return {d: {'drained': True, 'waited_seconds': 0} for d in active}
    target_id, target_seq, _ = parse_cursor(target)
    pending = set(active)
    while pending and time.monotonic() - began < timeout:
        for destination in sorted(pending):
            text = checkpoint(state_dir, destination)
            if text:
                seq_id, seq, _ = parse_cursor(text)
                if seq_id != target_id or seq >= target_seq:
                    result[destination] = {'drained': True, 'waited_seconds': round(time.monotonic() - began, 1)}
                    pending.discard(destination)
        if pending:
            time.sleep(poll)
    for destination in pending:
        result[destination] = {'drained': False, 'waited_seconds': round(time.monotonic() - began, 1)}
    return result


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
    args = parser.parse_args(argv)
    active = active_destinations(args.config)
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
