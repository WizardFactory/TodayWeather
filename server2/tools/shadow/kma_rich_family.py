"""Domestic canonical S3 replay. Tool capability is not cutover or rollback readiness.

The independent Node16 collector + HTTP recorder supplies frozen expected bytes.
The candidate example injects a clock and disabled providers in test code only;
production server2 has no verification mode or test endpoint setting.
"""
import base64
import gzip
import hashlib
import http.server
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import threading

import harness

FAMILY = 'kma-rich'
ORACLE_LABEL = 'independent Node whole-response'
PASSES = ('cold-empty-ram-and-disk', 'warm-disk-empty-ram',
          'corrupt-disk-empty-ram', 'lost-disk-empty-ram')
REPLAY_FIXTURE = harness.SERVER2 / 'tests/integration/fixtures/kma-rich-replay.json'
ORACLE = harness.SERVER2 / 'tests/domestic/fixtures/s3-rich-response.json.gz'
REPLAY_LIMITATIONS = ('Owned-loopback library HTTP example with test-injected clock/providers; not production startup, '
                     'AWS/EC2 p95, quota, seven-day live shadow or cutover evidence. '
                     'Original 98 dependency-oracle cases remain assembly-only. '
                     'Rich corpus includes three grid regions, stations/ASOS, air/life/KASI/MFDS/images and separately counted cold coordinate geocoding. '
                     'Rollback is UNSUPPORTED here; S20 must verify recovery to an earlier server2 release/config without legacy.')
SCENARIOS = [('KMA-RICH-COLD-S3', 'fresh source/RAM/disk, canonical S3 only'),
             ('KMA-RICH-WARM-DISK', 'fresh source/RAM with verified disk copy'),
             ('KMA-RICH-CORRUPT-DISK', 'corrupt local copies recover canonical S3'),
             ('KMA-RICH-LOST-DISK', 'lost local copies recover canonical S3')]


def oracle():
    with gzip.open(ORACLE, 'rt', encoding='utf-8') as stream:
        value = json.load(stream)
    ids = set()
    for case in value['requests']:
        if case['id'] in ids:
            raise ValueError('duplicate oracle case: ' + case['id'])
        ids.add(case['id'])
        body = base64.b64decode(case['body_base64'], validate=True)
        if hashlib.sha256(body).hexdigest() != case['body_sha256']:
            raise ValueError('oracle body digest mismatch: ' + case['id'])
    if not ids or value['schema'] != 1 or value['oracle']['node'] != 'v16.20.2':
        raise ValueError('invalid independent oracle')
    return value


def oracle_cases():
    return {c['id']: dict(c, headers=list(c['headers'].items())) for c in oracle()['requests']}


def structural_oracle(fixture, records):
    # Every complete response already has a direct independent byte/header oracle.
    return 0, []


def _example(binary):
    path = Path(binary).resolve().parent / 'examples/kma_s3_replay'
    if not path.is_file():
        raise ValueError('build the kma_s3_replay example beside the selected binary')
    return path


def _canonical_peer():
    peer = harness.s3_peer()
    parent = peer.RequestHandlerClass

    class Persistent(parent):
        protocol_version = 'HTTP/1.1'

        def setup(self):
            super().setup()
            self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

    # Only this owned instance changes; each helper invocation creates its own handler class.
    # Accurate Content-Length is supplied by the existing S3 peer. Keeping connections alive
    # avoids exhausting ephemeral ports during hundreds of genuinely cold source snapshots.
    peer.RequestHandlerClass = Persistent
    return peer


def _candidate(binary):
    example = _example(binary)
    before_hash = harness.sha256_file(example)
    peer = _canonical_peer()
    try:
        with tempfile.TemporaryDirectory(prefix='server2-kma-replay-') as cache:
            execution = subprocess.run([str(example), peer.base + '/', str(ORACLE), cache],
                                       cwd=harness.EMPTY_CWD, stdin=subprocess.DEVNULL,
                                       capture_output=True, text=True, timeout=600)
            if execution.returncode:
                raise AssertionError('canonical native replay exited ' + str(execution.returncode) + ': ' + execution.stderr[-3000:])
            actual = json.loads(execution.stdout)
            after_hash = harness.sha256_file(example)
            if before_hash != after_hash:
                raise AssertionError('example changed while verification was running; rerun a stable candidate')
            actual['example'] = {'path': str(example), 'sha256': before_hash}
            actual['s3_requests'] = peer.received
            actual['case_progress'] = execution.stderr.splitlines()
            return actual
    finally:
        peer.close()


def validate_records(actual, cases):
    expected = {(c['id'], phase) for c in cases for phase in PASSES}
    keys = [(r['id'], r['pass']) for r in actual['records']]
    if len(keys) != len(expected) or len(set(keys)) != len(keys) or set(keys) != expected:
        raise AssertionError('native response denominator incomplete, extra or duplicate')
    if actual['legacy_requests'] != 0 or actual['provider_requests'] != 0:
        raise AssertionError('native replay used a legacy/provider HTTP dependency')
    by_id = {c['id']: c for c in cases}
    if actual.get('external_http_requests', 0) != 0:
        raise AssertionError('unexpected external HTTP dependency')
    for record in actual['records']:
        expected = 1 if by_id[record['id']].get('coord_provider') else 0
        if record.get('owned_geocoder_http_requests', 0) != expected:
            raise AssertionError('cold coordinate geocoder denominator differs: ' + record['id'])
    for phase, metric in ((PASSES[1], 'hits'), (PASSES[2], 'corruptions')):
        if not sum((r.get('cache') or {}).get(metric, 0) for r in actual['records'] if r['pass'] == phase):
            raise AssertionError('disk scenario was not exercised: ' + phase)


