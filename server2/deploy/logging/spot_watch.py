#!/usr/bin/env python3
"""Spot interruption watcher for the server2 log pipeline (LP-4, #2981).

Runs as server2-logs-watch.service. On a Spot instance it polls instance metadata
(IMDSv2) every 5 seconds for an interruption notice. On a notice it writes one
collector record (collector_schema 1, `collector.interruption_notice`, with the
announced action and time), marks the interruption for the collector's stop drain,
and stops the server, then the collector:

  notice seen (<= 5 s) -> server2.service stops (<= 45 s, its TimeoutStopSec)
  -> server2-logs.service stops: drain <= 10 s, then the collector's own flush <= 20 s

about 80 s in total, inside the two-minute notice. EC2 then stops or terminates the
instance; the watcher does not power anything off. On an On-Demand or scheduled
instance, or without instance metadata, it writes one line saying why it is idle and
exits successfully, starting no stop.
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
POLL_SECONDS = 5
TOKEN_TTL_SECONDS = 21600
# Read by status.py drain: on an interruption the drain waits at most 10 s.
MARKER = '/run/server2-logs-watch/interruption'
LIFE_CYCLE_ATTEMPTS = 12  # up to a minute for instance metadata to answer at boot
COLLECTOR_SCHEMA = 1


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%fZ')


class Metadata:
    """IMDSv2 client: a session token, renewed before it expires or when refused."""

    def __init__(self, base=IMDS, timeout=2.0, clock=time.monotonic):
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


def ordered_stop(run, marker):
    """Server first, then the collector (its drain sees the marker and waits at most 10 s)."""
    marker = Path(marker)
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(now() + '\n')
    began = time.monotonic()
    server = run(['systemctl', 'stop', 'server2.service'], capture_output=True, text=True)
    server_seconds = round(time.monotonic() - began, 1)
    run(['systemctl', 'stop', 'server2-logs.service'], capture_output=True, text=True)
    total = round(time.monotonic() - began, 1)
    marker.unlink(missing_ok=True)
    # The collector has stopped, so this line stays in the local journal only.
    print(f'server2 interruption stop: server2.service stopped in {server_seconds} s '
          f'(exit {server.returncode}), server2-logs.service by {total} s', flush=True)


def main(argv=None, run=subprocess.run, sleep=time.sleep, metadata=None):
    argparse.ArgumentParser(description='Watch for a Spot interruption notice and stop server2 in order.').parse_args(argv)
    metadata = metadata or Metadata()
    life_cycle = None
    for attempt in range(LIFE_CYCLE_ATTEMPTS):
        life_cycle = metadata.get('/latest/meta-data/instance-life-cycle')
        if life_cycle is not None:
            break
        if attempt + 1 < LIFE_CYCLE_ATTEMPTS:
            sleep(POLL_SECONDS)
    if life_cycle != 'spot':
        reason = 'no instance metadata' if life_cycle is None else f'instance life cycle is {life_cycle}'
        print(f'server2 interruption watcher: idle ({reason}); no interruption notice can arrive', flush=True)
        return 0
    print('server2 interruption watcher: watching for a Spot interruption notice every '
          f'{POLL_SECONDS} s', flush=True)
    while True:
        text = metadata.get('/latest/meta-data/spot/instance-action')
        found = notice(text) if text else None
        if found:
            action, announced = found
            record('collector.interruption_notice', 'warn', action=action, action_time=announced,
                   message='Spot interruption notice: stopping server2, then the log collector')
            ordered_stop(run, MARKER)
            return 0
        sleep(POLL_SECONDS)


if __name__ == '__main__':
    sys.exit(main())
