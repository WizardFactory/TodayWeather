#!/usr/bin/env python3
"""Unit tests for the S19 shadow tooling: comparator, oracle, fixtures and safety bounds."""
import base64
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch
from urllib.parse import unquote

SERVER2 = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(SERVER2 / 'tools/shadow'))

import families  # noqa: E402
import gateway_family  # noqa: E402
import harness  # noqa: E402
import replay  # noqa: E402

FIXTURE = json.loads((SERVER2 / 'tests/integration/fixtures/gateway-replay.json').read_text())
DECLARED = FIXTURE['declared_differences']
CASES = gateway_family.oracle_cases()


def record(request_id='W01', pass_name='cold', status=200, headers=None, body=b'{}', hops=()):
    return {'id': request_id, 'pass': pass_name, 'status': status, 'headers': dict(headers or {}),
            'body': body, 'hops': list(hops), 'elapsed_ms': 1.0}


class CompareTest(unittest.TestCase):
    def test_identical_records_have_no_differences(self):
        left = [record(hops=[('backend', '/v000903/kma/addr/x', 'ko')])]
        right = [record(hops=[('backend', '/v000903/kma/addr/x', 'ko')])]
        self.assertEqual(replay.compare(left, right, DECLARED), ([], []))

    def test_duplicate_records_are_unexplained(self):
        _, right = replay.compare([record()], [record(), record()], DECLARED)
        self.assertIn('duplicate-candidate', {r['kind'] for r in right})
        _, left = replay.compare([record(), record()], [record()], DECLARED)
        self.assertIn('duplicate-baseline', {r['kind'] for r in left})

    def test_body_and_status_differences_are_unexplained(self):
        declared, unexplained = replay.compare([record(body=b'{"a":1}')], [record(status=501, body=b'{"a":2}')], DECLARED)
        self.assertEqual(declared, [])
        self.assertEqual({item['kind'] for item in unexplained}, {'status', 'body'})
        body = next(item for item in unexplained if item['kind'] == 'body')
        self.assertEqual(body['first_difference'], 5)

    def test_transport_headers_are_declared_and_functional_headers_are_not(self):
        declared, unexplained = replay.compare(
            [record(headers={'date': 'a', 'etag': 'W/"1"', 'cache-control': 'max-age=300'})],
            [record(headers={'date': 'b', 'etag': 'W/"2"'})], DECLARED)
        self.assertEqual([(d['name'], d['declared']) for d in declared], [('date', 'D-TRANSPORT')])
        self.assertEqual(sorted(item['name'] for item in unexplained), ['cache-control', 'etag'])

    def test_geocoder_acquisition_differences_are_declared_per_pass(self):
        for pass_name, expected in (('cold', 'D-ACQ-GEOCODER'), ('warm', 'D-ACQ-WARM-CACHE')):
            plan = {'W01': {pass_name: {'baseline': {'legacy_geo': 1}, 'candidate': {'kakao': 1}}}}
            declared, unexplained = replay.compare(
                [record(pass_name=pass_name, hops=[('legacy_geo', '/geocode/x', 'ko')])],
                [record(pass_name=pass_name, hops=[('kakao', '/v2/local/x', '')])], DECLARED, plan)
            self.assertEqual(unexplained, [])
            self.assertEqual({d['declared'] for d in declared}, {expected})

    def test_declared_acquisition_kind_does_not_admit_unplanned_counts(self):
        # R1-01: a declared kind cannot hide extra or warm-pass provider work.
        plan = {'W01': {'warm': {'baseline': {'legacy_geo': 1}, 'candidate': {}}}}
        extra = [('google', '/maps/api/geocode/json', '')] * 100
        declared, unexplained = replay.compare(
            [record(pass_name='warm', hops=[('legacy_geo', '/geocode/x', 'ko')])],
            [record(pass_name='warm', hops=extra)], DECLARED, plan)
        self.assertEqual(declared, [])
        self.assertEqual([(u['kind'], u['side'], u['observed']) for u in unexplained],
                         [('acquisition-plan', 'candidate', {'google': 100})])
        # Without a plan entry a differing acquisition is never declared.
        _, unexplained = replay.compare(
            [record(hops=[('legacy_geo', '/geocode/x', 'ko')])], [record(hops=[('kakao', '/v2', '')])], DECLARED, {})
        self.assertEqual({u['kind'] for u in unexplained}, {'acquisition'})

    def test_equal_but_unplanned_acquisitions_are_unexplained(self):
        plan = {'W01': {'cold': {'baseline': {'legacy_geo': 1}, 'candidate': {'legacy_geo': 1}}}}
        _, unexplained = replay.compare(
            [record(hops=[('legacy_geo', '/g', 'ko')] * 2)], [record(hops=[('legacy_geo', '/g', 'ko')] * 2)], DECLARED, plan)
        self.assertEqual(sorted(u['side'] for u in unexplained), ['baseline', 'candidate'])

    def test_backend_and_undeclared_acquisition_differences_are_unexplained(self):
        _, unexplained = replay.compare(
            [record(hops=[('backend', '/v000903/kma/addr/x', 'ko')])],
            [record(hops=[('backend', '/v000903/kma/addr/x', 'ko'), ('backend', '/v000903/kma/addr/x', 'ko'),
                          ('unknown_provider', '/x', '')])], DECLARED)
        self.assertEqual(sorted(item['kind'] for item in unexplained), ['acquisition', 'backend-hops'])

    def test_missing_records_are_unexplained(self):
        _, unexplained = replay.compare([record('W01')], [record('W02')], DECLARED)
        self.assertEqual(sorted(item['kind'] for item in unexplained), ['missing-baseline', 'missing-candidate'])


