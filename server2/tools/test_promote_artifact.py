"""Check candidate artifact promotion offline; nothing from the artifact is executed."""
import io
import json
import os
from pathlib import Path
import struct
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
import promote_artifact
import verify_artifact

REVISION = 'a' * 40
SOURCE = {'revision': REVISION, 'server2_tree': 'b' * 40}


def static_elf(marker):
    """Smallest ELF64 x86_64 executable header that check_elf accepts, with one PT_LOAD."""
    header = bytearray(64)
    header[:6] = b'\x7fELF\x02\x01'
    struct.pack_into('<HH', header, 16, 2, 62)
    struct.pack_into('<Q', header, 32, 64)
    struct.pack_into('<HH', header, 54, 56, 1)
    program = bytearray(56)
    struct.pack_into('<I', program, 0, 1)
    return bytes(header + program) + marker


class PromoteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name) / 'artifact'
        self.dir.mkdir()
        for name in verify_artifact.BINARIES:
            (self.dir / name).write_bytes(static_elf(name.encode()))
            (self.dir / name).chmod(0o755)
        identity = patch.object(verify_artifact, 'source_identity', return_value=SOURCE)
        self.identity = identity.start()
        self.addCleanup(identity.stop)
        self.manifest = verify_artifact.snapshot(verify_artifact.ROOT, self.dir, SOURCE)
        self.write('manifest.json', self.manifest)
        self.write('verification.json', {'status': 'passed', 'manifest': self.manifest})
        self.write('local-matrix.json', {})
        for name in ('startup.log', 'matrix.log'):
            (self.dir / name).write_text('ok\n')
        self.archive({'native/bundle.json': b'{}'})
        bundle = patch.object(promote_artifact.native_artifact, 'verify',
                              return_value={'source': SOURCE, 'roles': ['server2']})
        self.bundle = bundle.start()
        self.addCleanup(bundle.stop)

    def write(self, name, value):
        (self.dir / name).write_text(json.dumps(value))

    def archive(self, files, link=None):
        with tarfile.open(self.dir / 'native.tar.gz', 'w:gz') as tar:
            for name, data in files.items():
                item = tarfile.TarInfo(name)
                item.size = len(data)
                tar.addfile(item, io.BytesIO(data))
            if link:
                item = tarfile.TarInfo(link)
                item.type, item.linkname = tarfile.SYMTYPE, '/etc/passwd'
                tar.addfile(item)

    def rejects(self, pattern):
        with self.assertRaisesRegex(ValueError, pattern):
            promote_artifact.promote(self.dir, REVISION)

    def test_matching_candidate_is_promoted_for_the_exact_revision(self):
        result = promote_artifact.promote(self.dir, REVISION)
        self.assertEqual('PASS', result['status'])
        self.assertEqual(SOURCE, result['source'])
        self.identity.assert_called_once_with(verify_artifact.ROOT, REVISION)
        extracted = self.bundle.call_args.args[0]
        self.assertEqual('native', extracted.name)

    def test_changed_binary_or_revision_is_rejected(self):
        (self.dir / 'server2').write_bytes(static_elf(b'changed'))
        self.rejects('manifest mismatch')
        (self.dir / 'server2').write_bytes(static_elf(b'server2'))
        self.identity.return_value = dict(SOURCE, revision='c' * 40)
        self.rejects('manifest mismatch')

    def test_inventory_must_match_exactly(self):
        (self.dir / 'extra.txt').write_text('x')
        self.rejects('inventory differs')
        (self.dir / 'extra.txt').unlink()
        (self.dir / 'matrix.log').unlink()
        self.rejects('inventory differs')

    def test_symlinked_entry_is_rejected(self):
        (self.dir / 'matrix.log').unlink()
        (self.dir / 'matrix.log').symlink_to(self.dir / 'startup.log')
        self.rejects('only regular files')

    def test_failed_or_mismatched_verification_is_rejected(self):
        self.write('verification.json', {'status': 'failed', 'manifest': self.manifest})
        self.rejects('did not pass')
        self.write('verification.json', {'status': 'passed', 'manifest': {}})
        self.rejects('did not pass')

    def test_unsafe_native_archive_entries_are_rejected(self):
        for files, link in (({'../escape': b'x'}, None), ({'other/file': b'x'}, None),
                            ({'native/bundle.json': b'{}'}, 'native/link')):
            with self.subTest(files=files, link=link):
                self.archive(files, link)
                self.rejects('unexpected native archive entry')
        self.bundle.assert_not_called()

    def test_candidate_must_match_the_musl_job_digest(self):
        recorded = promote_artifact.candidate_digest(self.dir)
        self.assertTrue(promote_artifact.promote(self.dir, REVISION, recorded)['digest_checked'])
        (self.dir / 'matrix.log').write_text('')
        with self.assertRaisesRegex(ValueError, 'differs from the files the musl job verified'):
            promote_artifact.promote(self.dir, REVISION, recorded)
        self.bundle.assert_called_once()

    def test_digest_ignores_file_modes_lost_in_transfer(self):
        before = promote_artifact.candidate_digest(self.dir)
        (self.dir / 'server2').chmod(0o644)
        self.assertEqual(before, promote_artifact.candidate_digest(self.dir))

    def test_record_digest_writes_the_job_output(self):
        output = Path(self.tmp.name) / 'github-output'
        with patch.dict(os.environ, {'GITHUB_OUTPUT': str(output)}):
            result = promote_artifact.record_digest(self.dir)
        self.assertEqual(f"digest={result['candidate_digest']}\n", output.read_text())

    def test_hosted_promotion_requires_a_well_formed_digest(self):
        with patch.dict(os.environ, {'GITHUB_ACTIONS': 'true'}, clear=True):
            with self.assertRaisesRegex(ValueError, 'requires the musl job candidate digest'):
                promote_artifact.expected_digest()
        for value in ('abc', 'G' * 64):
            with patch.dict(os.environ, {promote_artifact.DIGEST_ENV: value}, clear=True):
                with self.assertRaisesRegex(ValueError, 'invalid musl candidate digest'):
                    promote_artifact.expected_digest()
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(promote_artifact.expected_digest())

    def test_native_bundle_must_share_the_manifest_source(self):
        self.bundle.return_value = {'source': dict(SOURCE, server2_tree='d' * 40), 'roles': []}
        self.rejects('native bundle source differs')


if __name__ == '__main__':
    unittest.main()
