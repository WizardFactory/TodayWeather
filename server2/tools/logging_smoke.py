#!/usr/bin/env python3
"""Read actual NDJSON from an isolated diagnostics probe and the real release HTTP process.
No product .env, network provider, cloud credentials, device send or deployment is used.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import signal
import socket
import threading
import time
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]

def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''): value.update(chunk)
    return value.hexdigest()

def normalized(path, records):
    path.write_text(''.join(json.dumps(record,separators=(',', ':'))+'\n' for record in records))
    return digest(path)

def process_void(binary, out):
    """Actual production lifecycle/writer, with one owned S3 write lost before commit."""
    spec = importlib.util.spec_from_file_location('runtime_logging_probe', ROOT/'tools/runtime_services_smoke.py')
    runtime = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runtime)
    peer = runtime.peer_module.make('idle')
    original = peer.RequestHandlerClass
    lost = []
    class LoseOneJournal(original):
        def put(self, key):
            if '/push/state/journal/' in key and not lost:
                lost.append(True)
                self.close_connection = True
                self.connection.shutdown(socket.SHUT_RDWR)
                return
            return super().put(key)
    peer.RequestHandlerClass = LoseOneJournal
    thread = threading.Thread(target=peer.serve_forever, daemon=True)
    thread.start()
    child = None
    logpath = out/'process-void.log'
    try:
        with tempfile.TemporaryDirectory(prefix='server2-log-void-') as directory, logpath.open('w+') as log:
            key = Path(directory)/'synthetic-account.json'
            runtime.account(key)
            child = runtime.start(binary, 'http://127.0.0.1:'+str(peer.server_port)+'/', key, 'term', log)
            def ready():
                import re
                match = re.search(r'server2 public=(127\.0\.0\.1:\d+) metrics=', logpath.read_text())
                assert child.poll() is None, 'owned process exited before readiness'
                return match.group(1) if match else None
            address = runtime.wait_for(ready)
            record = dict(type='ios',fcmToken='SYNTHETIC-PRIVATE-2802',cityIndex=1,id=1,town={'first':'Seoul'},source='KMA',lang='ko',package='todayWeather',pushTime=3600)
            # This minute is not scheduled. No native/OAuth/FCM work is needed.
            status, body = runtime.request('http://'+address+'/v000902/push-list', [record])
            assert (status, body)==(200,'[null]'), (status, body)
            first = [v for k,v in peer.objects.items() if '/push/state/journal/' in k]
            assert len(first)==1 and json.loads(first[0].body).get('void') is True, 'lost write must use the existing durable void'
            status, body = runtime.request('http://'+address+'/v000902/push-list', [record])
            assert status==200 and 'upserted' in body, body
            rows = [v for k,v in peer.objects.items() if '/push/state/journal/' in k]
            assert len(rows)==2 and sum(any(json.loads(line).get('void') is True for line in v.body.splitlines() if line) for v in rows)==1
            assert not [e for e in peer.events if e['kind'] in ('native','oauth','post')], 'probe must not submit a notification'
            child.send_signal(signal.SIGTERM)
            assert child.wait(timeout=36)==0
        text = logpath.read_text()
        records = runtime.diagnostics(text)
        assert 'SYNTHETIC-PRIVATE-2802' not in text
        assert any(r['stage']=='void' and r['outcome']=='voided' and r['action']=='void' for r in records)
        http = [r for r in records if r['component']=='http' and r.get('status')==200]
        writers = [r for r in records if r['component']=='push_state' and r['stage']=='writer' and r['event']=='operation.started']
        assert any(w['trace_id']==h['trace_id'] and w.get('parent_operation_id')==h['operation_id'] for w in writers for h in http), 'HTTP -> queued writer parent identity missing'
        normalized_sha = normalized(out/'process-void.ndjson', records)
        return dict(verdict='PASS', normalized_log='process-void.ndjson', normalized_sha256=normalized_sha, layer='actual-production-process-and-owned-S3', runtime_binary_sha256=digest(binary), lost_original_writes=len(lost), void_journal_entries=1, acknowledged_followup=1, notification_posts=0, queue_parent_verified=True, log_sha256=digest(logpath))
    finally:
        if child and child.poll() is None:
            child.kill(); child.wait()
        peer.release.set(); peer.shutdown(); peer.server_close(); thread.join(timeout=5)


def process_items(binary, out):
    """Two alarms in one claimed minute: anonymous child IDs distinguish their sends."""
    spec = importlib.util.spec_from_file_location('runtime_items_probe', ROOT/'tools/runtime_services_smoke.py')
    runtime = importlib.util.module_from_spec(spec); spec.loader.exec_module(runtime)
    peer = runtime.peer_module.make('happy')
    thread = threading.Thread(target=peer.serve_forever, daemon=True); thread.start()
    child = None; logpath = out/'process-items.log'
    try:
        with tempfile.TemporaryDirectory(prefix='server2-log-items-') as directory, logpath.open('w+') as log:
            key = Path(directory)/'synthetic-account.json'; runtime.account(key)
            child = runtime.start(binary,'http://127.0.0.1:'+str(peer.server_port)+'/',key,'term',log,logging={'SERVER2_LOG_LEVEL':'debug','SERVER2_LOG_RATE':'1000'})
            def ready():
                import re
                match = re.search(r'server2 public=(127\.0\.0\.1:\d+) metrics=',logpath.read_text())
                assert child.poll() is None
                return match.group(1) if match else None
            address = runtime.wait_for(ready)
            bodies = [dict(type='ios',fcmToken='SYNTHETIC-PRIVATE-2802-'+str(i),cityIndex=i,id=i,town={'first':town},source='KMA',lang='ko',package='todayWeather',pushTime=420) for i,town in [(1,'Seoul'),(2,'Seoul')]]
            status, body = runtime.request('http://'+address+'/v000902/push-list',bodies)
            assert status==200 and body.count('upserted')==2
            runtime.wait_for(lambda:len([e for e in peer.events if e['kind']=='post'])==2)
            runtime.wait_for(lambda:sum(k.endswith('.result.json') for k in peer.objects)>=1)
            child.send_signal(signal.SIGTERM); assert child.wait(timeout=36)==0
        records = runtime.diagnostics(logpath.read_text())
        sends = [r for r in records if r['component']=='delivery' and r['stage']=='send' and r['event']=='operation.finished' and r['outcome']=='accepted']
        jobs = [r for r in records if r['component']=='delivery' and r['stage']=='submission' and r['event']=='operation.started']
        assert len(sends)==2, 'real setup must produce exactly two accepted owned FCM sends'
        assert all(r.get('delivery_kind')=='alarm' for r in sends), 'delivery kind must survive the asynchronous item/send scopes'
        assert len(jobs)==2, 'anonymous per-submission scopes absent after successful two-alarm setup'
        assert len({r['trace_id'] for r in sends})==1, 'both alarms belong to the same worker cycle'
        assert len({r['parent_operation_id'] for r in sends})==2, 'each FCM send must have its own anonymous submission parent'
        for send in sends:
            assert any(j['operation_id']==send['parent_operation_id'] and j['trace_id']==send['trace_id'] for j in jobs)
        # Alarm claim/result are batch-level. Do not change or manufacture per-item claims.
        claims = [r for r in records if r['stage']=='claim' and r['event']=='operation.finished' and r['outcome']=='success' and r['trace_id']==sends[0]['trace_id']]
        assert len(claims)==1 and claims[0].get('count')==2, 'two alarms must retain one existing batch claim'
        assert sum('/delivery/' in k and not k.endswith('.result.json') for k in peer.objects)==1
        batch = next(r for r in records if r['stage']=='record_result' and r['event']=='operation.finished' and r['outcome']=='success' and r['trace_id']==sends[0]['trace_id'])
        assert batch.get('count')==2, 'durable result event must identify batch cardinality without user IDs'
        assert len([e for e in peer.events if e['kind']=='post'])==2
        assert all(e['claims'] for e in peer.events if e['kind']=='post')
        assert 'SYNTHETIC-PRIVATE-2802' not in logpath.read_text()
        normalized_sha = normalized(out/'process-items.ndjson', records)
        return dict(verdict='PASS',normalized_log='process-items.ndjson',normalized_sha256=normalized_sha,submissions=[dict(trace_id=r['trace_id'],operation_id=r['operation_id']) for r in jobs],layer='actual-two-alarm-one-minute-owned-FCM',owned_fcm_posts=2,anonymous_submissions=2,batch_claims=1,batch_result_items=2,delivery_kind='alarm',device_sends=0,runtime_binary_sha256=digest(binary),log_sha256=digest(logpath))
    finally:
        if child and child.poll() is None: child.kill(); child.wait()
        peer.release.set(); peer.shutdown(); peer.server_close(); thread.join(timeout=5)


def process_result_fault(binary, out, mode):
    """One real owned send, then a refused/unknown result write; check authoritative diagnostics."""
    assert mode in ('refused', 'unknown')
    spec = importlib.util.spec_from_file_location('runtime_result_probe', ROOT/'tools/runtime_services_smoke.py')
    runtime = importlib.util.module_from_spec(spec); spec.loader.exec_module(runtime)
    peer = runtime.peer_module.make('happy'); original = peer.RequestHandlerClass; attempts = []
    class ResultFault(original):
        def do_GET(self):
            if mode=='unknown' and self.path.split('?',1)[0].endswith('.result.json'):
                return self.send(503,b'')
            return super().do_GET()
        def put(self, key):
            if key.endswith('.result.json'):
                attempts.append(True)
                if mode=='refused':
                    self.rfile.read(int(self.headers.get('content-length',0)))
                    return self.send(403,b'')
                self.close_connection=True; self.connection.shutdown(socket.SHUT_RDWR); return
            return super().put(key)
    peer.RequestHandlerClass=ResultFault
    thread=threading.Thread(target=peer.serve_forever,daemon=True);thread.start()
    child=None;logpath=out/('process-result-'+mode+'.log')
    try:
        with tempfile.TemporaryDirectory(prefix='server2-log-result-') as directory, logpath.open('w+') as log:
            key=Path(directory)/'synthetic-account.json';runtime.account(key)
            child=runtime.start(binary,'http://127.0.0.1:'+str(peer.server_port)+'/',key,'term',log,logging={'SERVER2_LOG_LEVEL':'debug','SERVER2_LOG_RATE':'1000'})
            def ready():
                import re
                match=re.search(r'server2 public=(127\.0\.0\.1:\d+) metrics=',logpath.read_text())
                assert child.poll() is None
                return match.group(1) if match else None
            address=runtime.wait_for(ready)
            body=[dict(type='ios',fcmToken='SYNTHETIC-PRIVATE-2802',cityIndex=1,id=1,town={'first':'Seoul'},source='KMA',lang='ko',package='todayWeather',pushTime=420)]
            status,response=runtime.request('http://'+address+'/v000902/push-list',body)
            assert status==200 and 'upserted' in response
            expected='failed' if mode=='refused' else 'unknown'
            def finished():
                records=runtime.diagnostics(logpath.read_text())
                terminal=next((r for r in records if r['stage']=='record_result' and r['event']=='operation.finished' and r['outcome']==expected),None)
                return terminal and any(r['stage']=='worker' and r['event']=='operation.finished' and r['trace_id']==terminal['trace_id'] for r in records)
            runtime.wait_for(finished,timeout=15)
            assert attempts and len([e for e in peer.events if e['kind']=='post'])==1,'real send/result-fault setup absent'
            assert sum('/delivery/' in k and not k.endswith('.result.json') for k in peer.objects)==1
            assert not any(k.endswith('.result.json') for k in peer.objects),'result fault must not commit'
            child.send_signal(signal.SIGTERM);assert child.wait(timeout=36)==0
        records=runtime.diagnostics(logpath.read_text());term=next(r for r in records if r['stage']=='record_result' and r['event']=='operation.finished' and r['outcome']==expected)
        assert not any(r['stage']=='record_result' and r['trace_id']==term['trace_id'] and r['outcome']=='skipped' for r in records),'result '+mode+' was contradicted by a skipped summary'
        warning=next(r for r in records if r.get('delivery_kind')=='warning' and r['stage']=='worker' and r['outcome']=='failed')
        assert warning['cause']=='invalid_input'
        assert not any(r['component']=='delivery' and r['stage']=='worker' and r['action']=='retain_claim' and not r.get('delivery_kind') for r in records),'pre-claim failure was relabelled retained claim on process root'
        assert 'SYNTHETIC-PRIVATE-2802' not in logpath.read_text()
        normalized_path=out/('process-result-'+mode+'.ndjson');normalized_sha=normalized(normalized_path,records)
        return dict(verdict='PASS',mode=mode,owned_fcm_posts=1,device_sends=0,retained_claims=1,result_committed=False,result_outcome=expected,result_trace=term['trace_id'],warning_preclaim_trace=warning['trace_id'],contradictory_skipped_summary=False,process_root_claim_retention=False,normalized_log=normalized_path.name,normalized_sha256=normalized_sha,runtime_binary_sha256=digest(binary))
    finally:
        if child and child.poll() is None:child.kill();child.wait()
        peer.release.set();peer.shutdown();peer.server_close();thread.join(timeout=5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--probe', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--runtime-services', type=Path, help='Optional retained current runtime_services test executable for the actual process/void/queue proof')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    binary, probe = args.binary.resolve(), args.probe.resolve()
    inputs = [binary, probe] + ([args.runtime_services.resolve()] if args.runtime_services else [])
    assert all(p.is_file() and os.access(p, os.X_OK) for p in inputs), 'explicit executable files required'
    before = {p: digest(p) for p in inputs}
    env = {k: os.environ[k] for k in ('PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'DYLD_LIBRARY_PATH') if k in os.environ}
    env.update(SERVER2_LOG_LEVEL='debug', SERVER2_LOG_RATE='1000')
    with tempfile.TemporaryDirectory(prefix='server2-logging-probe-') as cwd:
        run = subprocess.run([str(probe)], cwd=cwd, env=env, capture_output=True, timeout=20)
    (args.out/'probe.stdout.log').write_bytes(run.stdout)
    (args.out/'probe.stderr.ndjson').write_bytes(run.stderr)
    assert run.returncode == 0, run.stdout.decode() + run.stderr.decode()
    assert b'SYNTHETIC-PRIVATE-2802' not in run.stderr, 'private URL/header/panic payload leaked'
    records = [json.loads(line) for line in run.stderr.splitlines()]
    assert records and all(r['schema']==1 for r in records)
    assert all(len(line)+1 <= 1024 for line in run.stderr.splitlines())
    for status, cause in [(503,'dependency'),(403,'auth'),(429,'quota')]:
        assert any(r.get('status')==status and r['cause']==cause and r['outcome']=='failed' for r in records), (status,cause)
    assert any(r['outcome']=='cancelled' for r in records)
    assert any(r['component']=='delivery' and r['outcome']=='unknown' and r['action']=='do_not_retry' for r in records)
    assert any(r['event']=='operation.panic' and r['cause']=='panic' for r in records)
    assert not any(r['stage']=='record_result' and r['outcome']=='skipped' for r in records), 'legacy summary contradicted the authoritative result'
    assert not any(r['component']=='delivery' and r['stage']=='worker' and r['action']=='retain_claim' and not r.get('delivery_kind') for r in records), 'unscoped legacy summary invented claim retention'
    links = [r for r in records if r['event']=='operation.linked']
    assert links, 'shared-work owner link missing'
    for link in links:
        assert link['trace_id'] != link['linked_trace_id']
        assert any(r['operation_id']==link['linked_operation_id'] and r['trace_id']==link['linked_trace_id'] for r in records)
    env['SERVER2_LOGGING_BINARY'] = str(binary)
    env['SERVER2_LOGGING_TEST_CAPTURE'] = str((args.out/'http.stderr.ndjson').resolve())
    http = subprocess.run([sys.executable, str(ROOT/'tests/integration/test_observability.py')], env=env, capture_output=True, timeout=30)
    (args.out/'http.log').write_bytes(http.stdout+http.stderr)
    assert http.returncode == 0, (http.stdout+http.stderr).decode()
    proof = {}
    for line in http.stdout.decode().splitlines():
        for prefix, key in [('HTTP_PROOF ', 'http_terminal'), ('STALL_PROOF ', 'stalled_sink')]:
            if line.startswith(prefix): proof[key] = json.loads(line[len(prefix):])
    assert proof['stalled_sink']['requests']==600 and proof['stalled_sink']['queue_full']>0
    receipt = dict(verdict='PASS', layer='actual-release-http-and-isolated-diagnostics-probe', live_actions=False,
                   binary_sha256=digest(binary), probe_sha256=digest(probe), records=len(records), proof=proof, http_stderr_sha256=digest(args.out/'http.stderr.ndjson'),
                   statuses=[503,403,429], shared_links=len(links), private_values_absent=True,
                   limits=['Drop probes do not attest an external side effect.', 'No production provider/delivery/deployment/retention is tested.'])
    if args.runtime_services:
        receipt['process_void'] = process_void(args.runtime_services.resolve(), args.out)
        receipt['process_items'] = process_items(args.runtime_services.resolve(), args.out)
        receipt['process_result_faults'] = [process_result_fault(args.runtime_services.resolve(), args.out, mode) for mode in ('refused','unknown')]
    else:
        receipt['process_void'] = dict(status='not-run', reason='No explicit retained runtime_services executable supplied')
    assert all(digest(p)==h for p,h in before.items()), 'executable bytes changed during verification'
    receipt['artifact_hashes_unchanged'] = True
    (args.out/'report.json').write_text(json.dumps(receipt, indent=2)+'\n')
    print('PASS actual HTTP; loopback 503/auth/quota; shared-owner; cancelled/unknown; private panic')

if __name__ == '__main__':
    main()
