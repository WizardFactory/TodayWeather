#!/usr/bin/env python3
"""CI logic stays under server2; exact PR/push range, full tracked placement."""
import argparse
import json
import re
import os
import subprocess
import sys
from pathlib import Path

import check_placement as placement
from verify_artifact import source_identity


def output(*args): return subprocess.check_output(args,text=True).strip()

# Positive unrelated scope is bounded; there is deliberately no catch-all else.
UNRELATED_PREFIXES = ('docs/', 'intent/', 'specs/', 'plans/', 'web/', 'client/',
                      'packages/', 'tw.ios/', 'ta.ios/', 'applewatch/',
                      '.agents/', '.codex/', '.claude/', '.github/ISSUE_TEMPLATE/')
UNRELATED_FILES = {'README.md', 'AGENTS.md', 'CLAUDE.md', 'LICENSE', 'LICENSE.md',
                   '.gitignore', '.editorconfig', '.gitattributes'}


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()


def commit(root, value, label):
    if not isinstance(value, str) or not re.fullmatch('[0-9a-f]{40}', value) or set(value) == {'0'}:
        raise ValueError(label+': exact nonzero commit required')
    if git(root, 'rev-parse', '--verify', value+'^{commit}') != value:
        raise ValueError(label+': commit identity differs')
    return value


def context(root, event, event_name, env):
    if event_name == 'pull_request':
        request = event['pull_request']
        return dict(kind='pull_request', base=commit(root, request['base']['sha'], 'PR base'),
                    head=commit(root, request['head']['sha'], 'PR head'))
    if event_name == 'push':
        if event.get('ref') != 'refs/heads/master':
            raise ValueError('only the reviewed master push scope is supported')
        head = commit(root, event['after'], 'push after')
        if git(root, 'rev-parse', 'HEAD') != head:
            raise ValueError('push checkout is not the event after commit')
        return dict(kind='push', base=commit(root, event['before'], 'push before'), head=head)
    if event_name or event or env.get('GITHUB_ACTIONS') == 'true':
        raise ValueError('unsupported or incomplete hosted event')
    if not env.get('SERVER2_BASE'):
        raise ValueError('local CI requires explicit SERVER2_BASE')
    return dict(kind='local', base=commit(root, env['SERVER2_BASE'], 'local base'),
                head=commit(root, git(root, 'rev-parse', 'HEAD'), 'local head'))


def classify(paths):
    relevant, owned, unknown = False, False, []
    for path in paths:
        if path.startswith('server2/') or path == '.github/workflows/server2.yml':
            relevant = owned = True
        elif path.startswith('server/'):
            relevant = True
        elif path in UNRELATED_FILES or path.startswith(UNRELATED_PREFIXES):
            pass
        elif path.startswith('.github/workflows/') and path.endswith(('.yml', '.yaml')):
            pass
        else:
            unknown.append(path)
    if unknown:
        raise ValueError('unclassified root paths require disposition: '+', '.join(unknown))
    return relevant, owned


def task_declarations(root, base):
    tokens = subprocess.check_output(['git', '-C', str(root), 'diff', '--name-status', '-z', '-M', base, '--']).decode().split('\0')
    found = []
    i = 0
    while i < len(tokens) and tokens[i]:
        status = tokens[i]
        i += 1
        count = 2 if status.startswith(('R', 'C')) else 1
        paths = tokens[i:i+count]
        i += count
        declarations = [p for p in paths if re.fullmatch(r'server2/config/tasks/[^/]+\.json', p)]
        if declarations and (status.startswith(('D', 'R', 'C')) or len(paths) != 1):
            raise ValueError('deleted/renamed/copied task declaration needs explicit disposition')
        found.extend(declarations)
    # Local untracked declarations participate in the same exact scope.
    found.extend(p for p in placement.changed_paths(root, base)
                 if re.fullmatch(r'server2/config/tasks/[^/]+\.json', p) and p not in found)
    return sorted(set(found))


