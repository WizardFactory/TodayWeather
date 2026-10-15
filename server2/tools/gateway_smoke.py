#!/usr/bin/env python3
"""Actual gateway release HTTP smoke: legacy -> native geocoder -> legacy with the real
configuration names (S10e: legacy server/.env names plus SERVER2_S3_BUCKET) and task-owned
loopback test peers. The first legacy phase and the refusal run the release `server2` binary;
phases that need the S3 test peer run the release `loopback_server` example, the same process
with its S3 root on the peer (roots are not settings). Processes run in an empty working
directory, so no real server2/.env is read."""
import argparse
import concurrent.futures
from datetime import datetime, timezone
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
import urllib.error
import urllib.request
from urllib.parse import quote
import sys
ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT/'server2/tests/gateway/fixtures/providers.json'
class Peer(http.server.BaseHTTPRequestHandler):
    counts = {'kakao': 0, 'google': 0, 'backend': 0, 'legacy_geo': 0}
    lock = threading.Lock()
    fixtures = None
    def log_message(self, *_): pass
    def do_GET(self):
        if self.path.startswith('/v2/local/'):
            kind='kakao'; fixture='kakao.addr.jamsil' if '/search/' in self.path else 'kakao.coord.seoul'
        elif self.path.startswith('/maps/api/geocode/'):
            kind='google'; fixture='google.addr.jamsil' if 'address=' in self.path else 'google.coord.seoul.en'
        elif self.path.startswith('/geocode/'):
            kind='legacy_geo'; fixture=None
        else: kind='backend'; fixture=None
        with self.lock: self.counts[kind]+=1
        if fixture:
            time.sleep(0.05)
            body=json.dumps(self.fixtures[fixture],ensure_ascii=False,separators=(',',':')).encode()
        elif kind=='legacy_geo':
            body=b'{"name":"legacy","country":"KR","address":"fixture","location":{"lat":37.566,"long":126.978},"kmaAddress":{"name1":"fixture"}}'
        else: body=b'{"temperature":21,"name":"backend"}'
        self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
def request(base,path,method='GET',headers=None):
    req=urllib.request.Request(base+path,method=method,headers=headers or {})
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try: response=opener.open(req,timeout=10)
    except urllib.error.HTTPError as e: response=e
    with response:return response.status,dict(response.headers),response.read()
def s3_peer():
    child=subprocess.Popen([sys.executable,'tests/storage/catalog_peer.py'],cwd=ROOT/'server2',stdout=subprocess.PIPE,text=True)
    ready,_,_=select.select([child.stdout],[],[],10);assert ready,'S3 peer startup timeout'
    return child,child.stdout.readline().strip()
def s3_keys(s3):
    req=urllib.request.Request(s3+'server2-local?list-type=2',headers={'X-Server2-Test-Key':'server2-local'})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req,timeout=10) as r:text=r.read().decode()
    assert '<IsTruncated>false</IsTruncated>' in text
    return re.findall(r'<Key>([^<]+)</Key>',text)
CWD=tempfile.mkdtemp(prefix='server2-gateway-smoke-')
def settings(endpoint):
    env={k:v for k,v in os.environ.items() if k in ('PATH','SYSTEMROOT','TMPDIR')}
    env.update(PORT='0',SERVER2_GATEWAY_LEGACY_URL=endpoint,GEOCODER_KAKAO_KEYS='["local-dummy"]',GEOCODER_GOOGLE_KEY='local-dummy',
               SERVER2_S3_BUCKET='server2-local',AWS_ACCESS_KEY='server2-local',AWS_SECRET_KEY='server2-local-secret')
    return env
