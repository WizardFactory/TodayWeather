#!/usr/bin/env python3
"""Owned-loopback nginx/release deadline rehearsal. Never installs or switches a host."""
import argparse
import base64
from contextlib import contextmanager
import hashlib
import http.client
import http.server
import threading
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(ROOT / 'tools/shadow'))
import native_suite
import harness
import gateway_family as gateway

TEMPLATE = ROOT / 'deploy/cutover/nginx.conf.template'
CHECK = native_suite.Check('proxy-deadline', 'gateway', 'owned-nginx-release',
                           ('server2', 'loopback_server'), 120, 'Local injected roots only')


def render(template, listen, upstream, pid):
    for port in (listen, upstream):
        if type(port) is not int or not 1024 <= port <= 65535:
            raise ValueError('explicit unprivileged loopback ports required')
    if listen == upstream:
        raise ValueError('distinct listeners required')
    pid = Path(pid)
    if (not pid.is_absolute() or '..' in pid.parts or
            any(character in str(pid) for character in '\\"$;{}\r\n\0')):
        raise ValueError('unambiguous absolute owned workspace required')
    text = template
    for key, value in {'LISTEN_PORT': listen, 'UPSTREAM_PORT': upstream,
                       'PID': pid, 'WORKSPACE': pid.parent}.items():
        text = text.replace('{{' + key + '}}', str(value))
    if '{{' in text or '}}' in text:
        raise ValueError('unresolved configuration token')
    return text


@contextmanager
def proxy(nginx, upstream, log, workspace):
    port = harness.free_port()
    while port == upstream:
        port = harness.free_port()
    config = workspace / 'nginx.conf'
    config.write_text(render(TEMPLATE.read_text(), port, upstream, workspace / 'nginx.pid'))
    command = [str(nginx), '-e', 'stderr', '-p', str(workspace) + '/', '-c', str(config)]
    environment = native_suite.child_environment()
    with log.open('w') as output:
        subprocess.run(command + ['-t'], env=environment, stdout=output,
                       stderr=subprocess.STDOUT, check=True, timeout=10)
        process = subprocess.Popen(command, env=environment, stdin=subprocess.DEVNULL,
                                   stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            def ready():
                if process.poll() is not None:
                    raise RuntimeError('owned proxy exited before readiness')
                try:
                    return harness.request('http://127.0.0.1:' + str(port), '/health', timeout=1).status == 200
                except (OSError, http.client.HTTPException):
                    return False
            harness.wait_until(ready, 5, 'owned proxy did not become ready')
            yield port
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)


def late_request(port):
    client = http.client.HTTPConnection('127.0.0.1', port, timeout=15)
    try:
        client.request('GET', '/health')
        response = client.getresponse()
        assert response.status == 200 and response.read() == b'OK', 'health contract changed'
        assert client.sock is not None, 'first response closed the client connection'
        original = client.sock
        local = original.getsockname()
        time.sleep(4)
        started = time.monotonic()
        client.request('GET', gateway.WEATHER_KR, headers=gateway.KO)
        response = client.getresponse()
        body = response.read()
        elapsed = round((time.monotonic() - started) * 1000, 2)
        same = client.sock is original and client.sock.getsockname() == local
        return dict(status=response.status, headers={k.lower(): v for k, v in response.getheaders()},
                    body=body, elapsed_ms=elapsed, same_frontend_socket=same, start_age_seconds=4)
    finally:
        client.close()



def transport_probe(nginx, out):
    """Fixed transport doubles: preserve mutation bodies/auth and never retry a 503."""
    received = []
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def respond(self):
            body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
            if self.path == '/health':
                status, answer = 200, b'OK'
            else:
                received.append((self.command, self.path, body, self.headers.get('Authorization')))
                status, answer = (204, b'') if self.command == 'OPTIONS' else (304, b'') if self.headers.get('If-None-Match') == '"fixture"' else (503, b'fixture unavailable')
            self.send_response(status)
            self.send_header('Content-Length', str(len(answer)))
            self.send_header('Cache-Control', 'public, max-age=300' if status == 304 else 'no-store')
            self.send_header('ETag', '"fixture"')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(answer)
        do_GET = do_POST = do_PUT = do_DELETE = do_OPTIONS = respond
    peer = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    peer.daemon_threads = True
    thread = threading.Thread(target=peer.serve_forever, daemon=True)
    thread.start()
    # Exceed nginx's default client-body buffer, exercising the owned temp path.
    cases = [('POST', '/v000902/push-list', b'synthetic-post-' * 8192),
             ('PUT', '/v000902/push', b'synthetic-put'),
             ('DELETE', '/v000902/push', b'synthetic-delete'),
             ('OPTIONS', '/v000902/push', b''),
             ('GET', '/v000903/notice/latest', b'')]
    try:
        with tempfile.TemporaryDirectory(prefix='server2-s20c-wire-') as directory:
            with proxy(nginx, peer.server_port, out / 'nginx-transport.log', Path(directory)) as port:
                client = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
                try:
                    for method, path, body in cases:
                        headers = {'Authorization': 'Bearer synthetic-fixture'}
                        if method == 'GET':
                            headers['If-None-Match'] = '"fixture"'
                        before = len(received)
                        client.request(method, path, body=body, headers=headers)
                        response = client.getresponse()
                        answer = response.read()
                        expected = 204 if method == 'OPTIONS' else 304 if method == 'GET' else 503
                        assert response.status == expected, 'proxy substituted fixture status'
                        assert response.getheader('Access-Control-Allow-Origin') == '*'
                        assert response.getheader('ETag') == '"fixture"'
                        assert response.getheader('Cache-Control') == ('public, max-age=300' if expected == 304 else 'no-store')
                        assert answer == (b'fixture unavailable' if expected == 503 else b'')
                        assert received[before:] == [(method, path, body, 'Bearer synthetic-fixture')], 'proxy changed or retried a mutation'
                finally:
                    client.close()
        return dict(cases=5, mutation_503_attempts=3, options_status=204, conditional_status=304,
                    largest_body_bytes=max(len(body) for _, _, body in cases),
                    bodies_and_authorization_preserved=True, cors_and_etag_preserved=True,
                    layer='owned transport doubles, not product mutation evidence')
    finally:
        peer.shutdown()
        peer.server_close()
        thread.join(timeout=3)