class OracleTest(unittest.TestCase):
    def test_matching_and_mismatching_oracle_records(self):
        case = CASES['geocode-v000903-coord']
        headers = {name: value for name, value in case['headers']}
        body = base64.b64decode(case['body_base64'])
        good = dict(record(headers=headers, body=body), oracle='geocode-v000903-coord')
        bad = dict(record(headers=dict(headers, etag='W/"0"'), body=body + b' '), oracle='geocode-v000903-coord')
        checked, mismatches = replay.oracle_check([good, dict(record('W02'), oracle=None)], CASES, ['date', 'connection'])
        self.assertEqual((checked, mismatches), (1, []))
        checked, mismatches = replay.oracle_check([bad], CASES, ['date', 'connection'])
        fields = {(p['field'], p.get('name')) for p in mismatches[0]['problems']}
        # Recorded headers are compared as observed; content-length was unchanged here.
        self.assertEqual(fields, {('body', None), ('header', 'etag')})

    def test_unresolved_oracle_reference_fails(self):
        # R1-03: a named but missing S02 case is a mismatch, never a silent skip.
        checked, mismatches = replay.oracle_check([dict(record(), oracle='missing-case')], CASES, ['date'])
        self.assertEqual(checked, 1)
        self.assertEqual(mismatches[0]['problems'], [{'field': 'oracle', 'expected': 'missing-case', 'observed': None}])

    def test_weather_merge_oracle_is_independent_of_server2(self):
        # R1-04: successful weather bodies must equal the frozen backend body merged with the
        # frozen legacy geocode fields, so a shared assembly regression cannot pass on both sides.
        frozen = gateway_family.Frozen(FIXTURE)
        backend = json.loads(frozen.backends[('v000903', 'kma')])
        geo = json.loads(frozen.coord[(37.566, 126.978, 'ko')])
        merged = dict(backend)
        for key in ('name', 'country', 'address', 'location'):
            merged[key] = geo[key]
        hop = ('backend', '/v000903/kma/addr/x', 'ko')
        good = record('W07', body=json.dumps(merged, ensure_ascii=False).encode(), hops=[hop])
        good.update(path='/weather/v000903/coord/37.5663,126.9779', method='GET', headers_sent={'accept-language': 'ko-KR'},
                    merge_oracle=True)
        bad = dict(good, body=json.dumps(dict(merged, name='wrong'), ensure_ascii=False).encode())
        self.assertEqual(gateway_family.weather_oracle([good], frozen), (1, []))
        checked, mismatches = gateway_family.weather_oracle([bad], frozen)
        self.assertEqual((checked, mismatches[0]['request']), (1, 'W07'))