def start(command,endpoint,family):
    env=settings(endpoint)
    # Only the routing list differs between phases; legacy reads none of the native settings.
    if family=='native':env['SERVER2_NATIVE_FAMILIES']='geocode'
    process=subprocess.Popen(command,env=env,cwd=CWD,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        ready,_,_=select.select([process.stdout],[],[],10);assert ready,'startup timeout'
        line=process.stdout.readline().strip();match=re.fullmatch(r'server2 public=(127\.0\.0\.1:\d+) metrics=(127\.0\.0\.1:\d+)',line)
        assert match,(line,process.stderr.read() if process.poll() is not None else 'startup line mismatch')
        return process,'http://'+match[1]
    except BaseException: stop(process);raise
def stop(process):
    if process.poll() is None:
        process.terminate()
        try: assert process.wait(timeout=8)==0
        except subprocess.TimeoutExpired: process.kill();process.wait(timeout=5);raise
    process.stdout.close();process.stderr.close()
def run(binary,peer_binary):
    print('execution started UTC '+datetime.now(timezone.utc).isoformat(timespec='seconds'),flush=True)
    Peer.fixtures=json.loads(FIXTURES.read_text());http.server.ThreadingHTTPServer.request_queue_size=128;server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Peer)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();endpoint='http://127.0.0.1:'+str(server.server_port)
    peer,s3=s3_peer()
    try:
        objects=[]
        on_peer=[peer_binary,'--s3',s3,'--kakao',endpoint,'--google',endpoint,'--geocoder-daily-units','1000']
        for command,mode in (([binary],'legacy'),(on_peer,'native'),(on_peer,'legacy')):
            process,base=start(command,endpoint,mode)
            try:
                assert request(base,'/health')[2]==b'OK'
                status,h,b=request(base,'/weather/coord/37.566,126.978',headers={'Accept-Language':'ko-KR'});assert status==200,(status,b)
                geo=json.loads(b);assert geo['country']=='KR' and geo['temperature']==21
                etag=next(v for k,v in h.items() if k.lower()=='etag')
                assert request(base,'/weather/coord/37.566,126.978',headers={'Accept-Language':'ko-KR','If-None-Match':etag})[0]==304
                assert request(base,'/weather/coord/37.566,126.978',method='HEAD',headers={'Accept-Language':'ko-KR'})[2]==b''
                assert request(base,'/weather/coord/0,0')[0]==404
                assert request(base,'/geocode/v000903/coord/37.566,126.978',method='OPTIONS',headers={'Access-Control-Request-Headers':'x-fixture'})[0]==204
                status,_,body=request(base,'/geocode/v000903/addr/'+quote('서울'),headers={'Accept-Language':'ko'});assert status==200,(status,body)
                print('PASS '+mode+' release HTTP: health, weather merge, ETag304, HEAD, invalidcoords, preflight, address',flush=True)
                if mode=='native':
                    before=Peer.counts.copy()
                    def one(index):
                        started=time.monotonic();status,_,_=request(base,'/geocode/v000903/coord/'+str(37.7+index/1000)+',127.1',headers={'Accept-Language':'ko'});assert status==200;return (time.monotonic()-started)*1000
                    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:list(pool.map(one,[0]*16))
                    delta=Peer.counts['kakao']-before['kakao'];assert delta==1,delta
                    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:distinct=list(pool.map(one,range(1,17)))
                    assert Peer.counts['kakao']-before['kakao']==17
                    b2=Peer.counts.copy();status,_,_=request(base,'/geocode/v000903/coord/37.9,127.1',headers={'Accept-Language':'en-US'});assert status==200
                    assert Peer.counts['kakao']-b2['kakao']==1 and Peer.counts['google']-b2['google']==1
                    ordered=sorted(distinct);p=lambda q: round(ordered[min(len(ordered)-1,int(q*len(ordered)))],2)
                    print('PASS cold native demand: 16 same-key callers -> 1 Kakao call; 16 distinct keys -> 16 Kakao calls; non-ko lookup -> Kakao+Google',flush=True)
                    print('native distinct-key elapsed ms '+json.dumps({'n':len(distinct),'p50':p(.5),'p95':p(.95),'p99':p(.99)},sort_keys=True),flush=True)
                    keys=s3_keys(s3);assert keys and all(k.startswith('budgets/v2/kakao/') or k.startswith('budgets/v2/google/') for k in keys),keys
                    assert not any('37.' in k or 'local-dummy' in k for k in keys),keys
                    print('PASS daily quotas funded in S3 before HTTP: %d budget objects, no coordinate or key in any S3 key'%len(keys),flush=True)
            finally: stop(process)
            objects.append(len(s3_keys(s3)))
        assert objects[0]==0 and objects[1]>0 and objects[2]==objects[1],objects
        env=settings(endpoint);env['SERVER2_NATIVE_FAMILIES']='geocode';del env['SERVER2_S3_BUCKET']
        refused=subprocess.run([binary],env=env,cwd=CWD,stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=10)
        assert refused.returncode!=0 and 'server2 public=' not in refused.stdout and 'invalid gateway configuration' in refused.stderr,(refused.returncode,refused.stderr)
        print('PASS release server2 with native geocode and no SERVER2_S3_BUCKET is refused before binding (exit %d)'%refused.returncode,flush=True)
        print('PASS legacy -> native -> legacy restart rollback; legacy phases added no S3 object (S3 objects per phase %s); all owned processes stopped'%objects,flush=True)
        print('observed peer counters: '+json.dumps(Peer.counts,sort_keys=True),flush=True)
        print('PASS S10 actual local release smoke; no live provider/AWS/quota or cutover claim',flush=True)
    finally:
        peer.terminate();peer.wait(timeout=5)
        server.shutdown();server.server_close();thread.join(timeout=2)
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--binary',required=True)
    p.add_argument('--peer-binary',help='release loopback_server example (default: examples/loopback_server beside --binary)')
    a=p.parse_args();binary=Path(a.binary).resolve()
    run(str(binary),str(Path(a.peer_binary or binary.parent/'examples/loopback_server').resolve()))
