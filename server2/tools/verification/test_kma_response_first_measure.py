"""Denominators and scope are part of the measurement contract."""
import unittest
import kma_response_first_measure as tool


class Controls(unittest.TestCase):
    def test_failed_and_partial_attempts_remain_in_latency_denominator(self):
        rows = [dict(profile='P1_provider_response_first', result=dict(
                    status=200, full_body_received=True, elapsed_ms=100)),
                dict(profile='P1_provider_response_first', result=dict(
                    error='timeout', full_body_received=False, elapsed_ms=12000))]
        s = tool.summarize({'http': rows})['profiles']['P1_provider_response_first']
        self.assertEqual(s['attempts'], 2)
        self.assertEqual(s['full_body_http_200'], 1)
        self.assertEqual(s['max_ms'], 12000)
        self.assertIsNone(s['p99_ms'])
        self.assertFalse(s['history_complete'])

    def test_pair_mismatch_and_failed_publication_are_not_hidden(self):
        report = dict(http=[dict(profile='S1_targeted_canonical_restore', result=dict(
                      status=200, elapsed_ms=90, full_body_received=True),
                      body_equal_to_provider=False, functional_headers_equal=True)],
                      cases=[dict(writer=dict(jobs=[{'complete': True}, {'complete': False}],
                                              publications=[{'durable': False}]))])
        s = tool.summarize(report)
        self.assertEqual((s['paired_attempts'], s['paired_body_equal']), (1, 0))
        self.assertEqual(s['acquisition_jobs'], 2)
        self.assertEqual(s['complete_jobs'], 1)
        self.assertEqual(s['durable_groups'], 0)
        self.assertEqual(s['full_seven_day_history'], 'NOT_QUALIFIED')

    def test_console_summary_keeps_counters_without_dumping_every_io_event(self):
        s = tool.summarize({'metrics': {'admitted': {'provider': 7}, 'events': [{'kind': 'provider'}]}})
        self.assertEqual(s['metrics']['admitted']['provider'], 7)
        self.assertNotIn('events', s['metrics'])


if __name__ == '__main__':
    unittest.main()
