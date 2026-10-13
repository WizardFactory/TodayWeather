"""Gateway/geocode family: scenarios, paired replay sides and cache-aware rollback.

The release binary runs against three task-owned loopback peers: recorded Kakao/Google
providers, a frozen legacy origin (geocoder plus weather backends) and the S03 local
S3-compatible peer. The gateway family has no S3 dependency in its process entrypoint;
the S3 peer is attached so every scenario can assert that no request reaches it.
"""
import base64
import concurrent.futures
import http.client
import json
import re
import socket
import threading
import time
from urllib.parse import parse_qs, quote, unquote, urlsplit

import harness

SERVER2 = harness.SERVER2
REPLAY_FIXTURE = SERVER2 / 'tests/integration/fixtures/gateway-replay.json'
PROVIDERS = SERVER2 / 'tests/gateway/fixtures/providers.json'
RECORDS = SERVER2 / 'tests/golden/records.json'
KO = {'accept-language': 'ko-KR,ko;q=0.9'}
WEATHER_KR = '/weather/v000903/coord/37.5663,126.9779'
WEATHER_WORLD = '/weather/coord/51.507,-0.128'
GEOCODE_KR = '/geocode/v000903/coord/37.5663,126.9779'
ADDRESS = '/geocode/v000903/addr/' + quote('서울특별시/송파구/잠실본동', safe='/')
GW, GEO = 'server2_gateway_', 'server2_geocoder_'
REPLAY_LIMITATIONS = ('Offline frozen inputs on loopback peers; local timings are not production latency, '
                      'quota or seven-day shadow evidence. No live shadow, mirroring or provider call.')
_CACHE = {}


def _json(path):
    if path not in _CACHE:
        _CACHE[path] = json.loads(path.read_text())
    return _CACHE[path]


def oracle_cases():
    return {case['id']: case for case in _json(RECORDS)['cases']}


def is_korea(lat, lon):
    return 32.6942 <= lat <= 39.3769 and 123.9523 <= lon <= 131.88


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


class Frozen:
    """Frozen legacy geocode replies, provider fixtures and S02 backend bodies."""

    def __init__(self, fixture, perturb=False):
        self.fixture = fixture
        self.coord, self.addr = {}, {}
        self.perturbation = None
        for entry in fixture['legacy_geocode']:
            body = dict(entry['body'])
            if perturb and entry['route'] == 'coord' and entry['lang'] == 'ko' and body.get('country') == 'KR':
                body['name'] = body['name'] + ' (perturbed)'
                self.perturbation = 'baseline legacy ko coordinate name changed'
            if entry['route'] == 'coord':
                self.coord[(round(entry['lat'], 3), round(entry['lon'], 3), entry['lang'])] = encode(body)
            else:
                self.addr[entry['address']] = encode(body)
        providers = _json(PROVIDERS)
        self.providers = {key: encode(providers[name]) for key, name in fixture['provider_fixtures'].items()}
        cases = oracle_cases()
        self.backends = {}
        for family, pattern in fixture['backend_records'].items():
            for version in ('v000901', 'v000902', 'v000903'):
                self.backends[(version, family)] = base64.b64decode(cases[pattern.format(version=version)]['body_base64'])

    def providers_reply(self, path, headers):
        split = urlsplit(path)
        query = parse_qs(split.query)
        if split.path == '/v2/local/geo/coord2regioncode.json':
            return 'kakao', 200, 'application/json', self.providers['kakao_coord']
        if split.path == '/v2/local/search/address.json':
            return 'kakao', 200, 'application/json', self.providers['kakao_addr']
        if split.path == '/maps/api/geocode/json':
            if 'address' in query:
                return 'google', 200, 'application/json', self.providers['google_addr']
            lat, lon = (float(x) for x in query['latlng'][0].split(','))
            if not is_korea(lat, lon):
                name = 'google_coord_world'
            elif query.get('language', [''])[0] == 'ko':
                name = 'google_coord_korea_ko'
            else:
                name = 'google_coord_korea_other'
            return 'google', 200, 'application/json', self.providers[name]
        return 'unknown_provider', 404, 'application/json', b'{}'

    def legacy_reply(self, path, headers):
        split = urlsplit(path)
        text = 'application/json; charset=utf-8'
        if split.path.startswith('/geocode/v000903/coord/'):
            lat, lon = (float(x) for x in split.path.rsplit('/', 1)[1].split(','))
            body = self.coord.get((round(lat, 3), round(lon, 3), headers.get('accept-language', '')))
            return ('legacy_geo', 200, text, body) if body else ('legacy_geo', 404, 'text/plain', b'Not Found')
        if split.path.startswith('/geocode/v000903/addr/'):
            body = self.addr.get(unquote(split.path[len('/geocode/v000903/addr/'):]))
            return ('legacy_geo', 200, text, body) if body else ('legacy_geo', 404, 'text/plain', b'Not Found')
        match = re.fullmatch(r'/(v00090[123])/(kma|dsf)/.+', split.path)
        if match:
            return 'backend', 200, text, self.backends[(match[1], match[2])]
        return 'unknown_legacy', 404, 'text/plain', b'Not Found'