def run(artifacts, nginx, out):
    frozen = gateway.Frozen(gateway._json(gateway.REPLAY_FIXTURE))
    context = gateway.Context(artifacts['artifacts']['server2']['path'], frozen)
    results = {'transport': transport_probe(nginx, out)}
    try:
        for label in ('direct-control', 'nginx-candidate'):
            with context.process('native') as process:
                assert gateway.get(process, gateway.WEATHER_KR, gateway.KO).status == 200
                context.peers.set('backend', fault='hang')
                before_metrics, before_peers = context.observe(process)
                try:
                    if label == 'direct-control':
                        try:
                            value = late_request(int(process.public.rsplit(':', 1)[1]))
                            results[label] = dict(connection_closed=False, status=value['status'],
                                                  elapsed_ms=value['elapsed_ms'])
                        except (OSError, http.client.HTTPException) as error:
                            results[label] = dict(connection_closed=True, error_class=type(error).__name__)
                    else:
                        with tempfile.TemporaryDirectory(prefix='server2-s20c-proxy-') as directory:
                            with proxy(nginx, int(process.public.rsplit(':', 1)[1]),
                                       out / 'nginx.log', Path(directory)) as port:
                                value = late_request(port)
                        metrics, peers = gateway.changes(process, context, (before_metrics, before_peers))
                        oracle = gateway.oracle_cases()[gateway.DEADLINE_ORACLE]
                        assert value['status'] == oracle['status'] == 501, 'deadline status changed'
                        assert value['body'] == base64.b64decode(oracle['body_base64']), 'deadline body changed'
                        # nginx owns Server and downstream transport headers; gateway functional headers stay exact.
                        transport = set(gateway.TRANSPORT_HEADERS) | {'server'}
                        expected = {k: v for k, v in oracle['headers'] if k not in transport}
                        actual = {k: v for k, v in value['headers'].items() if k not in transport}
                        assert actual == expected, 'deadline functional headers changed'
                        assert value['headers'].get('cache-control') == 'no-store'
                        assert value['same_frontend_socket'], 'client connection was replaced'
                        assert 8500 <= value['elapsed_ms'] <= 10500, 'wrong gateway deadline'
                        assert peers.get('backend') == 3, 'proxy retried or changed backend attempts'
                        assert metrics.get(gateway.GW + 'responses_dependency_error_total') == 1
                        assert not metrics.get(gateway.GW + 'abandoned_total'), 'response was abandoned'
                        value['body_sha256'] = hashlib.sha256(value.pop('body')).hexdigest()
                        results[label] = dict(value, backend_attempts=peers['backend'],
                                              gateway_dependency_errors=1, abandoned=0)
                finally:
                    context.peers.set('backend')
                assert process.stop() == 0, 'unclean owned server2 stop'
    finally:
        context.close()
    return results


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--nginx', type=Path, required=True)
    parser.add_argument('--nginx-sha256', required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args(argv)
    out = args.out.resolve()
    if out == ROOT or ROOT in out.parents or out.exists():
        parser.error('new output outside server2 required')
    out.mkdir(parents=True)
    report = dict(schema=1, verdict='BLOCKED', scope='owned-loopback late-request deadline only',
                  started_at_utc=native_suite.utc(), live_actions=False, production_eligible=False,
                  limitations=['Actual nginx and release loopback_server with injected S3/provider roots.',
                               'Recorded backend is a frozen legacy HTTP double; not native-only whole-service proof.',
                               'Host placement is not attested by this report; record it separately.',
                               'No TLS/CloudFront, deployment, quota, shadow or device evidence.'])
    code = 2
    try:
        artifacts = native_suite.load_artifacts(args.artifacts, [CHECK])
        nginx = args.nginx.resolve()
        if not nginx.is_file() or not os.access(nginx, os.X_OK) or native_suite.sha256(nginx) != args.nginx_sha256:
            raise ValueError('explicit owned nginx executable hash mismatch')
        report.update(artifacts=artifacts, nginx_sha256=args.nginx_sha256,
                      template_sha256=native_suite.sha256(TEMPLATE), tool_sha256=native_suite.sha256(__file__))
        version = subprocess.run([str(nginx), '-v'], capture_output=True, text=True,
                                 env=native_suite.child_environment(), check=True, timeout=5)
        report['nginx_version'] = version.stderr.strip()
        report['verdict'] = 'RUNNING'
        report['scenarios'] = run(artifacts, nginx, out)
        # Recheck executable bytes after all owned processes stop.
        for name, artifact in artifacts['artifacts'].items():
            native_suite.verify_artifact(name, artifact)
        assert native_suite.sha256(nginx) == args.nginx_sha256
        report['verdict'] = 'PASS'
        code = 0
    except Exception as error:
        code = 1 if report['verdict'] == 'RUNNING' else 2
        report['verdict'] = 'FAIL' if code == 1 else 'BLOCKED'
        report['error_class'] = type(error).__name__
    finally:
        report['finished_at_utc'] = native_suite.utc()
        (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(report['verdict'] + ' local reused-client deadline; production_eligible=false')
    return code

if __name__ == '__main__':
    sys.exit(main())
