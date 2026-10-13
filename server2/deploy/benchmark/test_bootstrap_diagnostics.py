"""Bounded bootstrap evidence; run only with the maintained sandbox launcher."""
import os
from pathlib import Path
assert os.environ.get('S09_ISOLATED') == '1' and not Path('/sys').exists(), 'use run_isolated.py'
import importlib
import json
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent

class DiagnosticsTests(unittest.TestCase):
    def helper(self):
        self.assertTrue((HERE/'bootstrap_diagnostics.py').is_file(), 'maintained sanitizer missing')
        return importlib.import_module('bootstrap_diagnostics')

    def test_only_allowlisted_signals_leave_private_logs(self):
        d = self.helper()
        with tempfile.TemporaryDirectory() as directory, patch.object(d, 'PRIVATE', directory):
            root = Path(directory)
            (root/'bootstrap-stage').write_text('rustup_download\n')
            (root/'bootstrap.log').write_bytes(b'curl: (22) secret-token https://secret.invalid\nFileNotFoundError: /secret/key\nprivate-password\n')
            (root/'host-build.log').write_text('error[E0432]: secret-source\n')
            record = d.collect()
            self.assertEqual(record['stage'], 'rustup_download')
            self.assertEqual(record['logs']['bootstrap.log']['signals'], ['FileNotFoundError', 'curl:22'])
            self.assertEqual(record['logs']['host-build.log']['signals'], ['rust:E0432'])
            self.assertEqual(record['logs']['bootstrap.log']['sample_bytes'], 95)
            self.assertNotIn('secret', json.dumps(record))
            self.assertNotIn('private-password', json.dumps(record))
            self.assertLess(len(json.dumps(record)), 4096)
            self.assertEqual(record['logs']['bootstrap.log']['withheld_lines'], 3)

    def test_apt_and_cargo_json_error_signals_are_finite(self):
        d = self.helper()
        with tempfile.TemporaryDirectory() as directory, patch.object(d, 'PRIVATE', directory):
            Path(directory, 'bootstrap.log').write_text('E: Unable to locate package secret\nE: Failed to fetch https://secret\n')
            Path(directory, 'host-build.log').write_text('{"reason":"compiler-message","message":{"level":"error","code":{"code":"E0432"},"rendered":"secret"}}\n')
            record = d.collect()
            self.assertEqual(record['logs']['bootstrap.log']['signals'], ['apt_fetch_failed', 'apt_package_missing'])
            self.assertEqual(record['logs']['host-build.log']['signals'], ['rust:E0432'])
            self.assertIn('controller_start', d.STAGES)
            self.assertNotIn('secret', json.dumps(record))

    def test_stage_markers_cover_each_bootstrap_boundary(self):
        d = self.helper()
        text = (HERE/'cloud-init.yml').read_text().split('    content: |', 1)[1]
        positions = [text.find('stage '+stage+'\n') for stage in d.STAGES]
        self.assertTrue(all(pos >= 0 for pos in positions), positions)
        self.assertEqual(positions, sorted(positions))

    def test_controller_decoder_accepts_only_exact_safe_schema(self):
        d = self.helper()
        self.assertTrue(hasattr(d, 'decode'), 'strict controller decoder missing')
        with tempfile.TemporaryDirectory() as directory, patch.object(d, 'PRIVATE', directory):
            Path(directory, 'bootstrap.log').write_text('AssertionError: secret\n')
            good = d.collect()
            self.assertEqual(d.decode(d.PREFIX+json.dumps(good)), good)
            for bad in ('secret', d.PREFIX+'{"secret":"key"}', d.PREFIX+'{',
                        d.PREFIX+json.dumps(good)+'\n'+d.PREFIX+json.dumps(good),
                        'x'*24001, d.PREFIX+json.dumps(dict(good, stage='secret'))):
                self.assertEqual(d.decode(bad), {'status': 'unavailable'})
            good['logs']['bootstrap.log']['signals'] = ['secret']
            self.assertEqual(d.decode(d.PREFIX+json.dumps(good)), {'status': 'unavailable'})

    def test_bounded_missing_symlink_and_malformed_logs(self):
        d = self.helper()
        with tempfile.TemporaryDirectory() as directory, patch.object(d, 'PRIVATE', directory):
            root = Path(directory)
            self.assertEqual(d.collect()['logs']['bootstrap.log'], {'status': 'unavailable'})
            (root/'bootstrap-stage').write_bytes(b'private-secret'*100)
            (root/'bootstrap.log').write_bytes(b'private-secret'*10000+b'\xff\nAssertionError\n')
            (root/'host-build.log').symlink_to(root/'bootstrap.log')
            row = d.collect()
            self.assertEqual(row['stage'], 'unavailable')
            self.assertTrue(row['logs']['bootstrap.log']['truncated'])
            self.assertEqual(row['logs']['bootstrap.log']['sample_bytes'], 8192)
            self.assertEqual(row['logs']['host-build.log'], {'status': 'unavailable'})
            self.assertNotIn('secret', json.dumps(row))
            (root/'host-build.log').unlink()
            os.mkfifo(root/'host-build.log')
            self.assertEqual(d.collect()['logs']['host-build.log'], {'status': 'unavailable'})