class Peers:
    def __init__(self, frozen):
        self.providers = harness.RecordingPeer(frozen.providers_reply)
        self.legacy = harness.RecordingPeer(frozen.legacy_reply)
        self.s3 = harness.s3_peer()
        self.s3_received_total = 0

    def counts(self):
        merged = dict(self.providers.snapshot()[0])
        for kind, value in self.legacy.snapshot()[0].items():
            merged[kind] = merged.get(kind, 0) + value
        merged['s3'] = self.s3_received_total + self.s3.received
        return merged

    def mark(self):
        return self.providers.snapshot()[1], self.legacy.snapshot()[1]

    def hops_since(self, mark):
        return self.providers.hops_since(mark[0]) + self.legacy.hops_since(mark[1])

    def set(self, kind, delay=None, fault=None):
        for peer in (self.providers, self.legacy):
            if delay is None:
                peer.delay.pop(kind, None)
            else:
                peer.delay[kind] = delay
            if fault is None:
                peer.fault.pop(kind, None)
            else:
                peer.fault[kind] = fault

    def replace_s3(self):
        """Simulate an S3 outage for the current process by stopping the peer, then restore one."""
        self.s3_received_total += self.s3.received
        self.s3.close()
        self.s3 = harness.s3_peer()

    def close(self):
        for peer in (self.providers, self.legacy, self.s3):
            peer.close()


def gateway_env(peers, mode, keys=1, legacy=None):
    config = peers.s3.config_values
    return {
        'SERVER2_GATEWAY_LEGACY_URL': legacy or peers.legacy.base,
        'SERVER2_GEOCODER_MODE': mode,
        'GEOCODER_KAKAO_BASE_URL': peers.providers.base,
        'GEOCODER_GOOGLE_BASE_URL': peers.providers.base,
        'GEOCODER_KAKAO_KEYS': json.dumps(['local-dummy-' + str(i) for i in range(keys)]),
        'GEOCODER_GOOGLE_KEY': 'local-dummy',
        # Attached for future family wiring; the gateway entrypoint must not use it.
        'SERVER2_S3_ENDPOINT': peers.s3.base,
        'AWS_ACCESS_KEY_ID': config['test_access_key'],
        'AWS_SECRET_ACCESS_KEY': config['test_secret_key'],
        'AWS_REGION': 'us-east-1',
        'AWS_EC2_METADATA_DISABLED': 'true',
    }


class Context:
    def __init__(self, binary, frozen):
        self.binary, self.frozen = binary, frozen
        self.peers = Peers(frozen)

    def process(self, mode, keys=1, legacy=None, extra=None):
        env = gateway_env(self.peers, mode, keys, legacy)
        env.update(extra or {})
        return harness.Server2(self.binary, env)

    def observe(self, process):
        return process.metrics(), self.peers.counts()

    def close(self):
        self.peers.close()


def expect(condition, message, observed=None):
    if not condition:
        raise AssertionError(message + ('' if observed is None else ': ' + json.dumps(observed, sort_keys=True, default=str)))


def changes(process, ctx, before):
    metrics, counts = ctx.observe(process)
    return harness.delta(metrics, before[0]), harness.delta(counts, before[1])


def get(process, path, headers=None, method='GET'):
    return harness.request(process.public, path, method, headers)


