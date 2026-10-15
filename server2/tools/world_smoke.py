#!/usr/bin/env python3
"""S11/S13a release-binary smoke: native world weather and air with real-format configuration.

Starts the release `loopback_server` example (the server2 process; S10e: its S3, Visual
Crossing and WAQI roots are not settings, so they are given on its command line) with the
production setting names (routing list, SERVER2_S3_BUCKET, the legacy AWS credentials and the
legacy VC_SECRET_KEY / WAQI_SECRET_KEY; quotas and owners are built in) and task-owned loopback
peers: the S06 S3 test peer, a legacy geocoder/backend fixture, a synthetic Visual Crossing
Timeline stub and a synthetic WAQI geo feed. Processes run in an empty working directory, so no
real server2/.env is read. Checks the legacy default, the routed native world, one funded fetch
per cell, air from the funded chain, restore of weather and air from S3 with the providers down,
cell-only storage and rollback. No live provider, AWS or quota claim.
"""
import argparse
import base64
import concurrent.futures
from datetime import datetime, timedelta, timezone
import gzip
import http.server
import json
import os
from pathlib import Path
import re
import select
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
ZONE = 'Europe/London'
QUERY = 'temperatureUnit=C&windSpeedUnit=m%2Fs&pressureUnit=hPa&distanceUnit=km&precipitationUnit=mm&airUnit=airkorea'


def timeline(first_day, days, now):
    """Synthetic Timeline body in the shape of the legacy vc-synthetic fixtures."""
    tz = ZoneInfo(ZONE)
    start = datetime.combine(first_day, datetime.min.time(), tz)
    # Absolute hours (UTC arithmetic) so a daylight-saving change yields real 23/25-hour days.
    rows, cursor = {}, start.astimezone(timezone.utc)
    while len(rows) <= days:
        local = cursor.astimezone(tz)
        epoch = int(cursor.timestamp())
        row = {'datetime': local.strftime('%H:%M:00'), 'datetimeEpoch': epoch, 'temp': 50 + local.hour,
               'feelslike': 50 + local.hour, 'humidity': 60, 'precip': 0, 'precipprob': 0, 'preciptype': None,
               'windspeed': 5, 'winddir': 90, 'pressure': 1010, 'visibility': 9, 'cloudcover': 30,
               'conditions': 'Partially cloudy', 'icon': 'partly-cloudy-day', 'source': 'obs' if epoch <= now else 'fcst'}
        rows.setdefault(local.strftime('%Y-%m-%d'), []).append(row)
        cursor += timedelta(hours=1)
    out = []
    for date, hours in list(rows.items())[:days]:
        first = hours[0]['datetimeEpoch']
        out.append({'datetime': date, 'datetimeEpoch': first, 'tempmax': 73, 'tempmin': 50, 'feelslikemax': 73,
                    'feelslikemin': 50, 'humidity': 60, 'precip': 0, 'precipprob': 0, 'preciptype': None,
                    'windspeed': 5, 'winddir': 90, 'pressure': 1010, 'visibility': 9, 'cloudcover': 30,
                    'conditions': 'Partially cloudy', 'icon': 'partly-cloudy-day', 'sunriseEpoch': first + 6 * 3600,
                    'sunsetEpoch': first + 18 * 3600, 'moonphase': 0.5, 'hours': hours})
    all_hours = [h for d in out for h in d['hours']]
    current = [h for h in all_hours if h['datetimeEpoch'] <= now][-1]
    offset = start.utcoffset().total_seconds() / 3600
    return {'queryCost': 25, 'timezone': ZONE, 'tzoffset': offset, 'days': out, 'currentConditions': dict(current, source='obs')}


WAQI_BODY = json.loads((ROOT / 'tests/air/fixtures/waqi-seoul.json').read_text())


