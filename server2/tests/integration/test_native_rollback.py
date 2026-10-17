"""Native API recovery tooling controls; no production credentials or network."""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools/shadow'))
import native_rollback as recovery


class ArtifactTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.entries = {}
        for index, role in enumerate(('current', 'previous')):
            p = self.root / role
            p.write_bytes(b'executable-' + role.encode())
            p.chmod(0o700)
            self.entries[role] = dict(path=str(p), sha256=hashlib.sha256(p.read_bytes()).hexdigest(),
                                      revision=str(index + 1) * 40, profile='release')
        self.path = self.root / 'artifacts.json'

    def tearDown(self):
        self.temp.cleanup()

    def load(self):
        self.path.write_text(json.dumps(dict(schema=1, artifacts=self.entries)))
        return recovery.artifacts(self.path)

    def test_distinct_bound_release_pair(self):
        self.assertEqual(set(self.load()), {'current', 'previous'})

    def test_same_revision_or_executable_is_not_a_rollback(self):
        self.entries['previous']['revision'] = self.entries['current']['revision']
        with self.assertRaises(ValueError): self.load()
        self.entries['previous'] = dict(self.entries['current'], revision='3' * 40)
        with self.assertRaises(ValueError): self.load()

    def test_mutated_or_missing_artifact_is_rejected(self):
        self.entries['current']['sha256'] = '0' * 64
        with self.assertRaises(ValueError): self.load()
        Path(self.entries['previous']['path']).unlink()
        with self.assertRaises(ValueError): self.load()

    def test_unidentified_debug_or_extra_input_is_rejected(self):
        for key, value in [('profile', 'debug'), ('revision', 'abc'), ('sha256', 'oops'), ('unexpected', True), ('revision', None)]:
            original = self.entries['current'].copy()
            self.entries['current'][key] = value
            with self.assertRaises(ValueError): self.load()
            self.entries['current'] = original

    def test_not_executable_is_rejected(self):
        Path(self.entries['current']['path']).chmod(0o600)
        with self.assertRaises(ValueError): self.load()


class CompareTest(unittest.TestCase):
    def test_exact_functional_headers_body_and_status(self):
        a = dict(status=200, body_sha256='a', headers={'etag': 'a', 'date': 'one'})
        b = dict(status=200, body_sha256='a', headers={'etag': 'a', 'date': 'two'})
        recovery.same(a, b)
        for changed in [dict(b, status=500), dict(b, body_sha256='b'),
                        dict(b, headers={'etag': 'a', 'extra': 'bad'}),
                        dict(b, headers={}), dict(b, headers={'etag': 'b'})]:
            with self.assertRaises(AssertionError): recovery.same(a, changed)

    def test_equal_responses_without_etag_are_rejected(self):
        for headers in ({}, {'etag': ''}):
            reply = dict(status=200, body_sha256='same', headers=headers)
            with self.assertRaises(AssertionError): recovery.same(reply, reply)

    def test_notice_read_can_compare_without_etag(self):
        reply = dict(status=200, body_sha256='notice', headers={})
        recovery.same(reply, reply, require_etag=False)

    def test_env_has_no_legacy_or_operator_credentials(self):
        peer = type('S3', (), {'config_values': dict(bucket='server2-local', test_access_key='server2-local', test_secret_key='dummy')})()
        with patch.dict(os.environ, {'SERVER2_GATEWAY_LEGACY_URL': 'https://production.invalid', 'OPENAI_API_KEY': 'private'}):
            env = recovery.environment(peer, '/tmp/owned-cache')
        self.assertNotIn('SERVER2_GATEWAY_LEGACY_URL', env)
        self.assertNotIn('OPENAI_API_KEY', env)
        self.assertEqual(env['SERVER2_NATIVE_FAMILIES'], 'geocode,dsf,kma,notice')
        self.assertEqual(env['SERVER2_LOCAL_CACHE_MAX_BYTES'], str(8 * 1024 * 1024))


class AcquisitionTest(unittest.TestCase):
    def test_exact_cells_not_just_total_counts(self):
        paths = {'vc': ['/timeline/51.51,-0.13/last1days/next7days?x=synthetic'],
                 'waqi': ['/feed/geo:37.56;126.99/?token=x', '/feed/geo:51.51;-0.13/?token=x']}
        recovery.acquisition_contract(0, paths)
        recovery.acquisition_contract(1, {'vc': [], 'waqi': []})
        for bad in [dict(paths, waqi=[paths['waqi'][0]] * 2), dict(paths, waqi=[]),
                    dict(paths, vc=paths['vc'] * 2)]:
            with self.assertRaises(AssertionError): recovery.acquisition_contract(0, bad)
        with self.assertRaises(AssertionError): recovery.acquisition_contract(1, paths)


if __name__ == '__main__': unittest.main()
