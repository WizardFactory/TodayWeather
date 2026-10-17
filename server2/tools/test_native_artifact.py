"""Complete native inputs survive export; malformed bundles never run children."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import tarfile
import unittest
from unittest.mock import patch

import native_artifact as bundle
from test_verify_artifact import elf


class Bundle(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve()
        self.repo = self.home/'repo'
        self.root = self.repo/'server2'
        self.root.mkdir(parents=True)
        (self.root/'Cargo.toml').write_text('fixture only')
        (self.root/'.env.example').write_text('AWS_ACCESS_KEY=\nAWS_SECRET_KEY=\n')
        (self.root/'fixtures').mkdir()
        (self.root/'fixtures/frozen.json').write_text('{"published":"fixed"}')
        for name in ('native_artifact.py', 'native_suite.py', 'verify_artifact.py'):
            path = self.root/'tools'/name
            path.parent.mkdir(exist_ok=True)
            path.write_bytes((Path(bundle.__file__).parent/name).read_bytes())
        self.git('init', '-q')
        self.git('add', 'server2')
        self.git('-c', 'user.name=Offline test', '-c', 'user.email=offline@example.invalid', 'commit', '-qm', 'fixed inputs')
        self.source = bundle.source_identity(self.root)
        self.target = self.root/'target'
        self.release = self.target/bundle.TARGET/'release'
        self.executables = {}
        self.messages = []
        for role in bundle.ROLES + bundle.EXTRAS:
            group = 'deps' if role in bundle.TESTS else 'examples'
            path = self.release/group/(role+'-compiler-id' if role in bundle.TESTS else role)
            if role == 'server2':
                path = self.release/role
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(elf()+role.encode())
            path.chmod(0o755)
            self.executables[role] = path
            self.messages.append({'reason': 'compiler-artifact', 'executable': str(path),
                                  'target': {'name': role, 'kind': ['test' if role in bundle.TESTS else 'bin' if role == 'server2' else 'example'],
                                             'src_path': str(self.root/'source.rs')},
                                  'profile': {'opt_level': '3', 'debug_assertions': False, 'test': role in bundle.TESTS}})
        self.out = self.home/'export'

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], stderr=subprocess.DEVNULL, text=True).strip()

    def export(self):
        return bundle.export(self.root, self.out, self.source, self.executables)

    def test_export_contains_existing_native_suite_roles(self):
        bundle.export(self.root, self.out, self.source, self.executables)
        manifest = json.loads((self.out/'artifacts.json').read_text())
        self.assertEqual(set(bundle.ROLES), set(manifest['artifacts']))
        self.assertEqual(manifest['revision'], self.source['revision'])
        self.assertTrue((self.out/'bin/examples/kma_s3_replay').is_file())
        self.assertFalse((self.out/'source/server2/target').exists())
        self.assertFalse(bundle.verify(self.out)['production_eligible'])

    def test_cargo_identity_not_guessed_test_filename(self):
        got = bundle.cargo_artifacts('\n'.join(map(json.dumps, self.messages)), self.root, self.target)
        self.assertEqual(got, self.executables)
        for field, value in [('opt_level', '0'), ('debug_assertions', True), ('test', True)]:
            data = json.loads(json.dumps(self.messages))
            data[0]['profile'][field] = value
            with self.assertRaises(ValueError):
                bundle.cargo_artifacts('\n'.join(map(json.dumps, data)), self.root, self.target)
        with self.assertRaises(ValueError):
            bundle.cargo_artifacts('\n'.join(map(json.dumps, self.messages[:-1])), self.root, self.target)
        data = json.loads(json.dumps(self.messages[0]))
        extra = self.release/'another-server2'
        extra.write_bytes(elf())
        data['executable'] = str(extra)
        with self.assertRaises(ValueError):
            bundle.cargo_artifacts('\n'.join(map(json.dumps, self.messages+[data])), self.root, self.target)
        for field in ('src_path', 'executable'):
            data = json.loads(json.dumps(self.messages))
            outside = self.home/'outside-release'
            outside.write_bytes(elf())
            if field == 'src_path':
                data[0]['target'][field] = str(outside)
            else:
                data[0][field] = str(outside)
            with self.assertRaises(ValueError):
                bundle.cargo_artifacts('\n'.join(map(json.dumps, data)), self.root, self.target)

    def test_archive_inside_payload_rejects_before_build(self):
        for archive in (self.out/'native.tar.gz', bundle.ROOT/'invalid-native.tar.gz'):
            args = ['native_artifact.py', '--output', str(self.out), '--archive', str(archive)]
            with self.subTest(archive=archive), patch.object(sys, 'argv', args), patch.object(bundle, 'build') as child:
                self.assertEqual(bundle.main(), 2)
                child.assert_not_called()

    def test_git_index_flags_cannot_hide_changed_source_bytes(self):
        fixed = self.root/'fixtures/frozen.json'
        for flag in ('assume-unchanged', 'skip-worktree'):
            original = fixed.read_bytes()
            self.git('update-index', '--'+flag, 'server2/fixtures/frozen.json')
            fixed.write_bytes(original+b'changed')
            self.assertEqual(bundle.source_identity(self.root), self.source)
            with self.assertRaises(ValueError):
                self.export()
            self.assertFalse(self.out.exists())
            fixed.write_bytes(original)
            self.git('update-index', '--no-'+flag, 'server2/fixtures/frozen.json')

    def test_actual_cargo_chunks_can_end_with_newlines(self):
        split = len(self.messages)//2
        chunks = ['\n'.join(map(json.dumps, part))+'\n' for part in
                  (self.messages[:split], self.messages[split:])]
        got = bundle.cargo_artifacts('\n'.join(chunks), self.root, self.target)
        self.assertEqual(got, self.executables)

    def test_copied_cli_without_environment_keeps_payload_unchanged(self):
        self.export()
        cli = self.out/'source/server2/tools/native_artifact.py'
        import os
        env = {k: os.environ[k] for k in ('PATH', 'LANG', 'LC_ALL', 'SYSTEMROOT') if k in os.environ}
        run = subprocess.run([sys.executable, str(cli), '--verify', str(self.out)],
                             env=env, text=True, capture_output=True)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertFalse(list((self.out/'source').rglob('__pycache__')))
        self.assertEqual((self.out/'source/server2').stat().st_mode & 0o222, 0)

    def test_archive_cli_preserves_hidden_files_modes_and_all_bytes(self):
        archive = self.home/'native.tar.gz'
        args = ['native_artifact.py', '--output', str(self.out), '--archive', str(archive)]
        with patch.object(sys, 'argv', args), patch.object(bundle, 'build', side_effect=lambda *a: self.export()) as build:
            self.assertEqual(bundle.main(), 0)
            build.assert_called_once()
        extracted = self.home/'download'
        extracted.mkdir()
        with tarfile.open(archive, 'r:gz') as tar:
            self.assertIn('native/source/server2/.env.example', tar.getnames())
            self.assertEqual(tar.getmember('native/source/server2').mode & 0o222, 0)
            tar.extractall(extracted)
        self.assertEqual(bundle.verify(extracted/'native')['files'], bundle.verify(self.out)['files'])
        self.assertTrue((extracted/'native/bin/server2').stat().st_mode & 0o111)
        with patch.object(sys, 'argv', args), patch.object(bundle, 'build') as build:
            self.assertEqual(bundle.main(), 2)
            build.assert_not_called()

    def test_source_dirty_or_symlink_is_not_exported(self):
        fixed = self.root/'fixtures/frozen.json'
        original = fixed.read_bytes()
        fixed.write_text('changed')
        with self.assertRaises(ValueError):
            self.export()
        self.assertFalse(self.out.exists())
        fixed.write_bytes(original)
        fixed.unlink()
        fixed.symlink_to(self.home/'outside')
        with self.assertRaises(ValueError):
            self.export()

    def test_foreign_dynamic_and_incomplete_input_rejected(self):
        for bad in (elf(183), elf(interpreter=True), b'not ELF'):
            self.executables['server2'].write_bytes(bad)
            with self.assertRaises(ValueError):
                self.export()
            self.assertFalse(self.out.exists())
        with self.assertRaises(ValueError):
            bundle.export(self.root, self.out, self.source, {})

    def test_tampered_binary_source_manifest_and_extra_payload_reject(self):
        self.export()
        for relative in ('bin/server2', 'source/server2/fixtures/frozen.json', 'artifacts.json'):
            path = self.out/relative
            original = path.read_bytes()
            path.chmod(0o644)
            path.write_bytes(original+b'changed')
            with self.assertRaises(ValueError):
                bundle.verify(self.out)
            path.write_bytes(original)
        extra = self.out/'unexpected'
        extra.write_text('not in source inventory')
        with self.assertRaises(ValueError):
            bundle.verify(self.out)
        extra.unlink()
        extra.symlink_to(self.out/'bin/server2')
        with self.assertRaises(ValueError):
            bundle.verify(self.out)

    def test_missing_fixture_mapping_and_existing_output_reject(self):
        self.export()
        with self.assertRaises(ValueError):
            bundle.verify(self.out, require_source_root=True)
        with self.assertRaises(FileExistsError):
            self.export()
        # Mapping is explicit operator work, never performed by the verifier.
        self.root.rename(self.repo/'original-server2')
        self.root.symlink_to(self.out/'source/server2', target_is_directory=True)
        bundle.verify(self.out, require_source_root=True)

    def test_fresh_process_cli_verifies_and_tamper_exits_two(self):
        self.export()
        cli = [sys.executable, str(Path(bundle.__file__)), '--verify', str(self.out)]
        run = subprocess.run(cli, text=True, capture_output=True)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(json.loads(run.stdout)['roles'], 11)
        (self.out/'bin/server2').write_bytes(elf()+b'changed')
        run = subprocess.run(cli, text=True, capture_output=True)
        self.assertEqual(run.returncode, 2)
        self.assertIn('hash mismatch', run.stderr)

    def test_verifier_never_launches_manifest_commands(self):
        self.export()
        meta = self.out/'bundle.json'
        data = json.loads(meta.read_text())
        data['files']['../outside'] = '0'*64
        meta.write_text(json.dumps(data))
        with patch('subprocess.run') as run, patch('subprocess.check_output') as output:
            with self.assertRaises(ValueError):
                bundle.verify(self.out)
            run.assert_not_called()
            output.assert_not_called()

    def test_build_existing_output_rejects_before_cargo(self):
        self.out.mkdir()
        with patch.object(bundle.sys, 'platform', 'linux'), patch('subprocess.check_output') as child:
            with self.assertRaises(ValueError):
                bundle.build(self.root, self.target, self.out, self.source['revision'])
            child.assert_not_called()


if __name__ == '__main__':
    unittest.main()
