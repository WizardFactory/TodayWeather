"""Maintained successor integration contracts, only through namespace runner."""
import os
from pathlib import Path
assert os.environ.get('S09_ISOLATED') == '1' and not Path('/sys').exists(), 'use run_isolated.py; no host execution'
import unittest
from unittest.mock import Mock
import aws_operator as op

class ProfileIntegrationTests(unittest.TestCase):
    def test_profile_readback_waits_full_sixty_seconds_without_launch(self):
        self.assertTrue(hasattr(op.Operator, 'wait_profile_ready'), 'bounded profile settling missing')
        now = [op.EXPIRY-7200000]
        role = 'arn:aws:iam::'+op.FIXED['account']+':role/'+op.FIXED['role']
        state = Mock(data={'deadline_ms':op.EXPIRY})
        controller = op.Operator(dict(op.FIXED), state, Mock(), clock=lambda:now[0])
        calls = []
        def call(service, action, args):
            calls.append((action, now[0]))
            self.assertEqual(action, 'get-instance-profile')
            return {'InstanceProfile': {'Arn':'arn:aws:iam::'+op.FIXED['account']+':instance-profile/'+op.FIXED['role'],
                'Tags':[{'Key':'RunId','Value':op.FIXED['run_id']},{'Key':'Purpose','Value':'synthetic-benchmark-only'}],
                'Roles':[{'RoleName':op.FIXED['role'],'Arn':role}]}}
        controller.call = call
        start = now[0]
        def sleep(seconds): now[0] += int(seconds*1000)
        controller.wait_profile_ready(role, sleep=sleep)
        self.assertEqual(now[0]-start, 60000)
        self.assertEqual(len(calls), 13)

class BootstrapIntegrationTests(unittest.TestCase):
    def test_render_embeds_exact_maintained_recovery_and_private_identity(self):
        import base64, gzip
        from pathlib import Path
        here = Path(op.__file__).parent
        script = (here/'ssm_startup_recovery.py').read_bytes()
        config = dict(op.FIXED, source_revision='a'*40, rustup_sha256='b'*64,
            rustup_url='https://example.invalid/pinned', source_files={
                'server2/deploy/benchmark/ssm_startup_recovery.py':op.digest(script)})
        state = Mock(data={'nonce':'d'*64, 'deadline_ms':op.EXPIRY-1000})
        controller = op.Operator(config, state, Mock(), clock=lambda:op.EXPIRY-2000)
        try: payload = controller.render_bootstrap()
        except op.OperatorError as error: self.fail('maintained recovery render failed: '+str(error))
        text = gzip.decompress(payload).decode()
        self.assertLessEqual(len(payload),16384)
        self.assertNotIn('@@',text)
        self.assertIn(base64.b64encode(script).decode(), text)
        self.assertEqual(text.count(state.data['readiness_key']),1)
        state.save.assert_called()
        self.assertIn('git checkout --detach',text)
        self.assertIn('SOURCE_REVISION',text)
        config['source_files']['server2/deploy/benchmark/ssm_startup_recovery.py']='0'*64
        with self.assertRaisesRegex(op.OperatorError,'recovery source pin'):
            controller.render_bootstrap()

class AuthorityIntegrationTests(unittest.TestCase):
    def test_fixed_renewed_expiry_without_grant_expansion(self):
        import json
        from pathlib import Path
        self.assertEqual(op.EXPIRY,1791623880000)
        config=json.loads((Path(op.__file__).parent/'aws-run.json').read_text())
        self.assertEqual(config['approval_expires_at_ms'],op.EXPIRY)
        self.assertEqual(op.validate_config(config,now_ms=1791607799000),config)
        with self.assertRaisesRegex(op.OperatorError,'approval expired'):
            op.validate_config(config,now_ms=1791623880000)
        self.assertEqual((config['host_seconds'],config['max_instances'],config['usd_operator_stop']), (7200,1,5))
        self.assertEqual((config['read_attempts'],config['write_attempts'],config['download_bytes']), (10000,2000,op.GiB))

class ManualProvenanceTests(unittest.TestCase):
    def test_renderer_does_not_label_every_host_macos(self):
        from pathlib import Path
        source=(Path(op.__file__).parents[2]/'tools/render_feasibility_manual.py').read_text()
        self.assertNotIn("'Rust1.99/macOS, public Python loopback peer'",source)
        self.assertIn('platform.system()',source)
