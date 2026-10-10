#!/usr/bin/env python3
"""Run a release benchmark against fresh owned loopback peers; no live fallback.

Process CPU/RSS include startup and fixture seeding. Request quantiles exclude
that work. Rust adoption is settled. Host smoke and actual API performance/cost checks remain preproduction work.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import platform
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import time

OWNED=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('s09_benchmark_peer',Path(__file__).with_name('local_peer.py'))
local=importlib.util.module_from_spec(spec)
spec.loader.exec_module(local)


def resource_result(usage,platform):
    # POSIX process-specific wait4 units: Darwin bytes; Linux KiB.
    unit='bytes' if platform=='darwin' else ('KiB' if platform.startswith('linux') else None)
    return {'user_cpu_seconds':usage.ru_utime,'system_cpu_seconds':usage.ru_stime,
            'peak_rss_bytes':None if unit is None else int(usage.ru_maxrss)*(1024 if unit=='KiB' else 1),
            'rss_native_unit':unit,'scope':'whole child process including startup and fixture seeding'}


def validate_report(report):
    if report.get('schema')!=1 or report.get('gate_status')!='local_evidence_only_preproduction_checks_pending':
        raise ValueError('local report must retain the preproduction evidence boundary')
    if report.get('api_parity_verified') is not False or report.get('production_cutover_authorized') is not False:
        raise ValueError('local tooling cannot authorize parity/cutover')
    if (report.get('rust_decision')!='adopted_by_AK'
            or report.get('lifecycle_decision')!='approved_contract_cost_validation_pre_cutover'
            or report.get('route_implementation_requires_live_measurements') is not False
            or report.get('ec2_smoke_status')!='pending_preproduction'
            or report.get('raw_pack_decision')!='disabled_pending_measured_route_benefit'):
        raise ValueError('local evidence cannot reopen Rust adoption or claim host readiness')
    for c in report['cases']:
        k=c['configuration'];samples=c['samples']
        if len(samples)!=k['clients']*k['trials'] or c['summary']['samples']!=len(samples):
            raise ValueError('sample cardinality')
        if sum(c['summary']['outcomes'].values())!=len(samples):raise ValueError('dropped outcomes')
        for t in c['trials']:
            before=t['wire_before']['requests'];after=t['wire_after_maintenance']['requests']
            if k['mode'] in ('provider_nodata','provider_denied','provider_error'):
                if any(after.get(x,0)!=before.get(x,0) for x in ('PUT:raw','PUT:group','PUT:catalog')):
                    raise ValueError('terminal provider outcome archived weather')
            if k['mode']=='provider_denied' and after.get('PROVIDER:provider',0)!=before.get('PROVIDER:provider',0):
                raise ValueError('provider called without funding')
            if k['mode']=='warm' and t['warm_available'] and before!=after:
                raise ValueError('idle warm case performed wire I/O')
    return report


def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as file:
        while chunk:=file.read(1024*1024):h.update(chunk)
    return h.hexdigest()


def run(binary,config,timeout):
    provenance_paths={'binary_sha256':binary,'lock_sha256':OWNED/'Cargo.lock','runner_sha256':Path(__file__),'peer_sha256':Path(__file__).with_name('local_peer.py'),'driver_source_sha256':OWNED/'benches/feasibility.rs','model_source_sha256':Path(__file__).with_name('model.rs')}
    before={k:digest(v) for k,v in provenance_paths.items()}
    peer=local.make()
    thread=threading.Thread(target=peer.serve_forever,daemon=True);thread.start()
    try:
        endpoint=f'http://127.0.0.1:{peer.server_port}/'
        config=dict(config,s3_endpoint=endpoint,provider_endpoint=endpoint)
        with tempfile.TemporaryDirectory(prefix='server2-s09-run-') as temporary:
            root=Path(temporary);path=root/'configuration.json'
            path.write_text(json.dumps(config,sort_keys=True)+'\n')
            with (root/'stdout').open('wb') as stdout,(root/'stderr').open('wb') as stderr:
                started=time.monotonic()
                child=subprocess.Popen([str(binary),'--config',str(path)],cwd=OWNED,stdout=stdout,stderr=stderr,start_new_session=True)
                timed_out=threading.Event()
                def stop():
                    timed_out.set()
                    try:os.killpg(child.pid,signal.SIGKILL)
                    except ProcessLookupError:pass
                timer=threading.Timer(timeout,stop);timer.daemon=True;timer.start()
                try:_,status,usage=os.wait4(child.pid,0)
                finally:timer.cancel()
                child.returncode=os.waitstatus_to_exitcode(status)
            if timed_out.is_set():raise RuntimeError('bounded benchmark process timed out')
            if child.returncode:raise RuntimeError('benchmark child failed: '+(root/'stderr').read_text()[:2048])
            if (root/'stdout').stat().st_size>8*1024*1024:raise RuntimeError('benchmark output cap')
            report=validate_report(json.loads((root/'stdout').read_bytes()))
            report['local_environment']={'os':platform.platform(),'architecture':platform.machine(),'cpu_model':platform.processor() or None,'logical_cpu_count':os.cpu_count(),'python':platform.python_version()}
            for case in report['cases']:
                wall=sum(t['foreground_wall_us'] for t in case['trials'])
                case['foreground_throughput']={'wall_us':wall,'measured_attempts_per_second':case['summary']['all_requests']['count']*1_000_000/wall if wall else None,'successful_attempts_per_second':case['summary']['successful_requests']['count']*1_000_000/wall if wall else None,'scope':'offered-client batch observations; excludes seeding, warmup, maintenance and verification'}
            final=report['cases'][-1]['trials'][-1]['wire_after_verification']
            report['cost_inputs']={'scope':'whole local run including seeding, warmup, maintenance and readback; not AWS storage/billing','s3_requests':{k:v for k,v in final['requests'].items() if not k.startswith('PROVIDER:')},'catalog_version_body_bytes':final['catalog_version_bytes'],'version_body_bytes':final['version_body_bytes'],'version_count':final['version_count'],'unit_prices':None}
            report['process']=dict(resource_result(usage,sys.platform),elapsed_seconds=time.monotonic()-started,exit_code=child.returncode)
            after={k:digest(v) for k,v in provenance_paths.items()}
            if before!=after:raise RuntimeError('benchmark provenance changed during execution')
            report['runner_provenance']=dict(before,files_unchanged_during_execution=True,effective_config_sha256=digest(path))
            return report
    finally:
        peer.shutdown();peer.server_close();thread.join(timeout=3)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--binary',default=str(OWNED/'target/release/server2-feasibility'))
    p.add_argument('--config',default=str(OWNED/'config/benchmarks/local.json'))
    p.add_argument('--output',required=True,help='Task-owned output JSON (not source)')
    p.add_argument('--timeout',type=int,default=300)
    args=p.parse_args()
    binary=Path(args.binary).resolve()
    if not binary.is_relative_to(OWNED/'target') or not binary.is_file():raise ValueError('binary must be in owned server2/target')
    if not 1<=args.timeout<=600:raise ValueError('timeout1..600 seconds')
    config_path=Path(args.config)
    if config_path.stat().st_size>65536:raise ValueError('configuration cap')
    config_bytes=config_path.read_bytes()
    if len(config_bytes)>65536:raise ValueError('configuration stream cap')
    requested_hash=hashlib.sha256(config_bytes).hexdigest()
    config=json.loads(config_bytes)
    binary_preflight_hash=digest(binary)
    with tempfile.TemporaryDirectory(prefix='server2-s09-preflight-') as temporary:
        snapshot=Path(temporary)/'requested.json';snapshot.write_bytes(config_bytes)
        preflight=subprocess.run([str(binary),'--validate-config',str(snapshot)],capture_output=True,text=True,timeout=5,cwd=OWNED)
    if preflight.returncode:raise ValueError('configuration preflight failed: '+preflight.stderr[:1024])
    if digest(binary)!=binary_preflight_hash:raise ValueError('binary changed during preflight')
    report=run(binary,config,args.timeout)
    if report['runner_provenance']['binary_sha256']!=binary_preflight_hash:raise ValueError('binary changed before execution')
    report['requested_config_sha256']=requested_hash
    Path(args.output).write_text(json.dumps(report,indent=2)+'\n')
    print('LOCAL ONLY; Rust adopted; preproduction host smoke and API cost/performance pending')
    for c in report['cases']:
        s=c['summary'];print(f"{c['configuration']['name']}: outcomes={s['outcomes']} all-p95={s['all_requests']['p95_us']}us success-p95={s['successful_requests']['p95_us']}us")
    print('Process peak RSS:',report['process']['peak_rss_bytes'],'bytes; CPU includes startup/seed')
    print('PASS: bounded report, all outcome denominators and terminal archive fences')


if __name__=='__main__':main()
