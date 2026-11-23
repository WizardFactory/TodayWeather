#!/usr/bin/env python3
"""CI logic stays under server2; exact PR/push range, full tracked placement."""
import argparse
import ast
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


def push_placement_commands(root, event):
    """Check each first-parent commit of a push that changes Server2 against its own parent.

    A push can carry several merged tasks, each with its own declaration (#3139). Every such
    commit is checked out in its own worktree and checked with its own placement checker and
    the one declaration it adds or changes.
    """
    before = event['before']
    if set(before) == {'0'}:
        commits = [output('git', 'rev-parse', 'HEAD')]
    else:
        commits = output('git', 'rev-list', '--first-parent', '--reverse', f'{before}..HEAD').split()
    commands = []
    for commit in commits:
        parent = output('git', 'rev-parse', f'{commit}^1')
        # Without rename detection a move out of server2/ reports its source path too; -z keeps
        # non-ASCII paths unquoted.
        paths = [p for p in output('git', 'diff', '--no-renames', '--name-only', '-z', parent, commit).split('\0') if p]
        if not any(path.startswith('server2/') or path == '.github/workflows/server2.yml' for path in paths):
            continue
        declared = [p for p in output('git', 'diff', '--no-renames', '--name-only', '-z', '--diff-filter=d',
                                      parent, commit, '--', ':(top)server2/config/tasks/*.json').split('\0') if p]
        if len(declared) != 1:
            raise SystemExit(f'{commit}: one reviewed task declaration is required, found {len(declared)}')
        tree = root / 'reports/placement' / commit
        commands += [['git', 'worktree', 'add', '--detach', str(tree), commit],
                     [sys.executable, str(tree / 'server2/tools/check_placement.py'), '--root', str(tree),
                      '--declaration', str(tree / declared[0]), '--base', parent],
                     ['git', 'worktree', 'remove', '--force', str(tree)]]
    if not commands:
        raise SystemExit('the push changes no Server2 path')
    return commands


def placement_commands(root, event):
    if 'before' in event and 'after' in event and 'pull_request' not in event:
        return push_placement_commands(root, event)
    return [placement_command(event)]


RUST_SHARDS = 3
SHADOW_SIMULATION = 'tests/integration/test_shadow_simulation.py'
# The heaviest simulation tests (local seconds, 2026-11-23: 124, 9 | 81, 37, 10 | 64, 62 |
# 64, 57) are spread so each hosted shard stays near 130 s. Unlisted tests run in the last shard.
SHADOW_SHARDS = (
    ('test_isolated_transient_failures_do_not_end_the_run',
     'test_candidate_exit_ends_collection_and_keeps_cleanup'),
    ('test_sub_budgets_no_longer_stop_and_the_ceiling_does',
     'test_no_fault_run_reaches_the_deadline_and_cleans_up',
     'test_a_failed_final_copy_is_recovered_by_the_next_hourly_copy'),
    ('test_provider_rejections_are_recorded_and_never_stop',
     'test_a_final_copy_failing_at_the_deadline_leaves_the_tail_unverified'),
    ('test_seeded_runs_are_deterministic',
     'test_bucket_evidence_survives_an_operator_unreachable_at_the_deadline'),
)
HOSTED_STAGES = ('placement', 'python', 'gnu', 'musl', 'promote',
                 *(f'rust-{k}' for k in range(1, RUST_SHARDS + 1)),
                 *(f'shadow-{k}' for k in range(1, len(SHADOW_SHARDS) + 1)))


def simulation_tests(path):
    """Class.method names of every test in the simulation file, in source order."""
    tree = ast.parse(Path(path).read_text())
    return [f'{node.name}.{item.name}' for node in tree.body if isinstance(node, ast.ClassDef)
            for item in node.body if isinstance(item, ast.FunctionDef) and item.name.startswith('test_')]


def shadow_shard(path, shard):
    tests = simulation_tests(path)
    by_method = {name.split('.', 1)[1]: name for name in tests}
    named = [method for methods in SHADOW_SHARDS for method in methods]
    missing = sorted(set(named) - set(by_method))
    if missing or len(named) != len(set(named)):
        raise SystemExit('shadow shard names must be unique existing tests: ' + ', '.join(missing))
    selected = [by_method[method] for method in SHADOW_SHARDS[shard - 1]]
    if shard == len(SHADOW_SHARDS):
        selected += [name for name in tests if name.split('.', 1)[1] not in named]
    return selected


