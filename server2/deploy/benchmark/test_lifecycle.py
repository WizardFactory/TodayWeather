"""Offline lifecycle regressions. All host/cloud adapters are test doubles."""
import os
from pathlib import Path
assert os.environ.get('S09_ISOLATED') == '1' and not Path('/sys').exists(), 'use run_isolated.py; no host execution'
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('lifecycle_operator', HERE/'aws_operator.py')
assert spec is not None and spec.loader is not None
op = importlib.util.module_from_spec(spec); spec.loader.exec_module(op)

class BootstrapLifecycleTests(unittest.TestCase):
    def test_ordinary_failures_return_but_emergency_guards_stay_armed(self):
        base = (HERE/'cloud-init.yml').read_text()
        derived = base
        supervisor = next(x for x in derived.splitlines() if 'timeout -k 2 510' in x)
        self.assertNotIn('poweroff', supervisor)
        self.assertIn('exit 1', supervisor)
        bootstrap = derived.split('write_files:', 1)[1]
        ordinary = next(x for x in bootstrap.splitlines() if 'fail() {' in x and 'emergency_fail' not in x)
        self.assertNotIn('poweroff', ordinary)
        self.assertIn('S09_BOOTSTRAP_FAILED', ordinary)
        self.assertIn('systemctl is-active --quiet server2-s09-expiry.timer || emergency_fail', bootstrap)
        self.assertIn('systemctl is-active --quiet server2-s09-meter.service || emergency_fail', bootstrap)
        self.assertIn('test -n "$agent" || ordinary_fail', derived)
        self.assertIn('systemctl stop "$agent" || ordinary_fail', derived)
        self.assertIn('ExecStart=/usr/bin/systemctl poweroff --no-block', derived)
        self.assertIn('FailureAction=poweroff', derived)
        monitor = base.split("    # Persistent stock Python guard",1)[1].split("write_files:",1)[0]
        self.assertIn(monitor, derived)
        self.assertEqual(base.split('      # Wait for controller',1)[1], derived.split('      # Wait for controller',1)[1])

class ControllerLifecycleTests(unittest.TestCase):
    def controller(self):
        state = Mock(data={'resources': {'instance': 'i-ab'}, 'deadline_ms': op.EXPIRY})
        return op.Operator(dict(op.FIXED), state, Mock(), clock=lambda: op.EXPIRY-1000)

    def test_result_then_one_final_cleanup_for_success_or_failure(self):
        self.assertTrue(hasattr(op.Operator, 'run_lifecycle'), 'single final lifecycle missing')
        for failed in (False, True):
            with self.subTest(failed=failed):
                controller = self.controller(); events = []
                def work():
                    events.append('result-export')
                    if failed: raise op.OperatorError('worker failed')
                    return 'result'
                controller.capture_admission_diagnostics = lambda **kw: events.append('bounded-diagnostic')
                controller.cleanup = lambda: events.append('cleanup') or {'status':'cleaned_host_resources_S3_retained'}
                if failed:
                    with self.assertRaisesRegex(op.OperatorError, 'worker failed'):
                        controller.run_lifecycle(work, sleep=lambda _: None)
                else:
                    self.assertEqual(controller.run_lifecycle(work, sleep=lambda _: None), 'result')
                self.assertEqual(events, ['result-export'] + (['bounded-diagnostic'] if failed else []) + ['cleanup'])

    def test_existing_diagnostic_not_repeated_and_cleanup_is_bounded(self):
        self.assertTrue(hasattr(op.Operator, 'run_lifecycle'), 'single final lifecycle missing')
        controller = self.controller()
        controller.state.data['ssm_admission_diagnostics'] = {'already':'captured'}
        controller.capture_admission_diagnostics = Mock(side_effect=AssertionError('duplicate diagnostic'))
        controller.cleanup = Mock(return_value={'status':'termination_requested_cleanup_pending'})
        with self.assertRaisesRegex(op.OperatorError, '^failure$') as caught:
            controller.run_lifecycle(lambda: (_ for _ in ()).throw(op.OperatorError('failure')), sleep=lambda _: None)
        self.assertIn('cleanup',str(caught.exception.__cause__))
        self.assertTrue(controller.state.data['lifecycle_cleanup_failure']['work_failed'])
        self.assertEqual(controller.cleanup.call_count, 60)
        controller.capture_admission_diagnostics.assert_not_called()

    def test_cleanup_exception_preserves_original_failure_and_sanitized_state(self):
        controller=self.controller()
        original=op.OperatorError('original worker failure')
        controller.capture_admission_diagnostics=Mock()
        controller.cleanup=Mock(side_effect=op.OperatorError('PRIVATE_CLEANUP_DETAIL'))
        with self.assertRaises(op.OperatorError) as caught:
            controller.run_lifecycle(lambda: (_ for _ in ()).throw(original),sleep=lambda _:None)
        self.assertIs(caught.exception,original)
        self.assertEqual(str(caught.exception.__cause__),'final cleanup failed; watchdog remains armed')
        self.assertEqual(controller.state.data['lifecycle_cleanup_failure'],
            {'work_failed':True,'cleanup_outcome':'unverified','watchdog_remains_armed':True})
        self.assertNotIn('PRIVATE_CLEANUP_DETAIL',str(controller.state.data))
        controller.cleanup.assert_called_once()

    def test_state_write_failure_cannot_mask_original_or_cleanup_failure(self):
        controller=self.controller()
        controller.state.save=Mock(side_effect=OSError('private state error'))
        controller.cleanup=Mock(side_effect=op.OperatorError('cleanup failed'))
        controller.capture_admission_diagnostics=Mock()
        with self.assertRaisesRegex(op.OperatorError,'^original$') as caught:
            controller.run_lifecycle(lambda: (_ for _ in ()).throw(op.OperatorError('original')))
        self.assertEqual(str(caught.exception.__cause__),'final cleanup failed; watchdog remains armed')
        self.assertTrue(controller.state.data['lifecycle_cleanup_failure']['work_failed'])

    def test_successful_work_does_not_hide_cleanup_failure(self):
        controller=self.controller()
        controller.cleanup=Mock(side_effect=op.OperatorError('cleanup failed'))
        with self.assertRaisesRegex(op.OperatorError,'^cleanup failed$'):
            controller.run_lifecycle(lambda:'result',sleep=lambda _:None)
        self.assertFalse(controller.state.data['lifecycle_cleanup_failure']['work_failed'])

    def test_diagnostic_exception_cannot_prevent_cleanup(self):
        self.assertTrue(hasattr(op.Operator, 'run_lifecycle'), 'single final lifecycle missing')
        controller = self.controller()
        controller.capture_admission_diagnostics = Mock(side_effect=RuntimeError('private diagnostic'))
        controller.cleanup = Mock(return_value={'status':'cleaned_host_resources_S3_retained'})
        with self.assertRaisesRegex(op.OperatorError, '^original failure$'):
            controller.run_lifecycle(lambda: (_ for _ in ()).throw(op.OperatorError('original failure')), sleep=lambda _: None)
        controller.cleanup.assert_called_once()

