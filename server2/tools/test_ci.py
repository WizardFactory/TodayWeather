"""Check the command partition without starting subprocesses or providers."""
from collections import Counter
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import ci


class CommandPlanTests(unittest.TestCase):
    def test_parallel_jobs_cover_serial_commands_once(self):
        root = Path('/checkout')
        declaration = [sys.executable, 'tools/check_placement.py']
        stages = ('placement', 'python', 'rust', 'gnu', 'musl')
        sha = 'a' * 40
        event = {'pull_request': {'head': {'sha': sha}}}
        for platform in ('linux', 'darwin'):
            for has_local_pair in (False, True):
                with (self.subTest(platform=platform, has_local_pair=has_local_pair),
                      patch.object(ci, 'placement_command', return_value=declaration) as placement,
                      patch.object(sys, 'platform', platform),
                      patch.object(Path, 'is_file', return_value=has_local_pair)):
                    serial = list(ci.command_plan(root, event, 'all'))
                    actual = {}
                    for stage in stages:
                        actual[stage] = [cmd for group, cmd in ci.command_plan(root, event, stage)
                                         if group == stage]
                        self.assertEqual([cmd for group, cmd in serial if group == stage],
                                         actual[stage])
                    self.assertEqual(2, placement.call_count)
                    expected = Counter(tuple(cmd) for _, cmd in serial)
                    self.assertEqual(expected, Counter(tuple(cmd) for cmds in actual.values()
                                                       for cmd in cmds))
                    self.assertTrue(all(count == 1 for count in expected.values()))
                    self.assertIn([sys.executable, 'tests/integration/test_shadow_simulation.py'],
                                  actual['python'])
                    self.assertIn([sys.executable, 'tests/integration/test_shadow_supervisor.py'],
                                  actual['python'])
                    self.assertIn(['env', 'RUST_MIN_STACK=8388608', 'cargo',
                                   'test', '--locked', '--workspace'], actual['rust'])
                    self.assertIn([sys.executable, 'deploy/benchmark/run_isolated.py',
                                   'manifest-functional'], actual['gnu'])
                    if platform == 'linux':
                        self.assertEqual(4, len(actual['musl']))
                        self.assertEqual(['--source-revision', sha], actual['musl'][-1][-2:])
                    else:
                        self.assertEqual([], actual['musl'])

    def test_missing_local_test_or_smoke_fails_closed(self):
        for outcomes in ([True, False], [False, True]):
            with (patch.object(Path, 'is_file', side_effect=outcomes),
                  self.assertRaisesRegex(SystemExit, 'paired local tests')):
                list(ci.command_plan(Path('/checkout'), {}, 'python'))


if __name__ == '__main__':
    unittest.main()
