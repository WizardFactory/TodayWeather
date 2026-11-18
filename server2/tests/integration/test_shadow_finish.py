#!/usr/bin/env python3
"""Offline tests of the bucket audit seam used by the operator finish command."""

import json
import os
import subprocess
import sys
import time
import tempfile
import unittest
from unittest.mock import Mock, patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'deploy/shadow'))

from shadow_finish_fixture import build_fixture
import coordinator
import provision
from provision import audit_finish_bucket
from test_shadow_supervisor import J, owned_resources, provisioning_plan, state


class FinishBucketAuditTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / 'sources'
        fixture = build_fixture(self.source, attempts=3, body_bytes=40)
        self.run_id = fixture['run_id']
        self.launch_sha256 = fixture['launch_sha256']
        self.expected = fixture['expected_pairs']
        self.staged = {
            'inventory_complete': True,
            'objects': [
                dict(v, status='exported', file=v['path'])
                for v in fixture['versions']
                if v['bucket'] == fixture['state_bucket'] and v['kind'] == 'object'
            ],
        }

    def test_real_copy_audits_reproducibly_on_resume(self):
        for _ in range(2):
            report = audit_finish_bucket(
                self.source, self.staged, self.root, self.run_id, self.launch_sha256
            )
            self.assertTrue(report['complete'], report)
            evidence = self.root / report['directory'] / 'files'
            self.assertEqual(sorted(p.name for p in evidence.iterdir()), sorted(self.expected))

    def test_bound_finish_reads_and_verifies_bucket_before_fencing(self):
        journal = Mock()
        journal.snapshot.return_value = {'cleanup_until': 1100}
        journal.observe.return_value = {'last_seen': 1001}
        journal.operator_usage.return_value = {}
        journal.bind_finish_destination.return_value = self.root
        journal.request.side_effect = lambda key: {
            'owned-resources': {'params': {'run_id': self.run_id, 'buckets': ['raw', 'state']}},
            'host-install': {'params': {'launch_sha256': self.launch_sha256}},
        }.get(key)
        remote = Mock()
        actions = []

        def staged(*args, **kwargs):
            self.assertTrue(kwargs['evidence_only'])
            actions.append('bucket')
            return self.staged

        def fenced(*args, **kwargs):
            actions.append('fence')
            self.assertTrue(kwargs['paired_verified'])
            return {'status': 'fenced'}

        def sealed(*args, **kwargs):
            actions.append('seal')
            return dict(self.staged, complete=True)

        def disposed(*args, **kwargs):
            actions.append('dispose')
            self.assertTrue(kwargs['paired_verified'])
            return {'status': 'deleted'}

        def cleaned(*args, **kwargs):
            actions.append('nonstate')
            return {'complete': True}

        with (patch.object(coordinator, 'stage_source_versions', staged),
              patch.object(coordinator, 'fence_finish_instance', fenced),
              patch.object(coordinator, 'seal_finish_sources', sealed),
              patch.object(coordinator, 'dispose_finish_state', disposed),
              patch.object(coordinator, 'cleanup_finish_nonstate', cleaned, create=True)):
            result = provision.finish_run(Mock(), remote, journal, self.root, now=1001)

        self.assertTrue(result['cleanup']['complete'], result)
        self.assertEqual(actions, ['bucket', 'fence', 'seal', 'dispose', 'nonstate'])
        self.assertEqual(remote.mock_calls, [])
        self.assertTrue((self.root / 'result.json').is_file())

    def test_fenced_resume_revalidates_saved_ssh_pairs_without_remote(self):
        journal = Mock()
        journal.snapshot.return_value = {'cleanup_until': 1100}
        journal.observe.return_value = {'last_seen': 1001}
        journal.operator_usage.return_value = {}
        journal.bind_finish_destination.return_value = self.root
        journal.request.side_effect = lambda key: {
            'owned-resources': {'params': {'run_id': self.run_id, 'buckets': ['raw', 'state']}},
            'host-install': {'params': {'launch_sha256': self.launch_sha256}},
        }.get(key)
        (self.root / 'writer-fence.json').touch()
        (self.root / 'ssh-paired').mkdir()
        sealed = {'inventory_complete': True, 'objects': [], 'complete': True}
        import remote
        with (patch.object(coordinator, 'fence_finish_instance', return_value={'status': 'fenced'}),
              patch.object(coordinator, 'seal_finish_sources', return_value=sealed),
              patch.object(coordinator, 'dispose_finish_state', return_value={'status': 'deleted'}),
              patch.object(coordinator, 'cleanup_finish_nonstate', return_value={'complete': True}),
              patch.object(remote, 'assess_recovery', return_value={'complete': True, 'status': 'complete'}) as audit):
            result = provision.finish_run(Mock(), None, journal, self.root, now=1001)
        audit.assert_called_once_with(self.root / 'ssh-paired', self.launch_sha256,
                                      recovered=self.root / 'ssh-paired' / 'files')
        self.assertTrue(result['cleanup']['complete'], result)

    def test_incomplete_listing_cannot_verify_an_otherwise_valid_copy(self):
        self.staged['inventory_complete'] = False
        report = audit_finish_bucket(
            self.source, self.staged, self.root, self.run_id, self.launch_sha256
        )
        self.assertFalse(report['complete'])
        self.assertEqual(report['status'], 'bucket_inventory_incomplete')

    def test_unreadable_commit_index_cannot_verify_a_copy(self):
        for entry in self.staged['objects']:
            if '/index-' in entry['key']:
                entry.update(status='failed')
        report = audit_finish_bucket(
            self.source, self.staged, self.root, self.run_id, self.launch_sha256
        )
        self.assertFalse(report['complete'])
        self.assertEqual(report['status'], 'bucket_objects_incomplete')


