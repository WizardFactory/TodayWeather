"""CI event/range contracts: synthetic Git inputs; never Cargo or network."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import tempfile
from unittest.mock import patch

import ci
import unittest


class WorkflowCoverage(unittest.TestCase):
    def setUp(self):
        self.workflow = (Path(__file__).resolve().parents[2]/'.github/workflows/server2.yml').read_text()

    def test_all_prs_reach_minimum_audit_without_path_filter(self):
        event = self.workflow.split('permissions:', 1)[0]
        self.assertNotRegex(event, r'(?m)^\s+paths(?:-ignore)?:',
                            'workflow path filters can hide misplaced root assets')
        self.assertRegex(event, r'(?m)^  pull_request:')

    def test_every_master_push_reaches_minimum_audit(self):
        event = self.workflow.split('permissions:', 1)[0]
        self.assertRegex(event, r'(?m)^  push:\n    branches: \[master\]$',
                         'master pushes require an explicit full-range audit')

    def test_scope_failure_never_skips_existing_required_jobs(self):
        # GitHub skips a dependent job on failure unless its expression overrides
        # the implicit success() guard. Only an explicit unrelated receipt skips.
        condition = "if: ${{ !cancelled() && needs.scope.outputs.heavy != 'false' }}"
        for job in ('foundation', 'goldens'):
            body = self.workflow.split('  '+job+':\n', 1)[1].split('    runs-on:', 1)[0]
            self.assertIn(condition, body, job+' must run after failed/missing scope output')

    def test_verified_artifact_has_bounded_thirty_day_retention(self):
        self.assertIn('retention-days: 30\n', self.workflow)
        self.assertIn('if-no-files-found: error\n', self.workflow)


class ScopeControl(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Offline CI fixture')
        self.git('config', 'user.email', 'ci@example.invalid')
        self.git('config', 'core.hooksPath', str(self.root/'no-hooks'))
        self.write('server2/src/lib.rs', 'pub fn initial() {}\n')
        self.write('.github/workflows/server2.yml',
                   (Path(ci.__file__).resolve().parents[2]/'.github/workflows/server2.yml').read_text())
        self.commit()
        self.base = self.git('rev-parse', 'HEAD')

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args],
                                       stderr=subprocess.DEVNULL, text=True).strip()

    def write(self, name, value):
        p = self.root/name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(value)

    def commit(self):
        self.git('add', '.')
        self.git('commit', '-qm', 'synthetic CI scope')
        return self.git('rev-parse', 'HEAD')

    def event(self, kind='pull_request', base=None):
        head = self.git('rev-parse', 'HEAD')
        if kind == 'push':
            return {'ref': 'refs/heads/master', 'before': base or self.base, 'after': head}
        return {'pull_request': {'base': {'sha': base or self.base}, 'head': {'sha': head}}}

    def audit(self, kind='pull_request', event=None, env=None):
        return ci.audit(self.root, self.event(kind) if event is None else event, kind, env or {})

    def task(self, name, owned, outside=()):
        path = 'server2/config/tasks/'+name+'.json'
        data = {'task': name, 'issue': '#2819', 'server2_paths': [path, *owned],
                'outside': [{'path': p, 'category': 'documentation', 'reason': 'named fixture'} for p in outside]}
        self.write(path, json.dumps(data))
        return path

    def test_legacy_runs_heavy_without_fake_declaration(self):
        self.write('server/controllers/fixture.js', 'module.exports = {};')
        self.commit()
        result = self.audit()
        self.assertTrue(result['heavy'])
        self.assertEqual(result['scope'], 'layout-only')
        self.assertEqual(result['declarations'], [])
        self.assertEqual(result['foundation'], 'scheduled')
        self.assertTrue(self.audit('push')['heavy'])

    def test_unrelated_event_still_audits_but_never_claims_heavy_pass(self):
        self.write('docs/fixture.md', 'documentation')
        self.commit()
        for kind in ('pull_request', 'push'):
            result = self.audit(kind)
            self.assertFalse(result['heavy'])
            self.assertEqual(result['foundation'], 'not-run: unrelated-only')
            self.assertEqual(result['goldens'], 'not-run: unrelated-only')
            self.assertEqual(result['paths'], ['docs/fixture.md'])

    def test_unrelated_merge_with_newer_server2_is_layout_only_without_build_identity(self):
        self.write('docs/fixture.md', 'head documentation')
        head = self.commit()
        # Master advanced server2 independently after the docs branch split.
        self.git('checkout', '--detach', self.base)
        self.write('server2/src/lib.rs', 'pub fn newer_master() {}')
        base = self.commit()
        self.write('docs/fixture.md', 'head documentation')
        self.commit()  # merge checkout has master server2 plus the docs head
        event = {'pull_request': {'base': {'sha': base}, 'head': {'sha': head}}}
        result = self.audit(event=event)
        self.assertEqual(result['paths'], ['docs/fixture.md'])
        self.assertFalse(result['heavy'])
        self.assertEqual(result['scope'], 'layout-only')
        self.assertIsNone(result['source'], 'layout-only does not attest a build identity')
        self.assertEqual(result['foundation'], 'not-run: unrelated-only')
        self.assertEqual(result['goldens'], 'not-run: unrelated-only')

    def test_unknown_root_tools_and_unsafe_root_workspace_fail(self):
        self.write('tools/cache.py', 'print("misplaced")')
        self.commit()
        with self.assertRaisesRegex(ValueError, 'unclassified root'):
            self.audit()
        self.write('Cargo.toml', '[workspace]')
        self.commit()
        with self.assertRaisesRegex(ValueError, 'root Rust'):
            self.audit()

    def test_mixed_pr_retains_entire_root_range(self):
        self.task('ONE', ['server2/src/lib.rs'], ['docs/fixture.md'])
        self.write('server2/src/lib.rs', 'pub fn changed() {}')
        self.write('docs/fixture.md', 'declared')
        self.commit()
        result = self.audit()
        self.assertEqual(result['scope'], 'full-pr-task-range')
        self.assertIn('docs/fixture.md', result['paths'])
        self.write('docs/undeclared.md', 'not declared')
        self.commit()
        with self.assertRaisesRegex(ValueError, 'undeclared changed path'):
            self.audit()

    def test_multiple_pr_declarations_do_not_silently_select_one(self):
        self.task('ONE', ['server2/src/lib.rs'])
        self.task('TWO', ['server2/src/lib.rs'])
        self.commit()
        with self.assertRaisesRegex(ValueError, 'one reviewed task declaration'):
            self.audit()

    def test_push_union_checks_whole_range_and_all_declarations(self):
        self.task('ONE', ['server2/src/one.rs'], ['docs/one.md'])
        self.write('server2/src/one.rs', 'fn one() {}')
        self.write('docs/one.md', 'one')
        self.commit()
        self.task('TWO', ['server2/src/two.rs'])
        self.write('server2/src/two.rs', 'fn two() {}')
        self.commit()
        result = self.audit('push')
        self.assertEqual(result['scope'], 'push-range-declaration-union')
        self.assertEqual(len(result['declarations']), 2)
        self.assertIn('docs/one.md', result['paths'])
        self.write('docs/extra.md', 'uncovered')
        self.commit()
        with self.assertRaisesRegex(ValueError, 'undeclared changed path'):
            self.audit('push')

    def test_missing_declaration_is_not_layout_only_for_server2_changes(self):
        self.write('server2/src/lib.rs', 'pub fn changed() {}')
        self.commit()
        with self.assertRaisesRegex(ValueError, 'task declaration'):
            self.audit()

    def test_push_zero_missing_object_and_wrong_ref_fail(self):
        self.write('docs/fixture.md', 'safe')
        self.commit()
        for before in ('0'*40, None):
            event = self.event('push')
            event['before'] = before
            with self.assertRaisesRegex(ValueError, 'push before: exact nonzero commit required'):
                self.audit('push', event)
        event = self.event('push')
        event['before'] = 'f'*40
        with self.assertRaises(subprocess.CalledProcessError) as failure:
            self.audit('push', event)
        self.assertEqual(failure.exception.cmd[-1], 'f'*40+'^{commit}')
        self.assertEqual(failure.exception.returncode, 128)
        event = self.event('push')
        event['ref'] = 'refs/heads/topic'
        with self.assertRaisesRegex(ValueError, 'master'):
            self.audit('push', event)

    def test_relevant_rename_source_cannot_be_classified_unrelated(self):
        self.write('server/old.js', 'legacy')
        self.commit()
        self.base = self.git('rev-parse', 'HEAD')
        (self.root/'docs').mkdir(exist_ok=True)
        self.git('mv', 'server/old.js', 'docs/moved.md')
        self.commit()
        result = self.audit()
        self.assertTrue(result['heavy'])
        self.assertIn('server/old.js', result['paths'])
        self.assertIn('docs/moved.md', result['paths'])

    def test_task_deletion_and_rename_are_explicit_failures(self):
        original = self.task('ONE', ['server2/'])
        self.commit()
        self.base = self.git('rev-parse', 'HEAD')
        self.git('mv', original, 'server2/config/tasks/TWO.json')
        self.commit()
        with self.assertRaisesRegex(ValueError, 'renamed'):
            self.audit('push')
        self.git('rm', 'server2/config/tasks/TWO.json')
        self.commit()
        with self.assertRaisesRegex(ValueError, 'deleted'):
            self.audit('push')

    def test_matching_tree_pr_merge_uses_head_not_merge_commit(self):
        self.task('ONE', ['server2/src/lib.rs'])
        self.write('server2/src/lib.rs', 'pub fn head_source() {}')
        head = self.commit()
        self.git('commit', '--allow-empty', '-qm', 'merge checkout representation')
        event = {'pull_request': {'base': {'sha': self.base}, 'head': {'sha': head}}}
        result = self.audit(event=event)
        self.assertEqual(result['head'], head)
        self.assertEqual(result['source']['revision'], head)
        self.write('server2/src/lib.rs', 'pub fn different() {}')
        self.commit()
        with self.assertRaisesRegex(ValueError, 'tracked server2 source differs from recorded revision'):
            self.audit(event=event)

    def test_legacy_merge_with_newer_server2_keeps_heavy_identity_gate(self):
        self.write('server/legacy.js', 'module.exports = {};')
        head = self.commit()
        self.git('checkout', '--detach', self.base)
        self.write('server2/src/lib.rs', 'pub fn newer_master() {}')
        base = self.commit()
        self.write('server/legacy.js', 'module.exports = {};')
        self.commit()
        event = {'pull_request': {'base': {'sha': base}, 'head': {'sha': head}}}
        with self.assertRaisesRegex(ValueError, 'tracked server2 source differs from recorded revision'):
            self.audit(event=event)

    def test_failed_scope_is_reaudited_by_foundation_before_any_child(self):
        with patch.object(ci, 'audit', side_effect=ValueError('layout audit failed: synthetic root violation')), \
             patch.object(sys, 'argv', ['ci.py']), \
             patch.dict(os.environ, {}, clear=True), \
             patch.object(ci.subprocess, 'run') as child:
            with self.assertRaisesRegex(ValueError, 'layout audit failed: synthetic root violation'):
                ci.main()
        child.assert_not_called()

    def test_bad_declaration_and_conflicting_build_stamp_fail_before_children(self):
        self.task('ONE', ['../../server/'])
        self.commit()
        with self.assertRaisesRegex(ValueError, 'invalid server2 declaration'):
            self.audit()
        revision = self.git('rev-parse', 'HEAD')
        for value in ('unknown', '', '0'*40):
            with self.assertRaisesRegex(ValueError, 'conflicting'):
                ci.build_environment({'SERVER2_BUILD_REVISION': value}, revision)
        self.assertEqual(ci.build_environment({}, revision)['SERVER2_BUILD_REVISION'], revision)

    def test_unknown_hosted_events_and_missing_local_base_fail(self):
        for name, event, env in [('workflow_dispatch', {}, {}),
                                 (None, {}, {'GITHUB_ACTIONS': 'true'})]:
            with self.assertRaisesRegex(ValueError, 'unsupported or incomplete hosted event'):
                ci.context(self.root, event, name, env)
        with self.assertRaisesRegex(ValueError, 'local CI requires explicit SERVER2_BASE'):
            ci.context(self.root, {}, None, {})

    def test_emitted_revision_requires_actual_matching_nonempty_records(self):
        path = self.root/'capture.ndjson'
        revision = self.git('rev-parse', 'HEAD')
        for content in ('', json.dumps({'schema': 1, 'build_revision': 'unknown'}),
                        json.dumps({'schema': 1, 'build_revision': 'f'*40})):
            path.write_text(content)
            with self.assertRaisesRegex(ValueError, 'emitted log revision does not match selected build'):
                ci.verify_record_revision(path, revision)
        path.write_text(json.dumps({'schema': 1, 'build_revision': revision})+'\n')
        ci.verify_record_revision(path, revision)

    def test_foundation_controller_preserves_checks_and_stamps_every_child(self):
        revision = self.git('rev-parse', 'HEAD')
        plan = dict(head=revision, base=self.base, declarations=[], heavy=True)
        previous = Path.cwd()
        try:
            with patch.object(ci, '__file__', str(self.root/'server2/tools/ci.py')), \
                 patch.object(ci, 'audit', return_value=plan), \
                 patch.object(ci, 'verify_record_revision') as log_check, \
                 patch.object(sys, 'argv', ['ci.py']), \
                 patch.object(sys, 'platform', 'linux'), \
                 patch.dict(os.environ, {}, clear=True), \
                 patch.object(ci.subprocess, 'run') as child:
                ci.main()
            commands = [call.args[0] for call in child.call_args_list]
            cargo = [c for c in commands if c[0] == 'cargo']
            self.assertGreaterEqual(len(cargo), 8)
            for call in child.call_args_list:
                self.assertEqual(call.kwargs['env']['SERVER2_BUILD_REVISION'], revision)
                self.assertTrue(call.kwargs['check'])
            for name in ('tools/test_placement.py', 'tools/test_ci.py', 'tools/test_verify_artifact.py',
                         'tools/test_native_artifact.py', 'tools/logging_smoke.py', 'tools/widget_smoke.py',
                         'tools/narrative_smoke.py', 'tools/verify_artifact.py', 'tools/native_artifact.py'):
                self.assertTrue(any(name in command for command in commands), name)
            for command in commands:
                if '--source-revision' in command:
                    self.assertEqual(command[command.index('--source-revision')+1], revision)
            self.assertEqual(log_check.call_count, 2)
        finally:
            os.chdir(previous)

    def test_unrelated_controller_runs_no_heavy_children(self):
        plan = dict(head=self.base, base=self.base, declarations=[], heavy=False)
        with patch.object(ci, 'audit', return_value=plan), \
             patch.object(sys, 'argv', ['ci.py']), \
             patch.dict(os.environ, {}, clear=True), \
             patch.object(ci.subprocess, 'run') as child:
            self.assertEqual(ci.main(), 0)
        child.assert_not_called()

    def test_cli_audit_executes_only_on_owned_temp_repo_and_no_heavy_children(self):
        # Real CLI execution, with a synthetic tracked snapshot and explicit event;
        # never invoke foundation main without --audit-only in this control.
        tools = self.root/'server2/tools'
        tools.mkdir(parents=True)
        for name in ('ci.py', 'check_placement.py', 'verify_artifact.py'):
            shutil.copyfile(Path(ci.__file__).parent/name, tools/name)
        self.commit()
        self.base = self.git('rev-parse', 'HEAD')
        self.write('docs/fixture.md', 'unrelated')
        self.commit()
        event = self.root/'event.json'
        event.write_text(json.dumps(self.event()))
        # Keep the event/output ignored so it cannot contaminate source classification.
        self.git('config', 'core.excludesFile', str(self.root/'ignore'))
        (self.root/'ignore').write_text('event.json\nignore\noutput\n')
        command = [sys.executable, str(tools/'ci.py'), '--audit-only']
        env = {'PATH': os.environ.get('PATH', ''), 'HOME': str(self.root),
               'PYTHONDONTWRITEBYTECODE': '1', 'GITHUB_EVENT_NAME': 'pull_request',
               'GITHUB_EVENT_PATH': str(event), 'GITHUB_ACTIONS': 'true',
               'GITHUB_OUTPUT': str(self.root/'output')}
        result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(result.stdout)
        self.assertFalse(receipt['heavy'])
        self.assertEqual((self.root/'output').read_text(), 'heavy=false\n')


if __name__ == '__main__':
    unittest.main()
