#!/usr/bin/env python3
"""Loopback-only TEST stand-in for the two log destinations: S3 PutObject and
CloudWatch Logs. Never an AWS proxy and never used by a deployed host.

It accepts any request signature, stores what it receives under --state and
appends every API operation to operations.jsonl, so tests can check both the
delivered records and the exact actions the collector used.

S3: path-style or virtual-hosted PUT of one object, including aws-chunked
bodies with chunk signatures or trailing checksums.
CloudWatch Logs (JSON 1.1, Logs_20140328): CreateLogStream, PutLogEvents and
the read calls DescribeLogGroups/DescribeLogStreams. Groups must be created
with --log-group, as on AWS, where the instance role cannot create them.
Fault: while <state>/fail-s3 or <state>/fail-logs exists, that service answers 503;
while <state>/deny-data exists, every data-bucket request answers 403 AccessDenied (a lost
instance role, shadow check of SR-3); while <state>/delay-s3 exists, a server object is stored but confirmed only after that many seconds;
while <state>/slow-s3 exists, every object is stored and confirmed only after that many seconds;
while <state>/fail-evidence exists, a PUT under evidence/ of the log bucket answers 503 and log
objects are still stored (the evidence copy fails while its failure record is shipped, SR-5a).
Data buckets (--data-bucket, the shadow check of LP-6): an empty, writable weather
bucket for the server itself; GET/HEAD of a missing key answer 404 NoSuchKey, a list
returns a paged S3 ListObjectsV2 document. PUT preserves media and raw codec headers;
conditional writes return 412 when the recorded ETag or absence condition no longer holds.
"""
import argparse
from datetime import datetime
import hashlib
import json
import os
import re
import signal
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit
from xml.sax.saxutils import escape

MAX_BODY = 64 * 1024 * 1024
SAFE = re.compile(r'^[A-Za-z0-9._=/\-]{1,1024}$')
AUTHORITY = re.compile(r'budgets/v2/data_go_kr/([0-9a-f]{64})/(kst-[0-9]{8}|[0-9]{4}-[0-9]{2}-[0-9]{2})/authority\.json')
WITNESS = re.compile(r'blocks/([0-9]{1,5})-([0-9]{1,5})\.json')


def decode_aws_chunked(raw):
    """Decode the aws-chunked framing: hex-size[;ext]\\r\\n data \\r\\n ... 0\\r\\n trailers."""
    out = bytearray(); i = 0
    while True:
        end = raw.index(b'\r\n', i)
        size = int(raw[i:end].split(b';', 1)[0], 16)
        i = end + 2
        if size == 0:
            return bytes(out)
        out += raw[i:i + size]
        i += size + 2


