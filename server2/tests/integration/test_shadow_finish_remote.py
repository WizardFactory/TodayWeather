#!/usr/bin/env python3
"""Offline tests of the fixed SSH commands and exact recovery archive contract."""
import base64
import fcntl
import io
import json
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest

import test_shadow_supervisor as fixture

remote = fixture.remote
StateError = fixture.E


def archive_data(items):
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode='w', format=tarfile.USTAR_FORMAT) as archive:
        for name, content in items:
            member = tarfile.TarInfo(name)
            member.size = len(content)
            archive.addfile(member, io.BytesIO(content))
    return data.getvalue()


class TargetedRecoveryTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        record = self.root / 'argv.json'
        identity = self.root / 'identity'
        identity.touch(mode=0o600)
        fake = self.root / 'fixture-ssh'
        response = base64.b64encode(archive_data([('data/paired/9.json', b'{}')])).decode()
        fake.write_text(
            '#!' + sys.executable + '\n'
            'import base64,json,sys\n'
            'from pathlib import Path\n'
            'command = sys.argv[-1]\n'
            'data = sys.stdin.buffer.read()\n'
            f'Path({str(record)!r}).write_text(json.dumps([command, data.decode()]))\n'
            f'if data: sys.stdout.buffer.write(base64.b64decode({response!r}))\n'
        )
        fake.chmod(0o700)
        self.record = record
        self.transport = remote.Remote(
            fixture.RemoteTests().binding(), identity, self.root / 'known_hosts', ssh=str(fake)
        )

    def test_finalize_finishes_before_separate_collector_drain(self):
        result = self.transport.invoke('finish-finalize')
        self.assertEqual(result.kind, 'empty_success')
        command, _ = json.loads(self.record.read_text())
        acquire, finalizer = command.split(' && ')
        for unit in ('reader', 'candidate', 'guard'):
            self.assertIn(f'server2-shadow-test1-{unit}.service', shlex.split(acquire))
        self.assertEqual(shlex.split(finalizer)[-2:], ['start', 'server2-shadow-test1-finalize.service'])
        self.assertNotIn('logs.service', command)

        result = self.transport.invoke('finish-drain')
        self.assertEqual(result.kind, 'empty_success')
        command, _ = json.loads(self.record.read_text())
        self.assertEqual(shlex.split(command)[-2:], ['stop', 'server2-shadow-test1-logs.service'])

    def test_selected_files_use_bounded_numeric_request_on_stdin(self):
        path = self.root / 'selected.tar'
        result = self.transport.invoke('finish-pairs', destination=path, attempts=(9, 11), limit=32768, timeout=1.25)
        self.assertEqual((result.kind, result.operation), ('json', 'HostEvidence'))
        command, body = json.loads(self.record.read_text())
        self.assertEqual(json.loads(body), {'attempts': [9, 11], 'limit': 32768, 'timeout': 1.25})
        self.assertEqual(shlex.split(command)[-1], 'pairs')
        self.assertEqual(result.payload['archive_bytes'], path.stat().st_size)
        self.assertEqual(path.stat().st_mode & 0o077, 0)

    def test_invalid_selection_refused_before_ssh(self):
        for attempts in ((True,), (0,), (9, 9), ('../9',), (11, 9)):
            with self.subTest(attempts=attempts):
                path = self.root / 'bad.tar'
                with self.assertRaises(StateError):
                    self.transport.invoke('finish-pairs', destination=path, attempts=attempts, limit=32768)
                self.assertFalse(self.record.exists())
                self.assertFalse(path.exists())

    def test_selected_extract_rejects_extra_even_if_in_legacy_inventory(self):
        archive = self.root / 'extra.tar'
        archive.write_bytes(archive_data([
            ('data/paired/9.json', b'{}'), ('data/paired/9.body', b''),
            ('data/paired/10.body', b'another attempt'),
        ]))
        destination = self.root / 'received'
        with self.assertRaises(StateError):
            remote.unpack_recovery(archive, destination, attempts=(9,))
        self.assertFalse((destination / 'data/paired/10.body').exists())

    def test_local_transfer_refuses_an_archive_larger_than_its_precharge(self):
        path = self.root / 'too-large.tar'
        result = self.transport.invoke('finish-pairs', destination=path, attempts=(9,), limit=512)
        self.assertEqual(result.kind, 'command_error')
        self.assertLessEqual(path.stat().st_size, 512)


class RecoveryAssessmentTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        host = fixture.EvidenceHost(self.root)
        try:
            host.attempt(1)
            host.attempt(2)
            host.attempt(3, kind='pending')
            host.attempt(4, kind='capture-failure')
            host.ledger.terminal('duration-complete')
        finally:
            host.ledger.close()
        self.host = host
        self.cached = self.root / 'cached'
        self.recovered = self.root / 'recovered'
        for directory, attempt in ((self.cached, 1), (self.recovered, 2)):
            directory.mkdir(mode=0o700)
            for suffix in ('json', 'body'):
                name = f'{attempt}.{suffix}'
                shutil.copyfile(host.paired / name, directory / name)

    def assess(self, *, after_recovery=False):
        return remote.assess_recovery(
            self.host.root, self.host.launch_sha256, cached=self.cached,
            recovered=self.recovered if after_recovery else None,
        )

    def test_only_missing_mandatory_pair_is_requested_and_rechecked(self):
        report = self.assess()
        self.assertEqual(report['status'], 'missing_pairs')
        self.assertEqual(report['pending'], [3])
        self.assertEqual(report['capture_failures'], [4])
        self.assertEqual(report['missing_or_mismatched'], [2])
        self.assertEqual(report['files'], {'1': 'cached'})
        self.assertEqual(report['archive_members_bytes'], {'2': 2048})
        self.assertEqual(report['archive_limit'], 10240)

        report = self.assess(after_recovery=True)
        self.assertTrue(report['complete'])
        self.assertEqual(report['files'], {'1': 'cached', '2': 'recovered'})

    def test_embedded_exporter_copies_only_selected_pair_and_requires_stopped_reader(self):
        base = self.root.resolve() / 'installed'
        base.mkdir(mode=0o700)
        installed = base / 'test1'
        self.host.root.rename(installed)
        bins = installed / 'bin'
        systemctl = bins / 'fixture-systemctl'
        systemctl.write_text('#!/bin/sh\nprintf "ActiveState=inactive\n"\n')
        systemctl.chmod(0o700)
        original = fixture.SOURCE.with_name('evidence_copy.py').read_text()
        (bins / 'evidence_copy.py').write_text(original.replace('/usr/bin/systemctl', str(systemctl)))
        shutil.copyfile(fixture.SOURCE.with_name('state.py'), bins / 'state.py')
        lock = installed / 'data/paired/owner.lock'
        lock.touch()
        script = remote.FINISH_EXPORTER.replace("Path('/opt/server2-shadow')", f'Path({str(base)!r})')

        def export(mode, attempts):
            request = json.dumps({'attempts': attempts, 'limit': 131072, 'timeout': 5}).encode()
            return subprocess.run([sys.executable, '-I', '-c', script, 'test1', mode],
                                  input=request, capture_output=True, timeout=6, check=False)

        launch = installed / 'launch.json'
        plan = json.loads(launch.read_text())
        plan['epoch'] = int(time.time()) - fixture.state.HOST_LIFETIME_SECONDS
        launch.write_text(json.dumps(plan))
        expired = export('pairs', [2])
        self.assertNotEqual(expired.returncode, 0)
        self.assertFalse(expired.stdout)
        self.assertIn(b'deadline', expired.stderr)
        plan['epoch'] += 60
        launch.write_text(json.dumps(plan))

        with lock.open('rb') as stream:
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
            self.assertNotEqual(export('ledger', []).returncode, 0)
        ledger = lock.with_name('ledger.sqlite3')
        moved = ledger.rename(ledger.with_suffix('.bak'))
        ledger.symlink_to(moved.name)
        redirected = export('ledger', [])
        self.assertNotEqual(redirected.returncode, 0)
        self.assertFalse(redirected.stdout)
        ledger.unlink()
        moved.rename(ledger)
        result = export('ledger', [])
        self.assertEqual(result.returncode, 0, result.stderr)
        with tarfile.open(fileobj=io.BytesIO(result.stdout)) as archive:
            self.assertEqual(set(archive.getnames()), {
                'launch.json', 'reader.json', 'data/paired/ledger.sqlite3',
            })
        result = export('pairs', [2])
        self.assertEqual(result.returncode, 0, result.stderr)
        with tarfile.open(fileobj=io.BytesIO(result.stdout)) as archive:
            self.assertEqual(set(archive.getnames()), {'data/paired/2.body', 'data/paired/2.json'})
            self.assertEqual(archive.extractfile('data/paired/2.body').read(), b'body 2')

    def test_corrupted_recovered_body_cannot_satisfy_ledger(self):
        (self.recovered / '2.body').write_bytes(b'body x')
        self.assertEqual(self.assess(after_recovery=True)['missing_or_mismatched'], [2])

    def test_unbound_reader_and_untrusted_local_symlink_are_refused(self):
        (self.cached / '1.body').unlink()
        (self.cached / '1.body').symlink_to(self.host.paired / '1.body')
        self.assertEqual(self.assess(after_recovery=True)['missing_or_mismatched'], [1])

        reader = self.host.root / 'reader.json'
        reader.write_bytes(reader.read_bytes() + b' ')
        report = self.assess(after_recovery=True)
        self.assertFalse(report['complete'])
        self.assertEqual(report['status'], 'ledger_invalid')


if __name__ == '__main__':
    unittest.main()
