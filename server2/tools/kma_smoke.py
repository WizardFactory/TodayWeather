#!/usr/bin/env python3
"""S15/S15b-1 release HTTP smoke for the KMA v000903 routing entry: legacy ->
SERVER2_NATIVE_FAMILIES=kma -> legacy against a task-owned loopback legacy origin and the owned S06
S3 test peer. With `kma` the S3 input source reads the shared S3 settings (S10e: SERVER2_S3_BUCKET,
AWS_ACCESS_KEY, AWS_SECRET_KEY). The legacy phases reach the legacy KMA backend with the same bytes.
Since S15b-4a a missing forecast input is acquired at request time instead of forwarded, so the
`kma` phase answers natively without a legacy KMA hop, must have read S3, and its acquisitions reach
only the loopback provider roots (the origin answers them with no data). S15b-2 and S15b-4a
request-time acquisitions use the legacy DONGNAE_SECRET_KEYS list.
The phases run the release `loopback_server` example (the server2 process with its S3 and
provider roots on the loopback peers; roots are not settings), so no provider is reached. The
refusals run the release `server2` binary: unknown or repeated entries, and `kma` without the S3
settings or the data.go.kr keys, must stop startup before binding. Every process runs in an empty
working directory, so no real server2/.env is read."""
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
import tempfile
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


CWD = tempfile.mkdtemp(prefix='server2-kma-smoke-')


def s3_env():
    return dict(SERVER2_S3_BUCKET='server2-local', AWS_ACCESS_KEY='server2-local', AWS_SECRET_KEY='server2-local-secret')


def kma_env():
    """A placeholder legacy data.go.kr key list."""
    return dict(DONGNAE_SECRET_KEYS='["s15b2-local-placeholder-key"]')


def peer_command(peer_binary, endpoint, s3):
    """The loopback_server example with S3 on the peer and every KMA provider root on the origin."""
    root = endpoint + '/'
    return [peer_binary, '--s3', s3, '--data-go-kr', root, '--kma', root, '--kma-weather', root]


def start(command, endpoint, families):
    env = {k: v for k, v in os.environ.items() if k in ('PATH', 'SYSTEMROOT', 'TMPDIR')}
    env.update(PORT='0', SERVER2_GATEWAY_LEGACY_URL=endpoint)
    env.update(s3_env())
    if families is not None:
        env['SERVER2_NATIVE_FAMILIES'] = families
        env.update(kma_env())
    process = subprocess.Popen(command, env=env, cwd=CWD, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
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


def run(binary, peer_binary):
    Origin.fixtures = json.loads(g.FIXTURES.read_text())
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Origin)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    endpoint = 'http://127.0.0.1:' + str(server.server_port)
    peer, s3 = s3_peer()
    try:
        bodies = []
        for families in (None, 'kma', None):
            process, base = start(peer_command(peer_binary, endpoint, s3), endpoint, families)
            try:
                before = len(Origin.paths)
                s3_before = s3_requests(s3)
                status, headers, body = g.request(base, '/weather/v000903/coord/37.566,126.978', headers={'Accept-Language': 'ko-KR'})
                assert status == 200, (status, body)
                hops = Origin.paths[before:]
                legacy_kma = any(p.startswith('/v000903/kma/addr/') for p in hops)
                s3_read = s3_requests(s3) - s3_before
                if families == 'kma':
                    assert not legacy_kma, ('the kma phase forwarded', hops)
                    assert s3_read > 0, 'the kma S3 input source read nothing'
                    json.loads(body)
                    # The acquisitions reached the loopback data.go.kr and KMA roots with the
                    # placeholder key only.
                    acquired = [p for p in hops if not p.startswith('/geocode/')]
                    assert any(p.startswith('/1360000/VilageFcstInfoService_2.0/') for p in acquired), hops
                    assert any(p.startswith('/wid/queryDFS.jsp') for p in acquired), hops
                    assert any(p.startswith('/1360000/MidFcstInfoService/') for p in acquired), hops
                    print('PASS SERVER2_NATIVE_FAMILIES=kma: v000903 KMA request answered natively from S3 '
                          'with %d loopback provider requests so far, no legacy KMA hop' % len(acquired), flush=True)
                else:
                    assert legacy_kma, hops
                    assert s3_read == 0, ('legacy phase read S3', s3_read)
                    bodies.append(body)
                    print('PASS routing list unset: v000903 KMA request reached the legacy KMA backend (%s)'
                          % ', '.join(hops), flush=True)
            finally:
                g.stop(process)
        assert bodies[0] == bodies[1], 'the rollback changed the legacy response bytes'
        for bad, with_s3, with_keys in (('kma,kma', True, True), ('KMA', True, True), ('kma,unknown', True, True),
                                        ('kma', False, True), ('kma', True, False)):
            env = {k: v for k, v in os.environ.items() if k in ('PATH', 'SYSTEMROOT', 'TMPDIR')}
            env.update(PORT='0', SERVER2_GATEWAY_LEGACY_URL=endpoint, SERVER2_NATIVE_FAMILIES=bad)
            if with_s3:
                env.update(s3_env())
            if with_keys:
                env.update(kma_env())
            refused = subprocess.run([binary], env=env, cwd=CWD, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=10)
            assert refused.returncode != 0 and 'server2 public=' not in refused.stdout, (bad, refused.returncode, refused.stderr)
        print('PASS release server2: unknown or repeated routing entries, and kma without the S3 settings or '
              'DONGNAE_SECRET_KEYS, stop startup before binding', flush=True)
        print('PASS S15b-4a KMA routing release smoke (legacy -> kma native -> legacy with identical legacy bytes, '
              'the kma phase read the S3 test peer and acquired from loopback roots); loopback peers only, no '
              'provider/AWS request, no parity claim', flush=True)
    finally:
        peer.terminate()
        peer.wait(timeout=5)
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True)
    parser.add_argument('--peer-binary', help='release loopback_server example (default: examples/loopback_server beside --binary)')
    args = parser.parse_args()
    binary = Path(args.binary).resolve()
    run(str(binary), str(Path(args.peer_binary or binary.parent / 'examples/loopback_server').resolve()))