def scenario_cold_warm(ctx):
    with ctx.process('mock') as p:
        before = ctx.observe(p)
        cold = get(p, WEATHER_KR, KO)
        expect(cold.status == 200, 'cold weather status', cold.status)
        m, c = changes(p, ctx, before)
        expect(m.get(GEO + 'flights_total') == 1 and m.get(GEO + 'kakao_attempts_total') == 1
               and GEO + 'google_attempts_total' not in m and m.get(GW + 'backend_attempts_total') == 1,
               'cold work must be one owned Kakao flight and one backend hop', m)
        expect(c == {'kakao': 1, 'backend': 1}, 'cold peer work', c)
        cold_obs = {'metrics': m, 'peers': c, 'elapsed_ms': round(cold.elapsed_ms, 2)}
        before = ctx.observe(p)
        warm = get(p, WEATHER_KR, KO)
        expect(warm.status == 200 and warm.body == cold.body and warm.header('etag') == cold.header('etag'),
               'warm weather must be byte-identical')
        geo = get(p, GEOCODE_KR, KO)
        expect(geo.status == 200 and geo.header('cache-control') == 'max-age=2592000', 'warm geocode', geo.status)
        m, c = changes(p, ctx, before)
        expect(m.get(GEO + 'cache_hits_total') == 2 and GEO + 'flights_total' not in m
               and GEO + 'kakao_attempts_total' not in m, 'warm lookups must be RAM hits with no provider work', m)
        expect(c == {'backend': 1}, 'warm peer work: weather backend only (weather bodies are not cached)', c)
        expect(p.metrics()[GW + 'owned_inflight'] == 0, 'owned work drained')
        return {'cold': cold_obs, 'warm': {'metrics': m, 'peers': c, 'elapsed_ms': round(warm.elapsed_ms, 2)}}


def scenario_empty_memory_restore(ctx):
    observed = []
    for restart in range(2):
        with ctx.process('mock') as p:
            before = ctx.observe(p)
            expect(get(p, GEOCODE_KR, KO).status == 200, 'coordinate lookup after start')
            expect(get(p, ADDRESS, KO).status == 200, 'address lookup after start')
            m, c = changes(p, ctx, before)
            expect(m.get(GEO + 'flights_total') == 2 and GEO + 'cache_hits_total' not in m,
                   'empty memory re-acquires both lookups', m)
            expect(c == {'kakao': 1, 'google': 1}, 'one Kakao reverse and one Google address acquisition', c)
            observed.append({'restart': restart, 'metrics': m, 'peers': c})
            expect(p.stop() == 0, 'clean stop')
    expect(ctx.peers.counts()['s3'] == 0 and not ctx.peers.s3.objects,
           'no precise coordinate or address publication reached S3')
    return {'restarts': observed, 's3_requests': 0, 's3_objects': 0,
            'note': 'Precise reverse results are RAM-only by contract; S3AddressStore is not wired in the process (S10a decides).'}


def scenario_single_flight(ctx):
    with ctx.process('mock') as p:
        ctx.peers.set('kakao', delay=0.4)
        try:
            before = ctx.observe(p)
            with concurrent.futures.ThreadPoolExecutor(16) as pool:
                statuses = list(pool.map(lambda _: get(p, '/geocode/v000903/coord/36.101,127.401', KO).status, range(16)))
            m, c = changes(p, ctx, before)
        finally:
            ctx.peers.set('kakao')
        expect(statuses == [200] * 16, 'all same-key callers succeed', statuses)
        expect(c == {'kakao': 1} and m.get(GEO + 'flights_total') == 1, 'one owned provider call', [m, c])
        expect(m.get(GEO + 'joined_total', 0) + m.get(GEO + 'cache_hits_total', 0) == 15, 'fifteen callers shared it', m)
        return {'callers': 16, 'metrics': m, 'peers': c}


def scenario_cancellation(ctx):
    with ctx.process('mock') as p:
        host, port = harness.loopback(p.public)
        ctx.peers.set('kakao', delay=1.0)
        try:
            before = ctx.observe(p)
            path = '/geocode/v000903/coord/36.202,127.502'
            with socket.create_connection((host, port), timeout=3) as abandoned:
                abandoned.sendall(('GET ' + path + ' HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept-Language: ko\r\n\r\n').encode())
                time.sleep(0.2)
            time.sleep(0.2)
            joined = get(p, path, KO)
            time.sleep(0.3)
            m, c = changes(p, ctx, before)
        finally:
            ctx.peers.set('kakao')
        expect(joined.status == 200, 'later waiter receives the surviving owner result', joined.status)
        expect(c == {'kakao': 1} and m.get(GEO + 'flights_total') == 1 and m.get(GEO + 'joined_total', 0) >= 1,
               'cancelled initiator neither cancels nor duplicates the owned lookup', [m, c])
        get(p, WEATHER_KR, KO)
        ctx.peers.set('backend', delay=1.0)
        try:
            before = ctx.observe(p)
            with socket.create_connection((host, port), timeout=3) as abandoned:
                abandoned.sendall(('GET ' + WEATHER_KR + ' HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept-Language: ko\r\n\r\n').encode())
                time.sleep(0.2)
            time.sleep(1.4)
            m2, c2 = changes(p, ctx, before)
        finally:
            ctx.peers.set('backend')
        expect(c2 == {'backend': 1} and m2.get(GW + 'backend_attempts_total') == 1,
               'abandoned weather owner completes one backend attempt without retry', [m2, c2])
        expect(p.metrics()[GW + 'owned_inflight'] == 0, 'owned work drained after abandonment')
        return {'geocode': {'metrics': m, 'peers': c}, 'weather': {'metrics': m2, 'peers': c2},
                'abandoned_observed': m.get(GW + 'abandoned_total', 0) + m2.get(GW + 'abandoned_total', 0)}


