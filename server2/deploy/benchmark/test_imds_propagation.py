import os
from pathlib import Path
assert os.environ.get('S09_ISOLATED') == '1' and not Path('/sys').exists(), 'use run_isolated.py; no host execution'
import importlib.util, json, subprocess, unittest, time
from pathlib import Path
HERE = Path(__file__).resolve().parent
def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + '.py'))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
recovery = load('ssm_startup_recovery'); operator = load('aws_operator')
ROLE = 'server2-s09-benchmark-20261008'

class ImdsReadinessTests(unittest.TestCase):
    def fake_run(self, stdout, code=0):
        def run(cmd, **kw):
            self.cmd = cmd
            return subprocess.CompletedProcess(cmd, code, stdout=stdout, stderr=b'')
        return run
    def test_ready_when_info_success_and_role_listed(self):
        self.assertTrue(hasattr(recovery, 'imds_ready'), 'bounded IMDS readiness adapter missing')
        out = json.dumps({'info': {'Code': 'Success'}, 'roles': [ROLE]}).encode()
        self.assertTrue(recovery.imds_ready(ROLE, run=self.fake_run(out)))
        self.assertNotIn('security-credentials/' + ROLE, ' '.join(self.cmd))
    def test_not_ready_when_role_missing(self):
        out = json.dumps({'info': {'Code': 'Success'}, 'roles': []}).encode()
        self.assertFalse(recovery.imds_ready(ROLE, run=self.fake_run(out)))
    def test_not_ready_when_info_not_success(self):
        out = json.dumps({'info': {'Code': 'Failure', 'Message': 'Instance Profile does not contain a role'}, 'roles': []}).encode()
        self.assertFalse(recovery.imds_ready(ROLE, run=self.fake_run(out)))
    def test_child_failure_is_not_ready(self):
        self.assertFalse(recovery.imds_ready(ROLE, run=self.fake_run(b'', code=1)))
    def test_readiness_window_covers_late_role_delivery(self):
        # Historical EC2 AssumeRole timing suggests propagation latency; it does
        # not prove when IMDS became readable or when credentials were issued.
        # The bounded readiness budget exceeds the old 90-second TLS-only wait.
        self.assertGreaterEqual(recovery.READINESS_SECONDS, 150)
        self.assertGreater(recovery.ADMISSION_SECONDS, recovery.READINESS_SECONDS)
    def test_main_requires_role_argument(self):
        with self.assertRaises(SystemExit):
            # Never use the production runner, even for parser-negative tests.
            recovery.main(['--unit', 'amazon-ssm-agent.service', '--deadline-ms', '1791623880000'],
                          run=self.fake_run(b'', code=1), wall=lambda: 1791623881)

class ControllerPropagationTests(unittest.TestCase):
    def test_propagation_wait_constant_and_template_role(self):
        self.assertGreaterEqual(operator.PROFILE_PROPAGATION_SECONDS, 60)
        base = (HERE / 'cloud-init.yml').read_text()
        template = base
        self.assertIn('--role ' + ROLE, template)
        self.assertIn('timeout -k 2 ' + str(recovery.READINESS_SECONDS + recovery.ADMISSION_SECONDS + 30), template)

if __name__ == '__main__':
    unittest.main()
