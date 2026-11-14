#!/usr/bin/env python3
"""Offline checks of the log pipeline's settings, rendering and installed files.

They need neither systemd nor the collector binary, so CI runs them. The
integrated behaviour on Linux is checked by linux_check.py in a disposable VM.
"""
import configparser
import contextlib
import io
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import render  # noqa: E402

SECRET = 'SYNTHETIC-PRIVATE-2802'
COMPLETE = {'SERVER2_LOG_SINKS': 'local,s3,cloudwatch', 'SERVER2_S3_BUCKET': 'tw-server2-logs',
            'SERVER2_S3_REGION': 'ap-northeast-2', 'SERVER2_LOG_S3_PREFIX': 'logs/server2',
            'SERVER2_LOG_CLOUDWATCH_GROUP': '/server2/production'}


def error_of(values):
    with self_raises() as caught:
        render.settings(values)
    return caught


@contextlib.contextmanager
def self_raises():
    holder = {}
    try:
        yield holder
    except render.SettingError as exc:
        holder['error'] = exc
    else:
        raise AssertionError('settings were accepted')


class DotenvTest(unittest.TestCase):
    def test_follows_the_server2_rules_for_allowlisted_names(self):
        text = ('﻿SERVER2_LOG_SINKS = s3 ,cloudwatch \r\n'
                '# SERVER2_LOG_S3_LEVEL=debug\n'
                'export SERVER2_LOG_CLOUDWATCH_LEVEL=info\n'
                'SERVER2_LOG_S3_PREFIX="logs/a"\r'
                "SERVER2_S3_BUCKET='bucket-one'\n"
                'SERVER2_S3_REGION=ap-northeast-2\n'
                'SERVER2_S3_REGION=us-east-1\n'
                f'DONGNAE_SECRET_KEYS={SECRET}\n')
        values = render.parse_dotenv(text)
        self.assertEqual(values, {'SERVER2_LOG_SINKS': 's3 ,cloudwatch', 'SERVER2_LOG_S3_PREFIX': 'logs/a',
                                  'SERVER2_S3_BUCKET': 'bucket-one', 'SERVER2_S3_REGION': 'us-east-1'})
        self.assertNotIn(SECRET, json.dumps(values))

    def test_process_environment_wins_even_when_empty(self):
        looked = render.lookup({'SERVER2_LOG_SINKS': ''}, {'SERVER2_LOG_SINKS': 's3', 'SERVER2_S3_BUCKET': 'b-1'})
        self.assertEqual(looked['SERVER2_LOG_SINKS'], '')
        self.assertEqual(looked['SERVER2_S3_BUCKET'], 'b-1')
        self.assertEqual(set(looked), set(render.ALLOWED))


