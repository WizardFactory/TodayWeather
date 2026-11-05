"""Client delivery eval: legacy calibration, wire rules, consumer reads and observed history."""
import copy
import re
import json
import tempfile
import unittest
from pathlib import Path

from kma_client_eval import (CONTRACT_PATH, REPOSITORY_ROOT, build_profile, evaluate, legacy_bodies,
                             load_contract, main)


CONTRACT = load_contract()
BODIES = legacy_bodies(CONTRACT)
PROFILE = build_profile(BODIES)


def legacy(version, surface, predicate=lambda body: True):
    for item in BODIES:
        if item['version'] == version and item['surface'] == surface and item['text'].lstrip().startswith('{'):
            body = json.loads(item['text'])
            if predicate(body):
                return body
    raise AssertionError(f'no legacy {version}/{surface} body')


def full(body):
    return len(body.get('short') or []) == 41 and len(body['midData']['dailyData']) == 18


def run(body, version='v000903', surface='addr', observed=False):
    text = body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)
    return evaluate(text, version, surface, CONTRACT, PROFILE, observed_history=observed)


def violations(findings, rule=None):
    return [f for f in findings if f['severity'] == 'violation' and (rule is None or f['rule'] == rule)]


def past_day(body):
    today = body['current']['date']
    return next(r for r in body['midData']['dailyData'] if r['date'] < today)


class LegacyCalibrationTest(unittest.TestCase):
    def test_every_legacy_body_meets_wire_axis_and_consumer_rules(self):
        checked = 0
        for item in BODIES:
            findings = evaluate(item['text'], item['version'], item['surface'], CONTRACT, PROFILE)
            self.assertEqual(violations(findings), [], item['id'])
            checked += 1
        self.assertGreater(checked, 250)

    def test_all_versions_observed_in_traffic_are_covered(self):
        covered = {(item['version'], item['surface']) for item in BODIES}
        for key in [('v000705', 'town'), ('v000803', 'town'), ('v000901', 'addr'), ('v000901', 'gateway'),
                    ('v000902', 'addr'), ('v000902', 'gateway'), ('v000903', 'addr'), ('v000903', 'gateway')]:
            self.assertIn(key, covered)


class WireRulesTest(unittest.TestCase):
    def test_null_where_legacy_never_sends_null_is_a_violation(self):
        body = legacy('v000901', 'addr', full)
        body['short'][0]['time'] = None
        found = run(body, 'v000901')
        self.assertTrue(violations(found, 'W1'), found)
        self.assertTrue(any(f['rule'] == 'C1' and 'ios-widget' in f['detail'] for f in violations(found)), found)

    def test_legacy_null_air_index_stays_allowed(self):
        body = legacy('v000903', 'addr', lambda b: b['current'].get('arpltn', {}).get('pm10Index', 0) is None)
        self.assertEqual(violations(run(body)), [])

    def test_a_measured_air_index_is_allowed(self):
        body = legacy('v000903', 'addr', lambda b: b['current'].get('arpltn', {}).get('pm10Index', 0) is None)
        body['current']['arpltn']['pm10Index'] = 32
        body['current']['arpltn']['pm25Index'] = 37
        self.assertEqual(violations(run(body)), [])

    def test_a_text_air_index_stays_a_violation(self):
        body = legacy('v000903', 'addr', lambda b: b['current'].get('arpltn', {}).get('pm10Index', 0) is None)
        body['current']['arpltn']['pm10Index'] = '32'
        self.assertTrue(violations(run(body), 'W2'))

    def test_type_change_is_a_violation(self):
        body = legacy('v000903', 'addr', full)
        body['midData']['dailyData'][0]['tmx'] = '27'
        self.assertTrue(violations(run(body), 'W2'))

    def test_new_field_is_information_only(self):
        body = legacy('v000903', 'addr', full)
        body['short'][0]['brandNewField'] = {'nested': 1}
        found = run(body)
        self.assertEqual(violations(found), [])
        additive = [f for f in found if f['rule'] == 'W4']
        self.assertEqual([f['path'] for f in additive], ['$.short[].brandNewField'])

    def test_missing_required_slot_field_is_a_violation(self):
        body = legacy('v000903', 'addr', full)
        del body['short'][5]['skyIcon']
        self.assertTrue(violations(run(body), 'W3'))

    def test_slot_order_and_time_values(self):
        body = legacy('v000903', 'addr', full)
        body['short'][3], body['short'][4] = body['short'][4], body['short'][3]
        self.assertTrue(violations(run(body), 'A1'))
        body = legacy('v000903', 'addr', full)
        body['short'][2]['time'] = 7
        self.assertTrue(violations(run(body), 'A1'))

    def test_daily_dates_must_be_unique_and_ascending(self):
        body = legacy('v000903', 'addr', full)
        body['midData']['dailyData'][2]['date'] = body['midData']['dailyData'][1]['date']
        self.assertTrue(violations(run(body), 'A2'))

    def test_v000705_town_weather_keeps_the_empty_body(self):
        self.assertEqual(violations(run('', 'v000705', 'town')), [])
        body = legacy('v000803', 'town', full)
        self.assertTrue(violations(run(body, 'v000705', 'town'), 'E1'))


