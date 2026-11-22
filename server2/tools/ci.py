#!/usr/bin/env python3
"""CI logic stays under server2; exact PR/push range, full tracked placement."""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


def output(*args):
    return subprocess.check_output(args, text=True).strip()


def pull_request_base(event):
    request = event['pull_request']
    merge_ref = f"refs/pull/{event.get('number')}/merge"
    if os.environ.get('GITHUB_REF') != merge_ref:
        return request['base']['sha']

    # The runner's merge ref can advance between event creation and checkout.
    # Use the target parent of the merge tree we are actually checking.
    checkout = output('git', 'rev-list', '--parents', '-n', '1', 'HEAD').split()
    if (len(checkout) != 3 or checkout[0] != os.environ.get('GITHUB_SHA')
            or checkout[2] != request['head']['sha']):
        raise SystemExit('PR merge checkout does not match the GitHub event head')
    return checkout[1]


def placement_command(event):
    if 'pull_request' in event:
        base=pull_request_base(event)
    elif event.get('before') and set(event['before']) != {'0'}:
        base=event['before']
    elif os.environ.get('SERVER2_BASE'):
        base=os.environ['SERVER2_BASE']
    else:
        default=event.get('repository',{}).get('default_branch','master')
        base=output('git','merge-base','HEAD',f'origin/{default}')
    changed=output('git','diff','--relative','--name-only',base,'--','config/tasks/*.json').splitlines()
    declared=[Path(p) for p in changed if Path(p).exists()]
    if not declared:
        # Explicit local/dispatch input is needed when no task declaration was modified.
        provided=os.environ.get('SERVER2_DECLARATION')
        if not provided: raise SystemExit('no changed task declaration; set SERVER2_DECLARATION for a reviewed task')
        declared=[Path(provided)]
    if len(declared)!=1: raise SystemExit('one reviewed task declaration is required per PR')
    return [sys.executable, 'tools/check_placement.py', '--root', '..',
            '--declaration', str(declared[0]), '--base', base]


