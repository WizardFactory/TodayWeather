"""Regression checks against disposable copies of the published manual."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]
VERIFY = Path(__file__).with_name('verify.py')


class ManualVerificationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.manual = Path(self.temp.name) / 'manual'
        shutil.copytree(ROOT / 'docs/user/android-app', self.manual)

    def run_verifier(self, optimized=False):
        return subprocess.run(
            [sys.executable, *(['-O'] if optimized else []), str(VERIFY),
             str(self.manual), '--repo', str(ROOT)], text=True, capture_output=True)

    def replace_screenshot(self, renew_hash=False):
        name = 'screenshots/05-hourly.png'
        shutil.copyfile(self.manual / 'screenshots/06-hourly-expanded.png', self.manual / name)
        if renew_hash:
            path = self.manual / 'provenance.json'
            data = json.loads(path.read_text())
            data['screenshots'][name]['sha256'] = hashlib.sha256((self.manual / name).read_bytes()).hexdigest()
            path.write_text(json.dumps(data))

    def test_published_manual_passes_with_and_without_optimization(self):
        for optimized in (False, True):
            with self.subTest(optimized=optimized):
                result = self.run_verifier(optimized)
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_replaced_screenshot_requires_rebuilding_pdf(self):
        self.replace_screenshot(renew_hash=True)
        result = self.run_verifier()
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn('PDF image differs', result.stderr)

    def test_optimization_cannot_disable_hash_checks(self):
        self.replace_screenshot()
        result = self.run_verifier(optimized=True)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn('image changed', result.stderr)


if __name__ == '__main__':
    unittest.main()
