#!/usr/bin/env python3
"""Empty-cache forecast build times of two or more smoke binaries at modeled S3 delays.

Owned loopback only: one persistent S06 peer, one seeded corpus, then for every delay
and run each binary's `http` (fresh process: cold, warm1, warm2) and `aged` (cold, then
a rebuild after the 30-second freshness) modes, interleaved. The peer delays every
GET/HEAD/LIST by the modeled milliseconds; seeding runs without delay. Bodies are kept
per run and compared with the reference hash. A cold or aged answer cut by the 3-second
deadline leaves its owners building; the example reports when they were idle (views ready). Works on Linux and macOS; no provider,
credential or AWS access.
"""
import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import platform
import select
import signal
import shutil
import statistics
import subprocess
import sys
import time
import urllib.request

SERVER2 = Path(__file__).resolve().parents[1]
REFERENCE_SHA256 = 'a6462aba8ad9ec34d8efdcab4ccd2f37b00339a301fd17caa7c1e5485d45b283'
# The original 730-acquisition corpus written by the example's seed mode (same digest as
# the D2 runner checks).
FIXTURE_SHA256 = '11606b79c26365e4ba8a5a906d5801f717845f853bafc971c2f099d27b7bbe3f'
MODES = {'http': ('cold', 'warm1', 'warm2'), 'aged': ('cold', 'aged')}
IO_CLASSES = ('LIST', 'GET_catalog', 'GET_descriptor', 'GET_raw')
CHILD_SECONDS = 180


