"""Focused checks of rehearsal opt-in and separate offline routing."""

import base64
import contextlib
from datetime import datetime, timezone
from hashlib import sha256
import gzip
import hashlib
import http.client
import importlib.util
import io
import json
from pathlib import Path
import shutil
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import threading
import time
import unittest
from urllib.parse import urlencode
from xml.etree import ElementTree
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'deploy/shadow'))
import linux_check
import rehearsal_inputs
import rehearsal_run as driver
from rehearsal_projection import DAY


BASE = ['linux_check.py', '--disposable-host', '--server-binary', 'candidate',
        '--collector-tarball', 'collector', '--source-commit', 'f' * 40,
        '--report', 'results/report.json']
OPTIONS = ['--rehearsal-hours', '24', '--rehearsal-input', 'approved.json', '--output-dir', 'results']


class RehearsalDispatchTests(unittest.TestCase):
    def test_rehearsal_enters_the_opt_in_driver_without_loading_offline_setup(self):
        with (patch.object(sys, 'argv', [*BASE, *OPTIONS]),
              patch.object(sys, 'platform', 'linux'), patch.object(linux_check.os, 'geteuid', return_value=0),
              patch.object(linux_check, 'setup_network', side_effect=AssertionError('offline setup')),
              patch.object(linux_check, 'run', side_effect=AssertionError('driver owns guest commands')),
              patch.object(linux_check, 'rehearse', create=True, return_value=7) as driver):
            self.assertEqual(linux_check.main(), 7)
        self.assertEqual(driver.call_args.args[0].rehearsal_input, Path('approved.json'))

    def test_partial_or_mixed_rehearsal_options_cannot_touch_guest(self):
        for options in (OPTIONS[:2], OPTIONS[2:], [*OPTIONS, '--scenario', 'provider-fault-429']):
            with (self.subTest(options=options), patch.object(sys, 'argv', [*BASE, *options]),
                  patch.object(linux_check, 'run', side_effect=AssertionError('guest mutation')),
                  contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as caught):
                linux_check.main()
            self.assertEqual(caught.exception.code, 2)