class HarnessTest(unittest.TestCase):
    def test_percentiles_are_nearest_rank(self):
        self.assertEqual(harness.percentiles(range(1, 101)), {'n': 100, 'p50': 50, 'p95': 95, 'p99': 99, 'max': 100})
        self.assertEqual(harness.percentiles([7.0]), {'n': 1, 'p50': 7.0, 'p95': 7.0, 'p99': 7.0, 'max': 7.0})
        self.assertEqual(harness.percentiles([]), {'n': 0})

    def test_non_loopback_targets_are_refused(self):
        for url in ('http://localhost:1', 'https://127.0.0.1:1', 'http://10.0.0.1:80', 'http://127.0.0.1:1/x',
                    'http://user@127.0.0.1:1', 'http://127.0.0.1', 'http://127.0.0.1:1?x=1'):
            with self.assertRaises(ValueError, msg=url):
                harness.loopback(url)
        self.assertEqual(harness.loopback('http://127.0.0.1:8080'), ('127.0.0.1', 8080))

    def test_delta_reports_only_changes(self):
        self.assertEqual(harness.delta({'a': 2, 'b': 1, 'c': 0}, {'a': 1, 'b': 1}), {'a': 1})


class FixtureTest(unittest.TestCase):
    def body(self, case_id):
        return json.loads(base64.b64decode(CASES[case_id]['body_base64']))

    def test_frozen_legacy_geocode_bodies_derive_from_s02_records(self):
        entries = {(e['route'], e.get('lang'), e.get('lat')): e['body'] for e in FIXTURE['legacy_geocode']}
        self.assertEqual(entries[('coord', 'en', 37.566)], self.body('geocode-v000903-coord'))
        self.assertEqual(entries[('addr', None, None)], self.body('geocode-v000903-addr'))
        for key, case_id in ((('coord', 'ko', 37.566), 'gateway-default-domestic'), (('coord', 'ko', 51.507), 'gateway-default-world')):
            merged = self.body(case_id)
            for field in ('name', 'country', 'address', 'location'):
                self.assertEqual(entries[key][field], merged[field], (case_id, field))
        hop = CASES['gateway-default-domestic']['dependency_trace']['backend'][0]['path'].split('?')[0]
        names = [unquote(part) for part in hop.split('/')[4:]]
        kma = entries[('coord', 'ko', 37.566)]['kmaAddress']
        self.assertEqual(names, [kma['name1'], kma['name2'], kma['name3']])
        self.assertNotIn('kmaAddress', entries[('coord', 'ko', 51.507)])

    def test_workload_references_are_resolvable(self):
        ids = [item['id'] for item in FIXTURE['workload']]
        self.assertEqual(len(ids), len(set(ids)))
        for position, item in enumerate(FIXTURE['workload']):
            if 'oracle' in item:
                case = CASES[item['oracle']]
                self.assertEqual(case['request']['path'], item['path'])
                self.assertEqual(case['request'].get('headers', {}), item.get('headers', {}))
            if 'if_none_match_from' in item:
                self.assertIn(item['if_none_match_from'], ids[:position])
        providers = json.loads(gateway_family.PROVIDERS.read_text())
        for name in FIXTURE['provider_fixtures'].values():
            self.assertIn(name, providers)
        for version in ('v000901', 'v000902', 'v000903'):
            for pattern in FIXTURE['backend_records'].values():
                self.assertIn(pattern.format(version=version), CASES)

    def test_declared_differences_have_reasons_and_no_body_or_status_waiver(self):
        for entry in DECLARED:
            self.assertTrue(entry['reason'].strip())
            self.assertIn(entry['scope'], ('header', 'acquisition'))
            self.assertFalse({'etag', 'cache-control', 'content-type', 'content-length'} & set(entry.get('names', [])))
            self.assertNotIn('backend', entry.get('kinds', []))

    def test_perturbation_changes_exactly_one_frozen_body(self):
        normal, perturbed = gateway_family.Frozen(FIXTURE), gateway_family.Frozen(FIXTURE, perturb=True)
        changed = [k for k in normal.coord if normal.coord[k] != perturbed.coord[k]]
        self.assertEqual(changed, [(37.566, 126.978, 'ko')])
        self.assertEqual(normal.addr, perturbed.addr)
        self.assertIsNone(normal.perturbation)


