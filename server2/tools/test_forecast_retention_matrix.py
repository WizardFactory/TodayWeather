#!/usr/bin/env python3
"""Check measurement denominators, units and child failure preservation."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

PATH = Path(__file__).with_name('forecast_retention_matrix.py')
spec = importlib.util.spec_from_file_location('retention_matrix', PATH)
matrix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(matrix)


class MeasurementContracts(unittest.TestCase):
    def test_rows_stream_and_discard_large_evidence_after_validation(self):
        with tempfile.TemporaryDirectory() as name:
            path=Path(name)/'rows.jsonl'
            path.write_text(json.dumps(dict(phase='restore',elapsed_ms=1,documents=['x'*10000],status_before={},status_after={}))+'\n')
            rows=matrix.read_rows(path)
            self.assertFalse(isinstance(rows,list))
            row=next(rows)
            compact=matrix.compact_row(row,{})
            self.assertNotIn('documents',compact)
            self.assertNotIn('status_before',compact)
            self.assertIn('classified_io',compact)

    def test_functional_success_does_not_imply_latency_acceptance(self):
        samples=[dict(exit=0,checks_passed=True,elapsed_ms=2600) for _ in range(20)]
        result=matrix.summarize(samples,expected=20,target_ms=2500)
        self.assertTrue(result['acceptance_passed'])
        self.assertFalse(result['latency_target_passed'])
        self.assertEqual(result['latency_target_ms'],2500)

    def test_boundary_trial_restores_its_primed_input_without_touching_other_data(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name)
            (root/'primed-folded-cache').mkdir()
            (root/'primed-folded-cache/view').write_text('original clock')
            (root/'folded-cache').mkdir()
            (root/'folded-cache/view').write_text('later selector')
            (root/'other-evidence').write_text('preserved')
            matrix.restore_primed_cache(root)
            self.assertEqual((root/'folded-cache/view').read_text(),'original clock')
            self.assertEqual((root/'other-evidence').read_text(),'preserved')

    def test_nearest_rank_uses_independent_observations(self):
        self.assertEqual(matrix.nearest_rank(list(range(1, 21)), .95), 19)
        self.assertEqual(matrix.nearest_rank([7], .95), 7)

    def test_invalid_latency_is_rejected(self):
        for values in [[], [float('nan')], [-1], [float('inf')]]:
            with self.subTest(values=values), self.assertRaises(ValueError):
                matrix.nearest_rank(values, .95)

    def test_failed_trial_remains_in_acceptance_denominator(self):
        samples = [dict(exit=0, checks_passed=True, elapsed_ms=i) for i in range(1, 20)]
        samples.append(dict(exit=101, checks_passed=False, elapsed_ms=3000))
        result = matrix.summarize(samples, expected=20)
        self.assertEqual((result['attempted'], result['successful'], result['failed']), (20, 19, 1))
        self.assertFalse(result['acceptance_passed'])
        self.assertEqual(result['successful_p95_ms'], 19)

    def test_too_few_trials_are_explicitly_insufficient(self):
        result = matrix.summarize([dict(exit=0, checks_passed=True, elapsed_ms=1)], expected=20)
        self.assertTrue(result['insufficient_samples'])
        self.assertFalse(result['acceptance_passed'])

    def test_rss_units_are_platform_specific(self):
        self.assertEqual(matrix.rss_bytes(2048, 'Linux'), 2097152)
        self.assertEqual(matrix.rss_bytes(2048, 'Darwin'), 2048)
        with self.assertRaises(ValueError):
            matrix.rss_bytes(2048, 'unknown')

    def test_child_nonzero_exit_is_retained_with_metrics(self):
        with tempfile.TemporaryDirectory() as name:
            result = matrix.run_child([sys.executable, '-c', 'raise SystemExit(7)'], Path(name), 'nonzero', timeout=5)
            self.assertEqual(result['exit'], 7)
            self.assertGreater(result['peak_rss_bytes'], 0)
            self.assertTrue((Path(name)/'nonzero-receipt.json').exists())

    def test_child_timeout_is_not_a_successful_sample(self):
        with tempfile.TemporaryDirectory() as name:
            result = matrix.run_child([sys.executable, '-c', 'import time; time.sleep(10)'], Path(name), 'timeout', timeout=.1)
            self.assertEqual(result['exit'], 'TIMEOUT')
            self.assertFalse(result['checks_passed'])


if __name__ == '__main__':
    unittest.main()
