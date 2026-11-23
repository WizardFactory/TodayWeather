#!/usr/bin/env python3
"""Re-check a musl artifact built by another job of this workflow run before publishing it.

The hosted musl job builds and verifies the bundle while the other checks run,
records a digest of every candidate file as a job output, then hands the
directory to foundation as a same-run candidate artifact. Foundation runs this
only after every required job succeeded. It executes nothing from the artifact:
it requires the musl job's digest, binds the candidate to the exact source
revision, rehashes binaries and sources against the manifest and validates the
native bundle.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import sys
import tarfile
import tempfile

sys.dont_write_bytecode = True
import native_artifact
import verify_artifact

ROOT = verify_artifact.ROOT
INVENTORY = frozenset({'manifest.json', 'verification.json', 'local-matrix.json', 'startup.log',
                       'matrix.log', 'native.tar.gz', *verify_artifact.BINARIES})


DIGEST_ENV = 'SERVER2_CANDIDATE_DIGEST'


def regular_entries(artifact):
    entries = list(Path(artifact).iterdir())
    if any(path.is_symlink() or not path.is_file() for path in entries):
        raise ValueError('candidate artifact must contain only regular files')
    if {path.name for path in entries} != INVENTORY:
        raise ValueError('candidate artifact inventory differs: ' + ', '.join(sorted(path.name for path in entries)))
    return sorted(entries)


def candidate_digest(artifact):
    """SHA-256 over every file name and content; file modes do not survive the ZIP transfer."""
    lines = [f'{path.name}\0{verify_artifact.digest(path)}\n' for path in regular_entries(artifact)]
    return hashlib.sha256(''.join(lines).encode()).hexdigest()


def record_digest(artifact):
    value = candidate_digest(artifact)
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write(f'digest={value}\n')
    return {'candidate_digest': value}


def expected_digest():
    value = os.environ.get(DIGEST_ENV, '')
    if value:
        if len(value) != 64 or any(c not in '0123456789abcdef' for c in value):
            raise ValueError('invalid musl candidate digest')
        return value
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        raise ValueError('hosted promotion requires the musl job candidate digest')
    return None  # Local serial runs verify and promote on the same machine.


def extract_bundle(archive, destination):
    """Extract only regular files and directories below native/, keeping file modes."""
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        for item in members:
            name = PurePosixPath(item.name)
            if (name.is_absolute() or '..' in name.parts or name.parts[:1] != ('native',)
                    or not (item.isfile() or item.isdir())):
                raise ValueError('unexpected native archive entry: ' + item.name)
        # Members are already restricted; the filter adds defence where available.
        options = {'filter': 'tar'} if hasattr(tarfile, 'tar_filter') else {}
        tar.extractall(destination, members=members, **options)
    return Path(destination) / 'native'


def promote(artifact, revision, expected=None):
    artifact = Path(artifact)
    actual = candidate_digest(artifact)
    if expected is not None and actual != expected:
        raise ValueError('candidate differs from the files the musl job verified')
    manifest = json.loads((artifact / 'manifest.json').read_text())
    # Same checks as verify_artifact --manifest: revision, server2 tree, sources and binaries.
    snapshot = verify_artifact.snapshot(ROOT, artifact, verify_artifact.source_identity(ROOT, revision))
    verify_artifact.validate_manifest(snapshot, manifest)
    verification = json.loads((artifact / 'verification.json').read_text())
    if verification.get('status') != 'passed' or verification.get('manifest') != manifest:
        raise ValueError('candidate verification did not pass for this manifest')
    with tempfile.TemporaryDirectory() as scratch:
        bundle = native_artifact.verify(extract_bundle(artifact / 'native.tar.gz', scratch))
    if bundle['source'] != manifest['source']:
        raise ValueError('native bundle source differs from the artifact manifest')
    # download-artifact drops the executable bits verify_artifact.py set; restore them
    # only after every check passed so the published binaries match a direct upload.
    for name in verify_artifact.BINARIES:
        (artifact / name).chmod(0o755)
    return {'status': 'PASS', 'source': manifest['source'], 'binaries': manifest['binaries'],
            'native_roles': len(bundle['roles']), 'candidate_digest': actual,
            'digest_checked': expected is not None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact', required=True, type=Path)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--record-digest', action='store_true', help='musl job: record the candidate digest')
    mode.add_argument('--source-revision', help='foundation: re-check and promote for this revision')
    args = parser.parse_args()
    result = (record_digest(args.artifact) if args.record_digest
              else promote(args.artifact, args.source_revision, expected_digest()))
    print(json.dumps(result, sort_keys=True), flush=True)


if __name__ == '__main__':
    main()
