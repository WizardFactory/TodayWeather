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
import aws_templates  # noqa: E402

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

    def test_javascript_whitespace_and_line_terminators_like_server2(self):
        # The cases of server2/src/dotenv.rs `javascript_whitespace_and_line_terminators`
        # (CX-LP1-001), on allowlisted names: U+FEFF counts as space, U+0085 does not,
        # and a line whose value continues after U+2028 is not a setting.
        values = render.parse_dotenv(
            '# comment\n'
            '﻿SERVER2_LOG_SINKS=cloudwatch\n'
            'SERVER2_S3_BUCKET=﻿ bucket-one　\n'
            'SERVER2_LOG_S3_PREFIX=\u0085logs\u0085\n'
            'SERVER2_LOG_CLOUDWATCH_GROUP=/server2/x   \n'
            'SERVER2_S3_REGION=ap-northeast-2 ,us-east-1\n')
        self.assertEqual(values, {'SERVER2_LOG_SINKS': 'cloudwatch', 'SERVER2_S3_BUCKET': 'bucket-one',
                                  'SERVER2_LOG_S3_PREFIX': '\u0085logs\u0085',
                                  'SERVER2_LOG_CLOUDWATCH_GROUP': '/server2/x'})

    def test_server2_dotenv_cases_on_allowlisted_names(self):
        # server2/src/dotenv.rs `parses_like_dotenv_10`, renamed to allowlisted keys.
        values = render.parse_dotenv(
            'SERVER2_LOG_SINKS=value\r\n'
            '  SERVER2_LOG_S3_LEVEL = padded value  \n'
            'SERVER2_LOG_CLOUDWATCH_LEVEL="a\\nb"\n'
            "SERVER2_LOG_S3_PREFIX='[\"k1\",\"k2\"]'\r"
            'SERVER2_LOG_CLOUDWATCH_GROUP=\n'
            'export SERVER2_S3_BUCKET=1\n'
            'SERVER2_S3_REGION="quoted"  \n')
        self.assertEqual(values, {'SERVER2_LOG_SINKS': 'value', 'SERVER2_LOG_S3_LEVEL': 'padded value',
                                  'SERVER2_LOG_CLOUDWATCH_LEVEL': 'a\nb', 'SERVER2_LOG_S3_PREFIX': '["k1","k2"]',
                                  'SERVER2_LOG_CLOUDWATCH_GROUP': '', 'SERVER2_S3_REGION': '"quoted"'})
        self.assertEqual(render.parse_dotenv('SERVER2_LOG_SINKS="\n'), {'SERVER2_LOG_SINKS': '"'})

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
            (dict(COMPLETE, SERVER2_LOG_CLOUDWATCH_GROUP='aws/reserved'), 'SERVER2_LOG_CLOUDWATCH_GROUP'),  # CX-LP5-003
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

    def test_every_preparation_failure_fails_the_unit(self):
        # CX-LP1-002: exit code 1 means "local only, skip"; any other failure must be 255.
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / '.env'
            env.write_text(''.join(f'{k}={v}\n' for k, v in COMPLETE.items()) + f'DONGNAE_SECRET_KEYS={SECRET}\n')
            base = ['--env-file', str(env), '--state', directory, '--output', str(Path(directory) / 'out.json')]
            cases = {
                'missing manifest': (base + ['--version-file', str(Path(directory) / 'missing.json')], {}),
                'broken manifest': (base + ['--version-file', str(env)], {}),
                'unwritable output': (base + ['--version-file', str(HERE / 'collector.json')],
                                      {'os.replace': OSError(28, 'No space left on device')}),
                'unreadable identity': (base + ['--version-file', str(HERE / 'collector.json')],
                                        {'machine_id': OSError(2, 'No such file')}),
            }
            for name, (args, faults) in cases.items():
                with self.subTest(name), contextlib.ExitStack() as stack:
                    # Host identity is a fixture unless the case injects its failure, so each
                    # case reaches the step it tests on any OS (CX-LP1-004).
                    stack.enter_context(mock.patch.object(render, 'machine_id', side_effect=faults.get('machine_id'),
                                                          return_value='b' * 32))
                    stack.enter_context(mock.patch.object(render.Path, 'read_text', autospec=True,
                                                          side_effect=_read_text_with_boot))
                    replace = stack.enter_context(mock.patch.object(render.os, 'replace',
                                                                    side_effect=faults.get('os.replace')))
                    err = stack.enter_context(contextlib.redirect_stderr(io.StringIO()))
                    stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
                    self.assertEqual(render.main(args, environ={}), 255)
                    self.assertIn('the collector is not started', err.getvalue())
                    self.assertNotIn(SECRET, err.getvalue())
                    if 'os.replace' in faults:
                        self.assertEqual(replace.call_count, 1, 'the write failure was not reached')
                        self.assertIn('(OSError)', err.getvalue())


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


