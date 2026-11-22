"""Check the command partition without starting subprocesses or providers."""
from collections import Counter
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

import ci

STAGES = ('placement', 'python', 'rust', 'gnu', 'musl', 'promote')
ROOT = Path('/checkout')
REVISION = 'a' * 40

# Frozen from the serial inventory of base cfe049ae2 on Linux, with and without the
# local test/smoke pair, plus tools/test_ci.py and the #3090 promote check and its tests.
# Edit only for an intended CI command change.
SERIAL_LINUX_LOCAL = (
    ('placement', ('<PLACEMENT>',)),
    ('rust', ('<PYTHON>', 'tools/test_placement.py')),
    ('rust', ('<PYTHON>', 'tools/test_ci.py')),
    ('python', ('<PYTHON>', 'deploy/local/test_local.py')),
    ('python', ('<PYTHON>', 'tests/integration/test_shadow.py')),
    ('python', ('<PYTHON>', 'tests/integration/test_native_rollback.py')),
    ('python', ('<PYTHON>', 'tests/integration/test_native_suite.py')),
    ('python', ('<PYTHON>', 'tests/integration/test_release_recovery.py')),
    ('python', ('<PYTHON>', 'tests/integration/test_cutover_deadline.py')),
    ('python', ('<PYTHON>', 'tools/test_native_artifact.py')),
    ('python', ('<PYTHON>', 'tests/integration/test_paired_read.py')),
    ('python', ('<PYTHON>', 'tests/integration/test_shadow_simulation.py')),
    ('python', ('<PYTHON>', 'tests/integration/test_shadow_measured_simulation.py')),
    ('python', ('<PYTHON>', '-m', 'unittest', 'discover', '-s', 'tests/integration', '-p', 'test_rehearsal_*.py')),
    ('python', ('<PYTHON>', 'tests/integration/test_shadow_finish_staging.py')),
    ('python', ('<PYTHON>', 'tests/integration/test_shadow_finish_remote.py')),
    ('python', ('<PYTHON>', 'tests/integration/test_shadow_finish.py')),
    ('python', ('<PYTHON>', 'tests/integration/test_shadow_supervisor.py')),
    ('gnu', ('<PYTHON>', 'deploy/benchmark/run_isolated.py', 'safety')),
    ('gnu', ('<PYTHON>', 'deploy/benchmark/run_isolated.py', 'test_*.py')),
    ('gnu', ('<PYTHON>', 'deploy/benchmark/run_isolated.py', 'functional')),
    ('python', ('<PYTHON>', 'tests/integration/test_log_diagnosis.py')),
    ('gnu', ('<PYTHON>', 'deploy/benchmark/run_isolated.py', 'imds-functional')),
    ('gnu', ('<PYTHON>', 'deploy/benchmark/run_isolated.py', 'online-functional')),
    ('python', ('<PYTHON>', 'tools/test_verify_artifact.py')),
    ('python', ('<PYTHON>', 'tools/test_promote_artifact.py')),
    ('python', ('<PYTHON>', 'deploy/logging/test_logging.py')),
    ('python', ('<PYTHON>', 'tools/verification/test_kma_client_validation.py')),
    ('gnu', ('cargo', 'fmt', '--check')),
    ('gnu', ('cargo', 'clippy', '--locked', '--workspace', '--all-targets', '--', '-D', 'warnings')),
    ('rust', ('env', 'RUST_MIN_STACK=8388608', 'cargo', 'test', '--locked', '--workspace')),
    ('gnu', ('cargo', 'build', '--locked', '--release')),
    ('gnu', ('cargo', 'build', '--locked', '--release', '--example', 'loopback_server')),
    ('gnu', ('<PYTHON>', 'tools/smoke.py', '--binary', 'target/release/server2')),
    ('gnu', ('<PYTHON>', 'deploy/local/smoke.py', '--binary', 'target/release/server2')),
    ('gnu', ('cargo', 'build', '--locked', '--release', '--example', 'logging_smoke')),
    ('gnu', ('<PYTHON>', 'tools/logging_smoke.py', '--binary', 'target/release/server2', '--probe', 'target/release/examples/logging_smoke', '--out', '<ROOT>/reports/server2-logging/ci')),
    ('gnu', ('<PYTHON>', 'tools/gateway_smoke.py', '--binary', 'target/release/server2')),
    ('gnu', ('<PYTHON>', 'tools/widget_smoke.py', '--binary', 'target/release/server2', '--output', '<ROOT>/reports/server2-widget/ci')),
    ('gnu', ('cargo', 'build', '--locked', '--release', '--example', 'narrative_smoke')),
    ('gnu', ('<PYTHON>', 'tools/narrative_smoke.py', '--binary', 'target/release/examples/narrative_smoke', '--out', '<ROOT>/reports/server2-narrative/ci')),
    ('gnu', ('<PYTHON>', 'tools/kma_smoke.py', '--binary', 'target/release/server2')),
    ('gnu', ('cargo', 'build', '--locked', '--release', '--example', 'kma_checkpoint')),
    ('gnu', ('<PYTHON>', 'tools/kma_checkpoint.py', '--binary', 'target/release/examples/kma_checkpoint', '--rounds', '20', '--report', '<ROOT>/reports/server2-kma-checkpoint/ci.json')),
    ('gnu', ('bash', 'deploy/smoke.sh', '--binary', 'target/release/server2', '--skip-reused', '--out', '<ROOT>/reports/server2-smoke/ci')),
    ('gnu', ('cargo', 'build', '--locked', '--release', '--example', 'kma_s3_replay')),
    ('gnu', ('<PYTHON>', 'tools/shadow/replay.py', '--binary', 'target/release/server2', '--family', 'kma', '--self-check', '--report', '<ROOT>/reports/server2-kma-replay/ci.json')),
    ('gnu', ('<PYTHON>', 'tools/shadow/replay.py', '--binary', 'target/release/server2', '--family', 'kma-rich', '--self-check', '--report', '<ROOT>/reports/server2-kma-rich-replay/ci.json')),
    ('gnu', ('<PYTHON>', 'deploy/benchmark/run_isolated.py', 'manifest-functional')),
    ('musl', ('cargo', 'build', '--locked', '--release', '--target', 'x86_64-unknown-linux-musl')),
    ('musl', ('readelf', '-h', 'target/x86_64-unknown-linux-musl/release/server2')),
    ('musl', ('<PYTHON>', 'tools/verify_artifact.py', '--binary-dir', 'target/x86_64-unknown-linux-musl/release', '--output', '<ROOT>/reports/verification/server2-local-first/artifact-native', '--source-revision', '<REVISION>')),
    ('musl', ('<PYTHON>', 'tools/native_artifact.py', '--target-dir', 'target', '--output', '<ROOT>/reports/verification/server2-local-first/native-staging', '--archive', '<ROOT>/reports/verification/server2-local-first/artifact-native/native.tar.gz', '--source-revision', '<REVISION>')),
    ('promote', ('<PYTHON>', 'tools/promote_artifact.py', '--artifact', '<ROOT>/reports/verification/server2-local-first/artifact-native', '--source-revision', '<REVISION>')),
)

