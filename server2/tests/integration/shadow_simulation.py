#!/usr/bin/env python3
"""Offline 168-hour shadow-run simulation over the real decision code.

Real code: provision lifecycle and finish, SQLite journal, guard evaluation
and cost estimate, paired reader ledger, evidence copy, bucket audit and writer
fencing. The model supplies a clock, host units, AWS replies with exact object
versions, SSH archive transfers, host counters and HTTP outcomes. No network,
AWS or server process is required.

Limitations: the reader's schedule is modelled around the real Ledger with small
synthetic bodies. Copy and archive transfer complete instantaneously. The log
collector is represented by a unit state, and raw and log object contents are
not generated. Process death and host reboot are not modelled. Fault rates are
scenario inputs.

Usage: python3 tests/integration/shadow_simulation.py [--seeds N] [--scenario NAME] [--output FILE]
Measured mode: add --measurement REPORT.json --measured-policy PLAN.json, with no --scenario.
"""
from __future__ import annotations

import argparse
import contextlib
import importlib.util
import json
import random
import sys
import tarfile
import tempfile
import time
import types
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SERVER2 = HERE.parents[1]
spec = importlib.util.spec_from_file_location('shadow_supervisor_fixtures', HERE / 'test_shadow_supervisor.py')
fx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fx)
state, operator, remote, guard = fx.state, fx.operator, fx.remote, fx.guard
provision = fx.provision
spec_reader = importlib.util.spec_from_file_location('paired_read_sim', SERVER2 / 'tools/shadow/paired_read.py')
reader = importlib.util.module_from_spec(spec_reader)
spec_reader.loader.exec_module(reader)
evidence_copy, _ = fx.load_evidence_modules()
spec_aws = importlib.util.spec_from_file_location('shadow_sim_fake_aws', HERE / 'shadow_finish_fake_aws.py')
fake_aws = importlib.util.module_from_spec(spec_aws)
spec_aws.loader.exec_module(fake_aws)
# The CLI fixture's external pause injection belongs to interrupted CLI replay.
fake_aws.pause_get = lambda root: False
sys.path.insert(0, str(HERE))

HOUR = 3600
EPOCH = 1000
GIB = 1024 ** 3
# Frozen tariffs used for the 2026-11-13 run (official-tariffs-20261113.json).
RATES = {'ec2_hour': '0.026', 'ipv4_hour': '0.005', 'gp3_gb_month': '0.0912', 's3_gb_month': '0.025',
         's3_read': '0.00000035', 's3_write': '0.0000045', 'cpu_vcpu_hour': '0.05', 'outbound_gb': '0.126'}

# Reader schedule of the live manifest: (interval seconds, number of cases).
SCHEDULE = [(900, 4), (3600, 17), (21600, 3), (86400, 32)]


def default_scenario(**changes):
    sc = dict(
        name='ideal',
        poll_failure=0.0,            # per operator SSH poll
        sample_failure=0.0,          # per 10 s guard sample (metrics timeout, /proc error)
        quota_events_per_hour=0.0,   # provider/local Quota or Auth records reaching the guard counters
        quota_first_at=None,         # seconds after start of a forced first event (observed: ~180)
        storage_auth_at=None,        # seconds after start from which every S3 call is denied (broken role)
        production_429=0.0,          # per production attempt
        production_5xx=0.0,
        production_timeout=0.0,
        candidate_5xx=0.0,
        candidate_timeout=0.0,
        s3_reads_per_hour=200.0,     # candidate S3 reads (allocation 90,000; exhausted is refused, not a stop)
        s3_writes_per_hour=200.0,
        s3_put_bytes_per_hour=4 * 1024 ** 2,
        tx_bytes_per_hour=10 * 1024 ** 2,    # priced against the cost ceiling (SR-4)
        cpu_busy_fraction=0.25,      # of 2 vCPU
        ssh_down=[],                 # [(start_s, end_s)] relative to epoch; end None = forever
        candidate_exit_at=None,      # seconds after start when the candidate process exits
        reader_outcomes={},          # {(origin, n): result} forces the n-th attempt's result (1-based)
        copy_failures=[],            # [(start_s, end_s)]: every evidence PUT fails (end None = forever)
        ssh_recovery_failure=False,  # observable control/transfer failure on the finish path
        finish_retry_at=None,        # one explicit finish retry, seconds from epoch
    )
    sc.update(changes)
    return sc


