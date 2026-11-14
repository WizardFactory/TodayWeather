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
Fault: while <state>/fail-s3 or <state>/fail-logs exists, that service answers 503.
"""
import argparse
import json
import os
import re
import signal
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

MAX_BODY = 64 * 1024 * 1024
SAFE = re.compile(r'^[A-Za-z0-9._=/\-]{1,1024}$')


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
        if 'aws-chunked' in self.headers.get('Content-Encoding', '') or self.headers.get('x-amz-decoded-content-length'):
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
        self.wfile.write(payload)

    def record(self, service, action, **fields):
        credential = re.search(r'Credential=([A-Z0-9]+)/', self.headers.get('Authorization', ''))
        entry = dict(service=service, action=action, signed=bool(self.headers.get('Authorization')),
                     key_id=credential.group(1) if credential else None, **fields)
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
                        f.write(json.dumps({'timestamp': event['timestamp'], 'message': event['message']}) + '\n')
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
        body = self.body() if self.command in ('PUT', 'POST') else b''
        self.record('s3', action, bucket=bucket, key=key,
                    content_encoding=self.headers.get('Content-Encoding'), content_type=self.headers.get('Content-Type'))
        if action != 'PutObject':
            return self.reply(403, b'<Error><Code>AccessDenied</Code></Error>', 'application/xml')
        if bucket != self.server.bucket:
            return self.reply(404, b'<Error><Code>NoSuchBucket</Code></Error>', 'application/xml')
        if not SAFE.match(key) or '..' in key.split('/'):
            return self.reply(400, b'<Error><Code>InvalidKey</Code></Error>', 'application/xml')
        target = self.server.state / 's3' / key
        with self.server.lock:
            if target.exists():
                # Distinct keys are part of the contract: an overwrite is recorded, not hidden.
                self.record('s3', 'Overwrite', bucket=bucket, key=key)
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_name('.' + target.name + '.tmp')  # readers never see a partial object
            temporary.write_bytes(body)
            temporary.replace(target)
        return self.reply(200, b'', 'application/xml', {'ETag': '"standin"'})

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
            return None if self.unavailable('s3') else self.s3()
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            return self.reply(400, json.dumps({'__type': 'StandinBadRequest', 'message': type(exc).__name__}).encode())

    do_GET = do_PUT = do_POST = do_HEAD = do_DELETE = handle_one


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--state', required=True, help='empty directory for received data')
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--bucket', required=True)
    parser.add_argument('--log-group', action='append', default=[])
    parser.add_argument('--tls-cert', help='serve HTTPS with this test certificate')
    parser.add_argument('--tls-key')
    args = parser.parse_args()
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
    server.streams, server.lock = {}, threading.Lock()
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
