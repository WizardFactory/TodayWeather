"""S06 reproducible bounded loopback HTTP fault peer (TEST ONLY).

Builds on the owned S03 emulator. No SigV4 validation, IAM, TLS, persistent
storage or AWS benchmarks. Modes select one explicit owned key; no live relay.
Run with no arguments for endpoint on stdout; --smoke PATH executes the release
example against a fresh peer, with complete child/HTTP server cleanup.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
from urllib.parse import parse_qs, urlsplit, unquote

OWNED = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('s06_owned_peer', OWNED/'deploy/local/peer.py')
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

class Handler(base.Handler):
    def send(self, status, body=b'', headers=None):
        if self.server.mode == 'chunked-list' and 'list-type=2' in self.path and status == 200:
            self.protocol_version = 'HTTP/1.1'
            self.send_response(status)
            for k,v in (headers or {}).items(): self.send_header(k,v)
            self.send_header('Transfer-Encoding','chunked')
            self.send_header('Connection','close')
            self.end_headers()
            for pos in range(0,len(body),17):
                part=body[pos:pos+17]
                self.wfile.write(f'{len(part):x}\r\n'.encode()+part+b'\r\n')
            self.wfile.write(b'0\r\n\r\n')
            self.close_connection=True
            return
        if self.server.mode in ('eof-list','short-list') and 'list-type=2' in self.path and status == 200:
            self.send_response(status)
            for k,v in (headers or {}).items(): self.send_header(k,v)
            if self.server.mode=='short-list':self.send_header('Content-Length',str(len(body)+1))
            self.send_header('Connection','close');self.end_headers();self.wfile.write(body);self.close_connection=True;return
        return super().send(status,body,headers)
    def dispatch(self):
        split = urlsplit(self.path)
        query = parse_qs(split.query)
        if split.path == '/__catalog':
            if self.command != 'POST' or self.headers.get('X-Server2-Test-Key') != 'server2-local':
                return self.error(403, 'OnlyLocalTestControl')
            mode = query.get('mode', [''])[0]
            key = query.get('key', [''])[0]
            if mode not in ('commit500', 'conflict409', 'forget', 'corrupt', 'clear', 'reject', 'drop-commit', 'late-reject', 'barrier', 'bad-list', 'repeat-token', 'delay', 'unexpected202', 'chunked-list', 'empty-page', 'slow-all', 'delay-after-first', 'wrong-key', 'eof-list', 'short-list') or (not base.valid_key(key) and mode not in ('bad-list','repeat-token')):
                return self.error(400, 'InvalidTestFault')
            with self.server.lock:
                self.server.mode = mode
                self.server.fault_key = key
                self.server.pending = None
                if mode == 'forget': self.server.objects.pop(key, None)
                if mode == 'wrong-key' and key in self.server.objects:
                    old=self.server.objects.pop(key)
                    prefix,name=key.rsplit('/',1)
                    self.server.objects[prefix+'/999999-'+name.split('-',1)[1]]=old
                if mode == 'corrupt' and key in self.server.objects:
                    old = self.server.objects[key]
                    self.server.objects[key] = base.Object(b'corrupt', old.metadata, old.content_type, old.etag, old.version)
                self.server.barrier = threading.Barrier(2, timeout=2)
            return self.send(204)
        if split.path == '/__catalog/status' and self.command == 'GET':
            with self.server.lock:
                result = dict(self.server.counts)
            return self.send(200, json.dumps(result).encode(), {'Content-Type':'application/json'})
        path = unquote(split.path)
        key = path.split('/', 2)[2] if len(path.split('/',2)) == 3 else ''
        with self.server.lock:
            mode, fault_key = self.server.mode, self.server.fault_key
            counter = self.command + ' ' + key
            self.server.counts[counter] = self.server.counts.get(counter, 0) + 1
            pending = self.server.pending
        if mode == 'slow-all' and self.command == 'GET': time.sleep(0.02)
        if self.command == 'GET' and query.get('list-type') == ['2']:
            if mode == 'empty-page' and 'continuation-token' not in query:
                return self.send(200, b'<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>true</IsTruncated><KeyCount>0</KeyCount><NextContinuationToken>AA==</NextContinuationToken></ListBucketResult>', {'Content-Type':'application/xml'})
            if mode == 'bad-list': return self.send(200, b'<broken>', {'Content-Type':'application/xml'})
            if mode == 'repeat-token': return self.send(200, b'<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>true</IsTruncated><NextContinuationToken>repeat</NextContinuationToken></ListBucketResult>', {'Content-Type':'application/xml'})
        if key == fault_key:
            if self.command == 'GET' and (mode == 'delay' or (mode == 'delay-after-first' and self.server.counts[counter] > 1)): time.sleep(0.25)
            if mode == 'barrier' and self.command == 'GET':
                with self.server.lock:
                    first = self.server.barrier_reads < 2
                    if first: self.server.barrier_reads += 1
                    snapshot = self.server.objects.get(key)
                if first:
                    self.server.barrier.wait()
                    if snapshot is None: return self.error(404,'NoSuchKey')
                    return self.send(200,snapshot.body,dict(snapshot.metadata, **{'Content-Type':snapshot.content_type,'ETag':snapshot.etag,'x-amz-version-id':snapshot.version}))
            if mode == 'late-reject' and self.command == 'GET' and pending is not None:
                return self.error(404, 'NotYetCommitted')
        return super().dispatch()

    def put(self, key):
        with self.server.lock:
            mode = self.server.mode if key == self.server.fault_key else ''
            pending = self.server.pending
        if mode == 'reject': return self.error(403, 'InjectedDirectRejection')
        if mode == 'unexpected202': return self.send(202)
        if mode == 'conflict409':
            with self.server.lock: self.server.mode = ''
            return self.error(409, 'InjectedConcurrentConflict')
        if mode in ('drop-commit','commit500'):
            with self.server.lock:
                self.server.faults[key] = 'drop-after-put' if mode == 'drop-commit' else 'error-after-put'
                self.server.mode = ''
            return super().put(key)
        if mode == 'late-reject':
            if pending is None:
                length = int(self.headers.get('Content-Length','0'))
                if not 0 <= length <= self.server.config['max_object_bytes']: return self.error(413,'TestBodyLimit')
                body = self.rfile.read(length)
                if base64.b64decode(self.headers.get('Content-MD5','')) != hashlib.md5(body).digest(): return self.error(400,'BadDigest')
                with self.server.lock:
                    self.server.pending = (body, self.headers.get('Content-Type','application/json'))
                self.close_connection = True
                self.connection.shutdown(socket.SHUT_RDWR)
                return
            body, content_type = pending
            with self.server.lock:
                versions = self.server.versions.get(key, [])
                obj = base.Object(body, {}, content_type, '"'+hashlib.md5(body).hexdigest()+'"', str(len(versions)+1))
                self.server.objects[key] = obj
                self.server.versions[key] = versions+[obj]
                self.server.pending = None
                self.server.mode = ''
            return self.error(403, 'RetryRejectedAfterDelayedFirstCommit')
        return super().put(key)

    do_GET = do_HEAD = do_PUT = do_POST = do_DELETE = do_OPTIONS = dispatch


def make():
    config = base.load_config(OWNED/'config/local-stack.json')
    peer = base.Peer('s3', config, {})
    peer.RequestHandlerClass = Handler
    peer.mode, peer.fault_key, peer.pending, peer.barrier_reads = '', '', None, 0
    peer.counts = {}
    return peer


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--smoke', help='Built catalogs_smoke executable')
    args = parser.parse_args()
    peer = make()
    endpoint = f'http://127.0.0.1:{peer.server_port}/'
    if args.smoke:
        thread = threading.Thread(target=peer.serve_forever, daemon=True)
        thread.start()
        try:
            return subprocess.run([args.smoke, endpoint], timeout=30, check=False).returncode
        finally:
            peer.shutdown()
            peer.server_close()
            thread.join(timeout=5)
    print(endpoint, flush=True)
    try: peer.serve_forever()
    finally: peer.server_close()
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
