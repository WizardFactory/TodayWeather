#!/usr/bin/env python3
"""Finite TEST-only catalog-peer profiles; no AWS, provider or lasting storage."""
import base64
import copy
import hashlib
import http.client
import importlib.util
from pathlib import Path
import subprocess
import sys
import threading
import unittest

PATH = Path(__file__).with_name('catalog_peer.py')
SPEC = importlib.util.spec_from_file_location('rainfall_profile_peer', PATH)
peer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(peer)


class PureProfiles(unittest.TestCase):
    def setUp(self):
        self.config = peer.base.load_config(peer.OWNED / 'config/local-stack.json')
        self.original = copy.deepcopy(self.config)

    def test_default_and_warning_fanout_keep_the_existing_version_limit(self):
        default = peer.select_config(self.config)
        fanout = peer.select_config(self.config, fanout_capacity=True)
        self.assertEqual(default, self.original)
        self.assertEqual((default['max_objects'], default['max_store_bytes'], default['max_versions']),
                         (4096, 32 * 1024 * 1024, 64))
        self.assertEqual((fanout['max_objects'], fanout['max_store_bytes'], fanout['max_versions']),
                         (16384, 64 * 1024 * 1024, 64))
        self.assertEqual(self.config, self.original)

    def test_rainfall_has_exact_finite_caps_without_mutating_other_settings(self):
        rainfall = peer.select_config(self.config, rainfall_capacity=True)
        self.assertEqual((rainfall['max_objects'], rainfall['max_store_bytes'], rainfall['max_versions']),
                         (16384, 64 * 1024 * 1024, 512))
        for key in self.original.keys() - {'max_objects', 'max_store_bytes', 'max_versions'}:
            self.assertEqual(rainfall[key], self.original[key], key)
        self.assertEqual(self.config, self.original)

    def test_conflicting_profiles_are_rejected_before_creating_a_peer(self):
        with self.assertRaisesRegex(ValueError, 'conflicting'):
            peer.select_config(self.config, fanout_capacity=True, rainfall_capacity=True)
        self.assertEqual(self.config, self.original)
        result = subprocess.run([sys.executable, str(PATH), '--fanout-capacity', '--rainfall-capacity'],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5, check=False)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, b'')
        self.assertIn(b'not allowed with argument', result.stderr)


class RealVersionBoundaries(unittest.TestCase):
    def test_actual_conditional_writes_reach_each_fixed_version_cap_and_reject_one_more(self):
        # This checks the same owned peer operation that previously blocked a full corpus.
        # All ordinary/fanout limits stay unchanged; only explicit rainfall gets512 versions.
        for profile, options, versions in [('default', {}, 64), ('fanout', {'fanout_capacity': True}, 64),
                                           ('rainfall', {'rainfall_capacity': True}, 512)]:
            with self.subTest(profile=profile):
                server = peer.make(persistent=True, **options)
                worker = threading.Thread(target=server.serve_forever, daemon=True)
                worker.start()
                connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=2)
                key = '/server2-local/index/v2/statistics/rns/profile-proof.json'
                etag = None
                last_body = None
                try:
                    for version in range(versions + 1):
                        body = f'owned version {version}'.encode()
                        headers = {'X-Server2-Test-Key': 'server2-local', 'Content-Type': 'application/json',
                                   'Content-MD5': base64.b64encode(hashlib.md5(body).digest()).decode()}
                        headers['If-Match' if etag else 'If-None-Match'] = etag or '*'
                        connection.request('PUT', key, body, headers)
                        response = connection.getresponse()
                        payload = response.read()
                        if version == versions:
                            self.assertEqual(response.status, 507, payload)
                            self.assertIn(b'TestStoreLimit', payload)
                        else:
                            self.assertEqual(response.status, 200, payload)
                            etag = response.getheader('ETag')
                            last_body = body
                    connection.request('GET', key, headers={'X-Server2-Test-Key': 'server2-local'})
                    response = connection.getresponse()
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.read(), last_body)
                    self.assertEqual(response.getheader('ETag'), etag)
                    self.assertEqual(response.getheader('x-amz-version-id'), str(versions))
                finally:
                    connection.close()
                    server.shutdown()
                    server.server_close()
                    worker.join(timeout=5)
                self.assertFalse(worker.is_alive())


if __name__ == '__main__':
    unittest.main()