class AwsTemplatesTest(unittest.TestCase):
    """LP-5 (#2982): least-privilege role, lifecycle and log group templates."""

    def lifecycle(self, prefix='logs/server2'):
        values = {'BucketName': 'b-1', 'LogPrefix': prefix, 'LogGroupName': '/server2/x',
                  'Region': 'ap-northeast-2', 'AccountId': '123456789012'}
        return json.loads(aws_templates.fill(json.dumps(aws_templates.load('bucket-lifecycle')), values))

    def test_role_policy_is_exactly_the_approved_grants(self):
        self.assertEqual(aws_templates.policy_violations(aws_templates.load('role-policy')), [])

    def test_policy_check_rejects_any_broader_or_extra_grant(self):
        base = aws_templates.load('role-policy')
        def mutated(change):
            policy = json.loads(json.dumps(base))
            change(policy['Statement'])
            return aws_templates.policy_violations(policy)
        changes = {
            'extra logs action': lambda st: st[1]['Action'].append('logs:DeleteLogGroup'),
            'group creation': lambda st: st.append({'Effect': 'Allow', 'Action': 'logs:CreateLogGroup', 'Resource': '*'}),
            'retention change': lambda st: st.append({'Effect': 'Allow', 'Action': 'logs:PutRetentionPolicy',
                                                      'Resource': st[2]['Resource'][0]}),
            'wildcard resource': lambda st: st[0].update(Resource='arn:aws:s3:::${BucketName}/*'),
            'read logs back': lambda st: st[0]['Action'].append('s3:GetObject'),
            'list bucket': lambda st: st.append({'Effect': 'Allow', 'Action': 's3:ListBucket',
                                                 'Resource': 'arn:aws:s3:::${BucketName}'}),
            'delete objects': lambda st: st[0]['Action'].append('s3:DeleteObject'),
            'service wildcard': lambda st: st[1].update(Action='logs:*'),
            'condition': lambda st: st[0].update(Condition={'Bool': {'aws:SecureTransport': 'true'}}),
            'missing describe': lambda st: st.pop(2),
        }
        for name, change in changes.items():
            with self.subTest(name):
                self.assertTrue(mutated(change))

    def test_collector_actions_equal_the_policy(self):
        self.assertEqual(aws_templates.allowed_actions(), {('s3', 'PutObject'), ('logs', 'CreateLogStream'),
                                                           ('logs', 'PutLogEvents'), ('logs', 'DescribeLogStreams')})

    def test_weather_prefixes_come_from_the_staging_policy(self):
        self.assertEqual(aws_templates.weather_prefixes(), sorted([
            'raw/v2/', 'index/v2/', 'packs/v2/', 'summary/v2/', 'state/v2/', 'state/demand/grid/',
            'budgets/v2/', 'geocode/address/v1/']))

    def test_lifecycle_is_limited_to_the_log_prefix_and_removes_every_version(self):
        self.assertEqual(aws_templates.lifecycle_violations(self.lifecycle(), 'logs/server2',
                                                            aws_templates.weather_prefixes()), [])
        rules = self.lifecycle()['Rules']
        self.assertEqual(rules[0]['Expiration'], {'Days': 90})
        self.assertEqual(rules[1]['Expiration'], {'ExpiredObjectDeleteMarker': True})

    def test_lifecycle_check_rejects_unsafe_or_incomplete_rules(self):
        data = aws_templates.weather_prefixes()
        cases = {
            'empty prefix': (self.lifecycle(''), ''),
            'weather prefix': (self.lifecycle('raw/v2'), 'raw/v2'),
            'parent of weather prefixes': (self.lifecycle('state'), 'state'),
        }
        for name, (lifecycle, prefix) in cases.items():
            with self.subTest(name):
                self.assertTrue(aws_templates.lifecycle_violations(lifecycle, prefix, data))
        for key in ('NoncurrentVersionExpiration', 'AbortIncompleteMultipartUpload', 'Expiration'):
            with self.subTest('missing ' + key):
                lifecycle = self.lifecycle()
                del lifecycle['Rules'][0][key]
                self.assertTrue(aws_templates.lifecycle_violations(lifecycle, 'logs/server2', data))
        with self.subTest('missing delete-marker rule'):
            lifecycle = self.lifecycle()
            lifecycle['Rules'].pop(1)
            self.assertTrue(aws_templates.lifecycle_violations(lifecycle, 'logs/server2', data))
        with self.subTest('retention weakened by NewerNoncurrentVersions'):  # CX-LP5-001
            lifecycle = self.lifecycle()
            lifecycle['Rules'][0]['NoncurrentVersionExpiration']['NewerNoncurrentVersions'] = 1
            self.assertTrue(aws_templates.lifecycle_violations(lifecycle, 'logs/server2', data))
        with self.subTest('extra early-expiry rule'):
            lifecycle = self.lifecycle()
            lifecycle['Rules'].append({'ID': 'early', 'Status': 'Enabled', 'Filter': {'Prefix': 'logs/server2/'},
                                       'Expiration': {'Days': 1}})
            self.assertTrue(aws_templates.lifecycle_violations(lifecycle, 'logs/server2', data))
        with self.subTest('different retention'):
            lifecycle = self.lifecycle()
            lifecycle['Rules'][0]['Expiration']['Days'] = 30
            self.assertTrue(aws_templates.lifecycle_violations(lifecycle, 'logs/server2', data))
        with self.subTest('transition added'):
            lifecycle = self.lifecycle()
            lifecycle['Rules'][0]['Transitions'] = [{'Days': 30, 'StorageClass': 'GLACIER'}]
            self.assertTrue(aws_templates.lifecycle_violations(lifecycle, 'logs/server2', data))
        with self.subTest('tag filter'):
            lifecycle = self.lifecycle()
            lifecycle['Rules'][0]['Filter'] = {'And': {'Prefix': 'logs/server2/', 'Tags': []}}
            self.assertTrue(aws_templates.lifecycle_violations(lifecycle, 'logs/server2', data))

    def test_log_group_has_explicit_retention(self):
        self.assertEqual(aws_templates.load('log-group'),
                         {'logGroupName': '${LogGroupName}', 'logGroupClass': 'STANDARD', 'retentionInDays': 30})

    def test_prerequisites_record_the_templates_as_not_provisioned(self):
        record = json.loads((HERE.parent / 'staging' / 'prerequisites.json').read_text())['log_pipeline']
        self.assertIs(record['provisioned'], False)
        self.assertEqual(record['log_group']['retention_days'], aws_templates.load('log-group')['retentionInDays'])
        self.assertEqual(record['bucket_lifecycle']['current_version_days'],
                         aws_templates.load('bucket-lifecycle')['Rules'][0]['Expiration']['Days'])
        for key in ('role_policy', 'bucket_lifecycle', 'log_group'):
            self.assertTrue((HERE.parents[2] / record[key]['template']).is_file(), key)

    def test_render_fills_every_placeholder_and_validates_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            args = ['--bucket', 'tw-server2-123456789012-apne2', '--prefix', 'logs/server2', '--group', '/server2/production',
                    '--region', 'ap-northeast-2', '--account', '123456789012']
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(aws_templates.main(args + ['--out', directory + '/ok']), 0)
            for file in Path(directory, 'ok').iterdir():
                self.assertNotIn('${', file.read_text())
                json.loads(file.read_text())
            policy = json.loads(Path(directory, 'ok', 'role-policy.json').read_text())
            self.assertIn('arn:aws:s3:::tw-server2-123456789012-apne2/logs/server2/*',
                          [s['Resource'] for s in policy['Statement']])
            # CX-LP5-002: an empty region renders the normalized default, never an empty ARN field.
            with contextlib.redirect_stdout(io.StringIO()):
                region_args = list(args); region_args[region_args.index('--region') + 1] = ''
                self.assertEqual(aws_templates.main(region_args + ['--out', directory + '/region']), 0)
            rendered = Path(directory, 'region', 'role-policy.json').read_text()
            self.assertNotIn('arn:aws:logs::', rendered)
            self.assertIn('arn:aws:logs:ap-northeast-2:123456789012:', rendered)
            for bad in (['--prefix', 'raw/v2/logs'], ['--account', '12345'], ['--group', 'bad group'],
                        ['--group', 'aws/reserved']):
                with self.subTest(bad), contextlib.redirect_stderr(io.StringIO()):
                    changed = list(args)
                    changed[changed.index(bad[0]) + 1] = bad[1]
                    self.assertEqual(aws_templates.main(changed + ['--out', directory + '/bad']), 2)
            self.assertFalse(Path(directory, 'bad').exists())


if __name__ == '__main__':
    unittest.main()
