#!/usr/bin/env python3
"""Owned release HTTP exercise of the real resource-aware process factory.

Uses only the existing loopback example, catalog peer and world synthetic fixtures.
No production settings, live provider, quota, device or deployment claim.
"""
import argparse
import gzip
import hashlib
import http.server
import json
import os
from pathlib import Path
import re
import select
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.request
import world_smoke as fixture

ROOT = Path(__file__).resolve().parents[1]

class GzipFixture(fixture.Fixture):
    def reply(self, status, body):
        if self.path.startswith('/timeline/') and status == 200:
            data = gzip.compress(json.dumps(body,separators=(',',':')).encode())
            self.send_response(status)
            self.send_header('Content-Type','application/json')
            self.send_header('Content-Encoding','gzip')
            self.send_header('Content-Length',str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        return super().reply(status,body)

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def request(base,path):
    req=urllib.request.Request(base+path)
    try:
        response=urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req,timeout=15)
    except urllib.error.HTTPError as error:
        response=error
    with response:
        return response.status,{k.lower():v for k,v in response.headers.items()},response.read()

def stop(child):
    if child.poll() is None:
        os.killpg(child.pid,signal.SIGTERM)
        try: child.wait(timeout=8)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid,signal.SIGKILL)
            child.wait(timeout=5)
            raise
    return child.returncode

def metrics(base,out,name):
    status,headers,body=request(base,'/internal/metrics')
    assert status==200 and headers.get('cache-control')=='no-store',(status,headers)
    text=body.decode()
    assert len(body)<=512*1024
    parsed={}
    for line in text.splitlines():
        if line.startswith('#') or not line: continue
        identity,value=line.rsplit(' ',1)
        assert identity not in parsed,identity
        parsed[identity]=float(value)
        assert not any(label in identity for label in ('url=','key=','token=','lat=','lon=','id=','path=')),identity
    for secret in ('local-dummy-vc-key','local-dummy-waqi-key','127.0.0.1:','51.507','-0.128'):
        assert secret not in text,secret
    assert len(parsed)<=2048
    (out/(name+'.prom')).write_text(text)
    return parsed

def value(m,name): return m.get(name,0)

