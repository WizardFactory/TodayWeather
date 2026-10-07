#!/usr/bin/env python3
"""Distinct real process/wire smoke for S03, not a production weather test."""
import argparse
import base64
import gzip
import hashlib
import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit

OWNED=Path(__file__).resolve().parents[2]


def call(endpoint,method,path,body=None,headers=None):
    target=urlsplit(endpoint)
    if target.scheme!='http' or target.hostname!='127.0.0.1' or not target.port or target.path or target.query:
        raise ValueError('smoke refuses non-loopback targets')
    client=http.client.HTTPConnection(target.hostname,target.port,timeout=3)
    try:
        client.request(method,path,body,headers or {})
        reply=client.getresponse();return reply.status,{key.lower():value for key,value in reply.getheaders()},reply.read()
    finally:client.close()


def read_ready_once(ready, process, log):
    deadline=time.monotonic()+8
    while time.monotonic()<deadline:
        try:
            # Retry absence only: a visible but invalid JSON is a real failure.
            with ready.open() as stream:return json.load(stream)
        except FileNotFoundError:
            if process.poll() is not None:raise RuntimeError(log.read_text())
            time.sleep(.0005)
    raise RuntimeError('local stack readiness timeout')


def assert_stopped(process, data, ready):
    assert process.wait(timeout=9)==0
    assert not ready.exists() and not ready.is_symlink()
    assert not list(ready.parent.glob('.ready-*'))
    try:os.kill(data['foundation_pid'],0)
    except ProcessLookupError:pass
    else:raise AssertionError('foundation survived stack shutdown')
    for name in ['s3_endpoint','provider_endpoint','public_endpoint','metrics_endpoint']:
        target=urlsplit(data[name])
        with socket.socket() as client:
            client.settimeout(1);assert client.connect_ex((target.hostname,target.port))!=0