def scenario_outages(ctx):
    result = {}
    with ctx.process('mock') as p:
        ctx.peers.set('kakao', fault='500')
        before = ctx.observe(p)
        try:
            failed = get(p, '/geocode/v000903/coord/36.303,127.603', KO)
        finally:
            ctx.peers.set('kakao')
        m, c = changes(p, ctx, before)
        expect(failed.status == 501 and failed.header('cache-control') == 'no-store', 'provider outage is 501 no-store', failed.status)
        expect(c == {'kakao': 1} and m.get(GW + 'responses_dependency_error_total') == 1,
               'one attempt per configured key, counted as a dependency failure', [m, c])
        before = ctx.observe(p)
        recovered = get(p, '/geocode/v000903/coord/36.303,127.603', KO)
        m2, c2 = changes(p, ctx, before)
        expect(recovered.status == 200 and c2 == {'kakao': 1}, 'failures are not cached; recovery re-acquires once', c2)
        result['provider'] = {'failed': {'metrics': m, 'peers': c}, 'recovered': {'peers': c2}}

        get(p, WEATHER_KR, KO)
        ctx.peers.set('backend', fault='500')
        before = ctx.observe(p)
        try:
            failed = get(p, WEATHER_KR, KO)
        finally:
            ctx.peers.set('backend')
        m, c = changes(p, ctx, before)
        expect(failed.status == 501 and failed.header('cache-control') == 'no-store', 'backend outage is 501 no-store', failed.status)
        expect(c == {'backend': 3} and m.get(GW + 'backend_attempts_total') == 3 and m.get(GEO + 'cache_hits_total') == 1,
               'legacy retry policy: exactly three backend attempts, no geocoder work', [m, c])
        result['backend'] = {'metrics': m, 'peers': c}

        ctx.peers.replace_s3()
        before = ctx.observe(p)
        served = get(p, WEATHER_KR, KO)
        m, c = changes(p, ctx, before)
        expect(served.status == 200 and c == {'backend': 1}, 'S3 outage does not affect the gateway family', c)
        result['s3_outage'] = {'status': served.status, 'peers': c}

    down = 'http://127.0.0.1:' + str(harness.free_port())
    for mode in ('legacy', 'mock'):
        with ctx.process(mode, legacy=down) as p:
            before = ctx.observe(p)
            weather = get(p, WEATHER_KR, KO)
            geocode = get(p, GEOCODE_KR, KO)
            m, c = changes(p, ctx, before)
            expect(weather.status == 501 and weather.elapsed_ms < 3000, 'unreachable legacy origin fails fast with 501', weather.elapsed_ms)
            if mode == 'legacy':
                expect(geocode.status == 501 and not c and m.get(GW + 'legacy_geocode_attempts_total') == 2,
                       'legacy mode: both routes depend on the legacy origin', [m, c])
            else:
                expect(geocode.status == 200 and c == {'kakao': 1} and m.get(GW + 'backend_attempts_total') == 3,
                       'native mode: geocode is served natively; weather backend still needs legacy', [m, c])
            result['legacy_down_' + mode] = {'weather': weather.status, 'geocode': geocode.status,
                                             'weather_ms': round(weather.elapsed_ms, 2), 'metrics': m, 'peers': c}
    expect(ctx.peers.counts()['s3'] == 0, 'no S3 request in any outage case')
    return result