def stage_commands(root, event, stage):
    """Hosted stages; `all` keeps the serial local order of command_plan."""
    python = sys.executable
    if stage.startswith('rust-'):
        shard = int(stage.removeprefix('rust-'))
        commands = []
        if shard == 1:
            commands += [[python, 'tools/test_placement.py'], [python, 'tools/test_ci.py'],
                         [python, 'tools/check_test_partitions.py', '--shards', str(RUST_SHARDS)],
                         ['cargo', 'test', '--locked', '--workspace', '--doc']]
        # nextest partitions are disjoint and complete; doc tests run once above.
        commands.append(['env', 'RUST_MIN_STACK=8388608', 'cargo', 'nextest', 'run', '--locked',
                         '--workspace', '--no-fail-fast', '--partition', f'count:{shard}/{RUST_SHARDS}'])
        return commands
    if stage.startswith('shadow-'):
        source = Path(__file__).resolve().parents[1] / SHADOW_SIMULATION
        return [[python, SHADOW_SIMULATION, *shadow_shard(source, int(stage.removeprefix('shadow-')))]]
    return [command for group, command in command_plan(root, event, stage) if group == stage
            and command != [python, SHADOW_SIMULATION]]


def command_plan(root, event, stage):
    python = sys.executable
    if stage in ('all', 'placement'):
        for command in placement_commands(root, event):
            yield 'placement', command
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
        ('python', [python, 'tests/integration/test_qualification_evaluator.py']),
        ('python', [python, 'tests/integration/test_shadow_simulation.py']),
        ('python', [python, 'tests/integration/test_shadow_measured_simulation.py']),
        ('python', [python, '-m', 'unittest', 'discover', '-s', 'tests/integration', '-p', 'test_rehearsal_*.py']),
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
        ('python', [python, 'tools/test_promote_artifact.py']),
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

    if stage not in ('all', 'musl', 'promote') or not sys.platform.startswith('linux'):
        return
    revision = event.get('pull_request', {}).get('head', {}).get('sha') or output('git', 'rev-parse', 'HEAD')
    artifact = root / 'reports/verification/server2-local-first/artifact-native'
    if stage in ('all', 'musl'):
        yield from [
            ('musl', ['cargo', 'build', '--locked', '--release', '--target', 'x86_64-unknown-linux-musl']),
            ('musl', ['readelf', '-h', 'target/x86_64-unknown-linux-musl/release/server2']),
            ('musl', [python, 'tools/verify_artifact.py', '--binary-dir',
                     'target/x86_64-unknown-linux-musl/release',
                     '--output', str(artifact),
                     '--source-revision', revision]),
            ('musl', [python, 'tools/native_artifact.py', '--target-dir', 'target', '--output',
                     str(root / 'reports/verification/server2-local-first/native-staging'),
                     '--archive', str(artifact / 'native.tar.gz'),
                     '--source-revision', revision]),
            ('musl', [python, 'tools/promote_artifact.py', '--artifact', str(artifact), '--record-digest']),
        ]
    # Hosted foundation re-checks the musl job's same-run candidate before publishing it.
    yield 'promote', [python, 'tools/promote_artifact.py', '--artifact', str(artifact),
                      '--source-revision', revision]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=('all', *HOSTED_STAGES), nargs='?', default='all')
    stage = parser.parse_args().stage
    root = Path(__file__).resolve().parents[2]
    os.chdir(root / 'server2')
    event_path = os.environ.get('GITHUB_EVENT_PATH')
    event = json.loads(Path(event_path).read_text()) if event_path else {}
    commands = ([command for _, command in command_plan(root, event, stage)] if stage == 'all'
                else stage_commands(root, event, stage))
    if not commands:
        parser.error(f'{stage} has no commands on {sys.platform}')
    os.environ.setdefault('SERVER2_PYTHON', sys.executable)
    for command in commands:
        print('+', ' '.join(command), flush=True)
        subprocess.run(command, check=True)


if __name__ == '__main__':
    main()
