"""Sandbox launcher contract; static inspection never imports operational code."""
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent

class SandboxTests(unittest.TestCase):
    def test_launcher_is_maintained_and_fail_closed(self):
        path = HERE / 'run_isolated.py'
        self.assertTrue(path.is_file(), 'maintained sandbox launcher missing')
        source = path.read_text()
        for required in ('--unshare-all', '--cap-drop', '--clearenv', '--die-with-parent',
                         "'--uid', '0'", "'--gid', '0'"):
            self.assertIn(required, source)
        self.assertNotIn('/root/', source)
        self.assertIn('check=True', source)

    def test_ci_only_invokes_operational_tests_through_sandbox(self):
        source = (HERE.parents[1]/'tools/ci.py').read_text()
        self.assertIn('deploy/benchmark/run_isolated.py', source)
        for selection in ('safety','test_*.py','functional','imds-functional','online-functional','manifest-functional'):
            self.assertIn(repr(selection), source)
        self.assertNotIn("'deploy/benchmark/test_aws_operator.py'", source)

    def test_operational_test_modules_refuse_host_import(self):
        for path in HERE.glob('test_*.py'):
            if path.name == 'test_sandbox.py': continue
            self.assertIn("os.environ.get('S09_ISOLATED') == '1'", path.read_text(), path.name)
            self.assertIn("not Path('/sys').exists()", path.read_text(), path.name)

if __name__ == '__main__': unittest.main()
