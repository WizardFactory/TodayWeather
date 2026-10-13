#!/usr/bin/env python3
"""Run the CI bundle in offline Docker; never mount checkout credentials."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import uuid

import verify_artifact as artifact

IMAGE = 'python:3.14-slim-bookworm@sha256:48b13b003dda20b16f9442b8475aa05fe21bf6579a8c881db92ffb4d8fd20f83'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', required=True, help='Downloaded CI artifact directory')
    parser.add_argument('--output', required=True, help='Fresh host output directory')
    parser.add_argument('--staging-root', help='Docker-visible temporary directory (e.g. Colima mount)')
    parser.add_argument('--docker-context', help='Existing Docker context; default is unchanged')
    args = parser.parse_args()
    bundle = Path(args.bundle).resolve()
    expected = json.loads((bundle/'manifest.json').read_text())
    artifact.validate_manifest(expected, artifact.snapshot(artifact.ROOT, bundle))
    output = Path(args.output).resolve()
    if output.exists():
        raise ValueError('output must be fresh; refusing stale PASS results')
    docker = ['docker'] + (['--context', args.docker_context] if args.docker_context else [])
    subprocess.run(docker+['info', '--format', '{{.OSType}}'], check=True, timeout=30)
    with tempfile.TemporaryDirectory(prefix='s09-preflight-', dir=args.staging_root) as temporary:
        stage = Path(temporary)
        stage.chmod(0o755)
        root = stage/'server2'
        binaries = root/'target/x86_64-unknown-linux-musl/release'
        binaries.mkdir(parents=True)
        for name in artifact.SOURCES:
            destination = root/name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(artifact.ROOT/name, destination)
        for name in artifact.BINARIES:
            shutil.copyfile(bundle/name, binaries/name)
            (binaries/name).chmod(0o755)
        artifact.validate_manifest(expected, artifact.snapshot(root, binaries, expected['source']))
        (root/'source.json').write_text(json.dumps(expected['source'])+'\n')
        (root/'expected.json').write_text(json.dumps(expected)+'\n')
        results = stage/'results'
        results.mkdir(mode=0o777)
        results.chmod(0o777)
        uid = os.getuid() or 10001
        container = 'server2-s09-preflight-'+uuid.uuid4().hex
        command = docker + ['run', '--rm', '--name', container, '--platform', 'linux/amd64', '--network', 'none',
            '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
            '--user', str(uid), '--pids-limit', '256', '--memory', '1g', '--cpus', '2',
            '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m',
            '--mount', f'type=bind,source={root},target=/work/server2,readonly',
            '--mount', f'type=bind,source={results},target=/results',
            '--workdir', '/work/server2', '--env', 'PYTHONDONTWRITEBYTECODE=1',
            IMAGE, 'python3', 'tools/verify_artifact.py',
            '--binary-dir', 'target/x86_64-unknown-linux-musl/release',
            '--manifest', 'expected.json', '--staged-source', 'source.json', '--output', '/results/run']
        print('Offline Docker preflight; fixed linux/amd64 image; no credentials forwarded', flush=True)
        cleanup_ok = False
        try:
            run = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 text=True, timeout=900)
            print(run.stdout, end='', flush=True)
            code = run.returncode
            log = run.stdout
        except subprocess.TimeoutExpired as error:
            code = 124
            log = (error.stdout or b'').decode() if isinstance(error.stdout, bytes) else (error.stdout or '')
            print('Docker preflight timed out; not PASS', flush=True)
        finally:
            # Killing a Docker client does not stop its container. Clean up only
            # this unique task-owned name, including timeout/interruption paths.
            try:
                subprocess.run(docker+['rm', '--force', container], capture_output=True, timeout=30)
                absent = subprocess.run(docker+['ps', '--all', '--filter', 'name=^/'+container+'$',
                                               '--format', '{{.Names}}'], capture_output=True, text=True, timeout=30)
                cleanup_ok = absent.returncode == 0 and not absent.stdout.strip()
            except (OSError, subprocess.TimeoutExpired):
                pass
        if not cleanup_ok:
            code = code or 1
            log += '\nTask-owned container cleanup could not be verified; not PASS\n'
        output.mkdir(parents=True)
        if (results/'run').exists():
            shutil.copytree(results/'run', output/'run')
        (output/'docker.log').write_text(log)
        (output/'docker.json').write_text(json.dumps({'exit_code': code, 'image': IMAGE,
            'platform': 'linux/amd64', 'external_network': False, 'credentials_forwarded': False,
            'binaries': expected['binaries'], 'container_absence_verified': cleanup_ok,
            'aws_verified': False}, indent=2)+'\n')
        if code:
            raise SystemExit(code)
        artifact.validate_manifest(expected, json.loads((output/'run/manifest.json').read_text()))
        print('PASS Docker artifact preflight; EC2/AWS checks remain pending', flush=True)


if __name__ == '__main__':
    main()
