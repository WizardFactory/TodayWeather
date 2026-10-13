"""KMA v000903 family (S15): scenarios, paired replay sides and the legacy/native rollback.

The release binary runs against task-owned loopback peers: a frozen legacy origin (legacy
geocoder replies plus the S15 oracle's recorded legacy KMA backend bodies) and the S03 local
S3-compatible peer. The native side assembles from the recorded store answers of the same
oracle (`SERVER2_KMA_MODE=recorded-local`); the S3 input source is S15b, so no request may
reach the S3 peer. Loopback fixtures only; no provider, AWS or traffic mirroring.
"""
import base64
import gzip
import json
import time
from urllib.parse import urlsplit

import harness

SERVER2 = harness.SERVER2
REPLAY_FIXTURE = SERVER2 / 'tests/domestic/fixtures/kma-replay.json'
RECORDING = SERVER2 / 'tests/domestic/fixtures/oracle.json.gz'
RECORDS = SERVER2 / 'tests/golden/records.json'
GW = 'server2_gateway_'
REPLAY_LIMITATIONS = ('Offline frozen inputs on loopback peers; the native side replays recorded store answers. '
                      'Not live shadow, production latency, quota or S3 input-source evidence.')
_CACHE = {}


def _load(path):
    if path not in _CACHE:
        raw = path.read_bytes()
        _CACHE[path] = json.loads(gzip.decompress(raw) if path.suffix == '.gz' else raw)
    return _CACHE[path]


def oracle_cases():
    return {case['id']: case for case in _load(RECORDS)['cases']}


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


class Frozen:
    """Frozen legacy geocode replies and recorded legacy KMA backend bodies."""

    def __init__(self, fixture, perturb=False):
        self.coord = {(round(e['lat'], 3), round(e['lon'], 3), e['lang']): encode(e['body'])
                      for e in fixture['legacy_geocode']}
        self.backends = {}
        self.perturbation = None
        for sc in _load(RECORDING)['scenarios']:
            if not sc['id'].startswith('gateway-'):
                continue
            path = '/v000903/kma' + sc['path'] + ('?' + sc['query'] if sc['query'] else '')
            # Several history scenarios share one request; the first recorded one answers it.
            self.backends.setdefault((path, sc['lang'] or ''), sc['body'].encode())
        if perturb:
            key = sorted(self.backends)[0]
            self.backends[key] = self.backends[key].replace(b'"source":"KMA"', b'"source":"KMX"', 1)
            self.perturbation = 'baseline legacy KMA backend source label changed'

    def legacy_reply(self, path, headers):
        split = urlsplit(path)
        text = 'application/json; charset=utf-8'
        if split.path.startswith('/geocode/v000903/coord/'):
            lat, lon = (float(x) for x in split.path.rsplit('/', 1)[1].split(','))
            body = self.coord.get((round(lat, 3), round(lon, 3), headers.get('accept-language', '')))
            return ('legacy_geo', 200, text, body) if body else ('legacy_geo', 404, 'text/plain', b'Not Found')
        if split.path.startswith('/v000903/kma/addr/'):
            body = self.backends.get((path, headers.get('accept-language', '')))
            return ('kma_backend', 200, text, body) if body else ('kma_backend', 404, 'text/plain', b'Not Found')
        return 'unknown_legacy', 404, 'text/plain', b'Not Found'


class Peers:
    def __init__(self, frozen):
        self.legacy = harness.RecordingPeer(frozen.legacy_reply)
        self.s3 = harness.s3_peer()

    def counts(self):
        merged = dict(self.legacy.snapshot()[0])
        merged['s3'] = self.s3.received
        return merged

    def mark(self):
        return self.legacy.snapshot()[1]

    def hops_since(self, mark):
        return self.legacy.hops_since(mark)

    def close(self):
        for peer in (self.legacy, self.s3):
            peer.close()


