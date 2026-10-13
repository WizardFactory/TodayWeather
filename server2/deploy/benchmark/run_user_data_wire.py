#!/usr/bin/env python3
"""Run installed AWS CLI wire tests in mandatory network/mount/PID isolation.

Usage: python3 run_user_data_wire.py /path/to/aws-cli/dist/aws
No host credentials, networking, operational entrypoint or writable checkout.
"""
from pathlib import Path
import os
import shutil
import subprocess
import sys


def main():
    if len(sys.argv) != 2:
        raise SystemExit('supply the installed AWS CLI executable')
    binary = Path(sys.argv[1]).resolve(strict=True)
    bwrap = shutil.which('bwrap')
    if not bwrap or binary.name != 'aws' or not os.access(binary, os.X_OK):
        raise SystemExit('bubblewrap and installed AWS CLI required; no fallback')
    root = Path(__file__).resolve().parents[3]
    command = [bwrap, '--unshare-all', '--die-with-parent', '--new-session',
        '--cap-drop', 'ALL', '--ro-bind', '/usr', '/usr',
        '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/sbin', '/sbin',
        '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64',
        '--proc', '/proc', '--dev', '/dev', '--ro-bind', str(root), '/candidate',
        '--ro-bind', str(binary.parent), '/cli', '--tmpfs', '/scratch',
        '--clearenv', '--setenv', 'PATH', '/usr/bin', '--setenv', 'HOME', '/nonexistent',
        '--setenv', 'TMPDIR', '/scratch', '--setenv', 'PYTHONDONTWRITEBYTECODE', '1',
        '--setenv', 'S09_ISOLATED', '1', '--setenv', 'S09_WIRE_CLI', '/cli/aws',
        '--chdir', '/candidate/server2/deploy/benchmark', '/usr/bin/python3',
        '/candidate/server2/deploy/benchmark/test_user_data_wire.py']
    raise SystemExit(subprocess.run(command).returncode)


if __name__ == '__main__':
    main()