def command_plan(root, event, stage):
    python = sys.executable
    if stage in ('all', 'placement'):
        yield 'placement', placement_command(event)
    if stage == 'placement':
        return

    local_tests = Path('deploy/local/test_local.py').is_file()
    if local_tests != Path('deploy/local/smoke.py').is_file():
        raise SystemExit('S03 requires paired local tests and integrated smoke')

    # Keep the original serial order for local callers. Hosted stages select
    # their commands from this same inventory.
    safety = ('gnu', [python, 'deploy/benchmark/run_isolated.py', 'safety'])
    log_diagnosis = ('python', [python, 'tests/integration/test_log_diagnosis.py'])
    yield 'rust', [python, 'tools/test_placement.py']
    yield 'rust', [python, 'tools/test_ci.py']
    if local_tests:
        yield 'python', [python, 'deploy/local/test_local.py']
    else:
        yield safety

    yield from [
        ('python', [python, 'tests/integration/test_shadow.py']),
        ('python', [python, 'tests/integration/test_native_rollback.py']),
        ('python', [python, 'tests/integration/test_native_suite.py']),
        ('python', [python, 'tests/integration/test_release_recovery.py']),
        ('python', [python, 'tests/integration/test_cutover_deadline.py']),
        ('python', [python, 'tools/test_native_artifact.py']),
        ('python', [python, 'tests/integration/test_paired_read.py']),
        ('python', [python, 'tests/integration/test_shadow_simulation.py']),
        ('python', [python, 'tests/integration/test_shadow_finish_staging.py']),
        ('python', [python, 'tests/integration/test_shadow_finish_remote.py']),
        ('python', [python, 'tests/integration/test_shadow_finish.py']),
        ('python', [python, 'tests/integration/test_shadow_supervisor.py']),
        *([safety] if local_tests else []),
        ('gnu', [python, 'deploy/benchmark/run_isolated.py', 'test_*.py']),
        ('gnu', [python, 'deploy/benchmark/run_isolated.py', 'functional']),
        *([log_diagnosis] if local_tests else []),
        ('gnu', [python, 'deploy/benchmark/run_isolated.py', 'imds-functional']),
        *([] if local_tests else [log_diagnosis]),
        ('gnu', [python, 'deploy/benchmark/run_isolated.py', 'online-functional']),
        ('python', [python, 'tools/test_verify_artifact.py']),
        ('python', [python, 'deploy/logging/test_logging.py']),
        ('python', [python, 'tools/verification/test_kma_client_validation.py']),
        ('gnu', ['cargo', 'fmt', '--check']),
        ('gnu', ['cargo', 'clippy', '--locked', '--workspace', '--all-targets', '--', '-D', 'warnings']),
        # The full KMA snapshot can exceed the default debug test thread stack.
        ('rust', ['env', 'RUST_MIN_STACK=8388608', 'cargo', 'test', '--locked', '--workspace']),
        ('gnu', ['cargo', 'build', '--locked', '--release']),
        ('gnu', ['cargo', 'build', '--locked', '--release', '--example', 'loopback_server']),
        ('gnu', [python, 'tools/smoke.py', '--binary', 'target/release/server2']),
    ]
    if local_tests:
        yield 'gnu', [python, 'deploy/local/smoke.py', '--binary', 'target/release/server2']
    yield from [
        ('gnu', ['cargo', 'build', '--locked', '--release', '--example', 'logging_smoke']),
        ('gnu', [python, 'tools/logging_smoke.py', '--binary', 'target/release/server2', '--probe',
                 'target/release/examples/logging_smoke',
                 '--out', str(root / 'reports/server2-logging/ci')]),
        ('gnu', [python, 'tools/gateway_smoke.py', '--binary', 'target/release/server2']),
        ('gnu', [python, 'tools/widget_smoke.py', '--binary', 'target/release/server2', '--output',
                 str(root / 'reports/server2-widget/ci')]),
        ('gnu', ['cargo', 'build', '--locked', '--release', '--example', 'narrative_smoke']),
        ('gnu', [python, 'tools/narrative_smoke.py', '--binary', 'target/release/examples/narrative_smoke',
                 '--out', str(root / 'reports/server2-narrative/ci')]),
        ('gnu', [python, 'tools/kma_smoke.py', '--binary', 'target/release/server2']),
        ('gnu', ['cargo', 'build', '--locked', '--release', '--example', 'kma_checkpoint']),
        ('gnu', [python, 'tools/kma_checkpoint.py', '--binary', 'target/release/examples/kma_checkpoint',
                 '--rounds', '20', '--report', str(root / 'reports/server2-kma-checkpoint/ci.json')]),
        ('gnu', ['bash', 'deploy/smoke.sh', '--binary', 'target/release/server2', '--skip-reused', '--out',
                 str(root / 'reports/server2-smoke/ci')]),
        ('gnu', ['cargo', 'build', '--locked', '--release', '--example', 'kma_s3_replay']),
        ('gnu', [python, 'tools/shadow/replay.py', '--binary', 'target/release/server2', '--family', 'kma',
                 '--self-check', '--report', str(root / 'reports/server2-kma-replay/ci.json')]),
        ('gnu', [python, 'tools/shadow/replay.py', '--binary', 'target/release/server2', '--family',
                 'kma-rich',
                 '--self-check', '--report', str(root / 'reports/server2-kma-rich-replay/ci.json')]),
        ('gnu', [python, 'deploy/benchmark/run_isolated.py', 'manifest-functional']),
    ]

    if stage in ('all', 'musl') and sys.platform.startswith('linux'):
        revision = event.get('pull_request', {}).get('head', {}).get('sha') or output('git', 'rev-parse', 'HEAD')
        yield from [
            ('musl', ['cargo', 'build', '--locked', '--release', '--target', 'x86_64-unknown-linux-musl']),
            ('musl', ['readelf', '-h', 'target/x86_64-unknown-linux-musl/release/server2']),
            ('musl', [python, 'tools/verify_artifact.py', '--binary-dir',
                     'target/x86_64-unknown-linux-musl/release',
                     '--output', str(root / 'reports/verification/server2-local-first/artifact-native'),
                     '--source-revision', revision]),
            ('musl', [python, 'tools/native_artifact.py', '--target-dir', 'target', '--output',
                     str(root / 'reports/verification/server2-local-first/native-staging'),
                     '--archive', str(root / 'reports/verification/server2-local-first/artifact-native/native.tar.gz'),
                     '--source-revision', revision]),
        ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=('all', 'placement', 'python', 'rust', 'gnu', 'musl'),
                        nargs='?', default='all')
    stage = parser.parse_args().stage
    root = Path(__file__).resolve().parents[2]
    os.chdir(root / 'server2')
    event_path = os.environ.get('GITHUB_EVENT_PATH')
    event = json.loads(Path(event_path).read_text()) if event_path else {}
    commands = [command for group, command in command_plan(root, event, stage)
                if stage in ('all', group)]
    if not commands:
        parser.error(f'{stage} has no commands on {sys.platform}')
    os.environ.setdefault('SERVER2_PYTHON', sys.executable)
    for command in commands:
        print('+', ' '.join(command), flush=True)
        subprocess.run(command, check=True)


if __name__ == '__main__':
    main()
