"""Contract regressions: fixture bytes, actual assembly coverage and oracle boundary."""
import base64
import copy
import hashlib
import json
import os
import subprocess
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

class WireCoverage(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root=Path(__file__).resolve().parents[3]
        cls.record=json.loads((cls.root/'server2/tests/golden/records.json').read_text())
        # Same reviewed exact canonical oracle validation as the CLI, no arbitrary outside spawn.
        cls.oracle=verify.oracle_path(cls.root,json.loads((cls.root/'server2/config/tasks/S02.json').read_text()))
        cls.cases={c['id']:c for c in cls.record['cases']}
    def test_app_query_and_language_forwarded(self):
        for version in ['default','v000903']:
            for kind in ['domestic','world']:
                c=self.cases['gateway-'+version+'-'+kind]
                self.assertIn('airForecastSource=kaq',c['request']['path'])
                self.assertEqual(c['request']['headers']['accept-language'],'ko-KR,ko;q=0.9')
                f=c['dependency_trace']['backend'][0]
                self.assertIn('airForecastSource=kaq',f['path'])
                self.assertEqual(f['headers']['accept-language'],'ko')
        c=self.cases['gateway-query-normalization']
        self.assertIn('temperatureUnit=F',c['dependency_trace']['backend'][0]['path'])
        self.assertIn('note=a%20b',c['dependency_trace']['backend'][0]['path'])
    def test_nation_real_transport_failure(self):
        c=self.cases['nation-v000901']
        self.assertEqual(c['status'],500)
        self.assertIn('ESOCKETTIMEDOUT',c['dependency_trace']['outcome'])
        self.assertEqual(base64.b64decode(c['body_base64']),b'Internal Server Error\n')
    def test_resumed_has_old_rows_and_gap(self):
        old=self.cases['gateway-history-resumed-after-eight-days']['dependency_trace']
        fresh=self.cases['gateway-history-never-requested']['dependency_trace']
        self.assertEqual(old['available_observation_hours'],25)
        self.assertEqual(old['observation_dates'][0],'20260915')
        self.assertEqual(old['observation_dates'][-1],'20260924')
        self.assertNotEqual(old['observation_dates'],fresh['observation_dates'])
    def test_remaining_real_wire_gaps(self):
        for id,status in [('gateway-unavailable',503),('gateway-excluded',404),('gateway-zero',404),('gateway-deadline',501),('nation-v000903-304',304),('warning-week-old-304',304),('push-v705-store-success',200)]:
            self.assertEqual(self.cases[id]['status'],status)
        self.assertEqual(dict(self.cases['gateway-unavailable']['headers'])['retry-after'],'60')
        for locale in ['en','ko','ja','zh-CN','de','zh-TW']:
            self.assertEqual(self.cases['world-locale-'+locale]['status'],200)
    def test_committed_output_and_symlink_rejected(self):
        with self.assertRaisesRegex(ValueError,'committed'):
            verify.output_path(self.root,self.root/'server2/tests/golden')
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'alias';p.symlink_to(self.root/'server2/tests/golden',target_is_directory=True)
            with self.assertRaisesRegex(ValueError,'committed'):
                verify.output_path(self.root,p)
    def test_direct_recorder_cannot_overwrite_baseline(self):
        env=dict(os.environ,TZ='UTC',NODE_ENV='production')
        p=self.root/'server2/tests/golden/records.json';before=p.read_bytes()
        r=subprocess.run([os.environ.get('GOLDEN_NODE','node'),str(self.oracle),'--output',str(p.parent)],env=env,capture_output=True,text=True,timeout=10)
        self.assertNotEqual(r.returncode,0);self.assertIn('committed golden',r.stderr);self.assertEqual(p.read_bytes(),before)
    def test_direct_recorder_rejects_legacy_output(self):
        env=dict(os.environ,TZ='UTC',NODE_ENV='production')
        r=subprocess.run([os.environ.get('GOLDEN_NODE','node'),str(self.oracle),'--output',str(self.root/'server')],env=env,capture_output=True,text=True,timeout=10)
        self.assertNotEqual(r.returncode,0);self.assertIn('No golden output under legacy',r.stderr)
    def test_process_guard_rejects_host_modes_before_output(self):
        node=os.environ.get('GOLDEN_NODE','node')
        for key in ['TW_VC_LIVE','VC_SECRET_KEY','PUSH_STORE','TW_MONGO_URL','TW_SMOKE_NOW']:
            with tempfile.TemporaryDirectory() as t:
                p=Path(t)/'output';env=dict(os.environ,TZ='UTC',NODE_ENV='production');env[key]='synthetic-denied'
                r=subprocess.run([node,str(self.oracle),'--output',str(p)],env=env,capture_output=True,text=True,timeout=10)
                self.assertNotEqual(r.returncode,0);self.assertIn('forbidden',r.stderr.lower());self.assertFalse(p.exists())

if __name__ == '__main__': unittest.main()