def kma_env(peers, mode):
    """mode: legacy (KMA unset), native (recorded store answers) or forward (native, forwards)."""
    config = peers.s3.config_values
    env = {
        'SERVER2_GATEWAY_LEGACY_URL': peers.legacy.base,
        'SERVER2_GEOCODER_MODE': 'legacy',
        # Attached so any S3 use would be observed; the KMA family must not use it yet (S15b).
        'SERVER2_S3_ENDPOINT': peers.s3.base,
        'AWS_ACCESS_KEY_ID': config['test_access_key'],
        'AWS_SECRET_ACCESS_KEY': config['test_secret_key'],
        'AWS_REGION': 'us-east-1',
        'AWS_EC2_METADATA_DISABLED': 'true',
    }
    if mode == 'native':
        env.update({'SERVER2_KMA_MODE': 'recorded-local', 'SERVER2_KMA_RECORDED': str(RECORDING),
                    'SERVER2_KMA_MAX_CURRENT_COUNT': str(_load(RECORDING)['oracle']['max_current_count'])})
    elif mode == 'forward':
        env['SERVER2_KMA_MODE'] = 'forward-local'
    return env


def expect(condition, message, observed=None):
    if not condition:
        raise AssertionError(message + ('' if observed is None else ': ' + json.dumps(observed, sort_keys=True, default=str)))


TRANSPORT = ('date', 'connection', 'keep-alive')


def golden_problems(reply, oracle):
    case = oracle_cases()[oracle]
    problems = []
    if reply.status != case['status']:
        problems.append(['status', case['status'], reply.status])
    if reply.body != base64.b64decode(case['body_base64']):
        problems.append(['body_sha256', case['body_sha256'], reply.digest()])
    expected = {n: (v if isinstance(v, str) else ', '.join(v)) for n, v in case['headers'] if n not in TRANSPORT}
    observed = {n: v for n, v in reply.headers.items() if n not in TRANSPORT}
    for name in sorted(set(expected) | set(observed)):
        if observed.get(name) != expected.get(name):
            problems.append([name, expected.get(name), observed.get(name)])
    return problems


def serve(binary, peers, mode, items):
    """Request each workload item once in a fresh process; check the S02 golden and peer work."""
    observed = []
    with harness.Server2(binary, kma_env(peers, mode)) as process:
        for item in items:
            before_metrics, before_peers = process.metrics(), peers.counts()
            reply = harness.request(process.public, item['path'], 'GET', item.get('headers'))
            problems = golden_problems(reply, item['oracle'])
            expect(not problems, mode + ' ' + item['id'] + ' equals S02 ' + item['oracle'], problems)
            m = harness.delta(process.metrics(), before_metrics)
            c = harness.delta(peers.counts(), before_peers)
            hops = 1 if mode in ('legacy', 'forward') else 0
            want = {'legacy_geo': 1, 'kma_backend': hops} if hops else {'legacy_geo': 1}
            expect(c == want, mode + ' ' + item['id'] + ' peer work', c)
            expect(m.get(GW + 'backend_attempts_total', 0) == hops, mode + ' ' + item['id'] + ' legacy backend attempts', m)
            observed.append({'id': item['id'], 'oracle': item['oracle'], 'peers': c,
                             'elapsed_ms': round(reply.elapsed_ms, 2)})
        rss = process.rss_kib()
        expect(process.metrics()[GW + 'owned_inflight'] == 0, 'owned work drained')
        expect(process.stop() == 0, mode + ' process stopped cleanly')
    return observed, rss


def scenario_legacy_default(ctx):
    observed, rss = serve(ctx['binary'], ctx['peers'], 'legacy', ctx['workload'][:1])
    return {'requests': observed, 'rss_kib': rss}


def scenario_native(ctx):
    observed, rss = serve(ctx['binary'], ctx['peers'], 'native', ctx['workload'])
    return {'requests': observed, 'rss_kib': rss}


def scenario_forward(ctx):
    observed, rss = serve(ctx['binary'], ctx['peers'], 'forward', ctx['workload'][:1])
    return {'requests': observed, 'rss_kib': rss}


SCENARIOS = [
    ('KMA-LEGACY-DEFAULT', 'KMA unset: the legacy backend serves v000903 (S02 bytes)', scenario_legacy_default),
    ('KMA-NATIVE', 'native KMA assembly from recorded store answers equals the S02 gateway goldens', scenario_native),
    ('KMA-FORWARD', 'native selected, source declines: the request is forwarded to legacy', scenario_forward),
]


def peers_text(counts):
    return ' '.join(k + '=' + str(v) for k, v in sorted(counts.items())) or 'none'


