#!/usr/bin/env python3
"""Spot interruption watcher for the server2 log pipeline (LP-4, #2981).

Runs as server2-logs-watch.service. On a Spot instance it polls instance metadata
(IMDSv2) every 4 seconds, each request bounded at 0.5 s, so a notice is seen within
6 seconds (CX-LP4-004). On a notice it writes one collector record (collector_schema 1,
`collector.interruption_notice`, with the announced action and time), marks the
interruption for the collector's stop drain, and stops the server, then the collector,
inside one deadline of 75 s from the notice (CX-LP4-001):

  notice seen (<= 6 s) -> server2.service stops (<= 45 s, its TimeoutStopSec)
  -> server2-logs.service stops: drain <= 10 s, then the collector's own flush <= 20 s

81 s in total, inside the two-minute notice. Each wait is bounded by the time left, and
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
STOP_BUDGET_SECONDS = SERVER_STOP_SECONDS + DRAIN_SECONDS + FLUSH_SECONDS
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


def bounded(run, command, seconds):
    """Run a systemctl command for at most `seconds`: (outcome, elapsed seconds)."""
    began = time.monotonic()
    try:
        result = run(command, capture_output=True, text=True, timeout=max(1.0, seconds))
        outcome = 'ok' if result.returncode == 0 else f'failed (exit {result.returncode})'
    except subprocess.TimeoutExpired:
        outcome = 'timeout'  # the stop job continues in systemd; the watcher does not wait longer
    return outcome, round(time.monotonic() - began, 1)


def unit_state(run, unit):
    try:
        return run(['systemctl', 'show', '-p', 'ActiveState', '--value', unit], capture_output=True, text=True,
                   timeout=5).stdout.strip()
    except subprocess.TimeoutExpired:
        return 'unknown'


def wait_state(run, unit, states, until, clock, sleep):
    """Poll the unit's state until it is in `states` or `until` (monotonic) passes."""
    state = unit_state(run, unit)
    while state not in states and clock() < until:
        sleep(0.5)
        state = unit_state(run, unit)
    return state


def ensure_collector(run, until, clock, sleep):
    """A collector that is not running (crashed, or waiting for its automatic restart) is
    started, so it reads and ships the journal before it stops (CX-LP4-003)."""
    state = unit_state(run, 'server2-logs.service')
    if state == 'active':
        return state, None
    bounded(run, ['systemctl', 'start', '--no-block', 'server2-logs.service'], 5)
    return state, wait_state(run, 'server2-logs.service', ('active', 'failed', 'inactive'), until, clock, sleep)


def ordered_stop(run, marker, clock=time.monotonic, sleep=time.sleep):
    """Server first, then the collector, inside STOP_BUDGET_SECONDS from now.

    The collector's drain sees the marker and waits at most 10 s; the marker is kept until
    the host goes down, so a stop still pending in systemd also uses the short drain
    (GEM-LP4-002). Each step is bounded by the time left and its real outcome is checked:
    a collector still stopping at the deadline is killed (CX-LP4-001). The record after the
    server's stop reaches the destinations; the last line stays local."""
    deadline = clock() + STOP_BUDGET_SECONDS
    collector_deadline = deadline - DRAIN_SECONDS - FLUSH_SECONDS
    marker = Path(marker)
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(now() + '\n')
    collector_before = unit_state(run, 'server2-logs.service')
    if collector_before != 'active':  # start it now, in parallel with the server's stop
        bounded(run, ['systemctl', 'start', '--no-block', 'server2-logs.service'], 5)
    server, server_seconds = bounded(run, ['systemctl', 'stop', 'server2.service'], collector_deadline - clock())
    server_state = wait_state(run, 'server2.service', ('inactive', 'failed'), collector_deadline, clock, sleep)
    # Checked again right before its stop: it may have crashed while the server stopped.
    collector_seen, collector_started = ensure_collector(run, collector_deadline, clock, sleep)
    degraded = server != 'ok' or server_state not in ('inactive', 'failed') or collector_started not in (None, 'active')
    record('collector.interruption_progress', 'warn' if degraded else 'info',
           server_stop=server, server_stop_seconds=server_seconds, server_state=server_state,
           collector_before=collector_before, collector_at_stop=collector_seen, collector_started=collector_started)
    collector, total = bounded(run, ['systemctl', 'stop', 'server2-logs.service'], deadline - clock())
    collector_state = wait_state(run, 'server2-logs.service', ('inactive', 'failed'), deadline, clock, sleep)
    if collector_state not in ('inactive', 'failed'):
        # Past the budget: end it, so the instance's last minute is not spent waiting.
        bounded(run, ['systemctl', 'kill', '--signal=SIGKILL', 'server2-logs.service'], 5)
        collector, collector_state = 'killed at the deadline', unit_state(run, 'server2-logs.service')
    # The collector has stopped, so this line stays in the local journal only.
    print(f'server2 interruption stop: server2.service {server} ({server_state}) in {server_seconds} s, '
          f'server2-logs.service {collector} ({collector_state}) {total} s later (budget {STOP_BUDGET_SECONDS} s)', flush=True)
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
