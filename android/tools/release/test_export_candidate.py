"""Tests for export_candidate.py, in Git repositories made for each test.

The export must hold the commit's android/ files byte for byte, with their modes, and the two private inputs, and
nothing else, whatever the checkout, its Git configuration or its attributes say. The oracle is independent of
the tool: every exported file is compared with `git cat-file blob` of the commit's entry.
"""
import importlib.util
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest

TOOL = Path(__file__).with_name('export_candidate.py')
spec = importlib.util.spec_from_file_location('export_candidate', TOOL)
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)
ENV = {**os.environ, 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_SYSTEM': '/dev/null',
       'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@example.invalid',
       'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@example.invalid'}


class ExportCandidateTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.temp = Path(temp.name).resolve()
        self.repo = self.temp / 'repo'
        (self.repo / 'android/tools/release').mkdir(parents=True)
        (self.repo / 'android/tools/release/export_candidate.py').write_bytes(TOOL.read_bytes())
        self.git('init', '-q', '-b', 'master')
        self.write('android/.gitignore', 'private.properties\napp/google-services.json\nbuild/\nIgnored*.kt\n')
        self.write('android/app/src/main/App.kt', 'one\n')
        self.write('android/app/src/main/날씨.kt', 'korean\n')
        self.write('android/app/src/main/assets/data.txt', 'line one\nline two\n')
        self.write('android/gradlew', '#!/bin/sh\n', executable=True)
        self.write('client/app.js', 'other\n')
        self.first = self.commit('one')
        self.write('android/app/src/main/App.kt', 'two\n')
        self.write('android/app/src/main/Kept.kt', 'kept\n')
        self.head = self.commit('two')
        self.private = self.temp / 'private'
        self.private.mkdir()
        (self.private / 'google-services.json').write_text('{"stand": "in"}\n')
        (self.private / 'private.properties').write_text('TW_SERVER_URL=https://stand-in.invalid\n')
        self.out = self.temp / 'out'

    def git(self, *args, check=True):
        result = subprocess.run(['git', *args], cwd=self.repo, env=ENV, capture_output=True)
        if check and result.returncode:
            self.fail(f'git {args}: {result.stderr.decode()}')
        return result.stdout

    def write(self, path, text, executable=False):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
        if executable:
            target.chmod(0o755)

    def commit(self, message):
        self.git('add', '-A')
        self.git('commit', '-q', '-m', message)
        return self.git('rev-parse', 'HEAD').decode().strip()

    def export(self, commit=None, out=None, private=None, cwd=None):
        arguments = [sys.executable, str(self.repo / 'android/tools/release/export_candidate.py'),
                     commit or self.head, str(out or self.out)]
        if private is not False:
            arguments += ['--private', str(private or self.private)]
        return subprocess.run(arguments, cwd=cwd or self.repo, env=ENV, capture_output=True, text=True)

    def assert_is_commit(self, commit, out):
        """Every file of commit:android is in the export with its bytes and mode, and nothing else but the inputs."""
        entries = {}
        listing = self.git('-c', 'core.quotePath=false', 'ls-tree', '-r', '-z', '--full-tree', commit, '--', 'android')
        for entry in listing.split(b'\0'):
            if entry:
                meta, name = entry.split(b'\t', 1)
                mode, _kind, oid = meta.split()
                entries[os.fsdecode(name)] = (mode, oid.decode())
        exported = set()
        for directory, _dirs, files in os.walk(out / 'android'):
            for name in files:
                path = Path(directory) / name
                self.assertFalse(path.is_symlink(), path)
                exported.add(str(path.relative_to(out)))
        private = {'android/app/google-services.json', 'android/private.properties'}
        self.assertEqual(set(entries) | private, exported)
        for name, (mode, oid) in entries.items():
            path = out / name
            self.assertEqual(self.git('cat-file', 'blob', oid), path.read_bytes(), name)
            self.assertEqual(mode == b'100755', bool(path.stat().st_mode & stat.S_IXUSR), name)
        self.assertEqual(commit, (out / 'CANDIDATE').read_text().strip())
        self.assertEqual((self.private / 'private.properties').read_bytes(), (out / 'android/private.properties').read_bytes())
        self.assertEqual((self.private / 'google-services.json').read_bytes(), (out / 'android/app/google-services.json').read_bytes())

    def assert_refused(self, result, status, reason, out=None):
        self.assertEqual(status, result.returncode, result.stdout + result.stderr)
        self.assertRegex(result.stderr, reason)
        self.assertFalse((out or self.out).exists(), 'a refused export leaves no directory')

    def test_exports_the_commit_from_a_checkout_in_any_state(self):
        self.write('android/app/src/main/App.kt', 'changed\n')
        self.write('android/gradlew', 'staged\n')
        self.git('add', 'android/gradlew')
        self.write('android/app/src/main/Stray.kt', 'x\n')
        self.write('android/app/src/main/Ignored.kt', 'x\n')
        self.write('android/app/src/main/Ignored한글.kt', 'x\n')
        self.write('android/app/src/main/Ignored"quote.kt', 'x\n')
        self.write('android/private.properties', 'TW_SERVER_URL=https://checkout.invalid\n')
        self.write('android/app/build/Generated.class', 'x\n')
        self.write('android/app/src/main/Kept.kt', 'hidden\n')
        self.git('update-index', '--assume-unchanged', 'android/app/src/main/Kept.kt')
        self.git('config', 'status.showUntrackedFiles', 'no')
        result = self.export()
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn(f'exported {self.head}', result.stdout)
        self.assert_is_commit(self.head, self.out)
        self.assertEqual('two\n', (self.out / 'android/app/src/main/App.kt').read_text())
        self.assertFalse((self.out / 'client').exists())

    def test_exports_an_earlier_commit_as_it_was(self):
        result = self.export(commit=self.first)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assert_is_commit(self.first, self.out)
        self.assertFalse((self.out / 'android/app/src/main/Kept.kt').exists())

    def test_attributes_do_not_change_a_byte(self):
        # Line-ending conversion from attributes that are not part of the commit, and the export attributes.
        self.write('android/.gitattributes', '*.txt text\napp/src/main/Kept.kt export-ignore\napp/src/main/App.kt export-subst\n')
        self.write('android/app/src/main/App.kt', '$Format:%H$\n')
        head = self.commit('attributes')
        (self.repo / '.git/info').mkdir(exist_ok=True)
        (self.repo / '.git/info/attributes').write_text('android/app/src/main/assets/*.txt eol=crlf\n')
        self.git('config', 'core.autocrlf', 'true')
        result = self.export(commit=head)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assert_is_commit(head, self.out)
        self.assertEqual(b'line one\nline two\n', (self.out / 'android/app/src/main/assets/data.txt').read_bytes())
        self.assertEqual('$Format:%H$\n', (self.out / 'android/app/src/main/App.kt').read_text())
        self.assertTrue((self.out / 'android/app/src/main/Kept.kt').exists())

    def test_a_replaced_object_is_not_exported(self):
        original = self.git('rev-parse', f'{self.head}:android/app/src/main/App.kt').decode().strip()
        other = subprocess.run(['git', 'hash-object', '-w', '--stdin'], cwd=self.repo, env=ENV, input=b'replaced\n',
                               capture_output=True, check=True).stdout.decode().strip()
        self.git('replace', original, other)
        result = self.export()
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual('two\n', (self.out / 'android/app/src/main/App.kt').read_text())

    def test_refuses_a_symbolic_link_in_the_tree(self):
        outside = self.temp / 'outside.kt'
        outside.write_text('outside\n')
        os.symlink(outside, self.repo / 'android/app/src/main/Linked.kt')
        head = self.commit('link')
        self.assert_refused(self.export(commit=head), 1, 'symbolic link.*android/app/src/main/Linked.kt')
        self.assertEqual('outside\n', outside.read_text())

    def test_refuses_a_tracked_private_input_and_leaves_what_a_link_points_at(self):
        # A tracked link where a private input goes: the copy must not follow it out of the export.
        outside = self.temp / 'victim.properties'
        outside.write_text('untouched\n')
        (self.repo / 'android/.gitignore').write_text('build/\n')
        os.symlink(outside, self.repo / 'android/private.properties')
        head = self.commit('tracked link')
        self.assert_refused(self.export(commit=head), 1, 'symbolic link')
        self.assertEqual('untouched\n', outside.read_text())
        # A tracked regular file there is refused too: the private input is always a new file.
        (self.repo / 'android/private.properties').unlink()
        self.write('android/private.properties', 'tracked\n')
        head = self.commit('tracked file')
        self.assert_refused(self.export(commit=head), 1, 'android/private.properties is a file of the commit')

    def test_refuses_private_inputs_that_are_missing_or_links(self):
        (self.private / 'private.properties').unlink()
        self.assert_refused(self.export(), 1, 'private.properties')
        os.symlink(self.private / 'google-services.json', self.private / 'private.properties')
        self.assert_refused(self.export(), 1, 'private.properties')
        self.assert_refused(self.export(private=False), 2, '--private')

    def test_refuses_a_name_that_is_not_a_full_sha_and_an_unknown_commit(self):
        short = self.git('rev-parse', '--short', 'HEAD').decode().strip()
        self.assert_refused(self.export(commit=short), 2, 'full 40-character SHA')
        self.assert_refused(self.export(commit='master'), 2, 'full 40-character SHA')
        self.assert_refused(self.export(commit='0123456789' * 4), 1, 'no commit')

    def test_refuses_an_existing_directory_and_leaves_it(self):
        self.out.mkdir()
        result = self.export()
        self.assertEqual(1, result.returncode)
        self.assertRegex(result.stderr, 'already exists')
        self.assertTrue(self.out.is_dir())
        self.assertEqual([], list(self.out.iterdir()))

    def test_refuses_a_directory_inside_the_checkout_without_touching_the_checkout(self):
        existing = self.repo / 'export-here'
        existing.mkdir()
        before = sorted(str(p) for p in self.repo.iterdir())
        for out in (existing, self.repo / 'new/nested/export', Path('relative-export')):
            result = self.export(out=out)
            self.assertEqual(1, result.returncode, str(out))
            self.assertRegex(result.stderr, 'outside the checkout|already exists')
        self.assertEqual(before, sorted(str(p) for p in self.repo.iterdir()))
        self.assertTrue(existing.is_dir())

    def test_the_read_back_refuses_an_export_that_is_not_the_commit(self):
        # The tool's own check of what it wrote, against a directory changed after a good export.
        self.assertEqual(0, self.export().returncode)
        for name in tool.PRIVATE_INPUTS.values():
            (self.out / name).unlink()
        entries = tool.tree_entries(self.repo, self.head)
        tool.verify(entries, self.out)
        app = self.out / 'android/app/src/main/App.kt'

        app.write_text('two\r\n')
        with self.assertRaisesRegex(tool.Refused, 'App.kt was not written as the commit has it'):
            tool.verify(entries, self.out)
        app.write_text('two\n')
        extra = self.out / 'android/app/src/main/Extra.kt'
        extra.write_text('x\n')
        with self.assertRaisesRegex(tool.Refused, 'does not hold exactly'):
            tool.verify(entries, self.out)
        extra.unlink()
        (self.out / 'android/app/src/main/Kept.kt').unlink()
        with self.assertRaisesRegex(tool.Refused, 'does not hold exactly'):
            tool.verify(entries, self.out)
        os.symlink(app, self.out / 'android/app/src/main/Kept.kt')
        with self.assertRaisesRegex(tool.Refused, 'neither a file nor a directory'):
            tool.verify(entries, self.out)
        (self.out / 'android/app/src/main/Kept.kt').unlink()
        (self.out / 'android/app/src/main/Kept.kt').write_text('kept\n')
        (self.out / 'android/gradlew').chmod(0o644)
        with self.assertRaisesRegex(tool.Refused, 'gradlew does not have the mode'):
            tool.verify(entries, self.out)
        (self.out / 'android/gradlew').chmod(0o755)
        tool.verify(entries, self.out)

    def test_the_private_inputs_and_the_export_are_for_the_owner_only(self):
        for name in tool.PRIVATE_INPUTS:
            (self.private / name).chmod(0o600)
        previous = os.umask(0o022)
        self.addCleanup(os.umask, previous)
        self.assertEqual(0, self.export().returncode)
        for target in tool.PRIVATE_INPUTS.values():
            self.assertEqual(0o600, stat.S_IMODE((self.out / target).stat().st_mode), target)
        self.assertEqual(0o700, stat.S_IMODE(self.out.stat().st_mode))
        # The commit's own files keep the modes the commit gives them.
        self.assertEqual(0o755, stat.S_IMODE((self.out / 'android/gradlew').stat().st_mode))
        self.assertEqual(0o644, stat.S_IMODE((self.out / 'android/app/src/main/App.kt').stat().st_mode))

    def test_refuses_a_link_as_the_directory_even_when_it_points_nowhere(self):
        target = self.temp / 'not-there'
        os.symlink(target, self.out)
        result = self.export()
        self.assertEqual(1, result.returncode, result.stdout + result.stderr)
        self.assertRegex(result.stderr, 'already exists')
        self.assertTrue(self.out.is_symlink())
        self.assertFalse(target.exists())
        # A link in the middle of the path that leads into the checkout is refused as inside it.
        self.out.unlink()
        os.symlink(self.repo, self.temp / 'into-checkout')
        before = sorted(str(p) for p in self.repo.iterdir())
        result = self.export(out=self.temp / 'into-checkout' / 'export')
        self.assertEqual(1, result.returncode)
        self.assertRegex(result.stderr, 'outside the checkout')
        self.assertEqual(before, sorted(str(p) for p in self.repo.iterdir()))

    def test_checks_the_checkout_it_belongs_to_from_any_directory(self):
        result = self.export(cwd=self.temp)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assert_is_commit(self.head, self.out)


if __name__ == '__main__':
    unittest.main()