class ObservedHistoryTest(unittest.TestCase):
    def rainy_past_day(self):
        body = legacy('v000903', 'addr', full)
        day = past_day(body)
        day.update(rn1=5.2, ptyAm=0, ptyPm=0, skyAm='cloud', skyPm='cloud', wfAm='흐림', wfPm='흐림')
        body['historyStatus'] = dict(missingDailyDates=[], missingHourlySlots=[], hourlyFieldGaps=[])
        return body, day

    def test_measured_rain_never_shows_two_dry_halves(self):
        body, day = self.rainy_past_day()
        self.assertTrue(violations(run(body, observed=True), 'H1'))
        for key in ('ptyAm', 'skyAm', 'wfAm'):
            del day[key]
        body['historyStatus']['missingDailyDates'] = [day['date']]
        self.assertEqual(violations(run(body, observed=True)), [])

    def test_history_rules_are_information_for_legacy_mode(self):
        body, _ = self.rainy_past_day()
        found = run(body)
        self.assertEqual(violations(found), [])
        self.assertTrue(any(f['rule'] == 'H1' and f['severity'] == 'info' for f in found))

    def test_omitted_half_must_be_listed_as_missing(self):
        body, day = self.rainy_past_day()
        for key in ('ptyAm', 'skyAm', 'wfAm'):
            del day[key]
        self.assertTrue(violations(run(body, observed=True), 'H2'))

    def test_past_slot_with_measured_rain_never_has_pty_zero(self):
        body = legacy('v000903', 'addr', full)
        body['historyStatus'] = dict(missingDailyDates=[], missingHourlySlots=[], hourlyFieldGaps=[])
        today = body['current']['date']
        slot = next(r for r in body['short'] if r['date'] < today)
        slot.update(rn1=1.5, pty=0)
        self.assertTrue(violations(run(body, observed=True), 'H1'))
        slot['pty'] = -1
        self.assertEqual(violations(run(body, observed=True), 'H1'), [])


class ContractTest(unittest.TestCase):
    def test_documented_consumer_reads_match_the_contract_and_their_source_lines(self):
        # The citations live in maintained documentation; this test only reads them to
        # check that each cited line still reads the field (no runtime dependency).
        doc = REPOSITORY_ROOT / 'docs' / 'architecture' / 'mobile-api.md'
        row = re.compile(r'^\| (\S+) \| `([^`]+)` \| [^|]+ \| \[[^\]]+\]\(\.\./\.\./([^#)]+)#L(\d+)\) \|$')
        cited = {}
        for line in doc.read_text(encoding='utf-8').splitlines():
            match = row.match(line)
            if match:
                cited[(match[1], match[2])] = (match[3], int(match[4]))
        for name, consumer in CONTRACT['consumers'].items():
            self.assertEqual(consumer['evidence'], 'docs/architecture/mobile-api.md#fields-read-by-clients')
            for read in consumer['reads']:
                self.assertIn((name, read['path']), cited, (name, read))
        for (name, path), (source, number) in cited.items():
            text = (REPOSITORY_ROOT / source).read_text(encoding='utf-8').splitlines()[number - 1]
            self.assertIn(path.rsplit('.', 1)[-1], text, (name, path, source, number))

    def test_cli_manifest_reports_and_fails_on_violations(self):
        good = legacy('v000903', 'addr', full)
        bad = copy.deepcopy(good)
        bad['short'][0]['pty'] = None
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'good.json').write_text(json.dumps(good, ensure_ascii=False))
            (root / 'bad.json').write_text(json.dumps(bad, ensure_ascii=False))
            manifest = root / 'manifest.json'
            report = root / 'report.json'
            manifest.write_text(json.dumps([dict(body='good.json', version='v000903', surface='addr'),
                                            dict(body='bad.json', version='v000903', surface='addr')]))
            self.assertEqual(main(['--manifest', str(manifest), '--report', str(report)]), 2)
            result = json.loads(report.read_text())
            self.assertEqual(result['checked'], 2)
            self.assertEqual([r['violations'] > 0 for r in result['results']], [False, True])
            manifest.write_text(json.dumps([dict(body='good.json', version='v000903', surface='addr')]))
            self.assertEqual(main(['--manifest', str(manifest), '--report', str(report)]), 0)

    def test_contract_names_an_existing_corpus(self):
        self.assertTrue(CONTRACT_PATH.is_file())
        for corpus in CONTRACT['legacy_corpora']:
            self.assertTrue((REPOSITORY_ROOT / corpus['path']).is_file(), corpus)


if __name__ == '__main__':
    unittest.main()