def scenario_budget_exhaustion(ctx):
    # 16 Kakao keys plus Google reserve 17 mock units per Korean reverse lookup;
    # the process-fixed 10,000-unit mock quota funds exactly 588 lookups.
    with ctx.process('mock', keys=16) as p:
        rss_before = p.rss_kib()
        before = ctx.observe(p)
        paths = ['/geocode/v000903/coord/' + format(35.0 + i / 1000, '.3f') + ',127.5' for i in range(589)]
        with concurrent.futures.ThreadPoolExecutor(16) as pool:
            statuses = list(pool.map(lambda path: get(p, path, KO).status, paths))
        m, c = changes(p, ctx, before)
        expect(statuses.count(200) == 588 and statuses.count(501) == 1, 'quota funds exactly 588 lookups',
               {'200': statuses.count(200), '501': statuses.count(501)})
        expect(c == {'kakao': 588} and m.get(GEO + 'quota_rejections_total') == 1,
               'exhaustion fails closed before any provider request', [m, c])
        before = ctx.observe(p)
        cached = get(p, paths[0], KO) if statuses[0] == 200 else get(p, paths[1], KO)
        fresh = get(p, '/geocode/v000903/coord/34.001,127.5', KO)
        m2, c2 = changes(p, ctx, before)
        expect(cached.status == 200 and fresh.status == 501 and not c2 and m2.get(GEO + 'quota_rejections_total') == 1,
               'after exhaustion: warm keys still serve, new keys fail closed with no provider work', [m2, c2])
        rss_after = p.rss_kib()
        growth = (rss_after - rss_before) if rss_before and rss_after else None
        expect(growth is None or growth < 64 * 1024, 'RSS growth during 589 distinct lookups stays below 64 MiB', growth)
        return {'lookups': 589, 'ok': 588, 'rejected': statuses.count(501), 'metrics': m, 'peers': c,
                'after': {'metrics': m2, 'peers': c2}, 'rss_kib': {'before': rss_before, 'after': rss_after}}


def scenario_pressure(ctx):
    with ctx.process('mock') as p:
        get(p, WEATHER_KR, KO)
        ctx.peers.set('backend', delay=1.5)
        barrier = threading.Barrier(48)

        def one(_):
            barrier.wait()
            return get(p, WEATHER_KR, KO)
        try:
            before = ctx.observe(p)
            with concurrent.futures.ThreadPoolExecutor(48) as pool:
                replies = list(pool.map(one, range(48)))
            m, c = changes(p, ctx, before)
        finally:
            ctx.peers.set('backend')
        ok = [r for r in replies if r.status == 200]
        busy = [r for r in replies if r.status == 503]
        expect(len(ok) == 40 and len(busy) == 8, 'admission bound 40 serves 40 and rejects 8',
               sorted(r.status for r in replies))
        expect(all(r.header('retry-after') == '5' and r.header('cache-control') == 'no-store' for r in busy),
               'capacity rejection retains Retry-After 5 and no-store')
        expect(c == {'backend': 40} and m.get(GW + 'responses_unavailable_total') == 8,
               'rejected requests perform no backend or geocoder work', [m, c])
        expect(p.metrics()[GW + 'owned_inflight'] == 0, 'owned work drained after pressure')
        return {'offered': 48, 'ok': len(ok), 'unavailable': len(busy), 'metrics': m, 'peers': c,
                'rss_kib': p.rss_kib()}


def scenario_spot_drain(ctx):
    with ctx.process('mock') as p:
        get(p, WEATHER_KR, KO)
        ctx.peers.set('backend', delay=1.5)
        result = {}
        try:
            before = ctx.observe(p)
            worker = threading.Thread(target=lambda: result.update(reply=get(p, WEATHER_KR, KO)))
            worker.start()
            time.sleep(0.3)
            signalled = time.monotonic()
            p.signal()
            worker.join(timeout=8)
            code = p.process.wait(timeout=8)
            stopped = (time.monotonic() - signalled) * 1000
        finally:
            ctx.peers.set('backend')
        counts = harness.delta(ctx.peers.counts(), before[1])
        reply = result.get('reply')
        expect(reply is not None and reply.status == 200, 'in-flight request completes during SIGTERM drain')
        expect(code == 0 and stopped < 5500, 'process drains and exits cleanly within the 5s drain budget', {'code': code, 'ms': stopped})
        expect(counts == {'backend': 1}, 'drain neither retries nor abandons owned work', counts)
        return {'status': reply.status, 'exit_code': code, 'stop_ms': round(stopped, 2), 'peers': counts}


