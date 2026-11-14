#!/usr/bin/env python3
"""Offline behavioral checks using real loopback peers; no provider credentials."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from types import SimpleNamespace
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools' / 'shadow'))
import paired_read as capture

PATH = '/weather/v000903/coord/37.566,126.978'


def manifest(duration=2, cases=None):
    return dict(schema=1, duration_seconds=duration, max_attempts=10, min_spacing_seconds=1,
                candidate_sha256=capture.digest(b'fixture binary'), cases=cases or [
                    dict(id='seoul', method='GET', path=PATH, interval_seconds=100, conditional=False)])


class Peer:
    def __init__(self, status=200, body=b'{"source":"fixture"}', delay=0, etag='"fixture"'):
        self.requests = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                owner.requests.append((self.command, self.path, dict(self.headers)))
                if delay:
                    time.sleep(delay)
                self.send_response(status)
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Set-Cookie', 'private-secret')
                self.send_header('Location', 'http://127.0.0.1:1/gather/forbidden')
                if etag:
                    self.send_header('ETag', etag)
                self.end_headers()
                if self.command != 'HEAD':
                    try:
                        self.wfile.write(body)
                    except (BrokenPipeError, ConnectionResetError):
                        pass

            do_HEAD = do_GET

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f'http://127.0.0.1:{self.server.server_port}'

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()


class PairedReadTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        self.binary = self.path / 'candidate'
        self.binary.write_bytes(b'fixture binary')
        self.lockfile = open(self.path / 'worker.lock', 'w')
        self.addCleanup(self.lockfile.close)

    def peer(self, **kwargs):
        p = Peer(**kwargs)
        self.addCleanup(p.close)
        return p

    def identity(self, m=None):
        return {'manifest': m or manifest(), 'candidate': 'http://127.0.0.1:1',
                'production': 'http://127.0.0.1:2', 'loopback_test': True,
                'sampler_sha256': capture.digest(Path(capture.__file__).read_bytes())}

    def ledger(self, m=None):
        state = self.path / 'run'
        state.mkdir(mode=0o700)
        ledger = capture.Ledger(state, self.identity(m), False)
        self.addCleanup(ledger.close)
        return ledger

    def test_manifest_rejects_routes_methods_types_and_caps(self):
        for mutation in (
            lambda m: m['cases'][0].update(path='/gather/town'),
            lambda m: m['cases'][0].update(path=PATH+'?token=secret'),
            lambda m: m['cases'][0].update(method='POST'),
            lambda m: m['cases'][0].update(conditional=1),
            lambda m: m.update(duration_seconds=604801),
            lambda m: m.update(max_attempts=6001),
            lambda m: m.update(min_spacing_seconds=0),
            lambda m: m.update(duration_seconds=True),
            lambda m: m.update(duration_seconds=30),
        ):
            m = manifest()
            mutation(m)
            # The last mutation alone is valid; create more than the permitted planned attempts.
            if m['duration_seconds'] == 30:
                m['cases'][0]['interval_seconds'] = 1
            with self.assertRaises(ValueError):
                capture.validate(m, 'http://127.0.0.1:80', capture.PRODUCTION)
        for origin in ('http://localhost:80', 'http://127.0.0.1:80/', 'http://127.0.0.1:0',
                       'http://user@127.0.0.1:80', 'https://127.0.0.1:80'):
            with self.assertRaises(ValueError):
                capture.validate(manifest(), origin, capture.PRODUCTION)
        with self.assertRaises(ValueError):
            capture.validate(manifest(), 'http://127.0.0.1:80', 'https://other.invalid')
        with self.assertRaises(ValueError):
            capture.validate(manifest(), 'http://127.0.0.1:80', capture.PRODUCTION, True)

    def test_cli_dry_run_does_not_create_state_or_touch_peer(self):
        p = self.peer()
        mp = self.path / 'manifest.json'
        mp.write_text(json.dumps(manifest()))
        state = self.path / 'dry-state'
        result = subprocess.run([sys.executable, capture.__file__, '--manifest', str(mp),
                                 '--candidate', p.origin, '--state', str(state)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['planned_attempts_per_origin'], 1)
        self.assertFalse(state.exists())
        self.assertEqual(p.requests, [])

    def test_two_origins_capture_distinct_bodies_without_cookies(self):
        a, b = self.peer(body=b'candidate'), self.peer(body=b'production')
        state = self.path / 'capture'
        result = capture.execute(manifest(), a.origin, b.origin, state, self.binary, loopback_test=True)
        self.assertEqual(result['attempts'], {'candidate': 1, 'production': 1})
        self.assertEqual(result['qualification'], 'not assessed')
        for ident, body in ((1, b'candidate'), (2, b'production')):
            self.assertEqual((state / f'{ident}.body').read_bytes(), body)
            record = json.loads((state / f'{ident}.json').read_text())
            self.assertEqual(record['body_sha256'], capture.digest(body))
            self.assertNotIn('set-cookie', record['headers'])
            self.assertNotIn('location', record['headers'])
        self.assertEqual(len(a.requests), 1)
        self.assertEqual(len(b.requests), 1)
        with self.assertRaises(ValueError):
            capture.execute(manifest(), a.origin, b.origin, state, self.binary, True, True)

    def test_head_has_no_response_body(self):
        peer = self.peer(body=b'should not be read')
        case = manifest()['cases'][0]
        case['method'] = 'HEAD'
        result = capture.capture(peer.origin, case, {}, self.path, 1, 2, self.lockfile.fileno())
        self.assertEqual(result['status'], 200)
        self.assertEqual((self.path / '1.body').read_bytes(), b'')
        self.assertEqual(peer.requests[0][0], 'HEAD')

    def test_redirect_and_auth_quota_stop_without_contacting_second_origin(self):
        for status in (302, 401, 403, 429):
            with self.subTest(status=status):
                a, b = self.peer(status=status), self.peer()
                state = self.path / f'stop-{status}'
                result = capture.execute(manifest(), a.origin, b.origin, state, self.binary, loopback_test=True)
                self.assertEqual(result['attempts'], {'candidate': 1})
                self.assertEqual(len(a.requests), 1)
                self.assertEqual(b.requests, [])
                self.assertEqual(result['terminal'], 'redirect' if status == 302 else f'http-{status}')

    def test_deadline_and_body_limit(self):
        slow = self.peer(delay=2)
        started = time.monotonic()
        result = capture.capture(slow.origin, manifest()['cases'][0], {}, self.path, 1, .4, self.lockfile.fileno())
        self.assertEqual(result['error'], 'deadline')
        self.assertLess(time.monotonic()-started, 1.5)
        large = self.peer(body=b'x' * (capture.MAX_BODY + 1))
        result = capture.capture(large.origin, manifest()['cases'][0], {}, self.path, 2, 3, self.lockfile.fileno())
        self.assertEqual(result['error'], 'oversize')
        self.assertEqual((self.path/'2.body').stat().st_size, capture.MAX_BODY)

    def test_durable_reservation_identity_cap_and_expiry(self):
        m = manifest(duration=100)
        m['max_attempts'] = 1
        ledger = self.ledger(m)
        case = m['cases'][0]
        self.assertTrue(ledger.claim_slot(case, 0))
        ident = ledger.reserve(case, 0, 'candidate')
        # Another SQLite connection can see admission before any HTTP call or result.
        with sqlite3.connect(ledger.path / 'ledger.sqlite3') as db:
            self.assertEqual(db.execute('SELECT count(*) FROM attempts WHERE result IS NULL').fetchone()[0], 1)
        restored = capture.Ledger(ledger.path, self.identity(m), True)
        self.addCleanup(restored.close)
        self.assertFalse(restored.claim_slot(case, 0))
        self.assertEqual(restored.summary()['pending'], 1)
        self.assertIsNone(restored.reserve(case, 1, 'candidate'))
        self.assertEqual(restored.get('terminal'), 'attempt-cap')
        self.assertEqual(ident, 1)
        changed = self.identity(m)
        changed['candidate'] = 'http://127.0.0.1:3'
        with self.assertRaises(ValueError):
            capture.Ledger(ledger.path, changed, True)

    def test_rollback_and_expiry(self):
        ledger = self.ledger()
        with patch.object(capture.time, 'time', return_value=ledger.get('started') - 1):
            with self.assertRaisesRegex(ValueError, 'backwards'):
                ledger.clock()
        self.assertEqual(ledger.get('terminal'), 'clock-rollback')
        with ledger.db:
            ledger.put('terminal', None)
        with patch.object(capture.time, 'time', return_value=ledger.end + 1):
            self.assertIsNone(ledger.clock())
        self.assertEqual(ledger.get('terminal'), 'duration-complete')

    def test_transport_failure_count_survives_resume_and_other_origin_success(self):
        m = manifest(duration=100)
        ledger = self.ledger(m)
        case = m['cases'][0]
        start = ledger.get('started')
        for slot, origin in enumerate(('candidate', 'production', 'candidate')):
            with patch.object(capture.time, 'time', return_value=start+slot+1):
                ident = ledger.reserve(case, slot, origin)
            ledger.finish(ident, {'error': 'ConnectionRefusedError'} if origin == 'candidate' else {'status': 200})
        resumed = capture.Ledger(ledger.path, self.identity(m), True)
        self.addCleanup(resumed.close)
        with patch.object(capture.time, 'time', return_value=start+4):
            ident = resumed.reserve(case, 3, 'candidate')
        resumed.finish(ident, {'error': 'ConnectionRefusedError'})
        self.assertEqual(resumed.get('terminal'), 'consecutive-failures')
        self.assertEqual(resumed.get('failures'), {'candidate': 3, 'production': 0})
        with self.assertRaisesRegex(ValueError, 'admitted'):
            resumed.finish(99, {'status': 200})

    def test_validator_bound_to_origin_path_and_get(self):
        ledger = self.ledger(manifest(duration=100))
        case = manifest()['cases'][0]
        ident = ledger.reserve(case, 0, 'candidate')
        ledger.finish(ident, {'status': 200, 'headers': {'etag': '"candidate"'}})
        self.assertEqual(ledger.validator('candidate', PATH), {'If-None-Match': '"candidate"'})
        self.assertIsNone(ledger.validator('production', PATH))
        self.assertIsNone(ledger.validator('candidate', PATH+'other'))
        ledger.finish(ident, {'status': 200, 'headers': {'etag': 'bad\r\ninjected: yes'}})
        self.assertIsNone(ledger.validator('candidate', PATH))

    def test_missing_validator_is_skipped_without_extra_get(self):
        a, b = self.peer(), self.peer()
        m = manifest(duration=1)
        m['cases'][0]['conditional'] = True
        result = capture.execute(m, a.origin, b.origin, self.path/'conditional', self.binary, loopback_test=True)
        self.assertEqual(result['attempts'], {})
        self.assertEqual(result['skipped_conditionals'], 2)
        self.assertEqual(a.requests+b.requests, [])

    def test_conditional_uses_prior_validator_on_wire(self):
        a, b = self.peer(etag='"left"'), self.peer(etag='"right"')
        m = manifest(duration=5)
        conditional = dict(m['cases'][0], id='conditional', conditional=True)
        m['cases'].append(conditional)
        result = capture.execute(m, a.origin, b.origin, self.path/'validators', self.binary, loopback_test=True)
        self.assertEqual(result['attempts'], {'candidate': 2, 'production': 2})
        self.assertNotIn('If-None-Match', a.requests[0][2])
        self.assertEqual(a.requests[1][2]['If-None-Match'], '"left"')
        self.assertEqual(b.requests[1][2]['If-None-Match'], '"right"')

    def test_killed_coordinator_cannot_overlap_outstanding_child_on_resume(self):
        a, b = self.peer(delay=2), self.peer()
        m = manifest(duration=5)
        mp = self.path/'crash.json'
        mp.write_text(json.dumps(m))
        state = self.path/'crash-state'
        command = [sys.executable, capture.__file__, '--manifest', str(mp), '--candidate', a.origin,
                   '--production', b.origin, '--loopback-test', '--execute', '--state', str(state),
                   '--candidate-binary', str(self.binary)]
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            until = time.monotonic()+5
            while not a.requests and time.monotonic() < until:
                time.sleep(.02)
            self.assertEqual(len(a.requests), 1)
            process.kill()
            process.wait(timeout=3)
            overlap = subprocess.run(command+['--resume'], capture_output=True, text=True, timeout=3)
            self.assertNotEqual(overlap.returncode, 0)
            self.assertIn('temporarily unavailable', overlap.stderr)
            process.communicate(timeout=3)
            resumed = subprocess.run(command+['--resume'], capture_output=True, text=True, timeout=6)
            self.assertEqual(resumed.returncode, 0, resumed.stderr)
            result = json.loads(resumed.stdout)
            self.assertEqual(result['pending'], 1)
            self.assertEqual(result['attempts'], {'candidate': 1})
            self.assertEqual(len(a.requests), 1)
            self.assertEqual(len(b.requests), 0)
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()

    def test_one_failing_origin_stops_despite_healthy_peer(self):
        # GEM-BS-001: no shared counter reset by the other origin's success.
        for failing in ('candidate', 'production'):
            with self.subTest(failing=failing):
                a = self.peer(status=500 if failing == 'candidate' else 200)
                b = self.peer(status=503 if failing == 'production' else 200)
                m = manifest(duration=8)
                m['cases'][0]['interval_seconds'] = 1
                result = capture.execute(m, a.origin, b.origin, self.path/('run-'+failing),
                                         self.binary, loopback_test=True)
                self.assertEqual(result['terminal'], 'consecutive-failures')
                self.assertEqual(result['attempts'][failing], 3)
                self.assertEqual(len(a.requests), 3)
                self.assertEqual(len(b.requests), 2 if failing == 'candidate' else 3)

    def test_execute_preserves_clock_rollback_reason(self):
        # GEM-BS-002: exercise execute's exception wrapper, not just Ledger.clock.
        state = self.path/'rollback'
        with patch.object(capture.time, 'time', side_effect=[1000., 1000., 999.]):
            with self.assertRaisesRegex(ValueError, 'backwards'):
                capture.execute(manifest(), 'http://127.0.0.1:1', 'http://127.0.0.1:2',
                                state, self.binary, loopback_test=True)
        with sqlite3.connect(state/'ledger.sqlite3') as db:
            reason = json.loads(db.execute("SELECT value FROM meta WHERE key='terminal'").fetchone()[0])
            self.assertEqual(reason, 'clock-rollback')
            self.assertEqual(db.execute('SELECT count(*) FROM attempts').fetchone()[0], 0)

    def test_worker_deadline_is_guarded_and_disabled_before_close(self):
        # GEM-BS-003: deterministic signal-boundary injection, no actual network.
        for idx, immediate in enumerate((True, False), 1):
            with self.subTest(immediate=immediate):
                armed = [False]
                def timer(which, seconds):
                    armed[0] = seconds > 0
                    if seconds and immediate:
                        raise TimeoutError('injected deadline at timer arm')
                def close():
                    self.assertFalse(armed[0], 'timer still armed during socket close')
                owner = SimpleNamespace(detach=lambda: os.dup(self.lockfile.fileno()))
                with patch.object(capture.signal, 'signal'), \
                     patch.object(capture.signal, 'setitimer', side_effect=timer), \
                     patch.object(capture.http.client, 'HTTPConnection') as factory:
                    conn = factory.return_value
                    conn.close.side_effect = close
                    response = conn.getresponse.return_value
                    response.status = 200
                    response.getheaders.return_value = []
                    response.read.return_value = b''
                    capture.http_worker('http://127.0.0.1:1', 'GET', PATH, {}, str(self.path),
                                        idx, owner, .001)
                result = json.loads((self.path/f'{idx}.json').read_text())
                self.assertEqual(result.get('error'), 'deadline' if immediate else None)

    def test_existing_directory_and_concurrent_owner_rejected(self):
        state = self.path / 'lock'
        with capture.locked_directory(state, False):
            with self.assertRaises(FileExistsError):
                with capture.locked_directory(state, False):
                    self.fail('overwrote existing state')
            with self.assertRaises(BlockingIOError):
                with capture.locked_directory(state, True):
                    self.fail('second owner admitted')
        (state/'unexpected').symlink_to(self.binary)
        with self.assertRaises(ValueError):
            with capture.locked_directory(state, True):
                self.fail('symlink accepted')


if __name__ == '__main__':
    unittest.main(verbosity=2)
