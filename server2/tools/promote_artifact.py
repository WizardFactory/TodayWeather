#!/usr/bin/env python3
"""Re-check a musl artifact built by another job of this workflow run before publishing it.

The hosted musl job builds and verifies the bundle while the other checks run,
then hands it to foundation as a same-run candidate artifact. Foundation runs
this only after every required job succeeded. It executes nothing from the
artifact: it binds the candidate to the exact source revision, rehashes every
file against the recorded manifest and validates the native bundle.
"""
import argparse
import json
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


def extract_bundle(archive, destination):
    """Extract only regular files and directories below native/, keeping file modes."""
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        for item in members:
            name = PurePosixPath(item.name)
            if (name.is_absolute() or '..' in name.parts or name.parts[:1] != ('native',)
                    or not (item.isfile() or item.isdir())):
                raise ValueError('unexpected native archive entry: ' + item.name)
        tar.extractall(destination, members=members, filter='tar')
    return Path(destination) / 'native'


def promote(artifact, revision):
    artifact = Path(artifact)
    entries = list(artifact.iterdir())
    if any(path.is_symlink() or not path.is_file() for path in entries):
        raise ValueError('candidate artifact must contain only regular files')
    if {path.name for path in entries} != INVENTORY:
        raise ValueError('candidate artifact inventory differs: ' + ', '.join(sorted(path.name for path in entries)))
    manifest = json.loads((artifact / 'manifest.json').read_text())
    # Same checks as verify_artifact --manifest: revision, server2 tree, sources and binaries.
    expected = verify_artifact.snapshot(ROOT, artifact, verify_artifact.source_identity(ROOT, revision))
    verify_artifact.validate_manifest(expected, manifest)
    verification = json.loads((artifact / 'verification.json').read_text())
    if verification.get('status') != 'passed' or verification.get('manifest') != manifest:
        raise ValueError('candidate verification did not pass for this manifest')
    with tempfile.TemporaryDirectory() as scratch:
        bundle = native_artifact.verify(extract_bundle(artifact / 'native.tar.gz', scratch))
    if bundle['source'] != manifest['source']:
        raise ValueError('native bundle source differs from the artifact manifest')
    return {'status': 'PASS', 'source': manifest['source'], 'binaries': manifest['binaries'],
            'native_roles': len(bundle['roles'])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact', required=True, type=Path)
    parser.add_argument('--source-revision', required=True)
    args = parser.parse_args()
    print(json.dumps(promote(args.artifact, args.source_revision), sort_keys=True), flush=True)


if __name__ == '__main__':
    main()
