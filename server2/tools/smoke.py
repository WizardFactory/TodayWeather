#!/usr/bin/env python3
"""Actual release-process smoke: only loopback, no providers, Mongo or S3."""
import argparse
import json
import os
import re
import socket
import select
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path


def get(url):
    try: response=urllib.request.urlopen(url,timeout=2)
    except urllib.error.HTTPError as error: response=error
    with response: return response.status,dict(response.headers),response.read().decode()


def run(binary):
    names=('SERVER2_BIND','SERVER2_METRICS_BIND','SERVER2_WORKER_THREADS','SERVER2_BLOCKING_THREADS','SERVER2_CPU_LIMIT','SERVER2_INFLIGHT_LIMIT','SERVER2_CACHE_BYTES','SERVER2_CONNECTION_LIMIT','SERVER2_CONNECTION_SECONDS')
    env={k:v for k,v in os.environ.items() if k not in names}
    env.update(SERVER2_BIND='127.0.0.1:0',SERVER2_METRICS_BIND='127.0.0.1:0',SERVER2_CONNECTION_SECONDS='2')
    bad=dict(env,SERVER2_METRICS_BIND='0.0.0.0:0')
    invalid=subprocess.run([binary],env=bad,capture_output=True,text=True,timeout=5)
    assert invalid.returncode!=0 and 'metrics must bind to loopback' in invalid.stderr
    print('PASS invalid nonloopback metrics startup rejected')
    process=subprocess.Popen([binary],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        ready,_,_=select.select([process.stdout],[],[],10)
        assert ready,'startup timeout'
        line=process.stdout.readline().strip();print(line)
        match=re.fullmatch(r'server2 public=(127\.0\.0\.1:\d+) metrics=(127\.0\.0\.1:\d+)',line)
        assert match,line
        public='http://'+match[1]; private='http://'+match[2]
        status,headers,body=get(public+'/health')
        assert status==200 and body=='OK' and headers.get('access-control-allow-origin')=='*'
        assert headers.get('content-type')=='text/html; charset=utf-8'
        print('GET public /health -> 200 OK; text/html; CORS *')
        with urllib.request.urlopen(urllib.request.Request(public+'/health',method='HEAD'),timeout=2) as head:
            assert head.status==200 and head.read()==b'' and head.headers['content-length']=='2'
        print('HEAD public /health -> 200; empty body; Content-Length 2')
        status,headers,body=get(public+'/internal/metrics');assert status==404
        print('GET public /internal/metrics -> 404')
        status,headers,body=get(private+'/internal/metrics')
        assert status==200 and headers.get('access-control-allow-origin')=='*'
        assert headers.get('cache-control')=='no-store'
        counters=dict(line.split() for line in body.splitlines())
        assert counters['server2_health_requests_total']=='2'
        assert counters['server2_inflight']=='0' and counters['server2_cpu_inflight']=='0'
        print('GET loopback metrics -> 200 no-store; counters: '+json.dumps(counters,sort_keys=True))
        host,port=match[1].split(':')
        with socket.create_connection((host,int(port)),timeout=4) as slow:
            slow.sendall(b'GET /health HTTP/1.1\r\nHost: localhost\r\n')
            assert slow.recv(1)==b''
        print('PASS unfinished HTTP headers closed at 2-second smoke lifetime')
        process.terminate();assert process.wait(timeout=8)==0
        print('PASS SIGTERM drained both listeners; no provider calls')
    finally:
        if process.poll() is None: process.kill();process.wait(timeout=5)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--binary',required=True);args=p.parse_args()
    run(str(Path(args.binary).resolve()))