SCENARIOS = {
    'ideal': default_scenario(),
    'observed-quota-at-3min': default_scenario(name='observed-quota-at-3min', quota_first_at=180),
    'shared-key-daily-429': default_scenario(name='shared-key-daily-429', quota_events_per_hour=1 / 24),
    'production-429-1e-4': default_scenario(name='production-429-1e-4', production_429=1e-4),
    'production-transient-1e-3': default_scenario(name='production-transient-1e-3', production_5xx=1e-3, production_timeout=1e-4),
    'poll-failure-1e-4': default_scenario(name='poll-failure-1e-4', poll_failure=1e-4),
    'poll-failure-1e-3': default_scenario(name='poll-failure-1e-3', poll_failure=1e-3),
    'sample-failure-1e-5': default_scenario(name='sample-failure-1e-5', sample_failure=1e-5),
    'mac-sleeps-night-1': default_scenario(name='mac-sleeps-night-1', ssh_down=[(14 * HOUR, 22 * HOUR)]),
    'operator-ip-change-day-3': default_scenario(name='operator-ip-change-day-3', ssh_down=[(60 * HOUR, None)]),
    'tx-observed-early-rate': default_scenario(name='tx-observed-early-rate', tx_bytes_per_hour=150 * 1000 ** 2),
    's3-measured-high': default_scenario(name='s3-measured-high', s3_reads_per_hour=2000, s3_writes_per_hour=600),
    # A dead candidate leaves no /proc entry: the guard's sample collection fails.
    'candidate-exit-day-3': default_scenario(name='candidate-exit-day-3', candidate_exit_at=60 * HOUR),
    # SR-4: transmit priced at about USD 2.5/h drives the estimate to the USD 300 ceiling.
    'cost-ceiling': default_scenario(name='cost-ceiling', tx_bytes_per_hour=20 * 1000 ** 3),
    # SR-3: the run's own storage authorization fails (instance role or bucket policy broken).
    'storage-auth-broken-role': default_scenario(name='storage-auth-broken-role', storage_auth_at=3 * HOUR),
    # SR-5a: the operator cannot reach the host in the last hour; evidence is in the bucket.
    'operator-unreachable-at-deadline': default_scenario(name='operator-unreachable-at-deadline',
                                                         ssh_down=[(167 * HOUR, None)]),
    # SR-5a: the final copy after a candidate exit fails; the next hourly copy takes it.
    'final-copy-fails-hourly-recovers': default_scenario(name='final-copy-fails-hourly-recovers',
                                                         candidate_exit_at=60 * HOUR, ssh_down=[(59 * HOUR, 62 * HOUR)],
                                                         copy_failures=[(60 * HOUR, 60 * HOUR + 1800)]),
    # SR-5a: production fails for 30 minutes; the reader exits 2 (unit failed).
    'reader-failed': default_scenario(name='reader-failed', production_5xx=1.0),
    'realistic-combined': default_scenario(name='realistic-combined', poll_failure=1e-4, sample_failure=1e-6,
                                           quota_events_per_hour=1 / 24, production_5xx=1e-3, production_timeout=1e-4,
                                           production_429=1e-5, ssh_down=[(14 * HOUR, 22 * HOUR)]),
}


def measured_scenario(measurement, policy):
    from shadow_measured_input import load_measurement

    trace, evidence = load_measurement(measurement, policy)
    scenario = SCENARIOS['realistic-combined'] | dict(name='measured-24h', measured=trace, quota_events_per_hour=0.0)
    evidence['modeled_faults'] = {key: scenario[key] for key in
                                  ('poll_failure', 'sample_failure', 'ssh_down', 'candidate_5xx', 'candidate_timeout',
                                   'production_5xx', 'production_timeout', 'production_429')}
    evidence['provider_fault_assumption'] = ('observed source/status counts, spread evenly within their hour; '
                                             'no inferred provider failure rate')
    return scenario, evidence


