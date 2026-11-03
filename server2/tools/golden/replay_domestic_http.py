#!/usr/bin/env python3
"""Five fixed full domestic HTTP recorders. Execution requires a separate root gate."""
import argparse
import base64
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import zlib
from replay_towns import require, regular, load, sha
# Qualified bounded process-group deadline/stream drain/reap and strict duplicate decoder.
from replay_delivery import child, unique

PROFILE = 'domestic_http'
TOOLS = 'server2/tools/golden/'
EVIDENCE = 'reports/sdlc/issue-2819-oracle-provenance/phase4-b3'


def dependencies(root, roots, manifests, spec, variant):
    selected = spec['variants'][variant]['dependency_groups']
    require(set(roots) == set(manifests) == set(selected), 'exact selected dependency roots')
    result = {}
    for group, base in roots.items():
        deps = regular(Path(base) / 'package.json').parent
        meta = spec['dependency_roots'][group]
        for name, key in [('package.json', 'manifest_sha256'), ('package-lock.json', 'lock_sha256')]:
            require(sha(regular(deps / name)) == sha(regular(root / meta['manifest_dir'] / name)) == meta[key], 'exact original dependency manifest/lock')
        lock = load(deps / 'package-lock.json')
        require(lock['packages']['']['dependencies'] == meta['direct_dependencies'], 'exact direct pins')
        require(len(lock['packages']) - 1 == meta['packages'], 'complete locked graph')
        manifest_path = regular(manifests[group]); manifest = load(manifest_path)
        require(set(manifest) == {'regular_files', 'symlinks'}, 'installed file map')
        actual = {str(p.relative_to(deps)) for p in (deps / 'node_modules').rglob('*') if p.is_file() or p.is_symlink()}
        require(actual == set(manifest['regular_files']) | set(manifest['symlinks']), 'complete installed inventory')
        for name, target in manifest['symlinks'].items():
            p = deps / name
            require(name.startswith('node_modules/') and Path(name).parent.name == '.bin' and '..' not in Path(name).parts, 'internal bin path')
            require(p.is_symlink() and str(p.readlink()) == target and p.resolve().is_file() and p.resolve().is_relative_to(deps / 'node_modules'), 'internal bin link')
        for name, digest in manifest['regular_files'].items():
            require(name.startswith('node_modules/') and not Path(name).is_absolute() and '..' not in Path(name).parts, 'installed path')
            require(sha(regular(deps / name)) == digest, 'installed identity')
        for name, pkg in lock['packages'].items():
            if not name:
                continue
            require(pkg['resolved'].startswith('https://registry.npmjs.org/') and pkg.get('integrity'), 'official locked origin')
            filename = name + '/package.json'; raw = regular(deps / filename).read_bytes()
            require(hashlib.sha256(raw).hexdigest() == manifest['regular_files'].get(filename), 'vendor metadata exact bytes')
            # Node-compatible vendor metadata decoding only after containment and hash binding.
            require(json.loads(raw)['version'] == pkg['version'], 'locked effective vendor version')
        result[group] = {'path': str(deps), 'files': manifest['regular_files'], 'installed_manifest': str(manifest_path), 'installed_manifest_sha256': sha(manifest_path)}
    return result


