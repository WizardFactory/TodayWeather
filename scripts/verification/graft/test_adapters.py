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
        shutil.copy2(SHIMS / 'graft-hooks.cjs', target)
        result = subprocess.run(['/bin/sh', '-c', command], cwd=nested, env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['label'], 'worktree')


if __name__ == '__main__':
    unittest.main(verbosity=2)