def audit(root, event, event_name, env):
    root = Path(root).resolve()
    selected = context(root, event, event_name, env)
    paths = placement.changed_paths(root, selected['base'])
    errors = placement.check_layout(root, selected['base'])
    if errors:
        raise ValueError('layout audit failed: '+'; '.join(errors))
    heavy, owned = classify(paths)
    declarations = []
    scope = 'layout-only'
    if owned:
        declarations = task_declarations(root, selected['base'])
        if not declarations and selected['kind'] == 'local' and env.get('SERVER2_DECLARATION'):
            relative = Path(env['SERVER2_DECLARATION'])
            if relative.is_absolute() or '..' in relative.parts:
                raise ValueError('local declaration must be an owned relative path')
            declarations = ['server2/'+relative.as_posix()]
            if not re.fullmatch(r'server2/config/tasks/[^/]+\.json', declarations[0]):
                raise ValueError('local declaration must be under config/tasks')
        if not declarations or (selected['kind'] != 'push' and len(declarations) != 1):
            raise ValueError('one reviewed task declaration is required per PR; push requires valid changed declarations')
        documents = []
        for path in declarations:
            file = root/path
            if file.is_symlink() or not file.is_file():
                raise ValueError('regular task declaration required')
            documents.append(json.loads(file.read_text()))
        errors = placement.check_declarations(root, documents, selected['base'])
        if errors:
            raise ValueError('full root task range failed: '+'; '.join(errors))
        scope = 'push-range-declaration-union' if selected['kind'] == 'push' else 'full-pr-task-range'
    source = source_identity(root/'server2', selected['head'])
    build_environment(env, selected['head'])
    return dict(selected, paths=paths, scope=scope, declarations=declarations, heavy=heavy,
                foundation='scheduled' if heavy else 'not-run: unrelated-only',
                goldens='scheduled' if heavy else 'not-run: unrelated-only', source=source)


def placement_command(plan):
    command = [sys.executable, 'tools/check_placement.py', '--root', '..', '--base', plan['base']]
    if plan['declarations']:
        for path in plan['declarations']:
            command += ['--declaration', str(Path('..')/path)]
    else:
        command += ['--layout-only']
    return command


def build_environment(env, revision):
    if not re.fullmatch('[0-9a-f]{40}', revision):
        raise ValueError('invalid build source revision')
    if env.get('SERVER2_BUILD_REVISION') not in (None, revision):
        raise ValueError('conflicting compile-time build revision')
    return dict(env, SERVER2_BUILD_REVISION=revision)