class RehearsalDriverTests(unittest.TestCase):
    def setUp(self):
        tmp = TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)

    def write_private(self, name, content):
        path = self.root / name
        path.write_text(content)
        path.chmod(0o600)
        return path

    def test_private_plan_pins_two_artifacts_and_uses_only_dedicated_credentials(self):
        key = 'SYNTHETIC-REHEARSAL-KEY+ABC'
        self.write_private('reference', key + '\n')
        self.write_private('config', f'DONGNAE_SECRET_KEYS=["{key}"]\nAIRKOREA_SECRET_KEYS=["{key}"]\n')
        binary = self.write_private('binary', 'candidate')
        collector = self.write_private('collector', 'collector')
        pins = {name: linux_check.coordinator.artifact_hash(path)
                for name, path in [('server', binary), ('collector', collector)]}
        self.write_private('reader', json.dumps(dict(
            schema=1, duration_seconds=DAY + 25, max_attempts=6000, min_spacing_seconds=1,
            candidate_sha256=pins['server'], cases=[dict(
                id='seoul', method='GET', path='/weather/v000903/coord/37.566,126.978',
                interval_seconds=40, conditional=False,
            )],
        )))
        now = 1778256000
        cost, paid = linux_check.policies(now)
        paid['grants']['initial'] = dict.fromkeys(paid['grants']['initial'], 0)
        quota = [dict(api=api, kst_day=day, used=100, planned=50)
                 for api in ('1360000/VilageFcstInfoService_2.0', 'B552584/ArpltnInforInqireSvc')
                 for day in ('2026-05-08', '2026-05-09')]
        spec = dict(schema=1, config_file='config', dedicated_key_file='reference', reader_file='reader',
                    artifact_sha256=pins, daily_calls=quota, native_families=['kma'],
                    allowance=dict(reads=500, writes=500, put_bytes=1048576), cost_policy=cost, paid_policy=paid)
        plan = self.write_private('plan.json', json.dumps(spec))
        args = SimpleNamespace(rehearsal_input=plan, server_binary=binary, collector_tarball=collector)
        with patch.object(driver.time, 'time', return_value=now):
            prepared = driver.read_inputs(args, linux_check)
            self.assertIn('SERVER2_LOG_LEVEL=debug', prepared['config'])
            self.assertEqual(len(prepared['quotas']), 4)
            sanitized = json.dumps(prepared['preflight'])
            self.assertNotIn(key, sanitized)
            self.assertNotIn('authority.json', sanitized)
            binary.write_text('changed')
            with self.assertRaisesRegex(ValueError, 'artifact hash mismatch'):
                driver.read_inputs(args, linux_check)

    def test_collector_stop_needs_confirmed_s3_delivery_from_current_invocation(self):
        host = Mock()
        invocation = 'a' * 32
        for drained in (False, True):
            with self.subTest(drained=drained):
                record = {'event': 'collector.drained', 'destinations': {'s3': {'drained': drained}}}
                host.parsed = linux_check.parsed
                host.run.side_effect = [SimpleNamespace(stdout=invocation), SimpleNamespace(returncode=0),
                                        SimpleNamespace(stdout=json.dumps(record))]
                self.assertEqual(driver._drain_collector(host), drained)
                self.assertIn('_SYSTEMD_INVOCATION_ID=' + invocation, host.run.call_args.args)

    def test_one_quota_per_rust_acquirer_owner_and_kst_day(self):
        key = 'SYNTHETIC-REHEARSAL-KEY+ABC'
        reference = self.write_private('reference', key)
        config = self.write_private('config', f'DONGNAE_SECRET_KEYS=["{key}"]\nAIRKOREA_SECRET_KEYS=["{key}"]\n')
        rows = [dict(api=api, kst_day=day, used=0, planned=50)
                for api in rehearsal_inputs.API_LIMITS for day in ('2026-05-08', '2026-05-09')]
        _, caps, _ = driver.validated_config(config, reference, environment={'SERVER2_NATIVE_FAMILIES': 'kma'},
                                              daily_calls=rows)
        expected = {}
        air_apis = {'B552584/ArpltnInforInqireSvc', 'B552584/MsrstnInfoInqireSvc', 'B552584/ArpltnStatsSvc'}
        for row in rows:
            api, day = row['api'], row['kst_day']
            # live.rs::kst_day and observe.rs::DailyAcquirer::build both bound KST days.
            if api in air_apis:
                domain, window = 'AIRKOREA_SECRET_KEYS', {'2026-05-08': 'kst-20260508', '2026-05-09': 'kst-20260509'}[day]
            else:
                domain, window = 'DONGNAE_SECRET_KEYS', day
            owner = sha256('\0'.join(['server2-data-go-kr-api-quota-v2', domain, api, key]).encode()).hexdigest()
            expected[f'budgets/v2/data_go_kr/{owner}/{window}/authority.json'] = row['planned']
        self.assertEqual(len(expected), 26)
        self.assertEqual(caps, expected)

    def test_quota_dates_include_both_sides_of_kst_midnight(self):
        start = int(datetime(2026, 5, 8, 6, tzinfo=timezone.utc).timestamp())
        rows = [dict(api='kma', kst_day='2026-05-08'), dict(api='kma', kst_day='2026-05-09')]
        driver.confirm_quota_days(rows, start, start + DAY)
        with self.assertRaisesRegex(ValueError, 'actual KST dates'):
            driver.confirm_quota_days(rows[:1], start, start + DAY)

    def test_preflight_refusal_writes_incomplete_receipt_without_host_commands(self):
        out = self.root / 'output'
        args = SimpleNamespace(output_dir=out, report=out / 'report.json', source_commit='f' * 40,
                               rehearsal_input=self.root / 'missing')
        with patch.object(linux_check, 'run', side_effect=AssertionError('guest mutation')):
            self.assertEqual(driver.run(args, linux_check), 1)
        receipt = json.loads(args.report.read_text())
        self.assertEqual(receipt['status'], 'incomplete')
        self.assertEqual(receipt['failed_phase'], 'private-preflight')
        self.assertFalse((out / 'measurement.json').exists())


    def test_initial_stop_timer_precedes_install_and_finalize_is_bucket_first(self):
        start = int(datetime(2026, 5, 8, 6, tzinfo=timezone.utc).timestamp())
        fingerprint = dict.fromkeys(('server', 'collector', 'launch', 'reader'), 'f' * 64)
        for triggered in (True, False):
            with self.subTest(triggered=triggered):
                host = Mock()
                host.INSTALL_ROOT = self.root
                (self.root / driver.RUN_ID / 'state').mkdir(parents=True, exist_ok=True)
                (self.root / driver.RUN_ID / 'state' / 'guard.json').write_text('{}')
                host.run.return_value = SimpleNamespace(returncode=0, stdout='inactive')
                host.launch_user_data.return_value = SimpleNamespace(returncode=0)
                host.receive.return_value = SimpleNamespace(returncode=0, stdout=b'{}'), 2
                host.parsed.return_value = {'status': 'started', 'launch_sha256': fingerprint['launch']}
                host.wait_until.side_effect = lambda probe, *unused: probe()
                host.wait_final.return_value = {'kind': 'final', 'generation': 25}
                host.bucket_audit.return_value = {'complete': True}
                host.decision.return_value = {'stop': 's3_authorization'}
                args = SimpleNamespace(output_dir=self.root, source_commit='a' * 40)
                input_plan = {'reader': {'cases': []}, 'preflight': {'daily_calls': [
                    {'api': 'kma', 'kst_day': day} for day in ('2026-05-08', '2026-05-09')]}}
                events = []
                clock = [100]
                def startup(*a, **kw):
                    events.append('startup')
                def receive(*a):
                    events.append('install')
                    return SimpleNamespace(returncode=0, stdout=b'{}'), 2
                host.receive.side_effect = receive
                def collect(**callbacks):
                    events.append('collect')
                    callbacks['publish']({'complete': True})
                    clock[0] += DAY + 10
                    self.assertTrue(callbacks['request_stop']())
                    return {'complete': True}
                host.wait_final.side_effect = lambda *a: events.append('final') or {'kind': 'final'}
                host.bucket_audit.side_effect = lambda *a: events.append('audit') or {'complete': True}
                host.finish_cli_check.side_effect = lambda *a, **k: events.append('finish')
                report = linux_check.Report()
                with (patch.object(driver, '_snapshot_hashes', return_value=fingerprint),
                      patch.object(driver, 'arm_startup_stop', side_effect=startup),
                      patch.object(driver, 'arm_stop', return_value=DAY + 105) as timer,
                      patch.object(driver, 'collect_day', side_effect=collect),
                      patch.object(driver, '_deadline_ran', return_value=triggered),
                      patch.object(driver, '_drain_collector', return_value=True),
                      patch.object(driver, '_request_stop', return_value=True) as fallback,
                      patch.object(driver, 'ObserveHost'),
                      patch.object(driver, 'write_measurement') as checkpoint,
                      patch.object(driver, '_clock', side_effect=lambda: clock[0]),
                      patch.object(driver.time, 'time', return_value=start)):
                    output = {}
                    driver._run_isolated(args, host, self.root, {'epoch': start}, input_plan, output, report, Mock(), [False])
                self.assertEqual(output['guard_stop_reason'], 's3_authorization')
                self.assertEqual(fallback.call_count, int(not triggered))
                self.assertEqual(events, ['startup', 'install', 'collect', 'final', 'audit', 'finish'])
                self.assertEqual(timer.call_args.kwargs['start_monotonic'], 105)
                self.assertFalse(checkpoint.call_args.args[1]['complete'])
                self.assertEqual(report.passed(), triggered)


