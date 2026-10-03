"""Execute Paseo configuration in isolated repositories; no operator secrets."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
CONFIG = json.loads((ROOT / 'paseo.json').read_text())


class PaseoSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='graft-paseo-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.repo = self.base / 'worktree with spaces'
        self.repo.mkdir()
        subprocess.run(['git', 'init', '-q', str(self.repo)], check=True)
        self.home = self.base / 'home'
        self.home.mkdir()
        self.bin = self.base / 'bin'
        self.bin.mkdir()
        self.env = dict(os.environ, HOME=str(self.home), CODEX_HOME=str(self.home / '.codex'),
                        PATH=str(self.bin) + ':/usr/bin:/bin',
                        PASEO_SOURCE_CHECKOUT_PATH=str(self.base / 'absent source'))
        for key in ('GRAFT_PROJECT_ROOT', 'GIT_DIR', 'GIT_WORK_TREE'):
            self.env.pop(key, None)

    def wrapper(self):
        scripts = self.repo / 'scripts'
        scripts.mkdir()
        (scripts / 'build-graft.sh').write_bytes((ROOT / 'scripts/build-graft.sh').read_bytes())

    def cli(self, code=0):
        path = self.bin / 'graft'
        path.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > invocation.txt\nexit ' + str(code) + '\n')
        path.chmod(0o700)

    def run_command(self, command):
        result = subprocess.run(['sh', '-c', command], cwd=self.repo, env=self.env,
                                capture_output=True, text=True)
        self.assertEqual(list(self.home.iterdir()), [], 'HOME changed')
        return result

    def test_creation_builds_focused_graph(self):
        self.wrapper()
        self.cli()
        result = self.run_command(CONFIG['worktree']['setup'])
        self.assertEqual(result.returncode, 0, result.stderr)
        args = (self.repo / 'invocation.txt').read_text().splitlines()
        self.assertEqual(args[:2], ['build', str(self.repo)])
        self.assertIn('client/www/js', args)
        self.assertNotIn('--deep', args)

    def test_old_branch_without_wrapper_skips(self):
        self.cli()
        result = self.run_command(CONFIG['worktree']['setup'])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Graft build skipped', result.stderr)
        self.assertFalse((self.repo / 'invocation.txt').exists())

    def test_missing_cli_warns_without_install(self):
        self.wrapper()
        result = self.run_command(CONFIG['worktree']['setup'])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Graft build skipped', result.stderr)

    def test_build_error_fails_setup(self):
        self.wrapper()
        self.cli(42)
        result = self.run_command(CONFIG['worktree']['setup'])
        self.assertEqual(result.returncode, 42, result.stderr)

    def test_manual_refresh_uses_same_wrapper(self):
        self.wrapper()
        self.cli()
        result = self.run_command(CONFIG['scripts']['graft-build']['command'])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.repo / 'invocation.txt').is_file())

    def test_manual_missing_cli_is_error(self):
        self.wrapper()
        result = self.run_command(CONFIG['scripts']['graft-build']['command'])
        self.assertEqual(result.returncode, 127, result.stderr)


if __name__ == '__main__':
    unittest.main()