SCENARIOS = [
    ('GW-COLD-WARM', 'cold then warm requests: one owned acquisition, warm RAM hits', scenario_cold_warm),
    ('GW-EMPTY-RESTORE', 'restart with empty memory: bounded re-acquisition, nothing published to S3', scenario_empty_memory_restore),
    ('GW-SINGLE-FLIGHT', '16 same-key cold callers share one provider call', scenario_single_flight),
    ('GW-CANCEL', 'disconnected initiators do not cancel or duplicate owned work', scenario_cancellation),
    ('GW-OUTAGE', 'provider, backend, S3 and legacy-origin outages', scenario_outages),
    ('GW-BUDGET', 'quota exhaustion fails closed with no provider request', scenario_budget_exhaustion),
    ('GW-PRESSURE', 'admission bound under 48 concurrent slow requests', scenario_pressure),
    ('GW-DRAIN', 'Spot-style SIGTERM drain completes in-flight work', scenario_spot_drain),
]


def peers_text(counts):
    return ' '.join(k + '=' + str(v) for k, v in sorted(counts.items())) or 'none'


SUMMARIES = {
    'GW-COLD-WARM': lambda o: 'cold peers[%s] warm peers[%s] warm RAM hits=%d' % (
        peers_text(o['cold']['peers']), peers_text(o['warm']['peers']), o['warm']['metrics'].get(GEO + 'cache_hits_total', 0)),
    'GW-EMPTY-RESTORE': lambda o: 'per start peers[%s]; S3 requests=%d objects=%d' % (
        peers_text(o['restarts'][-1]['peers']), o['s3_requests'], o['s3_objects']),
    'GW-SINGLE-FLIGHT': lambda o: '%d callers -> flights=%d joined=%d peers[%s]' % (
        o['callers'], o['metrics'].get(GEO + 'flights_total', 0), o['metrics'].get(GEO + 'joined_total', 0), peers_text(o['peers'])),
    'GW-CANCEL': lambda o: 'geocode peers[%s] joined=%d; weather peers[%s]; abandoned=%d' % (
        peers_text(o['geocode']['peers']), o['geocode']['metrics'].get(GEO + 'joined_total', 0),
        peers_text(o['weather']['peers']), o['abandoned_observed']),
    'GW-OUTAGE': lambda o: 'provider 501 peers[%s]; backend 501 peers[%s]; S3 down weather=%d; legacy down: legacy-mode %d/%d, mock-mode %d/%d' % (
        peers_text(o['provider']['failed']['peers']), peers_text(o['backend']['peers']), o['s3_outage']['status'],
        o['legacy_down_legacy']['weather'], o['legacy_down_legacy']['geocode'],
        o['legacy_down_mock']['weather'], o['legacy_down_mock']['geocode']),
    'GW-BUDGET': lambda o: '%d lookups -> ok=%d rejected=%d peers[%s]; after: new key peers[%s]; RSS KiB %s->%s' % (
        o['lookups'], o['ok'], o['rejected'], peers_text(o['peers']), peers_text(o['after']['peers']),
        o['rss_kib']['before'], o['rss_kib']['after']),
    'GW-PRESSURE': lambda o: '%d offered -> ok=%d 503=%d peers[%s]' % (o['offered'], o['ok'], o['unavailable'], peers_text(o['peers'])),
    'GW-DRAIN': lambda o: 'in-flight status=%d exit=%d stop_ms=%.0f peers[%s]' % (
        o['status'], o['exit_code'], o['stop_ms'], peers_text(o['peers'])),
}


def smoke(binary, selected=None):
    frozen = Frozen(_json(REPLAY_FIXTURE))
    ctx = Context(binary, frozen)
    results = []
    try:
        for scenario_id, title, function in SCENARIOS:
            if selected and scenario_id not in selected:
                continue
            started = time.monotonic()
            observed = function(ctx)
            results.append({'id': scenario_id, 'title': title, 'status': 'passed',
                            'seconds': round(time.monotonic() - started, 2), 'observed': observed})
            print('PASS ' + scenario_id + ' ' + title, flush=True)
            print('     ' + SUMMARIES[scenario_id](observed), flush=True)
        expect(ctx.peers.counts()['s3'] == 0, 'gateway family sent no request to the S3 peer')
        return results, ctx.peers.counts()
    finally:
        ctx.close()


