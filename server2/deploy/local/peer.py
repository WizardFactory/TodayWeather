"""Bounded loopback-only TEST S3/provider peer; never an AWS proxy.

No SigV4 crypto, IAM, TLS, process-crash durability or AWS performance claims.
Only obvious dummy credentials identify local requests. All state is volatile.
"""
import base64
import binascii
from dataclasses import dataclass
import hashlib
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import socket
import threading
from urllib.parse import parse_qs, unquote, urlsplit
import xml.etree.ElementTree as ET


OWNED = Path(__file__).resolve().parents[2]


def load_config(path):
    config = json.loads(Path(path).read_text())
    if config.get('schema') != 1 or config.get('bind') != '127.0.0.1':
        raise ValueError('test configuration must use schema1 and IPv4 loopback')
    if config.get('bucket') != 'server2-local' or config.get('test_access_key') != 'server2-local' or config.get('test_secret_key') != 'server2-local-secret':
        raise ValueError('only obvious local dummy bucket/credentials are accepted')
    for name, cap in [('max_object_bytes',1048576),('max_store_bytes',33554432),('max_metadata_bytes',2048),('max_versions',64),('max_objects',4096),('max_connections',16),('socket_timeout_seconds',5)]:
        if type(config.get(name)) is not int or not 1 <= config[name] <= cap:
            raise ValueError('invalid bounded test setting: '+name)
    fixture = OWNED / config['fixtures']
    if not fixture.resolve().is_relative_to(OWNED / 'config/fixtures'):
        raise ValueError('fixture manifest must stay in owned fixture directory')
    return config


def load_fixtures(path):
    path = Path(path).resolve()
    if not path.is_relative_to(OWNED / 'config/fixtures'):
        raise ValueError('fixture manifest escapes owned directory')
    result = {}
    for item in json.loads(path.read_text())['fixtures']:
        file = (path.parent / item['path']).resolve()
        if not file.is_relative_to(path.parent) or file.stat().st_size > 1048576:
            raise ValueError('fixture escapes directory or exceeds body cap')
        raw = file.read_bytes()
        if hashlib.sha256(raw).hexdigest() != item['sha256']:
            raise ValueError('fixture hash mismatch')
        result[item['route']] = item['status'], item['content_type'], raw
    return result


@dataclass(frozen=True)
class Object:
    body: bytes
    metadata: dict
    content_type: str
    etag: str
    version: str


