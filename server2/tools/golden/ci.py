#!/usr/bin/env python3
"""Owned golden CI entrypoint, independently wired from foundation CI."""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--install', action='store_true', help='Install locked offline oracle dependencies in a fresh temporary prefix')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    owned = Path(__file__).resolve().parent
    env = dict(os.environ)
    with tempfile.TemporaryDirectory(prefix='server2-s02-deps-') as t:
        if args.install:
            prefix = Path(t)
            for name in ('package.json', 'package-lock.json'):
                shutil.copyfile(owned/name, prefix/name)
            if not (prefix/'package.json').is_file(): raise RuntimeError('isolated package manifest missing')
            subprocess.run(['npm','ci','--ignore-scripts','--no-audit','--no-fund','--cache',str(prefix/'npm-cache')],cwd=prefix,check=True,timeout=180)
            env['NODE_PATH'] = str(prefix/'node_modules')
        if not env.get('NODE_PATH'): raise RuntimeError('provide isolated NODE_PATH or --install')
        for command in ([sys.executable,str(owned/'test_golden.py')],
                        [sys.executable,str(owned/'verify.py'),'verify']):
            print('+',' '.join(command),flush=True)
            subprocess.run(command,cwd=root,env=env,check=True,timeout=180)

if __name__ == '__main__': main()
