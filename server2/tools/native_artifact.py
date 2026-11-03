#!/usr/bin/env python3
"""Build/export fixed Linux native verification inputs, or verify a copied bundle.

No tests, installation, provider calls or manifest-supplied commands run here.
The consumer still runs the existing checks explicitly on an owned host.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile

# A copied CLI must not create unlisted bytecode beside its frozen helpers.
sys.dont_write_bytecode = True
import native_suite
from verify_artifact import check_elf, digest, source_identity

ROOT = Path(__file__).resolve().parents[1]
TARGET = 'x86_64-unknown-linux-musl'
TESTS = ('summary', 'domestic', 'state', 'runtime_services')
EXAMPLES = ('loopback_server', 'kma_s3_replay', 'warnings_smoke', 'notice_smoke',
            'conditional_alert_smoke', 'warning_push_smoke', 'logging_smoke', 'narrative_smoke')
ROLES = tuple(native_suite.ROLES)
EXTRAS = ('logging_smoke', 'narrative_smoke')


def regular(path, base):
    """Reject symlinks at every payload path component, not only the leaf."""
    path, base = Path(path).absolute(), Path(base).absolute()
    relative = path.relative_to(base)
    for candidate in (base, *(base/p for p in relative.parents), path):
        if candidate.is_symlink():
            raise ValueError('symlink in artifact/source path')
    if not path.is_file():
        raise ValueError('missing regular artifact/source file')
    return path


def tracked_sources(root, revision):
    raw = subprocess.check_output(['git', '-C', str(root.parent), 'ls-tree', '-rz',
                                   revision, '--', 'server2'])
    files = {}
    for entry in raw.split(b'\0'):
        if not entry:
            continue
        meta, name = entry.split(b'\t', 1)
        mode, kind, oid = meta.decode().split()
        relative = Path(os.fsdecode(name)).relative_to('server2')
        if kind != 'blob' or mode not in ('100644', '100755'):
            raise ValueError('only regular tracked server2 inputs may be exported')
        payload = regular(root/relative, root).read_bytes()
        algorithm = 'sha1' if len(oid) == 40 else 'sha256'
        blob = b'blob '+str(len(payload)).encode()+b'\0'+payload
        if hashlib.new(algorithm, blob).hexdigest() != oid:
            raise ValueError('tracked source bytes differ from revision blob')
        files[relative.as_posix()] = {'sha256': hashlib.sha256(payload).hexdigest(), 'mode': mode}
    if not files:
        raise ValueError('no tracked server2 inputs')
    return files


def cargo_artifacts(messages, root, target_dir):
    """Select compiler-emitted release executables by target identity, not glob."""
    selected = {}
    release = target_dir/TARGET/'release'
    for line in messages.splitlines():
        if not line.strip():
            continue
        data = json.loads(line)
        if data.get('reason') != 'compiler-artifact' or not data.get('executable'):
            continue
        target = data['target']
        name, kinds = target['name'], target['kind']
        wanted = ((name == 'server2' and kinds == ['bin']) or
                  (name in EXAMPLES and kinds == ['example']) or
                  (name in TESTS and kinds == ['test']))
        if not wanted:
            continue
        profile = data['profile']
        if profile.get('opt_level') != '3' or profile.get('debug_assertions') is not False:
            raise ValueError('expected release Cargo artifact')
        if profile.get('test') is not (name in TESTS):
            raise ValueError('unexpected Cargo test profile')
        Path(target['src_path']).resolve().relative_to(root.resolve())
        path = regular(Path(data['executable']), release)
        if name in selected and selected[name] != path:
            raise ValueError('ambiguous Cargo executable')
        selected[name] = path
    if set(selected) != set(ROLES + EXTRAS):
        raise ValueError('missing native Cargo executable roles')
    for path in selected.values():
        check_elf(path)
    return selected


def destination(role):
    if role == 'server2':
        return 'bin/server2'
    group = 'tests' if role in TESTS else 'examples'
    return f'bin/{group}/{role}'


def export(root, output, source, executables):
    if set(executables) != set(ROLES + EXTRAS):
        raise ValueError('incomplete native executable set')
    if source_identity(root, source['revision']) != source:
        raise ValueError('source identity changed')
    sources = tracked_sources(root, source['revision'])
    hashes = {}
    for role, path in executables.items():
        regular(path, path.parent)
        check_elf(path)
        hashes[role] = digest(path)
    output = Path(output).absolute()
    # Do not export into the tracked source tree. CI uses repository reports/.
    if output.is_relative_to(root):
        raise ValueError('fresh output outside server2 required')
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.parent.resolve() != output.parent:
        raise ValueError('output parent must have no symlink aliases')
    output.mkdir(exist_ok=False)
    for name, info in sources.items():
        target = output/'source/server2'/name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(root/name, target)
        target.chmod(0o755 if info['mode'] == '100755' else 0o644)
    frozen = output/'source/server2'
    for path in frozen.rglob('*'):
        if path.is_file():
            path.chmod(0o555 if os.access(path, os.X_OK) else 0o444)
    for path in sorted((p for p in frozen.rglob('*') if p.is_dir()), reverse=True):
        path.chmod(0o555)
    frozen.chmod(0o555)
    entries = {}
    for role, original in executables.items():
        target = output/destination(role)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, target)
        target.chmod(0o755)
        if digest(target) != hashes[role] or digest(original) != hashes[role]:
            raise ValueError('executable changed during export')
        entries[role] = {'path': destination(role), 'sha256': hashes[role], 'profile': 'release'}
    manifest = {'schema': 1, 'revision': source['revision'],
                'artifacts': {role: entries[role] for role in ROLES}}
    (output/'artifacts.json').write_text(json.dumps(manifest, indent=2)+'\n')
    files = {p.relative_to(output).as_posix(): digest(p) for p in output.rglob('*') if p.is_file()}
    bundle = {'schema': 1, 'target': TARGET, 'source': source,
              'compiled_source_root': str(root.resolve()), 'roles': list(ROLES),
              'extras': {role: entries[role] for role in EXTRAS}, 'files': files,
              'production_eligible': False,
              'fixture_requirement': 'Map source/server2 to compiled_source_root before native tests; no automatic install.'}
    if source_identity(root, source['revision']) != source or tracked_sources(root, source['revision']) != sources:
        raise ValueError('source changed during export')
    (output/'bundle.json').write_text(json.dumps(bundle, indent=2)+'\n')
    verify(output)
    return bundle


def verify(output, require_source_root=False):
    output = Path(output).resolve()
    metadata = json.loads(regular(output/'bundle.json', output).read_text())
    if (metadata.get('schema') != 1 or metadata.get('target') != TARGET or
            metadata.get('roles') != list(ROLES) or metadata.get('production_eligible') is not False):
        raise ValueError('incompatible native bundle')
    expected = metadata['files']
    for name, expected_hash in expected.items():
        relative = PurePosixPath(name)
        if relative.is_absolute() or '..' in relative.parts or relative.as_posix() != name:
            raise ValueError('invalid bundle payload path')
        if digest(regular(output/name, output)) != expected_hash:
            raise ValueError('bundle payload hash mismatch: '+name)
    actual = set()
    for path in output.rglob('*'):
        if path.is_symlink():
            raise ValueError('symlink in bundle')
        if path.is_file():
            actual.add(path.relative_to(output).as_posix())
        elif not path.is_dir():
            raise ValueError('non-regular bundle entry')
    if actual != set(expected) | {'bundle.json'}:
        raise ValueError('unexpected or missing bundle payload')
    manifest = json.loads((output/'artifacts.json').read_text())
    if manifest != {'schema': 1, 'revision': metadata['source']['revision'],
                    'artifacts': {role: {'path': destination(role),
                                        'sha256': expected[destination(role)], 'profile': 'release'} for role in ROLES}}:
        raise ValueError('native manifest differs from bundle')
    extras = {role: {'path': destination(role), 'sha256': expected[destination(role)],
                     'profile': 'release'} for role in EXTRAS}
    if metadata.get('extras') != extras:
        raise ValueError('native probes differ from bundle')
    for role in ROLES + EXTRAS:
        path = output/destination(role)
        check_elf(path)
        if not os.access(path, os.X_OK):
            raise ValueError('native executable permission missing')
    compiled = Path(metadata['compiled_source_root'])
    if not compiled.is_absolute() or compiled.name != 'server2':
        raise ValueError('invalid compile-time fixture path')
    if require_source_root and compiled.resolve() != (output/'source/server2').resolve():
        raise ValueError('compile-time fixture path does not map to frozen source')
    return metadata


def archive_bundle(output, archive):
    """Retain hidden files and modes through the unchanged CI ZIP upload."""
    output, archive = output.resolve(), archive.resolve()
    before = verify(output)
    if archive.is_relative_to(output) or archive.is_relative_to(ROOT):
        raise ValueError('archive must be outside the bundle and server2')
    archive.parent.mkdir(parents=True, exist_ok=True)
    expected = {'native/'+name: value for name, value in before['files'].items()}
    expected['native/bundle.json'] = digest(output/'bundle.json')
    directories = {str(parent) for name in expected for parent in PurePosixPath(name).parents if str(parent) != '.'}
    with archive.open('xb') as file, tarfile.open(fileobj=file, mode='w:gz') as tar:
        tar.add(output, arcname='native', recursive=True)
    seen, files = set(), {}
    with tarfile.open(archive, 'r:gz') as tar:
        for item in tar:
            if item.name in seen:
                raise ValueError('duplicate archive entry')
            seen.add(item.name)
            if item.isdir() and item.name in directories:
                continue
            if not item.isfile() or item.name not in expected:
                raise ValueError('unexpected archive entry')
            h = hashlib.sha256()
            with tar.extractfile(item) as file:
                for chunk in iter(lambda: file.read(1024*1024), b''):
                    h.update(chunk)
            files[item.name] = h.hexdigest()
    if files != expected or verify(output) != before:
        raise ValueError('archive/source payload changed')
    return digest(archive)


def build(root, target_dir, output, revision):
    if sys.platform != 'linux':
        raise ValueError('native artifact build requires Linux')
    if output.exists() or output.is_symlink() or output.is_relative_to(root):
        raise ValueError('fresh output outside server2 required')
    source = source_identity(root, revision)
    probe = target_dir
    while not probe.exists():
        probe = probe.parent
    free = shutil.disk_usage(probe).free
    size = sum(p.stat().st_size for p in target_dir.rglob('*') if p.is_file() and not p.is_symlink())
    print(json.dumps({'target_dir': str(target_dir), 'target_bytes': size, 'free_bytes': free,
                      'required_free_bytes': 6 * 1024**3}), flush=True)
    if free < 6 * 1024**3:
        raise ValueError('need 3 GiB expected build space plus 3 GiB reserve')
    commands = [
        ['cargo', 'build', '--locked', '--release', '--target', TARGET,
         '--target-dir', str(target_dir), '--message-format=json', '--bin', 'server2'] +
        [item for name in EXAMPLES for item in ('--example', name)],
        ['cargo', 'test', '--locked', '--release', '--target', TARGET,
         '--target-dir', str(target_dir), '--message-format=json', '--no-run'] +
        [item for name in TESTS for item in ('--test', name)],
    ]
    # Reuse the caller's target; do not change global Cargo or release settings.
    messages = []
    for command in commands:
        print('+ '+' '.join(command), flush=True)
        messages.append(subprocess.check_output(command, cwd=root, text=True))
    return export(root, output, source, cargo_artifacts('\n'.join(messages), root, target_dir))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--output', type=Path, help='Build into a fresh bundle outside server2')
    mode.add_argument('--verify', type=Path, help='Validate copied bundle; execute no children')
    parser.add_argument('--target-dir', type=Path, default=ROOT/'target')
    parser.add_argument('--source-revision')
    parser.add_argument('--require-source-root', action='store_true')
    parser.add_argument('--archive', type=Path, help='Build only: fresh tar.gz preserving all native/ files and modes')
    args = parser.parse_args()
    if args.require_source_root and not args.verify:
        parser.error('--require-source-root requires --verify')
    if args.archive and not args.output:
        parser.error('--archive requires --output')
    try:
        if args.archive and (args.archive.exists() or args.archive.is_symlink()):
            raise ValueError('fresh archive required')
        if args.archive and (args.archive.resolve().is_relative_to(args.output.resolve()) or
                             args.archive.resolve().is_relative_to(ROOT.resolve())):
            raise ValueError('archive must be outside the bundle and server2')
        if args.verify:
            data = verify(args.verify, args.require_source_root)
        else:
            data = build(ROOT, args.target_dir.resolve(), args.output.resolve(), args.source_revision)
            if args.archive:
                print(json.dumps({'archive_sha256': archive_bundle(args.output, args.archive)}), flush=True)
        print(json.dumps({'status': 'PASS', 'roles': len(data['roles']), 'probes': len(data['extras']),
                          'source': data['source'], 'compiled_source_root': data['compiled_source_root'],
                          'production_eligible': False}, sort_keys=True))
        return 0
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print('BLOCKED: '+str(error), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
