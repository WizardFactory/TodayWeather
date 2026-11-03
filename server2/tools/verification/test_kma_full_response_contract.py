"""Observable history requirements, independent of native historyStatus flags."""
import copy
import unittest

from pathlib import Path

from kma_full_response_contract import (ALLOWED_SOURCES, CONTRACT_PATH, REPOSITORY_ROOT, WEATHER_FIELDS,
                                        allowed_history_labels, audit_history, coverage_edges,
                                        historical_differences, load_contract, references_contract,
                                        required_hours, validate_contract)


CLOCK = '2026-09-24T06:31:00+00:00'


def complete_case():
    daily = [dict(date=f'202609{d:02}', tmn=10, tmx=20, rn1=0,
                  skyAm='sun', skyPm='sun', wfAm='맑음', wfPm='맑음')
             for d in range(17, 24)]
    hourly = [dict(valid_at=t, source='observation', sky=1, pty=0)
              for t in required_hours(CLOCK)]
    body = dict(historyStatus=dict(missingHourlySlots=[], missingDailyDates=[]),
                midData=dict(dailyData=daily))
    return body, hourly


class HistoryContractTest(unittest.TestCase):
    def test_168_hours_include_yesterday_2400_not_oldest_0000(self):
        hours = required_hours(CLOCK)
        self.assertEqual(len(hours), 168)
        self.assertEqual(hours[0], '2026-09-17T01:00:00+09:00')
        self.assertEqual(hours[-1], '2026-09-24T00:00:00+09:00')

    def test_native_zero_missing_lists_do_not_certify_phenomena(self):
        body, hourly = complete_case()
        for row in hourly:
            del row['pty']
        result = audit_history(body, CLOCK, hourly)
        self.assertFalse(result['history_complete'])
        self.assertEqual(result['hourly_field_gap_count'], 168)
        self.assertFalse(result['full_response_qualified'])

    def test_complete_extrema_do_not_certify_am_pm_weather(self):
        body, hourly = complete_case()
        for row in body['midData']['dailyData']:
            del row['skyAm']
        result = audit_history(body, CLOCK, hourly)
        self.assertFalse(result['history_complete'])
        self.assertEqual(result['daily_field_gap_count'], 7)

    def test_valid_zero_precipitation_and_negative_temperature(self):
        body, hourly = complete_case()
        body['midData']['dailyData'][0].update(tmn=-20, tmx=-3, rn1=0)
        result = audit_history(body, CLOCK, hourly)
        self.assertTrue(result['history_complete'])
        # This tool does not certify latest products, raw integrity or source equivalence.
        self.assertFalse(result['full_response_qualified'])

    def test_missing_hour_duplicate_hour_and_forecast_source_are_rejected(self):
        body, hourly = complete_case()
        hourly[0] = copy.deepcopy(hourly[1])
        hourly[2]['source'] = 'shrt'
        result = audit_history(body, CLOCK, hourly)
        self.assertFalse(result['history_complete'])
        self.assertEqual(result['missing_hour_count'], 1)
        self.assertEqual(result['duplicate_hours'], [hourly[1]['valid_at']])
        self.assertEqual(len(result['forbidden_source_hours']), 1)

    def test_empty_hour_evidence_is_incomplete_even_when_daily_output_exists(self):
        body, _ = complete_case()
        result = audit_history(body, CLOCK)
        self.assertFalse(result['history_complete'])
        self.assertEqual(result['missing_hour_count'], 168)

    def test_sentinels_and_nonfinite_fields_are_not_valid_weather(self):
        body, hourly = complete_case()
        body['midData']['dailyData'][0]['tmn'] = -50
        body['midData']['dailyData'][1]['rn1'] = float('nan')
        hourly[0]['sky'] = -1
        hourly[1]['pty'] = None
        result = audit_history(body, CLOCK, hourly)
        self.assertFalse(result['history_complete'])
        self.assertEqual(result['daily_field_gap_count'], 2)
        self.assertEqual(result['hourly_field_gap_count'], 2)

    def test_history_diff_preserves_zero_versus_absence_and_2400_identity(self):
        before = dict(short=[dict(date='20260923', time=24, pop=0, t3h=12)],
                      midData=dict(dailyData=[]))
        after = dict(short=[dict(date='20260923', time=24, t3h=-50)],
                     midData=dict(dailyData=[]))
        diff = historical_differences(before, after, CLOCK)
        self.assertEqual(len(diff), 2)
        pop = next(r for r in diff if r['field'] == 'pop')
        self.assertEqual(pop['before'], dict(present=True, value=0))
        self.assertEqual(pop['after'], dict(present=False))
        self.assertEqual(pop['slot'], '20260923:24')

    def test_diff_does_not_equate_json_boolean_with_zero(self):
        before = dict(short=[dict(date='20260923', time=3, r06Approx=False)])
        after = dict(short=[dict(date='20260923', time=3, r06Approx=0)])
        self.assertEqual(len(historical_differences(before, after, CLOCK)), 1)


