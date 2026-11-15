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
        # The exit is the cause; the guard then fails to observe the process and stops.
        self.assertEqual(run['host_stop'], 'candidate-exit')
        self.assertEqual(run['guard_stop'], 'observation_unavailable')
        self.assertEqual(run['collected_hours'], 60.0)
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