class Peer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def __init__(self, kind, config, fixtures):
        if kind not in ('s3','provider') or config['bind'] != '127.0.0.1':
            raise ValueError('only loopback s3/provider test peers are supported')
        self.kind, self.config, self.fixtures = kind, config, fixtures or {}
        self.objects, self.versions, self.faults = {}, {}, {}
        self.stored_bytes = 0
        self.lock = threading.Lock()
        self.slots = threading.BoundedSemaphore(config['max_connections'])
        super().__init__((config['bind'], 0), Handler)

    def get_request(self):
        request, address = super().get_request()
        request.settimeout(self.config['socket_timeout_seconds'])
        return request, address

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try: super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try: super().process_request_thread(request, client_address)
        finally: self.slots.release()


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.0'

    def log_message(self, *_):
        # Never persist request URLs, coordinates, credentials or tokens.
        pass

    def send(self, status, body=b'', headers=None):
        self.send_response(status)
        for key, value in (headers or {}).items(): self.send_header(key, value)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD': self.wfile.write(body)

    def error(self, status, code):
        root = ET.Element('Error'); ET.SubElement(root,'Code').text = code
        self.send(status, ET.tostring(root), {'Content-Type':'application/xml'})

    def authorized(self, query):
        key = self.server.config['test_access_key']
        # Presigned query shape allowlist, intentionally NOT cryptographic auth.
        credential = query.get('X-Amz-Credential', [''])[0].split('/')[0]
        signature = query.get('X-Amz-Signature', [''])[0]
        presigned = credential == key and bool(re.fullmatch('[0-9a-fA-F]{64}', signature))
        return self.headers.get('X-Server2-Test-Key') == key or presigned

    def dispatch(self):
        # Host allowlist prevents treating arbitrary Host/absolute URLs as targets.
        allowed = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
        if self.headers.get('Host') not in allowed or not self.path.startswith('/') or self.path.startswith('//'):
            return self.error(400,'InvalidLocalTarget')
        split = urlsplit(self.path)
        if re.search(r'%(?![0-9A-Fa-f]{2})',split.path): return self.error(400,'InvalidKey')
        query = parse_qs(split.query, keep_blank_values=True)
        path = unquote(split.path, errors='strict')
        if not self.authorized(query): return self.error(403,'InvalidLocalCredential')
        if sum(len(k.encode())+len(v.encode()) for k,v in self.headers.items()) > 8192:
            return self.error(400,'TestRequestHeaderLimit')
        if self.headers.get('Transfer-Encoding'): return self.error(400,'UnsupportedTransferEncoding')
        if self.headers.get('Range') or any(x in query for x in ('uploads','uploadId','partNumber','versions')):
            return self.error(501,'UnsupportedLocalSubsetOperation')
        if self.server.kind == 'provider':
            if self.command not in ('GET','HEAD'): return self.error(405,'MethodNotAllowed')
            fixture = self.server.fixtures.get(path) if not query else None
            if fixture is None: return self.error(404,'UnknownRecordedEndpoint')
            status, content_type, raw = fixture
            return self.send(status, raw, {'Content-Type':content_type})
        if path.startswith('/__test/fault/'):
            mode = path.removeprefix('/__test/fault/')
            key = query.get('key',[''])[0]
            if self.command != 'POST' or mode not in ('error-after-put','drop-after-put') or not valid_key(key):
                return self.error(400,'InvalidTestFault')
            with self.server.lock:
                if len(self.server.faults) >= 64: return self.error(507,'TestFaultLimit')
                self.server.faults[key] = mode
            return self.send(204)
        parts = path.split('/',2)
        if len(parts) < 2 or parts[1] != self.server.config['bucket']: return self.error(404,'NoSuchBucket')
        key = parts[2] if len(parts) == 3 else ''
        if not key:
            if self.command == 'GET' and query.get('list-type') == ['2']: return self.list_objects(query)
            return self.error(400,'MissingObjectKey')
        if not valid_key(key): return self.error(400,'InvalidKey')
        if self.command == 'PUT': return self.put(key)
        if self.command not in ('HEAD','GET'): return self.error(405,'MethodNotAllowed')
        with self.server.lock:
            version = query.get('versionId',[''])[0]
            if version:
                revisions = self.server.versions.get(key,[])
                number = int(version) if version.isdecimal() else 0
                obj = revisions[number-1] if 1 <= number <= len(revisions) else None
            else:obj = self.server.objects.get(key)
        if obj is None: return self.error(404,'NoSuchVersion' if version else 'NoSuchKey')
        return self.send(200,obj.body,dict(obj.metadata, **{'Content-Type':obj.content_type,'ETag':obj.etag,'x-amz-version-id':obj.version}))

    def put(self,key):
        config = self.server.config
        lengths = self.headers.get_all('Content-Length', [])
        if len(lengths) != 1 or not lengths[0].isdigit(): return self.error(400,'InvalidContentLength')
        length = int(lengths[0])
        if length > config['max_object_bytes']: return self.error(413,'TestBodyLimit')
        metadata = {k.lower():v for k,v in self.headers.items() if k.lower().startswith('x-amz-meta-')}
        if sum(len(k.removeprefix('x-amz-meta-').encode())+len(v.encode()) for k,v in metadata.items()) > config['max_metadata_bytes']:
            return self.error(400,'TestMetadataLimit')
        condition = self.headers.get('If-None-Match'); match = self.headers.get('If-Match')
        if (condition != '*' and not match) or (condition and match): return self.error(400,'ConditionalWriteRequired')
        body = self.rfile.read(length)
        if len(body) != length: return self.error(400,'IncompleteBody')
        try: digest = base64.b64decode(self.headers.get('Content-MD5',''),validate=True)
        except (binascii.Error,ValueError): return self.error(400,'InvalidDigest')
        if digest != hashlib.md5(body).digest(): return self.error(400,'BadDigest')
        with self.server.lock:
            current = self.server.objects.get(key)
            if condition == '*' and current or match and (current is None or match != current.etag):
                return self.error(412,'PreconditionFailed')
            revisions = self.server.versions.get(key,[])
            cost = len(body) + sum(len(k.encode())+len(v.encode()) for k,v in metadata.items()) + len(key.encode()) + 512
            if len(revisions) >= config['max_versions'] or self.server.stored_bytes + cost > config['max_store_bytes'] or (current is None and len(self.server.objects) >= config['max_objects']):
                return self.error(507,'TestStoreLimit')
            obj = Object(body,metadata,self.headers.get('Content-Type','application/octet-stream'), '"'+hashlib.md5(body).hexdigest()+'"',str(len(revisions)+1))
            self.server.objects[key] = obj
            self.server.versions[key] = revisions+[obj]
            self.server.stored_bytes += cost
            fault = self.server.faults.pop(key,None)
        if fault == 'error-after-put': return self.error(500,'InjectedCommittedResponseFailure')
        if fault == 'drop-after-put':
            self.close_connection = True
            self.connection.shutdown(socket.SHUT_RDWR)
            return
        self.send(200,headers={'ETag':obj.etag,'x-amz-version-id':obj.version})

    def list_objects(self,query):
        try:
            maximum = int(query.get('max-keys',['1000'])[0])
            if not 1 <= maximum <= 1000: raise ValueError()
            token = query.get('continuation-token',[''])[0]
            after = base64.urlsafe_b64decode(token.encode()).decode() if token else ''
        except (ValueError,binascii.Error,UnicodeDecodeError): return self.error(400,'InvalidListArguments')
        prefix = query.get('prefix',[''])[0]
        with self.server.lock:
            keys = sorted(key for key in self.server.objects if key.startswith(prefix) and key > after)
            selected = [(key,self.server.objects[key]) for key in keys[:maximum]]
        root = ET.Element('ListBucketResult',xmlns='http://s3.amazonaws.com/doc/2006-03-01/')
        ET.SubElement(root,'Name').text = self.server.config['bucket']
        ET.SubElement(root,'Prefix').text = prefix
        ET.SubElement(root,'KeyCount').text = str(len(selected))
        ET.SubElement(root,'MaxKeys').text = str(maximum)
        truncated = len(keys) > maximum
        ET.SubElement(root,'IsTruncated').text = str(truncated).lower()
        if truncated: ET.SubElement(root,'NextContinuationToken').text = base64.urlsafe_b64encode(selected[-1][0].encode()).decode()
        for key,obj in selected:
            entry = ET.SubElement(root,'Contents'); ET.SubElement(entry,'Key').text = key
            ET.SubElement(entry,'ETag').text = obj.etag; ET.SubElement(entry,'Size').text = str(len(obj.body))
            ET.SubElement(entry,'LastModified').text = '2026-10-06T00:00:00.000Z'
        self.send(200,ET.tostring(root),{'Content-Type':'application/xml'})

    def handle_one_request(self):
        try: super().handle_one_request()
        except (TimeoutError,ConnectionError,UnicodeError,ValueError):
            self.close_connection = True

    do_GET = do_HEAD = do_PUT = do_POST = do_DELETE = do_OPTIONS = dispatch


def valid_key(key):
    return bool(key) and len(key.encode()) <= 1024 and not key.startswith('/') and '\\' not in key and not any(x in ('.','..','') for x in key.split('/')) and not any(ord(c)<32 for c in key)


def make_peer(kind,config,fixtures=None):
    return Peer(kind,config,fixtures)
