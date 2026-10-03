#!/usr/bin/env python3
"""Offline behavior checks for portable Graft adapters; no provider or real Graft."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
NODE = shutil.which('node')
SHIMS = ROOT / '.claude/helpers'


class Adapters(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='graft-adapters-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.repo = self.base / 'repo'
        self.repo.mkdir()
        self.bin = self.base / 'bin'
        self.bin.mkdir()
        self.env = dict(os.environ, PATH=str(self.bin), DO_NOT_TRACK='1')
        self.env.pop('CLAUDE_PROJECT_DIR', None)

    def package(self, target, label):
        target.mkdir(parents=True)
        (target / 'package.json').write_text(json.dumps({'name': '@nanonets/graft', 'type': 'module', 'version': '0.21.1'}))
        dist = target / 'dist/claude'
        dist.mkdir(parents=True)
        for entry in ('hooks', 'statusline'):
            (dist / (entry + '.js')).write_text('export function main(event) { console.log(JSON.stringify({label:' + json.dumps(label) + ',event:event ?? "statusline"})); }\n')
        (target / 'dist/cli.js').write_text('// fixture CLI path\n')
        return target

    def run_shim(self, name, event=None, timeout=4):
        command = [NODE, str(SHIMS / name)]
        if event:
            command.append(event)
        return subprocess.run(command, input='{}', cwd=self.repo, env=self.env, capture_output=True, text=True, timeout=timeout)

    @unittest.skipUnless(NODE, 'Node required')
    def test_registry_symlink_resolves_hooks_and_statusline(self):
        pkg = self.package(self.base / 'registry/revision/node_modules/@nanonets/graft', 'registry')
        (self.bin / 'graft').symlink_to(pkg / 'dist/cli.js')
        for name, event in [('graft-hooks.cjs', 'session-start'), ('graft-statusline.cjs', None)]:
            with self.subTest(name=name):
                result = self.run_shim(name, event)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout)['label'], 'registry')

    @unittest.skipUnless(NODE, 'Node required')
    def test_repo_local_package_resolves_without_cli(self):
        self.package(self.repo / 'node_modules/@nanonets/graft', 'local')
        result = self.run_shim('graft-hooks.cjs', 'prompt')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {'label': 'local', 'event': 'prompt'})

    @unittest.skipUnless(NODE, 'Node required')
    def test_missing_tool_is_quiet_and_lookup_is_bounded(self):
        npm = self.bin / 'npm'
        npm.write_text('#!/bin/sh\nexec /bin/sleep 5\n')
        npm.chmod(0o755)
        result = self.run_shim('graft-hooks.cjs', 'prompt', timeout=3)
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, '', ''))

    @unittest.skipUnless(NODE, 'Node required')
    def test_session_start_cannot_run_upstream_wiring(self):
        pkg = self.package(self.repo / 'node_modules/@nanonets/graft', 'local')
        marker = self.repo / 'unexpected-wiring.txt'
        (pkg / 'dist/upkeep-run.js').write_text('import fs from "node:fs"; export function runUpkeep() { fs.writeFileSync(' + json.dumps(str(marker)) + ', "unsafe"); return {lines:[]}; }')
        (pkg / 'dist/claude/hooks.js').write_text('import {runUpkeep} from "../upkeep-run.js"; export function main() { runUpkeep(); console.log("safe context"); }')
        result = self.run_shim('graft-hooks.cjs', 'session-start')
        self.assertEqual(result.stdout.strip(), 'safe context')
        self.assertFalse(marker.exists(), 'Upstream automatic wiring executed')

    @unittest.skipUnless(NODE, 'Node required')
    def test_symlinked_global_fallback_cannot_run_upstream_wiring(self):
        pkg = self.package(self.base / 'real-global/@nanonets/graft', 'global')
        alias = self.base / 'global-alias'
        alias.symlink_to(pkg.parents[1], target_is_directory=True)
        npm = self.bin / 'npm'
        npm.write_text('#!/bin/sh\nprintf "%s\\n" "' + str(alias) + '"\n')
        npm.chmod(0o755)
        marker = self.repo / 'unexpected-wiring.txt'
        (pkg / 'dist/upkeep-run.js').write_text('import fs from "node:fs"; export function runUpkeep() { fs.writeFileSync(' + json.dumps(str(marker)) + ', "unsafe"); return {lines:[]}; }')
        (pkg / 'dist/claude/hooks.js').write_text('import {runUpkeep} from "../upkeep-run.js"; export function main() { runUpkeep(); console.log("safe global context"); }')
        result = self.run_shim('graft-hooks.cjs', 'session-start')
        self.assertEqual(result.stdout.strip(), 'safe global context')
        self.assertFalse(marker.exists(), 'Symlinked upstream automatic wiring executed')

    @unittest.skipUnless(NODE, 'Node required')
    def test_unreviewed_package_version_skips_hooks(self):
        pkg = self.package(self.repo / 'node_modules/@nanonets/graft', 'unsupported')
        data = json.loads((pkg / 'package.json').read_text())
        data['version'] = '0.22.0'
        (pkg / 'package.json').write_text(json.dumps(data))
        result = self.run_shim('graft-hooks.cjs', 'session-start')
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, '', ''))

    def test_canonical_skill_links_survive_a_copy(self):
        canonical = self.repo / '.agents/skills/graft'
        canonical.mkdir(parents=True)
        shutil.copy2(ROOT / '.agents/skills/graft/SKILL.md', canonical)
        for host in ('.codex', '.claude'):
            original = ROOT / host / 'skills/graft'
            link = self.repo / host / 'skills/graft'
            link.parent.mkdir(parents=True)
            link.symlink_to(os.readlink(original))
            self.assertTrue(link.is_symlink())
            self.assertFalse(os.path.isabs(os.readlink(link)))
            self.assertEqual((link / 'SKILL.md').resolve(), (canonical / 'SKILL.md').resolve())
        text = (ROOT / '.agents/skills/graft/SKILL.md').read_text()
        self.assertIn('name: graft\n', text)

    def test_focused_wrapper_calls_installed_tool_from_subdirectory(self):
        log = self.base / 'args.json'
        graft = self.bin / 'graft'
        graft.write_text('#!' + shutil.which('python3') + '\nimport json,os,sys\nopen(os.environ["GRAFT_ARGS_LOG"],"w").write(json.dumps(sys.argv[1:]))\n')
        graft.chmod(0o755)
        env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ['PATH'], GRAFT_ARGS_LOG=str(log))
        result = subprocess.run(['/bin/sh', str(ROOT / 'scripts/build-graft.sh')], cwd=ROOT / 'client', env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        args = json.loads(log.read_text())
        self.assertEqual(args[:2], ['build', str(ROOT)])
        selected = [args[i + 1] for i, value in enumerate(args) if value == '--only-dir']
        self.assertEqual(selected, ['server', 'client/www/js', 'client/scripts', 'web/src', 'packages', 'scripts', 'infra'])
        self.assertNotIn('--deep', args)

    def test_focused_wrapper_missing_cli_reports_error(self):
        result = subprocess.run(['/bin/sh', str(ROOT / 'scripts/build-graft.sh')], cwd=ROOT, env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 127)
        self.assertIn('Graft CLI is not on PATH', result.stderr)

    def test_new_branch_ci_excludes_old_history_and_catches_removed_output(self):
        repo = self.repo
        subprocess.run(['git', 'init', '-q', '--initial-branch=master', str(repo)], check=True)
        subprocess.run(['git', '-C', str(repo), 'config', 'user.email', 'fixture@example.invalid'], check=True)
        subprocess.run(['git', '-C', str(repo), 'config', 'user.name', 'Fixture'], check=True)
        def commit(message):
            subprocess.run(['git', '-C', str(repo), 'add', '-A'], check=True)
            subprocess.run(['git', '-C', str(repo), 'commit', '-qm', message], check=True)
            return subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
        (repo / 'README.md').write_text('Fixture\n')
        first = commit('initial')
        scripts = repo / 'scripts'
        scripts.mkdir()
        shutil.copy2(ROOT / 'scripts/check-artifact-policy.py', scripts)
        verification = scripts / 'verification'
        verification.mkdir()
        shutil.copy2(ROOT / 'scripts/verification/check-ci-artifacts.py', verification)
        (scripts / 'artifact-policy.json').write_text(json.dumps({'history_base': first}))
        reports = repo / 'reports'
        reports.mkdir()
        (reports / 'old.txt').write_text('Historical policy violation\n')
        commit('old violation')
        (reports / 'old.txt').unlink()
        base = commit('clean default branch')
        subprocess.run(['git', '-C', str(repo), 'update-ref', 'refs/remotes/origin/master', base], check=True)
        (repo / 'README.md').write_text('Current outgoing change\n')
        commit('new branch')
        workflow = (ROOT / '.github/workflows/artifact-policy.yml').read_text()
        run = workflow.split('        run: |\n')[-1]
        script = '\n'.join(line[10:] for line in run.splitlines())
        env = dict(os.environ, EVENT='push', BASE='0' * 40, HEAD='HEAD', DEFAULT_BRANCH='master')
        clean = subprocess.run(['/bin/sh', '-c', script], cwd=repo, env=env, capture_output=True, text=True)
        self.assertEqual(clean.returncode, 0, clean.stderr)
        (reports / 'new.txt').write_text('Forbidden outgoing output\n')
        commit('new output')
        (reports / 'new.txt').unlink()
        commit('remove output')
        bad = subprocess.run(['/bin/sh', '-c', script], cwd=repo, env=env, capture_output=True, text=True)
        self.assertNotEqual(bad.returncode, 0)
        self.assertIn('generated/local output must not be tracked', bad.stderr)

    @unittest.skipUnless(NODE, 'Node required')
    def test_codex_hook_selects_active_worktree_and_skips_missing_shim(self):
        subprocess.run(['git', 'init', '-q', str(self.repo)], check=True, capture_output=True)
        pkg = self.package(self.base / 'registry/node_modules/@nanonets/graft', 'worktree')
        (self.bin / 'graft').symlink_to(pkg / 'dist/cli.js')
        (self.bin / 'node').symlink_to(NODE)
        (self.bin / 'git').symlink_to(shutil.which('git'))
        hooks = json.loads((ROOT / '.codex/hooks.json').read_text())
        command = hooks['hooks']['SessionStart'][0]['hooks'][0]['command']
        nested = self.repo / 'client'
        nested.mkdir()
        result = subprocess.run(['/bin/sh', '-c', command], cwd=nested, env=self.env, capture_output=True, text=True)
        self.assertEqual((result.returncode, result.stdout), (0, ''))
        target = self.repo / '.claude/helpers'
        target.mkdir(parents=True)
        for helper in SHIMS.iterdir():
            if helper.is_file():
                shutil.copy2(helper, target)
        result = subprocess.run(['/bin/sh', '-c', command], cwd=nested, env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['label'], 'worktree')


if __name__ == '__main__':
    unittest.main(verbosity=2)
