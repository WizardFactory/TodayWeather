#!/usr/bin/env python3
"""Spot interruption watcher for the server2 log pipeline (LP-4, #2981).

Runs as server2-logs-watch.service. On a Spot instance it polls instance metadata
(IMDSv2) every 4 seconds, each request bounded at 0.5 s, so a notice is seen within
6 seconds (CX-LP4-004). On a notice it writes one collector record (collector_schema 1,
`collector.interruption_notice`, with the announced action and time), marks the
interruption for the collector's stop drain, and stops the server, then the collector,
within 80 s of the notice (CX-LP4-001):

  notice seen (<= 6 s) -> server2.service stops (<= 45 s, its TimeoutStopSec)
  -> server2-logs.service stops: drain <= 10 s, then the collector's own flush <= 20 s
  -> reserve 5 s: final state check, and the kill of a collector still stopping

86 s in total, inside the two-minute notice. Each wait is bounded by the time left, and
the outcome of each step is recorded. A collector that is not running at the notice
(for example waiting for its automatic restart) is started first, in parallel with the
server's stop, so it reads and ships the journal before it stops (CX-LP4-003). EC2 then
stops or terminates the instance; the watcher does not power anything off. On an
On-Demand or scheduled instance, or without instance metadata, it writes one line
saying why it is idle and exits successfully, starting no stop.
"""
import argparse
import datetime
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

IMDS = 'http://169.254.169.254'
POLL_SECONDS = 4
METADATA_TIMEOUT = 0.5
DETECTION_SECONDS = 6  # poll interval + at most four bounded metadata requests
SERVER_STOP_SECONDS = 45  # server2.service TimeoutStopSec
DRAIN_SECONDS = 10  # status.py INTERRUPTION_DRAIN_SECONDS
FLUSH_SECONDS = 20  # Vector --graceful-shutdown-limit-secs
COLLECTOR_STOP_SECONDS = DRAIN_SECONDS + FLUSH_SECONDS
RESERVE_SECONDS = 5  # final state check and, if needed, the kill (CX-LP4-001)
STOP_BUDGET_SECONDS = SERVER_STOP_SECONDS + COLLECTOR_STOP_SECONDS + RESERVE_SECONDS
CALL_SECONDS = 2  # one systemctl query or start, at most
LIFE_CYCLE_RETRY_SECONDS = 5
TOKEN_TTL_SECONDS = 21600
# Read by status.py drain: on an interruption the drain waits at most 10 s.
MARKER = '/run/server2-logs-watch/interruption'
LIFE_CYCLE_ATTEMPTS = 12  # about a minute for instance metadata to answer at boot
COLLECTOR_SCHEMA = 1


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%fZ')


class Metadata:
    """IMDSv2 client: a session token, renewed before it expires or when refused."""

    def __init__(self, base=IMDS, timeout=METADATA_TIMEOUT, clock=time.monotonic):
        self.base, self.timeout, self.clock = base, timeout, clock
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self.token, self.expires = None, 0.0

    def _token(self):
        if self.token is None or self.clock() >= self.expires:
            request = urllib.request.Request(self.base + '/latest/api/token', method='PUT',
                                             headers={'X-aws-ec2-metadata-token-ttl-seconds': str(TOKEN_TTL_SECONDS)})
            with self.opener.open(request, timeout=self.timeout) as response:
                self.token = response.read().decode()
            self.expires = self.clock() + TOKEN_TTL_SECONDS - 60
        return self.token

    def get(self, path):
        """The value at `path`, None when it is absent (404) or metadata is unavailable."""
        for _ in range(2):
            try:
                request = urllib.request.Request(self.base + path, headers={'X-aws-ec2-metadata-token': self._token()})
                with self.opener.open(request, timeout=self.timeout) as response:
                    return response.read().decode().strip()
            except urllib.error.HTTPError as exc:
                if exc.code == 401:
                    self.token = None  # expired or refused token: renew once
                    continue
                return None
            except (OSError, ValueError):
                return None
        return None


def record(event, level, **fields):
    print(json.dumps(dict(collector_schema=COLLECTOR_SCHEMA, event=event, level=level, timestamp=now(), **fields),
                     sort_keys=True), flush=True)


def notice(text):
    """(action, time) of an interruption notice, or None for anything else."""
    try:
        value = json.loads(text)
    except ValueError:
        return None
    if isinstance(value, dict) and value.get('action') in ('terminate', 'stop', 'hibernate'):
        return value['action'], str(value.get('time', ''))
    return None


def bounded(run, command, deadline, clock=time.monotonic, cap=None):
    """Run a systemctl command until `deadline` (monotonic) at the latest, or for `cap`
    seconds if shorter. Nothing is started once the deadline has passed (CX-LP4-001).
    Returns (outcome, elapsed seconds, stdout)."""
    began = clock()
    seconds = deadline - began if cap is None else min(cap, deadline - began)
    if seconds <= 0:
        return 'skipped (deadline)', 0.0, ''
    try:
        result = run(command, capture_output=True, text=True, timeout=seconds)
        outcome = 'ok' if result.returncode == 0 else f'failed (exit {result.returncode})'
        stdout = result.stdout or ''
    except subprocess.TimeoutExpired:
        outcome, stdout = 'timeout', ''  # a stop job continues in systemd; its state is checked next
    return outcome, round(clock() - began, 1), stdout


def unit_state(run, unit, deadline, clock):
    outcome, _, stdout = bounded(run, ['systemctl', 'show', '-p', 'ActiveState', '--value', unit], deadline, clock, CALL_SECONDS)
    return stdout.strip() if outcome == 'ok' else 'unknown'


