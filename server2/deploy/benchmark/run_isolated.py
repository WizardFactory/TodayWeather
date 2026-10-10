#!/usr/bin/env python3
"""Linux-only offline operational tests. Missing isolation is fatal, no fallback.

Mount no home, host /run, /sys, credentials or writable checkout. Only reviewed
fake executables may be spawned by the pre-import audit hook. Never run the
operational unittest files directly, including parser-negative tests.
"""
from pathlib import Path
import os
import re
import shutil
import subprocess
import sys


def main():
    selection = sys.argv[1] if len(sys.argv) == 2 else 'test_*.py'
    if len(sys.argv) > 2 or not (selection in {'test_*.py', 'safety', 'functional', 'imds-functional', 'online-functional', 'manifest-functional'} or re.fullmatch(r'test_[A-Za-z0-9_.]+', selection)):
        raise SystemExit('unsupported offline selection')
    bwrap = shutil.which('bwrap')
    if bwrap is None:
        raise SystemExit('bubblewrap required; refusing unsandboxed tests')
    root = Path(__file__).resolve().parents[3]
    command = [bwrap, '--unshare-all', '--uid', '0', '--gid', '0', '--die-with-parent', '--new-session',
        '--cap-drop', 'ALL', '--ro-bind', '/usr', '/usr',
        '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/sbin', '/sbin',
        '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64',
        '--proc', '/proc', '--dev', '/dev', '--ro-bind', str(root), '/candidate',
        '--tmpfs', '/scratch', '--clearenv', '--setenv', 'PATH', '/usr/bin',
        '--setenv', 'HOME', '/nonexistent', '--setenv', 'TMPDIR', '/scratch',
        '--setenv', 'PYTHONDONTWRITEBYTECODE', '1', '--setenv', 'S09_ISOLATED', '1',
        '--chdir', '/candidate/server2/deploy/benchmark', '/usr/bin/python3',
        '/candidate/server2/deploy/benchmark/isolated_tests.py', selection]
    if selection == 'manifest-functional':
        binary = Path(os.environ.get('S09_MANIFEST_BINARY', root/'server2/target/release/server2-feasibility')).resolve(strict=True)
        if not binary.is_file() or not os.access(binary, os.X_OK):
            raise SystemExit('compiled GNU worker required; no fallback')
        command[1:1] = ['--ro-bind', str(binary), '/worker', '--tmpfs', '/opt']
        command[-3:-3] = ['--setenv', 'S09_MANIFEST_BINARY', '/worker']
    subprocess.run(command, check=True)


if __name__ == '__main__':
    main()