class SimTime:
    """One clock shared by the operator, guard and reader models."""
    def __init__(self, epoch=EPOCH):
        self.epoch = epoch
        self.deadline = epoch + 168 * HOUR
        self.now = float(epoch + 1)

    def time(self):
        return self.now

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class Host:
    """Unit model of the qualification host, from coordinator.py `host_units`.

    Relations (candidate, guard and reader are `Restart=no`):
    - candidate `ExecStopPost` stops the reader and the guard: a candidate exit, for any
      reason, ends the group, and the guard makes no further decision;
    - guard `ExecStopPost` stops the reader and the candidate: a guard stop (its own
      decision) ends the group at that guard step;
    - the reader is bound to both and has no stop hook: a reader exit stops only the
      reader, and the candidate and the guard keep running until the operator stops them;
    - the log collector (#2977) has no relation to the three and runs until the
      operator's stop.

    Events are applied in time order. The guard samples every 10 s; a reader request has
    a start and a completion event, and a request still in flight when its unit stops
    stays pending in the ledger.
    """
    def __init__(self, sc, rng, clock, workdir, evidence=None, manifest=None, identity=None):
        self.sc, self.rng, self.clock = sc, rng, clock
        epoch = clock.epoch
        self.measured = sc.get('measured')
        self.manifest = fx.host_manifest()
        self.manifest.update(epoch=epoch, tx_origin=0)
        if self.measured is None:
            self.manifest['allowance'] = dict(reads=90000, writes=90000, put_bytes=2 * GIB)
            self.manifest['cost_policy']['rates'] = dict(RATES)
            self.manifest['cost_policy']['observed_at'] = epoch
        else:
            self.manifest.update(allowance=self.measured.allowance, cost_policy=self.measured.cost_policy,
                                 paid_usd_per_unit=operator.paid_prices_by_metric(self.measured.paid_policy))
        guard.validate(self.manifest)
        self.decision = None
        self.stepped = epoch          # time of the last guard step
        self.events = []              # (time, order, cause)
        self.group_end = None         # candidate and guard (and reader) stopped
        self.reader_end = None        # reader process exit on its own terminal state
        self.operator_end = None
        self.terminated_at = None
        self.candidate_exit = None if sc['candidate_exit_at'] is None else epoch + sc['candidate_exit_at']
        self.guard_samples_after_reader_exit = 0
        self.quota = 0
        if sc['quota_first_at'] is not None:
            self.next_quota = epoch + sc['quota_first_at']
        else:
            self.next_quota = self._next_event(epoch)
        self.reader = ReaderModel(sc, rng, workdir, manifest, identity, epoch=epoch)
        # SR-5a: hourly (wall-clock) copies, the install-time copy, and the finalizer started
        # by the reader's stop and by the 168-hour stop.service.
        self.evidence = evidence
        self.next_copy = (epoch // HOUR + 1) * HOUR
        self.deadline_finalized = False
        if evidence is not None:
            evidence.host = self
            evidence.copy(epoch + 1, final=False)

    def _next_event(self, start):
        rate = self.sc['quota_events_per_hour']
        return start + self.rng.expovariate(rate / HOUR) if rate else float('inf')

    def _record(self, at, cause):
        self.events.append((at, len(self.events), cause))

    def _end_group(self, at, cause, *, finalize=True):
        if self.group_end is None:
            reader_running = self.reader_end is None
            self.group_end = at
            self._record(at, cause)
            if reader_running and finalize:
                self._finalize(at)    # the reader's ExecStopPost starts the finalizer

    def _finalize(self, at):
        if self.evidence is not None:
            self.evidence.copy(at, final=True)

    def reader_unit(self):
        """systemd's view of the reader: exit 2 on its own terminal state is `failed`."""
        if self.reader_active():
            return ('active', '')
        own = self.reader_end is not None and (self.group_end is None or self.reader_end <= self.group_end)
        failed = own and self.reader.terminal not in (None, 'duration-complete', 'stopped')
        return ('failed' if failed else 'inactive', 'exited')

    def _copies_to(self, t):
        """Hourly copies at or before t, with the reader advanced to each copy's time."""
        if self.evidence is None:
            return
        while self.next_copy <= t:
            at = self.next_copy
            self._reader_to(at)
            self.evidence.copy(at, final=False)
            self.next_copy += HOUR

    def group_active(self):
        return self.group_end is None

    def reader_active(self):
        return self.group_end is None and self.reader_end is None

    def collection_end(self):
        ends = [x for x in (self.reader_end, self.group_end) if x is not None]
        return min(ends + [self.clock.deadline])

    def stop_cause(self):
        return min(self.events)[2] if self.events else None

    def operator_stop(self, at):
        self.operator_end = at
        self._end_group(at, 'operator-stop')

    def terminate(self, at):
        self.advance(at)
        self.terminated_at = at
        self.operator_end = at
        self._end_group(at, 'operator-stop', finalize=False)

    def sample(self, t):
        sc = self.sc
        if self.rng.random() < sc['sample_failure']:
            return None
        elapsed = t - self.clock.epoch
        s = fx.host_sample(self.manifest)
        s['observed_at'] = int(t)
        if self.measured is not None:
            return self.measured.apply(s, int(elapsed))
        elapsed_h = elapsed / HOUR
        while self.next_quota <= t:
            self.quota += 1
            self.next_quota = self._next_event(self.next_quota)
        s.update(tx_bytes=int(sc['tx_bytes_per_hour'] * elapsed_h),
                 cpu_seconds=int(2 * sc['cpu_busy_fraction'] * elapsed))
        # Only the counters the guard under test reads; keys come from the shared fixture.
        s['metrics'].update(
            s3_reads=max(0, int(90000 - sc['s3_reads_per_hour'] * elapsed_h)),
            s3_writes=max(0, int(90000 - sc['s3_writes_per_hour'] * elapsed_h)),
            s3_put_bytes=max(0, int(2 * GIB - sc['s3_put_bytes_per_hour'] * elapsed_h)),
            auth_failures=0, quota_failures=self.quota)
        # Provider rejections (SR-3): one data.go.kr 429 per quota event, counted by source.
        if self.quota:
            s['diagnostics']['provider_http'] = {'vilage_fcst': {'429': self.quota}}
        # A broken role fails every S3 call: far more than the threshold between two samples.
        at = sc['storage_auth_at']
        if at is not None and elapsed >= at:
            s['metrics']['storage_auth_failures'] = guard.STORAGE_AUTH_LIMIT + int((elapsed - at) // 10)
        return s

    def _reader_to(self, t):
        if self.reader_active():
            self.reader.advance(t)
            if self.reader.terminal is not None:
                self.reader_end = self.reader.end_at
                self._record(self.reader_end, 'reader:' + self.reader.terminal)
                self._finalize(self.reader_end)

    def advance(self, until):
        """Apply every event up to `until` in time order."""
        if self.terminated_at is not None:
            return
        deadline = self.clock.deadline
        while self.group_active():
            step = self.stepped + 10
            target = min(step, until)
            if self.candidate_exit is not None and self.candidate_exit <= target:
                self._copies_to(self.candidate_exit - 1e-6)
                self._reader_to(self.candidate_exit)
                self._end_group(self.candidate_exit, 'candidate-exit')
                break
            self._copies_to(target)
            self._reader_to(target)
            if step > until:
                break
            self.stepped = step
            if self.reader_end is not None and step > self.reader_end:
                self.guard_samples_after_reader_exit += 1
            self.decision = guard.evaluate(self.manifest, self.sample(step), self.decision, int(step))
            if self.decision['stop']:
                self._end_group(step, 'guard:' + self.decision['stop'])
            elif step >= deadline:
                # The 168-hour stop.service stops the units whatever the guard decided.
                self._end_group(deadline, 'stop-timer')
        if until >= deadline and not self.deadline_finalized:
            self._copies_to(deadline)
            # The stop.service also starts the finalizer after its stop requests.
            self.deadline_finalized = True
            self._finalize(deadline)
        self._copies_to(until)


class ReaderModel:
    """Real Ledger decisions; scheduling mirrors paired_read.execute.

    A request has two events: it starts (the attempt is reserved in the ledger) and it
    completes (its result is applied). advance(until) applies only events at or before
    `until`, so a request can be in flight across the bound and stays pending if the
    reader is not advanced again. The reader runs concurrently with the operator and the
    guard, so its request durations advance its own clock only.
    """
    def __init__(self, sc, rng, workdir, manifest=None, identity=None, *, epoch=EPOCH):
        self.sc, self.rng = sc, rng
        manifest = manifest or reader_manifest('a' * 64)
        self.cases = manifest['cases']
        identity = identity or {'manifest': manifest, 'candidate': 'c', 'production': 'p', 'loopback_test': True,
                                'sampler_sha256': 'b' * 64}
        self.directory = Path(workdir)
        self.clock = SimTime(epoch)
        self.fake = types.SimpleNamespace(time=self.clock.time, monotonic=self.clock.monotonic, sleep=self.clock.sleep)
        with patch.object(reader, 'time', self.fake):
            self.ledger = reader.Ledger(Path(workdir), identity, False)
        self.ledger.db.execute('PRAGMA synchronous=OFF')
        self.cursor = epoch + 1
        self.terminal = None
        self.end_at = None
        self.completed = {'candidate': 0, 'production': 0}
        self.failed = {'candidate': 0, 'production': 0}
        self.attempts = {'candidate': 0, 'production': 0}
        self.last_start = None
        self.steps = self._schedule()
        self.next_start = None        # time of the next event the generator will apply

    @property
    def ledger_pending(self):
        return self.ledger.db.execute('SELECT count(*) FROM attempts WHERE result IS NULL').fetchone()[0]

    def outcome(self, origin):
        self.attempts[origin] += 1
        forced = self.sc['reader_outcomes'].get((origin, self.attempts[origin]))
        if forced is not None:
            return dict(forced)
        sc, r = self.sc, self.rng.random()
        prefix = 'production' if origin == 'production' else 'candidate'
        p429 = sc['production_429'] if prefix == 'production' else 0.0
        p5xx, ptime = sc[prefix + '_5xx'], sc[prefix + '_timeout']
        if r < p429:
            return {'status': 429, 'body_bytes': 0}
        if r < p429 + p5xx:
            return {'status': 503, 'body_bytes': 0}
        if r < p429 + p5xx + ptime:
            return {'error': 'deadline'}
        return {'status': 200, 'body_bytes': 80000}

    def _schedule(self):
        """Generator: yields the time of the next event and applies it when resumed."""
        schedule_epoch = self.clock.epoch + 1
        while True:
            pass_start = self.cursor
            yield pass_start
            due = min((((pass_start - schedule_epoch) // c['interval_seconds']) + 1) * c['interval_seconds'] + schedule_epoch
                      for c in self.cases)
            for case in self.cases:
                self.clock.now = max(self.clock.now, self.cursor)
                slot = int((self.cursor - self.ledger.get('started')) // case['interval_seconds'])
                if not self.ledger.claim_slot(case, slot):
                    continue
                for origin in ('candidate', 'production'):
                    start = max(self.clock.now, self.ledger.get('last_attempt') + 1)
                    yield start
                    self.clock.now = start
                    attempt = self.ledger.reserve(case, slot, origin)
                    if attempt is None:
                        self.terminal, self.end_at = self.ledger.get('terminal') or 'stopped', self.clock.now
                        return
                    self.last_start = start
                    result = self.outcome(origin)
                    seconds = 1.5 if 'status' in result else 20
                    yield start + seconds   # completion event
                    self.clock.now = self.next_start
                    result = self.capture(attempt, result, seconds)
                    self.ledger.finish(attempt, result)
                    key = 'completed' if result.get('status') == 200 else 'failed'
                    getattr(self, key)[origin] += 1
                    if self.ledger.get('terminal') is not None:
                        self.terminal, self.end_at = self.ledger.get('terminal'), self.clock.now
                        return
                self.cursor = max(self.cursor, self.clock.now)
            self.cursor = max(self.cursor, due)

    def capture(self, attempt, outcome, seconds):
        """The worker's files and the sampler's result, as paired_read.capture writes them."""
        if outcome.get('captured') is False:
            # The sampler stopped the child: no files and no body fields (SR-5a).
            return {'error': outcome.get('error', 'deadline'), 'captured': False, 'elapsed_ms': int(seconds * 1000)}
        body = f'{attempt}:{outcome.get("status", outcome.get("error"))}'.encode() if outcome.get('status') == 200 else b''
        meta = {k: v for k, v in outcome.items() if k not in ('body_bytes', 'body_sha256')}
        meta.update(body_bytes=len(body), body_sha256=reader.digest(body))
        (self.directory / f'{attempt}.body').write_bytes(body)
        (self.directory / f'{attempt}.json').write_text(reader.canonical(meta))
        return dict(meta, elapsed_ms=int(seconds * 1000))

    def advance(self, until):
        with patch.object(reader, 'time', self.fake):
            while self.terminal is None:
                if self.next_start is None:
                    try:
                        self.next_start = next(self.steps)
                    except StopIteration:
                        return
                if self.next_start > until:
                    return
                try:
                    self.next_start = next(self.steps)   # applies the event, yields the next time
                except StopIteration:
                    return


def reader_manifest(candidate_sha256):
    cases = [dict(id=f'c{interval}-{i}', path=f'/sim/{interval}/{i}', method='GET',
                  interval_seconds=interval, conditional=False)
             for interval, count in SCHEDULE for i in range(count)]
    return dict(schema=1, duration_seconds=168 * HOUR, max_attempts=5995, min_spacing_seconds=1,
                candidate_sha256=candidate_sha256, cases=cases)


class EvidenceModel:
    """The installed host tree and the run's state bucket, driven by the real copy program.

    The bucket is a directory of object versions; a PUT inside a `copy_failures` window
    fails like an S3 503. The host model calls copy() at each copy start time.
    """
    def __init__(self, root, launch, reader_bytes, sc):
        self.sc, self.root = sc, Path(root) / 'host'
        self.epoch = launch['epoch']
        for directory in ('state', 'data/paired'):
            (self.root / directory).mkdir(parents=True, mode=0o700)
        (self.root / 'launch.json').write_text(state.canonical(launch) + '\n')
        (self.root / 'reader.json').write_bytes(reader_bytes)
        self.paired = self.root / 'data/paired'
        self.tree = evidence_copy.HostTree(self.root / 'launch.json')
        self.bucket = Path(root) / 'bucket'
        self.bucket.mkdir()
        self.objects = []
        self.next_version = 1
        self.lines = []
        self.runs = []
        self.host = None

    def failing(self, at):
        t = at - self.epoch
        return any(start <= t and (end is None or t < end) for start, end in self.sc['copy_failures'])

    def copy(self, at, final):
        clock = [at]

        def put(key, body, sha256, size, time_left):
            if self.failing(at):
                raise evidence_copy.CopyError('put', status=503)
            version = f'v{self.next_version:06d}'
            self.next_version += 1
            path = self.bucket / f'{version}.object'
            path.write_bytes(body if isinstance(body, bytes) else Path(body).read_bytes())
            self.objects.append(dict(bucket=self.tree.bucket, key=key, version=version, kind='object',
                                     size=size, path=path.relative_to(self.root.parent).as_posix()))

        result = evidence_copy.run(self.tree, final=final, put=put, clock=lambda: clock[0],
                                   unit_state=self.host.reader_unit,
                                   sleep=lambda s: clock.__setitem__(0, clock[0] + s), log=self.lines.append)
        self.runs.append(dict(result, at=at, final=final))

def evidence_summary(report, epoch):
    final_at = report.get('at')
    newest = report.get('newest_snapshot_at')
    return dict(status=report.get('status', report.get('reason', 'unverified')),
                complete=report['complete'], kind=report.get('kind'),
                generation=report.get('generation'), reader=report.get('reader'),
                pending=len(report.get('pending', [])), capture_failures=len(report.get('capture_failures', [])),
                missing=len(report.get('missing_or_mismatched', [])), conflicts=len(report.get('conflicts', [])),
                final_at_s=None if final_at is None else round(final_at - epoch, 1),
                newest_snapshot_at_s=None if newest is None else round(newest - epoch, 1),
                source='ssh' if report.get('directory') == 'ssh-paired' else 'bucket')


class SimulationCloud(fx.ProvisionCloud):
    """Expose the copier's actual stored versions to the real finish path."""
    S3 = {'ListObjectVersions': 'list-object-versions', 'GetObject': 'get-object',
          'HeadObject': 'head-object', 'DeleteObjects': 'delete-objects', 'DeleteBucket': 'delete-bucket',
          'GetBucketVersioning': 'get-bucket-versioning', 'GetBucketTagging': 'get-bucket-tagging'}

    def __init__(self, journal, host, evidence, clock):
        super().__init__(journal)
        self.host, self.evidence, self.clock = host, evidence, clock

    def call(self, operation, params, **kwargs):
        observe_host = operation in self.S3 or operation in ('DescribeInstances', 'TerminateInstances')
        if self.instance is not None and observe_host:
            self.host.advance(self.clock.time())
        if operation == 'TerminateInstances':
            self.host.terminate(self.clock.time())
        if operation not in self.S3:
            return super().call(operation, params, **kwargs)

        self.calls.append((operation, params))
        inventory = dict(buckets=list(self.buckets), versions=self.evidence.objects,
                         instance_state=self.instance['State']['Name'] if self.instance else None,
                         resources={'run_id': self.evidence.tree.run_id})
        try:
            reply = fake_aws.s3_reply(self.S3[operation], params, kwargs.get('output'), inventory,
                                     self.evidence.root.parent.resolve())
        except fake_aws.ReplyError as error:
            return state.CloudResult('service_error', operation, code=error.code)
        self.evidence.objects = inventory['versions']
        if operation == 'DeleteBucket':
            self.buckets.pop(params['Bucket'])
        if reply is None:
            return state.CloudResult('empty_success', operation)
        return fx.cloud_json(operation, reply)


class Transport:
    """SSH transport model; inspections advance the host to the operator's clock."""
    def __init__(self, host, sc, rng, clock, launch_sha):
        self.host, self.sc, self.rng, self.clock, self.launch_sha = host, sc, rng, clock, launch_sha
        self.binding = fx.RemoteTests.binding(unittest.TestCase())
        self.polls = 0
        self.poll_failures = 0
        self.export_reachable = None
        self.drained = False
        self.requested_pairs = []

    def ssh_down(self):
        t = self.clock.now - self.clock.epoch
        return any(start <= t and (end is None or t < end) for start, end in self.sc['ssh_down'])

    def invoke(self, action, **kwargs):
        if action == 'install':
            return state.CloudResult('empty_success', 'HostInstall')
        now = self.clock.time()
        self.host.advance(now)
        if action in ('finish-finalize', 'finish-drain', 'stop'):
            if self.ssh_down() or self.sc['ssh_recovery_failure']:
                return state.CloudResult('timeout', 'HostObserve')
            if action in ('finish-finalize', 'stop'):
                copies = self.host.evidence.runs
                started = len(copies)
                self.host.operator_stop(now)
                if action == 'finish-finalize':
                    if len(copies) == started:
                        self.host._finalize(now)
                    if copies[-1]['status'] not in ('committed', 'skipped'):
                        return state.CloudResult('command_error', 'HostObserve')
            if action in ('finish-drain', 'stop'):
                self.drained = True
            return state.CloudResult('empty_success', 'HostObserve')
        if action in ('finish-ledger', 'finish-pairs', 'export'):
            self.export_reachable = not (self.ssh_down() or self.sc['ssh_recovery_failure'])
            if not self.export_reachable or self.host.reader_active() or action == 'export':
                return state.CloudResult('timeout', 'HostEvidence')
            return self.export(action, **kwargs)
        self.polls += 1
        if self.ssh_down() or self.rng.random() < self.sc['poll_failure']:
            self.poll_failures += 1
            return state.CloudResult('timeout', 'HostObserve')
        state_of = lambda active: 'active' if active else 'inactive'
        states = dict(candidate=state_of(self.host.group_active()), reader=state_of(self.host.reader_active()),
                      guard=state_of(self.host.group_active()),
                      # The log collector keeps running until the operator's stop.
                      logs=state_of(not self.drained and self.host.terminated_at is None))
        return fx.cloud_json('HostObserve', dict(
            status='started', launch_sha256=self.launch_sha, epoch=self.clock.epoch, collection_until=self.clock.deadline,
            cleanup_until=self.clock.epoch + 170 * HOUR, unit_states=states))

    def export(self, action, *, destination, limit, timeout, attempts=None):
        evidence = self.host.evidence
        with tempfile.TemporaryDirectory(dir=evidence.root) as work:
            if action == 'finish-ledger':
                snapshot = Path(work) / 'ledger.sqlite3'
                deadline = time.monotonic() + timeout
                evidence_copy.snapshot(evidence.tree, snapshot, True, lambda: deadline - time.monotonic())
                files = {'launch.json': evidence.root / 'launch.json', 'reader.json': evidence.root / 'reader.json',
                         'data/paired/ledger.sqlite3': snapshot}
            else:
                self.requested_pairs.extend(attempts)
                files = {f'data/paired/{i}.{suffix}': evidence.paired / f'{i}.{suffix}'
                         for i in attempts for suffix in ('body', 'json')}
            with destination.open('xb') as stream:
                destination.chmod(0o600)
                with tarfile.open(fileobj=stream, mode='w', format=tarfile.USTAR_FORMAT) as archive:
                    for name, path in sorted(files.items()):
                        archive.add(path, arcname=name, recursive=False)
        size = destination.stat().st_size
        assert 0 < size <= limit, 'simulated SSH tar exceeded its reserved limit'
        return fx.cloud_json('HostEvidence', {'archive_bytes': size})


def run_once(sc, seed):
    rng = random.Random(seed)
    measured = sc.get('measured')
    epoch = EPOCH if measured is None else measured.epoch
    with tempfile.TemporaryDirectory(prefix='shadow-sim-') as temp, contextlib.ExitStack() as stack:
        root = Path(temp)
        stack.enter_context(patch.object(provision, 'IAM_PROPAGATION_SECONDS', 0))
        source, host_plan = fx.HostBundleTests.files(unittest.TestCase(), root)
        # The reader manifest is a pinned artifact: the audit binds it through the contract.
        manifest = reader_manifest(host_plan['artifacts']['server2'])
        (source / 'reader.json').write_text(json.dumps(manifest))
        host_plan['artifacts']['reader.json'] = operator.artifact_hash(source / 'reader.json')
        allowance = dict(reads=10, writes=20, put_bytes=30)
        if measured is not None:
            allowance = measured.allowance
            host_plan.update(cost_policy=measured.cost_policy, paid_policy=measured.paid_policy)
        plan = dict(host=host_plan, cloud=fx.provisioning_plan(), allowance=allowance)
        provision.prepare_run(plan, source, root / 'run', root / 'bundle', now=epoch)
        clock = SimTime(epoch)
        stack.enter_context(patch.object(provision, 'time', clock))
        launch = operator.verify_bundle(root / 'bundle')
        launch_sha = operator.hashlib.sha256((state.canonical(launch) + '\n').encode()).hexdigest()
        evidence = EvidenceModel(root, launch, (root / 'bundle/reader.json').read_bytes(), sc)
        identity = dict(manifest=manifest, candidate='http://127.0.0.1:%d' % launch['plan']['port'],
                        production=reader.PRODUCTION, loopback_test=False,
                        sampler_sha256=launch['plan']['artifacts']['paired_read.py'])
        host = Host(sc, rng, clock, evidence.paired, evidence=evidence, manifest=manifest, identity=identity)
        with fx.J(root / 'run') as journal:
            cloud = SimulationCloud(journal, host, evidence, clock)
            transport = Transport(host, sc, rng, clock, launch_sha)

            def connect(c, j, resources, *, now):
                if j.request('ssh-target') is None:
                    j.prepare_request('ssh-target', 'BindSshTarget', transport.binding, transport.binding['instance'], now=now)
                    j.record_receipt('ssh-target', fx.cloud_json('BindSshTarget', {'bound': True}))
                return provision.BudgetedRemote(transport, j)

            result = provision.lifecycle(cloud, journal, plan['cloud'], root / 'bundle', root / 'result', connect,
                                         clock=clock.time, sleep=clock.sleep)
            before_retry = result['cleanup'].get('fence', {}).get('status')
            if sc['finish_retry_at'] is not None and not result['cleanup']['complete']:
                retry_at = epoch + sc['finish_retry_at']
                if retry_at < clock.now:
                    raise ValueError('explicit finish retry precedes the initial finish')
                clock.now = retry_at
                renewed = provision.finish_run(cloud, transport, journal, root / 'result', now=int(clock.now))
                result = dict(result, host_evidence=renewed['host_evidence'], cleanup=renewed['cleanup'])
        end = min(host.collection_end(), clock.now)
        cause = host.stop_cause()
        retained = evidence_summary(result['host_evidence'], epoch)
        operations = [operation for operation, _ in cloud.calls]
        return dict(
            seed=seed,
            operator_stop=result['stop_reason'],
            failure_class=result.get('failure_class'),
            host_stop=cause,
            collected_hours=round(max(0.0, (end - epoch) / HOUR), 3),
            full_run=(end >= clock.deadline and result['stop_reason'] == 'collection_deadline'
                      and cause in (None, 'operator-stop', 'stop-timer', 'guard:collection_deadline')),
            evidence_retrievable=retained['complete'],
            qualification=result.get('qualification'),
            evidence=retained,
            ssh_export_reachable=bool(transport.export_reachable),
            ssh_requested_pairs=transport.requested_pairs,
            finish_fence_before_retry=before_retry,
            finish_fence=result['cleanup'].get('fence', {}).get('status'),
            state_disposition=result['cleanup'].get('state', {}).get('status'),
            terminated_at_s=None if host.terminated_at is None else round(host.terminated_at - epoch, 1),
            bucket_get_before_terminate=('GetObject' in operations and 'TerminateInstances' in operations
                                         and operations.index('GetObject') < operations.index('TerminateInstances')),
            copy_runs=len(evidence.runs),
            copy_failures=sum(r['status'] == 'failed' for r in evidence.runs),
            cleanup_complete=bool(result['cleanup'].get('complete')),
            instances_launched=sum(op == 'RunInstances' for op, _ in cloud.calls),
            polls=transport.polls, poll_failures=transport.poll_failures,
            completed_pairs=min(host.reader.completed.values()),
            reader_failed=host.reader.failed, reader_terminal=host.reader.terminal,
            guard_diagnostics=(host.decision or {}).get('diagnostics'),
            guard_stop=(host.decision or {}).get('stop'),
            guard_samples_after_reader_exit=host.guard_samples_after_reader_exit,
            last_guard_step_s=host.stepped - epoch,
            group_end_s=None if host.group_end is None else round(host.group_end - epoch, 1),
            operator_stop_after_group_end_s=(None if host.operator_end is None or host.group_end is None
                                             or host.group_end == host.operator_end
                                             else round(host.operator_end - host.group_end, 1)),
            reader_last_start_s=None if host.reader.last_start is None else round(host.reader.last_start - epoch, 1),
            reader_pending=host.reader.ledger_pending,
            operator_stop_after_reader_exit_s=(None if host.reader_end is None or host.operator_end is None
                                               else round(host.operator_end - host.reader_end, 1)),
        )


def summarize(name, runs):
    full = sum(r['full_run'] for r in runs)
    hours = sorted(r['collected_hours'] for r in runs)
    stops = {}
    for r in runs:
        key = r['host_stop'] or r['operator_stop']
        stops[key] = stops.get(key, 0) + 1
    return dict(scenario=name, seeds=len(runs), full_runs=full,
                median_collected_hours=hours[len(hours) // 2], min_collected_hours=hours[0],
                evidence_retrievable=sum(r['evidence_retrievable'] for r in runs),
                evidence_status={s: sum(r['evidence']['status'] == s for r in runs)
                                 for s in sorted({r['evidence']['status'] for r in runs})},
                ssh_export_reachable=sum(r['ssh_export_reachable'] for r in runs),
                cleanup_complete=sum(r['cleanup_complete'] for r in runs),
                stop_reasons=stops)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--seeds', type=int, help='number of seeds (legacy default 5, measured default 20)')
    parser.add_argument('--scenario', action='append', choices=SCENARIOS)
    parser.add_argument('--measurement', type=Path, help='complete 24-hour rehearsal report')
    parser.add_argument('--measured-policy', type=Path, help='frozen allocation and pricing plan for the measured mode')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args(argv)
    if (args.measurement is None) != (args.measured_policy is None) or (args.measurement and args.scenario):
        parser.error('--measurement and --measured-policy must be supplied together without --scenario')
    if args.seeds is not None and args.seeds < 1:
        parser.error('--seeds must be positive')
    evidence = None
    epoch = EPOCH
    if args.measurement is not None:
        try:
            scenario, evidence = measured_scenario(args.measurement, args.measured_policy)
        except (OSError, ValueError, RecursionError) as error:
            parser.error(str(error))
        selected = [scenario]
        epoch = scenario['measured'].epoch
    else:
        selected = [SCENARIOS[name] for name in (args.scenario or SCENARIOS)]
    count = args.seeds if args.seeds is not None else (20 if evidence is not None else 5)
    report = {'epoch': epoch, 'deadline_hours': 168, 'scenarios': {}, 'runs': {}}
    if evidence is not None:
        report['measurement'] = evidence
    for scenario in selected:
        name = scenario['name']
        runs = [run_once(scenario, seed) for seed in range(count)]
        report['scenarios'][name] = summarize(name, runs)
        report['runs'][name] = runs
        print(json.dumps(report['scenarios'][name], ensure_ascii=False), flush=True)
    if evidence is not None:
        evidence['seed_acceptance'] = None if count != 20 else report['scenarios']['measured-24h']['full_runs'] >= 19
    if args.output:
        args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