SERIAL_LINUX_NO_LOCAL = (
    ('placement', ('<PLACEMENT>',)),
    ('rust', ('<PYTHON>', 'tools/test_placement.py')),
    ('rust', ('<PYTHON>', 'tools/test_ci.py')),
    ('gnu', ('<PYTHON>', 'deploy/benchmark/run_isolated.py', 'safety')),
    ('python', ('<PYTHON>', 'tests/integration/test_shadow.py')),
    ('python', ('<PYTHON>', 'tests/integration/test_native_rollback.py')),
    ('python', ('<PYTHON>', 'tests/integration/test_native_suite.py')),
    ('python', ('<PYTHON>', 'tests/integration/test_release_recovery.py')),
    ('python', ('<PYTHON>', 'tests/integration/test_cutover_deadline.py')),
    ('python', ('<PYTHON>', 'tools/test_native_artifact.py')),
    ('python', ('<PYTHON>', 'tests/integration/test_paired_read.py')),
    ('python', ('<PYTHON>', 'tests/integration/test_shadow_simulation.py')),
    ('python', ('<PYTHON>', 'tests/integration/test_shadow_measured_simulation.py')),
    ('python', ('<PYTHON>', '-m', 'unittest', 'discover', '-s', 'tests/integration', '-p', 'test_rehearsal_*.py')),
    ('python', ('<PYTHON>', 'tests/integration/test_shadow_finish_staging.py')),
    ('python', ('<PYTHON>', 'tests/integration/test_shadow_finish_remote.py')),
    ('python', ('<PYTHON>', 'tests/integration/test_shadow_finish.py')),
    ('python', ('<PYTHON>', 'tests/integration/test_shadow_supervisor.py')),
    ('gnu', ('<PYTHON>', 'deploy/benchmark/run_isolated.py', 'test_*.py')),
    ('gnu', ('<PYTHON>', 'deploy/benchmark/run_isolated.py', 'functional')),
    ('gnu', ('<PYTHON>', 'deploy/benchmark/run_isolated.py', 'imds-functional')),
    ('python', ('<PYTHON>', 'tests/integration/test_log_diagnosis.py')),
    ('gnu', ('<PYTHON>', 'deploy/benchmark/run_isolated.py', 'online-functional')),
    ('python', ('<PYTHON>', 'tools/test_verify_artifact.py')),
    ('python', ('<PYTHON>', 'tools/test_promote_artifact.py')),
    ('python', ('<PYTHON>', 'deploy/logging/test_logging.py')),
    ('python', ('<PYTHON>', 'tools/verification/test_kma_client_validation.py')),
    ('gnu', ('cargo', 'fmt', '--check')),
    ('gnu', ('cargo', 'clippy', '--locked', '--workspace', '--all-targets', '--', '-D', 'warnings')),
    ('rust', ('env', 'RUST_MIN_STACK=8388608', 'cargo', 'test', '--locked', '--workspace')),
    ('gnu', ('cargo', 'build', '--locked', '--release')),
    ('gnu', ('cargo', 'build', '--locked', '--release', '--example', 'loopback_server')),
    ('gnu', ('<PYTHON>', 'tools/smoke.py', '--binary', 'target/release/server2')),
    ('gnu', ('cargo', 'build', '--locked', '--release', '--example', 'logging_smoke')),
    ('gnu', ('<PYTHON>', 'tools/logging_smoke.py', '--binary', 'target/release/server2', '--probe', 'target/release/examples/logging_smoke', '--out', '<ROOT>/reports/server2-logging/ci')),
    ('gnu', ('<PYTHON>', 'tools/gateway_smoke.py', '--binary', 'target/release/server2')),
    ('gnu', ('<PYTHON>', 'tools/widget_smoke.py', '--binary', 'target/release/server2', '--output', '<ROOT>/reports/server2-widget/ci')),
    ('gnu', ('cargo', 'build', '--locked', '--release', '--example', 'narrative_smoke')),
    ('gnu', ('<PYTHON>', 'tools/narrative_smoke.py', '--binary', 'target/release/examples/narrative_smoke', '--out', '<ROOT>/reports/server2-narrative/ci')),
    ('gnu', ('<PYTHON>', 'tools/kma_smoke.py', '--binary', 'target/release/server2')),
    ('gnu', ('cargo', 'build', '--locked', '--release', '--example', 'kma_checkpoint')),
    ('gnu', ('<PYTHON>', 'tools/kma_checkpoint.py', '--binary', 'target/release/examples/kma_checkpoint', '--rounds', '20', '--report', '<ROOT>/reports/server2-kma-checkpoint/ci.json')),
    ('gnu', ('bash', 'deploy/smoke.sh', '--binary', 'target/release/server2', '--skip-reused', '--out', '<ROOT>/reports/server2-smoke/ci')),
    ('gnu', ('cargo', 'build', '--locked', '--release', '--example', 'kma_s3_replay')),
    ('gnu', ('<PYTHON>', 'tools/shadow/replay.py', '--binary', 'target/release/server2', '--family', 'kma', '--self-check', '--report', '<ROOT>/reports/server2-kma-replay/ci.json')),
    ('gnu', ('<PYTHON>', 'tools/shadow/replay.py', '--binary', 'target/release/server2', '--family', 'kma-rich', '--self-check', '--report', '<ROOT>/reports/server2-kma-rich-replay/ci.json')),
    ('gnu', ('<PYTHON>', 'deploy/benchmark/run_isolated.py', 'manifest-functional')),
    ('musl', ('cargo', 'build', '--locked', '--release', '--target', 'x86_64-unknown-linux-musl')),
    ('musl', ('readelf', '-h', 'target/x86_64-unknown-linux-musl/release/server2')),
    ('musl', ('<PYTHON>', 'tools/verify_artifact.py', '--binary-dir', 'target/x86_64-unknown-linux-musl/release', '--output', '<ROOT>/reports/verification/server2-local-first/artifact-native', '--source-revision', '<REVISION>')),
    ('musl', ('<PYTHON>', 'tools/native_artifact.py', '--target-dir', 'target', '--output', '<ROOT>/reports/verification/server2-local-first/native-staging', '--archive', '<ROOT>/reports/verification/server2-local-first/artifact-native/native.tar.gz', '--source-revision', '<REVISION>')),
    ('promote', ('<PYTHON>', 'tools/promote_artifact.py', '--artifact', '<ROOT>/reports/verification/server2-local-first/artifact-native', '--source-revision', '<REVISION>')),
)