def _baseline(cases, perturb=False):
    index = {(c['path'], c['lang'], c.get('method', 'GET'), c.get('if_none_match')): c for c in cases}

    class Frozen(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            self.answer()

        def do_HEAD(self):
            self.answer()

        def answer(self):
            key = (self.path, self.headers.get('accept-language'), self.command, self.headers.get('if-none-match'))
            case = index[key]
            body = base64.b64decode(case['body_base64'])
            headers = dict(case['headers'])
            if perturb and case['id'] == cases[0]['id']:
                body += b'!'
                headers['content-length'] = str(len(body))
            self.send_response(case['status'])
            for name, value in headers.items():
                self.send_header(name, value)
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)

    peer = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Frozen)
    thread = threading.Thread(target=peer.serve_forever, daemon=True)
    thread.start()
    records = []
    try:
        for phase in PASSES:
            for case in cases:
                headers = {'accept-language': case['lang']}
                if case.get('if_none_match'):
                    headers['if-none-match'] = case['if_none_match']
                reply = harness.request('http://127.0.0.1:' + str(peer.server_port), case['path'],
                                        method=case.get('method', 'GET'), headers=headers)
                records.append({'id': case['id'], 'pass': phase, 'oracle': case['id'],
                                'status': reply.status, 'headers': reply.headers, 'body': reply.body,
                                'elapsed_ms': reply.elapsed_ms, 'hops': []})
    finally:
        peer.shutdown()
        peer.server_close()
        thread.join(timeout=3)
    return records


def replay_side(binary, fixture, side, perturb=False):
    if hashlib.sha256(ORACLE.read_bytes()).hexdigest() != fixture['oracle']['sha256']:
        raise ValueError('canonical oracle fixture digest differs from manifest')
    frozen = oracle()
    cases = frozen['requests']
    if {c['id'] for c in cases} != {c['id'] for c in fixture['workload']}:
        raise ValueError('workload/oracle case set differs')
    if side == 'baseline':
        return _baseline(cases, perturb), {'configuration': 'Frozen independent Node16 collector+HTTP outputs on loopback; baseline timings are frozen-server transport, not legacy execution',
                                          'perturbation': 'first expected body perturbed' if perturb else None}
    if side != 'candidate' or perturb:
        raise ValueError('invalid replay side/perturbation')
    actual = _candidate(binary)
    validate_records(actual, cases)
    records = []
    for record in actual['records']:
        records.append(dict(record, oracle=record['id'], body=base64.b64decode(record['body_base64'], validate=True), hops=[('geocoder','owned-loopback','ko')] if record.get('owned_geocoder_http_requests') else []))
    info = {k: v for k, v in actual.items() if k != 'records'}
    info['response_audit'] = [{'id': r['id'], 'pass': r['pass'], 'status': r['status'], 'body_sha256': hashlib.sha256(r['body']).hexdigest(), 'headers': r['headers'], 'elapsed_ms': r['elapsed_ms'], 'cache': r.get('cache'), 'disabled_acquisition_attempts': r.get('disabled_acquisition_attempts'), 'owned_geocoder_http_requests': r.get('owned_geocoder_http_requests',0)} for r in records]
    info['configuration'] = 'Fresh S3Source per case/pass; weather raw restored from canonical S3; cold coordinate requests separately acquire one owned-loopback geocoder response; no external HTTP'
    return records, info


def smoke(binary, selected=None):
    known = {s[0] for s in SCENARIOS}
    if selected is not None and (not selected or selected - known):
        raise ValueError('unknown or empty domestic scenario selection')
    import replay
    fixture = json.loads(REPLAY_FIXTURE.read_text())
    candidate, info = replay_side(binary, fixture, 'candidate')
    cases = oracle_cases()
    checked, mismatches = replay.oracle_check(candidate, cases, ['date', 'connection', 'set-cookie', 'server'])
    for record in candidate:
        expected = dict(cases[record['id']]['headers'])
        different = replay.header_differences(expected, record['headers'], ['date', 'connection', 'set-cookie', 'server'])
        if different:
            mismatches.append({'id': record['id'], 'pass': record['pass'], 'headers': different})
    if mismatches or checked != len(cases) * len(PASSES):
        raise AssertionError('independent whole-response mismatch: ' + json.dumps(mismatches[:5]))
    chosen = selected or known
    results = [{'id': sid, 'description': description, 'cases': len(cases), 'verdict': 'PASS'}
               for sid, description in SCENARIOS if sid in chosen]
    return results, {'s3': info['s3_requests'], 'legacy': info['legacy_requests'], 'provider': info['provider_requests']}


def rollback(binary, deadlines=True):
    raise AssertionError('UNSUPPORTED: domestic rollback requires S20 earlier server2 release/config verification; no legacy dependency is introduced')
