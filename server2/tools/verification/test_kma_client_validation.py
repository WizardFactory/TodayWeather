"""Client validation: one production capture, and a candidate body judged against a reference body.

Bodies are synthetic or recorded legacy bodies; capture runs against a loopback server only.
"""
import contextlib
import copy
import io
import json
import socket
import tempfile
import threading
import unittest
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from kma_client_eval import legacy_bodies, load_contract
from kma_client_validation import main


PATH = '/weather/v000903/coord/37.566,126.978'
LAND = '2026-11-06T21:00:00.000Z'
KASI = dict(sunrise='2026.11.06 07:02', sunset='2026.11.06 17:29', moonrise='2026.11.06 03:47',
            moonset='2026.11.06 15:36', moontransit='2026.11.06 09:46', suntransit='2026.11.06 12:15',
            civilm='2026.11.06 06:34', civile='2026.11.06 17:56', nautm='2026.11.06 06:03',
            naute='2026.11.06 18:28', astm='2026.11.06 05:33', aste='2026.11.06 18:58',
            locationName='서울', locationGeo=[126.983333, 37.566666])
LIFE = dict(ultrv=3, ultrvGrade=1, ultrvStr='보통', fsn=15, fsnGrade=0, fsnStr='관심')
POLLEN = dict(flowerWeeds=0, flowerWeedsGrade=0, flowerWeedsStr='낮음', pollenGrade=0, pollenStr='낮음')
ATTRIBUTION = dict(source='KMA_ASOS', stationId='108', key='202611061500', fields=['t1h'])


def reference():
    """A compact v000903 body with every judged family, exclusion and not-judged part."""
    return {
        'historyStatus': dict(startDate='20261031', endDate='20261106', timeZone='Asia/Seoul',
                              missingHourlySlots=['202611010100'], missingDailyDates=[],
                              hourlyFieldGaps=[dict(key='202611030700', fields=['sky'])]),
        'regionName': '서울특별시', 'cityName': '중구', 'townName': '명동',
        'shortPubDate': '202611071700',
        'short': [
            dict(date='20261107', time=15, pop=20, pty=0, sky=3, skyIcon='cloud', t3h=9.5, tmn=-50, tmx=-50,
                 r06=0, r06Approx=False, r06Hours=3, s06=0, uuu=1.2, vvv=0.4, wsd=2.1, wsdGrade=1,
                 wsdStr='바람약함', lgt=0, fromToday=0, historyObservation=dict(ATTRIBUTION)),
            dict(date='20261107', time=18, pop=30, pty=0, sky=4, skyIcon='cloud', t3h=7.0, tmn=-50, tmx=-50,
                 r06=0, s06=0, uuu=-0.5, vvv=0.3, wsd=1.4, lgt=-1, fromToday=0),
        ],
        'shortestPubDate': '202611071700',
        'shortest': [dict(date='20261107', time='1800', t1h=6, rn1=0, rn1Hours=1, rn1Approx=False, pty=0, sky=1,
                          skyIcon='moon', pubDate='202611071700')],
        'currentPubDate': '202611071700',
        'current': dict(date='20261107', time='1700', t1h=8.5, reh=21, rn1=0, pty=0, sky=1, skyIcon='sun',
                        weather='맑음', wsd=1, wsdGrade=1, wsdStr='바람약함', uuu=-1, vvv=-0.2, geo=[126.965, 37.57],
                        dongnae=dict(date='20261107', time='1700', t1h=8.5, rn1=0, sky=1, pty=0),
                        yesterday=dict(date='20261106', time=18, t1h=6.7, rn1=0, lgt=-1, comparisonAvailable=True),
                        arpltn=dict(pm10Value=17, pm10Grade=1), summaryAir='대기상태가 좋아요',
                        historyObservation=dict(ATTRIBUTION), fieldObservations=dict(t1h=dict(ATTRIBUTION)),
                        **LIFE),
        'midData': {
            'forecast': dict(regId='109', wfsv='맑음'),
            'dailyData': [
                dict(date='20261106', fromToday=-1, tmx=9.6, tmn=0.5, t1d=4.4, pty=0, rn1=0, sky=1, skyIcon='sun',
                     dustForecast=dict(sido='서울', pm10Grade=1), historyObservation=dict(ATTRIBUTION),
                     **KASI, **LIFE, **POLLEN),
                dict(date='20261107', fromToday=0, tmx=9.6, tmn=0.5, pop=0, sky=1, skyIcon='sun',
                     sunrise='2026.11.07 07:03', sunset='2026.11.07 17:28'),
            ],
            'landPubDate': LAND, 'tempPubDate': LAND,
            'dailyStatus': dict(healthy=True, reasons=[], unavailableDates=[]),
        },
        'airInfoList': [dict(source='airkorea', last=dict(pm10Value=17))],
        'airInfo': dict(source='airkorea'),
        'units': dict(temperatureUnit='C'),
        'location': dict(lat=37.566, long=126.978),
    }


