#!/usr/bin/env python3
"""Source-bound loopback retention measurements; never calls AWS or providers.

Run on Linux or macOS with a release domestic_warm_cache_smoke example. Cloud
lifecycle is separately authorized and operated by the coordinator.
"""
import argparse
import gzip
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
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

SERVER2 = Path(__file__).resolve().parents[1]
MANIFEST_SHA = '11606b79c26365e4ba8a5a906d5801f717845f853bafc971c2f099d27b7bbe3f'
METRIC_PREFIX = 'RETENTION_CHILD_METRICS '
METRIC_CHILD = '''import json,platform,resource,subprocess,sys
command=json.loads(sys.argv[1])
result=subprocess.run(command,check=False)
r=resource.getrusage(resource.RUSAGE_CHILDREN)
print('RETENTION_CHILD_METRICS '+json.dumps(dict(platform=platform.system(),raw_maxrss=r.ru_maxrss,user_seconds=r.ru_utime,system_seconds=r.ru_stime)),file=sys.stderr,flush=True)
sys.exit(result.returncode)
'''


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def nearest_rank(values, quantile=.95):
    if not values or not 0 < quantile <= 1 or any(not isinstance(x, (int, float)) or isinstance(x, bool) or not math.isfinite(x) or x < 0 for x in values):
        raise ValueError('finite nonnegative observations and a valid quantile required')
    ordered = sorted(values)
    return ordered[math.ceil(len(ordered) * quantile) - 1]


def summarize(samples, expected=20, target_ms=None):
    good = [s for s in samples if s['exit'] == 0 and s['checks_passed']]
    values = [s['elapsed_ms'] for s in good]
    p95=nearest_rank(values) if values else None
    return dict(latency_target_ms=target_ms,
                latency_target_passed=(len(good)>=expected and len(good)==len(samples) and p95<=target_ms) if target_ms is not None else None,
                acceptance_scope='functional checks; the latency target is reported separately',
                attempted=len(samples), successful=len(good), failed=len(samples)-len(good),
                insufficient_samples=len(good) < expected,
                acceptance_passed=len(samples) >= expected and len(good) == len(samples),
                successful_p95_ms=p95,
                successful_min_ms=min(values) if values else None,
                successful_max_ms=max(values) if values else None)


def rss_bytes(value, system):
    if system not in ('Linux', 'Darwin') or value < 0:
        raise ValueError('RSS units are only qualified for Linux and Darwin')
    return int(value) * (1024 if system == 'Linux' else 1)


def run_child(command, output, name, timeout=300):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    stdout, stderr = output/(name+'.stdout'), output/(name+'.stderr')
    if stdout.exists() or stderr.exists():
        raise ValueError('existing child evidence must not be overwritten')
    started = time.monotonic()
    process = None
    code = 'INTERRUPTED'
    error = None
    with stdout.open('w') as out, stderr.open('w') as err:
        try:
            process = subprocess.Popen([sys.executable, '-c', METRIC_CHILD, json.dumps([str(x) for x in command])],
                                       stdout=out, stderr=err, start_new_session=True,
                                       env={**os.environ, 'NO_PROXY':'127.0.0.1,localhost', 'no_proxy':'127.0.0.1,localhost'})
            try:
                code = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                code = 'TIMEOUT'
        except BaseException as exc:
            error = exc
        finally:
            if process is not None and process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=3)
    metrics = None
    for line in stderr.read_text().splitlines():
        if line.startswith(METRIC_PREFIX):
            metrics = json.loads(line[len(METRIC_PREFIX):])
    record = dict(command=[str(x) for x in command], exit=code, checks_passed=code == 0,
                  elapsed_ms=(time.monotonic()-started)*1000,
                  metric_scope='whole child including startup, oracles and output; not phase-only CPU/RSS',
                  peak_rss_bytes=rss_bytes(metrics['raw_maxrss'], metrics['platform']) if metrics else None,
                  resource_usage=metrics, stdout_sha256=digest(stdout), stderr_sha256=digest(stderr))
    (output/(name+'-receipt.json')).write_text(json.dumps(record, indent=2)+'\n')
    if error is not None:
        raise error
    return record


