#!/usr/bin/env python3
"""Offline tests for committed-first staging of the state bucket."""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'deploy/shadow'))

from shadow_finish_fixture import build_fixture
from test_shadow_supervisor import owned_resources
import coordinator


class StageCloud:
    def __init__(self, rows, *, listing_failure=False, unavailable=()):
        self.rows = rows
        self.listing_failure = listing_failure
        self.unavailable = unavailable
        self.fetched = []
        self.listed = []

    def call(self, operation, params, **options):
        if operation == 'DescribeInstances':
            return coordinator.CloudResult('service_error', operation, code='InvalidInstanceID.NotFound')
        bucket = params['Bucket']
        if operation == 'ListObjectVersions':
            self.listed.append(params)
            if self.listing_failure:
                return coordinator.CloudResult('timeout', operation)
            prefix = params.get('Prefix', '')
            versions = [{'Key': key, 'VersionId': version, 'Size': len(body)}
                        for (owner, key, version), body in self.rows.items()
                        if owner == bucket and key.startswith(prefix)]
            return coordinator.CloudResult('json', operation, {
                'IsTruncated': False, 'Versions': versions, 'DeleteMarkers': [],
            })
        assert operation == 'GetObject', operation
        key, version = params['Key'], params['VersionId']
        self.fetched.append((key, version))
        if (key, version) in self.unavailable:
            return coordinator.CloudResult('timeout', operation)
        body = self.rows[bucket, key, version]
        assert params['Range'] == f'bytes=0-{len(body) - 1}'
        options['output'].write_bytes(body)
        return coordinator.CloudResult('json', operation, {
            'VersionId': version, 'ContentLength': len(body), 'ContentRange': f'bytes 0-{len(body)-1}/{len(body)}',
            'Metadata': {}, 'LastModified': '2026-11-15T01:00:50Z',
        })


class FinishStagingTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name).resolve()
        fixture_root = root / 'bucket-fixture'
        fixture = build_fixture(fixture_root, attempts=2, body_bytes=40)
        self.resources = owned_resources()
        self.bucket = fixture['state_bucket']
        self.prefix = f"evidence/{fixture['run_id']}/"
        self.rows = {
            (row['bucket'], row['key'], row['version']): (fixture_root / row['path']).read_bytes()
            for row in fixture['versions'] if row['bucket'] == self.bucket and row['kind'] == 'object'
        }
        self.index = next(key for key in self.rows if key[1].removeprefix(self.prefix).startswith('index-'))
        self.ledger = next(key for key in self.rows if key[1].removeprefix(self.prefix).startswith('ledger-'))
        self.journal = root / 'run'
        self.output = root / 'output'
        with coordinator.Journal(self.journal, create=True, run_id=fixture['run_id'],
                                 manifest_sha='a' * 64, epoch=fixture['epoch']) as journal:
            journal.bind_finish_destination(self.output, now=fixture['epoch'])
            journal.record_cleanup_ownership(coordinator.resource_digest(self.resources),
                                             self.resources['instance'], resources=self.resources)

    def stage(self, *, sealed=False, **cloud_options):
        cloud = StageCloud(self.rows, **cloud_options)
        with coordinator.Journal(self.journal) as journal:
            destination = self.output / 'sources'
            if sealed:
                fence = coordinator.fence_finish_instance(cloud, journal, self.resources, now=1001)
                self.assertEqual(fence['status'], 'fenced', fence)
                report = coordinator.seal_finish_sources(cloud, journal, self.resources, destination)
            else:
                report = coordinator.stage_source_versions(
                    cloud, journal, self.resources, destination, evidence_only=True)
            charged = journal.db.execute('SELECT export_bytes FROM control WHERE id=1').fetchone()[0]
        return report, cloud, charged

    def test_controls_first_export_all_referenced_versions_and_defer_uncommitted(self):
        committed = sum(map(len, self.rows.values()))
        second_version = (*self.ledger[:2], 'duplicate')
        self.rows[second_version] = self.rows[self.ledger]
        orphan = self.prefix + 'batch-888.tar'
        self.rows[self.bucket, orphan, 'orphan'] = b'this uncommitted body consumes no allowance'
        report, cloud, charged = self.stage()
        self.assertTrue(report['complete'], report)
        self.assertEqual(cloud.listed[0]['Prefix'], self.prefix)
        self.assertEqual([key for key, _ in cloud.fetched[:2]], [self.prefix + 'contract.json', self.index[1]])
        self.assertIn(self.ledger[1:], cloud.fetched)
        self.assertIn(second_version[1:], cloud.fetched)
        self.assertNotIn((orphan, 'orphan'), cloud.fetched)
        self.assertEqual(charged, committed + len(self.rows[second_version]))
        omitted = next(obj for obj in report['objects'] if obj['key'] == orphan)
        self.assertEqual((omitted['status'], omitted['reason']), ('omitted', 'uncommitted'))
        self.assertIn(orphan, [obj['key'] for obj in report['inventory']])

        full, cloud, charged = self.stage(sealed=True)
        self.assertTrue(full['complete'])
        self.assertEqual(cloud.fetched, [(orphan, 'orphan')])
        self.assertEqual(charged, sum(map(len, self.rows.values())))

    def test_failed_index_is_incomplete_and_does_not_charge_for_unreferenced_bodies(self):
        report, cloud, charged = self.stage(unavailable=[self.index[1:]])
        self.assertFalse(report['complete'], report)
        self.assertEqual([key for key, _ in cloud.fetched], [self.prefix + 'contract.json', self.index[1]])
        self.assertEqual(charged, sum(len(self.rows[self.bucket, key, version]) for key, version in cloud.fetched))
        index = next(row for row in report['objects'] if row['key'] == self.index[1])
        self.assertEqual(index['status'], 'failed')

    def test_missing_reference_and_unavailable_listing_are_incomplete(self):
        self.rows.pop(self.ledger)
        report, _, _ = self.stage()
        self.assertFalse(report['complete'], report)
        self.assertEqual(report['missing_evidence_keys'], [self.ledger[1]])
        report, cloud, _ = self.stage(listing_failure=True)
        self.assertFalse(report['inventory_complete'])
        self.assertFalse(report['complete'])
        self.assertEqual(cloud.fetched, [])

    def test_malformed_index_cannot_turn_its_unavailable_references_into_a_pass(self):
        self.rows[self.index] = b'[]'
        report, cloud, _ = self.stage()
        self.assertFalse(report['complete'], report)
        self.assertNotIn(self.ledger[1:], cloud.fetched)
        index = next(row for row in report['objects'] if row['key'] == self.index[1])
        self.assertEqual((index['status'], index['reason']), ('failed', 'invalid_evidence_index'))


if __name__ == '__main__':
    unittest.main()
