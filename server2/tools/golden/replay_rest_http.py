#!/usr/bin/env python3
"""Exact S02/world/widget recorders; requires a separately reviewed execution packet.

The three original producers are immutable. This verification-only boundary reuses
the qualified dependency, CJS and process supervision helpers; it never runs them
as part of server2 runtime. It is not an adversarial OS sandbox.
"""
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
from replay_delivery import child, unique
from replay_domestic_http import dependencies, input_checks, validate_cjs_audit

PROFILE = 'rest_http'
TOOLS = 'server2/tools/golden/'
EVIDENCE = 'reports/sdlc/issue-2819-oracle-provenance/phase4-b3'
VARIANTS = ('s02', 'world', 'widget')
TOOL_PATHS = ('replay_rest_http.py', 'test_replay_rest_http.py', 'guards/rest_http.cjs',
              'policies/rest_http.json', 'replay_domestic_http.py', 'replay_delivery.py', 'replay_towns.py')


def prepare(root, node, deps, manifest, out, variant):
    root = Path(root).resolve(); node = regular(node); out = Path(out).absolute()
    require(variant in VARIANTS, 'fixed remaining profile')
    require(out == out.resolve() and out.parent == root / EVIDENCE and not out.exists(), 'new owned B3 output')
    sp = regular(root / TOOLS / 'policies/rest_http.json'); spec = load(sp)
    require(spec['schema'] == 1 and spec['profile'] == PROFILE and set(spec['variants']) == set(VARIANTS), 'fixed three profiles')
    entry = spec['variants'][variant]
    require(sha(node) == spec['node_sha256'], 'official Node identity')
    version = subprocess.run([str(node), '--version'], env={'PATH': os.defpath, 'LANG': 'C'}, capture_output=True, text=True, timeout=5)
    require(version.returncode == 0 and version.stdout.strip() == spec['node_version'], 'Node16.20.2 required')
    for name, digest in {**entry['sources'], **entry['exports'], **entry['static_inputs']}.items():
        require(sha(regular(root / name)) == digest, 'selected source/export/static identity ' + name)
    depmap = dependencies(root, {'s02': deps}, {'s02': manifest}, spec, variant)
    tools = {TOOLS + name: sha(regular(root / TOOLS / name)) for name in TOOL_PATHS}
    revision = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD']).decode().strip()
    policy = dict(schema=1, profile=PROFILE, variant=variant, root=str(root), revision=revision,
                  dependency_roots=depmap, sources=entry['sources'], exports=entry['exports'],
                  output=str(out / entry['record_name']), tools=tools,
                  guard_sha256=tools[TOOLS + 'guards/rest_http.cjs'], spec_sha256=sha(sp), node_sha256=sha(node))
    return root, node, out, policy, spec


def decode_record(path, entry, variant):
    path = regular(path)
    require(path.stat().st_size <= entry['gzip_limit_bytes'], 'record file bound')
    data = path.read_bytes()
    if variant == 'world':
        with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:
            raw = stream.read(entry['inflated_limit_bytes'] + 1)
    else:
        raw = data
    require(len(raw) <= entry['inflated_limit_bytes'], 'inflated record bound')
    doc = json.loads(raw, object_pairs_hook=unique, parse_constant=lambda s: require(False, 'nonfinite JSON'))
    return doc, raw


