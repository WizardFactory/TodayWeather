#!/usr/bin/env python3
"""Owned full-window source baseline; no live endpoint, provider or deployment.

Run with a copied example binary and a new ignored output directory. The existing
persistent S06 peer is created and terminated here. Child CPU/RSS includes fixture
validation/serialization and is not a per-fold allocation measurement.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import select
import signal
import shutil
import subprocess
import sys
import time

SERVER2 = Path(__file__).resolve().parents[1]
FORECAST_LABELS = frozenset((
    'current', 'shortest', 'short', 'rss',
    'mid-fcst/109', 'mid-fcst/156', 'mid-fcst/159',
    'mid-land-fcst/11B00000', 'mid-land-fcst/11F20000', 'mid-land-fcst/11H20000',
    'mid-ta/11B10101', 'mid-ta/11F20501', 'mid-ta/11H20201',
))
IO_METRICS = ('LIST', 'GET_catalog', 'GET_descriptor', 'GET_raw', 'BODYOUT_bytes', 'BODYOUT_raw_bytes')
VERIFICATION_SCOPE = {
    'strict_warm_forecast_labels': sorted(FORECAST_LABELS),
    'separate_support_label': 'zone-support',
    'limitations': [
        'Original zone-support numOfRows999 is rejected by the existing zone parser requiring1000; no ZoneCache installation is qualified.',
        'Optional observation inputs are absent; denied stub calls are measured separately from external network calls.',
        'Exact source Docs and repeated HTTP body identity do not establish a complete API golden or host capacity.',
    ],
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def child(binary, endpoint, mode, manifest, output):
    command = ['/usr/bin/time', '-l', str(binary), endpoint, mode, str(manifest)]
    if platform.system() != 'Darwin':
        raise RuntimeError('This baseline runner currently records Darwin time -l bytes; do not guess other RSS units')
    started = time.monotonic()
    env = os.environ.copy()
    env.update(NO_PROXY='127.0.0.1,localhost', no_proxy='127.0.0.1,localhost')
    interruption = None
    with (output / (mode + '.stdout')).open('w') as stdout, (output / (mode + '.stderr')).open('w') as stderr:
        process = subprocess.Popen(command, cwd=SERVER2, env=env, stdout=stdout, stderr=stderr, start_new_session=True)
        try:
            code = process.wait(timeout=300)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            code = 'TIMEOUT'
        except BaseException as error:
            interruption = error
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
            code = 'INTERRUPTED'
    text = (output / (mode + '.stderr')).read_text()
    rss = re.search(r'^\s*(\d+)\s+maximum resident set size', text, re.M)
    cpu = re.search(r'([\d.]+) real\s+([\d.]+) user\s+([\d.]+) sys', text)
    receipt = {'command': command, 'exit': code, 'elapsed_seconds': time.monotonic()-started,
               'peak_rss_bytes': int(rss[1]) if rss else 'NOT_MEASURED',
               'child_user_seconds': float(cpu[2]) if cpu else 'NOT_MEASURED',
               'child_system_seconds': float(cpu[3]) if cpu else 'NOT_MEASURED',
               'rss_unit_source': 'Darwin /usr/bin/time -l maximum resident set size: bytes',
               'rss_scope': 'whole child, includes expected JSON, serialization and source; not logical Doc weight',
               'stdout_sha256': digest(output/(mode+'.stdout')), 'stderr_sha256': digest(output/(mode+'.stderr'))}
    (output/(mode+'-receipt.json')).write_text(json.dumps(receipt, indent=2)+'\n')
    if interruption is not None:
        raise interruption
    return receipt


def io_delta(before, after, labels):
    totals = {}
    unknown = {}
    for key, value in after.items():
        delta = value-before.get(key, 0)
        if delta <= 0 or not key.startswith(('OP ', 'BODYOUT ')):
            continue
        metric, operation, path = key.split(' ', 2)
        label = labels.get(path)
        if operation == 'LIST':
            matches = {value for candidate, value in labels.items() if candidate.startswith(path)}
            if len(matches) == 1:
                label = matches.pop()
        if label is None:
            unknown[key] = delta
            continue
        row = totals.setdefault(label, {'LIST': 0, 'GET_catalog': 0, 'GET_descriptor': 0, 'GET_raw': 0,
                                        'BODYOUT_bytes': 0, 'BODYOUT_raw_bytes': 0})
        if metric == 'BODYOUT':
            row['BODYOUT_bytes'] += delta
            if path.startswith('raw/'):
                row['BODYOUT_raw_bytes'] += delta
        elif operation == 'LIST':
            row['LIST'] += delta
        elif operation == 'GET':
            row['GET_'+('raw' if path.startswith('raw/') else 'descriptor' if path.startswith('index/v2/groups/') else 'catalog')] += delta
    return totals, unknown


def validate_forecast_labels(manifest):
    expected = manifest.get('expected_source_documents')
    labels = manifest.get('io_object_labels')
    if not isinstance(expected, dict) or set(expected) != FORECAST_LABELS:
        raise RuntimeError('complete fixture must contain the exact13 expected forecast datasets')
    if not isinstance(labels, dict) or set(labels.values()) != FORECAST_LABELS | {'zone-support'}:
        raise RuntimeError('classified fixture labels must be exactly the13 forecast datasets plus zone-support')


def check_warm_forecast_io(record, manifest):
    validate_forecast_labels(manifest)
    per_dataset, _ = io_delta(record['status_before'], record['status_after'], manifest['io_object_labels'])
    if any(value for label, row in per_dataset.items() if label in FORECAST_LABELS for value in row.values()):
        raise RuntimeError('warm complete forecast performed classified source IO; preserve actual counters')


def check_folded_forecast_io(record, manifest):
    validate_forecast_labels(manifest)
    rows, _ = io_delta(record['status_before'], record['status_after'], manifest['io_object_labels'])
    if any(row['GET_raw'] or row['GET_descriptor'] for label, row in rows.items() if label in FORECAST_LABELS):
        raise RuntimeError('folded restore/renew fetched raw or group descriptors')
    after = record['forecast_cache_after']; before = record['forecast_cache_before']
    if after['parse_acquisitions'] != before['parse_acquisitions'] or after['folds'] != before['folds']:
        raise RuntimeError('folded restore/renew parsed or folded')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--build-variant', choices=['debug', 'release'], required=True)
    parser.add_argument('--modes', nargs='+', choices=['seed', 'diagnostic', 'native', 'http', 'disk', 'http-disk', 'disk-boundary'], default=['seed', 'diagnostic'])
    args = parser.parse_args()
    if args.modes[0] != 'seed' or len(set(args.modes)) != len(args.modes):
        raise RuntimeError('Use seed first and each mode once; every run owns a fresh peer')
    if 'http' in args.modes and (args.build_variant != 'release' or 'diagnostic' not in args.modes or args.modes.index('diagnostic') > args.modes.index('http')):
        raise RuntimeError('HTTP requires a release binary and complete default diagnostic first')
    if 'http-disk' in args.modes and ('disk' not in args.modes or args.modes.index('disk') > args.modes.index('http-disk') or args.build_variant != 'release'):
        raise RuntimeError('HTTP disk restart requires release and prior complete disk corpus')
    if 'disk-boundary' in args.modes and (args.modes[-1] != 'disk-boundary' or 'disk' not in args.modes):
        raise RuntimeError('boundary clock checks must follow disk and run last')
    binary = args.binary.resolve()
    if binary.is_relative_to(Path('/private/tmp/server2-parallel-target')):
        raise RuntimeError('copy and hash the selected executable outside shared target first')
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        raise RuntimeError('output directory must be new or empty; existing evidence is preserved')
    output.mkdir(parents=True, exist_ok=True)
    source_paths = sorted(p for p in (SERVER2/'src').rglob('*') if p.is_file()) + [
        SERVER2/'Cargo.toml', SERVER2/'Cargo.lock', SERVER2/'examples/domestic_warm_cache_smoke.rs',
        Path(__file__).resolve(), SERVER2/'tests/storage/catalog_peer.py', SERVER2/'deploy/local/peer.py',
        SERVER2/'config/local-stack.json', SERVER2/'tests/domestic/fixtures/source.json.gz']
    source_before = {str(p.relative_to(SERVER2)): digest(p) for p in source_paths}
    for path in source_paths:
        target = output/'source'/path.relative_to(SERVER2)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
    peer_config = json.loads((SERVER2/'config/local-stack.json').read_text())
    expected_peer = {'max_connections': 16, 'max_object_bytes': 1048576, 'max_store_bytes': 33554432,
                     'max_objects': 4096, 'max_versions': 64, 'socket_timeout_seconds': 2}
    if any(peer_config.get(k) != v for k, v in expected_peer.items()):
        raise RuntimeError('owned peer limits changed; do not silently change the complete corpus proof')
    (output/'inputs-before.json').write_text(json.dumps({'binary': str(binary), 'binary_sha256': digest(binary),
        'source_before_sha256': source_before, 'peer_limits': expected_peer, 'build_variant': args.build_variant,
        'modes': args.modes, 'verification_scope': VERIFICATION_SCOPE,
        'scope': 'current candidate; execution not yet started'}, indent=2)+'\n')
    peer = subprocess.Popen([sys.executable, 'tests/storage/catalog_peer.py', '--persistent'], cwd=SERVER2,
                            stdout=subprocess.PIPE, stderr=(output/'peer.stderr').open('w'), text=True)
    receipts = []
    cleanup = {'peer_pid': peer.pid, 'owned_loopback_only': True, 'peer_terminated': False}
    try:
        ready, _, _ = select.select([peer.stdout], [], [], 5)
        if not ready:
            raise RuntimeError('owned peer did not report endpoint in5s')
        endpoint = peer.stdout.readline().strip()
        if not endpoint.startswith('http://127.0.0.1:'):
            raise RuntimeError('owned IPv4 loopback endpoint required')
        (output/'inputs.json').write_text(json.dumps({'binary':str(binary),'binary_sha256':digest(binary),
            'runner_sha256':digest(Path(__file__)), 'example_source_sha256':digest(SERVER2/'examples/domestic_warm_cache_smoke.rs'),
            'peer_script_sha256':digest(SERVER2/'tests/storage/catalog_peer.py'), 'endpoint':endpoint,
            'persistent_peer':True,'source_before_sha256':source_before,'peer_limits':expected_peer,'s3_transport_admission':12,'build_variant':args.build_variant,'modes':args.modes,'verification_scope':VERIFICATION_SCOPE,'scope':'current candidate; logical D2 admission; no production capacity claim'},indent=2)+'\n')
        manifest = output/'fixture-manifest.json'
        for mode in args.modes:
            receipt = child(binary, endpoint, mode, manifest, output)
            receipts.append({'mode':mode, **receipt})
            print(json.dumps({'mode':mode,'exit':receipt['exit'],'seconds':receipt['elapsed_seconds'],'peak_rss_bytes':receipt['peak_rss_bytes']}),flush=True)
            if receipt['exit'] != 0:
                return 1
            if mode in ('diagnostic', 'http', 'http-disk', 'disk', 'disk-boundary'):
                data = json.loads(manifest.read_text())
                for line in (output/(mode+'.stdout')).read_text().splitlines():
                    record = json.loads(line)
                    if record['phase'].startswith('warm'):
                        check_warm_forecast_io(record, data)
                    if (mode == 'disk' and record['phase'] in ('restore', 'renew')) or (mode == 'http-disk' and record['phase'] == 'cold'):
                        check_folded_forecast_io(record, data)
            if mode == 'seed':
                data = json.loads(manifest.read_text())
                if digest(manifest) != '11606b79c26365e4ba8a5a906d5801f717845f853bafc971c2f099d27b7bbe3f' or data['input_manifest_sha256'] != 'a83f63716e6b73c997c6ded2cca81e23c50e97b770408f0c2580a7d2241c4a00':
                    raise RuntimeError('complete original fixture identity changed; preserve and diagnose')
                validate_forecast_labels(data)
        return 0
    finally:
        peer.terminate()
        try:
            peer.wait(timeout=5)
        except subprocess.TimeoutExpired:
            peer.kill()
            peer.wait()
        cleanup.update(peer_terminated=True, peer_exit=peer.returncode, child_receipts=receipts)
        (output/'cleanup.json').write_text(json.dumps(cleanup,indent=2)+'\n')
        manifest = output/'fixture-manifest.json'
        summary = []
        parse_errors = []
        if manifest.exists():
            try:
                data = json.loads(manifest.read_text())
                for mode in ['diagnostic', 'native', 'http', 'disk', 'http-disk', 'disk-boundary']:
                    stdout = output/(mode+'.stdout')
                    if not stdout.exists():
                        continue
                    for line in stdout.read_text().splitlines():
                        record = json.loads(line)
                        per_dataset, unknown = io_delta(record.pop('status_before'), record.pop('status_after'), data['io_object_labels'])
                        record['io_by_dataset'] = per_dataset
                        record['forecast_io_by_dataset'] = {
                            label: per_dataset.get(label, dict.fromkeys(IO_METRICS, 0))
                            for label in sorted(FORECAST_LABELS)
                        }
                        record['zone_support_io'] = per_dataset.get('zone-support', dict.fromkeys(IO_METRICS, 0))
                        record['unattributed_or_other_section_io'] = unknown
                        record['verification_scope'] = VERIFICATION_SCOPE
                        summary.append(record)
            except (ValueError, KeyError, TypeError) as error:
                parse_errors.append(str(error))
        (output/'observations.json').write_text(json.dumps(summary, indent=2)+'\n')
        (output/'observation-errors.json').write_text(json.dumps(parse_errors, indent=2)+'\n')
        (output/'inputs-after.json').write_text(json.dumps({'source_after_sha256': {str(p.relative_to(SERVER2)): digest(p) for p in source_paths},
            'source_changed': [str(p.relative_to(SERVER2)) for p in source_paths if digest(p) != source_before[str(p.relative_to(SERVER2))]],
            'binary_sha256': digest(binary)}, indent=2)+'\n')


if __name__ == '__main__':
    raise SystemExit(main())
