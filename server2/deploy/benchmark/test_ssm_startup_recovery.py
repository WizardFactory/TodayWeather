"""Local-only startup recovery regression tests. No real system/network calls."""
import os
from pathlib import Path
assert os.environ.get('S09_ISOLATED') == '1' and not Path('/sys').exists(), 'use run_isolated.py; no host execution'
import importlib.util
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent

class RecoveryTests(unittest.TestCase):
    def load(self):
        path = HERE / 'ssm_startup_recovery.py'
        self.assertTrue(path.is_file(), 'bounded pre-Online recovery is missing')
        spec = importlib.util.spec_from_file_location('recovery', path)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_closed_https_is_retried_before_one_restart_then_admission_timeout(self):
        recovery = self.load()
        events = []
        current = [0]
        probes = [False, True]
        def probe():
            events.append('probe')
            return probes.pop(0)
        def sleep(seconds): current[0] += seconds
        status = recovery.recover(lambda: events.append('guard'), probe,
            lambda: events.append('restart'), lambda: False, events.append,
            clock=lambda: current[0], sleep=sleep)
        self.assertEqual(status, 1)
        self.assertEqual(events.count('restart'), 1)
        self.assertLess(events.index('probe'), events.index('restart'))
        self.assertEqual(events[-1]['reason'], 'admission_unconfirmed')
        self.assertLessEqual(current[0], 5 + recovery.ADMISSION_SECONDS)
        for index, event in enumerate(events):
            if event in ('probe', 'restart'): self.assertEqual(events[index-1], 'guard')

    def test_guard_failure_is_sanitized_and_never_dispatches(self):
        recovery = self.load()
        events = []
        def guard(): raise RuntimeError('SECRET credential sentinel')
        try:
            result = recovery.recover(guard, lambda: events.append('probe'),
                lambda: events.append('restart'), lambda: False, events.append,
                clock=lambda: 0, sleep=lambda _: None)
        except RuntimeError:
            result = 'unsanitized_exception'
        self.assertEqual(result, 1)
        self.assertEqual(events, [{'status': 'failed', 'reason': 'guard_or_local_failure', 'probes': 0, 'restarts': 0}])

    def test_backwards_clock_denies_restart(self):
        recovery = self.load()
        events = []
        ticks = iter([10, 9])
        try:
            result = recovery.recover(lambda: None, lambda: events.append('probe'),
                lambda: events.append('restart'), lambda: False, events.append,
                clock=lambda: next(ticks), sleep=lambda _: None)
        except StopIteration:
            result = 'clock_not_fenced'
        self.assertEqual(result, 1)
        self.assertEqual(events[-1]['reason'], 'guard_or_local_failure')
        self.assertNotIn('probe', events)

    def test_stock_adapter_uses_only_fixed_tls_endpoints_and_bounded_commands(self):
        from unittest.mock import Mock
        recovery = self.load()
        self.assertTrue(hasattr(recovery, 'https_ready'), 'stock HTTPS adapter missing')
        calls = []
        def run(argv, **kwargs):
            calls.append((argv, kwargs))
            return Mock(returncode=0)
        self.assertTrue(recovery.https_ready(run=run))
        self.assertEqual(len(calls), 1)
        argv, options = calls[0]
        self.assertEqual(options['timeout'], 8)
        self.assertIn('ssm.ap-northeast-2.amazonaws.com', argv[-1])
        self.assertIn('ssmmessages.ap-northeast-2.amazonaws.com', argv[-1])
        for forbidden in ('169.254', 'recv(', 'http://', 'curl', 'verify=False'):
            self.assertNotIn(forbidden, argv[-1])
        self.assertTrue(hasattr(recovery, 'host_guard'), 'fresh host guard adapter missing')
        quotas = {'nftables': [{'quota': {'name': name, 'bytes': cap, 'used': 1}}
            for name, cap in [('global_rx', 30064771072), ('bootstrap_rx', 2147483648)]]}
        def stock(argv, **kwargs):
            import json
            calls.append((argv, kwargs))
            return Mock(returncode=0, stdout=json.dumps(quotas).encode())
        recovery.host_guard(100, run=stock, wall=lambda: 99)
        for argv, options in calls:
            self.assertLessEqual(options['timeout'], 8)
        quotas['nftables'][1]['quota']['used'] = 2147483648
        with self.assertRaises(ValueError): recovery.host_guard(100, run=stock, wall=lambda: 99)
        with self.assertRaises(ValueError): recovery.host_guard(100, run=stock, wall=lambda: 100)
        quotas['nftables'][1]['quota']['used'] = 1
        ticks = iter([99, 100])
        try:
            recovery.host_guard(100, run=stock, wall=lambda: next(ticks))
        except ValueError:
            rejected = True
        else:
            rejected = False
        self.assertTrue(rejected, 'readback must not admit a probe after absolute expiry')

    def test_entrypoint_failure_prints_only_enums_without_poweroff(self):
        import contextlib, io, json
        from unittest.mock import Mock
        recovery = self.load()
        self.assertTrue(hasattr(recovery, 'main'), 'host entrypoint missing')
        calls = []
        def run(argv, **kwargs):
            calls.append(argv)
            return Mock(returncode=1, stdout=b'PRIVATE raw log credential')
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = recovery.main(['--unit', recovery.UNITS[0], '--role', recovery.ROLE, '--deadline-ms', '100000'],
                                 run=run, wall=lambda: 1)
        self.assertEqual(code, 1)
        self.assertEqual(calls, [['systemctl', 'is-active', '--quiet', 'server2-s09-expiry.timer']])
        self.assertNotIn('PRIVATE', output.getvalue())
        self.assertTrue(output.getvalue().startswith('S09_SSM_RECOVERY_V1 '))
        self.assertEqual(json.loads(output.getvalue().split(' ',1)[1])['reason'], 'guard_or_local_failure')

    def test_readiness_deadline_cannot_be_crossed_by_a_slow_probe(self):
        recovery = self.load()
        events = []
        current = [0]
        def probe():
            current[0] = recovery.READINESS_SECONDS + 1
            return True
        code = recovery.recover(lambda: None, probe, lambda: events.append('restart'),
            lambda: True, events.append, clock=lambda: current[0], sleep=lambda _: None)
        self.assertEqual(code, 1)
        self.assertNotIn('restart', events)
        self.assertEqual(events[-1]['reason'], 'transport_or_role_unavailable')

