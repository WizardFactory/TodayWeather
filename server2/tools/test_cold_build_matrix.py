#!/usr/bin/env python3
"""Pure checks of the matrix report logic: no child, peer, Cargo or network."""
import argparse
import importlib.util
import json
from pathlib import Path
import unittest

TOOL = Path(__file__).with_name('cold_build_matrix.py')
spec = importlib.util.spec_from_file_location('cold_build_matrix', TOOL)
matrix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(matrix)
REFERENCE = matrix.REFERENCE_SHA256
LABELS = {
    'index/v2/data-go-kr/vilage-fcst/k/20260924-0500.json': 'short',
    'index/v2/groups/g1.json': 'short',
    'raw/v2/data-go-kr/vilage-fcst/a.raw.gz': 'short',
    'raw/v2/data-go-kr/forecast-zone/z.raw.gz': 'zone-support',
}


def record(phase, status=200, sha=REFERENCE, elapsed=100.0, ops=None, parses=(0, 0)):
    after = {'OP GET index/v2/data-go-kr/vilage-fcst/k/20260924-0500.json': 2,
             'OP GET index/v2/groups/g1.json': 3, 'OP GET raw/v2/data-go-kr/vilage-fcst/a.raw.gz': 4,
             'OP LIST index/v2/data-go-kr/vilage-fcst/k/202609': 1,
             'OP GET raw/v2/data-go-kr/forecast-zone/z.raw.gz': 5, 'OP GET index/v2/kasi/unknown.json': 6}
    after.update(ops or {})
    outcome = {'http_status': status, 'sha256': sha, 'bytes': 42549} if status else {'transport_error': 'timed out'}
    return {'phase': phase, 'elapsed_ms': elapsed, 'outcome': outcome, 'status_before': {}, 'status_after': after,
            'forecast_cache_before': {'parse_acquisitions': parses[0], 'folds': 0},
            'forecast_cache_after': {'parse_acquisitions': parses[1], 'folds': 7}}


def rows_of(binary, mode, delay, run, records):
    text = '\n'.join(json.dumps(r) for r in records)
    return [{'binary': binary, 'mode': mode, 'delay_ms': delay, 'run': run, **row}
            for row in matrix.phase_rows(text, LABELS, matrix.runner().io_delta)]


class Report(unittest.TestCase):
    def test_percentile_is_nearest_rank(self):
        self.assertEqual(matrix.percentile([5, 1, 4, 2, 3], 0.95), 5)
        self.assertEqual(matrix.percentile(list(range(1, 21)), 0.95), 19)
        self.assertEqual(matrix.percentile([7], 0.95), 7)

    def test_binary_arguments_need_a_plain_name_and_path(self):
        name, path = matrix.parse_binary('d2-base=bin/smoke')
        self.assertEqual(name, 'd2-base')
        self.assertTrue(path.is_absolute())
        for bad in ('=bin/smoke', 'a b=bin/smoke', 'smoke', 'name='):
            with self.assertRaises(argparse.ArgumentTypeError):
                matrix.parse_binary(bad)

    def test_phase_rows_separate_forecast_io_from_support_and_other_reads(self):
        [row] = rows_of('cand', 'http', 10, 1, [record('cold', parses=(10, 735))])
        self.assertEqual(row['forecast_io'], {'LIST': 1, 'GET_catalog': 2, 'GET_descriptor': 3, 'GET_raw': 4})
        self.assertEqual(row['other_io_operations'], 6, 'unlabelled reads are kept, not hidden')
        self.assertEqual((row['parses'], row['folds']), (725, 7))
        self.assertEqual((row['status'], row['sha256'], row['bytes']), (200, REFERENCE, 42549))
        [failed] = rows_of('cand', 'http', 10, 1, [record('cold', status=None)])
        self.assertEqual((failed['status'], failed['transport_error'], failed['sha256']), (None, 'timed out', None))

    def test_summary_keeps_statuses_times_and_answer_identity(self):
        rows = []
        for run, (status, elapsed) in enumerate([(200, 900.0), (200, 1100.0), (502, 3005.0)], 1):
            rows += rows_of('d2', 'http', 10, run, [record('cold', status=status, elapsed=elapsed,
                                                           sha=REFERENCE if status == 200 else 'x')])
        rows += rows_of('cand', 'http', 10, 1, [record('cold', sha='f' * 64, elapsed=300.0)])
        summary = {(s['binary'], s['phase']): s for s in matrix.summarize(rows, REFERENCE)}
        d2 = summary[('d2', 'cold')]
        self.assertEqual(d2['status_counts'], {'200': 2, '502': 1})
        self.assertEqual((d2['median_ms'], d2['p95_ms'], d2['ok_median_ms']), (1100.0, 3005.0, 1000.0))
        self.assertEqual(d2['hash_mismatches'], 0, 'a failed answer is not an identity mismatch')
        self.assertEqual(summary[('cand', 'cold')]['hash_mismatches'], 1)
        self.assertEqual(d2['forecast_io_median']['GET_raw'], 4)

    def test_problems_are_harness_integrity_not_measured_failures(self):
        complete = rows_of('c', 'http', 0, 1, [record('cold'), record('warm1'), record('warm2')])
        measured_502 = rows_of('d2', 'http', 10, 1, [record('cold', status=502, sha='x')])
        self.assertEqual(matrix.problems(complete + measured_502, {('c', 'http', 0, 1): 0,
                                                                     ('d2', 'http', 10, 1): 101}, REFERENCE), [])
        cases = {
            'no records': ([], 101),
            'all 200 but failed exit': (rows_of('c', 'aged', 0, 1, [record('cold'), record('aged')]), 101),
            'timeout after 200': (rows_of('c', 'aged', 0, 1, [record('cold')]), 'TIMEOUT'),
            'wrong body': (rows_of('c', 'aged', 0, 1, [record('cold'), record('aged', sha='e' * 64)]), 0),
            'continued after failure': (rows_of('c', 'aged', 0, 1, [record('cold', status=502), record('aged')]), 101),
            'phase order': (rows_of('c', 'aged', 0, 1, [record('aged'), record('cold')]), 0),
        }
        for name, (rows, code) in cases.items():
            with self.subTest(name):
                self.assertTrue(matrix.problems(rows, {('c', 'aged', 0, 1): code}, REFERENCE), name)


if __name__ == '__main__':
    unittest.main()
