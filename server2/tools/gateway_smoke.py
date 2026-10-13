#!/usr/bin/env python3
"""Actual opt-in gateway release HTTP smoke with task-owned loopback peers only."""
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
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import quote
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
def start(binary,endpoint,mode):
    env={k:v for k,v in os.environ.items() if k in ('PATH','SYSTEMROOT','TMPDIR')}
    env.update(SERVER2_BIND='127.0.0.1:0',SERVER2_METRICS_BIND='127.0.0.1:0',SERVER2_GATEWAY_LEGACY_URL=endpoint,SERVER2_GEOCODER_MODE=mode,GEOCODER_KAKAO_KEYS='["local-dummy"]',GEOCODER_GOOGLE_KEY='local-dummy',GEOCODER_KAKAO_BASE_URL=endpoint,GEOCODER_GOOGLE_BASE_URL=endpoint)
    process=subprocess.Popen([binary],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
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
def run(binary):
    print('execution started UTC '+datetime.now(timezone.utc).isoformat(timespec='seconds'),flush=True)
    Peer.fixtures=json.loads(FIXTURES.read_text());http.server.ThreadingHTTPServer.request_queue_size=128;server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Peer)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();endpoint='http://127.0.0.1:'+str(server.server_port)
    try:
        for mode in ('legacy','mock','legacy'):
            process,base=start(binary,endpoint,mode)
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
                if mode=='mock':
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
                    print('PASS cold mock demand: 16 same-key callers -> 1 Kakao call; 16 distinct keys -> 16 Kakao calls; non-ko lookup -> Kakao+Google',flush=True)
                    print('mock distinct-key elapsed ms '+json.dumps({'n':len(distinct),'p50':p(.5),'p95':p(.95),'p99':p(.99)},sort_keys=True),flush=True)
            finally: stop(process)
        print('PASS legacy -> mock -> legacy restart rollback; all owned processes stopped',flush=True)
        print('observed peer counters: '+json.dumps(Peer.counts,sort_keys=True),flush=True)
        print('PASS S10 actual local release smoke; no live provider/AWS/quota or cutover claim',flush=True)
    finally: server.shutdown();server.server_close();thread.join(timeout=2)
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--binary',required=True);a=p.parse_args();run(str(Path(a.binary).resolve()))
