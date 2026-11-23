#!/usr/bin/env python3
"""Check the independent rehearsal stop instruction without touching systemd."""

from pathlib import Path
from types import SimpleNamespace
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'deploy' / 'shadow'))
from rehearsal_deadline import arm_stop


class RehearsalDeadlineTests(unittest.TestCase):
    def test_arms_existing_stop_service_at_absolute_boot_time(self):
        calls = []
        def run(*args, **kwargs):
            calls.append((args, kwargs))
            stdout = 'active\n' if args[:2] == ('systemctl', 'show') else ''
            return SimpleNamespace(returncode=0, stdout=stdout)

        deadline = arm_stop('sr6-rehearsal', start_monotonic=250, boottime=lambda: 246.1, run=run)
        self.assertEqual(deadline, 86650)
        self.assertIn('--on-boot=86650s', calls[0][0])
        self.assertIn('--timer-property=WakeSystem=true', calls[0][0])
        self.assertEqual(calls[0][0][-4:], ('/usr/bin/systemctl', '--no-block', 'start',
                                           'server2-shadow-sr6-rehearsal-stop.service'))
        self.assertEqual(calls[1][0][-1], 'server2-shadow-sr6-rehearsal-deadline.timer')

    def test_rejects_already_started_clock_and_untrusted_run_id(self):
        def no_run(*args, **kwargs):
            self.fail('systemd must not be invoked')
        for run_id, at in (('sr6-rehearsal', 246), ('../bad', 250)):
            with self.subTest(run_id=run_id, at=at), self.assertRaises(ValueError):
                arm_stop(run_id, start_monotonic=at, boottime=lambda: 246, run=no_run)

    def test_inactive_stop_timer_refuses_readiness(self):
        def run(*args, **kwargs):
            return SimpleNamespace(returncode=0, stdout='inactive\n')
        with self.assertRaisesRegex(ValueError, 'timer is inactive'):
            arm_stop('sr6-rehearsal', start_monotonic=250, boottime=lambda: 246.1, run=run)


if __name__ == '__main__':
    unittest.main()
