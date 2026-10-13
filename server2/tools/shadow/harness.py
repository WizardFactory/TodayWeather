"""Shared S19 harness: release process, loopback peers, metrics and percentiles.

Every network target is a task-owned literal-loopback listener. Nothing here reads
an operator .env, calls a live provider, creates AWS resources or mirrors traffic.
"""
import hashlib
import http.client
import http.server
import importlib.util
import json
import math
import os
import re
import select
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

SERVER2 = Path(__file__).resolve().parents[2]
ROOT = SERVER2.parent
LISTENERS = re.compile(r'server2 public=(127\.0\.0\.1:\d+) metrics=(127\.0\.0\.1:\d+)')


def loopback(url):
    """Accept only http://127.0.0.1:<port> with no path, credentials, query or fragment."""
    target = urlsplit(url)
    if (target.scheme != 'http' or target.hostname != '127.0.0.1' or not target.port
            or target.username or target.password or target.path not in ('', '/')
            or target.query or target.fragment):
        raise ValueError('shadow tooling refuses non-loopback targets')
    return target.hostname, target.port


class Reply:
    def __init__(self, status, headers, body, elapsed_ms):
        self.status, self.headers, self.body, self.elapsed_ms = status, headers, body, elapsed_ms

    def header(self, name):
        return self.headers.get(name.lower())

    def digest(self):
        return hashlib.sha256(self.body).hexdigest()


def request(base, path, method='GET', headers=None, timeout=15):
    host, port = loopback(base)
    client = http.client.HTTPConnection(host, port, timeout=timeout)
    started = time.monotonic()
    try:
        client.request(method, path, headers=headers or {})
        reply = client.getresponse()
        merged = {}
        for key, value in reply.getheaders():
            key = key.lower()
            merged[key] = merged[key] + ', ' + value if key in merged else value
        body = reply.read()
        return Reply(reply.status, merged, body, (time.monotonic() - started) * 1000)
    finally:
        client.close()


def percentiles(samples):
    """Nearest-rank percentiles over the observed samples; no interpolation or estimate."""
    ordered = sorted(samples)
    if not ordered:
        return {'n': 0}
    rank = lambda q: ordered[max(0, math.ceil(q * len(ordered)) - 1)]
    return {'n': len(ordered), 'p50': round(rank(.5), 2), 'p95': round(rank(.95), 2),
            'p99': round(rank(.99), 2), 'max': round(ordered[-1], 2)}


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def revision():
    head = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], capture_output=True, text=True)
    dirty = subprocess.run(['git', '-C', str(ROOT), 'status', '--porcelain', '--untracked-files=no'],
                           capture_output=True, text=True)
    return {'commit': head.stdout.strip() or None, 'dirty': bool(dirty.stdout.strip()) if dirty.returncode == 0 else None}


def free_port():
    """A port that was free when checked; used to model an unreachable legacy origin."""
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        return probe.getsockname()[1]


class RecordingPeer(http.server.ThreadingHTTPServer):
    """Loopback peer with a pluggable responder, per-kind counters, hops and fault knobs."""
    daemon_threads = True
    request_queue_size = 128

    def __init__(self, responder):
        self.responder = responder
        self.lock = threading.Lock()
        self.counts = {}
        self.hops = []
        self.delay = {}
        self.fault = {}
        super().__init__(('127.0.0.1', 0), PeerHandler)
        self.thread = threading.Thread(target=self.serve_forever, daemon=True)
        self.thread.start()

    @property
    def base(self):
        return 'http://127.0.0.1:' + str(self.server_port)

    def record(self, kind, path, language):
        with self.lock:
            self.counts[kind] = self.counts.get(kind, 0) + 1
            self.hops.append((kind, path, language))

    def snapshot(self):
        with self.lock:
            return dict(self.counts), len(self.hops)

    def hops_since(self, index):
        with self.lock:
            return list(self.hops[index:])

    def close(self):
        self.shutdown()
        self.server_close()
        self.thread.join(timeout=3)

    def handle_error(self, request, client_address):
        # server2 closing a stalled or keep-alive socket is an expected test event.
        if isinstance(sys.exc_info()[1], (ConnectionError, TimeoutError)):
            return
        super().handle_error(request, client_address)


class PeerHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *_):
        pass

    def do_GET(self):
        kind, status, content_type, body = self.server.responder(self.path, self.headers)
        self.server.record(kind, self.path, self.headers.get('accept-language', ''))
        fault = self.server.fault.get(kind)
        delay = self.server.delay.get(kind, 0)
        if fault == 'hang':
            delay = max(delay, 11.0)
        elif fault == '500':
            status, content_type, body = 500, 'application/json', b'{}'
        if delay:
            time.sleep(delay)
        try:
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass


def s3_peer():
    """The S03 local S3-compatible test peer, wrapped to count every received request."""
    spec = importlib.util.spec_from_file_location('server2_local_peer', SERVER2 / 'deploy/local/peer.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    config = module.load_config(SERVER2 / 'config/local-stack.json')

    class Counting(module.Handler):
        def parse_request(self):
            accepted = super().parse_request()
            with self.server.lock:
                self.server.received += 1
            return accepted

    peer = module.make_peer('s3', config)
    peer.received = 0
    peer.RequestHandlerClass = Counting
    peer.config_values = config
    thread = threading.Thread(target=peer.serve_forever, daemon=True)
    thread.start()
    peer.base = 'http://127.0.0.1:' + str(peer.server_port)

    def close():
        peer.shutdown()
        peer.server_close()
        thread.join(timeout=3)
    peer.close = close
    return peer


class Server2:
    """The actual release binary in a restricted child environment."""

    def __init__(self, binary, env):
        self.binary = str(Path(binary).resolve())
        self.env = {'PATH': os.defpath, 'SERVER2_BIND': '127.0.0.1:0', 'SERVER2_METRICS_BIND': '127.0.0.1:0'}
        self.env.update(env)
        self.process = None

    def __enter__(self):
        self.process = subprocess.Popen([self.binary], env=self.env, stdin=subprocess.DEVNULL,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        ready, _, _ = select.select([self.process.stdout], [], [], 10)
        if not ready:
            self.kill()
            raise RuntimeError('server2 did not announce listeners within 10s')
        line = self.process.stdout.readline().strip()
        match = LISTENERS.fullmatch(line)
        if not match:
            stderr = self.process.stderr.read() if self.process.poll() is not None else ''
            self.kill()
            raise RuntimeError('unexpected server2 startup output: ' + line + ' ' + stderr.strip())
        self.public, self.private = 'http://' + match[1], 'http://' + match[2]
        return self

    def __exit__(self, *exc):
        if self.process.poll() is None:
            self.stop()
        self.kill()

    def metrics(self):
        reply = request(self.private, '/internal/metrics')
        assert reply.status == 200, reply.status
        return {name: int(value) for name, value in
                (line.split() for line in reply.body.decode().splitlines() if line)}

    def rss_kib(self):
        out = subprocess.run(['ps', '-o', 'rss=', '-p', str(self.process.pid)], capture_output=True, text=True)
        return int(out.stdout.strip()) if out.returncode == 0 and out.stdout.strip() else None

    def signal(self, number=signal.SIGTERM):
        self.process.send_signal(number)

    def stop(self, timeout=8):
        self.process.terminate()
        try:
            code = self.process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            self.kill()
            raise
        return code

    def kill(self):
        if self.process and self.process.poll() is None:
            self.process.kill()
            self.process.wait(timeout=5)
        if self.process:
            for stream in (self.process.stdout, self.process.stderr):
                if stream and not stream.closed:
                    stream.close()


def delta(after, before):
    return {key: after.get(key, 0) - before.get(key, 0) for key in set(after) | set(before)
            if after.get(key, 0) != before.get(key, 0)}


def write_report(path, report):
    if path:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) + '\n')
