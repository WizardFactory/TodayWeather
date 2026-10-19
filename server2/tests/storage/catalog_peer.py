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

class PayloadReader:
    """Count consumed request bodies, never parsed HTTP headers (owned fixture only)."""
    def __init__(self, stream, handler):
        self.stream, self.handler = stream, handler
    def read(self, *args):
        body = self.stream.read(*args)
        self.handler.payload_count('BODYIN', len(body))
        return body
    def __getattr__(self, name):
        return getattr(self.stream, name)


class PayloadWriter:
    """Count successful body writes after headers; chunk framing is included if enabled."""
    def __init__(self, stream, handler):
        self.stream, self.handler = stream, handler
    def write(self, body):
        count = self.stream.write(body)
        if self.handler.payload_started:
            self.handler.payload_count('BODYOUT', len(body) if count is None else count)
        return count
    def __getattr__(self, name):
        return getattr(self.stream, name)


class Handler(base.Handler):
    def setup(self):
        super().setup()
        self.payload_started, self.operation = False, None
        self.rfile = PayloadReader(self.rfile, self)
        self.wfile = PayloadWriter(self.wfile, self)
    def payload_count(self, kind, count):
        if self.operation is not None:
            with self.server.response_lock:
                key = kind + ' ' + self.operation
                self.server.response_counts[key] = self.server.response_counts.get(key, 0) + count
    def end_headers(self):
        super().end_headers()
        self.payload_started = True
    def send(self, status, body=b'', headers=None):
        path = unquote(urlsplit(self.path).path)
        key = path.split('/', 2)[2] if len(path.split('/', 2)) == 3 else ''
        # The base conditional error may call send while holding the object lock.
        with self.server.response_lock:
            counter = f'STATUS {status} {key}'
            self.server.response_counts[counter] = self.server.response_counts.get(counter, 0) + 1
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
        self.payload_started, self.operation = False, None
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
                # Leave time to send explicit failure before the inherited socket lifetime ends.
                wait = min(1.5, self.server.config['socket_timeout_seconds'] * 0.75)
                self.server.barrier = threading.Barrier(2, timeout=wait)
                self.server.barrier_puts = 0
            return self.send(204)
        if split.path == '/__catalog/status' and self.command == 'GET':
            with self.server.lock:
                result = dict(self.server.counts)
            with self.server.response_lock:
                result.update(self.server.response_counts)
            return self.send(200, json.dumps(result).encode(), {'Content-Type':'application/json'})
        path = unquote(split.path)
        key = path.split('/', 2)[2] if len(path.split('/',2)) == 3 else ''
        self.operation = ('LIST ' + query.get('prefix', [''])[0]
                          if self.command == 'GET' and query.get('list-type') == ['2']
                          else self.command + ' ' + key)
        with self.server.response_lock:
            counter = 'OP ' + self.operation
            self.server.response_counts[counter] = self.server.response_counts.get(counter, 0) + 1
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
            if mode == 'late-reject' and self.command == 'GET' and pending is not None:
                return self.error(404, 'NotYetCommitted')
        return super().dispatch()

    def put(self, key):
        with self.server.lock:
            mode = self.server.mode if key == self.server.fault_key else ''
            pending = self.server.pending
            synchronize = mode == 'barrier' and self.server.barrier_puts < 2
            if synchronize:
                self.server.barrier_puts += 1
                barrier = self.server.barrier
        if synchronize:
            # Preflight GETs stay normal. Neither conditional commit can precede both PUT arrivals.
            try:
                barrier.wait()
            except threading.BrokenBarrierError:
                return self.error(503, 'TestConditionalPutBarrierTimeout')
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


class PersistentHandler(Handler):
    protocol_version = 'HTTP/1.1'

    def setup(self):
        super().setup()
        self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self.opened_at = time.monotonic()

    def send(self, status, body=b'', headers=None):
        # The inherited absolute socket lifetime stays bounded. Stop advertising reuse
        # before its timer can interrupt a later request on this connection.
        lifetime = self.server.config['socket_timeout_seconds']
        # Early write faults may leave unread request bytes; never reuse that socket.
        if (self.command in ('PUT', 'POST') and status != 200) or time.monotonic() - self.opened_at >= lifetime / 2:
            headers = dict(headers or {}, **{'Connection': 'close'})
            self.close_connection = True
        return super().send(status, body, headers)


def make(persistent=False, fanout_capacity=False):
    config = base.load_config(OWNED/'config/local-stack.json')
    if fanout_capacity:
        # Explicit finite TEST-only capacity for5000 claim+result objects; ordinary
        # local stack defaults and every runtime configuration remain unchanged.
        config['max_objects'] = 16384
        config['max_store_bytes'] = 64 * 1024 * 1024
    # Linux drops connection attempts beyond the listen backlog (socketserver default 5) and the
    # S3 client connects within 1 s, so a few concurrent readers failed with Transport on CI.
    # Admission stays bounded by the peer's connection slots.
    base.Peer.request_queue_size = 128
    peer = base.Peer('s3', config, {})
    peer.RequestHandlerClass = PersistentHandler if persistent else Handler
    peer.mode, peer.fault_key, peer.pending, peer.barrier_puts = '', '', None, 0
    peer.counts = {}
    peer.response_lock = threading.Lock()
    peer.response_counts = {}
    return peer


