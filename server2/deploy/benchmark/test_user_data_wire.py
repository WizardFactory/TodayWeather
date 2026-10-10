"""EC2 user-data regression: actual CLI Query wire, never an AWS endpoint.

Use run_user_data_wire.py for the installed CLI, run_isolated.py for unit tests.
The audit policy is installed and proved before importing operational code.
"""
import base64
import gzip
import http.server
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.parse

assert os.environ.get('S09_ISOLATED') == '1', 'use a maintained isolation launcher'
assert not Path('/sys').exists() and not Path('/run/systemd').exists()
assert not Path('/root/.aws').exists()
assert 'CapEff:\t0000000000000000' in Path('/proc/self/status').read_text()
CLI = os.environ.get('S09_WIRE_CLI', '')
if CLI:
    assert CLI == '/cli/aws'
    assert {name for _, name in socket.if_nameindex()} == {'lo'}

    def audit(event, args):
        if event == 'subprocess.Popen':
            command = args[1]
            allowed = (args[0] == CLI and command[0] == CLI and
                (command[1:] == ['--version'] or
                 ('--endpoint-url' in command and 'run-instances' in command and
                  command[command.index('--endpoint-url')+1].startswith('http://127.0.0.1:'))))
            if not allowed:
                raise PermissionError('wire oracle subprocess denied')
        if event in ('os.system', 'os.exec', 'os.posix_spawn'):
            raise PermissionError('wire oracle process escape denied')
    sys.addaudithook(audit)
    try:
        subprocess.run(['/usr/bin/true'], check=True)
    except PermissionError:
        print('AUDIT unexpected executable blocked before operational import', flush=True)
    else:
        raise AssertionError('audit not enforced')

import aws_operator as op


def controller(directory, runner):
    root = Path(__file__).resolve().parents[3]
    declaration = json.loads((root/'server2/config/tasks/S09.json').read_text())
    paths = declaration['server2_paths'] + [item['path'] for item in declaration['outside']]
    assert len(paths) == len(set(paths)), 'source declaration must be unique'
    paths = sorted(paths)
    config = dict(op.FIXED, source_revision='a'*40, rustup_sha256='b'*64,
        rustup_url='https://static.rust-lang.org/rustup/archive/1.29.1/x86_64-unknown-linux-gnu/rustup-init',
        source_files={p: op.digest((root/p).read_bytes()) for p in paths})
    state = op.State.create(Path(directory)/'state.json', {'nonce':'d'*64,
        'readiness_key':'e'*64, 'client_token':'s09-wire-offline', 'deadline_ms':op.EXPIRY})
    return op.Operator(config, state, runner, clock=lambda:op.EXPIRY-7200000)