class RehearsalFinishTests(unittest.TestCase):
    def test_raw_upload_preserves_the_metadata_required_for_finish(self):
        # The shared host fixture registers isolated module copies while importing.
        with patch.dict(sys.modules):
            from shadow_finish_fixture import build_fixture, state as fixture_state
            from test_shadow_supervisor import provision as fixture_provision

        with TemporaryDirectory() as tmp:
            work = Path(tmp).resolve()
            source = work / 'fixture'
            epoch = int(time.time())
            evidence = build_fixture(source, attempts=1, body_bytes=8, epoch=epoch)
            run_id = evidence['run_id']
            bucket = f'server2-shadow-{run_id}-raw'
            standin_state = work / 'standin'
            for version in evidence['versions']:
                if version['bucket'] == evidence['state_bucket']:
                    path = standin_state / 's3' / version['key']
                    path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(source / version['path'], path)

            module = importlib.util.spec_from_file_location('standin', linux_check.LOGGING / 'standin.py')
            standin = importlib.util.module_from_spec(module)
            module.loader.exec_module(standin)
            raw = b'synthetic raw response'
            body = gzip.compress(raw, mtime=0)
            identity = dict(source='kma', kind='current', key_sha256='a' * 64,
                            period=dict(local_date=20260131, slot='2300'), fetched_at_ms=1000,
                            raw_sha256=hashlib.sha256(raw).hexdigest())
            key = f"raw/v2/kma/current/2026/01/31/2300/{identity['key_sha256']}/1000-{identity['raw_sha256']}.raw.gz"
            envelope = base64.b64encode(json.dumps(dict(schema=2, identity=identity)).encode()).decode()
            metadata = {'s2-record': envelope, 's2-gzip-sha256': hashlib.sha256(body).hexdigest()}
            headers = {'If-None-Match': '*', **{'X-Amz-Meta-' + k: v for k, v in metadata.items()}}
            with standin.ThreadingHTTPServer(('127.0.0.1', 0), standin.Handler) as server:
                server.state, server.data_buckets, server.lock = standin_state, {bucket}, threading.Lock()
                thread = threading.Thread(target=server.serve_forever)
                thread.start()
                try:
                    with contextlib.closing(http.client.HTTPConnection(*server.server_address, timeout=5)) as conn:
                        path = f'/{bucket}/{key}'
                        conn.request('PUT', path, body, headers)
                        response = conn.getresponse()
                        self.assertEqual((response.status, response.read()), (200, b''))
                        for method in ('HEAD', 'GET'):
                            conn.request(method, path)
                            response = conn.getresponse()
                            self.assertEqual(response.status, 200)
                            self.assertEqual(response.getheader('Content-Length'), str(len(body)))
                            self.assertEqual({k: response.getheader('x-amz-meta-' + k) for k in metadata}, metadata)
                            self.assertEqual(response.read(), b'' if method == 'HEAD' else body)
                finally:
                    server.shutdown()
                    thread.join()

            run = work / 'runs' / run_id
            (run / 'bundle').mkdir(parents=True)
            shutil.copyfile(source / 'source/launch.json', run / 'bundle/launch.json')
            with linux_check.state.Journal(run / 'journal', create=True, run_id=run_id,
                                           manifest_sha='a' * 64, epoch=epoch):
                pass
            (work / run_id / 'data').mkdir(parents=True)
            expected = work / 'audit' / run_id / 'files'
            expected.mkdir(parents=True)
            for name in evidence['expected_pairs']:
                shutil.copyfile(source / evidence['paired_directory'] / name, expected / name)
            entry = {'observations': {}}
            with (patch.object(linux_check, 'WORK', work), patch.object(linux_check, 'INSTALL_ROOT', work),
                  patch.object(linux_check, 'STANDIN_STATE', standin_state),
                  patch.object(linux_check, 'state', fixture_state), patch.dict(sys.modules, provision=fixture_provision)):
                linux_check.finish_cli_check(Mock(), entry, run_id, include_originals=True)
            self.assertEqual(entry['observations']['finish_cli']['exit_code'], 0)
            self.assertTrue(entry['observations']['finish_cli']['cleanup_complete'])
            exported = json.loads((run / 'finish/sources/manifest.json').read_bytes())
            original, = [row for row in exported['objects'] if row['bucket'] == bucket]
            self.assertEqual(original['headers']['Metadata'], metadata)
            self.assertEqual((run / 'finish/sources' / original['file']).read_bytes(), body)