def verify_record_revision(path, revision):
    records = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    if not records or any(record.get('schema') != 1 or record.get('build_revision') != revision for record in records):
        raise ValueError('emitted log revision does not match selected build: '+path.name)
    print('PASS emitted build revision '+revision+' in '+path.name, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audit-only', action='store_true', help='Check full-root scope/layout; never build')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    event_path = os.environ.get('GITHUB_EVENT_PATH')
    event = json.loads(Path(event_path).read_text()) if event_path else {}
    plan = audit(root, event, os.environ.get('GITHUB_EVENT_NAME'), os.environ)
    print(json.dumps(dict(outcome='passed', stage='scope/layout-audit', **plan), sort_keys=True), flush=True)
    if args.audit_only:
        if os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('GITHUB_OUTPUT'):
            with Path(os.environ['GITHUB_OUTPUT']).open('a') as file:
                file.write('heavy='+str(plan['heavy']).lower()+'\n')
        return 0
    if not plan['heavy']:
        return 0
    env = build_environment(os.environ, plan['head'])
    os.chdir(root/'server2')
    commands=[placement_command(plan), [sys.executable,'tools/test_placement.py'],
              [sys.executable,'tools/test_ci.py'], [sys.executable,'tools/test_verify_artifact.py'],
              ['cargo','fmt','--check'], ['cargo','clippy','--locked','--workspace','--all-targets','--','-D','warnings'],
              ['cargo','test','--locked','--workspace'], ['cargo','build','--locked','--release'],
              ['cargo','build','--locked','--release','--example','loopback_server'],
              [sys.executable,'tools/smoke.py','--binary','target/release/server2']]
    # Operational tests must never run on the CI host. Missing bubblewrap or
    # namespaces fail closed; no direct unittest fallback is permitted.
    sandbox = 'deploy/benchmark/run_isolated.py'
    commands[2:2] = [[sys.executable, sandbox, selection] for selection in
        ('safety', 'test_*.py', 'functional', 'imds-functional', 'online-functional')]
    local_tests = Path('deploy/local/test_local.py')
    local_smoke = Path('deploy/local/smoke.py')
    if local_tests.exists() != local_smoke.exists():
        raise SystemExit('S03 requires paired local tests and integrated smoke')
    if local_tests.exists():
        commands.insert(2, [sys.executable, str(local_tests)])
        commands.append([sys.executable, str(local_smoke), '--binary', 'target/release/server2'])
    commands.insert(6, [sys.executable, 'tests/integration/test_log_diagnosis.py'])
    commands.append(['cargo', 'build', '--locked', '--release', '--example', 'logging_smoke'])
    commands.append([sys.executable, 'tools/logging_smoke.py', '--binary', 'target/release/server2',
                     '--probe', 'target/release/examples/logging_smoke', '--out', str(root/'reports/server2-logging/ci')])
    commands.append([sys.executable, 'tools/gateway_smoke.py', '--binary', 'target/release/server2'])
    commands.append([sys.executable, 'tools/widget_smoke.py', '--binary', 'target/release/server2',
                     '--output', str(root/'reports/server2-widget/ci')])
    commands.append(['cargo','build','--locked','--release','--example','narrative_smoke'])
    commands.append([sys.executable,'tools/narrative_smoke.py','--binary','target/release/examples/narrative_smoke',
                     '--out',str(root/'reports/server2-narrative/ci')])
    # S15: KMA v000903 routing entry (legacy -> kma -> legacy) on the release binary.
    commands.append([sys.executable, 'tools/kma_smoke.py', '--binary', 'target/release/server2'])
    # S15 O-2 checkpoint: KMA v000903 assembly time, peak RSS and CPU on this (Linux) runner.
    commands.append(['cargo', 'build', '--locked', '--release', '--example', 'kma_checkpoint'])
    commands.append([sys.executable, 'tools/kma_checkpoint.py', '--binary', 'target/release/examples/kma_checkpoint',
                     '--rounds', '20', '--report', str(root/'reports/server2-kma-checkpoint/ci.json')])
    # S19: shadow tool unit tests, then the integrated release smoke (scenarios, paired
    # replay with self-check, cache-aware rollback). The two reused smokes ran above.
    commands.insert(3, [sys.executable, 'tests/integration/test_shadow.py'])
    commands.insert(4, [sys.executable, 'tests/integration/test_native_rollback.py'])
    # S19b orchestration controls; existing runtime checks remain unchanged.
    # The all-family operator suite requires an explicit retained-artifact manifest.
    commands.insert(5, [sys.executable, 'tests/integration/test_native_suite.py'])
    commands.insert(6, [sys.executable, 'tests/integration/test_release_recovery.py'])
    commands.insert(7, [sys.executable, 'tests/integration/test_cutover_deadline.py'])
    commands.insert(8, [sys.executable, 'tools/test_native_artifact.py'])
    env.setdefault('SERVER2_PYTHON', sys.executable)
    commands.append(['bash', 'deploy/smoke.sh', '--binary', 'target/release/server2', '--skip-reused',
                     '--out', str(root/'reports/server2-smoke/ci')])
    # S15b-4b3: whole-response canonical S3 replay uses the same library HTTP path with
    # fixed clock and disabled providers injected only by this isolated example.
    commands.append(['cargo', 'build', '--locked', '--release', '--example', 'kma_s3_replay'])
    commands.append([sys.executable, 'tools/shadow/replay.py', '--binary', 'target/release/server2',
                     '--family', 'kma', '--self-check', '--report',
                     str(root/'reports/server2-kma-replay/ci.json')])
    # Rich corpus has its own denominator; both manifests retain the original assembly-only cases.
    commands.append([sys.executable, 'tools/shadow/replay.py', '--binary', 'target/release/server2',
                     '--family', 'kma-rich', '--self-check', '--report',
                     str(root/'reports/server2-kma-rich-replay/ci.json')])
    # Uses the just-built GNU binary: real private_manifest, then the non-musl
    # fence, without worker claims or any AWS/IMDS network path.
    commands.append([sys.executable, sandbox, 'manifest-functional'])
    if sys.platform.startswith('linux'):
        # Intended c6i host artifact is verified here, rather than built on EC2.
        target = 'x86_64-unknown-linux-musl'
        reports = root/'reports/verification/server2-local-first'
        reports.mkdir(parents=True, exist_ok=True)
        revision = plan['head']
        commands.extend([
            ['cargo', 'build', '--locked', '--release', '--target', target],
            ['readelf', '-h', f'target/{target}/release/server2'],
            [sys.executable, 'tools/verify_artifact.py', '--binary-dir', f'target/{target}/release', '--output', str(reports/'artifact-native'), '--source-revision', revision],
            [sys.executable, 'tools/native_artifact.py', '--target-dir', 'target',
             '--output', str(reports/'native-staging'), '--archive', str(reports/'artifact-native/native.tar.gz'),
             '--source-revision', revision],
        ])
    for command in commands:
        print('+',' '.join(command),flush=True);subprocess.run(command,check=True,env=env)
        if len(command) > 1 and command[1] == 'tools/logging_smoke.py':
            for name in ('probe.stderr.ndjson', 'http.stderr.ndjson'):
                verify_record_revision(root/'reports/server2-logging/ci'/name, plan['head'])

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        print('BLOCKED CI scope/execution: '+str(error), file=sys.stderr)
        raise SystemExit(2)
