#!/usr/bin/env python3
"""Two-release native API recovery on owned peers. No deployment or whole-service qualification.

The artifacts are existing loopback_server release examples, never operator .env values.
The previous runtime must be qualified separately for the full production API/worker inventory.
"""
import argparse
import http.client
import subprocess
from datetime import datetime, timezone
import http.server
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import threading
from urllib.parse import urlsplit

import gateway_family
import harness

# Import the existing recorded world provider, never its coexistence orchestration.
sys.path.insert(0, str(harness.SERVER2 / 'tools'))
import world_smoke

TRANSPORT = {'date', 'connection', 'keep-alive', 'server'}
PATHS = {
    'geocode': ('/geocode/v000903/coord/37.5663,126.9779', {'accept-language': 'ko-KR'}),
    'kma-partial': ('/weather/v000903/coord/37.5663,126.9779', {'accept-language': 'ko-KR'}),
    'world-air': ('/weather/v000903/coord/51.507,-0.128?' + world_smoke.QUERY, {'accept-language': 'ko-KR'}),
    'notice-read': ('/v000903/notice/latest', {'accept-language': 'ko-KR'}),
}


def artifacts(path):
    value = json.loads(Path(path).read_text())
    if (not isinstance(value, dict) or set(value) != {'schema', 'artifacts'} or value['schema'] != 1
            or not isinstance(value['artifacts'], dict) or set(value['artifacts']) != {'current', 'previous'}):
        raise ValueError('exact current/previous artifact manifest required')
    for item in value['artifacts'].values():
        if (not isinstance(item, dict) or set(item) != {'path', 'sha256', 'revision', 'profile'}
                or not all(isinstance(v, str) for v in item.values()) or item['profile'] != 'release'):
            raise ValueError('bound release artifact fields required')
        if not re.fullmatch('[0-9a-f]{40}', item['revision']) or not re.fullmatch('[0-9a-f]{64}', item['sha256']):
            raise ValueError('full revision and SHA256 required')
        p = Path(item['path'])
        if not p.is_absolute() or not p.is_file() or not os.access(p, os.X_OK):
            raise ValueError('absolute existing executable required')
        if harness.sha256_file(p) != item['sha256']:
            raise ValueError('artifact digest mismatch')
    pair = value['artifacts']
    if any(pair['current'][key] == pair['previous'][key] for key in ('revision', 'sha256')):
        raise ValueError('identical revision/binary is not a release recovery rehearsal')
    return pair


def environment(peer, cache):
    config = peer.config_values
    return {'SERVER2_NATIVE_FAMILIES': 'geocode,dsf,kma,notice',
            'SERVER2_S3_BUCKET': config['bucket'], 'AWS_ACCESS_KEY': config['test_access_key'],
            'AWS_SECRET_KEY': config['test_secret_key'], 'GEOCODER_KAKAO_KEYS': '["native-recovery-dummy"]',
            'GEOCODER_GOOGLE_KEY': 'native-recovery-google',
            'DONGNAE_SECRET_KEYS': '["native-recovery-data-go-kr"]', 'VC_SECRET_KEY': 'native-recovery-vc',
            'VC_DAILY_RECORD_LIMIT': '1000', 'WAQI_SECRET_KEY': 'native-recovery-waqi',
            'SERVER2_LOCAL_CACHE_DIR': cache, 'SERVER2_LOCAL_CACHE_MAX_BYTES': str(8 * 1024 * 1024)}


def observed(reply):
    return {'status': reply.status, 'body_sha256': reply.digest(), 'headers': reply.headers,
            'elapsed_ms': round(reply.elapsed_ms, 3)}


def same(expected, actual):
    assert actual['status'] == expected['status'], 'status differs'
    assert actual['body_sha256'] == expected['body_sha256'], 'body bytes differ'
    headers = lambda r: {k: v for k, v in r['headers'].items() if k not in TRANSPORT}
    assert headers(actual) == headers(expected), 'functional header union differs'


def acquisition_contract(number, paths):
    if number:
        assert paths == {'vc': [], 'waqi': []}, 'weather reacquired after restart'
    else:
        assert len(paths['vc']) == 1 and paths['vc'][0].startswith('/timeline/51.51,-0.13/last1days/next7days?'), 'one London VC cell expected'
        # KMA's missing domestic air also uses the funded chain: two different cells,
        # one call each, not two calls to the London cell.
        assert sorted(urlsplit(p).path for p in paths['waqi']) == ['/feed/geo:37.56;126.99/', '/feed/geo:51.51;-0.13/'], 'exact Seoul+London air-cell acquisitions required'