class Fixture(http.server.BaseHTTPRequestHandler):
    lock = threading.Lock()
    vc_paths, air_paths, legacy, down = [], [], 0, False

    def log_message(self, *_):
        pass

    def reply(self, status, body):
        data = json.dumps(body, separators=(',', ':')).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith('/geocode/v000903/coord/'):
            lat, lon = self.path.rsplit('/', 1)[1].split('?')[0].split(',')
            return self.reply(200, {'name': 'London', 'country': 'GB', 'address': 'London, UK',
                                    'location': {'lat': float(lat), 'long': float(lon)}})
        if re.match(r'^/v00090[123]/dsf/coord/', self.path):
            with self.lock:
                Fixture.legacy += 1
            return self.reply(200, {'legacy': 'world'})
        if self.path.startswith('/feed/geo:'):
            with self.lock:
                Fixture.air_paths.append(re.sub(r'token=[^&]*', 'token=<redacted>', self.path))
                down = Fixture.down
            if down:
                return self.reply(500, {'status': 'error'})
            # A synthetic observation of a station near the cell, observed now.
            body = json.loads(json.dumps(WAQI_BODY))
            body['data']['time'] = {'iso': datetime.now(timezone.utc).replace(microsecond=0).isoformat()}
            body['data']['city']['geo'] = [51.52, -0.14]
            return self.reply(200, body)
        match = re.match(r'^/timeline/(-?[\d.]+),(-?[\d.]+)/(last1days|yesterday|today)/next7days\?', self.path)
        if match:
            with self.lock:
                Fixture.vc_paths.append(re.sub(r'key=[^&]*', 'key=<redacted>', self.path))
                down = Fixture.down
            if down:
                return self.reply(500, {'error': 'down'})
            now = int(time.time())
            today = datetime.fromtimestamp(now, ZoneInfo(ZONE)).date()
            back, days = {'last1days': (2, 10), 'yesterday': (1, 9), 'today': (0, 8)}[match[3]]
            body = timeline(today - timedelta(days=back), days, now)
            body = dict({'queryCost': body['queryCost'], 'latitude': float(match[1]), 'longitude': float(match[2]),
                         'resolvedAddress': match[1] + ',' + match[2], 'address': match[1] + ',' + match[2]}, **body)
            return self.reply(200, body)
        self.reply(404, {'error': 'unknown'})


def request(base, path, headers=None):
    req = urllib.request.Request(base + path, headers=headers or {})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        response = opener.open(req, timeout=15)
    except urllib.error.HTTPError as e:
        response = e
    with response:
        return response.status, response.read()


CWD = tempfile.mkdtemp(prefix='server2-world-smoke-')


def start(command, env):
    process = subprocess.Popen(command, env=env, cwd=CWD, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    ready, _, _ = select.select([process.stdout], [], [], 10)
    assert ready, 'startup timeout'
    line = process.stdout.readline().strip()
    match = re.fullmatch(r'server2 public=(127\.0\.0\.1:\d+) metrics=(127\.0\.0\.1:\d+)', line)
    assert match, (line, process.stderr.read() if process.poll() is not None else 'startup line mismatch')
    return process, 'http://' + match[1]


def stop(process):
    if process.poll() is None:
        process.terminate()
        try:
            assert process.wait(timeout=8) == 0
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
            raise
    process.stdout.close()
    process.stderr.close()


def s3_peer():
    child = subprocess.Popen(['python3', 'tests/storage/catalog_peer.py'], cwd=ROOT, stdout=subprocess.PIPE, text=True)
    ready, _, _ = select.select([child.stdout], [], [], 10)
    assert ready, 'S3 peer startup timeout'
    return child, child.stdout.readline().strip()


def dump(endpoint):
    """Every stored object through the peer's local test-key control."""
    def get(url):
        req = urllib.request.Request(url, headers={'X-Server2-Test-Key': 'server2-local'})
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=10) as r:
            meta = [base64.b64decode(v + '==').decode('utf-8', 'replace') if k.lower() == 'x-amz-meta-s2-record' else v
                    for k, v in r.headers.items() if k.lower().startswith('x-amz-meta-')]
            return r.read(), '\n'.join(meta)
    listing = get(endpoint + 'server2-local?list-type=2')[0].decode()
    keys = re.findall(r'<Key>([^<]+)</Key>', listing)
    assert '<IsTruncated>false</IsTruncated>' in listing, 'list fits one page'
    objects = []
    for key in keys:
        body, meta = get(endpoint + 'server2-local/' + key)
        objects.append((key + '\n' + meta, gzip.decompress(body) if key.endswith('.raw.gz') else body))
    return objects


