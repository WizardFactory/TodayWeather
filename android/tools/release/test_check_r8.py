"""Tests for check_r8.py with APKs and mapping files made for each test.

The dex files hold the marker strings D8, R8 and L8 write, in the form of the 2.0.x builds (AGP 9.5, R8 9.5.29): the
unminified release had `~~D8` markers, the minified one an `~~R8` marker with `pg-map-id` in the app's dex and
`~~L8` with `~~R8` in the desugared library's dex. The mapping header is R8's, whose `pg_map_hash` is the SHA-256 of
the lines after the header.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

TOOL = Path(__file__).with_name('check_r8.py')
APP_ID = 'e7f5c9d35156207d4f3d48e46cddc2f334b3aa22cafe3cb283dea24d6dd8edc1'
LIB_ID = 'c8ba85e1c0ae7fd841442ce0e985ba2965077ecc8d24a99d69153a510e17cc9f'


def marker(tool, **fields):
    body = {'backend': 'dex', 'compilation-mode': 'release', 'min-api': 24, 'version': '9.5.29', **fields}
    return b'~~' + tool.encode() + json.dumps(body, separators=(',', ':')).encode()


def dex(*markers):
    return b'dex\n039\x00' + b'\x00' * 64 + b''.join(b'\x00' + m for m in markers)


# The app's classes as R8 maps them: kept by a rule, renamed, removed (R8 9.x names removed classes).
SHRUNK = (b'kotlin.Unit -> kotlin.Unit:\n'
          b'net.wizardfactory.todayweather.MainActivity -> net.wizardfactory.todayweather.MainActivity:\n'
          b'    void onCreate(android.os.Bundle) -> onCreate\n'
          b'net.wizardfactory.todayweather.core.domain.Js -> a.b:\n'
          b'    int x -> a\n'
          b'net.wizardfactory.todayweather.ui.chart.Chart -> c.d:\n'
          b'net.wizardfactory.todayweather.ui.Unused -> R8$$REMOVED$$CLASS$$0:\n')
NOT_OBFUSCATED = SHRUNK.replace(b'-> a.b:', b'-> net.wizardfactory.todayweather.core.domain.Js:').replace(
    b'-> c.d:', b'-> net.wizardfactory.todayweather.ui.chart.Chart:')
NOT_SHRUNK = SHRUNK.replace(b'net.wizardfactory.todayweather.ui.Unused -> R8$$REMOVED$$CLASS$$0:\n', b'')


def mapping(map_id=APP_ID, body=SHRUNK, recorded=None):
    digest = recorded if recorded is not None else hashlib.sha256(body).hexdigest()
    header = (b'# compiler: R8\n# compiler_version: 9.5.29\n# min_api: 24\n# common_typos_disable\n'
              b'# {"id":"com.android.tools.r8.mapping","version":"2.2"}\n'
              b'# pg_map_id: ' + map_id.encode() + b'\n# pg_map_hash: SHA-256 ' + digest.encode() + b'\n')
    return header + body


MINIFIED = {'classes.dex': dex(marker('R8', **{'pg-map-id': APP_ID, 'r8-mode': 'full'})),
            'classes2.dex': dex(marker('L8', backend='cf'), marker('R8', **{'pg-map-id': LIB_ID}))}


class CheckR8Test(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.temp = Path(temp.name)

    def run_tool(self, entries, mapping_bytes=None, args=None):
        apk = self.temp / 'app.apk'
        with zipfile.ZipFile(apk, 'w') as out:
            out.writestr('AndroidManifest.xml', b'\x03\x00')
            for name, data in entries.items():
                out.writestr(name, data)
        mapping_file = self.temp / 'mapping.txt'
        mapping_file.write_bytes(mapping() if mapping_bytes is None else mapping_bytes)
        result = subprocess.run([sys.executable, str(TOOL), *(args if args is not None else [apk, mapping_file])],
                                capture_output=True, text=True)
        return result.returncode, result.stdout, result.stderr

    def test_passes_for_the_minified_apk_and_its_mapping(self):
        status, out, _ = self.run_tool(MINIFIED)
        self.assertEqual(status, 0, out)
        self.assertNotIn('FAIL', out)
        self.assertIn(f'- R8 mapping SHA-256: {hashlib.sha256(mapping()).hexdigest()}', out)

    def test_fails_for_an_unminified_apk(self):
        d8 = marker('D8', **{'desugared-library-identifiers': ['com.tools.android:desugar_jdk_libs_configuration:2.1.5']})
        status, out, _ = self.run_tool({'classes.dex': dex(d8), 'classes2.dex': dex(),
                                        'classes3.dex': dex(marker('L8', backend='cf'), marker('R8'))})
        self.assertEqual(status, 1)
        self.assertIn('FAIL compiled by D8, not shrunk by R8: classes.dex', out)
        self.assertIn('FAIL no R8 marker with a mapping ID outside the desugared library', out)

    def test_fails_when_one_dex_file_skipped_r8(self):
        status, out, _ = self.run_tool({**MINIFIED, 'classes3.dex': dex(marker('D8'))})
        self.assertEqual(status, 1)
        self.assertIn('FAIL compiled by D8, not shrunk by R8: classes3.dex', out)

    def test_fails_for_the_mapping_of_another_build(self):
        other = 'f' * 64
        status, out, _ = self.run_tool(MINIFIED, mapping(map_id=other))
        self.assertEqual(status, 1)
        self.assertIn(f'FAIL mapping pg_map_id {other}, the APK\'s R8 code has {APP_ID}', out)

    def test_the_desugared_library_id_is_not_the_apps(self):
        status, out, _ = self.run_tool(MINIFIED, mapping(map_id=LIB_ID))
        self.assertEqual(status, 1)
        self.assertIn(f'FAIL mapping pg_map_id {LIB_ID}', out)

    def test_fails_for_a_changed_or_truncated_mapping(self):
        complete = mapping()
        status, out, _ = self.run_tool(MINIFIED, complete[:-6])
        self.assertEqual(status, 1)
        self.assertIn('FAIL mapping content SHA-256', out)
        status, out, _ = self.run_tool(MINIFIED, mapping(recorded='0' * 64))
        self.assertEqual(status, 1)

    def test_fails_for_a_mapping_without_a_header(self):
        status, out, _ = self.run_tool(MINIFIED, SHRUNK)
        self.assertEqual(status, 1)
        self.assertIn('FAIL mapping pg_map_id none', out)
        self.assertIn('its header records none', out)

    def test_fails_when_r8_did_not_obfuscate(self):
        status, out, _ = self.run_tool(MINIFIED, mapping(body=NOT_OBFUSCATED))
        self.assertEqual(status, 1)
        self.assertIn('FAIL R8 renamed 0 of the app\'s 3 classes', out)
        self.assertIn('ok   R8 removed 1 of the app\'s classes', out)

    def test_fails_when_r8_did_not_shrink(self):
        status, out, _ = self.run_tool(MINIFIED, mapping(body=NOT_SHRUNK))
        self.assertEqual(status, 1)
        self.assertIn('FAIL R8 removed none of the app\'s classes', out)
        self.assertIn('ok   R8 renamed 2 of the app\'s 3 classes', out)

    def test_fails_when_the_apps_dex_files_have_two_mapping_ids(self):
        other = 'a' * 64
        mixed = {**MINIFIED, 'classes3.dex': dex(marker('R8', **{'pg-map-id': other}))}
        for map_id in (APP_ID, other):
            status, out, _ = self.run_tool(mixed, mapping(map_id=map_id))
            self.assertEqual(status, 1, map_id)
            self.assertIn(f'FAIL mapping pg_map_id {map_id}, the APK\'s R8 code has {" ".join(sorted([APP_ID, other]))}', out)

    def test_fails_for_a_mapping_id_that_is_not_a_string(self):
        status, out, _ = self.run_tool({**MINIFIED, 'classes3.dex': dex(marker('R8', **{'pg-map-id': []}))})
        self.assertEqual(status, 1)
        self.assertIn('FAIL R8 marker with an invalid pg-map-id: [[]]', out)

    def test_fails_without_dex_files(self):
        status, out, _ = self.run_tool({'lib/classes.dex': dex(marker('R8', **{'pg-map-id': APP_ID}))})
        self.assertEqual(status, 1)
        self.assertIn('FAIL no classes*.dex in the APK', out)

    def test_usage_and_unreadable_files(self):
        status, _, err = self.run_tool(MINIFIED, args=[])
        self.assertEqual(status, 2)
        self.assertIn('usage', err)
        (self.temp / 'not.apk').write_bytes(b'not a zip')
        status, _, _ = self.run_tool(MINIFIED, args=[self.temp / 'not.apk', self.temp / 'mapping.txt'])
        self.assertEqual(status, 2)
        status, _, _ = self.run_tool(MINIFIED, args=[self.temp / 'app.apk', self.temp / 'missing.txt'])
        self.assertEqual(status, 2)


if __name__ == '__main__':
    unittest.main()
