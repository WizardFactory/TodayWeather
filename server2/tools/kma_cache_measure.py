#!/usr/bin/env python3
"""Measure explicit disposable raw caching against owned HTTP peers only.

No .env/provider/AWS calls. Debug/local timing is not an EC2/S3 p95 claim. The 6 MiB
raw probe is synthetic incompressible bytes, not a decoded AirKorea GIF. The KMA
HTTP check seeds three current publications, so its response is a partial-weather
scenario, not an eight-day/full-input parity or quota result.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import sys
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
import urllib.parse
import urllib.request
import gateway_smoke as g
import kma_smoke as k

ROOT = Path(__file__).resolve().parents[1]


def counts(endpoint):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(endpoint + '__catalog/status', timeout=10) as response:
        value = json.load(response)
    return {kind: sum(v for name, v in value.items() if name.startswith('GET ' + prefix))
            for kind, prefix in [('raw_gets', 'raw/v2/'), ('control_gets', 'index/v2/')]}


def start(binary, s3, origin, directory, cwd):
    env = {key: value for key, value in os.environ.items() if key in ('PATH', 'SYSTEMROOT', 'TMPDIR')}
    env.update(PORT='0', SERVER2_GATEWAY_LEGACY_URL=origin, SERVER2_NATIVE_FAMILIES='kma',
               **k.s3_env(), **k.kma_env())
    if directory is not None:
        env.update(SERVER2_LOCAL_CACHE_DIR=str(directory), SERVER2_LOCAL_CACHE_MAX_BYTES=str(16 * 1024 * 1024))
    child = subprocess.Popen(k.peer_command(str(binary), origin, s3), cwd=cwd, env=env,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        ready, _, _ = select.select([child.stdout], [], [], 10)
        assert ready, 'native process startup timeout'
        line = child.stdout.readline().strip()
        match = re.fullmatch(r'server2 public=(127\.0\.0\.1:\d+) metrics=(127\.0\.0\.1:\d+)', line)
        assert match, 'native process did not publish owned addresses'
        return child, 'http://' + match[1]
    except BaseException:
        g.stop(child)
        raise


def run(measure_binary, native_binary):
    k.Origin.fixtures = json.loads(g.FIXTURES.read_text())
    k.Origin.paths = []
    origin = http.server.ThreadingHTTPServer(('127.0.0.1', 0), k.Origin)
    threading.Thread(target=origin.serve_forever, daemon=True).start()
    origin_url = 'http://127.0.0.1:' + str(origin.server_port)
    spec = importlib.util.spec_from_file_location('s15b4c_catalog_peer', ROOT / 'tests/storage/catalog_peer.py')
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    peer = module.make()
    # This owned benchmark needs the actual image-sized raw case. The common S03
    # tiny-fixture peer remains unchanged; this local instance is capped at 8 MiB/object.
    peer.config['max_object_bytes'] = 8 * 1024 * 1024
    threading.Thread(target=peer.serve_forever, daemon=True).start()
    s3 = 'http://127.0.0.1:' + str(peer.server_port) + '/' 
    try:
        with tempfile.TemporaryDirectory(prefix='server2-cache-measure-') as temp:
            root = Path(temp)
            before = counts(s3)
            completed = subprocess.run([str(measure_binary), s3, str(root / 'raw')], cwd=root,
                                       env={key: value for key, value in os.environ.items()
                                            if key in ('PATH', 'SYSTEMROOT', 'TMPDIR')},
                                       capture_output=True, text=True, timeout=90, check=False)
            assert completed.returncode == 0, completed.stderr
            raw = json.loads(completed.stdout)
            raw['http_counters_including_seed_publication'] = {
                name: value - before[name] for name, value in counts(s3).items()}
            phases = []
            path = '/v000903/kma/addr/' + '/'.join(urllib.parse.quote(v) for v in ('서울특별시', '중구', '명동'))
            for name, directory in [('cache-unset-empty-ram', None),
                                    ('cold-empty-ram-and-disk', root / 'native'),
                                    ('warm-disk-empty-ram', root / 'native')]:
                before = counts(s3)
                hops = len(k.Origin.paths)
                child, base = start(native_binary, s3, origin_url, directory, root)
                try:
                    started = time.perf_counter()
                    status, _, body = g.request(base, path, headers={'Accept-Language': 'ko-KR'})
                    elapsed = (time.perf_counter() - started) * 1000
                    assert status == 200, (name, status)
                    decoded = json.loads(body)
                    assert decoded.get('source') == 'KMA', (name, decoded.get('source'))
                    assert not any(p.startswith('/v000903/kma/addr/') for p in k.Origin.paths[hops:]), 'legacy hop'
                finally:
                    g.stop(child)
                after = counts(s3)
                phases.append(dict(phase=name, elapsed_ms=elapsed, status=status,
                                   response_bytes=len(body), response_sha256=hashlib.sha256(body).hexdigest(),
                                   legacy_hops=0, **{n: after[n] - before[n] for n in after}))
            assert len({p['response_sha256'] for p in phases}) == 1, 'native response changed between cache phases (check clock/publication boundary)'
            assert phases[1]['raw_gets'] > 0, 'cold native scenario did not load seeded weather raw'
            assert phases[2]['raw_gets'] < phases[1]['raw_gets'], 'warm disk did not reduce weather raw GETs'
            assert all(p['control_gets'] > 0 for p in phases), 'catalog publication checks were bypassed'
            return dict(executed_at_utc=datetime.now(timezone.utc).isoformat(),
                        scope='owned-loopback debug HTTP, partial KMA current inputs, no AWS/provider/GIF decode latency claim',
                        raw=raw, native_http=phases,
                        native_binary_bytes=native_binary.stat().st_size,
                        binary_sha256={name: hashlib.sha256(path.read_bytes()).hexdigest()
                                       for name, path in [('loopback_server', native_binary), ('kma_cache_measure', measure_binary)]},
                        capacity_assumptions_gib=dict(os=8, retained_binaries=1, bounded_logs=2,
                                                     cache_cap=8, other_peak_temporary=2, swap=0),
                        minimum_free_fraction=0.25, computed_root_minimum_gib=28,
                        recommended_root_gp3_gib=32)
    finally:
        peer.shutdown()
        peer.server_close()
        origin.shutdown()
        origin.server_close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--measure-binary', type=Path, required=True)
    parser.add_argument('--native-binary', type=Path, required=True,
                        help='the task-built loopback_server example, not the production binary')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = run(args.measure_binary.resolve(), args.native_binary.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print('PASS owned-loopback raw and native HTTP cache measurements; no AWS/provider claim')