class HistoryDataContractTest(unittest.TestCase):
    """The declared precipitation contract (slice 1) and its static checks."""

    def setUp(self):
        self.contract = load_contract()

    def test_repository_contract_is_structurally_valid(self):
        self.assertEqual(validate_contract(self.contract, REPOSITORY_ROOT), [])

    def test_allowed_history_sources_come_from_the_contract(self):
        self.assertEqual(allowed_history_labels(self.contract), frozenset(('observation', 'odam', 'vsrt')))
        self.assertEqual(ALLOWED_SOURCES, allowed_history_labels(self.contract))

    def test_full_field_comparison_scope_is_not_narrowed_to_the_contract_slice(self):
        for field in ('skyAm', 'skyPm', 's06', 'lgt', 'tmx', 'pop', 'wfAm'):
            self.assertIn(field, WEATHER_FIELDS)
        self.assertEqual(len(WEATHER_FIELDS), 32)

    def test_approved_history_edge_from_a_forbidden_source_is_rejected(self):
        contract = copy.deepcopy(self.contract)
        contract['edges'].append(dict(id='X1', node='hourly.pty', source='shrt', field='PTY',
                                      transform='none', precedence=9, approval='approved',
                                      verification='existing'))
        errors = validate_contract(contract)
        self.assertTrue(any('I6' in e and 'X1' in e for e in errors), errors)

    def test_proposed_rules_are_excluded_from_coverage(self):
        ids = {edge['id'] for edge in coverage_edges(self.contract)}
        # Passed held-out validation and approved by AK: R1b and D1 on 2026-10-31, R2s on 2026-11-03.
        self.assertTrue({'E1', 'E2', 'E5', 'E6', 'R1b', 'D1', 'R2s'} <= ids)
        self.assertFalse({'R2', 'W1'} & ids)
        proposed = copy.deepcopy(self.contract)
        for edge in proposed['edges']:
            if edge['id'] == 'D1':
                edge['approval'] = 'proposed'
        self.assertNotIn('D1', {edge['id'] for edge in coverage_edges(proposed)})

    def test_unknown_references_duplicates_and_statuses_are_rejected(self):
        contract = copy.deepcopy(self.contract)
        contract['edges'].append(dict(contract['edges'][0]))
        contract['edges'].append(dict(id='X2', node='slot.unknown', source='asos-hourly', field='rn',
                                      transform='none', precedence=1, approval='maybe',
                                      verification='verified'))
        contract['nodes']['half.wf']['inputs'] = ['half.missing']
        contract['invariants'][0]['checked_by'] = []
        contract['budgets']['request-wait']['conformance'] = 'fine'
        errors = validate_contract(contract)
        for needle in ('duplicate edge id E1', 'X2 node slot.unknown', 'X2 approval maybe',
                       'half.wf input half.missing', 'I1 checked_by', 'request-wait conformance'):
            self.assertTrue(any(needle in e for e in errors), (needle, errors))

    def test_rule_implementations_must_exist(self):
        contract = copy.deepcopy(self.contract)
        contract['rules']['sky-icon']['implementation'] = 'server2/src/domestic/kma/absent.rs'
        errors = validate_contract(contract, REPOSITORY_ROOT)
        self.assertTrue(any('sky-icon implementation' in e for e in errors), errors)

    def test_latency_requirement_conflict_is_recorded_as_failed_conformance(self):
        wait = self.contract['budgets']['request-wait']
        self.assertTrue(wait['required'].startswith('3 s'))
        self.assertEqual(wait['conformance'], 'failed')

    def test_design_document_references_this_contract_version(self):
        doc = REPOSITORY_ROOT / 'docs' / 'architecture' / 'server2-kma-data-design.md'
        self.assertTrue(references_contract(doc, CONTRACT_PATH))


if __name__ == '__main__':
    unittest.main()
