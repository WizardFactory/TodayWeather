#!/usr/bin/env python3
"""Real CLI execute path against owned loopback S3; synthetic private bundle only.

The Rust client signs requests. The volatile peer does not validate SigV4, IAM or TLS.
No real environment, Mongo, provider, sender or operational freeze is used.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests/storage'))
import catalog_peer


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def child(binary, root, command, bundle, operation, directory, expected=0):
    env = {'PATH': os.defpath, 'LANG': 'C', 'TMPDIR': str(directory)}
    log = directory / (command + '-' + str(len(list(directory.glob('*.log')))) + '.log')
    with log.open('w') as output:
        process = subprocess.Popen([str(binary), root, command, str(bundle), str(operation)],
                                   cwd=directory, env=env, stdout=output,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = process.wait(timeout=45)
        except BaseException:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=3)
            raise
    assert code == expected, f'{command} exit {code}: inspect {log.name}'
    values = []
    for line in log.read_text().splitlines():
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict) and isinstance(value.get('status'), str):
            values.append(value)
    return values[-1] if values else {'exit': code}


def case(binary, out, mode):
    fault = mode == 'lost-response'
    directory = out / mode
    directory.mkdir(mode=0o700)
    bundle = directory / 'bundle.json'
    bundle.write_bytes((ROOT / 'tests/state/fixtures/final-copy.json').read_bytes())
    bundle.chmod(0o600)
    source_hash = digest(bundle)
    operation = directory / 'operation.json'
    peer = catalog_peer.make(persistent=True)
    thread = threading.Thread(target=peer.serve_forever, daemon=True)
    thread.start()
    endpoint = f'http://127.0.0.1:{peer.server_port}/'
    try:
        seeded = child(binary, endpoint, 'seed', bundle, operation, directory)
        assert seeded['source_records'] == 3 and seeded['native_records'] == 1
        with peer.lock:
            claims = {k: v.body for k, v in peer.objects.items() if '/delivery/' in k}
            before = set(peer.objects)
        preview = child(binary, endpoint, 'preview', bundle, operation, directory)
        assert preview['status'] == 'PREVIEW'
        assert preview['counts']['source_absent_delete'] == 1
        assert preview['counts']['native_created_kept'] == 1
        with peer.lock:
            assert set(peer.objects) == before, 'preview must not write'
        op = json.loads(operation.read_text())
        key = f"index/v2/push/state/journal/{op['mark']['seq']:012}.json"
        if mode in ('unknown', 'partial-custody'):
            if mode == 'unknown':
                peer.original_bodies = []
                peer.failed_read = False
                class Unknown(catalog_peer.Handler):
                    def dispatch(self):
                        path = unquote(urlsplit(self.path).path)
                        requested = path.split('/', 2)[2] if len(path.split('/', 2)) == 3 else ''
                        if requested == key and self.command == 'PUT' and not peer.original_bodies:
                            body = self.rfile.read(int(self.headers.get('content-length', 0)))
                            with peer.lock:
                                peer.original_bodies.append(body)
                                peer.counts['PUT ' + key] = peer.counts.get('PUT ' + key, 0) + 1
                                peer.failed_read = True
                            self.close_connection = True
                            return
                        if requested == key and self.command == 'GET' and peer.failed_read:
                            peer.failed_read = False
                            return self.send(503)
                        return super().dispatch()
                    do_GET = do_HEAD = do_PUT = do_POST = do_DELETE = dispatch
                peer.RequestHandlerClass = Unknown
            else:
                attempt = Path(str(operation) + '.attempt.json')
                attempt.write_bytes(b'{"partial":')
                attempt.chmod(0o600)
            pending = child(binary, endpoint, 'apply', bundle, operation, directory, expected=1)
            assert pending['status'] == 'SETTLEMENT_REQUIRED'
            with peer.lock:
                attempted = peer.counts.get('PUT ' + key, 0)
            assert attempted == (1 if mode == 'unknown' else 0)
            again = child(binary, endpoint, 'apply', bundle, operation, directory, expected=1)
            assert again['status'] == 'SETTLEMENT_REQUIRED'
            with peer.lock:
                assert peer.counts.get('PUT ' + key, 0) == attempted, 'fresh apply must not resend original'
            settled = child(binary, endpoint, 'settle', bundle, operation, directory, expected=1)
            assert settled['status'] == 'NOT_APPLIED'
            with peer.lock:
                assert peer.counts.get('PUT ' + key, 0) == attempted + 1
                assert json.loads(peer.objects[key].body)['void'] is True
                assert {k: v.body for k, v in peer.objects.items() if '/delivery/' in k} == claims
            assert digest(bundle) == source_hash
            return {'verdict': 'PASS', 'pending': pending['status'], 'reapply': again['status'],
                    'settled': settled['status'], 'original_payload_attempts': attempted,
                    'conditional_voids': 1, 'claims_byte_identical': len(claims),
                    'production_eligible': False, 'operational_freeze_verified': False}
        if fault:
            with peer.lock:
                peer.mode, peer.fault_key = 'drop-commit', key
        applied = child(binary, endpoint, 'apply', bundle, operation, directory)
        assert applied['status'] == 'COMMITTED'
        assert not applied['operational_freeze_verified'] and not applied['production_eligible']
        verified = child(binary, endpoint, 'verify', bundle, operation, directory)
        assert verified['status'] == 'VERIFIED'
        with peer.lock:
            puts = sum(n for k, n in peer.counts.items() if k.startswith('PUT '))
            actual = peer.objects[key].body
            assert actual == bytes(op['encoded']), 'checked operation bytes must be exact wire bytes'
            assert {k: v.body for k, v in peer.objects.items() if '/delivery/' in k} == claims
        again = child(binary, endpoint, 'apply', bundle, operation, directory)
        assert again['status'] == 'ALREADY_COMMITTED'
        with peer.lock:
            assert sum(n for k, n in peer.counts.items() if k.startswith('PUT ')) == puts
            assert peer.counts.get('PUT ' + key, 0) == 1, 'original payload must never be resent'
        # Wrong source bundle cannot be silently re-planned into a new destructive operation.
        stale = directory / 'stale.json'
        value = json.loads(bundle.read_text())
        value['final_export']['collections'][0]['count'] += 1
        stale.write_text(json.dumps(value))
        stale.chmod(0o600)
        child(binary, endpoint, 'apply', stale, operation, directory, expected=2)
        assert digest(bundle) == source_hash
        with peer.lock:
            assert sum(n for k, n in peer.counts.items() if k.startswith('PUT ')) == puts
        return {'verdict': 'PASS', 'source_absent_delete': 1, 'native_only_preserved': 1,
                'claims_byte_identical': len(claims), 'final_original_puts': 1,
                'response_loss': fault, 'fresh_verify': verified['status'],
                'reapply': again['status'], 'stale_export_blocked': True,
                'bundle_sha256': source_hash, 'operation_sha256': digest(operation),
                'production_eligible': False, 'device_sends': 0,
                'device_sends_scope': 'no sender/provider constructed; not a device counter'}
    finally:
        peer.shutdown()
        peer.server_close()
        thread.join(timeout=5)
        assert not thread.is_alive(), 'owned peer retirement'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    binary, out = Path(args.binary).resolve(), Path(args.out).resolve()
    if not binary.is_file() or out == ROOT or ROOT in out.parents:
        parser.error('existing retained binary and new output outside server2 required')
    out.mkdir(parents=True, exist_ok=False, mode=0o700)
    original = digest(binary)
    report = {'verdict': 'FAIL', 'binary_sha256': original,
              'scope': 'owned CLI/state restore only; no actual stop/freeze/copy or production qualification',
              'live_actions': False, 'production_eligible': False, 'cases': {}}
    try:
        for mode in ('normal', 'lost-response', 'unknown', 'partial-custody'):
            report['cases'][mode] = case(binary, out, mode)
        assert digest(binary) == original
        report['verdict'] = 'PASS'
    finally:
        (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
