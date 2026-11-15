#!/usr/bin/env python3
"""TEST stand-in for EC2 instance metadata (IMDSv2), for disposable-VM checks only.

Serves the token, instance-id, instance-life-cycle and instance-role credentials, so the
collector's identity and the AWS SDK's credential chain work as on EC2 without any static
key on the host. Values are read from files in --state on every request, so a check can
change the instance ID (a "replacement instance") without restarting the stand-in:

  <state>/instance-id, <state>/life-cycle   current values
  <state>/instance-action                   Spot interruption notice JSON (absent: 404, as on EC2)
  <state>/requests.jsonl                    one line per request (path and token use)

Bind it to 169.254.169.254:80 (add the address to the loopback interface first).
"""
import argparse
import datetime
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

TOKEN = 'standin-imds-token'
ROLE = 'tw-server2-runtime'


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def value(self, name, default):
        try:
            return (self.server.state / name).read_text().strip() or default
        except FileNotFoundError:
            return default

    def record(self, **fields):
        with self.server.lock, open(self.server.state / 'requests.jsonl', 'a') as f:
            f.write(json.dumps(dict(method=self.command, path=self.path, **fields), sort_keys=True) + '\n')

    def reply(self, status, body=b'', content_type='text/plain', headers=None):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_PUT(self):
        ttl = self.headers.get('X-aws-ec2-metadata-token-ttl-seconds')
        ok = self.path == '/latest/api/token' and ttl
        self.record(token_request=True)
        # EC2 echoes the TTL; the AWS SDK's metadata client reads it from the response.
        self.reply(200 if ok else 400, TOKEN.encode() if ok else b'',
                   headers={'X-aws-ec2-metadata-token-ttl-seconds': ttl} if ok else None)

    def do_GET(self):
        if self.headers.get('X-aws-ec2-metadata-token') != TOKEN:  # IMDSv2 only
            self.record(token=False)
            return self.reply(401)
        self.record(token=True)
        expiration = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=6)).strftime('%Y-%m-%dT%H:%M:%SZ')
        routes = {
            '/latest/meta-data/instance-id': self.value('instance-id', 'i-0123456789abcdef0'),
            '/latest/meta-data/instance-life-cycle': self.value('life-cycle', 'on-demand'),
            '/latest/meta-data/iam/security-credentials/': ROLE,
            '/latest/meta-data/iam/security-credentials': ROLE,
            f'/latest/meta-data/iam/security-credentials/{ROLE}': json.dumps({
                'Code': 'Success', 'Type': 'AWS-HMAC', 'AccessKeyId': 'ASIASTANDIN', 'SecretAccessKey': 'standin-secret',
                'Token': 'standin-session', 'Expiration': expiration, 'LastUpdated': expiration}),
            '/latest/meta-data/placement/region': 'ap-northeast-2',
            '/latest/dynamic/instance-identity/document': json.dumps({'region': 'ap-northeast-2'}),
        }
        # Spot interruption notice (LP-4): present only while <state>/instance-action exists.
        notice = self.value('instance-action', '')
        if notice:
            routes['/latest/meta-data/spot/instance-action'] = notice
        body = routes.get(self.path)
        if body is None:
            return self.reply(404)
        return self.reply(200, body.encode())


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--state', required=True)
    parser.add_argument('--address', default='169.254.169.254')
    parser.add_argument('--port', type=int, default=80)
    args = parser.parse_args()
    state = Path(args.state)
    state.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((args.address, args.port), Handler)
    server.daemon_threads = True
    server.state, server.lock = state, threading.Lock()
    (state / 'ready').write_text(str(os.getpid()))
    server.serve_forever()


if __name__ == '__main__':
    main()
