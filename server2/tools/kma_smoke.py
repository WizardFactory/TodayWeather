#!/usr/bin/env python3
"""S15 release HTTP smoke for the KMA v000903 routing entry: legacy -> SERVER2_NATIVE_FAMILIES=kma
-> legacy against a task-owned loopback legacy origin. Until the S15b input source exists the native
handler forwards every request, so each phase must reach the legacy KMA backend with the same
bytes. Unknown or repeated entries must stop startup before binding."""
import argparse
import http.server
import json
import os
from pathlib import Path
import re
import select
import subprocess
import sys
import threading

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gateway_smoke as g  # noqa: E402


class Origin(g.Peer):
    paths = []

    def do_GET(self):
        with self.lock:
            self.paths.append(self.path)
        super().do_GET()


def start(binary, endpoint, families):
    env = {k: v for k, v in os.environ.items() if k in ('PATH', 'SYSTEMROOT', 'TMPDIR')}
    env.update(SERVER2_BIND='127.0.0.1:0', SERVER2_METRICS_BIND='127.0.0.1:0', SERVER2_GATEWAY_LEGACY_URL=endpoint)
    if families is not None:
        env['SERVER2_NATIVE_FAMILIES'] = families
    process = subprocess.Popen([binary], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        ready, _, _ = select.select([process.stdout], [], [], 10)
        assert ready, 'startup timeout'
        line = process.stdout.readline().strip()
        match = re.fullmatch(r'server2 public=(127\.0\.0\.1:\d+) metrics=(127\.0\.0\.1:\d+)', line)
        assert match, (line, process.stderr.read() if process.poll() is not None else 'startup line mismatch')
        return process, 'http://' + match[1]
    except BaseException:
        g.stop(process)
        raise


def run(binary):
    Origin.fixtures = json.loads(g.FIXTURES.read_text())
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Origin)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    endpoint = 'http://127.0.0.1:' + str(server.server_port)
    try:
        bodies = []
        for families in (None, 'kma', None):
            process, base = start(binary, endpoint, families)
            try:
                before = len(Origin.paths)
                status, headers, body = g.request(base, '/weather/v000903/coord/37.566,126.978', headers={'Accept-Language': 'ko-KR'})
                assert status == 200, (status, body)
                hops = Origin.paths[before:]
                assert any(p.startswith('/v000903/kma/addr/') for p in hops), hops
                bodies.append(body)
                print('PASS %s: v000903 KMA request reached the legacy KMA backend (%s)'
                      % ('SERVER2_NATIVE_FAMILIES=' + families if families else 'routing list unset', ', '.join(hops)), flush=True)
            finally:
                g.stop(process)
        assert bodies[0] == bodies[1] == bodies[2], 'native forward changed the response bytes'
        for bad in ('kma,kma', 'KMA', 'kma,unknown'):
            env = {k: v for k, v in os.environ.items() if k in ('PATH', 'SYSTEMROOT', 'TMPDIR')}
            env.update(SERVER2_BIND='127.0.0.1:0', SERVER2_METRICS_BIND='127.0.0.1:0', SERVER2_GATEWAY_LEGACY_URL=endpoint,
                       SERVER2_NATIVE_FAMILIES=bad)
            refused = subprocess.run([binary], env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=10)
            assert refused.returncode != 0 and 'server2 public=' not in refused.stdout, (bad, refused.returncode, refused.stderr)
        print('PASS unknown or repeated routing entries stop startup before binding', flush=True)
        print('PASS S15 KMA routing release smoke (legacy -> kma -> legacy, identical bytes); '
              'loopback origin only, no S3/provider/AWS request, no native input source claim', flush=True)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True)
    run(str(Path(parser.parse_args().binary).resolve()))
