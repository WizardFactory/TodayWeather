"""Contract regressions: fixture bytes, actual assembly coverage and oracle boundary."""
import base64
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
import verify

class Contract(unittest.TestCase):
    def setUp(self):
        self.inventory = [{'method': 'GET', 'path': '/example'}]
        body = b'{"value":37626}'
        self.record = {'schema': 1, 'inventory': self.inventory,
            'source': {'revision': 'a' * 40, 'files': {'server/routes/gateway.js': 'b' * 64}},
            'cases': [{'id': 'one', 'group': 'GET /example', 'handler': 'server/routes/gateway.js',
                'kind': 'wire', 'status': 200, 'headers': [['etag', 'actual-hash']],
                'body_base64': base64.b64encode(body).decode(),
                'body_sha256': hashlib.sha256(body).hexdigest()}],
            'backend_coverage': ['domestic-v000901', 'domestic-v000902', 'domestic-v000903',
                'town-v000705', 'town-v000803', 'world-v000901', 'world-v000902', 'world-v000903', 'nation', 'special', 'push']}
        for backend in self.record['backend_coverage']:
            self.record['cases'].append(dict(self.record['cases'][0],id=backend,group=None,backend=backend,dependency_trace={'actual':'test fixture control'}))
    def test_accept_complete_record(self):
        verify.validate_record(self.record, self.inventory)
    def test_changed_raw_bytes_rejected(self):
        self.record['cases'][0]['body_base64'] = base64.b64encode(b'{"value":59662}').decode()
        with self.assertRaisesRegex(ValueError, 'body hash'):
            verify.validate_record(self.record, self.inventory)
    def test_missing_group_rejected(self):
        self.record['cases'] = []
        with self.assertRaisesRegex(ValueError, 'inventory coverage'):
            verify.validate_record(self.record, self.inventory)
    def test_gateway_stub_does_not_cover_backends(self):
        self.record['backend_coverage'] = []
        self.record['cases'] = [self.record['cases'][0]]
        with self.assertRaisesRegex(ValueError, 'backend coverage'):
            verify.validate_record(self.record, self.inventory)
    def test_duplicate_case_rejected(self):
        self.record['cases'].append(copy.deepcopy(self.record['cases'][0]))
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            verify.validate_record(self.record, self.inventory)
    def test_outside_oracle_identity_rejected(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            d = {'outside': [{'category': 'legacy-oracle', 'path': 'server/other.js'}]}
            with self.assertRaisesRegex(ValueError, 'exact named'):
                verify.oracle_path(root, d)
    def test_symlink_oracle_rejected(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t); target = root / 'server/test/offline/golden-record.js'
            target.parent.mkdir(parents=True); other = root / 'else.js'; other.write_text('')
            target.symlink_to(other)
            with self.assertRaisesRegex(ValueError, 'symlink'):
                verify.oracle_path(root, {'outside': [{'category': 'legacy-oracle', 'path': 'server/test/offline/golden-record.js'}]})

    def test_updated_body_hash_still_fails_baseline_comparison(self):
        expected=json.dumps(self.record,sort_keys=True).encode()
        raw=b'{"value":59662}'
        self.record['cases'][0]['body_base64']=base64.b64encode(raw).decode()
        self.record['cases'][0]['body_sha256']=hashlib.sha256(raw).hexdigest()
        verify.validate_record(self.record,self.inventory)
        with self.assertRaisesRegex(ValueError,'baseline differs'):
            verify.compare_bytes(expected,json.dumps(self.record,sort_keys=True).encode())
    def test_status_header_and_source_changes_fail_baseline(self):
        for mutate in [lambda d:d['cases'][0].update(status=501),
                       lambda d:d['cases'][0].update(headers=[['etag','different']]),
                       lambda d:d['source']['files'].update({'server/routes/gateway.js':'c'*64})]:
            changed=copy.deepcopy(self.record);mutate(changed)
            with self.assertRaisesRegex(ValueError,'baseline differs'):
                verify.compare_bytes(json.dumps(self.record).encode(),json.dumps(changed).encode())
    def test_unsafe_provenance_and_hash_rejected(self):
        for files in [{'server/../config/private.json':'a'*64},{'server/routes/gateway.js':'invalid'}]:
            changed=copy.deepcopy(self.record);changed['source']['files']=files
            with self.assertRaisesRegex(ValueError,'provenance'):
                verify.validate_record(changed,self.inventory)

if __name__ == '__main__': unittest.main()