def runner():
    """The D2 runner's I/O classification, imported without running it."""
    spec = importlib.util.spec_from_file_location('warm_runner', SERVER2/'tools/domestic_warm_cache_smoke.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def parse_binary(text):
    name, sep, path = text.partition('=')
    if not sep or not name or not name.replace('-', '').replace('_', '').isalnum() or not path:
        raise argparse.ArgumentTypeError('use NAME=PATH with a plain name')
    return name, Path(path).resolve()


def percentile(values, fraction):
    """Nearest-rank percentile of a non-empty list."""
    ordered = sorted(values)
    return ordered[max(0, math.ceil(fraction * len(ordered)) - 1)]


def phase_rows(stdout_text, labels, classify):
    """One row per phase record printed by the example's http/aged modes."""
    rows = []
    for line in stdout_text.splitlines():
        record = json.loads(line)
        outcome = record['outcome']
        per_dataset, unknown = classify(record['status_before'], record['status_after'], labels)
        forecast = {c: sum(row.get(c, 0) for label, row in per_dataset.items() if label != 'zone-support')
                    for c in IO_CLASSES}
        before, after = record['forecast_cache_before'], record['forecast_cache_after']
        rows.append({'phase': record['phase'], 'status': outcome.get('http_status'),
                     'transport_error': outcome.get('transport_error'),
                     'elapsed_ms': record['elapsed_ms'], 'views_ready_ms': record.get('views_ready_ms'),
                     'mapped': after.get('mapped_entries'), 'sha256': outcome.get('sha256'),
                     'bytes': outcome.get('bytes'), 'forecast_io': forecast,
                     'other_io_operations': sum(v for k, v in unknown.items() if k.startswith('OP ')),
                     'other_io_bytes': sum(v for k, v in unknown.items() if k.startswith('BODYOUT ')),
                     'parses': after['parse_acquisitions'] - before['parse_acquisitions'],
                     'folds': after['folds'] - before['folds']})
    return rows


def summarize(rows, reference):
    """Per binary, mode, delay and phase: statuses, times and identity of the answers."""
    groups = {}
    for row in rows:
        key = (row['binary'], row['mode'], row['delay_ms'], row['phase'])
        groups.setdefault(key, []).append(row)
    summary = []
    for (binary, mode, delay, phase), group in sorted(groups.items()):
        ok = [r for r in group if r['status'] == 200]
        times = [r['elapsed_ms'] for r in group]
        # Cold and aged answers leave owners building after a cut answer: when the views were ready.
        rebuilt = phase in ('cold', 'aged')
        ready = [r['views_ready_ms'] for r in group if rebuilt and r.get('views_ready_ms') is not None]
        mapped = [r['mapped'] for r in group if r.get('mapped') is not None]
        summary.append({
            'binary': binary, 'mode': mode, 'delay_ms': delay, 'phase': phase, 'runs': len(group),
            'status_counts': {str(s): sum(1 for r in group if r['status'] == s)
                              for s in sorted({r['status'] for r in group}, key=str)},
            'median_ms': statistics.median(times), 'p95_ms': percentile(times, 0.95),
            'min_ms': min(times), 'max_ms': max(times),
            'ok_median_ms': statistics.median([r['elapsed_ms'] for r in ok]) if ok else None,
            'hash_mismatches': sum(1 for r in ok if r['sha256'] != reference),
            'ready_runs': len(ready), 'not_ready_runs': sum(1 for r in group if rebuilt and r.get('views_ready_ms') is None),
            'ready_median_ms': statistics.median(ready) if ready else None,
            'ready_p95_ms': percentile(ready, 0.95) if ready else None,
            'mapped_median': statistics.median(mapped) if mapped else None,
            'forecast_io_median': {c: statistics.median(r['forecast_io'][c] for r in group) for c in IO_CLASSES},
            'other_io_median': statistics.median(r['other_io_operations'] for r in group),
        })
    return summary


def problems(rows, exits, reference):
    """Harness integrity only. A non-200 answer, and the example stopping after it, is a
    measured result kept in the summary; anything else unexpected is a problem."""
    found = []
    for (binary, mode, delay, run), code in sorted(exits.items(), key=str):
        mine = [r for r in rows if (r['binary'], r['mode'], r['delay_ms'], r['run']) == (binary, mode, delay, run)]
        phases = tuple(r['phase'] for r in mine)
        where = f'{binary} {mode} {delay}ms run{run}'
        if not phases or phases != MODES[mode][:len(phases)]:
            found.append(f'{where}: phases {list(phases)}, exit {code}')
            continue
        failed = [r for r in mine if r['status'] != 200]
        # Only the aged rebuild runs after a cut cold request (the example's rule).
        if failed and failed[0] is not mine[-1] and not (mode == 'aged' and failed[0]['phase'] == 'cold'):
            found.append(f'{where}: continued after a failed {failed[0]["phase"]}')
        if not failed and (code != 0 or len(phases) < len(MODES[mode])):
            found.append(f'{where}: exit {code} after {list(phases)} all 200')
        found += [f'{where} {r["phase"]}: body {r["sha256"]} is not the reference'
                  for r in mine if r['status'] == 200 and r['sha256'] != reference]
    return found


def latency(endpoint, ms):
    request = urllib.request.Request(f'{endpoint}__catalog?mode=latency&key=owned&ms={ms}', data=b'',
                                     method='POST', headers={'X-Server2-Test-Key': 'server2-local'})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=5) as response:
        if response.status != 204:
            raise RuntimeError(f'peer refused latency {ms}')


def child(binary, endpoint, mode, manifest, directory):
    env = dict(os.environ, NO_PROXY='127.0.0.1,localhost', no_proxy='127.0.0.1,localhost')
    with (directory/'stdout').open('w') as stdout, (directory/'stderr').open('w') as stderr:
        process = subprocess.Popen([str(binary), endpoint, mode, str(manifest)], cwd=SERVER2, env=env,
                                   stdout=stdout, stderr=stderr, start_new_session=True)
        try:
            return process.wait(timeout=CHILD_SECONDS)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            return 'TIMEOUT'
        except BaseException:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise


def main():
    # A stopped run still reaps its children and peer (the `finally` blocks below).
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=parse_binary, action='append', required=True,
                        help='NAME=PATH of a copied domestic_warm_cache_smoke executable; first one seeds')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--delays', type=int, nargs='+', default=[0, 10, 20])
    parser.add_argument('--runs', type=int, default=5)
    parser.add_argument('--modes', nargs='+', choices=sorted(MODES), default=['http', 'aged'])
    parser.add_argument('--reference', default=REFERENCE_SHA256)
    args = parser.parse_args()
    names = [name for name, _ in args.binary]
    if len(set(names)) != len(names) or args.runs < 1 or any(d < 0 or d > 1000 for d in args.delays):
        raise SystemExit('distinct binary names, at least one run and delays of 0-1000 ms are required')
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        raise SystemExit('output directory must be new or empty; existing evidence is preserved')
    output.mkdir(parents=True, exist_ok=True)
    classify = runner().io_delta
    inputs = {'binaries': {name: {'path': str(path), 'sha256': digest(path)} for name, path in args.binary},
              'tool_sha256': digest(__file__), 'peer_sha256': digest(SERVER2/'tests/storage/catalog_peer.py'),
              'delays_ms': args.delays, 'runs': args.runs, 'modes': args.modes, 'reference_sha256': args.reference,
              'platform': platform.platform(), 'machine': platform.machine(), 'cpus': os.cpu_count()}
    (output/'inputs.json').write_text(json.dumps(inputs, indent=2)+'\n')
    peer = subprocess.Popen([sys.executable, 'tests/storage/catalog_peer.py', '--persistent'], cwd=SERVER2,
                            stdout=subprocess.PIPE, stderr=(output/'peer.stderr').open('w'), text=True)
    rows, exits = [], {}
    try:
        ready, _, _ = select.select([peer.stdout], [], [], 5)
        if not ready:
            raise SystemExit('owned peer did not report an endpoint in 5 s')
        endpoint = peer.stdout.readline().strip()
        if not endpoint.startswith('http://127.0.0.1:'):
            raise SystemExit('owned IPv4 loopback endpoint required')
        manifest = output/'fixture-manifest.json'
        (output/'seed').mkdir()
        if child(args.binary[0][1], endpoint, 'seed', manifest, output/'seed') != 0 or digest(manifest) != FIXTURE_SHA256:
            raise SystemExit('seed failed or the corpus identity changed; see seed/stderr')
        labels = json.loads(manifest.read_text())['io_object_labels']
        for delay in args.delays:
            latency(endpoint, delay)
            for run in range(1, args.runs+1):
                for mode in args.modes:
                    for name, binary in args.binary:
                        directory = output/name/mode/f'd{delay}'/f'r{run:02d}'
                        directory.mkdir(parents=True)
                        shutil.copy2(manifest, directory/'fixture-manifest.json')
                        exits[(name, mode, delay, run)] = child(binary, endpoint, mode, directory/'fixture-manifest.json', directory)
                        for row in phase_rows((directory/'stdout').read_text(), labels, classify):
                            rows.append({'binary': name, 'mode': mode, 'delay_ms': delay, 'run': run, **row})
                        print(json.dumps({'binary': name, 'mode': mode, 'delay_ms': delay, 'run': run,
                                          'exit': exits[(name, mode, delay, run)],
                                          'phases': {r['phase']: [r['status'], round(r['elapsed_ms'])]
                                                     for r in rows if (r['binary'], r['mode'], r['delay_ms'], r['run']) == (name, mode, delay, run)}}),
                              flush=True)
        latency(endpoint, 0)
    finally:
        peer.terminate()
        try:
            peer.wait(timeout=5)
        except subprocess.TimeoutExpired:
            peer.kill()
            peer.wait()
    summary = summarize(rows, args.reference)
    found = problems(rows, exits, args.reference)
    (output/'matrix.json').write_text(json.dumps({'inputs': inputs, 'rows': rows, 'summary': summary,
                                                   'problems': found, 'peer_exit': peer.returncode}, indent=2)+'\n')
    for s in summary:
        ready = '' if s['ready_median_ms'] is None else f"  views ready {s['ready_median_ms']:.0f} ms ({s['ready_runs']}/{s['runs']}, {s['mapped_median']} mapped)"
        print(f"{s['binary']:>10} {s['mode']:>4} {s['delay_ms']:>3}ms {s['phase']:>5}  status {s['status_counts']}"
              f"  median {s['median_ms']:.0f} ms  p95 {s['p95_ms']:.0f} ms{ready}  forecast GET {s['forecast_io_median']}")
    for problem in found:
        print('PROBLEM', problem)
    return 1 if found else 0


if __name__ == '__main__':
    raise SystemExit(main())