class CleanupDispatchTests(unittest.TestCase):
    controller = ControllerLifecycleTests.controller
    def test_reconciliation_never_repeats_normal_termination(self):
        for unknown in (False, True):
            with self.subTest(unknown=unknown):
                controller = self.controller(); calls = []
                controller.state.data['resources']['root_volume'] = 'vol-ab'
                def call(service, action, args, **kw):
                    calls.append(action)
                    if action == 'describe-instances':
                        return {'Reservations':[{'Instances':[{'InstanceId':'i-ab', 'State':{'Name':'running'}, 'Tags':[
                            {'Key':'RunId','Value':controller.config['run_id']},
                            {'Key':'Purpose','Value':'synthetic-benchmark-only'}]}]}]}
                    if action == 'terminate-instances':
                        self.assertEqual(controller.state.data.get('cleanup_termination_instance'), 'i-ab')
                        if unknown: raise op.OperatorError('unknown transport outcome')
                        return {}
                    self.fail('unexpected destructive action')
                controller.call = call
                for _ in range(3):
                    try: controller.cleanup()
                    except op.OperatorError:
                        self.assertTrue(unknown)
                self.assertEqual(calls.count('terminate-instances'), 1)
                self.assertEqual(calls.count('describe-instances'), 3)

class WorkerFinalCleanupTests(unittest.TestCase):
    def test_worker_path_does_not_preempt_final_host_cleanup(self):
        import inspect
        self.assertNotIn('os.kill(pid,15)', inspect.getsource(op.Operator.run_host))

class MainLifecycleTests(unittest.TestCase):
    def test_main_success_worker_failure_and_monitor_failure_share_final_cleanup(self):
        import sys, contextlib, io
        for fault in ('none', 'worker', 'monitor'):
            with self.subTest(fault=fault):
                controller = ControllerLifecycleTests().controller()
                events = []
                config = dict(op.FIXED, source_revision='a'*40, native_review_receipt_sha256='b'*64)
                authority = {k:config[k] for k in ('run_id','source_revision','native_review_receipt_sha256')}
                authority.update(AWS_execution_authorized=True, expires_at_ms=op.EXPIRY)
                def work():
                    events.append('result')
                    if fault == 'worker': raise op.OperatorError('worker failure')
                controller.provision = lambda: events.append('provision')
                controller.run_host = work
                controller.capture_admission_diagnostics = lambda **kw: events.append('diagnostic')
                controller.cleanup = lambda: events.append('cleanup') or {'status':'cleaned_host_resources_S3_retained'}
                monitor = Mock()
                popen = Mock(return_value=monitor, side_effect=OSError('monitor unavailable') if fault == 'monitor' else None)
                with patch.object(sys, 'argv', ['operator','--execute-reviewed-run','--state','/scratch/state','--authorization','/scratch/authorization']), \
                     patch.object(op, 'validate_config', return_value=config), \
                     patch.object(op, 'bounded_json', side_effect=[config, authority]), \
                     patch.object(op, 'Cli', return_value=Mock()), \
                     patch.object(op.State, 'create', return_value=controller.state), \
                     patch.object(op, 'Operator', return_value=controller), \
                     patch.object(op.subprocess, 'Popen', popen), contextlib.redirect_stdout(io.StringIO()):
                    try: op.main()
                    except (op.OperatorError, OSError): self.assertNotEqual(fault, 'none')
                expected = [] if fault == 'monitor' else ['provision','result']
                if fault != 'none': expected.append('diagnostic')
                self.assertEqual(events, expected + ['cleanup'])
                popen.assert_called_once()