def replay_side(binary, fixture, side, perturb=False):
    frozen = Frozen(fixture, perturb)
    mode = 'legacy' if side == 'baseline' else 'mock'
    peers = Peers(frozen)
    records, acquisitions = [], {}
    try:
        with harness.Server2(binary, gateway_env(peers, mode)) as process:
            for pass_name in ('cold', 'warm'):
                etags = {}
                start = peers.counts()
                for item in fixture['workload']:
                    headers = dict(item.get('headers', {}))
                    if 'if_none_match_from' in item:
                        headers['if-none-match'] = etags[item['if_none_match_from']]
                    mark = peers.mark()
                    reply = harness.request(process.public, item['path'], item['method'], headers)
                    etags[item['id']] = reply.header('etag') or ''
                    records.append({'id': item['id'], 'pass': pass_name, 'oracle': item.get('oracle'),
                                    'status': reply.status, 'headers': reply.headers, 'body': reply.body,
                                    'elapsed_ms': reply.elapsed_ms, 'hops': peers.hops_since(mark)})
                acquisitions[pass_name] = harness.delta(peers.counts(), start)
            metrics = {k: v for k, v in process.metrics().items() if k.startswith((GW, GEO)) and v}
            expect(process.stop() == 0, 'replay side stopped cleanly')
        s3 = peers.counts()['s3']
    finally:
        peers.close()
    expect(s3 == 0, 'replay side sent no request to the S3 peer')
    return records, {'configuration': 'SERVER2_GEOCODER_MODE=' + mode, 'mode': mode,
                     'acquisitions': acquisitions, 'metrics': metrics, 's3_requests': s3,
                     'perturbation': frozen.perturbation}


# The foundation closes every public connection at SERVER2_CONNECTION_SECONDS (default 9),
# which races the gateway's 9s deadline. The deadline contract is therefore probed with a
# 12s connection lifetime, and the default-configuration result is pinned as a known gap.
DEADLINE_PROBE_LIFETIME = {'SERVER2_CONNECTION_SECONDS': '12'}
KNOWN_GAP = 'S19-GAP-1'


def deadline_probe(ctx, mode):
    """Stalled backend reaches the 9s deadline after three <=3s attempts; geocoder caps hold."""
    with ctx.process(mode, extra=DEADLINE_PROBE_LIFETIME) as p:
        get(p, WEATHER_KR, KO)
        ctx.peers.set('backend', fault='hang')
        try:
            before = ctx.observe(p)
            stalled = get(p, WEATHER_KR, KO)
            m, c = changes(p, ctx, before)
        finally:
            ctx.peers.set('backend')
        expect(stalled.status == 501 and stalled.header('cache-control') == 'no-store'
               and 8500 <= stalled.elapsed_ms <= 10500 and c.get('backend') == 3
               and m.get(GW + 'responses_dependency_error_total') == 1,
               'stalled backend: 501 no-store at the 9s deadline after three attempts',
               [stalled.status, stalled.elapsed_ms, m, c])
        kind, cap = ('kakao', (2500, 4000)) if mode == 'mock' else ('legacy_geo', (4500, 6000))
        ctx.peers.set(kind, fault='hang')
        try:
            geo = get(p, '/geocode/v000903/coord/36.404,127.704', KO)
        finally:
            ctx.peers.set(kind)
        expect(geo.status == 501 and geo.header('cache-control') == 'no-store' and cap[0] <= geo.elapsed_ms <= cap[1],
               'stalled geocoder ends within its attempt/lookup cap', [geo.status, geo.elapsed_ms])
        expect(p.stop() == 0, 'deadline probe stopped cleanly')
    return {'connection_seconds': 12, 'backend_stall': round(stalled.elapsed_ms, 2), 'backend_attempts': c.get('backend'),
            'geocoder_stall': round(geo.elapsed_ms, 2), 'geocoder_kind': kind}


def connection_lifetime_gap(ctx, p):
    """Strict known gap: with default settings the 9s deadline 501 is not delivered.

    Fails when the observation changes (for example after a fix), so the pin is updated deliberately.
    """
    ctx.peers.set('backend', fault='hang')
    started = time.monotonic()
    try:
        before = ctx.observe(p)
        try:
            reply = get(p, WEATHER_KR, KO)
            outcome = 'status %d' % reply.status
        except (ConnectionError, http.client.HTTPException) as error:
            outcome = 'connection closed without response (' + type(error).__name__ + ')'
        elapsed = (time.monotonic() - started) * 1000
        time.sleep(0.2)
        m, _ = changes(p, ctx, before)
    finally:
        ctx.peers.set('backend')
    expect(outcome.startswith('connection closed') and 8500 <= elapsed <= 10000 and m.get(GW + 'abandoned_total') == 1,
           KNOWN_GAP + ' observation changed; re-assess and update the pinned known gap', [outcome, elapsed, m])
    print('KNOWN GAP ' + KNOWN_GAP + ': default SERVER2_CONNECTION_SECONDS=9 closes the socket at %.0f ms, before the '
          '9s deadline 501 is written (abandoned_total +1); decision pending' % elapsed, flush=True)
    return {'id': KNOWN_GAP, 'connection_seconds': 9, 'observed': outcome, 'elapsed_ms': round(elapsed, 2),
            'metrics': m, 'expected_contract': '501 Not Implemented, no-store at the 9s deadline',
            'status': 'open decision; see the S19 operations guide'}


