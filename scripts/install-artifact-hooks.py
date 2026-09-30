#!/usr/bin/env python3
"""Explicitly install repository hooks; never replace another hooks configuration."""
import argparse
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--check', action='store_true')
args = parser.parse_args()

root = Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip())
current = subprocess.run(['git', 'config', '--get', 'core.hooksPath'], capture_output=True, text=True)
if current.returncode not in (0, 1):
    raise SystemExit(current.stderr)
if current.stdout.strip() not in ('', '.githooks'):
    raise SystemExit('Existing core.hooksPath preserved; integrate the checker into those hooks explicitly.')
hook_dir = Path(subprocess.check_output(['git', 'rev-parse', '--git-path', 'hooks'], text=True).strip())
if not current.stdout.strip() and hook_dir.exists():
    active = [p.name for p in hook_dir.iterdir() if p.is_file() and not p.name.endswith('.sample')]
    if active:
        raise SystemExit('Existing hooks preserved: ' + ', '.join(active))
for name in ('pre-commit', 'pre-push'):
    p = root / '.githooks' / name
    if not p.is_file() or not (p.stat().st_mode & 0o111):
        raise SystemExit('Missing executable hook: ' + str(p))
if args.check:
    if current.stdout.strip() != '.githooks':
        raise SystemExit('Hooks available but not installed; run this script without --check to opt in.')
    print('Repository artifact hooks are configured.')
else:
    subprocess.run(['git', 'config', '--local', 'core.hooksPath', '.githooks'], check=True)
    print('Configured .githooks for this repository, including its linked worktrees. No global setting changed.')
