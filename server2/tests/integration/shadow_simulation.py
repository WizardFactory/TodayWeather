#!/usr/bin/env python3
"""Offline 168-hour shadow-run simulation over the real decision code.

Real code: provision.lifecycle and its SQLite journal, guard.evaluate and
estimate_cost, and paired_read.Ledger (admission, failure counting and terminal
rules). Simulated: the clock, AWS (the ProvisionCloud fixture), SSH, the host's
metrics/proc samples and HTTP outcomes. No network, AWS or server process.

Limitations: the reader's scheduling loop is re-implemented here around the real
Ledger; host evidence export is modelled as "retrievable" when SSH is reachable at
export time rather than by building a real archive; the log collector (#2977) is
modelled only as a reported unit state; operator process death and host reboot are
not modelled. Fault rates are scenario inputs, not measurements.

Usage: python3 tests/integration/shadow_simulation.py [--seeds N] [--scenario NAME] [--output FILE]
"""
from __future__ import annotations

import argparse
import contextlib
import importlib.util
import json
import random
import sys
import tempfile
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

HOUR = 3600
EPOCH = 1000
DEADLINE = EPOCH + 168 * HOUR
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
    'realistic-combined': default_scenario(name='realistic-combined', poll_failure=1e-4, sample_failure=1e-6,
                                           quota_events_per_hour=1 / 24, production_5xx=1e-3, production_timeout=1e-4,
                                           production_429=1e-5, ssh_down=[(14 * HOUR, 22 * HOUR)]),
}


