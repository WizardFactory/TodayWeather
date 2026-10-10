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
        self.assertEqual(op.EXPIRY,1791631080000)
        config=json.loads((Path(op.__file__).parent/'aws-run.json').read_text())
        self.assertEqual(config['approval_expires_at_ms'],op.EXPIRY)
        self.assertEqual(op.validate_config(config,now_ms=1791623880000),config)
        for file in ('aws_operator.py','ssm_startup_recovery.py'):
            source=(Path(op.__file__).parent/file).read_text()
            self.assertIn('1791631080000',source)
            self.assertNotIn('1791623880000',source)
        self.assertEqual(op.validate_config(config,now_ms=1791607799000),config)
        with self.assertRaisesRegex(op.OperatorError,'approval expired'):
            op.validate_config(config,now_ms=1791631080000)
        self.assertEqual((config['host_seconds'],config['max_instances'],config['usd_operator_stop']), (7200,1,5))
        self.assertEqual((config['read_attempts'],config['write_attempts'],config['download_bytes']), (10000,2000,op.GiB))

class ManualProvenanceTests(unittest.TestCase):
    def test_renderer_does_not_label_every_host_macos(self):
        from pathlib import Path
        source=(Path(op.__file__).parents[2]/'tools/render_feasibility_manual.py').read_text()
        self.assertNotIn("'Rust1.99/macOS, public Python loopback peer'",source)
        self.assertIn('platform.system()',source)



class ReconciledUsageTests(unittest.TestCase):
    def test_reconciled_cli_requires_pair_and_debits_before_state(self):
        import sys
        from unittest.mock import patch
        config=dict(op.FIXED,source_revision='a'*40,native_review_receipt_sha256='b'*64)
        auth={k:config[k] for k in ('run_id','source_revision','native_review_receipt_sha256')}
        auth.update(AWS_execution_authorized=True,expires_at_ms=op.EXPIRY)
        base=['operator','--execute-reviewed-run','--state','/scratch/new','--authorization','/scratch/auth',
            '--prior-state','/scratch/p1','--prior-state','/scratch/p2']
        for extra in ([],['--reconciled-prior-state','/scratch/p3'],['--prior-reconciliation','/scratch/proof']):
            with patch.object(sys,'argv',base+extra), patch.object(op,'validate_config',return_value=config), \
                 patch.object(op,'bounded_json',side_effect=[config,auth]), patch.object(op,'carry_prior_usage',side_effect=AssertionError('prior accounting reached without required reconciliation')), patch.object(op.State,'create') as create:
                with self.assertRaisesRegex(op.OperatorError,'paired reconciliation inputs'):
                    op.main()
                create.assert_not_called()
        carried={'ledger':{},'operator_calls':453}
        with patch.object(sys,'argv',base+['--reconciled-prior-state','/scratch/p3','--prior-reconciliation','/scratch/proof']), \
             patch.object(op,'validate_config',return_value=config), patch.object(op,'bounded_json',side_effect=[config,auth]), \
             patch.object(op,'carry_prior_usage',return_value={}), patch.object(op,'carry_reconciled_usage',return_value=carried) as carry, \
             patch.object(op.State,'create',side_effect=op.OperatorError('stop before launch')) as create:
            with self.assertRaisesRegex(op.OperatorError,'stop before launch'):op.main()
            self.assertEqual(create.call_args.args[1]['operator_calls'],453)
            carry.assert_called_once_with({},Path('/scratch/p3'),Path('/scratch/proof'))

    def test_third_cumulative_attempt_is_carried_once_without_mutation(self):
        import tempfile, json
        with tempfile.TemporaryDirectory() as directory:
            paths=[]
            for index in range(2):
                path=Path(directory)/str(index)
                path.write_text(json.dumps({'run_id':op.FIXED['run_id'],
                    'status':'cleaned_host_resources_S3_retained','worker_allocation_issued':False,
                    'operator_calls':90,'watchdog_reserved_reads':50,
                    'watchdog_reserved_download_bytes':50*131072,
                    'ledger':{'reads':90,'writes':1,'download':90*131072,'store':0}}))
                paths.append(path)
            previous=op.carry_prior_usage(paths)
            third=dict(previous,run_id=op.FIXED['run_id'],status='creation',worker_allocation_issued=False,
                launch_attempted=True,client_token='s09-fixture',config_sha256='b'*64,
                watchdog_reserved_reads=50,watchdog_reserved_download_bytes=50*131072)
            third['ledger']=dict(reads=300,writes=3,download=303*131072,store=0)
            third['operator_calls']=303
            state=Path(directory)/'third';state.write_text(json.dumps(third))
            receipt={'schema':1,'run_id':op.FIXED['run_id'],'state_sha256':op.digest(op.canonical(third)),
                'config_sha256':third['config_sha256'],'client_token_sha256':op.digest(third['client_token'].encode()),
                'cloudtrail_event_id':'93fea912-2f69-40e5-a387-96b0b8c9a602',
                'launch_error':'Client.InvalidParameterValue: Encoded User data is limited to 25600 bytes',
                'host_absent':True,'volumes_absent':True,'role_absent':True,'profile_absent':True,
                'security_group_absent':True,'bucket_retained':True,'worker_dispatched':False,
                'external_call_reservation':100,'evidence_sha256':['c'*64]}
            proof=Path(directory)/'proof';proof.write_text(json.dumps(receipt))
            original=state.read_bytes()
            self.assertTrue(hasattr(op,'carry_reconciled_usage'),'reconciled cumulative carry missing')
            result=op.carry_reconciled_usage(previous,state,proof)
            self.assertEqual(result['ledger'],dict(reads=450,writes=103,download=453*131072,store=0))
            self.assertEqual(result['operator_calls'],453)
            self.assertEqual(result['prior_state_sha256'],previous['prior_state_sha256']+[op.digest(op.canonical(third))])
            self.assertEqual(state.read_bytes(),original)
            for field,value in [('worker_dispatched',True),('state_sha256','d'*64),('host_absent',False),('external_call_reservation',True)]:
                bad=dict(receipt);bad[field]=value;proof.write_text(json.dumps(bad))
                with self.assertRaises(op.OperatorError):op.carry_reconciled_usage(previous,state,proof)
            proof.write_text(json.dumps(receipt))
            for field,value in [('worker_allocation_issued',True),('prior_state_sha256',[]),('operator_calls',2),('recovery1',{})]:
                bad=dict(third);bad[field]=value;state.write_text(json.dumps(bad))
                rebound=dict(receipt,state_sha256=op.digest(op.canonical(bad)));proof.write_text(json.dumps(rebound))
                with self.assertRaises(op.OperatorError):op.carry_reconciled_usage(previous,state,proof)