class SettingsTest(unittest.TestCase):
    def test_defaults_select_the_local_journal_only(self):
        self.assertEqual(render.settings({}), {'sinks': ['local'], 's3_level': 'info', 'cloudwatch_level': 'warn'})

    def test_complete_selection(self):
        config = render.settings(dict(COMPLETE, SERVER2_LOG_S3_LEVEL='debug', SERVER2_LOG_CLOUDWATCH_LEVEL='error'))
        self.assertEqual(config['sinks'], ['local', 's3', 'cloudwatch'])
        self.assertEqual((config['s3_level'], config['cloudwatch_level']), ('debug', 'error'))

    def test_rejections_name_the_variable_and_never_echo_the_value(self):
        cases = [
            (dict(COMPLETE, SERVER2_LOG_SINKS=f's3,{SECRET}'), 'SERVER2_LOG_SINKS'),
            (dict(COMPLETE, SERVER2_LOG_SINKS=''), 'SERVER2_LOG_SINKS'),
            (dict(COMPLETE, SERVER2_LOG_SINKS='s3,,cloudwatch'), 'SERVER2_LOG_SINKS'),
            (dict(COMPLETE, SERVER2_LOG_S3_LEVEL=SECRET), 'SERVER2_LOG_S3_LEVEL'),
            (dict(COMPLETE, SERVER2_LOG_CLOUDWATCH_LEVEL='WARN'), 'SERVER2_LOG_CLOUDWATCH_LEVEL'),
            ({k: v for k, v in COMPLETE.items() if k != 'SERVER2_LOG_S3_PREFIX'}, 'SERVER2_LOG_S3_PREFIX'),
            ({k: v for k, v in COMPLETE.items() if k != 'SERVER2_LOG_CLOUDWATCH_GROUP'}, 'SERVER2_LOG_CLOUDWATCH_GROUP'),
            ({k: v for k, v in COMPLETE.items() if k != 'SERVER2_S3_BUCKET'}, 'SERVER2_S3_BUCKET'),
            (dict(COMPLETE, SERVER2_S3_REGION=SECRET), 'SERVER2_S3_REGION'),
            (dict(COMPLETE, SERVER2_S3_BUCKET=SECRET), 'SERVER2_S3_BUCKET'),
            (dict(COMPLETE, SERVER2_LOG_CLOUDWATCH_GROUP='bad group ' + SECRET), 'SERVER2_LOG_CLOUDWATCH_GROUP'),
        ]
        for prefix in ('/logs', 'logs/', 'logs//a', 'logs/../raw', 'raw/v2/logs', 'state', 'logs/a b', SECRET + '?'):
            cases.append((dict(COMPLETE, SERVER2_LOG_S3_PREFIX=prefix), 'SERVER2_LOG_S3_PREFIX'))
        for values, variable in cases:
            with self.subTest(variable=variable, values=values):
                caught = error_of(values)['error']
                self.assertEqual(caught.variable, variable)
                self.assertTrue(str(caught).startswith(variable + ': '))
                self.assertNotIn(SECRET, str(caught))
                if variable == 'SERVER2_LOG_CLOUDWATCH_LEVEL':
                    self.assertNotIn('WARN', str(caught))

    def test_region_defaults_like_server2(self):
        values = {k: v for k, v in COMPLETE.items() if k != 'SERVER2_S3_REGION'}
        self.assertEqual(render.settings(values)['region'], 'ap-northeast-2')

    def test_s3_only_does_not_need_a_log_group_and_cloudwatch_only_not_a_bucket(self):
        render.settings({'SERVER2_LOG_SINKS': 's3', 'SERVER2_S3_BUCKET': 'b-1', 'SERVER2_S3_REGION': 'ap-northeast-2',
                         'SERVER2_LOG_S3_PREFIX': 'logs'})
        render.settings({'SERVER2_LOG_SINKS': 'cloudwatch', 'SERVER2_S3_REGION': 'ap-northeast-2',
                         'SERVER2_LOG_CLOUDWATCH_GROUP': '/server2/x'})


