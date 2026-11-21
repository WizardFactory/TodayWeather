#!/usr/bin/env python3
"""Exercise the 24-hour observation and stop ordering without waiting a day."""

from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'deploy' / 'shadow'))
from rehearsal_measurement import Sample
from rehearsal_schedule import collect_day


START = int(datetime(2026, 11, 18, 6, tzinfo=timezone.utc).timestamp())
DAY = 86400
IDENTITY = ('00000000-0000-0000-0000-000000000001', 20, 1)


class Harness:
    def __init__(self):
        self.now = 20.0
        self.failure = None
        self.exit_at = DAY
        self.events = []

    def sleep(self, seconds):
        self.now += seconds

    def observe(self, slot, elapsed):
        self.events.append(('observe', slot, elapsed))
        if slot == self.failure:
            raise OSError('sensitive failure details')
        return Sample(slot, elapsed, START + elapsed, IDENTITY,
                      {'reads': elapsed}, {'rss_bytes': 110})

    def stop(self):
        self.events.append(('stop', self.now))
        return True

    def persist(self, report):
        self.events.append(('persist', report['elapsed_through']))

    def collect(self, **options):
        return collect_day(observe=self.observe, running=lambda: self.now < 20.0 + self.exit_at,
                           request_stop=self.stop, publish=self.persist, cadence=1800,
                           monotonic=lambda: self.now, wall=lambda: START + self.now - 20.0,
                           sleep=self.sleep, **options)


class RehearsalScheduleTests(unittest.TestCase):
    def test_final_sample_precedes_deadline_and_offline_stop_trigger(self):
        harness = Harness()
        report = harness.collect()
        self.assertTrue(report['complete'])
        self.assertTrue(report['deadline_reached'])
        self.assertEqual(len(report['hours']), 24)
        self.assertEqual(harness.events[-3:], [
            ('observe', DAY, DAY - 1), ('stop', 20.0 + DAY), ('persist', DAY),
        ])
        self.assertEqual(harness.events.count(('persist', 3600)), 1)

    def test_failed_sample_marks_gap_and_retains_no_exception_text(self):
        harness = Harness()
        harness.failure = 3600
        report = harness.collect()
        self.assertEqual(report['failed_observation_slots'], [3600])
        self.assertEqual([row['hour_index'] for row in report['hours'] if not row['complete']], [0, 1])
        self.assertFalse(report['complete'])
        self.assertNotIn('sensitive failure', str(report))

    def test_candidate_exit_stops_and_publishes_an_incomplete_report(self):
        harness = Harness()
        harness.exit_at = 3600
        report = harness.collect()
        self.assertFalse(report['complete'])
        self.assertFalse(report['deadline_reached'])
        self.assertEqual(report['stop_reason'], 'workload-exited')
        self.assertEqual(harness.events[-2:], [('stop', 3620.0), ('persist', 3600)])

    def test_stop_failure_cannot_publish_complete(self):
        harness = Harness()
        harness.stop = lambda: False
        report = harness.collect()
        self.assertFalse(report['complete'])
        self.assertTrue(report['deadline_reached'])
        self.assertEqual(report['stop_reason'], 'stop-unconfirmed')

    def test_checkpoint_error_still_triggers_stop(self):
        harness = Harness()
        def fail(_report):
            raise OSError('cannot publish checkpoint')
        harness.persist = fail
        with self.assertRaisesRegex(OSError, 'cannot publish checkpoint'):
            harness.collect()
        self.assertIn(('stop', 3620.0), harness.events)


if __name__ == '__main__':
    unittest.main()