def expected_serial(platform, has_local_pair):
    """Darwin drops only the Linux musl and promote groups; nothing is regenerated from ci.py."""
    inventory = SERIAL_LINUX_LOCAL if has_local_pair else SERIAL_LINUX_NO_LOCAL
    return [(group, [arg.replace('<PYTHON>', sys.executable).replace('<ROOT>', str(ROOT))
                     .replace('<REVISION>', REVISION) for arg in command])
            for group, command in inventory if platform == 'linux' or group not in ('musl', 'promote')]


class CommandPlanTests(unittest.TestCase):
    def test_parallel_jobs_cover_the_frozen_serial_inventory_once(self):
        event = {'pull_request': {'head': {'sha': REVISION}}}
        for platform in ('linux', 'darwin'):
            for has_local_pair in (False, True):
                with (self.subTest(platform=platform, has_local_pair=has_local_pair),
                      patch.object(ci, 'placement_command', return_value=['<PLACEMENT>']) as placement,
                      patch.object(sys, 'platform', platform),
                      patch.object(Path, 'is_file', return_value=has_local_pair)):
                    expected = expected_serial(platform, has_local_pair)
                    self.assertEqual(expected, list(ci.command_plan(ROOT, event, 'all')))
                    actual = []
                    for stage in STAGES:
                        selected = [(group, cmd) for group, cmd in ci.command_plan(ROOT, event, stage)
                                    if group == stage]
                        self.assertEqual([item for item in expected if item[0] == stage], selected)
                        actual += selected
                    self.assertEqual(2, placement.call_count)
                    counts = Counter((group, tuple(cmd)) for group, cmd in actual)
                    self.assertEqual(Counter((group, tuple(cmd)) for group, cmd in expected), counts)
                    self.assertTrue(all(count == 1 for count in counts.values()))

    def test_missing_local_test_or_smoke_fails_closed(self):
        for outcomes in ([True, False], [False, True]):
            with (patch.object(Path, 'is_file', side_effect=outcomes),
                  self.assertRaisesRegex(SystemExit, 'paired local tests')):
                list(ci.command_plan(ROOT, {}, 'python'))

    def test_unknown_stage_and_empty_stage_are_rejected(self):
        for argv, platform in ((['ci.py', 'shadow'], 'linux'), (['ci.py', 'musl'], 'darwin'),
                               (['ci.py', 'promote'], 'darwin')):
            with (self.subTest(argv=argv, platform=platform),
                  patch.object(sys, 'argv', argv), patch.object(sys, 'platform', platform),
                  patch.object(ci, 'placement_command', return_value=['<PLACEMENT>']),
                  patch.object(Path, 'is_file', return_value=True),
                  patch.object(ci.os, 'chdir'),
                  patch.object(ci.subprocess, 'run') as run,
                  patch('sys.stderr'),
                  self.assertRaises(SystemExit) as raised):
                ci.main()
            self.assertEqual(2, raised.exception.code)
            run.assert_not_called()

    def test_prepare_rejects_an_unknown_stage_before_installing(self):
        result = subprocess.run(['bash', str(Path(__file__).with_name('prepare-ci.sh')), 'shadow'],
                                capture_output=True, text=True, env={'PATH': '/usr/bin:/bin'})
        self.assertEqual(2, result.returncode)
        self.assertIn('Unknown Server2 CI stage: shadow', result.stderr)


if __name__ == '__main__':
    unittest.main()