def smoke(binary, selected=None):
    known = {scenario[0] for scenario in SCENARIOS}
    if selected is not None and (not selected or selected - known):
        raise ValueError('unknown or empty scenario selection: ' + ', '.join(sorted(selected - known)) +
                         '; known: ' + ', '.join(sorted(known)))
    fixture = _load(REPLAY_FIXTURE)
    peers = Peers(Frozen(fixture))
    ctx = {'binary': binary, 'peers': peers, 'workload': fixture['workload']}
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
            print('     ' + '; '.join(r['id'] + ' peers[' + peers_text(r['peers']) + '] ' + str(r['elapsed_ms']) + 'ms'
                                      for r in observed['requests']) + '; RSS KiB ' + str(observed['rss_kib']), flush=True)
        expect(peers.counts()['s3'] == 0, 'KMA family sent no request to the S3 peer')
        return results, peers.counts()
    finally:
        peers.close()


def structural_oracle(fixture, records):
    """The S02 oracle check covers every KMA workload item; no separate merge oracle."""
    return 0, []


def replay_side(binary, fixture, side, perturb=False):
    frozen = Frozen(fixture, perturb)
    mode = 'legacy' if side == 'baseline' else 'native'
    peers = Peers(frozen)
    records, acquisitions = [], {}
    try:
        with harness.Server2(binary, kma_env(peers, mode)) as process:
            for pass_name in ('cold', 'warm'):
                start = peers.counts()
                for item in fixture['workload']:
                    headers = dict(item.get('headers', {}))
                    mark = peers.mark()
                    reply = harness.request(process.public, item['path'], item['method'], headers)
                    records.append({'id': item['id'], 'pass': pass_name, 'oracle': item.get('oracle'),
                                    'path': item['path'], 'method': item['method'], 'headers_sent': headers,
                                    'status': reply.status, 'headers': reply.headers, 'body': reply.body,
                                    'elapsed_ms': reply.elapsed_ms, 'hops': peers.hops_since(mark)})
                acquisitions[pass_name] = harness.delta(peers.counts(), start)
            metrics = {k: v for k, v in process.metrics().items() if k.startswith(GW) and v}
            expect(process.stop() == 0, 'replay side stopped cleanly')
        s3 = peers.counts()['s3']
    finally:
        peers.close()
    expect(s3 == 0, 'replay side sent no request to the S3 peer')
    return records, {'configuration': 'KMA ' + mode, 'mode': mode, 'acquisitions': acquisitions,
                     'metrics': metrics, 's3_requests': s3, 'perturbation': frozen.perturbation}


def rollback(binary, deadlines=True):
    """legacy -> native -> legacy for v000903 KMA: same bytes, cache contract, ETag revalidation.

    The 9s/5s/3s deadline caps are exercised by the gateway family; `deadlines` is accepted for
    interface parity.
    """
    fixture = _load(REPLAY_FIXTURE)
    item = fixture['workload'][0]
    peers = Peers(Frozen(fixture))
    phases, previous = [], None
    try:
        for number, mode in enumerate(('legacy', 'native', 'legacy'), 1):
            phase = {'phase': number, 'mode': mode}
            with harness.Server2(binary, kma_env(peers, mode)) as process:
                before = peers.counts()
                reply = harness.request(process.public, item['path'], 'GET', item['headers'])
                expect(not golden_problems(reply, item['oracle']), 'phase %d %s equals S02' % (number, mode))
                expect(reply.header('cache-control') == 'max-age=300', 'weather cache contract', reply.header('cache-control'))
                phase['peers'] = harness.delta(peers.counts(), before)
                phase['etag'] = reply.header('etag')
                if previous:
                    again = harness.request(process.public, item['path'], 'GET', dict(item['headers'], **{'if-none-match': previous['etag']}))
                    expect(again.status == 304, 'cross-switch ETag revalidation', again.status)
                    phase['revalidation_with_previous_etag'] = again.status
                invalid = harness.request(process.public, '/weather/coord/not-a-coordinate')
                expect(invalid.status == 400 and invalid.header('cache-control') == 'no-store', 'error no-store contract')
                expect(process.stop() == 0, 'phase stopped cleanly')
            phases.append(phase)
            print('PASS rollback phase %d %s: peers[%s]%s' % (number, mode, peers_text(phase['peers']),
                  '; previous-phase ETag 304' if previous else ''), flush=True)
            previous = phase
        expect(peers.counts()['s3'] == 0, 'rollback rehearsal sent no request to the S3 peer')
        return phases
    finally:
        peers.close()