def lifecycle_functional_smoke():
    """Exercise final cleanup using actual isolated fake-CLI subprocesses."""
    import tempfile, json, contextlib, io
    outcomes = []
    for failed, cleanup_failed in ((False,False),(True,False),(True,True)):
        with tempfile.TemporaryDirectory(prefix='s09-final-lifecycle-') as directory:
            root = Path(directory); trace = root/'trace.jsonl'
            config = dict(op.FIXED)
            fake = root/'fake-aws'
            if cleanup_failed: (root/'cleanup-fault').touch()
            script = r'''#!/usr/bin/env python3
import json,sys,pathlib
root=pathlib.Path(__file__).parent
trace=root/'trace.jsonl'
args=sys.argv[1:]
action=next(x for x in ('get-console-output','describe-instances','terminate-instances','describe-volumes') if x in args)
with trace.open('a') as out: out.write(json.dumps(action)+'\n')
if action=='get-console-output':
 print(json.dumps({'Output':'PRIVATE_RAW_MUST_NOT_EXPORT\nS09_SSM_RECOVERY_V1 {"status":"failed","reason":"admission_unconfirmed","probes":2,"restarts":1}'}))
elif action=='terminate-instances':
 if (root/'cleanup-fault').exists(): sys.stderr.write('PRIVATE_CLEANUP_DETAIL');sys.exit(255)
 (root/'terminated').write_text('intent');print('{}')
elif action=='describe-instances':
 nfile=root/'reads'; n=int(nfile.read_text())+1 if nfile.exists() else 1;nfile.write_text(str(n))
 print(json.dumps({'Reservations':[{'Instances':[{'InstanceId':'i-ab','State':{'Name':'terminated' if n>=3 else 'shutting-down' if n==2 else 'running'},'Tags':[{'Key':'RunId','Value':RUN_ID},{'Key':'Purpose','Value':'synthetic-benchmark-only'}]}]}]}))
else: print(json.dumps({'Volumes':[]}))
'''
            fake.write_text(script.replace('RUN_ID', repr(config['run_id']))); fake.chmod(0o700)
            state = op.State.create(root/'state.json', {'resources':{'instance':'i-ab','root_volume':'vol-ab'},'deadline_ms':op.EXPIRY})
            controller = op.Operator(config, state, op.Cli(config, str(fake)), clock=lambda:op.EXPIRY-1000)
            def work():
                (root/'synthetic-result.json').write_text(json.dumps({'synthetic_fixture':True, 'failed':failed}))
                trace.write_text(json.dumps('result-export')+'\n')
                if failed: raise op.OperatorError('synthetic worker failure')
                return 'synthetic result'
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                try:
                    result = controller.run_lifecycle(work, sleep=lambda _:None)
                    assert not failed and result == 'synthetic result'
                except op.OperatorError as error:
                    assert failed and str(error) == 'synthetic worker failure'
                    if cleanup_failed: assert str(error.__cause__) == 'final cleanup failed; watchdog remains armed'
            calls = [json.loads(x) for x in trace.read_text().splitlines()]
            expected_cleanup=['describe-instances','terminate-instances'] if cleanup_failed else ['describe-instances','terminate-instances','describe-instances','describe-instances','describe-volumes']
            assert calls == ['result-export'] + (['get-console-output'] if failed else []) + expected_cleanup
            if cleanup_failed:
                assert state.data['lifecycle_cleanup_failure'] == {'work_failed':True,'cleanup_outcome':'unverified','watchdog_remains_armed':True}
                assert state.data.get('status') != 'cleaned_host_resources_S3_retained'
            else:
                assert state.data['status'] == 'cleaned_host_resources_S3_retained'
            assert 'PRIVATE_RAW_MUST_NOT_EXPORT' not in state.path.read_text()+output.getvalue()
            assert 'PRIVATE_CLEANUP_DETAIL' not in state.path.read_text()+output.getvalue()
            if not cleanup_failed: assert state.data['root_volume_absence_verified'] is True
            assert (root/'synthetic-result.json').is_file()
            outcomes.append({'scenario':'work_and_cleanup_failure' if cleanup_failed else 'failure' if failed else 'success','status':'PASS_fake_subprocess_only','events':calls,'termination_requests':calls.count('terminate-instances'),'S3_deletes':0})
    return outcomes

if __name__ == '__main__': unittest.main()