def read_chunked(stream):
    out = bytearray()
    while True:
        line = stream.readline(1024)
        size = int(line.split(b';', 1)[0], 16)
        if size == 0:
            while stream.readline(1024) not in (b'\r\n', b'\n', b''):
                pass
            return bytes(out)
        out += stream.read(size)
        stream.readline(8)
        if len(out) > MAX_BODY:
            raise ValueError('body too large')


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *args):
        pass

    def body(self):
        if 'chunked' in self.headers.get('Transfer-Encoding', ''):
            raw = read_chunked(self.rfile)
        else:
            length = int(self.headers.get('Content-Length', '0'))
            if length > MAX_BODY:
                raise ValueError('body too large')
            raw = self.rfile.read(length)
        codings = [c.strip().lower() for c in self.headers.get('Content-Encoding', '').split(',')]
        if 'aws-chunked' in codings or self.headers.get('x-amz-decoded-content-length'):
            raw = decode_aws_chunked(raw)
        return raw

    def reply(self, status, payload=b'', content_type='application/x-amz-json-1.1', headers=None):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('x-amzn-RequestId', 'standin')
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(payload)

    def record(self, service, action, **fields):
        credential = re.search(r'Credential=([A-Z0-9]+)/', self.headers.get('Authorization', ''))
        entry = dict(service=service, action=action, signed=bool(self.headers.get('Authorization')),
                     key_id=credential.group(1) if credential else None, at=time.time(), **fields)
        with self.server.lock:
            with open(self.server.state / 'operations.jsonl', 'a') as f:
                f.write(json.dumps(entry, sort_keys=True) + '\n')

    def cw_error(self, status, kind, message):
        self.reply(status, json.dumps({'__type': kind, 'message': message}).encode())

    def logs(self):
        action = self.headers['X-Amz-Target'].split('.', 1)[1]
        request = json.loads(self.body() or b'{}')
        group = request.get('logGroupName'); stream = request.get('logStreamName')
        self.record('logs', action, group=group, stream=stream)
        state = self.server.state / 'cloudwatch'
        if action == 'DescribeLogGroups':
            groups = [{'logGroupName': g, 'arn': 'arn:aws:logs:standin:0:log-group:' + g} for g in self.server.groups]
            return self.reply(200, json.dumps({'logGroups': groups}).encode())
        if group not in self.server.groups:
            return self.cw_error(400, 'ResourceNotFoundException', 'The specified log group does not exist.')
        streams = self.server.streams.setdefault(group, set())
        if action == 'DescribeLogStreams':
            found = [{'logStreamName': s} for s in sorted(streams) if s.startswith(request.get('logStreamNamePrefix', ''))]
            return self.reply(200, json.dumps({'logStreams': found}).encode())
        if not stream or not SAFE.match(stream) or '..' in stream:
            return self.cw_error(400, 'InvalidParameterException', 'invalid stream')
        if action == 'CreateLogStream':
            with self.server.lock:
                if stream in streams:
                    return self.cw_error(400, 'ResourceAlreadyExistsException', 'The specified log stream already exists')
                streams.add(stream)
            return self.reply(200, b'{}')
        if action == 'PutLogEvents':
            if stream not in streams:
                return self.cw_error(400, 'ResourceNotFoundException', 'The specified log stream does not exist.')
            path = state / group.strip('/') / (stream + '.jsonl')
            with self.server.lock:
                path.parent.mkdir(parents=True, exist_ok=True)
                with open(path, 'a') as f:
                    for event in request.get('logEvents', []):
                        f.write(json.dumps({'timestamp': event['timestamp'], 'message': event['message'],
                                            'stored_at': time.time()}) + '\n')
                    f.flush()
                    os.fsync(f.fileno())
            return self.reply(200, b'{}')
        return self.cw_error(400, 'UnknownOperationException', action)

    def s3(self):
        split = urlsplit(self.path)
        host = self.headers.get('Host', '').split(':', 1)[0]
        path = unquote(split.path)
        if '.s3.' in host and not host.startswith('s3.'):  # virtual-hosted: <bucket>.s3.<region>...
            bucket, key = host.split('.s3.', 1)[0], path.lstrip('/')
        else:
            bucket, _, key = path.lstrip('/').partition('/')
        action = {'PUT': 'PutObject', 'GET': 'GetObject', 'HEAD': 'HeadBucket' if not key else 'HeadObject',
                  'DELETE': 'DeleteObject', 'POST': 'PostObject'}.get(self.command, self.command)
        if self.command == 'GET' and not key:
            action = 'ListObjects'
        # The fail-s3 fault is a log destination outage; data buckets stay available.
        if bucket not in self.server.data_buckets and self.unavailable('s3'):
            return None
        body = self.body() if self.command in ('PUT', 'POST') else b''
        self.record('s3', action, bucket=bucket, key=key,
                    content_encoding=self.headers.get('Content-Encoding'), content_type=self.headers.get('Content-Type'),
                    **({'body_bytes': len(body)} if action == 'PutObject' else {}))
        if bucket in self.server.data_buckets:
            if (self.server.state / 'deny-data').exists():
                self.record('s3', 'Denied', bucket=bucket, key=key)
                return self.reply(403, b'<Error><Code>AccessDenied</Code></Error>', 'application/xml')
            return self.data_bucket(action, bucket, key, body, split.query)
        if action != 'PutObject':
            return self.reply(403, b'<Error><Code>AccessDenied</Code></Error>', 'application/xml')
        if bucket != self.server.bucket:
            return self.reply(404, b'<Error><Code>NoSuchBucket</Code></Error>', 'application/xml')
        if not SAFE.match(key) or '..' in key.split('/'):
            return self.reply(400, b'<Error><Code>InvalidKey</Code></Error>', 'application/xml')
        if key.startswith('evidence/') and (self.server.state / 'fail-evidence').exists():
            return self.reply(503, b'<Error><Code>ServiceUnavailable</Code></Error>', 'application/xml')
        # Test fault: while <state>/slow-s3 exists, every object is stored and confirmed only
        # after that many seconds (a slow upload).
        slow = self.server.state / 'slow-s3'
        if slow.exists():
            time.sleep(float(slow.read_text().strip() or '0'))
        target = self.server.state / 's3' / key
        with self.server.lock:
            if self.headers.get('If-None-Match') == '*' and target.exists():
                return self.reply(412, b'<Error><Code>PreconditionFailed</Code></Error>', 'application/xml')
            if target.exists():
                # Distinct keys are part of the contract: an overwrite is recorded, not hidden.
                self.record('s3', 'Overwrite', bucket=bucket, key=key)
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_name('.' + target.name + '.tmp')  # readers never see a partial object
            with open(temporary, 'wb') as f:
                f.write(body)
                f.flush()
                os.fsync(f.fileno())  # a confirmed object survives a power-off of the host (LP-4 check)
            temporary.replace(target)
        # Test fault: while <state>/delay-s3 exists, a server object is stored at once but
        # confirmed only after that many seconds (a delayed confirmation).
        delay = self.server.state / 'delay-s3'
        if delay.exists() and '/server/' in key:
            self.record('s3', 'DelayedConfirmation', bucket=bucket, key=key)
            time.sleep(float(delay.read_text().strip() or '0'))
        return self.reply(200, b'', 'application/xml', {'ETag': '"standin"'})

    def data_bucket(self, action, bucket, key, body, query):
        root = self.server.state / 'data' / bucket
        target = root / key
        if key and (not self.safe_data_path(key) or target.resolve() != root.resolve() / key):
            return self.reply(400, b'<Error><Code>InvalidKey</Code></Error>', 'application/xml')
        quota_caps = getattr(self.server, 'rehearsal_quotas', None)
        # Keep raw codec headers outside the object tree so listings and the
        # finish export count only objects that the candidate actually wrote.
        raw_headers = self.server.state / 'raw-metadata' / bucket / key if key.startswith('raw/v2/') else None
        object_headers = self.server.state / 'data-headers' / bucket / key
        bounded = quota_caps is not None and key.startswith('budgets/')
        with self.server.lock:
            if action == 'ListObjects':
                return self.list_data(root, bucket, query)
            if action in ('GetObject', 'HeadObject'):
                if not target.is_file():
                    return self.reply(404, b'' if action == 'HeadObject' else b'<Error><Code>NoSuchKey</Code></Error>', 'application/xml')
                data = target.read_bytes()
                headers = json.loads(object_headers.read_bytes()) if object_headers.is_file() else {}
                content_type = headers.pop('Content-Type', 'application/json' if bounded else 'application/octet-stream')
                headers['ETag'] = self.quota_etag(data)
                if raw_headers is not None and raw_headers.is_file():
                    headers.update({'x-amz-meta-' + k: v for k, v in json.loads(raw_headers.read_bytes()).items()})
                return self.reply(200, data, content_type, headers)
            if action == 'PutObject':
                if self.headers.get('If-None-Match') == '*' and target.exists():
                    return self.reply(412, b'<Error><Code>PreconditionFailed</Code></Error>', 'application/xml')
                if bounded:
                    return self.put_quota(root, target, body, quota_caps, key)
                expected = self.headers.get('If-Match')
                if expected is not None and (not target.is_file() or expected != self.quota_etag(target.read_bytes())):
                    return self.reply(412, b'<Error><Code>PreconditionFailed</Code></Error>', 'application/xml')
                content_type = self.headers.get('Content-Type', 'application/octet-stream')
                encoding = self.headers.get('Content-Encoding', '')
                metadata = {k.lower().removeprefix('x-amz-meta-'): v for k, v in self.headers.items()
                            if k.lower().startswith('x-amz-meta-')}
                if any('\r' in v or '\n' in v for v in (content_type, encoding, *metadata.values())):
                    return self.reply(400, b'<Error><Code>InvalidArgument</Code></Error>', 'application/xml')
                # body() has already removed the AWS wire framing. Other content
                # codings are object properties and must still be visible to Rust.
                headers = {'Content-Type': content_type}
                codings = [c.strip() for c in encoding.split(',') if c.strip() and c.strip().lower() != 'aws-chunked']
                if codings:
                    headers['Content-Encoding'] = ', '.join(codings)
                target.parent.mkdir(parents=True, exist_ok=True)
                object_headers.parent.mkdir(parents=True, exist_ok=True)
                object_headers.write_text(json.dumps(headers))
                if raw_headers is not None:
                    raw_headers.parent.mkdir(parents=True, exist_ok=True)
                    raw_headers.write_text(json.dumps(metadata))
                target.write_bytes(body)
                return self.reply(200, b'', 'application/xml', {'ETag': self.quota_etag(body)})
            if action == 'HeadBucket':
                return self.reply(200, b'', 'application/xml')
        return self.reply(403, b'<Error><Code>AccessDenied</Code></Error>', 'application/xml')

    @staticmethod
    def safe_data_path(key):
        return SAFE.fullmatch(key) and all(part not in ('', '.', '..') for part in key.split('/'))

    def list_data(self, root, bucket, query):
        params = parse_qs(query, keep_blank_values=True)
        prefix = params.get('prefix', [''])[0]
        limits = params.get('max-keys', ['1000'])
        if (len(limits) != 1 or not re.fullmatch(r'[0-9]{1,4}', limits[0]) or int(limits[0]) > 1000
                or (prefix and not self.safe_data_path(prefix.removesuffix('/')))):
            return self.reply(400, b'<Error><Code>InvalidArgument</Code></Error>', 'application/xml')
        # A catalog repair lists many narrow prefixes. Walking the entire bucket
        # for each lookup exhausts the real handler's fixed request deadline.
        directory = prefix.rpartition('/')[0]
        search = root / directory
        if search.resolve() != root.resolve() / directory:
            return self.reply(400, b'<Error><Code>InvalidArgument</Code></Error>', 'application/xml')
        after = params.get('continuation-token', [''])[0]
        keys = []
        if search.is_dir():
            for path in search.rglob('*'):
                key = path.relative_to(root).as_posix()
                if key.startswith(prefix) and key > after and not path.is_symlink() and path.is_file():
                    keys.append(key)
        keys.sort()
        page = keys[:int(limits[0])]
        more = bool(page) and len(page) < len(keys)
        continuation = f'<NextContinuationToken>{escape(page[-1])}</NextContinuationToken>' if more else ''
        items = ''.join(f'<Contents><Key>{escape(k)}</Key><Size>{(root / k).stat().st_size}</Size></Contents>'
                        for k in page)
        xml = (f'<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
               f'<Name>{escape(bucket)}</Name><Prefix>{escape(prefix)}</Prefix><KeyCount>{len(page)}</KeyCount>'
               f'<IsTruncated>{str(more).lower()}</IsTruncated>{continuation}{items}</ListBucketResult>')
        return self.reply(200, xml.encode(), 'application/xml')

    @staticmethod
    def quota_etag(data):
        return '"' + hashlib.sha256(data).hexdigest() + '"'

    def put_quota(self, root, target, body, caps, key):
        """Apply the rehearsal's narrower quota before a provider unit can be used."""
        prefix, _, relative = key.partition('/blocks/')
        witness = WITNESS.fullmatch('blocks/' + relative) if relative else None
        authority_key = prefix + '/authority.json' if witness else key
        cap = caps.get(authority_key)
        if cap is None or len(body) > 4096:
            return self.reply(429, b'<Error><Code>TooManyRequests</Code></Error>', 'application/xml')
        record = json.loads(body)
        policy = record['policy']
        parts = authority_key.split('/')
        if (record['version'] != 2 or policy['provider'] != 'data_go_kr'
                or policy['quota_id'] != parts[3] or policy['window_id'] != parts[4]):
            return self.reply(429, b'<Error><Code>TooManyRequests</Code></Error>', 'application/xml')
        if witness:
            start, end = map(int, witness.groups())
            authority = root / authority_key
            floor = json.loads(authority.read_bytes())['used'] if authority.is_file() else 0
            if (self.headers.get('If-None-Match') != '*'
                    or not 0 <= start < end <= min(floor, cap)
                    or type(record.get('start')) is not int or type(record.get('end')) is not int
                    or (record['start'], record['end']) != (start, end)):
                return self.reply(429, b'<Error><Code>TooManyRequests</Code></Error>', 'application/xml')
        else:
            prior = target.read_bytes() if target.is_file() else None
            if prior is None:
                expected = self.headers.get('If-None-Match') == '*'
                lower = 0
            else:
                expected = self.headers.get('If-Match') == self.quota_etag(prior)
                lower = json.loads(prior)['used']
            if not expected:
                return self.reply(412, b'<Error><Code>PreconditionFailed</Code></Error>', 'application/xml')
            if type(record.get('used')) is not int or not lower < record['used'] <= cap:
                return self.reply(429, b'<Error><Code>TooManyRequests</Code></Error>', 'application/xml')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
        return self.reply(200, b'', 'application/xml', {'ETag': self.quota_etag(body)})

    def unavailable(self, service):
        """Test fault: while <state>/fail-<service> exists, that service answers 503."""
        if (self.server.state / f'fail-{service}').exists():
            self.body()  # drain the request
            self.record(service, 'Unavailable')
            self.reply(503, b'{"__type":"ServiceUnavailableException","message":"stand-in fault"}')
            return True
        return False

    def handle_one(self):
        try:
            if self.headers.get('X-Amz-Target', '').startswith('Logs_20140328.'):
                return None if self.unavailable('logs') else self.logs()
            return self.s3()
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            return self.reply(400, json.dumps({'__type': 'StandinBadRequest', 'message': type(exc).__name__}).encode())

    do_GET = do_PUT = do_POST = do_HEAD = do_DELETE = handle_one


