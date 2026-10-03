"""CI event/range regressions with real isolated Git snapshots and checker."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
HELPER = HERE / 'check-ci-artifacts.py'
CHECKER = HERE.parent / 'check-artifact-policy.py'
ZERO = '0' * 40


class ArtifactCI(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='tw-artifact-ci-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
        self.env.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM='1',
                        GIT_AUTHOR_NAME='Fixture', GIT_AUTHOR_EMAIL='fixture@example.invalid',
                        GIT_COMMITTER_NAME='Fixture', GIT_COMMITTER_EMAIL='fixture@example.invalid')
        self.git('init', '-q')
        self.git('remote', 'add', 'origin', str(self.root / 'unused.git'))
        self.write('README.md', '# Baseline\n')
        baseline = self.commit()
        self.write('scripts/artifact-policy.json', json.dumps({'history_base': baseline}))
        self.commit()
        # Published master contains a historical violation later removed.
        self.write('reports/old.json', '{}')
        self.commit(force=True)
        self.git('rm', 'reports/old.json')
        self.published = self.commit()
        self.git('update-ref', 'refs/remotes/origin/master', self.published)
        self.write('README.md', '# Task\n')
        self.tip = self.commit()

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], env=self.env,
                                       stderr=subprocess.PIPE, text=True).strip()

    def write(self, name, text):
        p = self.root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)

    def commit(self, force=False):
        self.git('add', '-f' if force else '-A', '.')
        self.git('commit', '-qm', 'fixture')
        return self.git('rev-parse', 'HEAD')

    def check(self, event, base, head=None):
        head = head or self.tip
        if HELPER.exists():
            cmd = [sys.executable, str(HELPER), '--root', str(self.root), '--event', event,
                   '--base', base, '--head', head, '--default-branch', 'master']
        else:
            # Exact current workflow decision, so Red observes its bad range,
            # rather than failing merely because a proposed helper is absent.
            cmd = [sys.executable, str(CHECKER), '--root', str(self.root)]
            cmd += ['--range', base, head] if base else ['--commit', head]
        before = self.git('status', '--porcelain')
        index = (self.root / '.git/index').read_bytes()
        run = subprocess.run(cmd, env=self.env, capture_output=True, text=True, timeout=30)
        self.assertEqual(before, self.git('status', '--porcelain'))
        self.assertEqual(index, (self.root / '.git/index').read_bytes())
        return run

    def test_new_branch_checks_task_without_published_master_history(self):
        run = self.check('push', ZERO)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        self.assertIn('1 snapshot(s)', run.stdout)

    def test_new_branch_keeps_bad_intermediate_even_if_topic_ref_is_fetched(self):
        self.write('reports/task.json', '{}')
        bad = self.commit(force=True)
        self.git('rm', 'reports/task.json')
        self.tip = self.commit()
        self.git('update-ref', 'refs/remotes/origin/topic', self.tip)
        run = self.check('push', ZERO)
        self.assertNotEqual(run.returncode, 0)
        self.assertIn(bad[:12], run.stderr)

    def test_pr_and_ordinary_push_keep_exact_range(self):
        for event in ['pull_request', 'push']:
            run = self.check(event, self.published)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertIn('1 snapshot(s)', run.stdout)

    def test_explicit_range_is_not_replaced_by_a_newer_default_branch(self):
        self.write('reports/task.json', '{}')
        bad = self.commit(force=True)
        self.git('rm', 'reports/task.json')
        self.tip = self.commit()
        self.git('update-ref', 'refs/remotes/origin/master', self.tip)
        for event in ['pull_request', 'push']:
            run = self.check(event, self.published)
            self.assertNotEqual(run.returncode, 0)
            self.assertIn(bad[:12], run.stderr)

    def test_tip_policy_cannot_hide_bad_task_history_for_any_event_range(self):
        self.write('reports/task.json', '{}')
        bad = self.commit(force=True)
        self.git('rm', 'reports/task.json')
        self.write('scripts/artifact-policy.json', json.dumps({'history_base': bad}))
        self.tip = self.commit()
        for event, base in [('pull_request', self.published),
                            ('push', self.published), ('push', ZERO)]:
            with self.subTest(event=event, base=base):
                run = self.check(event, base)
                self.assertEqual(run.returncode, 1, run.stdout + run.stderr)
                self.assertIn(bad[:12], run.stderr)

    def test_missing_new_branch_ref_and_missing_explicit_base_fail_closed(self):
        self.git('update-ref', '-d', 'refs/remotes/origin/master')
        self.assertNotEqual(self.check('push', ZERO).returncode, 0)
        for event in ['pull_request', 'push']:
            self.assertNotEqual(self.check(event, '').returncode, 0)
        self.assertNotEqual(self.check('pull_request', ZERO).returncode, 0)

    def test_manual_dispatch_retains_tip_check(self):
        run = self.check('workflow_dispatch', '')
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn('1 snapshot(s)', run.stdout)


if __name__ == '__main__':
    unittest.main()
