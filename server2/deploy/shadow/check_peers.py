#!/usr/bin/env python3
"""Loopback-only TEST peer for linux_check.py: the production origin and the providers.

Never a proxy and never used by a qualification host. The check points the real host
names at it through /etc/hosts and a test CA. The production origin answers 200 with a
small JSON body. Every other host (a provider) answers with the status in
<state>/provider-status (401 when absent), so a candidate with the check's synthetic
keys sees a rejected key, as a provider would answer it. Every request is appended to
<state>/requests.jsonl as host, method and path; the query (which holds the key) is not
kept. Response bodies carry MARKER, which must never reach a log destination.
"""
import argparse
import json
import os
import signal
import ssl
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

PRODUCTION = 'todayweather.wizardfactory.net'
MARKER = 'PEER-BODY-MARKER-2983'


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *args):
        pass

    def answer(self):
        host = self.headers.get('Host', '').split(':', 1)[0].lower()
        length = int(self.headers.get('Content-Length') or 0)
        if length:
            self.rfile.read(min(length, 1024 * 1024))
        record = {'host': host, 'method': self.command, 'path': urlsplit(self.path).path}
        with self.server.lock, (self.server.state / 'requests.jsonl').open('a') as stream:
            stream.write(json.dumps(record, sort_keys=True) + '\n')
        if host == PRODUCTION:
            status, body = 200, json.dumps({'marker': MARKER}).encode()
        else:
            path = self.server.state / 'provider-status'
            status = int(path.read_text().strip()) if path.exists() else 401
            body = json.dumps({'error': 'stand-in rejection', 'marker': MARKER}).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    do_GET = do_POST = do_HEAD = do_PUT = answer


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--state', required=True)
    parser.add_argument('--address', required=True)
    parser.add_argument('--port', type=int, default=443)
    parser.add_argument('--tls-cert', required=True)
    parser.add_argument('--tls-key', required=True)
    args = parser.parse_args()
    state = Path(args.state)
    state.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((args.address, args.port), Handler)
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
