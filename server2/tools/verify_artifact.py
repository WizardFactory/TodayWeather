#!/usr/bin/env python3
"""Verify prebuilt Linux artifacts with the existing offline startup/matrix checks."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
BINARIES = ('server2', 'server2-feasibility')
SOURCES = ('Cargo.lock', 'benches/feasibility.rs', 'tools/benchmark/model.rs',
           'tools/benchmark/run.py', 'tools/benchmark/local_peer.py',
           'deploy/local/peer.py', 'config/local-stack.json', 'config/benchmarks/local.json',
           'tools/smoke.py', 'tools/verify_artifact.py')


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as file:
        while chunk := file.read(1024*1024):
            h.update(chunk)
    return h.hexdigest()


def check_elf(path):
    with Path(path).open('rb') as file:
        header = file.read(64)
        if len(header) != 64 or header[:6] != b'\x7fELF\x02\x01':
            raise ValueError('expected little-endian ELF64 artifact')
        kind, machine = struct.unpack_from('<HH', header, 16)
        offset = struct.unpack_from('<Q', header, 32)[0]
        width, count = struct.unpack_from('<HH', header, 54)
        if machine != 62 or kind not in (2, 3) or width != 56 or not 1 <= count <= 128:
            raise ValueError('expected executable static x86_64 Linux artifact')
        if offset < 64 or offset + width*count > Path(path).stat().st_size:
            raise ValueError('invalid ELF program headers')
        file.seek(offset)
        for _ in range(count):
            if struct.unpack_from('<I', file.read(width))[0] == 3:
                raise ValueError('dynamic interpreter is not permitted')


def source_identity(root, revision=None):
    """Bind all tracked server2 build inputs, including compile-time includes.

    CI may build GitHub's merge checkout only when its server2 tree exactly
    matches the recorded PR head. Uncommitted tracked changes fail closed.
    """
    repo = root.resolve().parent
    def git(*args):
        return subprocess.check_output(['git', '-C', str(repo), *args], text=True).strip()
    revision = revision or git('rev-parse', 'HEAD')
    if not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise ValueError('expected exact source revision')
    tree = git('rev-parse', revision+':server2')
    if not re.fullmatch(r'[a-f0-9]{40}', tree):
        raise ValueError('expected tracked server2 tree')
    if subprocess.run(['git', '-C', str(repo), 'diff', '--quiet', revision, '--', 'server2']).returncode:
        raise ValueError('tracked server2 source differs from recorded revision')
    return {'revision': revision, 'server2_tree': tree}


def snapshot(root, binaries, source=None):
    for name in BINARIES:
        check_elf(binaries/name)
    return {'schema': 2, 'status': 'passed', 'target': 'x86_64-unknown-linux-musl',
            'source': source if source is not None else source_identity(root),
            'binaries': {name: digest(binaries/name) for name in BINARIES},
            'sources': {name: digest(root/name) for name in SOURCES}}


def validate_manifest(expected, actual):
    if expected != actual:
        raise ValueError('artifact/source manifest mismatch; refusing execution')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary-dir', required=True)
    parser.add_argument('--output', required=True, help='Fresh output directory')
    parser.add_argument('--manifest', help='Expected successful CI manifest; checked before execution')
    parser.add_argument('--source-revision', help='Exact PR revision for a matching-tree CI merge checkout')
    parser.add_argument('--staged-source', help='Read-only source identity already validated by the Docker host')
    args = parser.parse_args()
    if args.staged_source and (not args.manifest or args.source_revision):
        parser.error('--staged-source requires --manifest and excludes --source-revision')
    source = (json.loads(Path(args.staged_source).read_text()) if args.staged_source
              else source_identity(ROOT, args.source_revision))
    binaries = Path(args.binary_dir).resolve()
    if not binaries.is_relative_to(ROOT/'target'):
        raise ValueError('artifacts must be under server2/target')
    before = snapshot(ROOT, binaries, source)
    if args.manifest:
        validate_manifest(json.loads(Path(args.manifest).read_text()), before)
    if sys.platform != 'linux':
        raise ValueError('artifact execution requires Linux (use the Docker launcher on macOS)')
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    commands = [
        [sys.executable, str(ROOT/'tools/smoke.py'), '--binary', str(binaries/'server2')],
        [sys.executable, str(ROOT/'tools/benchmark/run.py'), '--binary', str(binaries/'server2-feasibility'),
         '--output', str(output/'local-matrix.json')],
    ]
    result = {'status': 'failed', 'environment': {'os': platform.platform(),
              'architecture': platform.machine()}, 'manifest': before,
              'aws_verified': False, 'ec2_smoke': 'pending', 'checks': []}
    # Do not inherit account profiles, proxies or AWS keys, even in native CI.
    env = {'PATH': os.environ.get('PATH', ''), 'HOME': '/tmp', 'PYTHONDONTWRITEBYTECODE': '1',
           'PYTHONUNBUFFERED': '1', 'AWS_EC2_METADATA_DISABLED': 'true'}
    try:
        for name, command in zip(('startup', 'matrix'), commands):
            result['stage'] = name
            print('+', ' '.join(command), flush=True)
            log = output/(name+'.log')
            with log.open('w') as file:
                run = subprocess.run(command, env=env, cwd=ROOT, stdout=file,
                                     stderr=subprocess.STDOUT, timeout=420)
            print(log.read_text(), end='', flush=True)
            result['checks'].append({'stage': name, 'exit_code': run.returncode})
            if run.returncode:
                raise RuntimeError(name+' check failed; see retained log')
        if not args.staged_source:
            validate_manifest(source, source_identity(ROOT, args.source_revision))
        validate_manifest(before, snapshot(ROOT, binaries, source))
        for name in BINARIES:
            shutil.copy2(binaries/name, output/name)
            if digest(output/name) != before['binaries'][name]:
                raise ValueError('exported artifact hash mismatch')
        (output/'manifest.json').write_text(json.dumps(before, indent=2)+'\n')
        result['status'] = 'passed'
        print('PASS static Linux artifacts; hashes unchanged; AWS/EC2 remains unverified', flush=True)
    except Exception as error:
        result['error_type'] = type(error).__name__
        raise
    finally:
        (output/'verification.json').write_text(json.dumps(result, indent=2)+'\n')


if __name__ == '__main__':
    main()
