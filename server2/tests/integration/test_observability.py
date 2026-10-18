"""Real release-process logging contract. Uses only loopback HTTP and synthetic values."""
import http.client
import json
import os
from pathlib import Path
import re
import select
import subprocess
import tempfile
import unittest


class OperationalLogging(unittest.TestCase):
    def test_request_terminal_is_structured_private_and_correlated(self):
        binary = Path(os.environ['SERVER2_LOGGING_BINARY']).resolve()
        self.assertTrue(binary.is_file(), 'explicit release binary required')
        secret = 'SYNTHETIC-PRIVATE-2802-DO-NOT-LOG'
        env = {k: os.environ[k] for k in ('PATH', 'TMPDIR', 'LANG', 'LC_ALL') if k in os.environ}
        env.update(PORT='0', SERVER2_GATEWAY_LEGACY_URL='http://127.0.0.1:9', SERVER2_LOG_LEVEL='debug', SERVER2_LOG_RATE='1000')
        with tempfile.TemporaryDirectory(prefix='server2-logging-') as cwd:
            proc = subprocess.Popen([str(binary)], cwd=cwd, env=env,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                ready, _, _ = select.select([proc.stdout], [], [], 10)
                self.assertTrue(ready, 'process readiness timed out')
                line = proc.stdout.readline().strip()
                match = re.fullmatch(r'server2 public=127\.0\.0\.1:(\d+) metrics=127\.0\.0\.1:(\d+)', line)
                self.assertIsNotNone(match, 'unchanged readiness protocol required: ' + line + (proc.stderr.read() if proc.poll() is not None else ''))
                conn = http.client.HTTPConnection('127.0.0.1', int(match[1]), timeout=10)
                conn.request('GET', '/health')
                response = conn.getresponse()
                self.assertEqual(response.status, 200)
                response.read(); conn.close()
                conn = http.client.HTTPConnection('127.0.0.1', int(match[1]), timeout=10)
                conn.request('GET', '/unknown/' + secret + '?token=' + secret,
                             headers={'Authorization': 'Bearer ' + secret, 'X-Request-ID': secret})
                response = conn.getresponse()
                self.assertEqual(response.status, 404)
                response.read(); conn.close()
                proc.terminate()
                stdout, stderr = proc.communicate(timeout=10)
                self.assertEqual(proc.returncode, 0)
            finally:
                if proc.poll() is None:
                    proc.kill(); proc.communicate(timeout=5)
                proc.stdout.close(); proc.stderr.close()
        records = []
        for line in stderr.splitlines():
            try:
                value = json.loads(line)
            except ValueError:
                continue
            if isinstance(value, dict):
                records.append(value)
        terminal = [r for r in records if r.get('event') == 'operation.finished'
                    and r.get('component') == 'http' and r.get('status') == 404]
        self.assertTrue(terminal, 'structured HTTP terminal event absent after successful real HTTP setup')
        self.assertNotIn(secret, stderr + stdout)
        for line in stderr.splitlines():
            self.assertLessEqual(len(line.encode()) + 1, 1024)
            self.assertIsInstance(json.loads(line), dict, 'operational stderr must be NDJSON')
        event = terminal[0]
        self.assertEqual(event['schema'], 1)
        self.assertEqual(event['route'], 'other')
        self.assertRegex(event['trace_id'], r'^[0-9a-f]{32}$')
        self.assertRegex(event['operation_id'], r'^[0-9a-f]{16}$')
        self.assertEqual(event['outcome'], 'failed')
        self.assertTrue(any(r.get('event') == 'operation.started' and
                            r.get('operation_id') == event['operation_id'] and
                            r.get('trace_id') == event['trace_id'] for r in records))

        if os.environ.get('SERVER2_LOGGING_TEST_CAPTURE'):
            Path(os.environ['SERVER2_LOGGING_TEST_CAPTURE']).write_text(stderr)
        print('HTTP_PROOF ' + json.dumps(event, separators=(',', ':')))

    def test_blocked_stderr_keeps_actual_http_and_stop_bounded_and_exposes_loss(self):
        binary = Path(os.environ['SERVER2_LOGGING_BINARY']).resolve()
        env = {k: os.environ[k] for k in ('PATH', 'TMPDIR', 'LANG', 'LC_ALL') if k in os.environ}
        env.update(PORT='0', SERVER2_GATEWAY_LEGACY_URL='http://127.0.0.1:9', SERVER2_LOG_LEVEL='debug', SERVER2_LOG_RATE='1000')
        import time
        with tempfile.TemporaryDirectory(prefix='server2-stalled-logging-') as cwd:
            proc = subprocess.Popen([str(binary)], cwd=cwd, env=env,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                self.assertTrue(select.select([proc.stdout], [], [], 10)[0])
                match = re.fullmatch(r'server2 public=127\.0\.0\.1:(\d+) metrics=127\.0\.0\.1:(\d+)', proc.stdout.readline().strip())
                self.assertIsNotNone(match)
                began = time.monotonic()
                # Deliberately do not read stderr. Its OS pipe eventually blocks the writer.
                for _ in range(600):
                    conn = http.client.HTTPConnection('127.0.0.1', int(match[1]), timeout=2)
                    conn.request('GET', '/unknown')
                    answer = conn.getresponse()
                    self.assertEqual(answer.status, 404)
                    answer.read(); conn.close()
                self.assertLess(time.monotonic()-began, 10)
                conn = http.client.HTTPConnection('127.0.0.1', int(match[2]), timeout=2)
                conn.request('GET', '/internal/metrics')
                answer = conn.getresponse()
                self.assertEqual(answer.status, 200)
                values = dict(line.split() for line in answer.read().decode().splitlines())
                conn.close()
                self.assertGreater(int(values['server2_logging_queue_full_total']), 0)
                stop_began = time.monotonic()
                proc.terminate()
                self.assertEqual(proc.wait(timeout=8), 0)
                print('STALL_PROOF ' + json.dumps(dict(requests=600, queue_full=int(values['server2_logging_queue_full_total']), stop_seconds=round(time.monotonic()-stop_began, 4)), separators=(',', ':')))
                # Drain only after product exit: this cannot unblock the service beforehand.
                proc.communicate(timeout=2)
            finally:
                if proc.poll() is None:
                    proc.kill(); proc.communicate(timeout=5)
                proc.stdout.close(); proc.stderr.close()

    def test_runtime_filter_and_invalid_logging_values_preserve_http_without_leaking_values(self):
        binary = Path(os.environ['SERVER2_LOGGING_BINARY']).resolve()
        secret = 'SYNTHETIC-PRIVATE-2802-INVALID-LOGGING'
        for level, rate in [('error', '1000'), (secret, secret)]:
            env = {k: os.environ[k] for k in ('PATH', 'TMPDIR', 'LANG', 'LC_ALL') if k in os.environ}
            env.update(PORT='0', SERVER2_GATEWAY_LEGACY_URL='http://127.0.0.1:9', SERVER2_LOG_LEVEL=level, SERVER2_LOG_RATE=rate)
            with tempfile.TemporaryDirectory(prefix='server2-log-filter-') as cwd:
                proc = subprocess.Popen([str(binary)], cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                try:
                    self.assertTrue(select.select([proc.stdout], [], [], 10)[0])
                    match = re.fullmatch(r'server2 public=127\.0\.0\.1:(\d+) metrics=127\.0\.0\.1:(\d+)', proc.stdout.readline().strip())
                    self.assertIsNotNone(match)
                    conn = http.client.HTTPConnection('127.0.0.1', int(match[1]), timeout=2)
                    conn.request('GET', '/unknown')
                    answer = conn.getresponse()
                    self.assertEqual(answer.status, 404)
                    answer.read(); conn.close()
                    conn = http.client.HTTPConnection('127.0.0.1', int(match[2]), timeout=2)
                    conn.request('GET', '/internal/metrics')
                    answer = conn.getresponse()
                    values = dict(line.split() for line in answer.read().decode().splitlines())
                    conn.close()
                    proc.terminate(); _, stderr = proc.communicate(timeout=8)
                    self.assertEqual(proc.returncode, 0)
                    records = [json.loads(line) for line in stderr.splitlines()]
                    self.assertNotIn(secret, stderr)
                    if level == 'error':
                        self.assertGreater(int(values['server2_logging_filtered_total']), 0)
                        self.assertFalse(any(r.get('component')=='http' for r in records))
                    else:
                        self.assertTrue(any(r.get('cause')=='logging_configuration' and r.get('action')=='use_defaults' for r in records))
                    print('FILTER_PROOF ' + json.dumps(dict(mode='error' if level=='error' else 'invalid-fallback', filtered=int(values['server2_logging_filtered_total']), http_status=404, private_values_absent=True)))
                finally:
                    if proc.poll() is None:
                        proc.kill(); proc.communicate(timeout=5)
                    proc.stdout.close(); proc.stderr.close()


if __name__ == '__main__':
    unittest.main()
