#!/usr/bin/env python3
"""Start isolated test peers and the foundation binary; no deployment or proxy."""
import argparse
import http.client
import json
import os
from pathlib import Path
import queue
import re
import signal
import stat
import subprocess
import sys
import tempfile
import threading

from peer import OWNED, load_config, load_fixtures, make_peer


def binary_path(value):
    path = (OWNED / value).resolve()
    if not path.is_relative_to(OWNED) or not path.is_file() or not os.access(path, os.X_OK):
        raise ValueError('binary must be an executable owned by server2')
    return path


def ready_path(value):
    path = Path(value).absolute()
    parent = path.parent
    if not parent.is_dir() or parent.is_symlink() or not parent.name.startswith('server2-s03-') or not parent.resolve().is_relative_to(Path(tempfile.gettempdir()).resolve()):
        raise ValueError('ready parent must be an existing server2-s03-* private temp directory')
    if parent.stat().st_mode & 0o077 or path.exists() or path.is_symlink():
        raise ValueError('ready directory must be private and ready file absent')
    return path


def remove_owned(path, identity):
    """Remove only the regular file with the owned (device, inode) identity."""
    try: info = path.lstat()
    except FileNotFoundError: return False
    if stat.S_ISREG(info.st_mode) and (info.st_dev, info.st_ino) == identity:
        path.unlink()
        return True
    return False


def publish_ready(ready, data):
    """Expose complete JSON atomically without replacing an existing target."""
    fd, name = tempfile.mkstemp(prefix='.ready-', suffix='.json', dir=ready.parent)
    temporary = Path(name)
    info = os.fstat(fd); identity = (info.st_dev, info.st_ino)
    linked = False
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(data, stream, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        # Same directory/filesystem; link fails if any target entry exists,
        # including a symlink. No overwrite/replace fallback is permitted.
        os.link(temporary, ready, follow_symlinks=False)
        linked = True
        remove_owned(temporary, identity)
        return identity
    except BaseException:
        if linked: remove_owned(ready, identity)
        raise
    finally:
        remove_owned(temporary, identity)


def probe(addr,path):
    client = http.client.HTTPConnection(*addr, timeout=2)
    try:
        client.request('GET',path); response=client.getresponse(); body=response.read()
        if response.status != 200: raise RuntimeError('local foundation readiness failed')
        return body
    finally: client.close()


def run(args):
    binary = binary_path(args.binary); ready = ready_path(args.ready)
    config = load_config(OWNED / 'config/local-stack.json')
    fixtures = load_fixtures(OWNED / config['fixtures'])
    peers = [make_peer('s3',config),make_peer('provider',config,fixtures)]
    threads = [threading.Thread(target=p.serve_forever,daemon=True) for p in peers]
    child = None; identity = None; stopped=threading.Event(); lines=queue.Queue()
    signal.signal(signal.SIGTERM,lambda *_:stopped.set());signal.signal(signal.SIGINT,lambda *_:stopped.set())
    try:
        for thread in threads:thread.start()
        endpoints = dict(zip(['s3_endpoint','provider_endpoint'],['http://127.0.0.1:'+str(p.server_port) for p in peers]))
        # Do not inherit AWS/provider keys, proxy settings, Node modes or collector flags.
        env = {'PATH':os.defpath,'SERVER2_BIND':'127.0.0.1:0','SERVER2_METRICS_BIND':'127.0.0.1:0','SERVER2_WORKER_THREADS':'2','SERVER2_BLOCKING_THREADS':'4',
               'SERVER2_S3_ENDPOINT':endpoints['s3_endpoint'],'SERVER2_PROVIDER_ENDPOINT':endpoints['provider_endpoint'],
               'AWS_ACCESS_KEY_ID':config['test_access_key'],'AWS_SECRET_ACCESS_KEY':config['test_secret_key'],'AWS_REGION':'us-east-1','AWS_EC2_METADATA_DISABLED':'true'}
        child = subprocess.Popen([str(binary)],cwd=OWNED,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
        def read_output():
            for line in child.stdout:lines.put(line.strip())
        reader=threading.Thread(target=read_output,daemon=True);reader.start()
        try:line=lines.get(timeout=5)
        except queue.Empty:raise RuntimeError('foundation did not announce listeners within5s')
        match=re.fullmatch(r'server2 public=127\.0\.0\.1:(\d+) metrics=127\.0\.0\.1:(\d+)',line)
        if not match:raise RuntimeError('unexpected foundation listener output')
        public=('127.0.0.1',int(match[1]));metrics=('127.0.0.1',int(match[2]))
        if probe(public,'/health')!=b'OK':raise RuntimeError('wrong foundation health body')
        probe(metrics,'/internal/metrics')
        data=dict(endpoints,public_endpoint='http://127.0.0.1:'+match[1],metrics_endpoint='http://127.0.0.1:'+match[2],
                  bucket=config['bucket'],test_access_key=config['test_access_key'],test_secret_key=config['test_secret_key'],
                  region='us-east-1',stack_pid=os.getpid(),foundation_pid=child.pid,capability='test-subset; no SigV4 crypto, IAM, TLS, disk durability or AWS latency')
        identity=publish_ready(ready,data)
        print(json.dumps({'ready':str(ready),'endpoints':endpoints,'foundation_pid':child.pid}),flush=True)
        while not stopped.wait(.2):
            if child.poll() is not None:raise RuntimeError('foundation stopped unexpectedly')
        return 0
    finally:
        if child is not None:
            if child.poll() is None:
                child.terminate()
                try:child.wait(timeout=7)
                except subprocess.TimeoutExpired:child.kill();child.wait(timeout=2)
            child.stdout.close()
        for peer in peers:peer.shutdown();peer.server_close()
        for thread in threads:thread.join(timeout=3)
        if identity is not None:remove_owned(ready,identity)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary',default='target/release/server2')
    parser.add_argument('--ready',required=True,help='absent JSON in private server2-s03-* temp directory')
    args=parser.parse_args()
    try:return run(args)
    except (OSError,ValueError,RuntimeError) as error:
        print('local stack: '+str(error),file=sys.stderr);return 1

if __name__=='__main__':sys.exit(main())
