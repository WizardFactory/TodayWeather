"""Behavioral checks using isolated Git repositories; no providers or app startup."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

CHECKER = Path(__file__).resolve().parents[1] / 'check-artifact-policy.py'


class ArtifactPolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM='1',
                        GIT_AUTHOR_NAME='Fixture', GIT_AUTHOR_EMAIL='fixture@example.invalid',
                        GIT_COMMITTER_NAME='Fixture', GIT_COMMITTER_EMAIL='fixture@example.invalid')
        for name in list(self.env):
            if name.startswith('GIT_') and name not in {
                'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_AUTHOR_NAME',
                'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'}:
                del self.env[name]
        self.git('init', '-q')
        self.write('README.md', '# Fixture\n')
        self.write('.gitignore', '/reports/\n/.archify/\n/.planning/\n')
        self.git('add', '.')
        self.base = self.commit()
        self.write('scripts/artifact-policy.json', json.dumps({'history_base': self.base}))
        self.git('add', '.')

    def git(self, *args):
        return subprocess.check_output(['git', '-c', 'core.hooksPath=/dev/null', *args],
                                       cwd=self.root, env=self.env, stderr=subprocess.PIPE, text=True).strip()

    def write(self, name, text):
        p = self.root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)

    def commit(self):
        self.git('commit', '-qm', 'fixture')
        return self.git('rev-parse', 'HEAD')

    def check(self, *args, stdin=None):
        before = self.fingerprint()
        result = subprocess.run([sys.executable, str(CHECKER), '--root', str(self.root), *args],
                                input=stdin, text=True, capture_output=True, env=self.env)
        self.assertEqual(before, self.fingerprint(), 'checker mutated index/worktree')
        return result

    def fingerprint(self):
        files = {str(p.relative_to(self.root)): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in self.root.rglob('*') if p.is_file() and '.git' not in p.relative_to(self.root).parts}
        return files, hashlib.sha256((self.root / '.git/index').read_bytes()).hexdigest()

    def test_valid_curated_files_and_spaces(self):
        self.write('docs/evidence/my sample.json', '{}')
        self.write('docs/README.md', '[sample](<evidence/my sample.json>)\n')
        self.git('add', '.')
        self.assertEqual(self.check('--staged').returncode, 0)

    def test_forced_generated_file_is_rejected(self):
        for prefix in ['reports', '.archify', '.planning', 'test-results', 'playwright-report']:
            with self.subTest(prefix=prefix):
                self.write(prefix + '/run.json', '{}')
                self.git('add', '-f', prefix + '/run.json')
                self.assertNotEqual(self.check('--staged').returncode, 0)
                self.git('rm', '--cached', prefix + '/run.json')

    def test_untracked_link_target_is_not_delivery(self):
        self.write('docs/README.md', '[data](data.json)\n')
        self.write('docs/data.json', '{}')
        self.git('add', 'docs/README.md')
        self.assertNotEqual(self.check('--staged').returncode, 0)

    def test_unstaged_fix_does_not_hide_staged_broken_link(self):
        self.write('docs/README.md', '[missing](missing.md)\n')
        self.git('add', 'docs/README.md')
        self.write('docs/README.md', '# locally fixed\n')
        self.assertNotEqual(self.check('--staged').returncode, 0)

    def test_unstaged_error_does_not_break_good_index(self):
        self.write('docs/README.md', '# valid\n')
        self.git('add', 'docs/README.md')
        self.write('docs/README.md', '[missing](missing.md)\n')
        self.assertEqual(self.check('--staged').returncode, 0)

    def test_reference_link_and_html_asset(self):
        for content in ['[data][source]\n\n[source]: absent.json\n', '<img src="absent.png">\n']:
            self.write('docs/README.md', content)
            self.git('add', 'docs/README.md')
            self.assertNotEqual(self.check('--staged').returncode, 0)

    def test_code_examples_and_external_links_are_not_local_links(self):
        self.write('docs/README.md', '```md\n[example](placeholder)\n```\n[external](https://example.com/x)\n')
        self.git('add', '.')
        self.assertEqual(self.check('--staged').returncode, 0)

    def test_local_file_uri_is_not_portable(self):
        for content in ['[local](file:///private/tmp/report.json)',
                        '[local][run]\n\n[run]: file:reports/run.json',
                        '<img src="FILE:///private/tmp/capture.png">']:
            with self.subTest(content=content):
                self.write('docs/README.md', content)
                self.git('add', '.')
                self.assertNotEqual(self.check('--staged').returncode, 0)

    def test_repository_root_links_are_portable(self):
        self.write('docs/README.md', '[parent](..)\n[root](/)\n')
        self.git('add', '.')
        self.assertEqual(self.check('--staged').returncode, 0)

    def test_added_then_deleted_generated_file_in_history(self):
        self.write('reports/log.txt', 'one run')
        self.git('add', '-f', 'reports/log.txt')
        bad = self.commit()
        self.git('rm', 'reports/log.txt')
        tip = self.commit()
        result = self.check('--range', self.base, tip)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(bad[:8], result.stdout + result.stderr)

    def test_history_link_error_is_not_hidden_by_later_fix(self):
        self.write('docs/README.md', '[absent](later.md)\n')
        self.git('add', '.')
        self.commit()
        self.write('docs/later.md', '# now exists')
        self.git('add', '.')
        tip = self.commit()
        self.assertNotEqual(self.check('--range', self.base, tip).returncode, 0)

    def test_commit_uses_committed_tree_not_working_files(self):
        tip = self.commit()
        self.write('reports/untracked.txt', 'local')
        self.write('docs/README.md', '[broken](absent.md)')
        self.assertEqual(self.check('--commit', tip).returncode, 0)

    def test_missing_ref_fails(self):
        self.assertNotEqual(self.check('--range', 'f' * 40, self.base).returncode, 0)

    def test_multiple_push_refs_and_new_branch(self):
        tip = self.commit()
        good = f'refs/heads/good {tip} refs/heads/new {"0" * 40}\n'
        self.assertEqual(self.check('--pre-push', 'origin', stdin=good).returncode, 0)
        self.write('reports/out.json', '{}')
        self.git('add', '-f', 'reports/out.json')
        bad = self.commit()
        line = f'refs/heads/bad {bad} refs/heads/bad {tip}\n'
        self.assertNotEqual(self.check('--pre-push', 'origin', stdin=good + line).returncode, 0)

    def test_delete_push_ref_is_valid(self):
        line = f'(delete) {"0" * 40} refs/heads/old {self.base}\n'
        self.assertEqual(self.check('--pre-push', 'origin', stdin=line).returncode, 0)

    def test_manifest_requires_committed_image(self):
        self.write('docs/rewrite/screenshots/manifest.json', json.dumps([{
            'file': 'missing.png', 'sha256': '0' * 64, 'pixels': [1, 1]}]))
        self.git('add', '.')
        self.assertNotEqual(self.check('--staged').returncode, 0)


if __name__ == '__main__':
    unittest.main()
