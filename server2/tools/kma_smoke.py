#!/usr/bin/env python3
"""S15/S15b-1 release HTTP smoke for the KMA v000903 routing entry: legacy ->
SERVER2_NATIVE_FAMILIES=kma -> legacy against a task-owned loopback legacy origin and the owned S06
S3 test peer. With `kma` the S3 input source reads the shared SERVER2_S3_* settings; until S15b-4
it forwards every request (named temporary reasons), so each phase must reach the legacy KMA
backend with the same bytes, and the native phase must have read S3. S15b-2 request-time
acquisitions use the data.go.kr key settings and provider roots pointed at the loopback origin, so
no provider is reached. Unknown or repeated entries, and `kma` without the S3 or data.go.kr
settings, must stop startup before binding."""
import argparse
import http.server
import json
import os
from pathlib import Path
import re
import json
import select
import subprocess
import sys
import threading
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gateway_smoke as g  # noqa: E402


# The legacy geocoder answers a seeded town (서울특별시 중구 명동), so the native phase resolves it
# in the town list and reads its inputs from S3 before forwarding.
GEOCODE = json.dumps({'name': '명동', 'country': 'KR', 'address': '서울특별시 중구 명동',
                      'location': {'lat': 37.566, 'long': 126.978},
                      'kmaAddress': {'name1': '서울특별시', 'name2': '중구', 'name3': '명동'}},
                     ensure_ascii=False, separators=(',', ':')).encode()


class Origin(g.Peer):
    paths = []

    def do_GET(self):
        with self.lock:
            self.paths.append(self.path)
        if self.path.startswith('/geocode/'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(GEOCODE)))
            self.end_headers()
            self.wfile.write(GEOCODE)
            return
        super().do_GET()


ROOT = Path(__file__).resolve().parents[1]


def s3_peer():
    child = subprocess.Popen(['python3', 'tests/storage/catalog_peer.py'], cwd=ROOT, stdout=subprocess.PIPE, text=True)
    ready, _, _ = select.select([child.stdout], [], [], 10)
    assert ready, 'S3 peer startup timeout'
    return child, child.stdout.readline().strip()


def s3_requests(s3):
    """Requests the S3 peer has answered (its local status counters)."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(s3 + '__catalog/status', timeout=10) as r:
        counts = json.loads(r.read())
    # Request counters are "METHOD key"; response counters and this status read are not counted.
    return sum(v for k, v in counts.items() if re.match(r'(GET|HEAD|PUT|POST|DELETE) ', k))


def s3_env(s3):
    return dict(SERVER2_S3_ENDPOINT=s3, SERVER2_S3_BUCKET='server2-local', SERVER2_S3_ACCESS_KEY_ID='server2-local',
                SERVER2_S3_SECRET_ACCESS_KEY='server2-local-secret')


def kma_env(endpoint):
    """Placeholder data.go.kr settings; every provider root is the loopback origin."""
    root = endpoint + '/'
    return dict(SERVER2_DATA_GO_KR_KEYS='["s15b2-local-placeholder-key"]', SERVER2_DATA_GO_KR_DAILY_UNITS='100',
                SERVER2_DATA_GO_KR_BASE_URL=root, SERVER2_KMA_BASE_URL=root, SERVER2_KMA_WEATHER_BASE_URL=root)


def start(binary, endpoint, families, s3=None):
    env = {k: v for k, v in os.environ.items() if k in ('PATH', 'SYSTEMROOT', 'TMPDIR')}
    env.update(SERVER2_BIND='127.0.0.1:0', SERVER2_METRICS_BIND='127.0.0.1:0', SERVER2_GATEWAY_LEGACY_URL=endpoint)
    if s3 is not None:
        env.update(s3_env(s3))
    if families is not None:
        env['SERVER2_NATIVE_FAMILIES'] = families
        env.update(kma_env(endpoint))
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
    peer, s3 = s3_peer()
    try:
        bodies = []
        for families in (None, 'kma', None):
            process, base = start(binary, endpoint, families, s3)
            try:
                before = len(Origin.paths)
                s3_before = s3_requests(s3)
                status, headers, body = g.request(base, '/weather/v000903/coord/37.566,126.978', headers={'Accept-Language': 'ko-KR'})
                assert status == 200, (status, body)
                hops = Origin.paths[before:]
                assert any(p.startswith('/v000903/kma/addr/') for p in hops), hops
                bodies.append(body)
                s3_read = s3_requests(s3) - s3_before
                if families == 'kma':
                    assert s3_read > 0, 'the kma S3 input source read nothing'
                else:
                    assert s3_read == 0, ('legacy phase read S3', s3_read)
                print('PASS %s: v000903 KMA request reached the legacy KMA backend (%s)'
                      % ('SERVER2_NATIVE_FAMILIES=' + families if families else 'routing list unset', ', '.join(hops)), flush=True)
            finally:
                g.stop(process)
        assert bodies[0] == bodies[1] == bodies[2], 'native forward changed the response bytes'
        for bad, with_s3, with_keys in (('kma,kma', True, True), ('KMA', True, True), ('kma,unknown', True, True),
                                        ('kma', False, True), ('kma', True, False)):
            env = {k: v for k, v in os.environ.items() if k in ('PATH', 'SYSTEMROOT', 'TMPDIR')}
            env.update(SERVER2_BIND='127.0.0.1:0', SERVER2_METRICS_BIND='127.0.0.1:0', SERVER2_GATEWAY_LEGACY_URL=endpoint,
                       SERVER2_NATIVE_FAMILIES=bad)
            if with_s3:
                env.update(s3_env(s3))
            if with_keys:
                env.update(kma_env(endpoint))
            refused = subprocess.run([binary], env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=10)
            assert refused.returncode != 0 and 'server2 public=' not in refused.stdout, (bad, refused.returncode, refused.stderr)
        print('PASS unknown or repeated routing entries, and kma without SERVER2_S3_* or SERVER2_DATA_GO_KR_*, '
              'stop startup before binding', flush=True)
        print('PASS S15b-1 KMA routing release smoke (legacy -> kma -> legacy, identical bytes, the kma phase read '
              'the S3 test peer); loopback peers only, no provider/AWS request, no native serving claim', flush=True)
    finally:
        peer.terminate()
        peer.wait(timeout=5)
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True)
    run(str(Path(parser.parse_args().binary).resolve()))