def validate_record(path, policy, spec):
    variant = policy['variant']; entry = spec['variants'][variant]
    doc, raw = decode_record(path, entry, variant)
    require(list(doc) == entry['record_top_keys'] and type(doc['schema']) is int, 'complete ordered top fields')
    for key, value in entry['fixed_metadata'].items():
        require(doc[key] == value, 'original fixed metadata ' + key)
    source = doc['source']; expected = {**policy['sources'], **policy['exports']}
    require(list(source) == entry['source_keys'], 'complete source sections')
    require(source['files'] == {p: expected[p] for p in entry['record_source_paths']}, 'exact recorded source map')
    if variant == 'world':
        rows = doc['scenarios']; fixed = entry['scenario_inputs']
        require(isinstance(rows, list) and len(rows) == len(fixed), 'complete scenario inventory')
        for row, want in zip(rows, fixed):
            require(list(row) == ['id', 'zone', 'options', 'steps'], 'complete scenario fields')
            require({k: row[k] for k in ['id', 'zone', 'options']} == {k: want[k] for k in ['id', 'zone', 'options']}, 'scenario inputs')
            require(len(row['steps']) == len(want['steps']), 'complete step inventory')
            for step, original in zip(row['steps'], want['steps']):
                require(list(step) == ['at', 'fail', 'requests'] and step['at'] == original['at'] and step['fail'] == original['fail'], 'original step clock and fault')
                require(len(step['requests']) == len(original['requests']), 'complete request inventory')
                for request, supplied in zip(step['requests'], original['requests']):
                    require({k: request[k] for k in supplied} == supplied, 'original world request')
                    require(list(request) == [*supplied, 'status', 'content_type', 'body', 'body_sha256', 'calls', 'air'], 'complete world response')
                    require(type(request['status']) is int and isinstance(request['calls'], list) and isinstance(request['body'], str), 'world response types')
                    require(hashlib.sha256(request['body'].encode()).hexdigest() == request['body_sha256'], 'complete world body identity')
        require(isinstance(doc['bodies'], dict), 'complete provider body map')
        for digest, body in doc['bodies'].items():
            require(isinstance(body, str) and hashlib.sha256(body.encode()).hexdigest() == digest, 'provider body identity')
    else:
        require(source['revision'] == entry['logical_revision'], 'unchanged original logical revision')
        require(source['oracle_sha256'] == policy['exports'][entry['driver']] and source['dependency_lock_sha256'] == entry['dependency_lock_sha256'], 'original producer and dependency lock')
        rows = doc['cases']; require(len(rows) == len(entry['row_inputs']), 'complete case inventory')
        for row, fixed, keys in zip(rows, entry['row_inputs'], entry['row_keys']):
            require(list(row) == keys and {k: row[k] for k in fixed} == fixed, 'complete original case and clock')
            require(type(row['status']) is int and isinstance(row['headers'], list), 'complete response fields')
            body = base64.b64decode(row['body_base64'], validate=True)
            require(hashlib.sha256(body).hexdigest() == row['body_sha256'], 'complete body identity')
            headers = dict(row['headers'])
            if row['request'].get('method', 'GET') != 'HEAD' and 'content-length' in headers:
                require(str(len(body)) == headers['content-length'], 'response body framing')
        require(set(doc['network']) == {'rejected', 'accepted'} and all(type(v) is int for v in doc['network'].values()), 'network transcript')
        require(isinstance(doc['backend_coverage'], list), 'backend coverage retained')
    return doc, raw


def command_env(root, node, out, policy, spec):
    variant = policy['variant']; entry = spec['variants'][variant]
    argv = [str(node), '--require', str(root / TOOLS / 'guards/rest_http.cjs'), str(root / entry['driver'])]
    argv += [str(root), policy['output']] if variant == 'world' else ['--output', str(out)]
    if variant == 'widget': argv.append('--widget-only')
    # No initial TW_SMOKE_* keys. The canonical producer sets its own fixed clocks/scratch.
    env = dict(PATH=os.defpath, LANG='C', TZ='UTC', NODE_ENV='production', TW_REPO=str(root),
               TW_REVISION=policy['revision'], NODE_PATH=policy['dependency_roots']['s02']['path'] + '/node_modules',
               TW_ORACLE_POLICY=str(out / 'policy.json'))
    return argv, env


