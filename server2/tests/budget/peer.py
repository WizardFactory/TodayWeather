"""Distinct release runner, synthetic loopback fixtures; no outbound proxy/AWS claims."""
import argparse
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import threading
from urllib.parse import parse_qs, urlsplit

OWNED = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('s08_local_peer', OWNED / 'deploy/local/peer.py')
local = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = local
spec.loader.exec_module(local)


class Handler(local.Handler):
    def dispatch(self):
        split = urlsplit(self.path)
        fields = parse_qs(split.query)
        if self.command != 'GET' or split.path not in ('/budget-provider', '/__budget/status'):
            return self.error(403, 'OwnedEndpointOnly')
        if self.headers.get('Host') != f'127.0.0.1:{self.server.server_port}':
            return self.error(400, 'InvalidTarget')
        if split.path == '/__budget/status':
            return self.send(200, json.dumps({'calls': self.server.calls}).encode(), {'Content-Type': 'application/json'})
        if fields.get('serviceKey') not in (['first'], ['second']) or fields.get('dataType') != ['JSON'] or set(fields) not in ({'serviceKey', 'dataType'}, {'serviceKey', 'dataType', 'mode'}):
            return self.error(403, 'OnlySyntheticKeys')
        with self.server.lock:
            self.server.calls += 1
            mode = fields.get('mode', [None])
            if mode[0] and mode[0].startswith('http'):
                sequence = self.server.keys_by_mode.setdefault(mode[0], [])
                sequence.append(fields['serviceKey'][0])
                status, fault = mode[0][4:].split('-')
                if mode[0] not in {
                    'http429-encoding', 'http401-encoding', 'http400-encoding',
                    'http429-size', 'http401-size', 'http400-size',
                    'http403-truncated', 'http200-truncated',
                }:
                    return self.error(403, 'OnlySyntheticMode')
                if len(sequence) > 1 and mode != ['http200-truncated']:
                    return self.send(200, b'{"ok":true}', {'Content-Type': 'application/json'})
                if fault == 'encoding':
                    return self.send(int(status), b'{"ok":true}', {'Content-Type': 'application/json', 'Content-Encoding': 'gzip'})
                if fault == 'size':
                    return self.send(int(status), b'x' * 5000, {'Content-Type': 'application/json'})
                self.send_response(int(status))
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', '100')
                self.send_header('Connection', 'close')
                self.end_headers()
                self.wfile.write(b'{"ok":true}')
                self.close_connection = True
                return
            if mode == ['nodata-json']:
                return self.send(200, b'{"response":{"header":{"resultCode":"03"}}}', {'Content-Type': 'application/json'})
            if mode == ['nodata-xml']:
                return self.send(200, b'<response><header><resultCode>03</resultCode></header></response>', {'Content-Type': 'application/xml'})
            if mode in (['param10'], ['param12']):
                code = mode[0][-2:]
                return self.send(200, json.dumps({'response':{'header':{'resultCode':code}}}).encode(), {'Content-Type':'application/json'})
            if mode != [None]:
                return self.error(403, 'OnlySyntheticMode')
            # First response rotates a key; subsequent synthetic raw JSON is accepted.
            if self.server.calls == 1:
                return self.send(200, b'<OpenAPI_ServiceResponse><returnReasonCode>22</returnReasonCode></OpenAPI_ServiceResponse>', {'Content-Type': 'application/xml'})
            return self.send(200, b'{"ok":true}', {'Content-Type': 'application/json'})

    do_GET = dispatch


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True)
    args = parser.parse_args()
    binary = Path(args.binary).resolve()
    if not binary.is_relative_to(OWNED / 'target') or not binary.is_file():
        raise ValueError('release binary must be in this owned server2/target directory')
    print("execution started UTC " + datetime.now(timezone.utc).isoformat(timespec="seconds"), flush=True)
    config = local.load_config(OWNED / 'config/local-stack.json')
    s3 = local.make_peer('s3', config)
    provider = local.make_peer('provider', config)
    provider.RequestHandlerClass = Handler
    provider.calls = 0
    provider.keys_by_mode = {}
    threads = [threading.Thread(target=p.serve_forever, daemon=True) for p in (s3, provider)]
    for thread in threads:
        thread.start()
    try:
        completed = subprocess.run([str(binary), f'http://127.0.0.1:{s3.server_port}/', f'http://127.0.0.1:{provider.server_port}/budget-provider'], capture_output=True, text=True, timeout=20)
        print(completed.stdout, end='')
        if completed.returncode:
            print(completed.stderr, file=sys.stderr)
            raise RuntimeError(f'release scenario failed: {completed.returncode}')
        with s3.lock:
            authorities = [json.loads(o.body) for k, o in s3.objects.items() if k.endswith('/authority.json')]
            witnesses = [json.loads(o.body) for k, o in s3.objects.items() if '/blocks/' in k]
            assert len(authorities) == 22 and sum(a['used'] for a in authorities) == 48
            assert len(witnesses) == 23  # the unknown CAS has no witness
            assert len([k for k in s3.objects if k.startswith('raw/v2/')]) == 1
            assert all(a['used'] <= a['policy']['limit'] for a in authorities)
        assert provider.calls == 22
        assert len(provider.keys_by_mode) == 8
        for mode, keys in provider.keys_by_mode.items():
            expected = ['first'] if mode.startswith('http400') else (['first', 'first'] if mode == 'http200-truncated' else ['first', 'second'])
            assert keys == expected, (mode, keys, expected)
        print('observed peer counters: 22 provider requests, 48 charged units, 23 witnesses; PASS')
    finally:
        for peer in (s3, provider):
            peer.shutdown()
            peer.server_close()
        for thread in threads:
            thread.join(timeout=2)


if __name__ == '__main__':
    main()
