"""Exact maintained apt rewrite regression; namespace-only, no apt invocation."""
import os
from pathlib import Path
assert os.environ.get('S09_ISOLATED') == '1' and not Path('/sys').exists(), 'use run_isolated.py; no host execution'
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent


def rewrite(text):
    source = (HERE/'cloud-init.yml').read_text()
    start = source.index('      from pathlib import Path\n', source.index('write_files:'))
    end = source.index('      PY\n', start)
    program = '\n'.join(line[6:] for line in source[start:end].splitlines())
    with tempfile.TemporaryDirectory() as directory:
        fixture = Path(directory)/'ubuntu.sources'
        fixture.write_text(text)
        with patch('pathlib.Path', return_value=fixture):
            try:
                exec(compile(program, '<maintained-apt-rewrite>', 'exec'), {})
            except AssertionError:
                if fixture.read_bytes() != text.encode():
                    raise RuntimeError('rejection modified the source file')
                raise
        return fixture.read_text()


class AptRewriteTests(unittest.TestCase):
    def test_http_documentation_comments_do_not_reject_active_https_sources(self):
        # Minimal schema-valid reproduction, not claimed as the lost host file.
        original = """# See http://help.ubuntu.com/community/UpgradeNotes
# Security suite resolute-security is documented here, not selected below.
Types: deb
URIs: http://ap-northeast-2.ec2.archive.ubuntu.com/ubuntu/
Suites: resolute resolute-updates resolute-backports
Components: main universe
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

Types: deb
URIs: http://security.ubuntu.com/ubuntu/
Suites: resolute-security
Components: main universe
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
"""
        result = rewrite(original)
        self.assertIn('# See http://help.ubuntu.com/community/UpgradeNotes', result)
        blocks = result.split('\n\n')
        self.assertIn('URIs: https://archive.ubuntu.com/ubuntu',blocks[0])
        self.assertIn('URIs: https://security.ubuntu.com/ubuntu',blocks[1])
        active = '\n'.join(line for line in result.splitlines() if not line.lstrip().startswith('#'))
        self.assertNotIn('http://',active)
        self.assertEqual(result.count('Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg'),2)

    def test_security_endpoint_rewrite_does_not_rewrite_comments(self):
        original = '# Reference https://archive.ubuntu.com/ubuntu\nTypes: deb\nURIs: http://security.ubuntu.com/ubuntu\nSuites: resolute-security\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n'
        result = rewrite(original)
        self.assertIn('# Reference https://archive.ubuntu.com/ubuntu',result)
        self.assertIn('URIs: https://security.ubuntu.com/ubuntu',result)

    def test_security_routing_uses_complete_exact_suite_tokens(self):
        for field, host in (
            ('Suites:\n resolute-security', 'security'),
            ('sUiTeS: resolute-updates\n# Suite continuation follows.\n\tresolute-security', 'security'),
            ('Suites: resolute-security-extra', 'archive'),
            ('Suites:\n resolute-security-extra', 'archive'),
        ):
            with self.subTest(field=field):
                original = ('Types: deb\nURIs: http://mirror.invalid/ubuntu\n' + field +
                            '\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n')
                result = rewrite(original)
                self.assertIn('URIs: https://' + host + '.ubuntu.com/ubuntu\n', result)
                self.assertIn(field, result)

    def test_complete_signing_field_rejects_extra_values_without_writing(self):
        key = '/usr/share/keyrings/ubuntu-archive-keyring.gpg'
        good = 'Types: deb\nURIs: http://mirror.invalid/ubuntu\nSuites: resolute\nSigned-By: ' + key + '\n'
        for field in (
            'Signed-By: ' + key + '\n /some/other-keyring.gpg',
            'Signed-By: ' + key + '\n# A comment does not end the field.\n\t' + 'A'*40,
            'Signed-By: ' + key + '\n ' + key,
            'Signed-By: ' + key + '\nSigned-By: ' + key,
            'Signed-By: ' + key + '\nsIgNeD-bY: /some/other-keyring.gpg',
            'Signed-By: ' + key + ' /some/other-keyring.gpg',
            'Signed-By: ' + key + '!',
            'Signed-By:',
        ):
            with self.subTest(field=field), self.assertRaises(AssertionError):
                # Even a later invalid stanza must leave the entire file untouched.
                rewrite(good + '\nTypes: deb\nURIs: http://mirror.invalid/ubuntu\nSuites: resolute-security\n' + field + '\n')

    def test_complete_signing_field_accepts_only_the_exact_folded_key(self):
        for field in (
            'Signed-By:\n /usr/share/keyrings/ubuntu-archive-keyring.gpg',
            'sIgNeD-bY:\n# Key continuation follows.\n\t/usr/share/keyrings/ubuntu-archive-keyring.gpg',
        ):
            with self.subTest(field=field):
                result = rewrite('Types: deb\nURIs: http://mirror.invalid/ubuntu\nSuites: resolute-security\n' + field + '\n')
                self.assertIn('URIs: https://security.ubuntu.com/ubuntu\n', result)
                self.assertIn(field, result)

    def test_comment_is_not_a_signing_key_field(self):
        with self.assertRaises(AssertionError):
            rewrite('# Signed-By: not-an-active-key\nTypes: deb\nURIs: http://mirror.invalid/ubuntu\nSuites: resolute\n')

    def test_uri_continuations_cannot_escape_fixed_https_endpoints(self):
        for uri in ('ftp://untrusted.example.invalid/ubuntu','https://untrusted.example.invalid/ubuntu'):
            with self.subTest(uri=uri), self.assertRaises(AssertionError):
                rewrite('Types: deb\nURIs: http://mirror.invalid/ubuntu\n '+uri+'\nSuites: resolute\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n')

    def test_each_active_stanza_requires_its_own_signing_key(self):
        good='Types: deb\nURIs: http://mirror.invalid/ubuntu\nSuites: resolute\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n'
        bad='Types: deb\nURIs: http://mirror.invalid/ubuntu\nSuites: resolute-security\n'
        with self.assertRaises(AssertionError):rewrite(good+'\n'+bad)

    def test_active_insecure_continuation_still_rejected(self):
        with self.assertRaises(AssertionError):
            rewrite('Types: deb\nURIs: http://mirror.invalid/ubuntu\n http://unsafe.invalid/ubuntu\nSuites: resolute\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n')
