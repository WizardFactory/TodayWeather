"""Small replay and input validation checks for measured SR-6 scenarios."""

import contextlib
import copy
import hashlib
import io
import json
import random
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import shadow_simulation as sim
from rehearsal_measurement import Sample, aggregate


class MeasuredSimulationTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.directory = Path(scratch.name)
        start = int(datetime(2026, 11, 16, 12, 30, tzinfo=timezone.utc).timestamp())
        self.epoch = start + 2 * 24 * sim.HOUR
        counts = dict(candidate_s3_reads=20, candidate_s3_writes=10, candidate_s3_put_bytes=100,
                      standin_s3_reads=30, standin_s3_writes=20, standin_s3_put_bytes=200,
                      log_s3_writes=3, log_s3_put_bytes=100, tx_iface_bytes=1000, host_cpu_seconds=600,
                      auth_failures=0, quota_failures=1, storage_auth_failures=0, local_paid_exhaustions=0)
        counts.update({f'paid_units/{provider}': int(provider == 'google') for provider in sim.guard.PAID_PROVIDERS})
        counts.update({f'provider_http/{source}/{status}': int(source == 'vilage_fcst' and status == '429')
                       for source in sim.guard.PROVIDER_SOURCES for status in ('401', '403', '429')})
        sample_identity = ('b' * 36, 123, 456)
        samples = [Sample(sec, sec, start + sec, sample_identity,
                          {name: amount * sec // sim.HOUR for name, amount in counts.items()},
                          {'free_bytes': 10 * sim.GIB, 'candidate_rss_bytes': 128 * 1024 * 1024})
                   for sec in range(0, 24 * sim.HOUR + 1, 360)]
        self.report = aggregate(samples, start_utc=start, through=24 * sim.HOUR, cadence=360)
        self.report.update(run_id='test-measurement', source_commit='c' * 40,
                           artifact_sha256={name: 'd' * 64 for name in ('server', 'collector', 'launch', 'reader')})
        self.measurement = self.directory / 'measurement.json'
        self.policy_path = self.directory / 'policy.json'
        self.policy = dict(schema=1, planned_epoch=self.epoch, allowance={'reads': 6720, 'writes': 3360, 'put_bytes': 33600},
                           cost_policy=dict(sim.fx.cost_policy(), observed_at=self.epoch - 120, prior_spend_usd='1.25'),
                           paid_policy=dict(sim.fx.paid_policy(), observed_at=self.epoch - 240))

    def load(self):
        raw = json.dumps(self.report).encode()
        self.measurement.write_bytes(raw)
        policy = self.policy | {'measurement_sha256': hashlib.sha256(raw).hexdigest()}
        self.policy_path.write_text(json.dumps(policy))
        return sim.measured_scenario(self.measurement, self.policy_path)

    def test_verified_trace_replays_s3_tx_cpu_paid_and_actual_status_counts(self):
        scenario, evidence = self.load()
        host = sim.Host(scenario, random.Random(0), sim.SimTime(self.epoch), self.directory)
        self.addCleanup(host.reader.ledger.close)
        observation = host.sample(self.epoch + sim.HOUR + sim.HOUR // 2)
        self.assertEqual(host.manifest['allowance'], self.policy['allowance'])
        self.assertEqual(host.manifest['cost_policy'], self.policy['cost_policy'])
        self.assertEqual(observation['metrics']['s3_reads'], 6690)
        self.assertEqual(observation['metrics']['s3_writes'], 3345)
        self.assertEqual(observation['metrics']['s3_put_bytes'], 33450)
        self.assertEqual(observation['tx_bytes'], 1800)
        self.assertEqual(observation['cpu_seconds'], 900)
        self.assertEqual(observation['diagnostics']['paid_units']['google'], {'initial': 400, 'remaining': 399})
        self.assertEqual(observation['diagnostics']['provider_http'], {'vilage_fcst': {'429': 1}})
        self.assertEqual(evidence['projection']['counter_totals_168h']['standin_s3_writes'], 3360)
        self.assertEqual(evidence['estimate_168h']['stop'], None)
        self.assertEqual(scenario['production_5xx'], sim.SCENARIOS['realistic-combined']['production_5xx'])

    def test_disk_loss_accumulates_and_reaches_guard_reserve(self):
        # A small daily fixture makes the disk stop reachable in a later week slot.
        start_free = 9 * sim.GIB
        hourly_loss = sim.GIB // 24
        for hour, row in enumerate(self.report['hours']):
            row['minimum_free_bytes'] = start_free - hour * hourly_loss
        scenario, evidence = self.load()
        host = sim.Host(scenario, random.Random(0), sim.SimTime(self.epoch), self.directory)
        self.addCleanup(host.reader.ledger.close)
        day = 24 * sim.HOUR
        self.assertEqual(host.sample(self.epoch + day)['free_bytes'], start_free - 24 * hourly_loss)
        near_limit = self.epoch + 4 * day
        sample = host.sample(near_limit)
        self.assertLess(sample['free_bytes'], 6 * sim.GIB)
        self.assertEqual(sim.guard.evaluate(host.manifest, sample, None, near_limit)['stop'], 'disk_reserve')
        disk = evidence['disk_projection']
        self.assertEqual(disk['weekly_loss_bytes'], 168 * hourly_loss)
        self.assertEqual(disk['required_starting_free_bytes'], 6 * sim.GIB + 2 * 168 * hourly_loss)
        self.assertFalse(disk['twofold_headroom_fits'])

    def test_disk_reclaim_does_not_create_replay_capacity(self):
        start_free = 10 * sim.GIB
        for i, row in enumerate(self.report['hours']):
            row['minimum_free_bytes'] = start_free - (i % 2) * 100
        scenario, evidence = self.load()
        self.assertEqual(evidence['disk_projection']['daily_loss_bytes'], 1300)
        host = sim.Host(scenario, random.Random(0), sim.SimTime(self.epoch), self.directory)
        self.addCleanup(host.reader.ledger.close)
        self.assertEqual(host.sample(self.epoch + 2 * sim.HOUR)['free_bytes'], start_free - 100)

    def test_missing_provenance_timing_and_limit_fail_before_start(self):
        baseline = copy.deepcopy(self.report)
        for damage, expected_error in (
            (lambda r: r.pop('artifact_sha256'), 'artifact provenance'),
            (lambda r: r.update(elapsed_through=24 * sim.HOUR - 1), '24-hour'),
            (lambda r: r['hours'][8].update(missed_samples=1), 'hour'),
            (lambda r: r.update(kst_midnight_elapsed=0), 'midnight'),
        ):
            self.report = copy.deepcopy(baseline)
            damage(self.report)
            with self.subTest(expected_error=expected_error), self.assertRaisesRegex(ValueError, expected_error):
                self.load()
        self.report = baseline
        self.policy['allowance']['reads'] -= 1
        with self.assertRaisesRegex(ValueError, '2×.*reads'):
            self.load()
        self.policy['allowance']['reads'] = 1_740_001
        with self.assertRaisesRegex(ValueError, 'cap.*reads'):
            self.load()

    def test_frozen_policy_rejects_bad_hash_freshness_and_invalid_paid_grant(self):
        self.load()
        self.measurement.write_bytes(self.measurement.read_bytes() + b'\n')
        with self.assertRaisesRegex(ValueError, 'measurement digest'):
            sim.measured_scenario(self.measurement, self.policy_path)
        self.policy['paid_policy']['grants']['initial']['google_geocode'] = 335
        with self.assertRaisesRegex(ValueError, '2×.*google_geocode'):
            self.load()
        self.policy['paid_policy']['grants']['initial']['google_geocode'] = 400
        self.policy['cost_policy']['observed_at'] = 0
        with self.assertRaisesRegex(ValueError, 'freshness'):
            self.load()

    def test_measured_cli_uses_its_own_mode_and_writes_all_runs(self):
        self.load()
        output = self.directory / 'simulation.json'
        base = dict(full_run=True, collected_hours=168, host_stop=None, operator_stop='collection_deadline',
                    evidence_retrievable=True, evidence={'status': 'complete'}, ssh_export_reachable=False,
                    cleanup_complete=True)
        with patch.object(sim, 'run_once', side_effect=lambda sc, seed: base | {'seed': seed}) as run:
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(sim.main(['--measurement', str(self.measurement), '--measured-policy',
                                           str(self.policy_path), '--output', str(output), '--seeds', '2']), 0)
        report = json.loads(output.read_text())
        self.assertEqual(report['epoch'], self.epoch)
        self.assertEqual(report['scenarios']['measured-24h']['full_runs'], 2)
        self.assertEqual([r['seed'] for r in report['runs']['measured-24h']], [0, 1])
        self.assertEqual(report['measurement']['source_commit'], 'c' * 40)
        self.assertIsNone(report['measurement']['seed_acceptance'])
        self.assertEqual(run.call_count, 2)

        with patch.object(sim, 'run_once', side_effect=lambda sc, seed: base | {'seed': seed, 'full_run': seed != 19}):
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(sim.main(['--measurement', str(self.measurement), '--measured-policy',
                                           str(self.policy_path), '--output', str(output)]), 0)
        qualified = json.loads(output.read_text())
        self.assertEqual(qualified['scenarios']['measured-24h']['seeds'], 20)
        self.assertEqual(qualified['scenarios']['measured-24h']['full_runs'], 19)
        self.assertIs(qualified['measurement']['seed_acceptance'], True)

    def test_projected_cost_reports_headroom_and_exhaustion(self):
        _, fits = self.load()
        self.assertIs(fits['projected_budget_fits'], True)
        self.assertGreater(float(fits['projected_headroom_usd']), 0)

        for row in self.report['hours']:
            row['counters']['tx_iface_bytes'] = 20_000_000_000
        _, exhausts = self.load()
        self.assertIs(exhausts['projected_budget_fits'], False)
        self.assertLess(float(exhausts['projected_headroom_usd']), 0)
        self.assertEqual(exhausts['estimate_168h']['stop'], 'cost_ceiling')

    def test_actual_lifecycle_uses_the_measured_epoch_and_policy(self):
        scenario, _ = self.load()
        # Simulate a crash to exercise the real bundle, guard and finish quickly.
        with patch.object(sim.provision, 'prepare_run', wraps=sim.provision.prepare_run) as prepare:
            run = sim.run_once(scenario | {'candidate_exit_at': 20}, 0)
        plan = prepare.call_args.args[0]
        self.assertEqual(prepare.call_args.kwargs['now'], self.epoch)
        self.assertEqual(plan['allowance'], self.policy['allowance'])
        self.assertEqual(plan['host']['cost_policy'], self.policy['cost_policy'])
        self.assertEqual(plan['host']['paid_policy'], self.policy['paid_policy'])
        self.assertEqual(run['host_stop'], 'candidate-exit')
        self.assertEqual(run['group_end_s'], 20)
        self.assertTrue(run['evidence_retrievable'], run['evidence'])
        self.assertTrue(run['cleanup_complete'])


if __name__ == '__main__':
    unittest.main()