def run(peer_binary):
    print('execution started UTC ' + datetime.now(timezone.utc).isoformat(timespec='seconds'), flush=True)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    fixture = 'http://127.0.0.1:%d' % server.server_port
    peer, s3 = s3_peer()
    base_env = {k: v for k, v in os.environ.items() if k in ('PATH', 'SYSTEMROOT', 'TMPDIR')}
    # Every native setting is present in both configurations; only the routing list differs.
    base_env.update(PORT='0', SERVER2_GATEWAY_LEGACY_URL=fixture, SERVER2_S3_BUCKET='server2-local',
                    AWS_ACCESS_KEY='server2-local', AWS_SECRET_KEY='server2-local-secret', VC_SECRET_KEY='local-dummy-vc-key',
                    VC_DAILY_RECORD_LIMIT='1000', WAQI_SECRET_KEY='local-dummy-waqi-key')
    binary = [peer_binary, '--s3', s3, '--vc', fixture + '/timeline/', '--waqi', fixture + '/']
    native_env = dict(base_env, SERVER2_NATIVE_FAMILIES='dsf')
    path = '/weather/v000903/coord/51.507,-0.128?' + QUERY
    headers = {'Accept-Language': 'ko-KR'}
    try:
        process, base = start(binary, base_env)
        try:
            status, body = request(base, path, headers)
            assert status == 200 and json.loads(body)['legacy'] == 'world', (status, body)
            assert Fixture.vc_paths == [] and Fixture.air_paths == []
        finally:
            stop(process)
        assert dump(s3) == [], 'legacy startup wrote no S3 object'
        print('PASS startup without the routing entry keeps the legacy world backend and reads no native setting', flush=True)
        process, base = start(binary, native_env)
        try:
            status, first = request(base, path, headers)
            assert status == 200, (status, first)
            data = json.loads(first)
            assert data['source'] == 'VC' and data['timezone']['timezoneId'] == ZONE and data['country'] == 'GB'
            assert data['location'] == {'lat': 51.507, 'long': -0.128}
            assert len(data['thisTime']) == 2 and len(data['daily']) == 10, (len(data['thisTime']), len(data['daily']))
            assert len(Fixture.vc_paths) == 1 and Fixture.vc_paths[0].startswith('/timeline/51.51,-0.13/last1days/next7days?unitGroup=us')
            assert Fixture.vc_paths[0].endswith('&key=<redacted>')
            assert b'"airSource"' in first, 'air from the funded WAQI chain'
            assert len(Fixture.air_paths) == 1 and Fixture.air_paths[0].startswith('/feed/geo:51.51;-0.13/'), Fixture.air_paths
            near = lambda i: '/weather/v000901/coord/51.50%d,-0.12%d?%s' % (1 + i % 9, 1 + i % 9, QUERY)
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                statuses = list(pool.map(lambda i: request(base, near(i), headers)[0], range(16)))
            assert statuses == [200] * 16 and len(Fixture.vc_paths) == 1, (statuses, Fixture.vc_paths)
            status, _ = request(base, '/weather/v000902/coord/48.8566,2.3522?' + QUERY, headers)
            assert status == 200 and len(Fixture.vc_paths) == 2 and Fixture.vc_paths[1].startswith('/timeline/48.85,2.35/')
            assert Fixture.legacy == 1, Fixture.legacy
        finally:
            stop(process)
        print('PASS native world: legacy wire shape, one funded VC call per cell for 17 same-cell requests, cell-centre URLs, air from the funded WAQI chain at the air cell', flush=True)
        Fixture.down = True
        air_calls = len(Fixture.air_paths)
        process, base = start(binary, native_env)
        try:
            status, restored = request(base, path, headers)
            assert status == 200 and restored == first, 'restored bytes differ'
            assert len(Fixture.vc_paths) == 2, Fixture.vc_paths
            assert len(Fixture.air_paths) == air_calls, (air_calls, Fixture.air_paths)
        finally:
            stop(process)
        print('PASS restart with empty memory and the providers down serves identical weather and air bytes from S3', flush=True)
        objects = dump(s3)
        raw = [k for k, _ in objects if k.startswith('raw/v2/vc/timeline/')]
        assert len(raw) == 2, raw
        air = [k for k, _ in objects if k.startswith('raw/v2/air-waqi/current/')]
        assert len(air) == air_calls, (air_calls, air)
        assert any(k.startswith('budgets/v2/waqi/') for k, _ in objects)
        for key, body in objects:
            text = key + '\n' + body.decode('utf-8', 'replace')
            for precise in ('51.507', '-0.128', '51.509', '-0.121', '48.8566', '2.3522'):
                assert precise not in text, (key, precise)
            assert 'local-dummy-vc-key' not in text and 'local-dummy-waqi-key' not in text, key
        print('PASS S3 holds %d objects (%d weather raw, %d air raw); keys, metadata, bodies and catalogs carry cell coordinates only' % (len(objects), len(raw), len(air)), flush=True)
        process, base = start(binary, base_env)
        try:
            status, body = request(base, path, headers)
            assert status == 200 and json.loads(body)['legacy'] == 'world'
        finally:
            stop(process)
        print('PASS rollback: restart without dsf in SERVER2_NATIVE_FAMILIES returns to the legacy world backend', flush=True)
        print('observed: vc_calls=%d air_calls=%d legacy_world_hops=%d' % (len(Fixture.vc_paths), len(Fixture.air_paths), Fixture.legacy), flush=True)
        print('PASS S11/S13a release smoke with the real setting names on test peers; no live provider, AWS, quota or cutover claim', flush=True)
    finally:
        peer.terminate()
        peer.wait(timeout=5)
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--binary', required=True, help='release server2 binary')
    p.add_argument('--peer-binary', help='release loopback_server example (default: examples/loopback_server beside --binary)')
    a = p.parse_args()
    binary = Path(a.binary).resolve()
    run(str(Path(a.peer_binary or binary.parent / 'examples/loopback_server').resolve()))
