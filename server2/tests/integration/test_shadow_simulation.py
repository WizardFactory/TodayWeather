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
        self.assertTrue(run['cleanup_complete'])
        self.assertEqual(run['instances_launched'], 1)
        # One status poll per minute for 168 hours, plus the first poll at the start of
        # collection and the finish's post-stop inspection.
        self.assertEqual(run['polls'], 10082)
        self.assertEqual(run['completed_pairs'], 5852)

    def test_observed_quota_signal_stops_within_minutes(self):
        for seed in (0, 1):
            run = sim.run_once(sim.SCENARIOS['observed-quota-at-3min'], seed)
            self.assertEqual(run['host_stop'], 'guard:provider_auth_or_quota', run)
            self.assertLess(run['collected_hours'], 0.1)
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
        self.assertEqual(run['operator_stop'], 'acquisition_failed')
        self.assertLessEqual(run['operator_stop_after_group_end_s'], 61)
        self.assertTrue(run['cleanup_complete'])

    def test_reader_never_runs_past_the_time_bound(self):
        # CX-SR1-001: a production 429 on the 56th production request (about 169 s) must not
        # pre-empt a quota signal at 20 s, and no request may start after the bound.
        scenario = sim.default_scenario(name='bound', quota_first_at=20,
                                        reader_outcomes={('production', 56): {'status': 429, 'body_bytes': 0}})
        run = sim.run_once(scenario, 0)
        self.assertEqual(run['host_stop'], 'guard:provider_auth_or_quota', run)
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
        self.assertEqual((model.terminal, model.end_at), ('http-429', sim.EPOCH + 4))
        # A candidate exit at 3 s comes first: it is the cause, and the request stays pending.
        run = sim.run_once(dict(rejected, candidate_exit_at=3), 0)
        self.assertEqual(run['host_stop'], 'candidate-exit', run)
        self.assertIsNone(run['reader_terminal'])
        self.assertEqual(run['reader_pending'], 1)

    def test_reader_exit_leaves_candidate_and_guard_until_the_operator_stops(self):
        # CX-SR1-002: the reader unit stops alone; the guard keeps deciding until the
        # operator's next poll sees the reader inactive and stops the run.
        scenario = sim.default_scenario(name='reader-exit',
                                        reader_outcomes={('production', 1): {'status': 429, 'body_bytes': 0}})
        run = sim.run_once(scenario, 0)
        self.assertEqual(run['host_stop'], 'reader:http-429', run)
        self.assertEqual(run['operator_stop'], 'acquisition_failed')
        self.assertLess(run['collected_hours'], 10 / 3600)
        self.assertGreaterEqual(run['guard_samples_after_reader_exit'], 1)
        self.assertLessEqual(run['operator_stop_after_reader_exit_s'], 70)

    def test_a_guard_stop_ends_the_group_at_the_guard_step(self):
        run = sim.run_once(sim.default_scenario(quota_first_at=20), 0)
        self.assertEqual((run['host_stop'], run['guard_stop']), ('guard:provider_auth_or_quota', 'provider_auth_or_quota'))
        self.assertEqual(run['group_end_s'], 20)
        self.assertEqual(run['reader_last_start_s'] <= 20, True)

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
