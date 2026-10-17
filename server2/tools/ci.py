#!/usr/bin/env python3
"""CI logic stays under server2; exact PR/push range, full tracked placement."""
import json
import os
import subprocess
import sys
from pathlib import Path


def output(*args): return subprocess.check_output(args,text=True).strip()

def main():
    root=Path(__file__).resolve().parents[2]
    os.chdir(root/'server2')
    event=json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text()) if os.environ.get('GITHUB_EVENT_PATH') else {}
    if 'pull_request' in event:
        base=event['pull_request']['base']['sha']
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
    commands=[[sys.executable,'tools/check_placement.py','--root','..','--declaration',str(declared[0]),'--base',base],[sys.executable,'tools/test_placement.py'],[sys.executable,'tools/test_verify_artifact.py'],['cargo','fmt','--check'],['cargo','clippy','--locked','--workspace','--all-targets','--','-D','warnings'],['cargo','test','--locked','--workspace'],['cargo','build','--locked','--release'],['cargo','build','--locked','--release','--example','loopback_server'],[sys.executable,'tools/smoke.py','--binary','target/release/server2']]
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
    os.environ.setdefault('SERVER2_PYTHON', sys.executable)
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
        revision = event.get('pull_request', {}).get('head', {}).get('sha') or output('git', 'rev-parse', 'HEAD')
        commands.extend([
            ['cargo', 'build', '--locked', '--release', '--target', target],
            ['readelf', '-h', f'target/{target}/release/server2'],
            [sys.executable, 'tools/verify_artifact.py', '--binary-dir', f'target/{target}/release', '--output', str(reports/'artifact-native'), '--source-revision', revision],
        ])
    for command in commands:
        print('+',' '.join(command),flush=True);subprocess.run(command,check=True)

if __name__=='__main__': main()
