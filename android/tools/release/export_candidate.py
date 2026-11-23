#!/usr/bin/env python3
"""Exports the release candidate's android/ tree and the private inputs to a new directory, where the release is
built (docs/operations/android-release.md, step 4):

    android/tools/release/export_candidate.py <full 40-character SHA> <new directory> --private <directory>

The release is built from this export and never from a checkout. A checkout can hold changed, untracked, ignored
or index-flagged files, and Git can convert files on the way out (line endings, export attributes, replaced
objects); an export written here cannot. Every file of <SHA>:android is read as a blob from the object database
and written with its bytes and its mode. Symbolic links and submodules in the tree are refused. Afterwards the
tool reads the directory back: it must hold exactly those paths, each with the blob's hash and mode. The two
private inputs, google-services.json and private.properties from the --private directory, are then written as
new files; a commit that already has a file there is refused. <directory>/CANDIDATE records the SHA.

The directory must not exist and must lie outside the checkout; both are checked before anything is written, and
a failed export removes the directory it made. The checkout is never changed.
Status 1: refused or failed; 2: usage.
"""
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys

PRIVATE_INPUTS = {'google-services.json': 'android/app/google-services.json',
                  'private.properties': 'android/private.properties'}
# No replaced objects, and no configuration from outside the repository.
GIT_ENV = {**os.environ, 'GIT_NO_REPLACE_OBJECTS': '1', 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_NOSYSTEM': '1'}


class Refused(Exception):
    pass


def git(root, *arguments, stdin=None):
    result = subprocess.run(['git', *arguments], cwd=root, env=GIT_ENV, input=stdin, capture_output=True)
    if result.returncode:
        raise Refused(f'git {arguments[0]} failed: {result.stderr.decode(errors="replace").strip()}')
    return result.stdout


def tree_entries(root, commit):
    """Path -> (executable, blob id) for every file of commit:android; refuses what is not a regular file."""
    entries = {}
    for entry in git(root, 'ls-tree', '-r', '-z', '--full-tree', commit, '--', 'android').split(b'\0'):
        if not entry:
            continue
        meta, raw = entry.split(b'\t', 1)
        mode, kind, oid = meta.decode().split()
        path = os.fsdecode(raw)
        if mode == '120000':
            raise Refused(f'the commit has a symbolic link, {path}: a link can lead the build out of the export')
        if kind != 'blob' or mode not in ('100644', '100755'):
            raise Refused(f'the commit has {path} with mode {mode} ({kind}): only regular files are exported')
        parts = path.split('/')
        if parts[0] != 'android' or any(part in ('', '.', '..', '.git') for part in parts) or '\n' in path:
            raise Refused(f'the commit has a path that cannot be exported: {path!r}')
        entries[path] = (mode == '100755', oid)
    if not entries:
        raise Refused(f'the commit {commit} has no android/ directory')
    return entries


def write_new(path, data, executable=False):
    """Creates path as a new regular file; never follows or replaces what is there."""
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0),
                         0o755 if executable else 0o644)
    with os.fdopen(descriptor, 'wb') as file:
        file.write(data)


def write_blobs(root, entries, destination):
    """Writes each blob as it is in the object database: no checkout, no archive, no filter."""
    with subprocess.Popen(['git', 'cat-file', '--batch'], cwd=root, env=GIT_ENV, stdin=subprocess.PIPE,
                          stdout=subprocess.PIPE) as batch:
        for path, (executable, oid) in entries.items():
            batch.stdin.write(oid.encode() + b'\n')
            batch.stdin.flush()
            header = batch.stdout.readline().split()
            if len(header) != 3 or header[0].decode() != oid or header[1] != b'blob':
                raise Refused(f'cannot read the blob {oid} of {path}')
            size = int(header[2])
            data = batch.stdout.read(size)
            if len(data) != size or batch.stdout.read(1) != b'\n':
                raise Refused(f'cannot read the blob {oid} of {path}')
            write_new(destination / path, data, executable)
        batch.stdin.close()
        if batch.wait():
            raise Refused('git cat-file failed')