class SimTime:
    """One clock shared by the operator, guard and reader models."""
    def __init__(self):
        self.now = float(EPOCH + 1)

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
    def __init__(self, sc, rng, clock, workdir):
        self.sc, self.rng, self.clock = sc, rng, clock
        self.manifest = fx.host_manifest()
        self.manifest.update(epoch=EPOCH, tx_origin=0,
                             allowance=dict(reads=90000, writes=90000, put_bytes=2 * GIB))
        self.manifest['cost_policy']['rates'] = dict(RATES)
        self.manifest['cost_policy']['observed_at'] = EPOCH
        guard.validate(self.manifest)
        self.decision = None
        self.stepped = EPOCH          # time of the last guard step
        self.events = []              # (time, order, cause)
        self.group_end = None         # candidate and guard (and reader) stopped
        self.reader_end = None        # reader process exit on its own terminal state
        self.operator_end = None
        self.candidate_exit = None if sc['candidate_exit_at'] is None else EPOCH + sc['candidate_exit_at']
        self.guard_samples_after_reader_exit = 0
        self.quota = 0
        if sc['quota_first_at'] is not None:
            self.next_quota = EPOCH + sc['quota_first_at']
        else:
            self.next_quota = self._next_event(EPOCH)
        self.reader = ReaderModel(sc, rng, workdir)

    def _next_event(self, start):
        rate = self.sc['quota_events_per_hour']
        return start + self.rng.expovariate(rate / HOUR) if rate else float('inf')

    def _record(self, at, cause):
        self.events.append((at, len(self.events), cause))

    def _end_group(self, at, cause):
        if self.group_end is None:
            self.group_end = at
            self._record(at, cause)

    def group_active(self):
        return self.group_end is None

    def reader_active(self):
        return self.group_end is None and self.reader_end is None

    def collection_end(self):
        ends = [x for x in (self.reader_end, self.group_end) if x is not None]
        return min(ends + [DEADLINE])

    def stop_cause(self):
        return min(self.events)[2] if self.events else None

    def operator_stop(self, at):
        self.operator_end = at
        self._end_group(at, 'operator-stop')

    def sample(self, t):
        sc = self.sc
        if self.rng.random() < sc['sample_failure']:
            return None
        elapsed_h = (t - EPOCH) / HOUR
        while self.next_quota <= t:
            self.quota += 1
            self.next_quota = self._next_event(self.next_quota)
        s = fx.host_sample(self.manifest)
        s.update(observed_at=int(t), tx_bytes=int(sc['tx_bytes_per_hour'] * elapsed_h),
                 cpu_seconds=int(2 * sc['cpu_busy_fraction'] * (t - EPOCH)))
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
        if at is not None and t >= EPOCH + at:
            s['metrics']['storage_auth_failures'] = guard.STORAGE_AUTH_LIMIT + int((t - EPOCH - at) // 10)
        return s

    def _reader_to(self, t):
        if self.reader_active():
            self.reader.advance(t)
            if self.reader.terminal is not None:
                self.reader_end = self.reader.end_at
                self._record(self.reader_end, 'reader:' + self.reader.terminal)

    def advance(self, until):
        """Apply every event up to `until` in time order."""
        while self.group_active():
            step = self.stepped + 10
            target = min(step, until)
            if self.candidate_exit is not None and self.candidate_exit <= target:
                self._reader_to(self.candidate_exit)
                self._end_group(self.candidate_exit, 'candidate-exit')
                break
            self._reader_to(target)
            if step > until:
                break
            self.stepped = step
            if self.reader_end is not None and step > self.reader_end:
                self.guard_samples_after_reader_exit += 1
            self.decision = guard.evaluate(self.manifest, self.sample(step), self.decision, int(step))
            if self.decision['stop']:
                self._end_group(step, 'guard:' + self.decision['stop'])


class ReaderModel:
    """Real Ledger decisions; scheduling mirrors paired_read.execute.

    A request has two events: it starts (the attempt is reserved in the ledger) and it
    completes (its result is applied). advance(until) applies only events at or before
    `until`, so a request can be in flight across the bound and stays pending if the
    reader is not advanced again. The reader runs concurrently with the operator and the
    guard, so its request durations advance its own clock only.
    """
    def __init__(self, sc, rng, workdir):
        self.sc, self.rng = sc, rng
        self.cases = []
        for interval, count in SCHEDULE:
            for i in range(count):
                self.cases.append(dict(id=f'c{interval}-{i}', path=f'/sim/{interval}/{i}', method='GET',
                                       interval_seconds=interval, conditional=False))
        manifest = dict(schema=1, duration_seconds=168 * HOUR, max_attempts=5995, min_spacing_seconds=1,
                        candidate_sha256='a' * 64, cases=self.cases)
        identity = {'manifest': manifest, 'candidate': 'c', 'production': 'p', 'loopback_test': True,
                    'sampler_sha256': 'b' * 64}
        self.clock = SimTime()
        self.fake = types.SimpleNamespace(time=self.clock.time, monotonic=self.clock.monotonic, sleep=self.clock.sleep)
        with patch.object(reader, 'time', self.fake):
            self.ledger = reader.Ledger(Path(workdir), identity, False)
        self.ledger.db.execute('PRAGMA synchronous=OFF')
        self.cursor = EPOCH + 1
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
        while True:
            pass_start = self.cursor
            yield pass_start
            due = min((((pass_start - EPOCH - 1) // c['interval_seconds']) + 1) * c['interval_seconds'] + EPOCH + 1
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
                    yield start + (1.5 if 'status' in result else 20)   # completion event
                    self.clock.now = self.next_start
                    self.ledger.finish(attempt, result)
                    key = 'completed' if result.get('status') == 200 else 'failed'
                    getattr(self, key)[origin] += 1
                    if self.ledger.get('terminal') is not None:
                        self.terminal, self.end_at = self.ledger.get('terminal'), self.clock.now
                        return
                self.cursor = max(self.cursor, self.clock.now)
            self.cursor = max(self.cursor, due)

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


class Transport:
    """SSH transport model; inspections advance the host to the operator's clock."""
    def __init__(self, host, sc, rng, clock, launch_sha):
        self.host, self.sc, self.rng, self.clock, self.launch_sha = host, sc, rng, clock, launch_sha
        self.binding = fx.RemoteTests.binding(unittest.TestCase())
        self.polls = 0
        self.poll_failures = 0
        self.export_reachable = None

    def ssh_down(self):
        t = self.clock.now - EPOCH
        return any(start <= t and (end is None or t < end) for start, end in self.sc['ssh_down'])

    def invoke(self, action, **kwargs):
        if action == 'install':
            return state.CloudResult('empty_success', 'HostInstall')
        now = min(self.clock.now, DEADLINE)
        self.host.advance(now)
        if action == 'stop':
            if self.ssh_down():
                return state.CloudResult('timeout', 'HostObserve')
            self.host.operator_stop(now)
            return state.CloudResult('empty_success', 'HostObserve')
        if action == 'export':
            self.export_reachable = not self.ssh_down()
            return state.CloudResult('timeout', 'HostEvidence')
        self.polls += 1
        if self.ssh_down() or self.rng.random() < self.sc['poll_failure']:
            self.poll_failures += 1
            return state.CloudResult('timeout', 'HostObserve')
        state_of = lambda active: 'active' if active else 'inactive'
        states = dict(candidate=state_of(self.host.group_active()), reader=state_of(self.host.reader_active()),
                      guard=state_of(self.host.group_active()),
                      # The log collector keeps running until the operator's stop.
                      logs=state_of(self.host.operator_end is None))
        return fx.cloud_json('HostObserve', dict(
            status='started', launch_sha256=self.launch_sha, epoch=EPOCH, collection_until=DEADLINE,
            cleanup_until=EPOCH + 170 * HOUR, unit_states=states))


def run_once(sc, seed):
    rng = random.Random(seed)
    with tempfile.TemporaryDirectory(prefix='shadow-sim-') as temp, contextlib.ExitStack() as stack:
        root = Path(temp)
        stack.enter_context(patch.object(provision, 'IAM_PROPAGATION_SECONDS', 0))
        source, host_plan = fx.HostBundleTests.files(unittest.TestCase(), root)
        plan = dict(host=host_plan, cloud=fx.provisioning_plan(), allowance=dict(reads=10, writes=20, put_bytes=30))
        provision.prepare_run(plan, source, root / 'run', root / 'bundle', now=EPOCH)
        clock = SimTime()
        (root / 'ledger').mkdir()
        host = Host(sc, rng, clock, root / 'ledger')
        with fx.J(root / 'run') as journal:
            cloud = fx.ProvisionCloud(journal)
            launch = operator.verify_bundle(root / 'bundle')
            launch_sha = operator.hashlib.sha256((state.canonical(launch) + '\n').encode()).hexdigest()
            transport = Transport(host, sc, rng, clock, launch_sha)

            def connect(c, j, resources, *, now):
                j.prepare_request('ssh-target', 'BindSshTarget', transport.binding, transport.binding['instance'], now=now)
                j.record_receipt('ssh-target', fx.cloud_json('BindSshTarget', {'bound': True}))
                return provision.BudgetedRemote(transport, j)

            result = provision.lifecycle(cloud, journal, plan['cloud'], root / 'bundle', root / 'result', connect,
                                         clock=clock.time, sleep=clock.sleep)
        host.advance(min(clock.now, DEADLINE))
        end = min(host.collection_end(), clock.now)
        cause = host.stop_cause()
        return dict(
            seed=seed,
            operator_stop=result['stop_reason'],
            failure_class=result.get('failure_class'),
            host_stop=cause,
            collected_hours=round(max(0.0, (end - EPOCH) / HOUR), 3),
            full_run=(result['stop_reason'] == 'collection_deadline' and cause in (None, 'operator-stop', 'guard:collection_deadline')),
            evidence_retrievable=bool(transport.export_reachable),
            cleanup_complete=bool(result['cleanup'].get('complete')),
            instances_launched=sum(op == 'RunInstances' for op, _ in cloud.calls),
            polls=transport.polls, poll_failures=transport.poll_failures,
            completed_pairs=min(host.reader.completed.values()),
            reader_failed=host.reader.failed, reader_terminal=host.reader.terminal,
            guard_diagnostics=(host.decision or {}).get('diagnostics'),
            guard_stop=(host.decision or {}).get('stop'),
            guard_samples_after_reader_exit=host.guard_samples_after_reader_exit,
            last_guard_step_s=host.stepped - EPOCH,
            group_end_s=None if host.group_end is None else round(host.group_end - EPOCH, 1),
            operator_stop_after_group_end_s=(None if host.operator_end is None or host.group_end is None
                                             or host.group_end == host.operator_end
                                             else round(host.operator_end - host.group_end, 1)),
            reader_last_start_s=None if host.reader.last_start is None else round(host.reader.last_start - EPOCH, 1),
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
                cleanup_complete=sum(r['cleanup_complete'] for r in runs),
                stop_reasons=stops)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--seeds', type=int, default=5)
    parser.add_argument('--scenario', action='append')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args(argv)
    names = args.scenario or list(SCENARIOS)
    report = {'epoch': EPOCH, 'deadline_hours': 168, 'scenarios': {}, 'runs': {}}
    for name in names:
        runs = [run_once(SCENARIOS[name], seed) for seed in range(args.seeds)]
        report['scenarios'][name] = summarize(name, runs)
        report['runs'][name] = runs
        print(json.dumps(report['scenarios'][name], ensure_ascii=False), flush=True)
    if args.output:
        args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
