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
        if fields.get('serviceKey') not in (['first'], ['second']) or fields.get('dataType') != ['JSON'] or len(fields) != 2:
            return self.error(403, 'OnlySyntheticKeys')
        with self.server.lock:
            self.server.calls += 1
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
            assert len(authorities) == 3 and sum(a['used'] for a in authorities) == 10
            assert len(witnesses) == 4  # the unknown CAS has no witness
            assert all(a['used'] <= a['policy']['limit'] for a in authorities)
        assert provider.calls == 4
        print('observed peer counters: 4 provider requests, 10 charged units, 4 witnesses; PASS')
    finally:
        for peer in (s3, provider):
            peer.shutdown()
            peer.server_close()
        for thread in threads:
            thread.join(timeout=2)


if __name__ == '__main__':
    main()