class RegistryTest(unittest.TestCase):
    def test_ready_family_module_contract(self):
        module = families.load('gateway')
        for name in ('SCENARIOS', 'smoke', 'REPLAY_FIXTURE', 'REPLAY_LIMITATIONS', 'replay_side', 'oracle_cases', 'rollback'):
            self.assertTrue(hasattr(module, name), name)
        self.assertEqual(len({s[0] for s in module.SCENARIOS}), len(module.SCENARIOS))
        with self.assertRaises(ValueError):
            families.load('domestic')

    def test_unknown_or_empty_scenario_selection_is_rejected(self):
        # R1-02: a selector typo must not produce a zero-scenario PASS.
        for selection in ({'GW-TYPO'}, {'GW-COLD-WARM', 'GW-TYPO'}, set()):
            with self.assertRaises(ValueError, msg=selection):
                gateway_family.smoke('unused-binary', selection)

    def test_workload_acquisition_plan_covers_every_request(self):
        for item in FIXTURE['workload']:
            plan = item.get('acquisitions')
            self.assertIsInstance(plan, dict, item['id'])
            self.assertEqual(set(plan), {'cold', 'warm'}, item['id'])
            for sides in plan.values():
                self.assertEqual(set(sides), {'baseline', 'candidate'}, item['id'])
            self.assertEqual(plan['warm']['candidate'], {}, item['id'] + ': warm native lookups must be RAM hits')

    def test_smoke_entrypoint_is_valid_bash(self):
        subprocess.run(['bash', '-n', str(SERVER2 / 'deploy/smoke.sh')], check=True)


class KmaFamilyTest(unittest.TestCase):
    def test_domestic_s3_family_is_registered_with_explicit_coverage(self):
        family = families.load('kma')
        self.assertEqual(family.FAMILY, 'kma')
        self.assertTrue(family.REPLAY_FIXTURE.is_file())
        self.assertIn('assembly-only', family.REPLAY_LIMITATIONS)


    def test_domestic_rollback_is_explicitly_unsupported(self):
        family = families.load('kma')
        self.assertFalse(families.CAPABILITIES['kma']['rollback'])
        with self.assertRaisesRegex(AssertionError, 'UNSUPPORTED'):
            family.rollback('unused-binary')

    def test_domestic_record_denominator_rejects_missing_extra_and_duplicate(self):
        family = families.load('kma')
        cases = [{'id': 'c'}]
        records = [{'id': 'c', 'pass': phase, 'cache': {'hits': 1, 'corruptions': 1}} for phase in family.PASSES]
        good = {'records': records, 'legacy_requests': 0, 'provider_requests': 0}
        family.validate_records(good, cases)
        for changed in (records[:-1], records + records[:1], records + [{'id': 'extra', 'pass': family.PASSES[0]}]):
            with self.assertRaises(AssertionError):
                family.validate_records(dict(good, records=changed), cases)

    def test_domestic_smoke_rejects_extra_functional_header(self):
        family = families.load('kma')
        case = {'id': 'c', 'status': 200, 'headers': [], 'body_base64': ''}
        records = [{'id': 'c', 'pass': phase, 'oracle': 'c', 'status': 200,
                    'headers': {'content-length': '0'}, 'body': b'', 'hops': []}
                   for phase in family.PASSES]
        # oracle_check checks expected header values only; the smoke must also
        # reject extra headers, such as the real Undefined HEAD wire regression.
        with patch.object(family, 'replay_side', return_value=(records, {})), \
             patch.object(family, 'oracle_cases', return_value={'c': case}):
            with self.assertRaisesRegex(AssertionError, 'content-length'):
                family.smoke('unused-binary')

    def test_domestic_manifest_keeps_original_assembly_denominator_separate(self):
        family = families.load('kma')
        fixture = json.loads(family.REPLAY_FIXTURE.read_text())
        self.assertEqual(fixture['assembly_only']['count'], 98)
        self.assertEqual(len(fixture['assembly_only']['cases']), 98)
        self.assertEqual(len(fixture['workload']), len(family.oracle()['requests']))
        self.assertEqual(len({c['id'] for c in fixture['workload']}), len(fixture['workload']))


if __name__ == '__main__':
    unittest.main()
