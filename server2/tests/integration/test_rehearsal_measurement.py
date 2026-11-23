#!/usr/bin/env python3
"""Offline elapsed-hour and evidence checks using synthetic guard snapshots."""

from dataclasses import replace
from datetime import datetime, timezone
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'deploy' / 'shadow'))
from rehearsal_measurement import aggregate, guard_sample, projection_samples, write_measurement
from rehearsal_projection import project_week


START = int(datetime(2026, 11, 18, 6, tzinfo=timezone.utc).timestamp())
HALF_HOUR = 1800
ALLOCATION = {'reads': 500, 'writes': 500, 'put_bytes': 8192}
REJECTION = 'provider_http/vilage_fcst/429'


def fixture(index):
    slot = index * HALF_HOUR
    return {
        'observed_at': START + slot,
        'boot_id': '00000000-0000-0000-0000-000000000001',
        'pid': 23, 'start_ticks': 77, 'accounting_valid': True,
        'tx_bytes': 4000 + 1000 * index, 'cpu_seconds': 1200 + 200 * index,
        'free_bytes': 8000 - 50 * index,
        'metrics': {
            's3_reads': 500 - 3 * index, 's3_writes': 500 - 2 * index,
            's3_put_bytes': 8192 - 100 * index, 'auth_failures': 0,
            'quota_failures': index, 'storage_auth_failures': 0,
        },
        'diagnostics': {
            'local_paid_exhaustions': 0, 'first_rejection': None, 'paid_units': None,
            'provider_http': {'vilage_fcst': {'429': index}} if index else {},
        },
    }


def samples(count=49):
    return [guard_sample(fixture(index), ALLOCATION, scheduled=index * HALF_HOUR,
                         elapsed=index * HALF_HOUR) for index in range(count)]


def report(rows, through=86_400, start=START):
    return aggregate(rows, start_utc=start, through=through, cadence=HALF_HOUR)


class RehearsalMeasurementTests(unittest.TestCase):
    def test_real_guard_shape_produces_24_hours_and_projection(self):
        result = report(samples())
        self.assertTrue(result['complete'])
        self.assertEqual(result['utc_midnight_elapsed'], 18 * 3600)
        self.assertEqual(result['kst_midnight_elapsed'], 9 * 3600)
        first = result['hours'][0]
        self.assertEqual(first['start_utc'], '2026-11-18T06:00:00+00:00')
        self.assertEqual(first['start_kst'], '2026-11-18T15:00:00+09:00')
        self.assertEqual(first['counters']['candidate_s3_reads'], 6)
        self.assertEqual(first['counters']['candidate_s3_put_bytes'], 200)
        self.assertEqual(first['counters']['host_cpu_seconds'], 400)
        self.assertEqual(first['counters']['tx_iface_bytes'], 2000)
        self.assertEqual(first['counters'][REJECTION], 2)
        self.assertEqual(first['minimum_free_bytes'], 7900)
        weekly = project_week(projection_samples(result), allocation_metrics=['candidate_s3_reads'])
        self.assertEqual(weekly['min_allocations']['candidate_s3_reads'], 2016)

    def test_missing_or_late_checkpoint_marks_partial_report(self):
        first, middle, last = samples(3)
        for rows in ([first, last], [first, replace(middle, elapsed=1803), last]):
            result = report(rows, through=3600)
            self.assertFalse(result['complete'])
            row, = result['hours']
            self.assertFalse(row['complete'])
            self.assertEqual(row['missed_samples'], 1)
            self.assertIsNone(row['counters'])
            with self.assertRaisesRegex(ValueError, 'complete'):
                projection_samples(result)

    def test_clocks_process_identity_and_counter_reset_invalidate_the_affected_hour(self):
        first, middle, last = samples(3)
        for changed, expected in (
            (replace(middle, observed_at=middle.observed_at - 3), 'wall_clock_discontinuity'),
            (replace(middle, identity=(middle.identity[0], 24, 88)), 'candidate_identity_changed'),
            (replace(middle, counters=middle.counters | {'tx_iface_bytes': 0}), 'counter_reset'),
        ):
            with self.subTest(reason=expected):
                row = report([first, changed, last], through=3600)['hours'][0]
                self.assertFalse(row['complete'])
                self.assertIn(expected, row['issues'])
                self.assertIsNone(row['counters'])

    def test_no_false_midnight_observation_at_the_run_end(self):
        shifted = [replace(row, observed_at=row.observed_at - 6 * 3600) for row in samples()]
        result = report(shifted, start=START - 6 * 3600)
        self.assertEqual(len(result['hours']), 24)
        self.assertIsNone(result['utc_midnight_elapsed'])
        self.assertEqual(result['kst_midnight_elapsed'], 15 * 3600)
        self.assertFalse(result['complete'])

    def test_nominal_midnight_cut_does_not_replace_actual_wall_observation(self):
        slots = samples(19)
        last = slots[-1]
        slots[-1] = replace(last, elapsed=last.elapsed - 1, observed_at=last.observed_at - 1)
        result = report(slots, through=9 * 3600)
        self.assertTrue(result['hours'][-1]['complete'])
        self.assertIsNone(result['kst_midnight_elapsed'])

    def test_guard_refuses_invalid_metrics_instead_of_converting_to_zero(self):
        bad = fixture(0)
        bad['metrics']['s3_reads'] = ALLOCATION['reads'] + 1
        with self.assertRaises(ValueError):
            guard_sample(bad, ALLOCATION, scheduled=0, elapsed=0)

    def test_publish_partial_and_final_evidence_as_a_private_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'hourly.json'
            hours = report(samples(3), through=3600)
            write_measurement(path, hours, run_id='tiny-fixture', source_commit='a' * 40)
            self.assertEqual(len(json.loads(path.read_bytes())['hours']), 1)
            candidate = report(samples())
            artifacts = {name: 'b' * 64 for name in ('server', 'collector', 'launch', 'reader')}
            write_measurement(path, candidate, run_id='tiny-fixture', source_commit='a' * 40,
                              artifact_sha256=artifacts)
            with self.assertRaises(ValueError):
                write_measurement(path, candidate, run_id='tiny-fixture', source_commit='a' * 40,
                                  artifact_sha256={'server': 'b' * 64})
            saved = json.loads(path.read_bytes())
            self.assertEqual(saved['run_id'], 'tiny-fixture')
            self.assertEqual(saved['hours'], candidate['hours'])
            self.assertEqual(saved['artifact_sha256'], artifacts)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertNotIn('boot_id', path.read_text())


if __name__ == '__main__':
    unittest.main()
