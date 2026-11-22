#!/usr/bin/env python3
"""Loopback-only TEST peer for linux_check.py: the production origin and the providers.

Never a proxy and never used by a qualification host. The check points the real host
names at it through /etc/hosts and a test CA. The production origin answers 200 with a
small JSON body. Every other host (a provider) answers with the status in
<state>/provider-status (401 when absent), so a candidate with the check's synthetic
keys sees a rejected key, as a provider would answer it. Optional provider-fault.json
sets an exact apis.data.go.kr path with one status (401, 403, or 429) or delay_seconds
(up to 120, then close without sending a response). Every request is appended to
<state>/requests.jsonl as host, method and path. Separate fault-request and
fault-response logs identify injected requests and headers actually sent. The
query (which holds the key) is not kept. Response bodies carry MARKER, which
must never reach a log destination.
"""
import argparse
import ipaddress
import json
import os
import signal
import ssl
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

PRODUCTION = 'todayweather.wizardfactory.net'
DATA_GO_KR = 'apis.data.go.kr'
MARKER = 'PEER-BODY-MARKER-2983'


def provider_fault(state, path):
    try:
        fault = json.loads((state / 'provider-fault.json').read_text())
    except FileNotFoundError:
        return None
    if not isinstance(fault, dict) or set(fault) not in ({'path', 'status'}, {'path', 'delay_seconds'}):
        raise ValueError('invalid provider fault fields')
    target = fault['path']
    if not isinstance(target, str) or not target.startswith('/') or urlsplit(target).path != target:
        raise ValueError('provider fault requires an exact request path')
    if 'status' in fault:
        if type(fault['status']) is not int or fault['status'] not in (401, 403, 429):
            raise ValueError('invalid provider fault status')
    else:
        delay = fault['delay_seconds']
        if type(delay) not in (int, float) or not 0 < delay <= 120:
            raise ValueError('provider fault delay must be between 0 and 120 seconds')
    return fault if target == path else None


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *args):
        pass

    def answer(self):
        host = self.headers.get('Host', '').split(':', 1)[0].lower()
        length = int(self.headers.get('Content-Length') or 0)
        if length:
            self.rfile.read(min(length, 1024 * 1024))
        request_path = urlsplit(self.path).path
        fault = provider_fault(self.server.state, request_path) if host == DATA_GO_KR else None
        record = {'host': host, 'method': self.command, 'path': request_path}
        fault_record = record | {'injected': fault.get('status', 'stall')} if fault is not None else None
        with self.server.lock, (self.server.state / 'requests.jsonl').open('a') as stream:
            stream.write(json.dumps(record, sort_keys=True) + '\n')
            if fault_record is not None:
                with (self.server.state / 'fault-requests.jsonl').open('a') as faults:
                    faults.write(json.dumps(fault_record, sort_keys=True) + '\n')
        if host == PRODUCTION:
            status, body = 200, json.dumps({'marker': MARKER}).encode()
        else:
            if fault is None:
                path = self.server.state / 'provider-status'
                status = int(path.read_text().strip()) if path.exists() else 401
            elif 'delay_seconds' in fault:
                time.sleep(fault['delay_seconds'])
                self.close_connection = True
                return
            else:
                status = fault['status']
            body = json.dumps({'error': 'stand-in rejection', 'marker': MARKER}).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if fault_record is not None:
            with self.server.lock, (self.server.state / 'fault-responses.jsonl').open('a') as stream:
                stream.write(json.dumps(fault_record, sort_keys=True) + '\n')
        if self.command != 'HEAD':
            self.wfile.write(body)

    do_GET = do_POST = do_HEAD = do_PUT = answer


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--state', required=True)
    parser.add_argument('--address', type=ipaddress.IPv4Address, required=True)
    parser.add_argument('--port', type=int, default=443)
    parser.add_argument('--tls-cert', required=True)
    parser.add_argument('--tls-key', required=True)
    args = parser.parse_args()
    if not args.address.is_loopback:
        parser.error('--address must be an IPv4 loopback address')
    state = Path(args.state)
    state.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((str(args.address), args.port), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(args.tls_cert, args.tls_key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    server.daemon_threads = True
    server.state, server.lock = state, threading.Lock()
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown).start())
    (state / 'ready').write_text(str(os.getpid()))
    server.serve_forever()


if __name__ == '__main__':
    main()