def prepare(root, node, roots, manifests, out, variant):
    root = Path(root).resolve(); node = regular(node); out = Path(out).absolute()
    require(out == out.resolve() and out.parent == root / EVIDENCE and not out.exists(), 'new owned B3 output')
    sp = regular(root / TOOLS / 'policies/domestic_http.json'); spec = load(sp)
    require(spec['schema'] == 1 and spec['profile'] == PROFILE and set(spec['variants']) == {'kma', 'older', 'town', 'core', 'rich'}, 'fixed five profiles')
    entry = spec['variants'][variant]
    require(sha(node) == spec['node_sha256'], 'official Node identity')
    version = subprocess.run([str(node), '--version'], env={'PATH': os.defpath, 'LANG': 'C'}, capture_output=True, text=True, timeout=5)
    require(version.returncode == 0 and version.stdout.strip() == spec['node_version'], 'Node16.20.2 required')
    for name, digest in {**entry['sources'], **entry['exports'], **entry['static_inputs']}.items():
        require(sha(regular(root / name)) == digest, 'selected source/export/static identity ' + name)
    deps = dependencies(root, roots, manifests, spec, variant)
    tool_paths = ['replay_domestic_http.py', 'test_replay_domestic_http.py', 'guards/domestic_http.cjs', 'policies/domestic_http.json', 'replay_delivery.py', 'replay_towns.py']
    tools = {TOOLS + name: sha(regular(root / TOOLS / name)) for name in tool_paths}
    revision = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD']).decode().strip()
    policy = {'schema': 1, 'profile': PROFILE, 'variant': variant, 'root': str(root), 'revision': revision, 'dependency_roots': deps, 'sources': entry['sources'], 'exports': entry['exports'], 'output': str(out / entry['record_name']), 'tools': tools, 'guard_sha256': tools[TOOLS + 'guards/domestic_http.cjs'], 'spec_sha256': sha(sp), 'node_sha256': sha(node)}
    return root, node, out, policy, spec


def input_checks(root, node, policy, spec):
    entry = spec['variants'][policy['variant']]
    expected = {str(root / p): h for p, h in {**policy['sources'], **policy['exports'], **entry['static_inputs'], **policy['tools']}.items()}
    expected[str(node)] = policy['node_sha256']; actual = {}; errors = {}
    for name in expected:
        try:
            actual[name] = sha(regular(name))
        except (ValueError, OSError) as error:
            actual[name] = None; errors[name] = str(error)
    mismatches = [name for name in expected if expected[name] != actual[name]]
    return {'expected': expected, 'actual': actual, 'mismatches': mismatches, 'errors': errors, 'verified': not mismatches}


def decode_record(path, entry):
    path = regular(path)
    require(path.stat().st_size <= entry['gzip_limit_bytes'], 'compressed record bound')
    with gzip.GzipFile(fileobj=io.BytesIO(path.read_bytes())) as stream:
        raw = stream.read(entry['inflated_limit_bytes'] + 1)
    require(len(raw) <= entry['inflated_limit_bytes'], 'inflated record bound')
    return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda s: require(False, 'nonfinite JSON')), raw


def validate_record(path, policy, spec):
    entry = spec['variants'][policy['variant']]; doc, raw = decode_record(path, entry)
    require(type(doc['schema']) is int and doc['schema'] == 1 and list(doc) == entry['record_top_keys'], 'complete ordered top fields')
    require(doc['oracle'] == entry['oracle'], 'exact pinned runtime metadata')
    for name, value in entry['fixed_metadata'].items():
        require(doc[name] == value, 'original fixed metadata ' + name)
    expected = {**policy['sources'], **policy['exports']}
    source = doc['source']
    require(list(source) == entry['source_keys'], 'complete source sections')
    require(source['files'] == {p: expected[p] for p in entry['record_source_paths']}, 'exact recorded source map')
    if entry['source_helper_files'] is not None:
        require(source['helper_files'] == entry['source_helper_files'], 'unchanged logical original helpers')
        require(source['dependency_packages'] == entry['source_dependency_packages'], 'original dependency metadata bytes')
        require(source['static_inputs'] == entry['static_inputs'], 'complete exact static inputs')
    rows = doc[entry['row_field']]
    require(isinstance(rows, list) and [r['id'] for r in rows] == entry['row_ids'], 'complete ordered corpus')
    require([sorted(r) for r in rows] == entry['row_keys'], 'complete response fields')
    for row, fixed in zip(rows, entry['row_inputs']):
        require({k: row[k] for k in fixed} == fixed, 'original request and clock')
        require(type(row['status']) is int and isinstance(row['calls' if entry['row_field'] == 'scenarios' else 'dependency_trace'], list), 'response status/full call transcript')
        if entry['row_field'] == 'scenarios':
            require(isinstance(row['body'], str), 'complete response body')
            body = row['body'].encode('utf8')
        else:
            body = base64.b64decode(row['body_base64'], validate=True)
            require(isinstance(row['headers'], dict), 'complete response headers')
            # HEAD carries representation Content-Length without an entity body.
            if row.get('method', 'GET') != 'HEAD' and 'content-length' in row['headers']:
                require(str(len(body)) == row['headers']['content-length'], 'response body framing')
        require(hashlib.sha256(body).hexdigest() == row['body_sha256'], 'complete body identity')
    for name, keys in entry['raw_keys'].items():
        require(isinstance(doc[name], list) and [sorted(r) for r in doc[name]] == keys, 'complete ordered ' + name)
    if entry['rich_input_keys']:
        require(sorted(doc['rich_inputs']) == entry['rich_input_keys'], 'all eight rich input sections')
    for name, keys in entry['extra_fields'].items():
        require(sorted(doc[name]) == keys, 'complete extra section ' + name)
    return doc, raw


