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
        self.assertEqual(run['host_stop'], 'guard:observation_unavailable')
        self.assertAlmostEqual(run['collected_hours'], 60.0, delta=0.02)
        self.assertTrue(run['cleanup_complete'])

    def test_seeded_runs_are_deterministic(self):
        scenario = dict(sim.SCENARIOS['realistic-combined'])
        first = sim.run_once(scenario, 3)
        self.assertEqual(first, sim.run_once(scenario, 3))


if __name__ == '__main__':
    unittest.main()