class RenderTest(unittest.TestCase):
    def rendered(self, **overrides):
        config = render.settings(dict(COMPLETE, **overrides))
        return render.collector_config(config, 'a' * 32, '/var/lib/server2-logs')

    def test_one_journal_reader_and_filter_per_remote_destination(self):
        out = self.rendered()
        self.assertEqual(set(out['sources']), {'journal_s3', 'journal_cloudwatch'})
        self.assertEqual(set(out['sinks']), {'s3', 'cloudwatch'})
        for name, source in out['sources'].items():
            self.assertEqual(source['type'], 'journald')
            self.assertEqual(source['journal_namespace'], 'server2')
            self.assertEqual(source['include_units'], ['server2.service', 'server2-logs.service'])
        self.assertEqual(out['sinks']['s3']['inputs'], ['select_s3'])
        self.assertEqual(out['transforms']['select_s3']['inputs'], ['journal_s3'])
        self.assertEqual(out['timezone'], 'UTC')

    def test_only_selected_destinations_are_rendered(self):
        out = self.rendered(SERVER2_LOG_SINKS='cloudwatch')
        self.assertEqual(set(out['sinks']), {'cloudwatch'})
        self.assertEqual(set(out['sources']), {'journal_cloudwatch'})

    def test_naming_contract(self):
        out = self.rendered()
        self.assertEqual(out['sinks']['s3']['key_prefix'],
                         'logs/server2/{{ log_source }}/dt=%Y-%m-%d/hour=%H/' + 'a' * 32 + '/{{ log_boot }}-')
        self.assertEqual(out['sinks']['s3']['filename_time_format'], '%Y%m%dT%H%M%SZ')
        self.assertTrue(out['sinks']['s3']['filename_append_uuid'])
        self.assertEqual(out['sinks']['s3']['filename_extension'], 'ndjson.gz')
        self.assertEqual(out['sinks']['cloudwatch']['stream_name'], '{{ log_source }}/' + 'a' * 32 + '/{{ log_boot }}')

    def test_least_privilege_and_delivery_settings(self):
        out = self.rendered()
        for sink in out['sinks'].values():
            self.assertEqual(sink['healthcheck'], {'enabled': False})  # no HeadBucket/DescribeLogGroups
            self.assertEqual(sink['acknowledgements'], {'enabled': True})
            self.assertEqual(sink['encoding'], {'codec': 'text'})  # the original line, unchanged
            self.assertNotIn('endpoint', sink)
            self.assertNotIn('auth', sink)  # credentials come from the instance role
        self.assertFalse(out['sinks']['cloudwatch']['create_missing_group'])
        self.assertEqual(out['sinks']['s3']['batch']['timeout_secs'], 60)
        self.assertEqual(out['sinks']['cloudwatch']['batch']['timeout_secs'], 1)

    def test_filter_thresholds(self):
        out = self.rendered(SERVER2_LOG_S3_LEVEL='debug', SERVER2_LOG_CLOUDWATCH_LEVEL='error')
        self.assertIn('if rank < 0 { abort }', out['transforms']['select_s3']['source'])
        self.assertIn('if rank < 3 { abort }', out['transforms']['select_cloudwatch']['source'])
        for transform in out['transforms'].values():
            self.assertTrue(transform['drop_on_abort'])
            self.assertIn('parsed.schema != 1', transform['source'])
            self.assertIn('parsed.collector_schema != 1', transform['source'])

    def test_rendered_configuration_holds_only_allowlisted_values(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / '.env'
            env.write_text(''.join(f'{k}={v}\n' for k, v in COMPLETE.items()) + f'DONGNAE_SECRET_KEYS={SECRET}\nAWS_SECRET_KEY={SECRET}-2\n')
            output = Path(directory) / 'run' / 'vector.json'
            stdout, stderr = io.StringIO(), io.StringIO()
            with mock.patch.object(render, 'machine_id', return_value='b' * 32), \
                    mock.patch.object(render.Path, 'read_text', autospec=True, side_effect=_read_text_with_boot), \
                    contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                code = render.main(['--env-file', str(env), '--state', '/var/lib/server2-logs', '--output', str(output),
                                    '--version-file', str(HERE / 'collector.json')], environ={})
            self.assertEqual(code, 0)
            text = output.read_text()
            self.assertNotIn(SECRET, text)
            self.assertNotIn(SECRET, stdout.getvalue() + stderr.getvalue())
            start = json.loads(stdout.getvalue())
            self.assertEqual(start['event'], 'collector.started')
            self.assertEqual(start['collector_schema'], 1)
            self.assertEqual(start['collector_version'], 'vector 0.61.0')
            self.assertEqual(start['sinks'], ['local', 's3', 'cloudwatch'])
            self.assertEqual(start['instance_id'], 'b' * 32)
            self.assertEqual(start['boot_id'], 'c' * 32)

    def test_exit_codes_follow_exec_condition(self):
        with tempfile.TemporaryDirectory() as directory:
            args = ['--env-file', str(Path(directory) / 'missing.env'), '--state', directory,
                    '--output', str(Path(directory) / 'out.json'), '--version-file', str(HERE / 'collector.json')]
            with contextlib.redirect_stderr(io.StringIO()) as err:
                self.assertEqual(render.main(args, environ={}), 1)
            self.assertIn('only the local journal', err.getvalue())
            self.assertFalse((Path(directory) / 'out.json').exists())
            with contextlib.redirect_stderr(io.StringIO()) as err:
                self.assertEqual(render.main(args, environ={'SERVER2_LOG_SINKS': f's3,{SECRET}'}), 255)
            self.assertIn('SERVER2_LOG_SINKS', err.getvalue())
            self.assertNotIn(SECRET, err.getvalue())


def _read_text_with_boot(self, *args, **kwargs):
    if str(self) == '/proc/sys/kernel/random/boot_id':
        return 'cccccccc-cccc-cccc-cccc-cccccccccccc\n'
    return _ORIGINAL_READ_TEXT(self, *args, **kwargs)


_ORIGINAL_READ_TEXT = Path.read_text


class InstalledFilesTest(unittest.TestCase):
    def unit(self, name):
        parser = configparser.ConfigParser(strict=False, interpolation=None)
        parser.optionxform = str
        parser.read(HERE / 'units' / name)
        return parser

    def test_server_does_not_require_the_collector_and_stops_first(self):
        unit = self.unit('server2.service')
        after = unit['Unit']['After'].split()
        self.assertIn('server2-logs.service', after)
        for key in ('Requires', 'Requisite', 'BindsTo', 'PartOf', 'Wants'):
            self.assertNotIn('server2-logs.service', unit['Unit'].get(key, ''))
        self.assertEqual(unit['Service']['LogNamespace'], 'server2')
        self.assertEqual(unit['Service']['LogRateLimitIntervalSec'], '0')
        self.assertNotIn('EnvironmentFile', unit['Service'])

    def test_collector_unit(self):
        unit = self.unit('server2-logs.service')['Service']
        self.assertTrue(unit['ExecCondition'].startswith('+/usr/bin/python3 -I /opt/server2/logging/render.py '))
        self.assertEqual(unit['LogNamespace'], 'server2')
        self.assertEqual(unit['DynamicUser'], 'yes')
        self.assertEqual(unit['Restart'], 'on-abnormal')
        self.assertNotIn('EnvironmentFile', unit)
        self.assertNotIn('Environment', unit)

    def test_journal_namespace_is_capped_without_rate_limit(self):
        parser = configparser.ConfigParser()
        parser.read(HERE / 'units' / 'journald@server2.conf')
        journal = parser['Journal']
        self.assertEqual(journal['SystemMaxUse'], '1G')
        self.assertEqual(journal['RateLimitIntervalSec'], '0')
        self.assertEqual(journal['Storage'], 'persistent')

    def test_collector_manifest_pins_both_architectures(self):
        manifest = json.loads((HERE / 'collector.json').read_text())
        self.assertEqual(set(manifest['artifacts']), {'aarch64', 'x86_64'})
        for arch, artifact in manifest['artifacts'].items():
            self.assertRegex(artifact['sha256'], r'^[0-9a-f]{64}$')
            self.assertIn(manifest['version'], artifact['url'])
            self.assertTrue(artifact['url'].startswith('https://github.com/vectordotdev/vector/releases/download/'))
            self.assertIn(arch, artifact['binary'])

    def test_installer_verifies_the_archive_before_extracting(self):
        text = (HERE / 'install.sh').read_text()
        self.assertLess(text.index('sha256sum --check'), text.index('tar -xzf'))
        self.assertNotRegex(text, re.compile(r'systemctl\s+(start|restart)\s+server2\.service'))


if __name__ == '__main__':
    unittest.main()