class ControllerTests(unittest.TestCase):
    def test_success_valid_failure_preemption_and_persistence_failure(self):
        import aws_operator as op
        import bootstrap_diagnostics as d
        from test_user_data_wire import controller
        for status, output, failing_save in [('Success', None, False), ('Failed', None, False),
                ('TimedOut', '', False), ('Failed', '{secret}', True)]:
            with self.subTest(status=status, save=failing_save), tempfile.TemporaryDirectory() as directory:
                c = controller(directory, None)
                c.state.data['resources'] = {'instance': 'i-offline'}
                with patch.object(d, 'PRIVATE', directory):
                    Path(directory, 'bootstrap.log').write_text('AssertionError: secret\n')
                    good = d.collect()
                calls = []
                def call(service, action, args):
                    calls.append(action)
                    if action == 'send-command': return {'Command': {'CommandId': 'a'*36}}
                    return {'Status': status, 'ResponseCode': 0 if status == 'Success' else 1,
                        'StandardOutputContent': d.PREFIX+json.dumps(good) if output is None else output}
                c.call = call
                if failing_save:
                    c.state.save = lambda: (_ for _ in ()).throw(OSError('secret'))
                if status == 'Success': c.ssm(['fixture'], bootstrap=True)
                else:
                    with self.assertRaisesRegex(op.OperatorError, '^SSM task failed$'):
                        c.ssm(['fixture'], bootstrap=True)
                expected = good if output is None else {'status': 'unavailable'}
                self.assertEqual(c.state.data['bootstrap_diagnostics']['diagnostics'], expected)
                self.assertEqual(calls, ['send-command', 'get-command-invocation'])

    def test_no_response_deadline_and_poll_failure_never_collect_again(self):
        import aws_operator as op
        from test_user_data_wire import controller
        for mode in ('deadline', 'poll_failure', 'send_failure'):
            with tempfile.TemporaryDirectory() as directory:
                c = controller(directory, None)
                c.state.data['resources'] = {'instance': 'i-offline'}
                calls = []
                def call(service, action, args):
                    calls.append(action)
                    if mode == 'send_failure' or action != 'send-command': raise op.OperatorError('offline failure')
                    return {'Command': {'CommandId': 'a'*36}}
                c.call = call
                if mode == 'deadline': c.clock = lambda: op.EXPIRY
                with self.assertRaises(op.OperatorError): c.ssm(['fixture'], bootstrap=True)
                record = c.state.data['bootstrap_diagnostics']
                self.assertEqual(record['diagnostics'], {'status': 'unavailable'})
                self.assertEqual(len(calls), 2 if mode == 'poll_failure' else 1)

    def test_wrapper_source_pin_and_inner_timeout_margin(self):
        import aws_operator as op
        from test_user_data_wire import controller
        with tempfile.TemporaryDirectory() as directory:
            c = controller(directory, None)
            text = c.bootstrap_command()
            self.assertIn('timeout -k 2 2070 ', text)
            self.assertIn('timeout -k 2 20 python3', text)
            self.assertIn('exit "$rc"', text)
            self.assertIn((HERE/'bootstrap_diagnostics.py').read_text(), text)
            self.assertLess(len(text.encode()), 12000)
            c.config['source_files']['server2/deploy/benchmark/bootstrap_diagnostics.py'] = '0'*64
            with self.assertRaisesRegex(op.OperatorError, 'source pin'): c.bootstrap_command()


    def test_failed_ssm_preserves_sanitized_record_before_cleanup(self):
        import aws_operator as op
        from test_user_data_wire import controller
        with tempfile.TemporaryDirectory() as directory:
            instance = controller(directory, None)
            instance.state.data['resources'] = {'instance': 'i-offline'}
            events = []
            command_id = 'a'*8+'-'+'a'*4+'-'+'a'*4+'-'+'a'*4+'-'+'a'*12
            def call(service, action, args):
                events.append(action)
                if action == 'send-command': return {'Command': {'CommandId': command_id}}
                if action == 'get-command-invocation':
                    return {'Status': 'Failed', 'ResponseCode': 17,
                            'StandardOutputContent': 'private-secret', 'StandardErrorContent': 'secret-key'}
                self.fail('unexpected call')
            instance.call = call
            instance.capture_admission_diagnostics = lambda **kw: None
            def cleanup():
                saved = json.loads(instance.state.path.read_text())
                record = saved.get('bootstrap_diagnostics')
                self.assertIsNotNone(record, 'failure diagnostics missing before cleanup')
                self.assertEqual(record['command_id'], command_id)
                self.assertEqual(record['Status'], 'Failed')
                self.assertEqual(record['ResponseCode'], 17)
                self.assertEqual(record['diagnostics'], {'status': 'unavailable'})
                self.assertNotIn('secret', json.dumps(saved))
                events.append('cleanup')
                return {'status': 'cleaned_host_resources_S3_retained'}
            instance.cleanup = cleanup
            self.assertTrue(hasattr(instance, 'bootstrap_command'), 'source-bound wrapper missing')
            with self.assertRaisesRegex(op.OperatorError, '^SSM task failed$'):
                instance.run_lifecycle(lambda: instance.ssm([instance.bootstrap_command()], seconds=2100, bootstrap=True))
            self.assertEqual(events, ['send-command', 'get-command-invocation', 'cleanup'])

if __name__ == '__main__': unittest.main()