def run(binary,out):
    out.mkdir(parents=True,exist_ok=False)
    (out/'empty-cwd').mkdir()
    report={'verdict':'FAIL','production_eligible':False,'live_actions':False,'binary_sha256':sha(binary),'runner_sha256':sha(__file__),'fixture_sha256':sha(fixture.__file__),'cases':[]}
    fixture.Fixture.vc_paths=[];fixture.Fixture.air_paths=[];fixture.Fixture.legacy=0;fixture.Fixture.down=False
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),GzipFixture)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    provider='http://127.0.0.1:%d/'%server.server_port
    env={k:v for k,v in os.environ.items() if k in ('PATH','TMPDIR','SYSTEMROOT')}
    env.update(SERVER2_LOG_LEVEL='error',PORT='0',SERVER2_NATIVE_FAMILIES='geocode,dsf',SERVER2_S3_BUCKET='server2-local',AWS_ACCESS_KEY='server2-local',AWS_SECRET_KEY='server2-local-secret',VC_SECRET_KEY='local-dummy-vc-key',VC_DAILY_RECORD_LIMIT='1000',WAQI_SECRET_KEY='local-dummy-waqi-key',GEOCODER_KAKAO_KEYS='["local-dummy-kakao-key"]',GEOCODER_GOOGLE_KEY='local-dummy-google-key')
    peers=[];handles=[]
    try:
        peerlog=open(out/'s3.stderr.log','w');handles.append(peerlog)
        peer=subprocess.Popen(['python3',str(ROOT/'tests/storage/catalog_peer.py')],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=peerlog,text=True,start_new_session=True);peers.append(peer)
        assert select.select([peer.stdout],[],[],10)[0],'S3 readiness timeout'
        endpoint=peer.stdout.readline().strip();assert re.fullmatch(r'http://127\.0\.0\.1:\d+/',endpoint),endpoint
        command=[str(binary),'--s3',endpoint,'--vc',provider+'timeline/','--waqi',provider,'--google',provider,'--kakao',provider,'--geocoder-daily-units','1000']
        def start(label):
            log=open(out/(label+'.stderr.log'),'w');handles.append(log)
            process=subprocess.Popen(command,env=env,cwd=out/'empty-cwd',stdout=subprocess.PIPE,stderr=log,text=True,start_new_session=True);peers.append(process)
            assert select.select([process.stdout],[],[],10)[0],'process readiness timeout'
            line=process.stdout.readline().strip();match=re.fullmatch(r'server2 public=(127\.0\.0\.1:\d+) metrics=(127\.0\.0\.1:\d+)',line);assert match,line
            return process,'http://'+match[1],'http://'+match[2]
        path='/weather/v000903/coord/51.507,-0.128?'+fixture.QUERY
        process,public,private=start('first')
        before=metrics(private,out,'before')
        assert request(public,'/health')[0]==200
        denied=request(public,'/internal/metrics');assert denied[0]!=200 and b'server2_cpu_' not in denied[2]
        start_at=time.monotonic();status,_,first=request(public,path);elapsed=(time.monotonic()-start_at)*1000
        assert status==200,(status,first[:200]);data=json.loads(first);assert data['source']=='VC' and data['timezone']['timezoneId']==fixture.ZONE
        after=metrics(private,out,'after-cold')
        assert value(after,'server2_logging_filtered_total')>0,'normal typed metrics must survive logger filtering'
        required={}
        for kind in ('vc_gzip','vc_parse','world_restore','air_parse','storage_codec','storage_control'):
            key='server2_cpu_completed_total{kind="'+kind+'"}'
            required[kind]=value(after,key)-value(before,key);assert required[kind]>0,(kind,required)
        assert value(after,'server2_cpu_pool_limit')==2
        assert value(after,'server2_s3_pool_limit')==12
        assert len(fixture.Fixture.vc_paths)==1 and len(fixture.Fixture.air_paths)==1
        _,_,warm=request(public,path);assert warm==first
        warm_metrics=metrics(private,out,'after-warm')
        assert len(fixture.Fixture.vc_paths)==1 and len(fixture.Fixture.air_paths)==1
        report['cases'].append({'id':'cold-warm-private-metrics','status':'PASS','elapsed_ms':round(elapsed,2),'cpu_completed_deltas':required,'vc_attempts':1,'air_attempts':1,'public_metrics_published':False,'metrics_series':len(after)})
        assert stop(process)==0
        fixture.Fixture.down=True
        restored,public,private=start('restore')
        _,_,body=request(public,path);assert body==first
        current=metrics(private,out,'after-restore')
        assert value(current,'server2_cpu_completed_total{kind="world_restore"}')>0
        assert value(current,'server2_cpu_completed_total{kind="storage_codec"}')>0
        assert len(fixture.Fixture.vc_paths)==1 and len(fixture.Fixture.air_paths)==1
        assert fixture.Fixture.legacy==0
        report['cases'].append({'id':'cold-memory-restore-with-providers-down','status':'PASS','byte_equal':True,'extra_vc_attempts':0,'extra_air_attempts':0,'legacy_hops':0})
        assert stop(restored)==0
        report['verdict']='PASS'
    finally:
        exits=[]
        for child in reversed(peers):
            exits.append({'pid':child.pid,'exit':stop(child)})
            if child.stdout:child.stdout.close()
        server.shutdown();server.server_close();thread.join(timeout=2)
        for handle in handles:handle.close()
        report['owned_children_retired']=all(child.poll() is not None for child in peers)
        report['child_exits']=exits
        report['binary_unchanged']=sha(binary)==report['binary_sha256']
        (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    return report

def run_capacity(binary,out):
    """Separate fixed CPU barrier and labelled synthetic diagnostics pressure receipt."""
    out.mkdir(parents=True,exist_ok=False);(out/'empty-cwd').mkdir()
    report={'verdict':'FAIL','production_eligible':False,'live_actions':False,'synthetic_diagnostic_operations':2048,'binary_sha256':sha(binary),'runner_sha256':sha(__file__),'cases':[]}
    fixture.Fixture.vc_paths=[];fixture.Fixture.air_paths=[];fixture.Fixture.legacy=0;fixture.Fixture.down=False
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),GzipFixture);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();provider='http://127.0.0.1:%d/'%server.server_port
    env={k:v for k,v in os.environ.items() if k in ('PATH','TMPDIR','SYSTEMROOT')};env.update(PORT='0',SERVER2_LOG_LEVEL='info',SERVER2_LOG_RATE='1000',SERVER2_NATIVE_FAMILIES='geocode,dsf',SERVER2_S3_BUCKET='server2-local',AWS_ACCESS_KEY='server2-local',AWS_SECRET_KEY='server2-local-secret',VC_SECRET_KEY='local-dummy-vc-key',VC_DAILY_RECORD_LIMIT='1000',WAQI_SECRET_KEY='local-dummy-waqi-key',GEOCODER_KAKAO_KEYS='["local-dummy-kakao-key"]',GEOCODER_GOOGLE_KEY='local-dummy-google-key')
    children=[];process=None;drainer=None;stderr_file=None;released=False;drained=False
    try:
        peerlog=open(out/'s3.stderr.log','w')
        peer=subprocess.Popen(['python3',str(ROOT/'tests/storage/catalog_peer.py')],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=peerlog,text=True,start_new_session=True);children.append(peer)
        assert select.select([peer.stdout],[],[],10)[0];endpoint=peer.stdout.readline().strip();assert re.fullmatch(r'http://127\.0\.0\.1:\d+/',endpoint),endpoint
        command=[str(binary),'--s3',endpoint,'--vc',provider+'timeline/','--waqi',provider,'--google',provider,'--kakao',provider]
        process=subprocess.Popen(command,env=env,cwd=out/'empty-cwd',stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True);children.append(process)
        assert select.select([process.stdout],[],[],10)[0],'barrier process readiness timeout';line=process.stdout.readline().strip();match=re.fullmatch(r'server2 public=(127\.0\.0\.1:\d+) metrics=(127\.0\.0\.1:\d+)',line);assert match,line
        public='http://'+match[1];private='http://'+match[2]
        before=metrics(private,out,'pressure-before')
        synthetic='server2_native_operation_finished_total{op="other",outcome="success"}'
        assert value(before,synthetic)==2048,'finish followed by Drop must count each synthetic operation once'
        assert value(before,'server2_cpu_pool_limit')==1
        assert value(before,'server2_cpu_inflight')==1
        assert value(before,'server2_logging_queue_full_total')>0,'unread owned sink must cause actual queue loss'
        assert value(before,'server2_logging_rate_limited_total')>0
        path='/weather/v000903/coord/51.507,-0.128?'+fixture.QUERY
        started=time.monotonic();status,headers,body=request(public,path);elapsed=(time.monotonic()-started)*1000
        assert status==501 and body==b'Not Implemented',(status,body[:200])
        denied=metrics(private,out,'pressure-denied')
        assert len(fixture.Fixture.vc_paths)==0 and len(fixture.Fixture.air_paths)==0,'pre-funding CPU refusal cannot acquire providers'
        assert value(denied,'server2_cpu_deadline_total{kind="storage_control"}')>0
        assert request(public,'/health')[0]==200
        assert request(public,'/internal/metrics')[0]!=200
        process.stdin.write('release\n');process.stdin.flush()
        until=time.monotonic()+3
        while time.monotonic()<until:
            current=metrics(private,out,'pressure-released')
            if value(current,'server2_cpu_completed_total{kind="foundation"}')==1:
                released=True;break
            time.sleep(.02)
        assert released,'actual blocking CPU holder must complete before retirement'
        status,_,success=request(public,path);assert status==200 and json.loads(success)['source']=='VC',(status,success[:200])
        after=metrics(private,out,'pressure-recovered')
        assert value(after,synthetic)>=value(before,synthetic),'native Other operations are additional to the exact isolated startup burst'
        assert len(fixture.Fixture.vc_paths)==1 and len(fixture.Fixture.air_paths)==1
        assert fixture.Fixture.legacy==0
        report['cases'].append({'id':'fixed-cpu1-and-unread-owned-log-sink','status':'PASS','synthetic_diagnostics_separate_from_native_traffic':True,'capacity_status':501,'elapsed_ms':round(elapsed,2),'vc_attempts_before_release':0,'air_attempts_before_release':0,'recovery_status':200,'vc_attempts_after_release':1,'air_attempts_after_release':1,'synthetic_success_exact_before_native':2048,'additional_other_native_success':value(after,synthetic)-value(before,synthetic),'queue_full':value(after,'server2_logging_queue_full_total'),'rate_limited':value(after,'server2_logging_rate_limited_total'),'public_and_private_checked_before_stderr_drain':True})
        report['verdict']='PASS'
    finally:
        # First release the owned barrier, then relieve the sink while the process is alive.
        # A shutdown timeout with an undrained sink is never counted as normal retirement.
        if process is not None:
            if process.poll() is None and process.stdin:
                try:process.stdin.write('release\n');process.stdin.flush()
                except (BrokenPipeError,OSError):pass
            stderr_file=open(out/'capacity.stderr.log','w')
            def drain():
                for line in process.stderr:stderr_file.write(line)
            drainer=threading.Thread(target=drain,daemon=True);drainer.start();drained=True
        exits=[]
        for child in reversed(children):
            exits.append({'pid':child.pid,'exit':stop(child)})
            if child.stdin:child.stdin.close()
            if child.stdout:child.stdout.close()
        if drainer:drainer.join(timeout=3)
        if process is not None and process.stderr:process.stderr.close()
        if stderr_file:stderr_file.close()
        if 'peerlog' in locals():peerlog.close()
        server.shutdown();server.server_close();thread.join(timeout=2)
        report.update(cpu_holder_completion_observed=released,stderr_drained_before_shutdown=drained,stderr_drainer_joined=drainer is None or not drainer.is_alive(),owned_children_retired=all(child.poll() is not None for child in children),child_exits=exits,binary_unchanged=sha(binary)==report['binary_sha256'])
        if report['verdict']=='PASS' and not all(report[name] for name in ('cpu_holder_completion_observed','stderr_drained_before_shutdown','stderr_drainer_joined','owned_children_retired','binary_unchanged')):report['verdict']='FAIL'
        (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);binary=parser.add_mutually_exclusive_group(required=True);binary.add_argument('--binary',type=Path);binary.add_argument('--capacity-binary',type=Path);parser.add_argument('--out',type=Path,required=True);args=parser.parse_args()
    result=run_capacity(args.capacity_binary.resolve(),args.out.resolve()) if args.capacity_binary else run(args.binary.resolve(),args.out.resolve());print(json.dumps({'verdict':result['verdict'],'report':str(args.out/'report.json')}));raise SystemExit(0 if result['verdict']=='PASS' else 1)
