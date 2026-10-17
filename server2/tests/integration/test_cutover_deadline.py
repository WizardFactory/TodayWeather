#!/usr/bin/env python3
"""Candidate configuration contract. Real nginx/release proof is a separate tool run."""
import json
from pathlib import Path
import re
import unittest
from unittest.mock import patch
import hashlib
import sys
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools/cutover"))
import rehearse_deadline as rehearsal

ROOT = Path(__file__).resolve().parents[2]

class CutoverConfig(unittest.TestCase):
    def test_fresh_upstream_preserves_late_deadline(self):
        text = (ROOT / 'deploy/cutover/nginx.conf.template').read_text()
        text = re.sub(r'#[^\n]*', '', text)
        self.assertIn('proxy_http_version 1.0;', text)
        self.assertRegex(text, r'proxy_set_header\s+Connection\s+close;')
        self.assertNotRegex(text, r'\bkeepalive\s+\d')
        self.assertIn('keepalive_timeout 30s;', text)

    def test_no_proxy_retries_cache_or_error_substitution(self):
        text = (ROOT / 'deploy/cutover/nginx.conf.template').read_text()
        for directive in ['proxy_next_upstream off;', 'proxy_cache off;',
                          'proxy_intercept_errors off;', 'proxy_redirect off;']:
            self.assertIn(directive, text)
        self.assertIn('proxy_read_timeout 15s;', text)
        self.assertIn('proxy_set_header Host $http_host;', text)
        self.assertIn('listen 127.0.0.1:{{LISTEN_PORT}};', text)
        self.assertIn('server 127.0.0.1:{{UPSTREAM_PORT}};', text)

class Inventory(unittest.TestCase):
    def test_accepted_denominator_and_new_contracts(self):
        data = json.loads((ROOT / 'config/cutover/inventory.json').read_text())
        rows = data['routes']
        self.assertEqual(len(rows), 19)
        self.assertEqual(len({(r['method'], r['path']) for r in rows}), 19)
        self.assertEqual(sum(r['observed_requests'] for r in rows), 220583)
        self.assertEqual(sum(r['observed_requests'] == 1 for r in rows), 2)
        self.assertIn('/v000705/town/{location}', {r['path'] for r in rows})
        self.assertEqual(data['supplements'][0]['path'], '/v000903/notice/latest')
        self.assertEqual(data['unclassified'], [])
        self.assertIn('/ww/010000/current/2', {r['path'] for r in data['supplements']})
        self.assertNotIn('observed_requests', data['supplements'][1])
        self.assertFalse(data['production_eligible'])
        self.assertIn('2724 actual provider quota measurement', data['excluded_changes'])
        self.assertFalse(any(item.startswith('2805') for item in data['excluded_changes']))
        self.assertEqual(data['response_supplements'][0]['field'],'forecastNarrative')
        self.assertEqual(set(data['response_supplements'][0]['families']),{'kma','town','nation'})
        for row in rows + data['supplements']:
            self.assertTrue((ROOT.parent / row['native_source']).is_file())

class Admission(unittest.TestCase):
    def test_owned_paths_replace_distro_defaults(self):
        rendered = rehearsal.render(rehearsal.TEMPLATE.read_text(), 8080, 8081,
                                    '/tmp/owned with space/nginx.pid')
        for module in ('client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi'):
            self.assertIn(module+'_temp_path "/tmp/owned with space/'+module+'";', rendered)
        self.assertNotIn('/var/lib/nginx', rendered)

    def test_render_refuses_ambiguous_or_injecting_workspace(self):
        for pid in ('relative/nginx.pid', '/tmp/../outside/nginx.pid', '/tmp/quote"/nginx.pid',
                    '/tmp/back\\slash/nginx.pid', '/tmp/$variable/nginx.pid',
                    '/tmp/semi;colon/nginx.pid', '/tmp/new\nline/nginx.pid', '/tmp/nul\0/nginx.pid'):
            with self.subTest(pid=pid), self.assertRaises(ValueError):
                rehearsal.render(rehearsal.TEMPLATE.read_text(), 8080, 8081, pid)

    def test_render_refuses_injection_or_privileged_port(self):
        template = rehearsal.TEMPLATE.read_text()
        for invalid in [True, 0, 80, 65536, '8080; include secret;']:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                rehearsal.render(template, invalid, 8081, '/tmp/owned.pid')
        with self.assertRaises(ValueError):
            rehearsal.render(template, 8080, 8080, '/tmp/owned.pid')
        with self.assertRaises(ValueError):
            rehearsal.render('{{UNKNOWN}}', 8080, 8081, '/tmp/owned.pid')
        rendered = rehearsal.render(template, 8080, 8081, '/tmp/owned.pid')
        self.assertNotIn('{{', rendered)
        self.assertIn('listen 127.0.0.1:8080;', rendered)

    def test_bad_hash_blocks_before_every_child(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            files = {}
            for role, relative in [('server2', 'bin/server2'), ('loopback_server', 'bin/examples/loopback_server')]:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'not executed')
                path.chmod(0o700)
                files[role] = dict(path=str(path), profile='release', sha256=hashlib.sha256(path.read_bytes()).hexdigest())
            files['loopback_server']['sha256'] = '0' * 64
            manifest = root / 'artifacts.json'
            manifest.write_text(json.dumps(dict(schema=1, revision='a' * 40, artifacts=files)))
            out = root / 'out'
            with patch.object(rehearsal.subprocess, 'run') as child:
                code = rehearsal.main(['--artifacts', str(manifest), '--nginx', str(root/'missing'),
                                       '--nginx-sha256', '0' * 64, '--out', str(out)])
                child.assert_not_called()
            self.assertEqual(code, 2)
            report = json.loads((out / 'report.json').read_text())
            self.assertEqual(report['verdict'], 'BLOCKED')
            self.assertFalse(report['production_eligible'])
            before = (out / 'report.json').read_bytes()
            with self.assertRaises(SystemExit):
                rehearsal.main(['--artifacts', str(manifest), '--nginx', str(root/'missing'),
                                '--nginx-sha256', '0' * 64, '--out', str(out)])
            self.assertEqual((out / 'report.json').read_bytes(), before)

if __name__ == '__main__':
    unittest.main()