class FinishTransferTests(unittest.TestCase):
    def test_verified_transfer_is_reused_without_charging_or_dispatching_again(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            with J(root / 'journal', create=True, run_id='case', manifest_sha='a' * 64, epoch=1000) as journal:
                output = journal.bind_finish_destination(root / 'finish', now=1001)
                ssh = Mock()
                ssh.binding = {'run_id': 'case'}

                def invoke(action, **kwargs):
                    self.assertEqual(action, 'finish-pairs')
                    self.assertEqual(kwargs['attempts'], [1])
                    kwargs['destination'].write_bytes(b'archive bytes')
                    return state.CloudResult('json', 'HostEvidence', {'archive_bytes': 13})

                ssh.invoke.side_effect = invoke
                args = ssh, journal, output, 'finish-pairs'
                first = provision.transfer_finish_evidence(*args, now=1001, timeout=3, limit=1024, attempts=[1])
                spent = journal.snapshot()
                second = provision.transfer_finish_evidence(*args, now=1002, timeout=3, limit=1024, attempts=[1])
                self.assertEqual(first, second)
                self.assertEqual(first.read_bytes(), b'archive bytes')
                self.assertEqual(journal.snapshot(), spent)
                self.assertEqual(ssh.invoke.call_count, 1)


class FinishCliTests(unittest.TestCase):
    def test_no_ssh_finish_and_replay_retains_copies_without_repeat_get(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            epoch = int(time.time()) - 168 * 3600 - 10
            source = root / 'cloud'
            bundle = build_fixture(source, attempts=3, body_bytes=40, epoch=epoch)
            resources = owned_resources()
            self.assertEqual(resources['run_id'], bundle['run_id'])
            data = {'resources': resources, 'versions': bundle['versions'], 'instance_state': 'running',
                    'buckets': resources['buckets']}
            manifest = source / 'fixture.json'
            manifest.touch(mode=0o600)
            manifest.write_text(json.dumps(data))

            with J(root / 'journal', create=True, run_id=resources['run_id'],
                   manifest_sha='a' * 64, epoch=epoch) as journal:
                provision.freeze_plan(journal, provisioning_plan(), epoch + 1)
                journal.prepare_request('host-install', 'HostInstall',
                                        {'launch_sha256': bundle['launch_sha256']}, 'fixture', now=epoch + 2)
                journal.record_receipt('host-install', state.CloudResult('empty_success', 'HostInstall'))
                journal.record_cleanup_ownership(coordinator.resource_digest(resources),
                                                 resources['instance'], resources=resources)

            fixture_cli = Path(__file__).with_name('shadow_finish_fake_aws.py').resolve()
            output = root / 'finish'
            command = [sys.executable, str(Path(provision.__file__).resolve()), 'finish', '--execute',
                       '--state', str(root / 'journal'), '--output', str(output),
                       '--aws-executable', str(fixture_cli)]
            env = {k: v for k, v in os.environ.items() if not k.startswith('AWS_')}
            env['SHADOW_FINISH_AWS_FIXTURE'] = str(manifest)
            env['PYTHONDONTWRITEBYTECODE'] = '1'
            gets = None
            for _ in range(2):
                result = subprocess.run(command, text=True, capture_output=True, env=env, timeout=30)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                report = json.loads(result.stdout)
                self.assertTrue(report['host_evidence']['complete'], report)
                self.assertTrue(report['cleanup']['complete'], report)
                self.assertGreater(report['finish_accounting']['operator']['export_bytes'], 0)
                self.assertGreater(report['finish_accounting']['host_elapsed_seconds_upper'], 0)
                files = output / report['host_evidence']['directory'] / 'files'
                actual = {
                    p.name: {'sha256': coordinator.artifact_hash(p), 'size': p.stat().st_size}
                    for p in files.iterdir()
                }
                self.assertEqual(actual, bundle['expected_pairs'])
                calls = [json.loads(line) for line in (source / 'aws-calls.jsonl').read_text().splitlines()]
                attempts = sum(call['command'] == 'get-object' for call in calls)
                if gets is not None:
                    self.assertEqual(attempts, gets)
                gets = attempts
            operations = [call['command'] for call in calls]
            terminated = operations.index('terminate-instances')
            first_delete = operations.index('delete-objects')
            self.assertIn('describe-instances', operations[terminated + 1:first_delete])


if __name__ == '__main__':
    unittest.main()