def valid_quota_caps(quotas):
    if type(quotas) is not dict or not quotas:
        return False
    owners = set()
    for key, cap in quotas.items():
        match = AUTHORITY.fullmatch(key)
        if not match or type(cap) is not int or not 0 <= cap <= 10_000:
            return False
        owner, window = match.groups()
        try:
            layout = 'kst-%Y%m%d' if window.startswith('kst-') else '%Y-%m-%d'
            day = datetime.strptime(window, layout).date()
        except ValueError:
            return False
        if (owner, day) in owners:
            return False
        owners.add((owner, day))
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--state', required=True, help='empty directory for received data')
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--bucket', required=True)
    parser.add_argument('--log-group', action='append', default=[])
    parser.add_argument('--data-bucket', action='append', default=[], help='an empty writable weather bucket (LP-6 check)')
    parser.add_argument('--tls-cert', help='serve HTTPS with this test certificate')
    parser.add_argument('--tls-key')
    parser.add_argument('--rehearsal-quotas', type=Path, help='private quota ceilings of a disposable rehearsal')
    args = parser.parse_args()
    quotas = None
    if args.rehearsal_quotas is not None:
        quotas = json.loads(args.rehearsal_quotas.read_bytes())
        if not valid_quota_caps(quotas):
            parser.error('invalid rehearsal quota ceilings')
    state = Path(args.state)
    state.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    if args.tls_cert:
        import ssl
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(args.tls_cert, args.tls_key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
    server.daemon_threads = True
    server.state, server.bucket, server.groups = state, args.bucket, set(args.log_group)
    server.data_buckets = set(args.data_bucket)
    server.rehearsal_quotas = quotas
    server.streams, server.lock = {}, threading.RLock()
    # Streams survive a restart of the stand-in (a host reboot), as they do on AWS.
    for group in server.groups:
        group_dir = state / 'cloudwatch' / group.strip('/')
        for path in group_dir.rglob('*.jsonl') if group_dir.exists() else []:
            server.streams.setdefault(group, set()).add(str(path.relative_to(group_dir))[:-len('.jsonl')])
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown).start())
    (state / 'ready').write_text(str(os.getpid()))
    server.serve_forever()


if __name__ == '__main__':
    main()