class DiagnosticsTests(unittest.TestCase):
    def operator(self):
        spec = importlib.util.spec_from_file_location('candidate_operator', HERE / 'aws_operator.py')
        assert spec is not None and spec.loader is not None
        op = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(op)
        return op

    def test_failed_online_admission_captures_only_allowlisted_console_diagnostics(self):
        import contextlib, io, json
        from unittest.mock import Mock, patch
        op = self.operator()
        self.assertTrue(hasattr(op.Operator, 'capture_admission_diagnostics'), 'failed admission diagnostic export missing')
        current = [op.EXPIRY-600000]
        state = Mock(data={'resources': {'instance': 'i-ab', 'sg': 'sg-ab'},
                           'deadline_ms': op.EXPIRY, 'worker_allocation_issued': False})
        controller = op.Operator(dict(op.FIXED), state, Mock(), clock=lambda: current[0])
        controller.verify_host_root = lambda: None
        controller.open_https_after_guard = lambda _: None
        actions = []
        record = {'status':'restarted', 'reason':'transport_and_role_ready', 'probes':36, 'restarts':1}
        from test_online_window import install_ready_fixture
        ready=install_ready_fixture(controller)
        def call(service, action, args):
            actions.append(action)
            if action == 'get-console-output':
                if actions.count(action) <= 2: return ready
                return {'Output': 'RAW PRIVATE SENTINEL\nS09_SSM_RECOVERY_V1 '+json.dumps(record)+'\nS09_SSM_RECOVERY_V1 '+json.dumps(dict(record, secret='DO_NOT_EXPORT'))}
            if action == 'describe-instance-information':
                current[0] += op.SSM_ONLINE_SECONDS*1000+1
                return {'InstanceInformationList': []}
            self.fail('unexpected AWS or RunCommand dispatch')
        controller.call = call
        output = io.StringIO()
        with patch.object(op.time, 'sleep', lambda _: None), contextlib.redirect_stdout(output):
            with self.assertRaisesRegex(op.OperatorError, 'SSM Online unavailable; no widening'):
                controller.run_host()
        self.assertEqual(state.data['ssm_admission_diagnostics']['recovery'], [record])
        self.assertFalse(state.data['worker_allocation_issued'])
        self.assertEqual(actions, ['get-console-output', 'get-console-output', 'describe-instance-information', 'get-console-output'])
        self.assertNotIn('SENTINEL', output.getvalue())
        self.assertNotIn('DO_NOT_EXPORT', output.getvalue())

    def test_supervisor_reports_unknown_not_invented_restart_counts(self):
        op = self.operator()
        template = (HERE/'cloud-init.yml').read_text()
        self.assertIn('"reason":"supervisor_timeout_or_failure","probes":null,"restarts":null', template)

if __name__ == '__main__': unittest.main()