class CarryPriorUsageTests(unittest.TestCase):
    def test_carries_two_cleaned_preworker_states_and_watchdog_reservations(self):
        import tempfile, json
        from pathlib import Path
        with tempfile.TemporaryDirectory() as directory:
            paths=[]
            for index in range(2):
                path=Path(directory)/str(index)
                path.write_text(json.dumps({'run_id':op.FIXED['run_id'],
                    'status':'cleaned_host_resources_S3_retained',
                    'worker_allocation_issued':False,'operator_calls':90,
                    'watchdog_reserved_reads':50,'watchdog_reserved_download_bytes':50*131072,
                    'ledger':{'reads':90,'writes':1,'download':90*131072,'store':0}}))
                paths.append(path)
            value=op.carry_prior_usage(paths)
            self.assertEqual(value['ledger'],{'reads':280,'writes':2,'download':280*131072,'store':0})
            self.assertEqual(value['operator_calls'],280)
            self.assertEqual(len(value['prior_state_sha256']),2)
            runner=Mock();runner.call.return_value={}
            state=Mock();state.data=dict(value,deadline_ms=op.EXPIRY,watchdog_reserved_reads=50)
            controller=op.Operator(dict(op.FIXED),state,runner,clock=lambda:op.EXPIRY-1000)
            controller.call('sts','get-caller-identity',[])
            self.assertEqual(controller.calls,281)
            self.assertEqual(controller.ledger.used['reads'],281)
            self.assertEqual(state.data['operator_calls'],281)
            runner.call.assert_called_once()
            with self.assertRaises(op.OperatorError):op.carry_prior_usage(paths+paths[:1])
            bad=json.loads(paths[0].read_text());bad['worker_allocation_issued']=True
            paths[0].write_text(json.dumps(bad))
            with self.assertRaises(op.OperatorError):op.carry_prior_usage(paths)

    def test_new_attempt_requires_both_inputs_before_state_or_watchdog(self):
        import sys
        from unittest.mock import patch, Mock
        config=dict(op.FIXED,source_revision='a'*40,native_review_receipt_sha256='b'*64)
        authority={k:config[k] for k in ('run_id','source_revision','native_review_receipt_sha256')}
        authority.update(AWS_execution_authorized=True,expires_at_ms=op.EXPIRY)
        for extra in ([],['--prior-state','/scratch/only-one']):
            with patch.object(sys,'argv',['operator','--execute-reviewed-run','--state','/scratch/new','--authorization','/scratch/auth']+extra), \
                 patch.object(op,'validate_config',return_value=config), \
                 patch.object(op,'bounded_json',side_effect=[config,authority]), \
                 patch.object(op.State,'create') as create, \
                 patch.object(op.subprocess,'Popen') as popen:
                with self.assertRaisesRegex(op.OperatorError,'two prior states required'):
                    op.main()
                create.assert_not_called();popen.assert_not_called()