def execute(prepared):
    root, node, out, policy, spec = prepared; entry = spec['variants'][policy['variant']]
    out.mkdir(mode=0o700); (out / 'harness-scratch').mkdir(mode=0o700)
    pp = out / 'policy.json'; pp.write_text(json.dumps(policy, sort_keys=True) + '\n')
    command, env = command_env(root, node, out, policy, spec)
    before = input_checks(root, node, policy, spec)
    result = dict(status='BLOCKED', variant=policy['variant'], child_started=False, command=command,
                  input_checks_before=before, node_before_sha256=before['actual'][str(node)],
                  execution_base_revision=policy['revision'],
                  execution_identity='Revision is the base commit; candidate inputs and untracked named exports are identified by per-file hashes.',
                  producer_canary_boundary=('Canonical S02/widget overrides DNS lookup/resolve, HTTPS, UDP and child functions with its own rejecting canaries; net connect is checked by both producer and guard. Guard still owns listen/socket/file/module/VM boundaries.' if policy['variant'] != 'world' else 'Original world producer wraps net connect and rejects HTTPS; guard additionally rejects DNS/UDP/child and owns listen/socket/file/module/VM boundaries.'),
                  parent_safety_deadline_seconds=entry['deadline_seconds'],
                  original_whole_deadline_seconds=entry['original_deadline_seconds'])
    output = Path(policy['output'])
    try:
        require(before['verified'], 'parent pre-run identity')
        result['child_started'] = True
        info, stdout = child(command, env, out, entry['deadline_seconds']); result.update(info)
        require(info['failure'] is None and info['exit_code'] == 0, 'guarded child failed')
        receipts = []
        for line in stdout.decode().splitlines():
            try: row = json.loads(line, object_pairs_hook=unique)
            except json.JSONDecodeError: continue
            if isinstance(row, dict) and row.get('oracle_guard') == 1: receipts.append(row)
        require(len(receipts) == 1, 'single owned guard receipt')
        guard = receipts[0]
        require(guard['profile'] == PROFILE and guard['variant'] == policy['variant'] and guard['status'] == 'RECORDED' and not guard['violations'] and guard['owned_ports_remaining'] == 0 and guard['owned_sockets_remaining'] == 0, 'clean owned guard receipt')
        validate_cjs_audit(guard.get('cjs_compiles'), root, policy, spec)
        _, raw = validate_record(output, policy, spec)
        require(sha(output) == guard['output_sha256'], 'guard output identity')
        with (out / 'record.raw').open('xb') as stream: stream.write(raw)
        result.update(status='RECORDED_NOT_COMPARED', semantics='NOT_COMPARED', record_sha256=hashlib.sha256(raw).hexdigest(), output_sha256=sha(output), guard=guard)
        if policy['variant'] == 'widget':
            # Explicit current packaging, without editing or reserializing original JSON bytes.
            packed = gzip.compress(raw, compresslevel=9, mtime=0)
            require(gzip.decompress(packed) == raw, 'widget packaging payload identity')
            with (out / 'record.json.gz').open('xb') as stream: stream.write(packed)
            result['gzip_sha256'] = sha(out / 'record.json.gz')
    except (ValueError, OSError, KeyError, TypeError, EOFError, zlib.error) as error:
        result.update(status='BLOCKED', reason=str(error))
    finally:
        after = input_checks(root, node, policy, spec)
        result.update(input_checks_after=after, node_after_sha256=after['actual'][str(node)])
        if not after['verified']: result.update(status='BLOCKED', reason=result.get('reason', '') + '; parent post-run identity')
        try:
            checked = dependencies(root, {k: v['path'] for k, v in policy['dependency_roots'].items()}, {k: v['installed_manifest'] for k, v in policy['dependency_roots'].items()}, spec, policy['variant'])
            require(checked == policy['dependency_roots'], 'dependency map changed'); result['dependencies_verified_after'] = True
        except (ValueError, OSError, KeyError, TypeError) as error:
            result.update(status='BLOCKED', reason=result.get('reason', '') + '; ' + str(error), dependencies_verified_after=False)
    result['policy_sha256'] = sha(pp)
    (out / 'report.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[3])
    for name in ('node', 'deps', 'manifest', 'out'): parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--variant', choices=VARIANTS, required=True)
    parser.add_argument('--record', action='store_true', required=True, help='Requires a separate reviewed source/admission packet')
    args = parser.parse_args()
    result = execute(prepare(args.root, args.node, args.deps, args.manifest, args.out, args.variant))
    print(json.dumps({k: result[k] for k in ('status', 'variant', 'reason') if k in result}))
    return 0 if result['status'] == 'RECORDED_NOT_COMPARED' else 2


if __name__ == '__main__':
    try: raise SystemExit(main())
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print('BLOCKED remaining recorder input: ' + str(error), file=sys.stderr); raise SystemExit(2)