@unittest.skipUnless(CLI, 'installed CLI wire check requires run_user_data_wire.py')
class InstalledWireTests(unittest.TestCase):
    def test_actual_rendered_payload_is_encoded_exactly_once(self):
        self.check_wire()

    def test_exact_limit_gzip_padding_is_encoded_exactly_once(self):
        self.check_wire(pad_to_limit=True)

    def check_wire(self, pad_to_limit=False):
        captured = []
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, format, *args): pass
            def do_POST(self):
                length = int(self.headers['Content-Length'])
                if length > 131072:
                    self.send_error(413); return
                body = self.rfile.read(length)
                captured.append(urllib.parse.parse_qs(body.decode(), strict_parsing=True))
                response = b'<RunInstancesResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/"><requestId>offline</requestId><instancesSet><item><instanceId>i-0123456789abcdef0</instanceId></item></instancesSet></RunInstancesResponse>'
                self.send_response(200)
                self.send_header('Content-Length', str(len(response)))
                self.end_headers(); self.wfile.write(response)
        with tempfile.TemporaryDirectory() as directory:
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            endpoint = 'http://127.0.0.1:'+str(server.server_port)
            env = dict(os.environ, AWS_CONFIG_FILE='/nonexistent',
                AWS_SHARED_CREDENTIALS_FILE='/nonexistent', AWS_ACCESS_KEY_ID='offline',
                AWS_SECRET_ACCESS_KEY='offline', AWS_EC2_METADATA_DISABLED='true',
                AWS_MAX_ATTEMPTS='1', AWS_PAGER='', AWS_CLI_AUTO_PROMPT='off')
            seen_paths = []
            class Runner:
                def call(inner, service, action, args):
                    self.assertEqual((service, action), ('ec2', 'run-instances'))
                    value = args[args.index('--user-data')+1]
                    if value.startswith('fileb://'):
                        path = Path(value[8:]); seen_paths.append(path)
                        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                        self.assertEqual(path.read_bytes(), payload)
                    command = [CLI, '--region', 'ap-northeast-2', '--no-cli-pager',
                        '--no-paginate', '--cli-connect-timeout', '1', '--cli-read-timeout', '4',
                        '--cli-binary-format', 'base64', '--endpoint-url', endpoint,
                        service, action] + args + ['--output', 'json']
                    result = subprocess.run(command, env=env, capture_output=True, timeout=10)
                    self.assertEqual(result.returncode, 0, result.stderr.decode())
                    return json.loads(result.stdout)
            try:
                version = subprocess.run([CLI, '--version'], env=env, capture_output=True, check=True).stdout.decode().strip()
                instance = controller(directory, Runner())
                payload = instance.render_bootstrap()
                if pad_to_limit:
                    # Legal gzip zero padding exercises the exact decoded service cap.
                    payload += b'\0' * (16384-len(payload))
                    self.assertEqual(len(payload), 16384)
                plain = gzip.decompress(payload)
                self.assertIn(b'nft -c', plain)
                self.assertIn(b'git checkout --detach', plain)
                self.assertNotIn(b'@@', plain)
                self.assertEqual(instance.launch_once('sg-0123456789abcdef0', payload), 'i-0123456789abcdef0')
                self.assertEqual(len(captured), 1)
                self.assertEqual(captured[0]['Action'], ['RunInstances'])
                wire = captured[0]['UserData'][0]
                decoded = base64.b64decode(wire, validate=True)
                print(json.dumps({'cli':version, 'payload_bytes':len(payload),
                    'wire_bytes':len(wire), 'decoded_once_bytes':len(decoded),
                    'plain_bytes':len(plain), 'payload_sha256':op.digest(payload),
                    'wire_sha256':op.digest(wire.encode()), 'exact_once':decoded == payload,
                    'requests':len(captured), 'actual_AWS_calls':0}), flush=True)
                self.assertEqual(decoded, payload, 'one base64 decode must recover exact gzip bytes')
                self.assertLessEqual(len(decoded), 16384)
                self.assertLessEqual(len(wire), 25600)
                self.assertEqual(gzip.decompress(decoded), plain)
                self.assertTrue(seen_paths, 'production launch must use a private binary file')
                self.assertTrue(all(not p.exists() for p in seen_paths), 'temporary payload leaked')
            finally:
                server.shutdown(); server.server_close(); thread.join(timeout=2)


class PayloadBoundaryTests(unittest.TestCase):
    def test_oversize_and_nonbytes_never_dispatch_or_mark_launch(self):
        for payload in (b'x'*16385, 'text', bytearray(b'x'), None):
            with self.subTest(kind=type(payload).__name__), tempfile.TemporaryDirectory() as directory:
                class Deny:
                    def call(self, *args):
                        raise AssertionError('invalid payload reached runner')
                instance = controller(directory, Deny())
                with self.assertRaisesRegex(op.OperatorError, 'launch payload boundary'):
                    instance.launch_once('sg-0123456789abcdef0', payload)
                self.assertNotIn('launch_attempted', instance.state.data)
                self.assertEqual(instance.calls, 0)

    def test_exact_decoded_limit_private_file_and_error_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            instance = controller(directory, None)
            payload = bytes(range(256))*64
            self.assertEqual(len(payload), 16384)
            self.assertLessEqual(len(base64.b64encode(payload)), 25600)
            with instance.launch_arguments('sg-0123456789abcdef0', payload) as args:
                value = args[args.index('--user-data')+1]
                self.assertTrue(value.startswith('fileb://'))
                path = Path(value[8:])
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                self.assertEqual(path.read_bytes(), payload)
            self.assertFalse(path.exists())
            with self.assertRaisesRegex(RuntimeError, 'simulated CLI failure'):
                with instance.launch_arguments('sg-0123456789abcdef0', payload) as args:
                    path = Path(args[args.index('--user-data')+1][8:])
                    raise RuntimeError('simulated CLI failure')
            self.assertFalse(path.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