def load_peer():
    spec = importlib.util.spec_from_file_location('retention_owned_catalog_peer', SERVER2/'tests/storage/catalog_peer.py')
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def peer_worker():
    module = load_peer()

    class DelayedHandler(module.PersistentHandler):
        def dispatch(self):
            path = urlsplit(self.path).path
            if path == '/__matrix_delay':
                if self.command != 'POST' or self.headers.get('X-Server2-Test-Key') != 'server2-local':
                    return self.error(403, 'OnlyLocalTestControl')
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 64:
                    return self.error(400, 'InvalidDelay')
                try:
                    delay = json.loads(self.rfile.read(length))['delay_ms']
                    if not isinstance(delay, int) or isinstance(delay, bool) or not 0 <= delay <= 100:
                        raise ValueError('delay')
                except (ValueError, KeyError, TypeError):
                    return self.error(400, 'InvalidDelay')
                with self.server.matrix_lock:
                    self.server.matrix_delay = delay
                    self.server.matrix_peak = self.server.matrix_active
                    self.server.matrix_reads = 0
                return self.send(200, b'{}')
            if path == '/__matrix_status':
                with self.server.matrix_lock:
                    body = json.dumps(dict(delay_ms=self.server.matrix_delay,
                                           peak_reads=self.server.matrix_peak, reads=self.server.matrix_reads,
                                           active_reads=self.server.matrix_active)).encode()
                return self.send(200, body)
            counted = self.command in ('GET', 'HEAD') and path != '/__status'
            if not counted:
                return super().dispatch()
            with self.server.matrix_lock:
                self.server.matrix_active += 1
                self.server.matrix_reads += 1
                self.server.matrix_peak = max(self.server.matrix_peak, self.server.matrix_active)
                delay = self.server.matrix_delay
            try:
                time.sleep(delay/1000)
                return super().dispatch()
            finally:
                with self.server.matrix_lock:
                    self.server.matrix_active -= 1

        # The existing fixture aliases HTTP methods to its dispatch function;
        # bind those methods again so this subclass owns the test controls.
        do_GET = do_HEAD = do_POST = do_PUT = dispatch

    peer = module.make(persistent=True)
    assert peer.server_address[0] == '127.0.0.1'
    peer.RequestHandlerClass = DelayedHandler
    peer.matrix_lock = threading.Lock()
    peer.matrix_delay = peer.matrix_active = peer.matrix_peak = peer.matrix_reads = 0
    print('http://127.0.0.1:%d/' % peer.server_port, flush=True)
    try:
        peer.serve_forever()
    finally:
        peer.server_close()


def control(endpoint, delay):
    body = json.dumps(dict(delay_ms=delay)).encode()
    with urlopen(Request(endpoint+'__matrix_delay', data=body,
                         headers={'X-Server2-Test-Key':'server2-local'}, method='POST'), timeout=3) as r:
        if r.status != 200:
            raise RuntimeError('delay control rejected')


def peer_status(endpoint):
    with urlopen(endpoint+'__matrix_status', timeout=3) as r:
        return json.load(r)



def load_io_oracle():
    spec=importlib.util.spec_from_file_location('retention_io_oracle',SERVER2/'tools/domestic_warm_cache_smoke.py')
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_rows(path):
    # Raw JSONL remains on disk with its hash. Keep only one verbose row live.
    with Path(path).open() as stream:
        for line in stream:
            if line.strip():
                yield json.loads(line)


def compact_row(row, labels):
    oracle=load_io_oracle()
    classified, unknown=oracle.io_delta(row.get('status_before',{}),row.get('status_after',{}),labels)
    return {**{key:value for key,value in row.items()
               if key not in ('documents','status_before','status_after')},
            'classified_io':classified,'unclassified_io_metric_count':len(unknown)}


def restore_primed_cache(output):
    output=Path(output).resolve()
    current=output/'folded-cache'
    primed=output/'primed-folded-cache'
    if not primed.is_dir() or primed.is_symlink() or current.is_symlink():
        raise ValueError('owned real cache directories required')
    if current.exists():
        shutil.rmtree(current)
    shutil.copytree(primed,current)