def validate_cjs_audit(rows, root, policy, spec):
    require(type(rows) is list and 0 < len(rows) <= 4096, 'CJS audit row count')
    encoded = json.dumps(rows, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf8')
    require(len(encoded) <= 1024*1024, 'CJS audit byte bound')
    root = Path(root)
    require(root.is_absolute() and str(root) == str(root.resolve()), 'CJS audit root')
    expected = {}

    def add(base, relative, digest):
        require(type(relative) is str and relative and not Path(relative).is_absolute() and str(Path(relative)) == relative and '..' not in Path(relative).parts, 'CJS expected path')
        require(type(digest) is str and len(digest) == 64 and all(c in '0123456789abcdef' for c in digest), 'CJS expected digest')
        filename = str(base / relative)
        require(filename not in expected or expected[filename] == digest, 'CJS conflicting expected identity')
        expected[filename] = digest

    # Build from independently bound input maps only, never from receipt claims or static/tool files.
    for mapping in (policy['sources'], policy['exports']):
        for relative, digest in mapping.items():
            add(root, relative, digest)
    for package in policy['dependency_roots'].values():
        base = Path(package['path'])
        require(base.is_absolute() and str(base) == str(base.resolve()), 'CJS dependency root')
        for relative, digest in package['files'].items():
            require(relative.startswith('node_modules/'), 'CJS expected installed path')
            add(base, relative, digest)
    driver_relative = spec['variants'][policy['variant']]['driver']
    driver = str(root / driver_relative)
    require(driver_relative in policy['exports'] and driver in expected and expected[driver] == policy['exports'][driver_relative], 'CJS selected entry identity')
    has_driver = False
    for row in rows:
        require(type(row) is dict and set(row) == {'filename', 'sha256'}, 'CJS audit row keys')
        filename, digest = row['filename'], row['sha256']
        require(type(filename) is str and filename in expected and Path(filename).suffix in ('.js', '.cjs'), 'CJS audit filename')
        # Membership comes first: never resolve an unlisted receipt-supplied path on the host.
        require(filename == str(Path(filename)) == str(Path(filename).resolve()), 'CJS audit canonical filename')
        require(type(digest) is str and len(digest) == 64 and all(c in '0123456789abcdef' for c in digest), 'CJS audit digest format')
        require(digest == expected[filename], 'CJS audit digest identity')
        has_driver = has_driver or filename == driver
    require(has_driver, 'CJS selected entry missing')
    return rows


def execute(prepared):
    root, node, out, policy, spec = prepared; entry = spec['variants'][policy['variant']]
    out.mkdir(mode=0o700); (out / 'harness').mkdir(mode=0o700)
    pp = out / 'policy.json'; pp.write_text(json.dumps(policy, sort_keys=True) + '\n')
    command = [str(node), '--require', str(root / TOOLS / 'guards/domestic_http.cjs'), str(root / entry['driver']), str(root), policy['output']]
    primary = 'rich' if policy['variant'] == 'rich' else 's02'
    env = {'PATH': os.defpath, 'LANG': 'C', 'TZ': 'UTC', 'NODE_ENV': 'production', 'TW_REPO': str(root), 'TW_REVISION': policy['revision'], 'NODE_PATH': policy['dependency_roots'][primary]['path'] + '/node_modules', 'TW_ORACLE_POLICY': str(pp), 'TW_SMOKE_OUTPUT_DIR': str(out / 'harness')}
    before = input_checks(root, node, policy, spec)
    result = {'status': 'BLOCKED', 'variant': policy['variant'], 'child_started': False, 'command': command, 'input_checks_before': before, 'node_before_sha256': before['actual'][str(node)]}
    output = Path(policy['output'])
    try:
        require(before['verified'], 'parent pre-run identity')
        result['child_started'] = True
        info, stdout = child(command, env, out, entry['deadline_seconds']); result.update(info)
        require(info['failure'] is None and info['exit_code'] == 0, 'guarded child failed')
        receipts = []
        for line in stdout.decode().splitlines():
            try:
                row = json.loads(line, object_pairs_hook=unique)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict) and row.get('oracle_guard') == 1:
                receipts.append(row)
        require(len(receipts) == 1 and receipts[0]['profile'] == PROFILE and receipts[0]['variant'] == policy['variant'] and receipts[0]['status'] == 'RECORDED' and not receipts[0]['violations'] and receipts[0]['owned_ports_remaining'] == 0 and receipts[0]['owned_sockets_remaining'] == 0, 'clean owned guard receipt')
        validate_cjs_audit(receipts[0].get('cjs_compiles'), root, policy, spec)
        _, raw = validate_record(output, policy, spec)
        require(sha(output) == receipts[0]['output_sha256'], 'guard output identity')
        with (out / 'record.raw').open('xb') as stream:
            stream.write(raw)
        result.update(status='RECORDED_NOT_COMPARED', semantics='NOT_COMPARED', record_sha256=hashlib.sha256(raw).hexdigest(), gzip_sha256=sha(output), guard=receipts[0])
    except (ValueError, OSError, KeyError, TypeError, EOFError, zlib.error) as error:
        result.update(status='BLOCKED', reason=str(error))
    finally:
        after = input_checks(root, node, policy, spec)
        result.update(input_checks_after=after, node_after_sha256=after['actual'][str(node)])
        if not after['verified']:
            result.update(status='BLOCKED', reason=result.get('reason', '') + '; parent post-run identity')
        try:
            checked = dependencies(root, {k: v['path'] for k, v in policy['dependency_roots'].items()}, {k: v['installed_manifest'] for k, v in policy['dependency_roots'].items()}, spec, policy['variant'])
            require(checked == policy['dependency_roots'], 'dependency map changed'); result['dependencies_verified_after'] = True
        except (ValueError, OSError, KeyError, TypeError) as error:
            result.update(status='BLOCKED', reason=result.get('reason', '') + '; ' + str(error), dependencies_verified_after=False)
    if result['status'] == 'BLOCKED' and output.exists():
        output.rename(out / 'failed-record.json.gz'); result['retained_failed_output'] = str(out / 'failed-record.json.gz')
    result['policy_sha256'] = sha(pp)
    (out / 'report.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[3])
    for name in ('node', 'out'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--variant', choices=('kma', 'older', 'town', 'core', 'rich'), required=True)
    for group in ('s02', 'rich', 'models'):
        parser.add_argument('--' + group + '-deps', type=Path); parser.add_argument('--' + group + '-manifest', type=Path)
    parser.add_argument('--record', action='store_true', required=True, help='Requires separate root execution gate and CPU window')
    args = parser.parse_args(); groups = [g for g in ('s02', 'rich', 'models') if getattr(args, g + '_deps') is not None or getattr(args, g + '_manifest') is not None]
    result = execute(prepare(args.root, args.node, {g: getattr(args, g + '_deps') for g in groups}, {g: getattr(args, g + '_manifest') for g in groups}, args.out, args.variant))
    print(json.dumps(result, sort_keys=True)); return 0 if result['status'] == 'RECORDED_NOT_COMPARED' else 2


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print('BLOCKED domestic input: ' + str(error), file=sys.stderr); raise SystemExit(2)