def run(pair, report):
    frozen = gateway_family.Frozen(json.loads(gateway_family.REPLAY_FIXTURE.read_text()))
    providers = harness.RecordingPeer(frozen.providers_reply)
    s3 = harness.s3_peer()
    parent = s3.RequestHandlerClass
    s3.raw_reads = []
    s3.recovery_errors = []
    s3.connection_refusals = 0
    original_slots = s3.slots

    class CountSlots:
        def acquire(self, *args, **kwargs):
            accepted = original_slots.acquire(*args, **kwargs)
            if not accepted:
                s3.connection_refusals += 1
            return accepted

        def release(self):
            original_slots.release()

    s3.slots = CountSlots()

    class ObserveRaw(parent):
        def send_response(self, code, message=None):
            if code >= 400 and code != 404:
                with self.server.lock:
                    self.server.recovery_errors.append({'status': code, 'method': self.command, 'path': urlsplit(self.path).path})
            super().send_response(code, message)

        def parse_request(self):
            accepted = super().parse_request()
            if accepted and self.command == 'GET' and urlsplit(self.path).path.endswith('.raw.gz'):
                with self.server.lock:
                    self.server.raw_reads.append(urlsplit(self.path).path)
            return accepted

    s3.RequestHandlerClass = ObserveRaw
    fixture = world_smoke.Fixture
    fixture.vc_paths, fixture.air_paths, fixture.legacy, fixture.down = [], [], 0, False
    weather = http.server.ThreadingHTTPServer(('127.0.0.1', 0), fixture)
    thread = threading.Thread(target=weather.serve_forever, daemon=True); thread.start()
    weather_url = 'http://127.0.0.1:' + str(weather.server_port)
    phases = report.setdefault('phases', [])
    try:
        with tempfile.TemporaryDirectory(prefix='server2-native-recovery-') as cache:
            for number, role in enumerate(('current', 'previous', 'current')):
                artifact = pair[role]
                assert harness.sha256_file(artifact['path']) == artifact['sha256'], 'artifact changed before execution'
                if number:
                    fixture.down = True
                before = len(fixture.vc_paths), len(fixture.air_paths)
                raw_before = len(s3.raw_reads)
                disk_before = len(list(Path(cache).rglob('*.raw')))
                args = ['--s3', s3.base, '--kakao', providers.base, '--google', providers.base,
                        '--vc', weather_url + '/timeline/', '--waqi', weather_url + '/',
                        '--geocoder-daily-units', '1000']
                phase = {'role': role, 'revision': artifact['revision'], 'responses': {}, 'warm': {}, 'revalidation': {}, 'complete': False}
                phases.append(phase)
                with harness.Server2(artifact['path'], environment(s3, cache), args) as process:
                    for name, (path, headers) in PATHS.items():
                        reply = harness.request(process.public, path, headers=headers)
                        phase['responses'][name] = observed(reply)
                        if reply.status != 200:
                            phase['failure_metrics'] = process.metrics()
                            phase['s3_connection_refusals'] = s3.connection_refusals
                            phase['s3_errors'] = s3.recovery_errors[-30:]
                            phase['error_body'] = reply.body.decode('utf-8', 'replace')[:200]
                            raise AssertionError((name, reply.status))
                        body = json.loads(reply.body)
                        if name == 'world-air':
                            assert body['source'] == 'VC' and 'airSource' in reply.body.decode(), 'world/air input missing'
                        if name == 'notice-read': assert body == {'notice': None}
                        phase['responses'][name] = observed(reply)
                        warm_reply = harness.request(process.public, path, headers=headers)
                        warm = observed(warm_reply)
                        phase['warm'][name] = warm
                        try:
                            same(phase['responses'][name], warm)
                        except AssertionError as error:
                            phase['failure_metrics'] = process.metrics()
                            phase['s3_errors'] = s3.recovery_errors[-30:]
                            phase['s3_connection_refusals'] = s3.connection_refusals
                            phase['s3_version_max'] = max((len(v) for v in s3.versions.values()), default=0)
                            phase['warm_error_body'] = warm_reply.body.decode('utf-8', 'replace')[:200] if warm_reply.status != 200 else None
                            raise AssertionError(f'phase{number+1}/{name}/warm: {error}') from error
                        if number:
                            old = phases[0]['responses'][name]
                            same(old, phase['responses'][name])
                            # Notice has no ETag contract; its body/cache headers still compare exactly.
                            if 'etag' in old['headers']:
                                conditional = harness.request(process.public, path, headers=dict(headers, **{'if-none-match': old['headers']['etag']}))
                                assert conditional.status == 304 and conditional.body == b'', (name, conditional.status)
                                phase['revalidation'][name] = 304
                    phase['metrics'] = process.metrics()
                    phase['s3_connection_refusals'] = s3.connection_refusals
                    phase['s3_errors'] = s3.recovery_errors[-30:]
                    phase['s3_version_max'] = max((len(v) for v in s3.versions.values()), default=0)
                    assert s3.connection_refusals == 0, 'owned S3 peer rejected a connection'
                    assert process.stop(timeout=8) == 0, 'unclean process stop'
                assert harness.sha256_file(artifact['path']) == artifact['sha256'], 'artifact changed during execution'
                calls = [len(fixture.vc_paths) - before[0], len(fixture.air_paths) - before[1]]
                phase['observed_weather_paths'] = {'vc': fixture.vc_paths[before[0]:], 'waqi': fixture.air_paths[before[1]:]}
                acquisition_contract(number, phase['observed_weather_paths'])
                phase['weather_provider_calls'] = dict(vc=calls[0], waqi=calls[1])
                phase['disk'] = {'raw_entries_before': disk_before, 'raw_entries_after': len(list(Path(cache).rglob('*.raw'))), 's3_raw_gets': len(s3.raw_reads) - raw_before, 's3_raw_paths': s3.raw_reads[raw_before:]}
                assert phase['disk']['raw_entries_after'] > 0, 'disk-cache workload not exercised'
                if number:
                    assert disk_before > 0, 'shared verified disk copy absent'
                    # Air raws are deliberately excluded from disk by the privacy contract.
                    # VC must hit disk; only the two canonical air cells may GET their raw.
                    raw_paths = phase['disk']['s3_raw_paths']
                    assert len(raw_paths) == 2 and all('/raw/v2/air-waqi/current/' in p for p in raw_paths), 'unexpected canonical raw reads on restored release'
                phase['percentiles_ms'] = harness.percentiles([r['elapsed_ms'] for r in phase['responses'].values()])
                phase['complete'] = True
                print('PASS phase %d %s: four native APIs, shared S3, weather calls %s' % (number + 1, role, calls), flush=True)
            assert fixture.legacy == 0, 'legacy HTTP was called'
            counts, _ = providers.snapshot()
            assert not counts.get('unknown_provider'), 'unexpected geocoder endpoint'
            # State/budget/raw remain in the same peer; rollback never resets storage.
            return {'phases': phases, 'legacy_http': fixture.legacy, 'geocoder_http': counts,
                    's3_requests': s3.received, 's3_object_count': len(s3.objects),
                    'shared_disk': True, 'weather_restore_calls': 0}
    finally:
        weather.shutdown(); weather.server_close(); thread.join(timeout=3)
        providers.close(); s3.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', required=True, type=Path)
    parser.add_argument('--report', required=True, type=Path)
    args = parser.parse_args(argv)
    report = {'schema': 1, 'started_at_utc': datetime.now(timezone.utc).isoformat(),
              'tool_revision': harness.revision(), 'scope': 'owned-loopback native API release recovery only',
              'limitations': ['Test example with injected roots, not production main/CloudFront/EC2 performance.',
                              'KMA case exercises partial/missing-data, not full KMA parity; use canonical core/rich replays separately.',
                              'Notice read-empty only, not mutation recovery. Push workers, warnings, summary and whole-service release eligibility are not qualified.',
                              'Revision/profile fields are caller-supplied build provenance; hashes are verified, not an independent source-to-binary attestation.']}
    code = 1
    try:
        report['artifacts'] = artifacts(args.artifacts)
        report.update(run(report['artifacts'], report))
        report['verdict'] = 'PASS'; code = 0
    except (AssertionError, ValueError, OSError, RuntimeError, KeyError, subprocess.SubprocessError, http.client.HTTPException) as error:
        report['verdict'] = 'FAIL'; report['error'] = str(error)
    harness.write_report(str(args.report), report)
    print(report['verdict'] + ' native API recovery; not production or whole-service qualification', flush=True)
    return code


if __name__ == '__main__': sys.exit(main())
