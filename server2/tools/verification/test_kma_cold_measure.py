"""Controls for privacy, denominator retention and credential lifetime."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('kma_measure', Path(__file__).with_name('kma_cold_measure.py'))
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class Controls(unittest.TestCase):
    def test_denominator_keeps_errors_and_never_calls_partial_history_complete(self):
        rows = [dict(phase='fresh_source_no_disk', elapsed_ms=10, result={'status': 200}),
                dict(phase='fresh_source_no_disk', elapsed_ms=12000, result={'outcome': 'deadline'})]
        s = tool.summarize({'http': rows})['phases']['fresh_source_no_disk']
        self.assertEqual(s['attempts'], 2)
        self.assertEqual(s['other'], 1)
        self.assertEqual(s['all_http_attempt_ms']['p95'], 12000)
        self.assertEqual(s['history_complete'], 0)
        self.assertIsNone(s['history_completion_percentiles'])

    def test_credentials_are_narrow_and_expired_credentials_rejected(self):
        env = tool.child_environment({'AccessKeyId': 'test-key', 'SecretAccessKey': 'test-secret'}, 'test-provider')
        self.assertNotIn('AWS_PROFILE', env)
        self.assertNotIn('SERVER2_S3_BUCKET', env)
        self.assertEqual(env['KMA_MEASURE_AWS_KEY'], 'test-key')
        with self.assertRaises(ValueError):
            tool.child_environment({'AccessKeyId': 'test-key', 'SecretAccessKey': 'test-secret',
                                    'Expiration': '2000-01-01T00:00:00Z'}, 'test-provider')

    def test_private_config_parser_does_not_select_unrelated_secrets(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'env'
            path.write_text('OTHER_SECRET=do-not-select\nDONGNAE_SECRET_KEYS=\'["test-provider"]\'\n')
            self.assertEqual(tool.private_key_list(path), '["test-provider"]')


if __name__ == '__main__':
    unittest.main()
