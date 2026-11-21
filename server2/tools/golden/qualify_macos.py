"""Capture eight original HTTP corpora on the Apple Silicon qualification branch."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
import tarfile

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parents[2]
EVIDENCE = ROOT / 'reports/sdlc/issue-2819-oracle-provenance/phase4-b3'
BUNDLE = ROOT / 'reports/mac-qualification'
FIXTURES = {
    'kma': 'domestic/fixtures/oracle.json.gz',
    'older': 'legacy_versions/fixtures/kma-older.json.gz',
    'town': 'legacy_versions/fixtures/kma-town.json.gz',
    'core': 'domestic/fixtures/s3-response.json.gz',
    'rich': 'domestic/fixtures/s3-rich-response.json.gz',
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verified_node(tempdir, expected):
    cached = Path(shutil.which('node')).resolve()
    if digest(cached) == expected:
        return cached
    release = 'node-v16.20.2-darwin-arm64'
    archive = tempdir / (release + '.tar.gz')
    url = 'https://nodejs.org/dist/v16.20.2/' + archive.name
    subprocess.run(['curl', '--fail', '--location', '--silent', '--show-error',
                    '--proto', '=https', '--max-time', '90', '-o', str(archive), url], check=True)
    binary = tempdir / 'node'
    with tarfile.open(archive, 'r:gz') as bundle:
        member = bundle.getmember(release + '/bin/node')
        if not member.isfile() or member.size > 180 * 1024 * 1024:
            raise ValueError('invalid Node archive member')
        with bundle.extractfile(member) as source, binary.open('xb') as dest:
            shutil.copyfileobj(source, dest)
    if digest(binary) != expected:
        raise ValueError('official distribution binary did not match the approved digest')
    binary.chmod(0o700)
    return binary


def install(prefix, manifest_dir):
    prefix.mkdir()
    for name in ['package.json', 'package-lock.json']:
        shutil.copyfile(ROOT / manifest_dir / name, prefix / name)
    subprocess.run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=prefix, check=True)
    inventory = {'regular_files': {}, 'symlinks': {}}
    for path in sorted((prefix / 'node_modules').rglob('*')):
        name = str(path.relative_to(prefix))
        if path.is_symlink():
            inventory['symlinks'][name] = os.readlink(path)
        elif path.is_file():
            inventory['regular_files'][name] = digest(path)
    manifest = prefix / 'inventory.json'
    manifest.write_text(json.dumps(inventory))
    return manifest


def read_json(path):
    data = path.read_bytes()
    if data.startswith(b'\x1f\x8b'):
        data = gzip.decompress(data)
    return json.loads(data)


def summary_value(value):
    if isinstance(value, str) and len(value) > 160:
        data = value.encode()
        return {'utf8_bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    return value


def compare(prior, actual, path, differences):
    if type(prior) is not type(actual):
        differences.append([path, 'type', type(prior).__name__, type(actual).__name__])
    elif isinstance(prior, dict):
        if list(prior) != list(actual):
            differences.append([path, 'keys/order', list(prior), list(actual)])
        for key in prior.keys() & actual.keys():
            compare(prior[key], actual[key], path + [key], differences)
    elif isinstance(prior, list):
        if len(prior) != len(actual):
            differences.append([path, 'length', len(prior), len(actual)])
        for index, (a, b) in enumerate(zip(prior, actual)):
            compare(a, b, path + [index], differences)
    elif prior != actual:
        differences.append([path, 'value', summary_value(prior), summary_value(actual)])


def replay(group, spec, variant, node, deps):
    entry = spec['variants'][variant]
    args = [sys.executable, str(TOOLS / ('replay_' + group + '.py')),
            '--record', '--root', str(ROOT), '--node', str(node), '--variant', variant]
    for name in entry['dependency_groups']:
        prefix, manifest = deps[name]
        args.extend(['--deps' if group == 'rest_http' else '--' + name + '-deps', str(prefix),
                     '--manifest' if group == 'rest_http' else '--' + name + '-manifest', str(manifest)])
    outputs = []
    for attempt in (1, 2):
        run = variant + '-' + str(attempt)
        out = EVIDENCE / run
        capture = BUNDLE / run
        capture.mkdir()
        with (capture / 'parent.log').open('xb') as log:
            result = subprocess.run(args + ['--out', str(out)], stdout=log, stderr=log)
        for name in ('stdout.log', 'stderr.log', 'report.json', 'policy.json'):
            if (out / name).is_file():
                shutil.copyfile(out / name, capture / name)
        if result.returncode:
            # Retain just the declared source inventory of any rejected record as a diagnostic.
            # Rejected records cannot enter the pair or supply a baseline.
            for failed in [*sorted(out.glob('failed-*')), out / entry['record_name']]:
                try:
                    source = read_json(failed)['source']['files']
                except (ValueError, KeyError, EOFError, OSError):
                    continue
                if isinstance(source, dict):
                    (capture / 'unqualified-source-names.json').write_text(json.dumps(sorted(source)))
            print('Unqualified', run, flush=True)
            return False
        output = out / ('record.json.gz' if variant == 'widget' else entry['record_name'])
        shutil.copyfile(output, capture / output.name)
        outputs.append(output)
    if outputs[0].read_bytes() != outputs[1].read_bytes():
        raise ValueError('inconsistent pair: ' + variant)
    prior = ROOT / entry['fixture'] if group == 'rest_http' else ROOT / 'server2/tests' / FIXTURES[variant]
    differences = []
    compare(read_json(prior), read_json(outputs[1]), [], differences)
    semantic_changes = [row for row in differences if row[0][:2] != ['source', 'files']]
    status = 'REVIEW_REQUIRED' if semantic_changes else 'REPLAYED'
    (BUNDLE / (variant + '-comparison.json')).write_text(json.dumps({
        'status': status, 'prior': digest(prior), 'actual': digest(outputs[1]), 'typed_differences': differences}, indent=2))
    print(variant, 'repeatable;', len(differences), 'typed differences', flush=True)
    return not semantic_changes


def main():
    BUNDLE.mkdir(parents=True)
    EVIDENCE.mkdir(parents=True)
    if (platform.system(), platform.machine()) != ('Darwin', 'arm64'):
        raise RuntimeError('requires a Darwin ARM64 runner')
    specs = {group: json.loads((TOOLS / 'policies' / (group + '.json')).read_text())
             for group in ('rest_http', 'domestic_http')}
    expected, = {spec['node_sha256'] for spec in specs.values()}
    success = True
    with tempfile.TemporaryDirectory(dir=Path(os.environ['RUNNER_TEMP']).resolve()) as tempdir:
        node = verified_node(Path(tempdir), expected)
        print('Pinned Node executable', digest(node), flush=True)
        deps = {}
        failed_deps = set()
        for group, spec in specs.items():
            for name, meta in spec['dependency_roots'].items():
                if name not in deps and name not in failed_deps:
                    prefix = Path(tempdir) / name
                    try:
                        deps[name] = (prefix, install(prefix, meta['manifest_dir']))
                    except subprocess.CalledProcessError:
                        failed_deps.add(name)
                        success = False
            for variant, entry in spec['variants'].items():
                if not all(name in deps for name in entry['dependency_groups']):
                    print('Missing dependencies', variant, flush=True)
                    continue
                success = replay(group, spec, variant, node, deps) and success
    return 0 if success else 1


if __name__ == '__main__':
    sys.exit(main())
