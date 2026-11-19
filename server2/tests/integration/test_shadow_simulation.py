#!/usr/bin/env python3
"""Short deterministic subset of the 168-hour supervisor simulation (SR-1, #2999).

The full matrix runs on demand: python3 tests/integration/shadow_simulation.py --seeds 20
"""
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('shadow_simulation', Path(__file__).with_name('shadow_simulation.py'))
sim = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sim)


class SimulationSubsetTests(unittest.TestCase):
    def test_no_fault_run_reaches_the_deadline_and_cleans_up(self):
        run = sim.run_once(sim.SCENARIOS['ideal'], 0)
        self.assertTrue(run['full_run'], run)
        self.assertEqual(run['collected_hours'], 168.0)
        self.assertEqual(run['operator_stop'], 'collection_deadline')
        self.assertTrue(run['evidence_retrievable'])
        # SR-5a (#3003): judged from the modelled state bucket by the real copy and audit.
        self.assertEqual(run['evidence']['status'], 'complete', run['evidence'])
        self.assertEqual(run['evidence']['kind'], 'final')
        self.assertEqual(run['evidence']['reader'], {'state': 'inactive', 'stopped': True})
        self.assertEqual((run['evidence']['missing'], run['evidence']['conflicts']), (0, 0))
        self.assertTrue(run['cleanup_complete'])
        self.assertEqual(run['instances_launched'], 1)
        # One status poll per minute for 168 hours, plus the first poll at the start of
        # collection and the finish's post-stop inspection.
        self.assertEqual(run['polls'], 10082)
        self.assertEqual(run['completed_pairs'], 5852)

    def test_provider_rejections_are_recorded_and_never_stop(self):
        # SR-3 (#3001): provider 401/403/429 and local budget exhaustion are evidence only.
        for name in ('observed-quota-at-3min', 'shared-key-daily-429'):
            run = sim.run_once(sim.SCENARIOS[name], 0)
            self.assertTrue(run['full_run'], (name, run))
            self.assertEqual(run['collected_hours'], 168.0)
            diagnostics = run['guard_diagnostics']
            self.assertGreater(diagnostics['quota_failures'], 0)
            self.assertEqual(diagnostics['provider_http']['vilage_fcst']['429'], diagnostics['quota_failures'])

    def test_sub_budgets_no_longer_stop_and_the_ceiling_does(self):
        # SR-4 (#3002): measured transmit and S3 rates are priced against one ceiling.
        for name in ('tx-observed-early-rate', 's3-measured-high'):
            run = sim.run_once(sim.SCENARIOS[name], 0)
            self.assertTrue(run['full_run'], (name, run))
            self.assertEqual(run['collected_hours'], 168.0)
        run = sim.run_once(sim.SCENARIOS['cost-ceiling'], 0)
        self.assertEqual(run['host_stop'], 'guard:cost_ceiling', run)
        self.assertLess(run['collected_hours'], 168.0)
        self.assertEqual(run['operator_stop'], 'host_stopped')
        self.assertTrue(run['cleanup_complete'])

    def test_storage_authorization_failure_stops_within_a_sample(self):
        # A broken instance role fails every S3 call and passes the threshold at once.
        run = sim.run_once(sim.SCENARIOS['storage-auth-broken-role'], 0)
        self.assertEqual(run['host_stop'], 'guard:s3_authorization', run)
        self.assertEqual(run['group_end_s'], 3 * 3600)
        self.assertEqual(run['operator_stop'], 'host_stopped')
        self.assertTrue(run['cleanup_complete'])

    def test_candidate_exit_ends_collection_and_keeps_cleanup(self):
        run = sim.run_once(sim.SCENARIOS['candidate-exit-day-3'], 0)
        self.assertFalse(run['full_run'])
        # The candidate's stop hook stops the reader and the guard (CX-SR1-003): the guard
        # makes no decision after the exit, and its last decision has no stop reason.
        self.assertEqual(run['host_stop'], 'candidate-exit')
        self.assertIsNone(run['guard_stop'])
        self.assertLess(run['last_guard_step_s'], 60 * 3600)
        self.assertGreaterEqual(run['last_guard_step_s'], 60 * 3600 - 10)
        self.assertEqual(run['collected_hours'], 60.0)
        # SR-2: the operator finishes because the host reports its units stopped.
        self.assertEqual(run['operator_stop'], 'host_stopped')
        self.assertLessEqual(run['operator_stop_after_group_end_s'], 61)
        self.assertTrue(run['cleanup_complete'])

    def test_reader_never_runs_past_the_time_bound(self):
        # CX-SR1-001: a production 429 on the 56th production request (about 169 s) must not
        # pre-empt a quota signal at 20 s, and no request may start after the bound.
        scenario = sim.default_scenario(name='bound', storage_auth_at=20,
                                        reader_outcomes={('production', 56): {'status': 429, 'body_bytes': 0}})
        run = sim.run_once(scenario, 0)
        self.assertEqual(run['host_stop'], 'guard:s3_authorization', run)
        self.assertLess(run['collected_hours'], 30 / 3600)
        model = sim.ReaderModel(sim.default_scenario(), sim.random.Random(0), self.workdir())
        model.advance(sim.EPOCH + 10)
        started = model.ledger.db.execute('SELECT max(started) FROM attempts').fetchone()[0]
        self.assertLessEqual(started, sim.EPOCH + 10)

    def test_a_result_takes_effect_only_when_the_request_completes(self):
        # CX-SR1-001 (round 2): the first production request starts at 2.5 s and completes
        # at 4 s. At 3 s it is in flight: no terminal state, one pending attempt.
        rejected = sim.default_scenario(reader_outcomes={('production', 1): {'status': 429, 'body_bytes': 0}})
        model = sim.ReaderModel(rejected, sim.random.Random(0), self.workdir())
        model.advance(sim.EPOCH + 3)
        self.assertIsNone(model.terminal)
        self.assertIsNone(model.ledger.get('terminal'))
        self.assertEqual(model.ledger.db.execute('SELECT count(*) FROM attempts WHERE result IS NULL').fetchone()[0], 1)
        model.advance(sim.EPOCH + 4)
        # SR-2: the rejection is recorded with the attempt and the reader goes on.
        self.assertIsNone(model.terminal)
        row = model.ledger.db.execute("SELECT result FROM attempts WHERE origin='production' ORDER BY id LIMIT 1").fetchone()[0]
        self.assertEqual(sim.json.loads(row)['status'], 429)
        self.assertEqual(model.failed['production'], 1)
        # A candidate exit at 3 s comes first: it is the cause, and the request stays pending.
        run = sim.run_once(dict(rejected, candidate_exit_at=3), 0)
        self.assertEqual(run['host_stop'], 'candidate-exit', run)
        self.assertIsNone(run['reader_terminal'])
        self.assertEqual(run['reader_pending'], 1)

    def test_reader_exit_leaves_candidate_and_guard_until_the_operator_stops(self):
        # CX-SR1-002: the reader unit stops alone; the guard keeps deciding until the
        # operator's next poll sees the reader inactive and stops the run. Since SR-2 only a
        # sustained outage ends the reader: production fails every request for 30 minutes.
        scenario = sim.default_scenario(name='reader-exit', production_5xx=1.0)
        run = sim.run_once(scenario, 0)
        self.assertEqual(run['host_stop'], 'reader:origin-outage', run)
        self.assertEqual(run['operator_stop'], 'host_stopped')
        self.assertGreaterEqual(run['collected_hours'], 0.5)
        self.assertLess(run['collected_hours'], 0.52)
        self.assertGreaterEqual(run['guard_samples_after_reader_exit'], 1)
        self.assertLessEqual(run['operator_stop_after_reader_exit_s'], 70)

    def test_a_guard_stop_ends_the_group_at_the_guard_step(self):
        run = sim.run_once(sim.default_scenario(storage_auth_at=20), 0)
        self.assertEqual((run['host_stop'], run['guard_stop']), ('guard:s3_authorization', 's3_authorization'))
        self.assertEqual(run['group_end_s'], 20)
        self.assertEqual(run['reader_last_start_s'] <= 20, True)

    def test_isolated_transient_failures_do_not_end_the_run(self):
        # SR-2: operator poll failures, guard sample failures and production errors at these
        # rates are recorded and the run reaches its deadline.
        for name in ('poll-failure-1e-3', 'sample-failure-1e-5', 'production-transient-1e-3', 'production-429-1e-4'):
            run = sim.run_once(sim.SCENARIOS[name], 0)
            self.assertTrue(run['full_run'], (name, run))
            self.assertEqual(run['collected_hours'], 168.0)

    def test_bucket_evidence_survives_an_operator_unreachable_at_the_deadline(self):
        # SR-5a: SSH is down from day 3 or from the last hour; the hourly copies and the
        # 168-hour stop's final copy keep complete evidence in the state bucket.
        for name in ('operator-ip-change-day-3', 'operator-unreachable-at-deadline'):
            run = sim.run_once(sim.SCENARIOS[name], 0)
            self.assertFalse(run['ssh_export_reachable'], name)
            self.assertTrue(run['evidence_retrievable'], (name, run['evidence']))
            self.assertEqual((run['evidence']['status'], run['evidence']['kind']), ('complete', 'final'), name)
            self.assertTrue(run['cleanup_complete'], name)

    def test_a_failed_final_copy_is_recovered_by_the_next_hourly_copy(self):
        run = sim.run_once(sim.SCENARIOS['final-copy-fails-hourly-recovers'], 0)
        self.assertEqual(run['host_stop'], 'candidate-exit', run)
        self.assertEqual(run['evidence']['status'], 'complete', run['evidence'])
        # The hourly timer is a wall-clock calendar timer: the first full hour after the failure.
        self.assertEqual(run['evidence']['final_at_s'], 61 * 3600 - sim.EPOCH)
        self.assertGreaterEqual(run['copy_failures'], 1)

    def test_a_final_copy_failing_at_the_deadline_leaves_the_tail_unverified(self):
        scenario = sim.default_scenario(name='final-fails', copy_failures=[(168 * 3600 - 60, None)])
        run = sim.run_once(scenario, 0)
        self.assertFalse(run['evidence_retrievable'])
        self.assertEqual(run['evidence']['status'], 'tail_unverified', run['evidence'])
        self.assertEqual(run['evidence']['newest_snapshot_at_s'], 168 * 3600 - sim.EPOCH)

    def test_a_failed_reader_gets_a_final_generation_and_capture_failures_need_no_files(self):
        scenario = dict(sim.SCENARIOS['reader-failed'],
                        reader_outcomes={('candidate', 2): {'error': 'deadline', 'captured': False}})
        run = sim.run_once(scenario, 0)
        self.assertEqual(run['host_stop'], 'reader:origin-outage', run)
        self.assertEqual(run['evidence']['status'], 'complete', run['evidence'])
        self.assertEqual(run['evidence']['reader'], {'state': 'failed', 'stopped': True})
        self.assertEqual(run['evidence']['capture_failures'], 1)

    def workdir(self):
        import tempfile
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        return temp.name

    def test_seeded_runs_are_deterministic(self):
        scenario = dict(sim.SCENARIOS['realistic-combined'])
        first = sim.run_once(scenario, 3)
        self.assertEqual(first, sim.run_once(scenario, 3))


if __name__ == '__main__':
    unittest.main()
