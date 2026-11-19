#!/usr/bin/env python3
"""Offline behavior checks for the bounded SR-7 qualification evaluator."""

import hashlib
import json
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import test_shadow_supervisor as fx


EVALUATOR = Path(__file__).resolve().parents[2] / 'tools/shadow/qualification_evaluator.py'


class QualificationEvaluatorTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.finish = self.root / 'finish'
        self.finish.mkdir(mode=0o700)
        self.bundle = self.finish / 'ssh-paired'
        producer = self.root / 'producer'
        producer.mkdir()
        host = fx.EvidenceHost(producer)
        try:
            host.attempt(1)
            host.attempt(2)
            host.attempt(3, kind='pending')
            host.attempt(4, kind='capture-failure')
            with host.ledger.db:
                host.ledger.put('started', 1001.0)
                host.ledger.db.execute('UPDATE attempts SET slot=(id-1)/2')
                host.ledger.db.executemany('INSERT INTO slots VALUES (?,?)', [('seoul', 0), ('seoul', 1)])
        finally:
            host.ledger.close()
        self.host = host
        self.bundle.mkdir()
        for name in ('launch.json', 'reader.json'):
            shutil.copyfile(host.root / name, self.bundle / name)
        ledger = self.bundle / 'data/paired'
        ledger.mkdir(parents=True)
        shutil.copyfile(host.paired / 'ledger.sqlite3', ledger / 'ledger.sqlite3')
        self.files = self.bundle / 'files'
        self.files.mkdir()
        for file in host.paired.iterdir():
            if file.suffix in ('.json', '.body'):
                shutil.copyfile(file, self.files / file.name)
        (self.finish / 'result.json').write_text(json.dumps({
            'schema': 2, 'qualification': 'not_assessed',
            'host_evidence': {'status': 'complete', 'complete': True, 'directory': 'ssh-paired'},
        }))
        self.criteria = self.root / 'criteria.json'
        self.policy = {
            'schema': 1, 'profile': 'local_peer', 'run_id': 'test1',
            'launch_sha256': host.launch_sha256,
            'cases': {'seoul': {'family': 'domestic', 'expected_statuses': [200]}},
            'minimum_usable_pairs': {'domestic': 1},
        }
        self.planned_slots = (host.reader['duration_seconds'] + host.reader['cases'][0]['interval_seconds'] - 1) // host.reader['cases'][0]['interval_seconds']

    def run_evaluator(self, *, expected=0):
        self.criteria.write_text(json.dumps(self.policy))
        report = self.root / 'qualification.json'
        result = subprocess.run(
            [sys.executable, '-I', str(EVALUATOR), '--criteria', str(self.criteria),
             '--evidence', str(self.finish), '--out', str(report)],
            capture_output=True, text=True, timeout=8, check=False,
        )
        self.assertEqual(result.returncode, expected, result.stderr)
        return json.loads(report.read_bytes()) if report.exists() else None

    def configure_absolute_limits(self, *, error_bps=5000, within_bps=7500):
        self.policy['absolute_error_limits'] = {'domestic': {
            origin: {'maximum_error_bps': error_bps, 'minimum_admitted': 2}
            for origin in ('candidate', 'production')
        }}
        self.policy['reader_elapsed_limits'] = {'domestic': {
            origin: {'maximum_ms': 100, 'minimum_within_bound_bps': within_bps, 'minimum_admitted': 2}
            for origin in ('candidate', 'production')
        }}

    def update_candidate_capture(self, attempt, elapsed_ms, **changes):
        body = changes.pop('body', (self.files / '1.body').read_bytes())
        metadata = {'status': 200, 'headers': {}, 'body_bytes': len(body),
                    'body_sha256': hashlib.sha256(body).hexdigest(), **changes}
        (self.files / f'{attempt}.body').write_bytes(body)
        (self.files / f'{attempt}.json').write_text(fx.state.canonical(metadata))
        result = fx.state.canonical(dict(metadata, elapsed_ms=elapsed_ms))
        db = sqlite3.connect(self.bundle / 'data/paired/ledger.sqlite3')
        try:
            with db:
                db.execute('UPDATE attempts SET result=? WHERE id=?', (result, attempt))
        finally:
            db.close()

    def test_reads_real_ledger_and_distinguishes_pending_capture_and_provenance(self):
        report = self.run_evaluator()
        self.assertEqual(report['recommendation'], 'hold')
        criteria = {row['id']: row for row in report['criteria']}
        self.assertEqual(criteria['C1']['status'], 'pass')
        self.assertEqual(criteria['C2']['status'], 'pass')
        family = criteria['C2']['families']['domestic']
        self.assertEqual((family['planned_pairs'], family['matched_pairs'], family['usable_pairs']),
                         (self.planned_slots, 1, 1))
        self.assertEqual(family['origins']['candidate']['pending'], 1)
        self.assertEqual(family['origins']['production']['capture_failures'], 1)
        self.assertEqual(criteria['C3']['status'], 'unassessed')
        self.assertEqual(criteria['C3']['reason'], 'local_peer_is_not_production')
        self.assertEqual([criteria[key]['status'] for key in ('C5', 'C6')], ['unassessed', 'unassessed'])

    def test_absolute_error_union_and_pending_range(self):
        self.configure_absolute_limits()
        self.update_candidate_capture(1, 1, status=501, error='deadline')
        criteria = {row['id']: row for row in self.run_evaluator()['criteria']}
        origins = criteria['C5']['families']['domestic']
        candidate = origins['candidate']
        self.assertEqual((candidate['known_errors'], candidate['unexpected_status'], candidate['transport_errors'],
                          candidate['timeouts'], candidate['status_501']), (1, 1, 1, 1, 1))
        self.assertEqual(candidate['error_fraction'], {'lower_count': 1, 'upper_count': 2, 'admitted': 2})
        self.assertEqual((candidate['status'], candidate['reason']), ('unassessed', 'pending_may_change_result'))
        self.assertEqual(origins['production']['capture_failures'], 1)
        self.assertEqual(origins['production']['reason'], 'local_peer_is_not_production')
        elapsed = criteria['C6']['families']['domestic']['candidate']
        self.assertEqual(elapsed['sample_count'], 0)
        self.assertEqual(elapsed['within_bound_fraction'], {'lower_count': 0, 'upper_count': 1, 'admitted': 2})
        self.assertEqual(elapsed['status'], 'fail')

    def test_pending_makes_measured_fast_elapsed_ambiguous(self):
        self.configure_absolute_limits()
        criteria = {row['id']: row for row in self.run_evaluator()['criteria']}
        candidate = criteria['C6']['families']['domestic']['candidate']
        self.assertEqual(candidate['sample_count'], 1)
        self.assertEqual(candidate['nearest_rank_ms'], {'p50': 40, 'p95': 40, 'p99': 40})
        self.assertEqual(candidate['within_bound_fraction'], {'lower_count': 1, 'upper_count': 2, 'admitted': 2})
        self.assertEqual((candidate['status'], candidate['reason']), ('unassessed', 'pending_may_change_result'))
        self.assertEqual(criteria['C6']['cold'], 'unassessed')
        self.assertEqual(criteria['C6']['cache_hit'], 'unassessed')
        self.assertEqual(criteria['C6']['assembly'], 'unassessed')

    def test_nearest_rank_and_complete_population(self):
        self.configure_absolute_limits(error_bps=0, within_bps=6666)
        db = sqlite3.connect(self.bundle / 'data/paired/ledger.sqlite3')
        try:
            with db:
                db.execute("INSERT INTO slots VALUES ('seoul',2)")
                db.execute('INSERT INTO attempts(id,case_id,slot,origin,path,method,started) '
                           'SELECT 5,case_id,2,origin,path,method,started+2 FROM attempts WHERE id=3')
        finally:
            db.close()
        for attempt, elapsed_ms in ((1, 100), (3, 400), (5, 20)):
            self.update_candidate_capture(attempt, elapsed_ms)
        criteria = {row['id']: row for row in self.run_evaluator()['criteria']}
        self.assertEqual(criteria['C5']['families']['domestic']['candidate']['status'], 'pass')
        candidate = criteria['C6']['families']['domestic']['candidate']
        self.assertEqual(candidate['sample_count'], 3)
        self.assertEqual(candidate['nearest_rank_ms'], {'p50': 100, 'p95': 400, 'p99': 400})
        self.assertEqual(candidate['within_bound_fraction'], {'lower_count': 2, 'upper_count': 2, 'admitted': 3})
        self.assertEqual(candidate['status'], 'pass')
        self.assertEqual(criteria['C6']['status'], 'unassessed')

    def test_body_policy_reports_visible_sections_and_only_aligned_values(self):
        self.policy['cases']['seoul']['json_contract'] = {
            'sections': {'current': 'object'}, 'alignment': ['publication', 'units', 'location'],
            'values': {'current.temp': {'absolute_tolerance': 1}},
        }
        for publication, temperature, bucket in [('t1', 11, 'within'), ('t1', 12, 'different'),
                                                 ('t2', 10, 'unaligned')]:
            with self.subTest(bucket=bucket):
                for ident, time, value in [(1, publication, temperature), (2, 't1', 10)]:
                    self.update_candidate_capture(ident, 42, body=json.dumps(
                        dict(publication=time, units='C', location='Seoul', current=dict(temp=value))).encode())
                rows = {r['id']: r for r in self.run_evaluator()['criteria']}
                self.assertEqual(rows['C3']['observations']['seoul']['candidate']['valid'], 1)
                self.assertEqual(rows['C4']['observations']['seoul']['current.temp'][bucket], 1)
                self.assertEqual(rows['C4']['status'], 'unassessed')
                (self.root / 'qualification.json').unlink()

    def test_shape_failure_disqualifies_http_200_once(self):
        self.policy['cases']['seoul']['json_contract'] = {
            'sections': {'current': 'object'}, 'alignment': [], 'values': {},
        }
        self.update_candidate_capture(1, 20, body=b'{"current":null}')
        rows = {r['id']: r for r in self.run_evaluator()['criteria']}
        self.assertEqual(rows['C3']['observations']['seoul']['candidate']['invalid_section'], 1)
        self.assertEqual(rows['C5']['families']['domestic']['candidate']['known_errors'], 1)
        self.assertEqual(rows['C6']['families']['domestic']['candidate']['sample_count'], 0)
        self.assertEqual(rows['C2']['families']['domestic']['usable_pairs'], 0)

    def test_production_profile_reports_aligned_mismatch_and_missing_alignment(self):
        self.policy['profile'] = 'production_shadow'
        self.policy['cases']['seoul']['json_contract'] = {
            'sections': {'current': 'object'}, 'alignment': ['pub'],
            'values': {'current.value': 'exact'},
        }
        for pub, outcome, verdict in [('p', 'different', 'fail'), (None, 'missing_alignment', 'unassessed')]:
            for ident, place, value in [(1, pub, False), (2, 'p', 0)]:
                self.update_candidate_capture(ident, 15, body=json.dumps(
                    dict(pub=place, current=dict(value=value))).encode())
            report = self.run_evaluator()
            row = report['criteria'][3]
            self.assertEqual(row['observations']['seoul']['current.value'][outcome], 1)
            self.assertEqual(row['status'], verdict)
            (self.root / 'qualification.json').unlink()

    def test_production_profile_unexpected_http_fails_status_criterion(self):
        self.policy['profile'] = 'production_shadow'
        self.update_candidate_capture(2, 20, status=503)
        row = self.run_evaluator()['criteria'][2]
        self.assertEqual(row['http_by_family']['domestic']['differing_status_pairs'], 1)
        self.assertEqual(row['status'], 'fail')

    def test_invalid_absolute_policy_cannot_produce_report(self):
        self.configure_absolute_limits(error_bps=10001)
        self.assertIsNone(self.run_evaluator(expected=2))

    def test_truncated_200_fails_known_error_bound_and_has_no_elapsed_sample(self):
        self.configure_absolute_limits(error_bps=4999, within_bps=0)
        self.update_candidate_capture(1, 1, error='oversize')
        criteria = {row['id']: row for row in self.run_evaluator()['criteria']}
        errors = criteria['C5']['families']['domestic']['candidate']
        self.assertEqual((errors['known_errors'], errors['truncated_responses'], errors['unusable_http_200']),
                         (1, 1, 1))
        self.assertEqual((errors['status'], errors['reason']), ('fail', 'known_error_fraction_exceeds_limit'))
        elapsed = criteria['C6']['families']['domestic']['candidate']
        self.assertEqual((elapsed['status'], elapsed['reason']), ('unassessed', 'successful_elapsed_samples_required'))

    def test_synthetic_metrics_are_reported_without_qualification(self):
        self.configure_absolute_limits(error_bps=10000, within_bps=0)
        self.policy['profile'] = 'synthetic'
        criteria = {row['id']: row for row in self.run_evaluator()['criteria']}
        for key in ('C5', 'C6'):
            self.assertEqual(criteria[key]['status'], 'unassessed')
            self.assertEqual(criteria[key]['families']['domestic']['candidate']['reason'], 'synthetic_profile')

    def test_invalid_launch_metadata_cannot_leave_absolute_passes(self):
        self.configure_absolute_limits(error_bps=10000, within_bps=0)
        path = self.bundle / 'launch.json'
        launch = json.loads(path.read_bytes())
        del launch['plan']['source_commit']
        blob = fx.state.canonical(launch).encode()
        path.write_bytes(blob)
        self.policy['launch_sha256'] = hashlib.sha256(blob).hexdigest()
        criteria = {row['id']: row for row in self.run_evaluator()['criteria']}
        self.assertEqual(criteria['C1']['status'], 'fail')
        for key in ('C5', 'C6'):
            self.assertEqual(criteria[key]['reason'], 'evidence_required')

    def test_tampered_evidence_cannot_pass(self):
        (self.files / '1.body').write_bytes(b'body x')
        report = self.run_evaluator()
        self.assertEqual(report['recommendation'], 'no_go')
        criteria = {row['id']: row for row in report['criteria']}
        self.assertEqual(criteria['C1']['status'], 'fail')
        self.assertEqual(criteria['C2']['status'], 'unassessed')

    def test_missing_evidence_yields_hold_without_a_pass(self):
        (self.finish / 'result.json').unlink()
        report = self.run_evaluator()
        self.assertEqual(report['recommendation'], 'hold')
        self.assertNotIn('pass', [row['status'] for row in report['criteria']])

    def test_equal_5xx_and_unaligned_304_are_counted_but_do_not_satisfy_coverage(self):
        self.policy['cases']['seoul']['expected_statuses'] = [200, 503, 304]
        for status in (503, 304):
            with self.subTest(status=status):
                db = sqlite3.connect(self.bundle / 'data/paired/ledger.sqlite3')
                try:
                    for attempt in (1, 2):
                        path = self.files / f'{attempt}.json'
                        metadata = json.loads(path.read_bytes())
                        metadata['status'] = status
                        path.write_text(fx.state.canonical(metadata))
                        with db:
                            db.execute('UPDATE attempts SET result=? WHERE id=?',
                                       (fx.state.canonical(dict(metadata, elapsed_ms=40)), attempt))
                finally:
                    db.close()
                criteria = {row['id']: row for row in self.run_evaluator()['criteria']}
                family = criteria['C2']['families']['domestic']
                self.assertEqual(family['matched_pairs'], 1)
                self.assertEqual(family['usable_pairs'], 0)
                self.assertEqual(family['unaligned_304_pairs'], int(status == 304))
                self.assertEqual(criteria['C2']['status'], 'unassessed')
                for origin in ('candidate', 'production'):
                    self.assertEqual(family['origins'][origin]['status_counts'], {str(status): 1})
                (self.root / 'qualification.json').unlink()

    def test_bucket_finish_validates_actual_capture_versions_and_detects_changed_original(self):
        copy, _ = fx.load_evidence_modules()
        sink = fx.FakeS3(copy)
        tree = copy.HostTree(self.host.root / 'launch.json')
        copy.run(tree, final=True, put=sink.put, clock=lambda: 1010,
                 unit_state=lambda: ('inactive', fx.STOPPED_AT), log=lambda _: None)
        sources = self.finish / 'sources'
        sources.mkdir()
        catalog, receipts = [], []
        for key, versions in sorted(sink.objects.items()):
            for ordinal, data in enumerate(versions):
                version = str(ordinal + 1)
                original = dict(bucket=tree.bucket, kind='object', key=key, version=version)
                ident = hashlib.sha256(fx.state.canonical(original).encode()).hexdigest()
                row = dict(original, id=ident, size=len(data))
                relative = f'objects/{ident}/body'
                path = sources / relative
                path.parent.mkdir(parents=True)
                path.write_bytes(data)
                catalog.append(row)
                receipts.append(dict(row, status='exported', file=relative, sha256=hashlib.sha256(data).hexdigest()))
        original = dict(schema=1, listings={tree.bucket: 'complete'}, inventory=catalog, objects=receipts,
                        inventory_sha256=hashlib.sha256(fx.state.canonical(catalog).encode()).hexdigest(),
                        inventory_complete=True)
        (sources / 'evidence-manifest.json').write_text(fx.state.canonical(original))
        verified = fx.provision.audit_finish_bucket(sources, original, self.finish, tree.run_id, self.host.launch_sha256)
        self.assertTrue(verified['complete'], verified)
        (self.finish / 'result.json').write_text(json.dumps({
            'schema': 2, 'qualification': 'not_assessed', 'host_evidence': verified,
        }))
        report = self.run_evaluator()
        self.assertEqual(report['criteria'][0]['status'], 'pass')
        (self.root / 'qualification.json').unlink()
        path = sources / receipts[0]['file']
        path.write_bytes(path.read_bytes() + b'x')
        report = self.run_evaluator()
        self.assertEqual(report['criteria'][0]['status'], 'fail')
        self.assertEqual(report['criteria'][0]['reason'], 'original_evidence_version_changed')

    def test_inconsistent_policy_cannot_produce_a_report(self):
        self.policy['minimum_usable_pairs'] = {'no_such_family': 3}
        self.assertIsNone(self.run_evaluator(expected=2))


if __name__ == '__main__':
    unittest.main()
