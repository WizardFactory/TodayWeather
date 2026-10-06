#!/usr/bin/env python3
"""Explicit offline recording/verification. Never silently updates the baseline."""
import argparse
import base64
import binascii
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path, PurePosixPath

BACKENDS = {'domestic-v000901', 'domestic-v000902', 'domestic-v000903',
            'town-v000705', 'town-v000803', 'world-v000901', 'world-v000902',
            'world-v000903', 'nation', 'special', 'push'}
ORACLE_PARTS = ('server', 'test', 'offline', 'golden-record.js')

def oracle_path(root, declaration):
    """Reviewed test-only orchestration exception, not a runtime legacy import."""
    root = root.resolve()
    named = '/'.join(ORACLE_PARTS)
    outside = [e for e in declaration.get('outside', []) if e.get('category') == 'legacy-oracle']
    if len(outside) != 1 or outside[0].get('path') != named:
        raise ValueError('exact named legacy oracle declaration required')
    path = root.joinpath(*ORACLE_PARTS)
    if any(p.is_symlink() for p in [path, *path.parents] if p == root or root in p.parents):
        raise ValueError('symlink legacy oracle rejected')
    if path.resolve() != root.resolve().joinpath(*ORACLE_PARTS) or not path.is_file():
        raise ValueError('canonical legacy oracle file missing')
    return path

def validate_record(record, inventory):
    if record.get('schema') != 1 or record.get('inventory') != inventory:
        raise ValueError('inventory identity mismatch')
    cases = record.get('cases', [])
    ids = [c.get('id') for c in cases]
    if len(set(ids)) != len(ids) or any(not i for i in ids):
        raise ValueError('duplicate or empty case ID')
    groups = {f"{g['method']} {g['path']}" for g in inventory}
    covered = {c.get('group') for c in cases}
    if not groups <= covered:
        raise ValueError('inventory coverage incomplete')
    derived = {c.get('backend') for c in cases if c.get('backend')}
    if not BACKENDS <= derived or set(record.get('backend_coverage', [])) != derived:
        raise ValueError('actual backend coverage incomplete')
    source = record.get('source', {})
    if len(source.get('revision', '')) != 40 or not source.get('files'):
        raise ValueError('source provenance missing')
    for name, digest in source['files'].items():
        p = PurePosixPath(name)
        if not name.startswith('server/') or p.is_absolute() or '..' in p.parts or not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest):
            raise ValueError('source provenance path/hash invalid')
    for c in cases:
        if c.get('handler') not in source['files']:
            raise ValueError('handler provenance missing')
        if c.get('backend') and not c.get('dependency_trace'):
            raise ValueError('backend execution trace missing')
        if not c.get('handler') or not isinstance(c.get('status'), int) or not isinstance(c.get('headers'), list):
            raise ValueError('actual handler/status/headers missing')
        try:
            raw = base64.b64decode(c['body_base64'], validate=True)
        except (KeyError, ValueError, binascii.Error) as e:
            raise ValueError('invalid raw body encoding') from e
        if hashlib.sha256(raw).hexdigest() != c.get('body_sha256'):
            raise ValueError('raw body hash mismatch')
    return record

def compare_bytes(expected, actual):
    if expected != actual:
        raise ValueError('baseline differs; inspect explicit record output, never auto-update')

def record(root, output, node):
    declaration = json.loads((root/'server2/config/tasks/S02.json').read_text())
    oracle = oracle_path(root, declaration)
    output.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, TZ='UTC', NODE_ENV='production')
    # Remove host live-mode and credential hints rather than forwarding them to the oracle.
    for key in list(env):
        if key.startswith(('TW_VC_', 'TW_SMOKE_', 'VC_SECRET', 'AWS_', 'MONGO_', 'PUSH_', 'KMA_')):
            env.pop(key)
    subprocess.run([node, str(oracle), '--output', str(output.resolve())], cwd=root,
                   env=env, check=True, timeout=120)
    result_path = output/'records.json'
    data = json.loads(result_path.read_text())
    inventory = json.loads((root/'server2/tests/golden/inventory.json').read_text())['groups']
    validate_record(data, inventory)
    if hashlib.sha256(oracle.read_bytes()).hexdigest() != data['source'].get('oracle_sha256'):
        raise ValueError('oracle source hash mismatch')
    lock = root/'server2/tools/golden/package-lock.json'
    if hashlib.sha256(lock.read_bytes()).hexdigest() != data['source'].get('dependency_lock_sha256'):
        raise ValueError('dependency lock hash mismatch')
    # Legacy source reads stay in the named recorder. Returned source hashes are
    # compared byte-for-byte with the baseline; this consumer never imports legacy.
    return result_path.read_bytes()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['record', 'verify'])
    parser.add_argument('--output', type=Path)
    parser.add_argument('--node', default=os.environ.get('GOLDEN_NODE', 'node'))
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    if args.command == 'record':
        if not args.output: parser.error('record requires explicit --output')
        content = record(root, args.output, args.node)
    else:
        with tempfile.TemporaryDirectory(prefix='server2-golden-') as t:
            p = Path(t); a = record(root, p/'first', args.node); b = record(root, p/'second', args.node)
            if a != b: raise ValueError('two fresh recordings differ')
            baseline = (root/'server2/tests/golden/records.json').read_bytes()
            compare_bytes(baseline, a)
            content = a
    data = json.loads(content)
    print(json.dumps({'outcome':'passed','groups':len(data['inventory']), 'cases':len(data['cases']),
                      'backend_coverage':data['backend_coverage'], 'sha256':hashlib.sha256(content).hexdigest()}))

if __name__ == '__main__': main()
