"""S19b orchestration controls; product checks run separately with real artifacts."""
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools'))
import native_suite as suite


class SuiteControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.artifacts = {}
        for role in suite.ROLES:
            path = self.root / ('examples/' + role if role == 'kma_s3_replay' else role)
            path.parent.mkdir(exist_ok=True)
            path.write_bytes(b'owned test artifact ' + role.encode())
            path.chmod(0o700)
            self.artifacts[role] = {'path': str(path), 'sha256': suite.sha256(path), 'profile': 'release'}
        self.manifest = self.root / 'artifacts.json'
        self.write_manifest()

    def write_manifest(self):
        self.manifest.write_text(json.dumps({'schema': 1, 'revision': 'a' * 40, 'artifacts': self.artifacts}))

    def good_runner(self, command, log, env, timeout):
        if log.parent.name == 'notice':
            log.write_text(json.dumps({'scenario': 'notice-cli-s3-api', 'outcome': 'PASS', 'external_calls': 0}))
        else:
            log.write_text('test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\n')
        return {'exit_code': 0, 'timed_out': False}

    def test_missing_or_mutated_input_blocks_every_child(self):
        self.artifacts['notice_smoke']['sha256'] = '0' * 64
        self.write_manifest()
        runner = Mock()
        code, report = suite.run(self.manifest, self.root / 'run', None, runner)
        self.assertEqual(code, 2)
        self.assertEqual(report['verdict'], 'BLOCKED')
        self.assertFalse(report['full_coverage'])
        runner.assert_not_called()
        self.assertTrue(all(c['status'] == 'NOT_RUN' for c in report['checks']))

    def test_missing_role_and_nonrelease_are_rejected(self):
        del self.artifacts['state']
        self.write_manifest()
        with self.assertRaises(ValueError):
            suite.load_artifacts(self.manifest, suite.choose(['state']))
        self.artifacts['notice_smoke']['profile'] = 'debug'
        self.write_manifest()
        with self.assertRaises(ValueError):
            suite.load_artifacts(self.manifest, suite.choose(['notice']))

    def test_unknown_role_or_duplicate_selection_is_not_silently_accepted(self):
        with self.assertRaises(ValueError):
            suite.choose(['notice', 'notice'])
        with self.assertRaises(ValueError):
            suite.choose(['not-a-check'])
        self.artifacts['operator-command'] = {'command': 'unsafe'}
        self.write_manifest()
        with self.assertRaises(ValueError):
            suite.load_artifacts(self.manifest, suite.choose(['notice']))

    def test_subset_pass_keeps_other_checks_not_run(self):
        code, report = suite.run(self.manifest, self.root / 'run', ['notice'], self.good_runner)
        self.assertEqual(code, 0)
        self.assertFalse(report['full_coverage'])
        self.assertEqual(report['selected'], ['notice'])
        self.assertEqual(sum(c['status'] == 'PASS' for c in report['checks']), 1)
        self.assertEqual(sum(c['status'] == 'NOT_RUN' for c in report['checks']), 10)
        self.assertEqual(json.loads((self.root / 'run/report.json').read_text()), report)

    def test_failed_full_selection_is_not_reported_as_a_subset(self):
        for ids, expected in (([c.id for c in suite.CHECKS], 'all checks selected'),
                              (['notice'], 'selected checks only')):
            with self.subTest(ids=ids), patch.object(suite, 'run', return_value=(1, {
                    'verdict': 'FAIL', 'full_coverage': False, 'selected': ids})), \
                    patch('sys.stdout', new_callable=io.StringIO) as output:
                code = suite.main(['--artifacts', str(self.manifest), '--out', str(self.root / 'run')])
                self.assertEqual(code, 1)
                self.assertIn('FAIL native verification: ' + expected + ';', output.getvalue())

    def test_exit_zero_without_expected_output_fails(self):
        def noop(command, log, env, timeout):
            log.write_text('')
            return {'exit_code': 0, 'timed_out': False}
        code, report = suite.run(self.manifest, self.root / 'run', ['notice'], noop)
        self.assertEqual(code, 1)
        self.assertEqual(next(c for c in report['checks'] if c['id'] == 'notice')['status'], 'FAIL')

    def test_failed_child_does_not_hide_next_check(self):
        def failing(command, log, env, timeout):
            result = self.good_runner(command, log, env, timeout)
            if log.parent.name == 'state':
                result['exit_code'] = 1
            return result
        code, report = suite.run(self.manifest, self.root / 'run', ['state', 'notice'], failing)
        self.assertEqual(code, 1)
        states = {c['id']: c['status'] for c in report['checks']}
        self.assertEqual((states['state'], states['notice']), ('FAIL', 'PASS'))

    def test_zero_matching_rust_tests_cannot_pass(self):
        def zero(command, log, env, timeout):
            log.write_text('test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 20 filtered out\n')
            return {'exit_code': 0, 'timed_out': False}
        code, _ = suite.run(self.manifest, self.root / 'run', ['summary-http'], zero)
        self.assertEqual(code, 1)

    def test_missing_replay_or_partial_worker_report_cannot_pass(self):
        code, _ = suite.run(self.manifest, self.root / 'replay', ['kma-core'], self.good_runner)
        self.assertEqual(code, 1)

        def partial(command, log, env, timeout):
            log.write_text('')
            directory = log.parent / 'process'
            directory.mkdir()
            (directory / 'results.json').write_text(json.dumps({
                'binary_sha256': self.artifacts['runtime_services']['sha256'],
                'live_actions': False, 'results': [{'id': 'term-happy', 'status': 'passed'}]}))
            return {'exit_code': 0, 'timed_out': False}
        code, _ = suite.run(self.manifest, self.root / 'workers', ['workers'], partial)
        self.assertEqual(code, 1)

    def test_kma_adapter_cannot_use_an_unverified_sibling(self):
        self.artifacts['kma_s3_replay']['path'] = self.artifacts['notice_smoke']['path']
        self.artifacts['kma_s3_replay']['sha256'] = self.artifacts['notice_smoke']['sha256']
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'beside server2'):
            suite.load_artifacts(self.manifest, suite.choose(['kma-core']))

    def test_artifact_hash_drift_between_checks_is_detected(self):
        def mutate(command, log, env, timeout):
            result = self.good_runner(command, log, env, timeout)
            if log.parent.name == 'state':
                Path(self.artifacts['notice_smoke']['path']).write_bytes(b'changed after preflight')
            return result
        code, report = suite.run(self.manifest, self.root / 'run', ['state', 'notice'], mutate)
        self.assertEqual(code, 1)
        notice = next(c for c in report['checks'] if c['id'] == 'notice')
        self.assertIn('hash', notice['error'])

    def test_output_directory_is_never_reused(self):
        out = self.root / 'run'
        out.mkdir()
        sentinel = out / 'report.json'
        sentinel.write_text('retained original')
        with self.assertRaises(FileExistsError):
            suite.run(self.manifest, out, ['notice'], self.good_runner)
        self.assertEqual(sentinel.read_text(), 'retained original')

    def test_operator_settings_and_credentials_are_not_inherited(self):
        with patch.dict(os.environ, {'AWS_SECRET_KEY': 'sentinel', 'HTTP_PROXY': 'sentinel',
                                    'SERVER2_GATEWAY_LEGACY_URL': 'sentinel', 'VC_SECRET_KEY': 'sentinel'}):
            env = suite.child_environment()
        self.assertFalse(set(env) & {'AWS_SECRET_KEY', 'HTTP_PROXY', 'SERVER2_GATEWAY_LEGACY_URL', 'VC_SECRET_KEY'})

    def test_timeout_stops_the_owned_child_group(self):
        marker = self.root / 'should-not-appear'
        child = 'import time; from pathlib import Path; time.sleep(0.8); Path(%r).touch()' % str(marker)
        parent = 'import subprocess,sys,time; subprocess.Popen([sys.executable,"-c",%r]); time.sleep(5)' % child
        result = suite.execute([sys.executable, '-c', parent], self.root / 'timeout.log', suite.child_environment(), .2)
        self.assertTrue(result['timed_out'])
        time.sleep(.9)
        self.assertFalse(marker.exists())


if __name__ == '__main__':
    unittest.main()