def observe_ready(binary, iterations):
    lengths=[];elapsed=[]
    for _ in range(iterations):
        with tempfile.TemporaryDirectory(prefix='server2-s03-') as directory:
            ready=Path(directory)/'ready.json';log=Path(directory)/'stack.log'
            with log.open('w') as output:
                process=subprocess.Popen([sys.executable,str(OWNED/'deploy/local/stack.py'),'--binary',binary,'--ready',str(ready)],stdout=output,stderr=subprocess.STDOUT)
                try:
                    data=read_ready_once(ready,process,log)
                    assert data['stack_pid']==process.pid
                    assert call(data['public_endpoint'],'GET','/health')[0]==200
                    lengths.append(ready.stat().st_size)
                    started=time.monotonic();process.terminate();assert_stopped(process,data,ready)
                    elapsed.append(round(time.monotonic()-started,3))
                finally:
                    if process.poll() is None:
                        process.terminate()
                        try:process.wait(timeout=9)
                        except subprocess.TimeoutExpired:process.kill();process.wait(timeout=2)
    print(json.dumps({'result':'PASS','scenario':'actual release launcher first-visible-open observations','iterations':iterations,'complete_json_on_first_open':True,'decode_retries':0,'ready_bytes':lengths,'drain_seconds':elapsed,'owned_processes_ports_tempfiles_retired':True,'aws_measurement':False},indent=2))
    return 0


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--binary',default='target/release/server2');parser.add_argument('--ready-observations',type=int,default=0);args=parser.parse_args()
    if not 0 <= args.ready_observations <= 32:parser.error('--ready-observations must be 0..32')
    if args.ready_observations:return observe_ready(args.binary,args.ready_observations)
    with tempfile.TemporaryDirectory(prefix='server2-s03-') as directory:
        ready=Path(directory)/'ready.json';log=Path(directory)/'stack.log'
        with log.open('w') as output:
            process=subprocess.Popen([sys.executable,str(OWNED/'deploy/local/stack.py'),'--binary',args.binary,'--ready',str(ready)],stdout=output,stderr=subprocess.STDOUT)
            data=None
            try:
                data=read_ready_once(ready,process,log);auth={'X-Server2-Test-Key':data['test_access_key']}
                status,headers,body=call(data['public_endpoint'],'GET','/health');assert status==200 and body==b'OK' and headers['access-control-allow-origin']=='*'
                assert call(data['public_endpoint'],'GET','/internal/metrics')[0]==404
                status,headers,_=call(data['metrics_endpoint'],'GET','/internal/metrics');assert status==200 and 'access-control-allow-origin' not in headers
                status,_,raw=call(data['provider_endpoint'],'GET','/kma/pwn-status',headers=auth)
                assert status==200 and raw==(OWNED/'config/fixtures/pwn-status.json').read_bytes()
                assert call(data['provider_endpoint'],'GET','/unrecorded-live-provider',headers=auth)[0]==404
                compressed=gzip.compress(raw,mtime=0)
                meta=base64.b64encode(b'{"fixture":"pwn-status"}').decode()
                md5=base64.b64encode(hashlib.md5(compressed).digest()).decode()
                put=dict(auth,**{'If-None-Match':'*','Content-MD5':md5,'Content-Type':'application/gzip','x-amz-meta-s2-record':meta,'x-amz-meta-s2-gzip-sha256':hashlib.sha256(compressed).hexdigest()})
                key='/'+data['bucket']+'/raw/v2/kma/test-record'
                assert call(data['s3_endpoint'],'PUT',key,compressed,put)[0]==200
                assert call(data['s3_endpoint'],'PUT',key,compressed,put)[0]==412
                status,head,_=call(data['s3_endpoint'],'HEAD',key,headers=auth)
                assert status==200 and int(head['content-length'])==len(compressed) and head['x-amz-meta-s2-record']==meta
                status,_,stored=call(data['s3_endpoint'],'GET',key,headers=auth);assert status==200 and stored==compressed and gzip.decompress(stored)==raw
                assert call(data['s3_endpoint'],'GET',key,headers={'X-Server2-Test-Key':'not-local'})[0]==403
                assert call(data['s3_endpoint'],'POST','/__test/fault/error-after-put?key=raw%2Fv2%2Fkma%2Ffault',headers=auth)[0]==204
                assert call(data['s3_endpoint'],'PUT','/'+data['bucket']+'/raw/v2/kma/fault',compressed,put)[0]==500
                assert call(data['s3_endpoint'],'GET','/'+data['bucket']+'/raw/v2/kma/fault',headers=auth)[2]==compressed
                assert call(data['s3_endpoint'],'POST','/__test/fault/drop-after-put?key=raw%2Fv2%2Fkma%2Fdrop',headers=auth)[0]==204
                try:call(data['s3_endpoint'],'PUT','/'+data['bucket']+'/raw/v2/kma/drop',compressed,put)
                except http.client.RemoteDisconnected:pass
                else:raise AssertionError('injected response loss not observed')
                assert call(data['s3_endpoint'],'GET','/'+data['bucket']+'/raw/v2/kma/drop',headers=auth)[2]==compressed
                started=time.monotonic();process.terminate();assert process.wait(timeout=9)==0
                elapsed=time.monotonic()-started;assert_stopped(process,data,ready)
                print(json.dumps({'result':'PASS','scenarios':['complete ready JSON on first visible open','health/metrics isolation','recorded provider exact bytes','conditional raw PUT and HEAD/GET','unknown endpoint/credential rejection','committed500/drop reconciliation','owned SIGTERM cleanup'],'raw_sha256':hashlib.sha256(raw).hexdigest(),'gzip_bytes':len(compressed),'drain_seconds':round(elapsed,3),'outbound_proxy':'absent','aws_measurement':False},indent=2))
                return 0
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:process.wait(timeout=9)
                    except subprocess.TimeoutExpired:process.kill();process.wait(timeout=2)

if __name__=='__main__':sys.exit(main())