def verify(entries, destination):
    """Reads the export back: exactly the commit's paths, regular files, with the blobs' hashes and modes."""
    found = set()
    for directory, names, files in os.walk(destination / 'android'):
        for name in names + files:
            status = os.lstat(Path(directory) / name)
            if not (stat.S_ISDIR(status.st_mode) or stat.S_ISREG(status.st_mode)):
                raise Refused(f'the export has {Path(directory) / name}, which is neither a file nor a directory')
        found.update(str((Path(directory) / name).relative_to(destination)) for name in files)
    if found != set(entries):
        difference = sorted(found.symmetric_difference(entries))[:5]
        raise Refused(f'the export does not hold exactly the commit\'s files: {difference}')
    paths = list(entries)
    # Hashed as the bytes on disk: no filter, no attribute and no conversion applies.
    hashes = subprocess.run(['git', 'hash-object', '--no-filters', '--stdin-paths'], cwd=destination,
                            env=GIT_ENV, input='\n'.join(paths).encode() + b'\n', capture_output=True)
    if hashes.returncode:
        raise Refused(f'cannot hash the export: {hashes.stderr.decode(errors="replace").strip()}')
    for path, oid in zip(paths, hashes.stdout.decode().split('\n')):
        executable, expected = entries[path]
        if oid != expected:
            raise Refused(f'{path} was not written as the commit has it ({oid}, the commit has {expected})')
        if bool(os.stat(destination / path).st_mode & stat.S_IXUSR) != executable:
            raise Refused(f'{path} does not have the mode the commit gives it')


def export(commit, destination, private):
    root = Path(git(Path(__file__).resolve().parent, 'rev-parse', '--show-toplevel').decode().strip()).resolve()
    # Decide about the directory before anything is created.
    destination = Path(os.path.realpath(destination))
    if os.path.lexists(destination):
        raise Refused(f'{destination} already exists: name a new directory')
    if destination == root or root in destination.parents:
        raise Refused(f'{destination} must be outside the checkout {root}')
    sources = {}
    for name in PRIVATE_INPUTS:
        source = Path(private) / name
        if not source.exists() or source.is_symlink() or not source.is_file():
            raise Refused(f'the private input {source} is missing or is not a regular file')
        sources[name] = source.read_bytes()
    if subprocess.run(['git', 'cat-file', '-e', f'{commit}^{{commit}}'], cwd=root, env=GIT_ENV,
                      capture_output=True).returncode:
        raise Refused(f'no commit {commit} in this repository (fetch it first)')
    entries = tree_entries(root, commit)
    for name, target in PRIVATE_INPUTS.items():
        if target in entries:
            raise Refused(f'{target} is a file of the commit: the private input must be a new file')
    tree = git(root, 'rev-parse', '--verify', f'{commit}:android').decode().strip()
    destination.mkdir(parents=True)
    try:
        write_blobs(root, entries, destination)
        verify(entries, destination)
        for name, target in PRIVATE_INPUTS.items():
            write_new(destination / target, sources[name])
        write_new(destination / 'CANDIDATE', commit.encode() + b'\n')
    except BaseException:
        shutil.rmtree(destination, ignore_errors=True)
        raise
    print(f'exported {commit} to {destination / "android"}: {len(entries)} files of tree {tree}, and the private inputs')


def main(arguments):
    if len(arguments) != 4 or arguments[2] != '--private':
        print('usage: export_candidate.py <full SHA> <new directory> --private <directory>', file=sys.stderr)
        return 2
    commit, destination, _flag, private = arguments
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        print(f"name the candidate by its full 40-character SHA, not '{commit}'", file=sys.stderr)
        return 2
    try:
        export(commit, destination, private)
    except (Refused, OSError) as error:
        print(f'no export: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