class RehearsalDataBucketTests(unittest.TestCase):
    def setUp(self):
        path = Path(linux_check.LOGGING) / 'standin.py'
        spec = importlib.util.spec_from_file_location('standin', path)
        standin = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(standin)
        self.state = Path(self.enterContext(TemporaryDirectory()))
        self.server = self.enterContext(standin.ThreadingHTTPServer(('127.0.0.1', 0), standin.Handler))
        self.server.state = self.state
        self.server.data_buckets = {'local-data'}
        self.server.lock = threading.RLock()
        thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': 0.02})
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(self.server.shutdown)

    def request(self, method, key='', body=None, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        try:
            conn.request(method, '/local-data/' + key, body, headers or {})
            reply = conn.getresponse()
            return reply.status, dict((k.lower(), v) for k, v in reply.getheaders()), reply.read()
        finally:
            conn.close()

    def test_raw_encoding_metadata_and_conditional_control_replacement(self):
        raw = 'raw/v2/example'
        initial = {'Content-Type': 'application/gzip', 'Content-Encoding': 'aws-chunked',
                   'X-Amz-Meta-Digest': 'test-digest'}
        self.assertEqual(self.request('PUT', raw, b'3\r\nabc\r\n0\r\n\r\n', initial)[0], 200)
        for method in ('HEAD', 'GET'):
            status, headers, payload = self.request(method, raw)
            self.assertEqual((status, headers['content-type'], headers['content-length']), (200, 'application/gzip', '3'))
            self.assertNotIn('content-encoding', headers)
            self.assertEqual(headers['x-amz-meta-digest'], 'test-digest')
            self.assertEqual(payload, b'abc' if method == 'GET' else b'')
        self.assertEqual(self.request('PUT', raw, b'3\r\nabc\r\n0\r\n\r\n',
                                      dict(initial, **{'Content-Encoding': 'gzip, AWS-CHUNKED'}))[0], 200)
        _, retained, body = self.request('GET', raw)
        self.assertEqual((retained['content-encoding'], body), ('gzip', b'abc'))

        key = 'index/v2/cursor.json'
        new = {'Content-Type': 'application/json', 'If-None-Match': '*'}
        status, first, _ = self.request('PUT', key, b'[1]', new)
        self.assertEqual(status, 200)
        self.assertEqual(self.request('PUT', key, b'[2]', new)[0], 412)
        condition = {'If-Match': first['etag'], 'Content-Type': 'application/json'}
        self.assertEqual(self.request('PUT', 'index/v2/missing', b'[2]', condition)[0], 412)
        status, second, _ = self.request('PUT', key, b'[2]', condition)
        self.assertEqual(status, 200)
        self.assertNotEqual(first['etag'], second['etag'])
        self.assertEqual(self.request('PUT', key, b'[3]', condition)[0], 412)
        for method in ('GET', 'HEAD'):
            status, headers, payload = self.request(method, key)
            self.assertEqual((status, headers['etag'], headers['content-type']), (200, second['etag'], 'application/json'))
            self.assertEqual(payload, b'[2]' if method == 'GET' else b'')

    def test_rejected_metadata_preserves_previous_body_headers_and_etag(self):
        raw = 'raw/v2/example'
        headers = {'Content-Type': 'application/gzip', 'Content-Encoding': 'custom',
                   'X-Amz-Meta-Digest': 'accepted'}
        self.assertEqual(self.request('PUT', raw, b'original', headers)[0], 200)
        _, original, _ = self.request('GET', raw)
        for invalid in ('Content-Type', 'Content-Encoding', 'X-Amz-Meta-Bad'):
            with self.subTest(invalid=invalid):
                attempted = {'Content-Type': 'text/plain', 'X-Amz-Meta-Digest': 'new',
                             invalid: 'bad\r\n folded'}
                self.assertEqual(self.request('PUT', raw, b'replacement', attempted)[0], 400)
                status, held, data = self.request('GET', raw)
                self.assertEqual((status, data), (200, b'original'))
                for header in ('content-type', 'content-encoding', 'x-amz-meta-digest', 'etag'):
                    self.assertEqual(held[header], original[header])

    def test_namespaced_list_uses_only_matching_directory_and_returns_bounded_pages(self):
        for key in ('raw/v2/a/1', 'raw/v2/a/2', 'raw/v2/ab/1'):
            self.assertEqual(self.request('PUT', key, b'x')[0], 200)
        find_paths = []
        original = Path.rglob

        def counted(directory, pattern):
            find_paths.append(directory)
            return original(directory, pattern)

        params = {'list-type': 2, 'prefix': 'raw/v2/a/', 'max-keys': 1}
        ns = '{http://s3.amazonaws.com/doc/2006-03-01/}'
        for page, truncated in [('raw/v2/a/1', 'true'), ('raw/v2/a/2', 'false')]:
            with patch.object(Path, 'rglob', counted):
                status, _, body = self.request('GET', '?' + urlencode(params))
            self.assertEqual(status, 200)
            xml = ElementTree.fromstring(body)
            self.assertEqual(xml.tag, ns + 'ListBucketResult')
            self.assertEqual(xml.findtext(ns + 'IsTruncated'), truncated)
            self.assertEqual(xml.findtext(ns + 'KeyCount'), '1')
            self.assertEqual([key.text for key in xml.findall(ns + 'Contents/' + ns + 'Key')], [page])
            params['continuation-token'] = xml.findtext(ns + 'NextContinuationToken')
        self.assertIsNone(params['continuation-token'])
        self.assertEqual(find_paths, [self.state / 'data/local-data/raw/v2/a'] * 2)

    def test_quota_authority_keeps_its_own_cas_and_witness_limits(self):
        owner, window = 'b' * 64, 'kst-20260508'
        prefix = f'budgets/v2/data_go_kr/{owner}/{window}/'
        authority = prefix + 'authority.json'
        witness = prefix + 'blocks/0-3.json'
        self.server.rehearsal_quotas = {authority: 3}

        def put(key, conditions, **fields):
            record = {'version': 2, 'policy': {'provider': 'data_go_kr', 'quota_id': owner, 'window_id': window},
                      **fields}
            return self.request('PUT', key, json.dumps(record).encode(), conditions)

        absent = {'If-None-Match': '*'}
        self.assertEqual(put(witness, absent, start=0, end=3)[0], 429)
        status, first, _ = put(authority, absent, used=1)
        self.assertEqual(status, 200)
        self.assertEqual(self.request('HEAD', authority)[1]['etag'], first['etag'])
        condition = {'If-Match': first['etag']}
        self.assertEqual(put(authority, condition, used=4)[0], 429)
        self.assertEqual(put(authority, condition, used=3)[0], 200)
        self.assertEqual(put(authority, condition, used=2)[0], 412)
        self.assertEqual(json.loads(self.request('GET', authority)[2])['used'], 3)
        self.assertEqual(put(witness, absent, start=0, end=3)[0], 200)
        self.assertEqual(put(witness, absent, start=0, end=3)[0], 412)
        for key in (authority, witness):
            for method in ('GET', 'HEAD'):
                with self.subTest(key=key, method=method):
                    status, headers, _ = self.request(method, key)
                    self.assertEqual(status, 200)
                    self.assertEqual(headers['content-type'], 'application/json')

    def test_list_rejects_invalid_limits_and_paths_without_crossing_buckets(self):
        for invalid in ('', 'NaN', '-1', '1001', '2.0', '1&max-keys=2'):
            with self.subTest(limit=invalid):
                self.assertEqual(self.request('GET', '?list-type=2&max-keys=' + invalid)[0], 400)
        self.assertEqual(self.request('GET', '?list-type=2&max-keys=0')[0], 200)
        for prefix in ('../', '/outside/', 'raw/v2/../../', 'raw/./', 'raw//v2/'):
            with self.subTest(prefix=prefix):
                self.assertEqual(self.request('GET', '?' + urlencode({'prefix': prefix}))[0], 400)
        directory = self.state / 'data/local-data'
        directory.mkdir(parents=True, exist_ok=True)
        other = self.state / 'another-bucket'
        other.mkdir()
        (other / 'secret').write_text('synthetic')
        (directory / 'link').symlink_to(other, target_is_directory=True)
        (directory / 'alias').symlink_to(other / 'secret')
        self.assertEqual(self.request('GET', '?prefix=link%2F')[0], 400)
        status, _, body = self.request('GET', '?list-type=2')
        self.assertEqual(status, 200)
        self.assertNotIn(b'<Key>alias</Key>', body)
        self.assertNotIn(b'secret', body)


class RehearsalQuotaTests(unittest.TestCase):
    def test_standin_accepts_each_native_window_but_refuses_two_caps_for_one_owner_day(self):
        path = Path(linux_check.LOGGING) / 'standin.py'
        spec = importlib.util.spec_from_file_location('standin', path)
        standin = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(standin)
        air = 'budgets/v2/data_go_kr/' + 'a' * 64 + '/kst-20260508/authority.json'
        kma = 'budgets/v2/data_go_kr/' + 'b' * 64 + '/2026-05-08/authority.json'
        with TemporaryDirectory() as tmp:
            caps = Path(tmp) / 'caps.json'
            caps.write_text(json.dumps({air: 50, kma: 100}))
            args = ['standin.py', '--state', tmp, '--port', '0', '--bucket', 'state', '--rehearsal-quotas', str(caps)]
            with (patch.object(sys, 'argv', args), patch.object(standin, 'ThreadingHTTPServer') as server,
                  patch.object(standin.signal, 'signal'), contextlib.redirect_stderr(io.StringIO())):
                standin.main()
                self.assertEqual(server.return_value.rehearsal_quotas, {air: 50, kma: 100})
                server.reset_mock()
                caps.write_text(json.dumps({air: 50, kma: 100, kma.replace('2026-05-08', 'kst-20260508'): 100}))
                with self.assertRaises(SystemExit):
                    standin.main()
                server.assert_not_called()

    def test_two_conditional_authority_writes_bound_each_funded_witness(self):
        path = Path(linux_check.LOGGING) / 'standin.py'
        spec = importlib.util.spec_from_file_location('standin', path)
        standin = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(standin)
        handler = standin.Handler.__new__(standin.Handler)
        handler.reply = Mock()
        account = 'b' * 64
        window = 'kst-20260508'
        prefix = f'budgets/v2/data_go_kr/{account}/{window}/'
        authority = prefix + 'authority.json'
        policy = {'provider': 'data_go_kr', 'quota_id': account, 'window_id': window}
        def request(root, key, headers, status, **fields):
            handler.headers = headers
            body = json.dumps(dict(version=2, policy=policy, **fields)).encode()
            handler.put_quota(root, root / key, body, {authority: 100}, key)
            self.assertEqual(handler.reply.call_args.args[0], status)
            return handler.reply.call_args.args[-1]['ETag'] if status == 200 else None
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            witness = prefix + 'blocks/0-50.json'
            absent = {'If-None-Match': '*'}
            request(root, witness, absent, 429, start=0, end=50)
            initial = request(root, authority, absent, 200, used=50)
            request(root, witness, absent, 200, start=0, end=50)
            next_etag = request(root, authority, {'If-Match': initial}, 200, used=100)
            request(root, authority, {'If-Match': initial}, 412, used=60)
            request(root, authority, {'If-Match': next_etag}, 429, used=150)
            request(root, prefix + 'blocks/100-150.json', absent, 429, start=100, end=150)
            unapproved = authority.replace(window, 'kst-20260509')
            request(root, unapproved, absent, 429, used=50)
            self.assertEqual(json.loads((root / authority).read_text())['used'], 100)


if __name__ == '__main__':
    unittest.main()
