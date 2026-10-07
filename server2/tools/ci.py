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
    commands=[[sys.executable,'tools/check_placement.py','--root','..','--declaration',str(declared[0]),'--base',base],[sys.executable,'tools/test_placement.py'],['cargo','fmt','--check'],['cargo','clippy','--locked','--workspace','--all-targets','--','-D','warnings'],['cargo','test','--locked','--workspace'],['cargo','build','--locked','--release'],[sys.executable,'tools/smoke.py','--binary','target/release/server2']]
    local_tests = Path('deploy/local/test_local.py')
    local_smoke = Path('deploy/local/smoke.py')
    if local_tests.exists() != local_smoke.exists():
        raise SystemExit('S03 requires paired local tests and integrated smoke')
    if local_tests.exists():
        commands.insert(2, [sys.executable, str(local_tests)])
        commands.append([sys.executable, str(local_smoke), '--binary', 'target/release/server2'])
    for command in commands:
        print('+',' '.join(command),flush=True);subprocess.run(command,check=True)

if __name__=='__main__': main()