def check_persistent():
    """Actual loopback requests; no external credentials, endpoint or lasting data."""
    import http.client
    auth = {'X-Server2-Test-Key': 'server2-local'}
    for persistent in (False, True):
        peer = make(persistent)
        thread = threading.Thread(target=peer.serve_forever, daemon=True)
        thread.start()
        connection = http.client.HTTPConnection('127.0.0.1', peer.server_port, timeout=2)
        try:
            path = '/server2-local/reuse'
            body = b'canonical'
            headers = dict(auth, **{'If-None-Match': '*', 'Content-MD5': base64.b64encode(hashlib.md5(body).digest()).decode()})
            connection.request('PUT', path, body, headers)
            response = connection.getresponse()
            assert response.status == 200
            response.read()
            original = connection.sock
            assert (original is not None) == persistent
            for method in ('HEAD', 'GET', 'GET'):
                connection.request(method, path, headers=auth)
                response = connection.getresponse()
                assert response.status == 200 and response.getheader('Content-Length') == str(len(body))
                assert response.read() == (b'' if method == 'HEAD' else body)
                if persistent:
                    assert connection.sock is original, 'two requests must reuse the same actual socket'
            with peer.response_lock:
                counted = dict(peer.response_counts)
            assert counted['OP PUT reuse'] == 1
            assert counted['OP HEAD reuse'] == 1 and counted['OP GET reuse'] == 2
            assert counted['BODYIN PUT reuse'] == len(body), 'headers are not request payload'
            assert counted['BODYOUT GET reuse'] == 2 * len(body), 'count actual emitted body bytes'
            assert counted.get('BODYOUT HEAD reuse', 0) == 0, 'HEAD announces length but emits no body'
            if persistent:
                time.sleep(peer.config['socket_timeout_seconds'] / 2 + 0.05)
                connection.request('GET', path, headers=auth)
                response = connection.getresponse()
                assert response.status == 200 and response.read() == body
                assert response.getheader('Connection') == 'close'
                assert connection.sock is None, 'reuse ends before unchanged hard socket expiry'
            connection.request('POST', '/__catalog?mode=drop-commit&key=fault', body=b'', headers=auth)
            response = connection.getresponse()
            assert response.status == 204 and response.read() == b''
            # The injected committed-write disconnect must still be observed, not hidden.
            connection.request('PUT', '/server2-local/fault', body, headers)
            try:
                connection.getresponse()
                raise AssertionError('drop-commit fault must close before a response')
            except (http.client.RemoteDisconnected, ConnectionResetError):
                pass
            connection.close()
            connection = http.client.HTTPConnection('127.0.0.1', peer.server_port, timeout=2)
            connection.request('GET', '/server2-local/fault', headers=auth)
            response = connection.getresponse()
            assert response.status == 200 and response.read() == body
            connection.request('PUT', '/server2-local/fault', body, headers)
            response = connection.getresponse()
            assert response.status == 412
            response.read()
            # A fault may return before consuming the PUT body. The next request must
            # reconnect rather than parse those body bytes as an HTTP method.
            connection.request('POST', '/__catalog?mode=unexpected202&key=early', body=b'', headers=auth)
            response = connection.getresponse()
            assert response.status == 204 and response.read() == b''
            connection.request('PUT', '/server2-local/early', body, headers)
            response = connection.getresponse()
            assert response.status == 202 and response.read() == b''
            connection.request('GET', path, headers=auth)
            response = connection.getresponse()
            assert response.status == 200 and response.read() == body, 'early PUT response corrupted the next HTTP frame'
            print('owned peer', 'persistent' if persistent else 'default', 'reuse/framing/HEAD/204/CAS/fault/payload-counters PASS')
        finally:
            connection.close()
            peer.shutdown()
            peer.server_close()
            thread.join(timeout=3)
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--smoke', help='Built catalogs_smoke executable')
    parser.add_argument('--persistent', action='store_true', help='Reuse owned HTTP connections within unchanged admission/socket bounds')
    parser.add_argument('--fanout-capacity', action='store_true', help='Bounded TEST-only16384 objects/64MiB for5000 warning claim+result pairs')
    parser.add_argument('--check-persistent', action='store_true', help='Run isolated framing/reuse/default/fault checks and exit')
    args = parser.parse_args()
    if args.check_persistent:
        return check_persistent()
    peer = make(args.persistent, args.fanout_capacity)
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