def matrix(args):
    binary, output = args.binary.resolve(), args.output.resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError('matrix output must be new or empty')
    if not 1 <= args.samples <= 100 or not 1 <= args.total_seconds <= 6500 or any(not 0 <= x <= 100 for x in args.delays):
        raise ValueError('bounded samples/delays required')
    if 'disk-boundary' in args.phases and len(args.phases)!=1:
        raise ValueError('boundary trials require a separate clock-isolated matrix')
    output.mkdir(parents=True, exist_ok=True)
    binding = dict(binary=str(binary), binary_sha256=digest(binary), platform=platform.platform(),
                   runner_sha256=digest(__file__), samples=args.samples, delays=args.delays,
                   source_revision=args.revision, s3_transport_admission=12,
                   provider_external_calls=0, real_aws_calls=0,
                   scope='loopback model on observed host; whole-child CPU/RSS, timed view/HTTP phases')
    binding['source_sha256']={str(p.relative_to(SERVER2)):digest(p) for p in sorted((SERVER2/'src').rglob('*')) if p.is_file()}
    binding['example_source_sha256']=digest(SERVER2/'examples/domestic_warm_cache_smoke.rs')
    binding['cargo_lock_sha256']=digest(SERVER2/'Cargo.lock')
    (output/'inputs.json').write_text(json.dumps(binding, indent=2)+'\n')
    peer_err = (output/'peer.stderr').open('w')
    peer = subprocess.Popen([sys.executable, __file__, '--peer-worker'], stdout=subprocess.PIPE,
                            stderr=peer_err, text=True, start_new_session=True)
    receipts, samples = [], []
    deadline = time.monotonic()+args.total_seconds
    try:
        if not select.select([peer.stdout], [], [], 10)[0]:
            raise RuntimeError('peer readiness timeout')
        endpoint = peer.stdout.readline().strip()
        if not endpoint.startswith('http://127.0.0.1:'):
            raise RuntimeError('owned loopback endpoint required')
        manifest = output/'fixture-manifest.json'
        oracle=load_io_oracle()
        preparation=['seed','disk-prime'] if any(mode in ('disk-check','disk-boundary','http-disk') for mode in args.phases) else ['seed']
        for mode in preparation:
            r = run_child([binary, endpoint, mode, manifest], output, mode, timeout=min(300, max(1, deadline-time.monotonic())))
            receipts.append(r)
            if r['exit'] != 0:
                raise RuntimeError(mode+' preparation failed; retained, not a benchmark sample')
            if mode == 'seed' and digest(manifest) != MANIFEST_SHA:
                raise RuntimeError('original corpus identity changed')
        if args.phases==['disk-boundary']:
            shutil.copytree(output/'folded-cache',output/'primed-folded-cache')
        for delay in args.delays:
            for trial in range(args.samples):
                for mode in args.phases:
                    if time.monotonic() >= deadline:
                        raise TimeoutError('matrix total deadline; preserve insufficient coverage')
                    if mode=='disk-boundary':
                        restore_primed_cache(output)
                    control(endpoint, delay)
                    name='%s-d%d-n%d' % (mode, delay, trial)
                    r=run_child([binary, endpoint, mode, manifest], output, name,
                                timeout=min(300, max(1, deadline-time.monotonic())))
                    r.update(mode=mode, delay_ms=delay, trial=trial, peer=peer_status(endpoint))
                    rows=[]
                    valid_rows={}
                    fixture=json.loads(manifest.read_text())
                    for row in read_rows(output/(name+'.stdout')):
                        try:
                            if row['phase'].startswith('warm'):
                                oracle.check_warm_forecast_io(row,fixture)
                            elif (mode=='disk-check' and row['phase'] in ('restore','renew')
                                  or mode=='disk-boundary' and row['phase']=='boundary-prime'
                                  or mode=='http-disk' and row['phase']=='cold'):
                                oracle.check_folded_forecast_io(row,fixture)
                            valid=True
                        except (RuntimeError,ValueError,KeyError,TypeError) as error:
                            valid=False
                            r.setdefault('oracle_errors',[]).append(str(error))
                        compact=compact_row(row,fixture['io_object_labels'])
                        rows.append(compact)
                        valid_rows[id(compact)]=valid
                    # Compress verbose retained evidence between independent children;
                    # otherwise an 80-trial matrix can fill a small target volume.
                    raw=output/(name+'.stdout')
                    archive=raw.with_suffix(raw.suffix+'.gz')
                    with raw.open('rb') as source, gzip.open(archive,'wb',compresslevel=1) as target:
                        shutil.copyfileobj(source,target,length=1024*1024)
                    r['stdout_archive']=archive.name
                    r['stdout_archive_sha256']=digest(archive)
                    raw.unlink()
                    r['rows']=rows
                    receipts.append(r)
                    phases=sorted({row['phase'] for row in rows})
                    if not rows:
                        phases=['missing-output']
                    for phase in phases:
                        selected=[row for row in rows if row['phase']==phase]
                        elapsed=sum(row['elapsed_ms'] for row in selected)
                        ok=r['exit']==0 and bool(selected) and all(valid_rows[id(row)] for row in selected)
                        if mode in ('disk-check','disk-boundary'):
                            ok=ok and len(selected)==13 and all(row['exact_expected_documents'] for row in selected)
                            if phase in ('restore','renew','warm'):
                                ok=ok and all(row['parse_acquisition_invocations']==0 and row['fold_invocations']==0 for row in selected)
                        else:
                            ok=ok and all(row.get('outcome',{}).get('successful_json',False) for row in selected)
                        samples.append(dict(mode=mode, phase=phase, delay_ms=delay, trial=trial,
                                            elapsed_ms=elapsed, exit=r['exit'], checks_passed=ok))
                    (output/'receipts.json').write_text(json.dumps(receipts, indent=2)+'\n')
                    print(json.dumps(dict(mode=mode, delay_ms=delay, trial=trial, exit=r['exit'],
                                          peer_peak=r['peer']['peak_reads'])), flush=True)
    finally:
        if peer.poll() is None:
            os.killpg(peer.pid, signal.SIGTERM)
            try:
                peer.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(peer.pid, signal.SIGKILL)
                peer.wait(timeout=3)
        peer_err.close()
        groups={}
        for sample in samples:
            key='%s/%s/d%d' % (sample['mode'],sample['phase'],sample['delay_ms'])
            groups.setdefault(key,[]).append(sample)
        for delay in args.delays:
            for mode in args.phases:
                wanted=(['restore','warm','renew'] if mode=='disk-check'
                        else ['boundary-prime','boundary'] if mode=='disk-boundary'
                        else ['cold','warm1','warm2'])
                for phase in wanted:
                    groups.setdefault('%s/%s/d%d' % (mode,phase,delay),[])
        report=dict(inputs=binding, samples=samples,
                    coverage_complete=all(len(values)==args.samples for values in groups.values()),
                    groups={key:summarize(values,max(20,args.samples),2500 if key.startswith(('http/','http-disk/')) else None) for key,values in groups.items()},
                    minimum_independent_samples_for_acceptance=20,
                    peer_terminated=True, requested_delay_count=len(args.delays),
                    requested_trials_per_phase=args.samples)
        (output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    return 0



def check_peer():
    """Actual loopback delay/control/concurrency check, with owned cleanup."""
    from concurrent.futures import ThreadPoolExecutor
    from urllib.error import HTTPError
    import tempfile
    with tempfile.TemporaryDirectory(prefix='retention-peer-check-') as name:
        with (Path(name)/'stderr').open('w') as errors:
            peer=subprocess.Popen([sys.executable,__file__,'--peer-worker'],stdout=subprocess.PIPE,
                                  stderr=errors,text=True,start_new_session=True)
            try:
                if not select.select([peer.stdout],[],[],5)[0]:
                    raise RuntimeError('peer check readiness failed')
                endpoint=peer.stdout.readline().strip()
                assert endpoint.startswith('http://127.0.0.1:')
                control(endpoint,30)
                def read_missing(_):
                    try:
                        with urlopen(Request(endpoint+'server2-local/matrix/probe', headers={'X-Server2-Test-Key':'server2-local'}),timeout=3) as result:
                            result.read()
                    except HTTPError as error:
                        assert error.code==404
                        error.read()
                started=time.monotonic()
                with ThreadPoolExecutor(max_workers=2) as pool:
                    list(pool.map(read_missing,range(2)))
                assert time.monotonic()-started>=.03
                state=peer_status(endpoint)
                assert state['reads']==2 and state['peak_reads']==2 and state['active_reads']==0,state
                control(endpoint,0)
                assert peer_status(endpoint)['reads']==0
                print(json.dumps(dict(peer_check='passed',concurrent_reads=2,modeled_delay_ms=30,external_calls=0)))
            finally:
                if peer.poll() is None:
                    os.killpg(peer.pid,signal.SIGTERM)
                    peer.wait(timeout=5)
    return 0


def main():
    if sys.argv[1:]==['--peer-worker']:
        return peer_worker()
    if sys.argv[1:]==['--check-peer']:
        return check_peer()
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--revision',required=True)
    parser.add_argument('--samples',type=int,default=20)
    parser.add_argument('--delays',type=int,nargs='+',default=[0,5,10,20])
    parser.add_argument('--phases',nargs='+',choices=['disk-check','disk-boundary','http-disk','http'],default=['disk-check','http-disk'])
    parser.add_argument('--total-seconds',type=int,default=5400)
    return matrix(parser.parse_args())


if __name__=='__main__':
    raise SystemExit(main())
