#!/usr/bin/env python3
"""Actual release-process smoke: only loopback, no providers, Mongo or S3.

S10e: the listener follows the legacy names (PORT=0 selects ephemeral public and metrics
ports); every other process setting is built in (128 public sockets, 9-second lifetime). The
process runs in an empty working directory, so no real server2/.env is read."""
import argparse
import json
import os
import re
import socket
import select
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


def get(url):
    try: response=urllib.request.urlopen(url,timeout=2)
    except urllib.error.HTTPError as error: response=error
    with response: return response.status,dict(response.headers),response.read().decode()


SOCKETS=128   # built-in public connection limit
LIFETIME=9    # built-in connection lifetime without the gateway


def run(binary):
    env={k:v for k,v in os.environ.items() if k in ('PATH','SYSTEMROOT','TMPDIR')}
    env.update(PORT='0')
    cwd=tempfile.mkdtemp(prefix='server2-smoke-')
    bad=dict(env,PORT='http')
    invalid=subprocess.run([binary],env=bad,cwd=cwd,capture_output=True,text=True,timeout=5)
    assert invalid.returncode!=0 and 'invalid PORT' in invalid.stderr,invalid.stderr
    print('PASS invalid legacy PORT startup rejected')
    process=subprocess.Popen([binary],env=env,cwd=cwd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
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
        assert status==200 and 'access-control-allow-origin' not in headers
        assert headers.get('cache-control')=='no-store'
        counters=dict(line.split() for line in body.splitlines())
        assert counters['server2_health_requests_total']=='2'
        assert counters['server2_inflight']=='0' and counters['server2_cpu_inflight']=='0'
        print('GET loopback metrics -> 200 no-store; counters: '+json.dumps(counters,sort_keys=True))
        host,port=match[1].split(':')
        # Establish and dispatch every admitted keep-alive socket before probing the cap.
        held=[]
        try:
            for _ in range(SOCKETS):
                connection=socket.create_connection((host,int(port)),timeout=4)
                held.append(connection)
                connection.sendall(b'GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n')
                answer=connection.recv(4096)
                assert b'200 OK' in answer
            with socket.create_connection((host,int(port)),timeout=1) as excess:
                try: closed=excess.recv(1)==b''
                except ConnectionResetError: closed=True
                assert closed,'connection cap did not reject the excess socket'
        finally:
            for connection in held: connection.close()
        deadline=time.monotonic()+3
        while True:
            try:
                assert get(public+'/health')[0]==200
                break
            except (OSError,urllib.error.URLError):
                if time.monotonic()>=deadline: raise
                time.sleep(0.02)
        print('PASS public socket cap %d rejects excess and recovers after release'%SOCKETS)
        with socket.create_connection((host,int(port)),timeout=LIFETIME+4) as slow:
            started=time.monotonic()
            slow.sendall(b'GET /health HTTP/1.1\r\nHost: localhost\r\n')
            assert slow.recv(1)==b''
            elapsed=time.monotonic()-started
            assert LIFETIME-0.5<=elapsed<=LIFETIME+1.5,elapsed
        print('PASS unfinished HTTP headers closed within %.1f..%.1fs at the %d-second lifetime'%(LIFETIME-0.5,LIFETIME+1.5,LIFETIME))
        process.terminate();assert process.wait(timeout=8)==0
        print('PASS SIGTERM drained both listeners; no provider calls')
    finally:
        if process.poll() is None: process.kill();process.wait(timeout=5)

    # A second process has the 9-second socket lifetime, so the 5-second signal drain
    # must force-close a partial-header connection rather than wait for its age limit.
    process=subprocess.Popen([binary],env=env,cwd=cwd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        ready,_,_=select.select([process.stdout],[],[],10)
        assert ready,'second startup timeout'
        line=process.stdout.readline().strip()
        match=re.fullmatch(r'server2 public=(127\.0\.0\.1:\d+) metrics=(127\.0\.0\.1:\d+)',line)
        assert match,line
        host,port=match[1].split(':')
        with socket.create_connection((host,int(port)),timeout=8) as partial:
            partial.sendall(b'GET /health HTTP/1.1\r\nHost: localhost\r\n')
            # Let the server accept the socket and start parsing before SIGTERM.
            time.sleep(0.1)
            started=time.monotonic();process.terminate()
            assert process.wait(timeout=8)==0
            elapsed=time.monotonic()-started
            stderr=process.stderr.read()
            assert 'signal drain deadline; forced stop' in stderr,stderr
            assert 4.5<=elapsed<=7,elapsed
            assert partial.recv(1)==b''
        print('PASS SIGTERM with partial headers: logged clean forced stop within 4.5..7s')
    finally:
        if process.poll() is None: process.kill();process.wait(timeout=5)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--binary',required=True);args=p.parse_args()
    run(str(Path(args.binary).resolve()))