REHEARSAL = [
    ('weather-kr', WEATHER_KR, KO, 'max-age=300'),
    ('weather-world', WEATHER_WORLD, KO, 'max-age=300'),
    ('geocode-coord', GEOCODE_KR, None, 'max-age=2592000'),
    ('geocode-addr', ADDRESS, None, 'max-age=2592000'),
]


def rollback(binary, deadlines=True):
    """legacy -> mock(native geocoder) -> legacy, switching /weather and /geocode together."""
    frozen = Frozen(_json(REPLAY_FIXTURE))
    ctx = Context(binary, frozen)
    phases, previous = [], None
    try:
        for number, mode in enumerate(('legacy', 'mock', 'legacy'), 1):
            phase = {'phase': number, 'mode': mode}
            with ctx.process(mode) as p:
                for pass_name in ('cold', 'warm'):
                    before = ctx.observe(p)
                    observed = {}
                    for name, path, headers, cache in REHEARSAL:
                        reply = get(p, path, headers)
                        expect(reply.status == 200 and reply.header('cache-control') == cache,
                               'phase %d %s %s cache contract' % (number, pass_name, name), [reply.status, reply.header('cache-control')])
                        observed[name] = {'etag': reply.header('etag'), 'sha256': reply.digest()}
                    m, c = changes(p, ctx, before)
                    geocoder = {k: v for k, v in c.items() if k in ('legacy_geo', 'kakao', 'google')}
                    if mode == 'legacy':
                        expect(set(geocoder) == {'legacy_geo'} and geocoder['legacy_geo'] == 4,
                               'legacy phase: weather and geocode routes both use the legacy geocoder', c)
                    elif pass_name == 'cold':
                        expect('legacy_geo' not in geocoder and geocoder.get('kakao', 0) >= 1,
                               'native phase: no route still uses the legacy geocoder', c)
                    else:
                        expect(not geocoder, 'native phase warm pass: RAM hits only', c)
                    expect(c.get('backend') == 2, 'two weather backend hops per pass', c)
                    phase[pass_name] = {'responses': observed, 'peers': c, 'metrics': m}
                if previous:
                    revalidated = {}
                    for name, path, headers, _ in REHEARSAL:
                        old = previous['cold']['responses'][name]
                        same = old['sha256'] == phase['cold']['responses'][name]['sha256']
                        reply = get(p, path, dict(headers or {}, **{'if-none-match': old['etag']}))
                        expect(reply.status == (304 if same else 200), 'cross-switch revalidation for ' + name, reply.status)
                        revalidated[name] = {'identical_body': same, 'status': reply.status}
                    phase['revalidation_with_previous_etag'] = revalidated
                invalid = get(p, '/weather/coord/not-a-coordinate')
                expect(invalid.status == 400 and invalid.header('cache-control') == 'no-store', 'error no-store contract')
                if deadlines and number == 3:
                    phase['known_gaps'] = [connection_lifetime_gap(ctx, p)]
                expect(p.stop() == 0, 'phase stopped cleanly')
            if deadlines and number > 1:
                phase['deadlines_ms'] = deadline_probe(ctx, mode)
            phases.append(phase)
            line = 'PASS rollback phase %d %s: cold peers[%s] warm peers[%s]' % (
                number, mode, peers_text(phase['cold']['peers']), peers_text(phase['warm']['peers']))
            if 'revalidation_with_previous_etag' in phase:
                hits = sum(1 for v in phase['revalidation_with_previous_etag'].values() if v['status'] == 304)
                line += '; previous-phase ETag 304=%d/%d' % (hits, len(REHEARSAL))
            if 'deadlines_ms' in phase:
                d = phase['deadlines_ms']
                line += '; stalled backend 501 at %.0fms after %d attempts; stalled %s 501 at %.0fms' % (
                    d['backend_stall'], d['backend_attempts'], d['geocoder_kind'], d['geocoder_stall'])
            print(line, flush=True)
            previous = phase
        expect(ctx.peers.counts()['s3'] == 0, 'rollback rehearsal sent no request to the S3 peer')
        return phases
    finally:
        ctx.close()
