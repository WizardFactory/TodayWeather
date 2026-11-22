"""Offline observation checks for scoped provider fault scenarios."""

import http.client
import json
import sqlite3
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'deploy/shadow'))

import linux_check as check
from check_peers import Handler, ThreadingHTTPServer


class ProviderFaultChecks(unittest.TestCase):
    def test_peer_records_exact_replies_and_no_stall_response(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        state = Path(directory.name)
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.state, server.lock = state, threading.Lock()
        worker = threading.Thread(target=server.serve_forever, args=(0.01,))
        worker.start()
        self.addCleanup(worker.join)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        (state / 'provider-status').write_text('200\n')

        def request(path):
            client = http.client.HTTPConnection(*server.server_address, timeout=1)
            try:
                client.request('GET', path, headers={'Host': 'apis.data.go.kr'})
                response = client.getresponse()
                response.read()
                return response.status
            finally:
                client.close()

        config = state / 'provider-fault.json'
        for status in (401, 403, 429):
            config.write_text(json.dumps({'path': check.FAULT_PATH, 'status': status}))
            self.assertEqual(request(check.FAULT_PATH + '?serviceKey=synthetic-only'), status)
        config.write_text(json.dumps({'path': check.FAULT_PATH, 'delay_seconds': 0.03}))
        self.assertEqual(request('/unrelated'), 200)
        with self.assertRaises(http.client.RemoteDisconnected):
            request(check.FAULT_PATH)
        requests = (state / 'fault-requests.jsonl').read_text()
        responses = (state / 'fault-responses.jsonl').read_text()
        self.assertEqual([r['injected'] for r in map(json.loads, requests.splitlines())], [401, 403, 429, 'stall'])
        self.assertEqual([r['injected'] for r in map(json.loads, responses.splitlines())], [401, 403, 429])
        self.assertNotIn('synthetic-only', requests + responses)

    def test_requires_actual_provider_http_stage_status_and_cause(self):
        event = dict(component='provider', stage='provider_http', status=403, cause='auth')
        self.assertTrue(check.provider_fault_diagnostic(event, 403))
        self.assertFalse(check.provider_fault_diagnostic(event, 401))
        self.assertFalse(check.provider_fault_diagnostic(event | {'component': 's3'}, 403))
        self.assertFalse(check.provider_fault_diagnostic(event | {'stage': 'admission'}, 403))
        self.assertFalse(check.provider_fault_diagnostic(event | {'cause': 'quota'}, 403))
        self.assertTrue(check.provider_fault_diagnostic(event | {'status': 429, 'cause': 'quota'}, 429))

    def test_live_and_retained_fault_identity_requires_trace_and_operation(self):
        event = dict(component='provider', stage='provider_http', status=429, cause='quota')
        self.assertIsNone(check.fault_operation(event, 429))
        event.update(trace_id='trace-a', operation_id='op-a')
        self.assertEqual(check.fault_operation(event, 429), ('trace-a', 'op-a'))
        self.assertIsNone(check.fault_operation(event, 401))
        self.assertNotEqual(check.fault_operation(event | {'operation_id': 'op-b'}, 429),
                            check.fault_operation(event, 429))

    def test_timeout_requires_absent_http_status_and_known_attempt_deadline(self):
        event = dict(component='provider', stage='provider_http', cause='timeout', duration_ms=3002)
        self.assertTrue(check.provider_fault_diagnostic(event, None))
        self.assertFalse(check.provider_fault_diagnostic(event | {'status': 408}, None))
        self.assertFalse(check.provider_fault_diagnostic(event | {'duration_ms': 1000}, None))
        self.assertFalse(check.provider_fault_diagnostic(event | {'duration_ms': 21000}, None))

    def test_paired_progress_requires_two_later_captured_responses(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(check.latest_pair(root), None)
            with sqlite3.connect(root / 'ledger.sqlite3') as db:
                db.execute("CREATE TABLE attempts (id, slot, origin, result, case_id TEXT DEFAULT 'seoul')")
                db.executemany('INSERT INTO attempts (id, slot, origin, result) VALUES (?,?,?,?)', [
                    (1, 10, 'candidate', json.dumps({'status': 501, 'captured': True})),
                    (2, 10, 'production', json.dumps({'status': 200, 'captured': True})),
                    (3, 11, 'candidate', json.dumps({'status': 501, 'captured': True})),
                    (4, 11, 'production', None),
                ])
            (root / '1.body').write_bytes(b'Not Implemented')
            (root / '2.body').write_bytes(b'{"marker":"synthetic"}')
            self.assertEqual(check.latest_pair(root), {'slot': 10, 'candidate_status': 501,
                                                       'candidate_dependency_response': True, 'reference_status': 200})
            self.assertIsNone(check.latest_pair(root, after_slot=10))


if __name__ == '__main__':
    unittest.main()