def wait_state(run, unit, states, deadline, clock, sleep):
    """Poll the unit's state until it is in `states` or the deadline passes."""
    state = unit_state(run, unit, deadline, clock)
    while state not in states and clock() + 0.5 < deadline:
        sleep(0.5)
        state = unit_state(run, unit, deadline, clock)
    return state


def ordered_stop(run, marker, clock=time.monotonic, sleep=time.sleep):
    """Server first, then the collector, ending within STOP_BUDGET_SECONDS from now.

    Fixed allotments: the server's stop until +45 s, the collector's until +75 s (its drain
    sees the marker and waits at most 10 s, then Vector's flush at most 20 s), and a 5 s
    reserve for the final state check and, for a collector still stopping, the kill. Every
    systemctl call is capped by the time left of its allotment (CX-LP4-001). A collector
    that is not running at the notice, or crashed during the server's stop, is started so
    it ships the journal (CX-LP4-003). The marker stays until the host goes down, so a stop
    still pending in systemd also uses the short drain (GEM-LP4-002). The record after the
    server's stop reaches the destinations; the last line stays local."""
    began = clock()
    server_deadline = began + SERVER_STOP_SECONDS
    collector_deadline = server_deadline + COLLECTOR_STOP_SECONDS
    final_deadline = collector_deadline + RESERVE_SECONDS
    marker = Path(marker)
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(now() + '\n')
    collector_before = unit_state(run, 'server2-logs.service', server_deadline, clock)
    if collector_before != 'active':  # start it now, in parallel with the server's stop
        bounded(run, ['systemctl', 'start', '--no-block', 'server2-logs.service'], server_deadline, clock, CALL_SECONDS)
    server, server_seconds, _ = bounded(run, ['systemctl', 'stop', 'server2.service'], server_deadline, clock)
    server_state = wait_state(run, 'server2.service', ('inactive', 'failed'), server_deadline, clock, sleep)
    if server_state not in ('inactive', 'failed'):  # its allotment is spent: one query for the record
        server_state = unit_state(run, 'server2.service', collector_deadline, clock)
    # Checked again right before its stop: it may have crashed while the server stopped.
    collector_seen = unit_state(run, 'server2-logs.service', collector_deadline, clock)
    collector_started = None
    if collector_seen != 'active':
        bounded(run, ['systemctl', 'start', '--no-block', 'server2-logs.service'], collector_deadline, clock, CALL_SECONDS)
        collector_started = wait_state(run, 'server2-logs.service', ('active', 'failed', 'inactive'),
                                       min(collector_deadline, clock() + CALL_SECONDS * 2), clock, sleep)
    degraded = server != 'ok' or server_state not in ('inactive', 'failed') or collector_started not in (None, 'active')
    record('collector.interruption_progress', 'warn' if degraded else 'info',
           server_stop=server, server_stop_seconds=server_seconds, server_state=server_state,
           collector_before=collector_before, collector_at_stop=collector_seen, collector_started=collector_started)
    collector, collector_seconds, _ = bounded(run, ['systemctl', 'stop', 'server2-logs.service'], collector_deadline, clock)
    collector_state = wait_state(run, 'server2-logs.service', ('inactive', 'failed'), collector_deadline, clock, sleep)
    if collector_state not in ('inactive', 'failed'):
        # Its allotment is spent: end it within the reserve.
        kill, _, _ = bounded(run, ['systemctl', 'kill', '--signal=SIGKILL', 'server2-logs.service'], final_deadline, clock, CALL_SECONDS)
        collector = f'killed at the deadline ({kill})'
        collector_state = unit_state(run, 'server2-logs.service', final_deadline, clock)
    # The collector has stopped, so this line stays in the local journal only.
    print(f'server2 interruption stop: server2.service {server} ({server_state}) in {server_seconds} s, '
          f'server2-logs.service {collector} ({collector_state}) after {round(clock() - began, 1)} s '
          f'(budget {STOP_BUDGET_SECONDS} s)', flush=True)
    return not degraded and collector == 'ok'


def main(argv=None, run=subprocess.run, sleep=time.sleep, metadata=None, clock=time.monotonic):
    argparse.ArgumentParser(description='Watch for a Spot interruption notice and stop server2 in order.').parse_args(argv)
    metadata = metadata or Metadata()
    life_cycle = None
    for attempt in range(LIFE_CYCLE_ATTEMPTS):
        life_cycle = metadata.get('/latest/meta-data/instance-life-cycle')
        if life_cycle is not None:
            break
        if attempt + 1 < LIFE_CYCLE_ATTEMPTS:
            sleep(LIFE_CYCLE_RETRY_SECONDS)
    if life_cycle != 'spot':
        reason = 'no instance metadata' if life_cycle is None else f'instance life cycle is {life_cycle}'
        print(f'server2 interruption watcher: idle ({reason}); no interruption notice can arrive', flush=True)
        return 0
    print('server2 interruption watcher: watching for a Spot interruption notice every '
          f'{POLL_SECONDS} s', flush=True)
    next_poll = clock()
    while True:
        text = metadata.get('/latest/meta-data/spot/instance-action')
        found = notice(text) if text else None
        if found:
            action, announced = found
            record('collector.interruption_notice', 'warn', action=action, action_time=announced,
                   message='Spot interruption notice: stopping server2, then the log collector')
            ordered_stop(run, MARKER, clock=clock, sleep=sleep)
            return 0  # handled; a failed step is recorded, and a restart would only repeat it
        # Polls are scheduled from the clock, so request time does not add to the interval.
        next_poll += POLL_SECONDS
        sleep(max(0.0, next_poll - clock()))


if __name__ == '__main__':
    sys.exit(main())