def row(body, name, key):
    rows = body['midData']['dailyData'] if name == 'daily' else body[name]
    return next(r for r in rows if (r['date'] if name == 'daily' else f"{r['date']} {r['time']}") == key)


def compare(reference_body, candidate_body):
    """(exit status, JSON report, stdout) of the compare command on two bodies or raw byte strings."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        names = []
        for name, body in (('reference.json', reference_body), ('candidate.json', candidate_body)):
            data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
            (root / name).write_bytes(data)
            names.append(str(root / name))
        report = root / 'report.json'
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            status = main(['compare', '--reference', names[0], '--candidate', names[1], '--json', str(report)])
        return status, json.loads(report.read_text(encoding='utf-8')), out.getvalue()


class CompareTest(unittest.TestCase):
    def assertNothingMissing(self, report):
        for key in ('missing_rows', 'missing_fields', 'invalid_values'):
            self.assertEqual(report[key], [], key)

    def test_identical_bodies_pass(self):
        status, report, out = compare(reference(), reference())
        self.assertEqual((status, report['verdict']), (0, 'pass'))
        self.assertTrue(report['comparable']['ok'])
        self.assertNothingMissing(report)
        for key in ('excluded_missing', 'value_dependent'):
            self.assertEqual(report[key], [], key)
        self.assertEqual(report['value_differences'], {})
        self.assertIn('pass', out)

    def test_missing_field_is_reported_by_path(self):
        candidate = reference()
        del candidate['current']['dongnae']
        del row(candidate, 'daily', '20261107')['pop']
        status, report, out = compare(reference(), candidate)
        self.assertEqual((status, report['verdict']), (1, 'missing'))
        self.assertEqual(report['missing_fields'], ['current.dongnae', 'midData.dailyData[20261107].pop'])
        self.assertEqual(report['counts']['missing_fields'], 2)
        self.assertIn('current.dongnae', out)

    def test_missing_rows_are_reported_once_by_key(self):
        candidate = reference()
        candidate['short'] = [r for r in candidate['short'] if r['time'] != 15]
        candidate['shortest'] = []
        candidate['midData']['dailyData'] = candidate['midData']['dailyData'][1:]
        status, report, _ = compare(reference(), candidate)
        self.assertEqual(status, 1)
        self.assertEqual(report['missing_rows'],
                         ['short[20261107 15]', 'shortest[20261107 1800]', 'midData.dailyData[20261106]'])
        self.assertEqual(report['missing_fields'], [])
        self.assertEqual(report['excluded_missing'], [])

    def test_rows_match_by_key_and_extra_candidate_rows_pass(self):
        candidate = reference()
        extra = dict(row(candidate, 'short', '20261107 18'), time=21)
        candidate['short'] = [extra] + list(reversed(candidate['short']))
        candidate['midData']['dailyData'].append(dict(row(candidate, 'daily', '20261107'), date='20261108'))
        status, report, _ = compare(reference(), candidate)
        self.assertEqual(status, 0)
        self.assertNothingMissing(report)
        self.assertEqual(report['value_differences'], {})

    def test_other_object_arrays_match_by_index(self):
        base = reference()
        base['current']['extraRows'] = [dict(a=1), dict(a=2)]
        candidate = copy.deepcopy(base)
        candidate['current']['extraRows'] = [dict(a=1)]
        status, report, _ = compare(base, candidate)
        self.assertEqual(status, 1)
        self.assertEqual(report['missing_rows'], ['current.extraRows[1]'])

    def test_sentinels_null_and_empty_values_against_valid_reference_values_are_reported(self):
        candidate = reference()
        slot = row(candidate, 'short', '20261107 15')
        slot.update(pop=-1, t3h=-50)
        candidate['current'].update(weather='', reh=None, rn1=-1, geo=[])
        status, report, _ = compare(reference(), candidate)
        self.assertEqual(status, 1)
        found = {v['path']: (v['reference'], v['candidate']) for v in report['invalid_values']}
        self.assertEqual(found, {'short[20261107 15].pop': (20, -1), 'short[20261107 15].t3h': (9.5, -50),
                                 'current.weather': ('맑음', ''), 'current.reh': (21, None),
                                 'current.rn1': (0, -1), 'current.geo': ([126.965, 37.57], [])})
        self.assertEqual(report['missing_fields'], [])

    def test_empty_or_other_kind_values_against_valid_scalars_are_reported(self):
        # CV-empty-numeric: an empty string, a container or a non-number cannot stand in for a value.
        candidate = reference()
        candidate['current'].update(t1h='', reh=[], sky={}, weather=dict(text='맑음'), dongnae='none', geo='126.965')
        row(candidate, 'short', '20261107 15').update(r06Approx='', pop=[20], t3h='warm')
        status, report, _ = compare(reference(), candidate)
        found = {v['path']: v['reason'] for v in report['invalid_values']}
        self.assertEqual(found, {
            'current.t1h': 'empty string', 'current.reh': 'array where the reference has a number',
            'current.sky': 'object where the reference has a number',
            'current.weather': 'object where the reference has a string',
            'current.dongnae': 'string where the reference has an object',
            'current.geo': 'string where the reference has an array',
            'short[20261107 15].r06Approx': 'empty string',
            'short[20261107 15].pop': 'array where the reference has a number',
            'short[20261107 15].t3h': 'not a number'})
        self.assertEqual((status, report['missing_fields']), (1, []))

    def test_scalars_of_another_kind_are_reported(self):
        # CV-scalar-kind: booleans, numbers and text are different data; a number and a numeric string are not.
        candidate = reference()
        candidate['current'].update(t1h=False, reh=True, weather=False, skyIcon=1, uuu='-1')
        row(candidate, 'short', '20261107 15')['r06Approx'] = 0
        row(candidate, 'short', '20261107 18')['pop'] = '30'
        row(candidate, 'shortest', '20261107 1800')['rn1Approx'] = 'false'
        status, report, _ = compare(reference(), candidate)
        self.assertEqual({v['path']: v['reason'] for v in report['invalid_values']}, {
            'current.t1h': 'boolean where the reference has a number',
            'current.reh': 'boolean where the reference has a number',
            'current.weather': 'boolean where the reference has a string',
            'current.skyIcon': 'number where the reference has a string',
            'short[20261107 15].r06Approx': 'number where the reference has a boolean',
            'shortest[20261107 1800].rn1Approx': 'string where the reference has a boolean'})
        self.assertEqual(status, 1)

    def test_non_finite_numbers_are_reported(self):
        # CV-nonfinite-number: "1e309" and the JSON number 1e309 read as infinity; "NaN" is not a number.
        candidate = reference()
        candidate['current'].update(t1h='1e309', reh='-1e309', wsd='NaN')
        row(candidate, 'short', '20261107 15')['pop'] = 'OVERFLOW'
        text = json.dumps(candidate, ensure_ascii=False).replace('"OVERFLOW"', '1e309')
        self.assertIn('"pop": 1e309', text)
        status, report, _ = compare(reference(), text.encode())
        self.assertEqual({v['path']: v['reason'] for v in report['invalid_values']}, {
            'current.t1h': 'not finite', 'current.reh': 'not finite', 'current.wsd': 'not a number',
            'short[20261107 15].pop': 'not finite'})
        self.assertEqual(status, 1)

    def test_both_invalid_is_not_reported(self):
        base = reference()
        base['current']['weather'] = ''
        candidate = copy.deepcopy(base)
        slot = row(candidate, 'short', '20261107 18')
        slot.update(tmn=-50, tmx=-99)
        del slot['lgt']
        candidate['current']['yesterday']['lgt'] = None
        status, report, _ = compare(base, candidate)
        self.assertEqual(status, 0)
        self.assertNothingMissing(report)
        self.assertEqual(report['value_differences'], {})

    def test_signed_fields_may_be_negative(self):
        candidate = reference()
        row(candidate, 'short', '20261107 15').update(uuu=-3.4, vvv=-0.9)
        row(candidate, 'daily', '20261107')['fromToday'] = -1
        candidate['current']['t1h'] = -12.5
        status, report, _ = compare(reference(), candidate)
        self.assertEqual(status, 0)
        self.assertNothingMissing(report)
        self.assertEqual(sorted(report['value_differences']),
                         ['current.t1h', 'midData.dailyData[].fromToday', 'short[].uuu', 'short[].vvv'])

    def test_label_is_judged_when_its_value_field_is_equal(self):
        candidate = reference()
        del row(candidate, 'short', '20261107 15')['wsdStr']
        candidate['current']['skyIcon'] = None
        status, report, _ = compare(reference(), candidate)
        self.assertEqual(status, 1)
        self.assertEqual(report['missing_fields'], ['short[20261107 15].wsdStr'])
        self.assertEqual([v['path'] for v in report['invalid_values']], ['current.skyIcon'])
        self.assertEqual(report['value_dependent'], [])

    def test_label_follows_a_differing_or_absent_value_field(self):
        candidate = reference()
        slot = row(candidate, 'short', '20261107 15')
        slot['r06'] = 1.5
        del slot['r06Approx'], slot['r06Hours']
        nowcast = row(candidate, 'shortest', '20261107 1800')
        del nowcast['rn1'], nowcast['rn1Hours'], nowcast['rn1Approx']
        status, report, _ = compare(reference(), candidate)
        self.assertEqual(status, 1)
        self.assertEqual(report['missing_fields'], ['shortest[20261107 1800].rn1'])
        self.assertEqual(sorted(v['path'] for v in report['value_dependent']),
                         ['short[20261107 15].r06Approx', 'short[20261107 15].r06Hours',
                          'shortest[20261107 1800].rn1Approx', 'shortest[20261107 1800].rn1Hours'])
        self.assertEqual(report['counts']['value_dependent'], 4)
        self.assertIn('short[].r06', report['value_differences'])

    def test_exclusions_are_listed_but_never_missing(self):
        candidate = reference()
        for key in ('airInfoList', 'airInfo'):
            del candidate[key]
        for key in ('arpltn', 'summaryAir', *LIFE):
            del candidate['current'][key]
        past = row(candidate, 'daily', '20261106')
        kasi = [k for k in KASI if k not in ('sunrise', 'sunset')]
        for key in ('dustForecast', *LIFE, *POLLEN, *kasi):
            del past[key]
        status, report, _ = compare(reference(), candidate)
        self.assertEqual((status, report['verdict']), (0, 'pass'))
        self.assertNothingMissing(report)
        expected = (['airInfoList', 'airInfo', 'current.arpltn', 'current.summaryAir']
                    + [f'current.{k}' for k in LIFE]
                    + [f'midData.dailyData[20261106].{k}' for k in ('dustForecast', *LIFE, *POLLEN, *kasi)])
        self.assertEqual(sorted(report['excluded_missing']), sorted(expected))
        self.assertEqual(report['counts']['excluded_missing'], len(expected))
        del past['sunrise'], past['sunset']
        status, report, _ = compare(reference(), candidate)
        self.assertEqual(status, 1)
        self.assertEqual(report['missing_fields'],
                         ['midData.dailyData[20261106].sunrise', 'midData.dailyData[20261106].sunset'])

    def test_excluded_parts_kept_empty_are_listed(self):
        # CV-empty-excluded: an excluded part emptied by the candidate is listed like a deleted one.
        candidate = reference()
        candidate.update(airInfoList=[], airInfo={})
        candidate['current'].update(arpltn={}, summaryAir='')
        row(candidate, 'daily', '20261106').update(dustForecast={}, locationGeo=[])
        status, report, _ = compare(reference(), candidate)
        self.assertEqual((status, report['verdict']), (0, 'pass'))
        self.assertNothingMissing(report)
        self.assertEqual(sorted(report['excluded_missing']), sorted([
            'airInfoList', 'airInfo', 'current.arpltn', 'current.summaryAir',
            'midData.dailyData[20261106].dustForecast', 'midData.dailyData[20261106].locationGeo']))

    def test_attribution_and_history_gap_lists_are_not_judged(self):
        candidate = reference()
        for container in [candidate['current'], *candidate['short'], *candidate['midData']['dailyData']]:
            container.pop('historyObservation', None)
            container.pop('fieldObservations', None)
        candidate['historyStatus'].update(missingHourlySlots=[], missingDailyDates=['20261103'], hourlyFieldGaps=[])
        status, report, _ = compare(reference(), candidate)
        self.assertEqual(status, 0)
        self.assertNothingMissing(report)
        self.assertEqual(report['value_differences'], {})
        del candidate['historyStatus']['missingDailyDates']
        status, report, _ = compare(reference(), candidate)
        self.assertEqual(status, 1)
        self.assertEqual(report['missing_fields'], ['historyStatus.missingDailyDates'])

    def test_history_gap_lists_stay_arrays(self):
        # CV-history-list-kind: list contents are not judged, but a list must stay a list.
        candidate = reference()
        candidate['historyStatus'].update(missingHourlySlots='none', hourlyFieldGaps={})
        status, report, _ = compare(reference(), candidate)
        self.assertEqual({v['path']: v['reason'] for v in report['invalid_values']}, {
            'historyStatus.missingHourlySlots': 'string where the reference has an array',
            'historyStatus.hourlyFieldGaps': 'object where the reference has an array'})
        self.assertEqual(status, 1)

    def test_daily_status_lists_are_judged_by_presence_and_kind(self):
        # PR-dailystatus: on 2026-11-07 production lacked the Gangwon mid forecast for Gangneung, so its
        # dailyStatus listed reasons and dates, while server2 had the forecast and empty lists. The lists
        # are gap diagnostics like those of historyStatus.
        base = reference()
        base['midData']['dailyStatus'] = dict(
            healthy=False, reasons=['land-unavailable', 'temperature-unavailable'],
            unavailableDates=['20261112', '20261113', '20261114', '20261115', '20261116', '20261117'], rss='retired')
        candidate = reference()
        candidate['midData']['dailyStatus'] = dict(healthy=True, reasons=[], unavailableDates=[], rss='retired')
        status, report, _ = compare(base, candidate)
        self.assertEqual((status, report['invalid_values'], report['missing_fields']), (0, [], []))
        self.assertEqual([p for p in report['value_differences'] if 'dailyStatus' in p], ['midData.dailyStatus.healthy'])
        candidate['midData']['dailyStatus']['reasons'] = 'none'
        del candidate['midData']['dailyStatus']['unavailableDates']
        status, report, _ = compare(base, candidate)
        self.assertEqual({v['path']: v['reason'] for v in report['invalid_values']},
                         {'midData.dailyStatus.reasons': 'string where the reference has an array'})
        self.assertEqual((status, report['missing_fields']), (1, ['midData.dailyStatus.unavailableDates']))

    def test_candidate_only_keys_pass(self):
        candidate = reference()
        candidate['forecastNarrative'] = dict(stationId=109, text='맑음')
        candidate['current'].update(freezeGrade=0, freezeStr='낮음')
        candidate['current']['yesterday']['missing'] = True
        row(candidate, 'short', '20261107 15')['brandNewField'] = dict(nested=1)
        status, report, _ = compare(reference(), candidate)
        self.assertEqual(status, 0)
        self.assertNothingMissing(report)
        self.assertEqual(report['value_differences'], {})

    def test_valid_value_differences_are_information(self):
        candidate = reference()
        row(candidate, 'short', '20261107 15')['t3h'] = 10.5
        row(candidate, 'short', '20261107 18')['t3h'] = 6.5
        status, report, out = compare(reference(), candidate)
        self.assertEqual(status, 0)
        self.assertEqual(list(report['value_differences']), ['short[].t3h'])
        group = report['value_differences']['short[].t3h']
        self.assertEqual(group['count'], 2)
        self.assertIn(dict(path='short[20261107 15].t3h', reference=9.5, candidate=10.5), group['examples'])
        self.assertEqual(report['counts']['value_differences'], 2)

    def test_different_publications_are_not_comparable_but_lists_are_written(self):
        candidate = reference()
        candidate['shortPubDate'] = '202611071400'
        candidate['midData']['tempPubDate'] = '2026-11-06T09:00:00.000Z'
        del candidate['current']['dongnae']
        status, report, out = compare(reference(), candidate)
        self.assertEqual((status, report['verdict']), (2, 'not-comparable'))
        self.assertFalse(report['comparable']['ok'])
        self.assertEqual(report['comparable']['differing_publications'], {
            'shortPubDate': dict(reference='202611071700', candidate='202611071400'),
            'midData.tempPubDate': dict(reference=LAND, candidate='2026-11-06T09:00:00.000Z')})
        self.assertEqual(report['missing_fields'], ['current.dongnae'])
        self.assertIn('shortPubDate', out)

    def test_different_place_is_not_comparable_but_lists_are_written(self):
        candidate = reference()
        candidate['townName'] = '소공동'
        del candidate['cityName']
        del candidate['current']['dongnae']
        status, report, out = compare(reference(), candidate)
        self.assertEqual((status, report['verdict']), (2, 'not-comparable'))
        self.assertFalse(report['comparable']['ok'])
        self.assertEqual(report['comparable']['differing_place'], {
            'cityName': dict(reference='중구', candidate='<absent>'),
            'townName': dict(reference='명동', candidate='소공동')})
        self.assertEqual(report['comparable']['differing_publications'], {})
        self.assertIn('place differs: townName 명동 vs 소공동', report['comparable']['reasons'])
        self.assertIn('place differs: cityName 중구 vs <absent>', report['comparable']['reasons'])
        self.assertEqual(report['missing_fields'], ['cityName', 'current.dongnae'])
        self.assertIn('townName: reference 명동, candidate 소공동', out)

    def test_place_absent_from_both_bodies_is_not_comparable(self):
        # CV-missing-place: a place field both bodies lack, or leave null, names no place.
        base = reference()
        del base['townName']
        base['cityName'] = None
        status, report, out = compare(base, copy.deepcopy(base))
        self.assertEqual((status, report['verdict']), (2, 'not-comparable'))
        self.assertEqual(report['comparable']['differing_place'], {
            'cityName': dict(reference=None, candidate=None),
            'townName': dict(reference='<absent>', candidate='<absent>')})
        self.assertIn('place unknown: townName <absent> vs <absent>', report['comparable']['reasons'])
        self.assertIn('place unknown: cityName null vs null', report['comparable']['reasons'])
        self.assertIn('townName: reference <absent>, candidate <absent>', out)
        self.assertNothingMissing(report)

    def test_non_kma_or_unreadable_input_is_not_comparable(self):
        cases = [({'message': 'Internal server error'}, reference()), (reference(), []),
                 (b'<html>502 Bad Gateway</html>', reference()), (reference(), b'{"short": NaN}')]
        for reference_body, candidate_body in cases:
            with self.subTest(reference=str(reference_body)[:30], candidate=str(candidate_body)[:30]):
                status, report, _ = compare(reference_body, candidate_body)
                self.assertEqual((status, report['verdict']), (2, 'not-comparable'))
                self.assertFalse(report['comparable']['ok'])
                self.assertTrue(report['comparable']['reasons'])
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'report.json'
            with contextlib.redirect_stdout(io.StringIO()):
                status = main(['compare', '--reference', str(Path(tmp) / 'absent.json'),
                               '--candidate', str(Path(tmp) / 'absent.json'), '--json', str(out)])
            self.assertEqual(status, 2)
            self.assertEqual(json.loads(out.read_text(encoding='utf-8'))['verdict'], 'not-comparable')


def recorded_kma_bodies():
    bodies = []
    for item in legacy_bodies(load_contract()):
        text = item['text'].strip()
        body = json.loads(text) if text.startswith('{') else None
        if isinstance(body, dict) and {'short', 'current', 'midData'} <= set(body):
            bodies.append((item['id'], body))
    return bodies


class RecordedBodiesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bodies = recorded_kma_bodies()

    def test_every_recorded_kma_body_passes_against_itself(self):
        self.assertGreater(len(self.bodies), 100)
        for name, body in self.bodies:
            status, report, _ = compare(body, body)
            self.assertEqual((status, report['missing_rows'], report['missing_fields'], report['invalid_values']),
                             (0, [], [], []), name)

    def test_numeric_strings_follow_the_sentinel_rules(self):
        # CV-string-sentinel: legacy sends numeric strings (reh "60" and wsd "2" in short rows of this
        # recording); JavaScript reads them as numbers, so a string sentinel carries no data either.
        body = dict(self.bodies)['oracle.json.gz:current-interpolated-strings']
        slot = next(r for r in body['short'] if isinstance(r.get('reh'), str))
        path = f"short[{slot['date']} {slot['time']}]"

        def edited(base, **values):
            copied = copy.deepcopy(base)
            target = next(r for r in copied['short'] if (r['date'], r['time']) == (slot['date'], slot['time']))
            for key, value in values.items():
                target.pop(key) if value is None else target.update({key: value})
            return copied

        status, report, _ = compare(body, edited(body, reh='-1', wsd=' -1 ', t3h='-50'))
        self.assertEqual({v['path']: v['reason'] for v in report['invalid_values']},
                         {f'{path}.reh': 'negative', f'{path}.wsd': 'negative',
                          f'{path}.t3h': 'temperature at or below -50'})
        self.assertEqual(status, 1)
        status, report, _ = compare(body, edited(body, reh=60, wsd='2.0', t3h='-12.5'))
        self.assertEqual((status, report['invalid_values']), (0, []))
        sentinel = edited(body, reh='-1')
        status, report, _ = compare(sentinel, edited(sentinel, reh=None))
        self.assertEqual((status, report['missing_fields']), (0, []))

    def test_heat_index_is_a_temperature_and_other_indices_stay_never_negative(self):
        # CV-negative-heat-index: below 80 F legacy returns the temperature as heatIndex, so this winter
        # recording has current.heatIndex -12.5. Like a temperature, only -50 and below carries no data.
        body = dict(self.bodies)['kma-town.json.gz:v000803-winter-cold-wind']
        self.assertEqual((body['current']['t1h'], body['current']['heatIndex']), (-12.5, -12.5))
        candidate = copy.deepcopy(body)
        del candidate['current']['heatIndex']
        status, report, _ = compare(body, candidate)
        self.assertEqual((status, report['missing_fields']), (1, ['current.heatIndex']))
        warm = copy.deepcopy(body)
        warm['current']['heatIndex'] = 3.5
        cold = copy.deepcopy(body)
        cold['current'].update(heatIndex=-1.2, dspls=-1, decpsn=-1)
        status, report, _ = compare(warm, cold)
        self.assertEqual({v['path']: v['reason'] for v in report['invalid_values']},
                         {'current.dspls': 'negative', 'current.decpsn': 'negative'})
        cold['current'].update(heatIndex=-50, dspls=27, decpsn=0)
        status, report, _ = compare(body, cold)
        self.assertEqual([(v['path'], v['reason']) for v in report['invalid_values']],
                         [('current.heatIndex', 'temperature at or below -50')])

    def test_wind_components_use_the_legacy_missing_value(self):
        # Legacy writes -100 for a missing uuu or vvv; this recording carries it in four short rows,
        # while -2 is a real component.
        body = dict(self.bodies)['oracle.json.gz:missing-short']
        candidate = copy.deepcopy(body)
        for slot in candidate['short']:
            if slot.get('uuu') == -100:
                del slot['uuu'], slot['vvv']
        valid = next(r for r in candidate['short'] if (r.get('uuu'), r.get('vvv')) == (1, -2))
        valid['uuu'] = -100
        status, report, _ = compare(body, candidate)
        self.assertEqual(report['missing_fields'], [])
        self.assertEqual([(v['path'], v['reason']) for v in report['invalid_values']],
                         [(f"short[{valid['date']} {valid['time']}].uuu", 'wind component at or below -100')])
        self.assertEqual(status, 1)

    def test_rows_and_fields_removed_from_a_recorded_body_are_reported(self):
        name, body = next((n, b) for n, b in self.bodies
                          if len(b['short']) == 41 and len(b['midData']['dailyData']) == 18)
        candidate = copy.deepcopy(body)
        slot = candidate['short'].pop(5)
        day = candidate['midData']['dailyData'].pop(0)
        del candidate['current']['t1h']
        status, report, _ = compare(body, candidate)
        self.assertEqual(status, 1, name)
        self.assertEqual(sorted(report['missing_rows']), sorted([f"short[{slot['date']} {slot['time']}]",
                                                                 f"midData.dailyData[{day['date']}]"]))
        self.assertEqual(report['missing_fields'], ['current.t1h'])


class Recorder(BaseHTTPRequestHandler):
    def do_GET(self):
        self.server.requests.append(dict(method=self.command, path=self.path, headers=dict(self.headers)))
        status, headers, body = self.server.answer
        self.send_response_only(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_HEAD = do_POST = do_GET

    def log_message(self, *args):
        pass


@contextlib.contextmanager
def loopback(status, headers, body):
    server = ThreadingHTTPServer(('127.0.0.1', 0), Recorder)
    server.requests, server.answer = [], (status, headers, body)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server, f'http://127.0.0.1:{server.server_address[1]}'
    finally:
        server.shutdown()
        server.server_close()


def capture(base, out, label='prod'):
    with contextlib.redirect_stdout(io.StringIO()):
        return main(['capture', '--path', PATH, '--out', str(out), '--label', label, '--base', base])


EDGE = {'Date': 'Sat, 07 Nov 2026 09:21:46 GMT', 'Age': '12', 'X-Cache': 'Hit from cloudfront',
        'Cache-Control': 'max-age=300', 'X-Amz-Cf-Pop': 'ICN57-P5', 'Content-Type': 'application/json'}


class CaptureTest(unittest.TestCase):
    def test_capture_writes_the_body_and_metadata_of_one_get(self):
        body = json.dumps(reference(), ensure_ascii=False).encode()
        with loopback(200, EDGE, body) as (server, base), tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(capture(base, tmp), 0)
            self.assertEqual(len(server.requests), 1)
            request = server.requests[0]
            self.assertEqual((request['method'], request['path']), ('GET', PATH))
            self.assertEqual(request['headers'].get('Accept-Language'), 'ko-KR,ko;q=0.9')
            self.assertEqual((Path(tmp) / 'prod.json').read_bytes(), body)
            meta = json.loads((Path(tmp) / 'prod.meta.json').read_text(encoding='utf-8'))
            self.assertEqual(meta['url'], base + PATH)
            self.assertEqual((meta['status'], meta['bytes']), (200, len(body)))
            self.assertGreaterEqual(meta['duration_ms'], 0)
            self.assertTrue(meta['sent_at'].endswith('Z'))
            datetime.fromisoformat(meta['sent_at'][:-1])
            self.assertEqual(meta['headers'], {'date': EDGE['Date'], 'age': '12', 'x-cache': 'Hit from cloudfront',
                                               'cache-control': 'max-age=300', 'x-amz-cf-pop': 'ICN57-P5'})

    def test_capture_without_a_label_names_both_files_after_the_path(self):
        with loopback(200, EDGE, b'{"short": []}') as (server, base), tempfile.TemporaryDirectory() as tmp:
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main(['capture', '--path', PATH, '--out', tmp, '--base', base]), 0)
            names = sorted(p.name for p in Path(tmp).iterdir())
            self.assertEqual(len(names), 2, names)
            self.assertEqual(names[0][:-len('.json')] + '.meta.json', names[1])
            self.assertEqual(len(server.requests), 1)

    def test_error_answers_are_recorded_with_exit_one_and_no_second_request(self):
        answers = [(500, {'Content-Type': 'application/json'}, b'{"message": "Internal server error"}'),
                   (200, {'Content-Type': 'text/html'}, b'<html>maintenance</html>'),
                   (200, {'Content-Type': 'application/json'}, b'[]'),
                   (302, {'Location': '/weather/v000903/coord/0,0'}, b'')]
        for status, headers, body in answers:
            with self.subTest(status=status, body=body[:20]), loopback(status, headers, body) as (server, base), \
                    tempfile.TemporaryDirectory() as tmp:
                self.assertEqual(capture(base, tmp), 1)
                self.assertEqual(len(server.requests), 1)
                self.assertEqual((Path(tmp) / 'prod.json').read_bytes(), body)
                meta = json.loads((Path(tmp) / 'prod.meta.json').read_text(encoding='utf-8'))
                self.assertEqual((meta['status'], meta['bytes']), (status, len(body)))

    def test_a_refused_connection_is_recorded_with_exit_one(self):
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(capture(f'http://127.0.0.1:{port}', tmp), 1)
            self.assertEqual((Path(tmp) / 'prod.json').read_bytes(), b'')
            meta = json.loads((Path(tmp) / 'prod.meta.json').read_text(encoding='utf-8'))
            self.assertIsNone(meta['status'])
            self.assertTrue(meta['error'])


if __name__ == '__main__':
    unittest.main()
