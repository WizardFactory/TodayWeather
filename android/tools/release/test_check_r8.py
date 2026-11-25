"""Tests for check_r8.py with APKs and mapping files made for each test.

The dex files hold the marker strings D8, R8 and L8 write, in the form of the 2.0.x builds (AGP 9.5, R8 9.5.29): the
unminified release had `~~D8` markers, the minified one an `~~R8` marker with `pg-map-id` in the app's dex and
`~~L8` with `~~R8` in the desugared library's dex. The mapping header is R8's, whose `pg_map_hash` is the SHA-256 of
the lines after the header. A field of check_r8.KEPT_FIELDS is looked up in the dex files' field table under the names
the mapping gives its class and field; R8 9.5.29 writes no mapping line for a field it keeps under its own name (the
fixed 2.0.1 build kept HandBackWriter and consentListener unrenamed, and the mapping lists neither member).
"""
import hashlib
import json
from pathlib import Path
import struct
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


LISTENER_TYPE = 'Landroid/content/SharedPreferences$OnSharedPreferenceChangeListener;'


def uleb128(value):
    out = bytearray()
    while True:
        byte, value = value & 0x7f, value >> 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def dex(*markers, fields=(), strings=()):
    """A dex file with a header, the string, type and field ID tables of `fields` ((class, type, name) descriptors)
    and extra `strings`, then the markers."""
    names = sorted({s for field in fields for s in field} | set(strings))
    index = {s: i for i, s in enumerate(names)}
    types = sorted({d for c, ty, _ in fields for d in (c, ty)})
    type_index = {d: i for i, d in enumerate(types)}
    string_ids_off = 0x70
    type_ids_off = string_ids_off + 4 * len(names)
    field_ids_off = type_ids_off + 4 * len(types)
    data_off = field_ids_off + 8 * len(fields)
    data, offsets = b'', []
    for s in names:
        offsets.append(data_off + len(data))
        data += uleb128(len(s)) + s.encode() + b'\x00'
    tables = (b''.join(struct.pack('<I', o) for o in offsets)
              + b''.join(struct.pack('<I', index[d]) for d in types)
              + b''.join(struct.pack('<HHI', type_index[c], type_index[ty], index[n]) for c, ty, n in fields))
    body = tables + data + b''.join(b'\x00' + m for m in markers)
    header = bytearray(b'dex\n039\x00' + b'\x00' * (0x70 - 8))
    struct.pack_into('<II', header, 0x20, 0x70 + len(body), 0x70)
    struct.pack_into('<I', header, 0x28, 0x12345678)
    struct.pack_into('<IIII', header, 0x38, len(names), string_ids_off, len(types), type_ids_off)
    struct.pack_into('<II', header, 0x50, len(fields), field_ids_off)
    return bytes(header) + body


# The app's classes as R8 maps them: kept by a rule, renamed, removed (R8 9.x names removed classes), and the class
# whose field holds the analytics choice's listener; the field kept under its own name has no line.
HAND_BACK = (b'net.wizardfactory.todayweather.HandBackWriter -> e.f:\n'
             b'# {"id":"sourceFile","fileName":"HandBack.kt"}\n'
             b'    android.content.SharedPreferences suite -> a\n'
             b'    1:4:boolean rewrite():44:44 -> b\n')
KEPT = ('Le/f;', LISTENER_TYPE, 'consentListener')
SHRUNK = (b'kotlin.Unit -> kotlin.Unit:\n'
          b'net.wizardfactory.todayweather.MainActivity -> net.wizardfactory.todayweather.MainActivity:\n'
          b'    void onCreate(android.os.Bundle) -> onCreate\n'
          b'net.wizardfactory.todayweather.core.domain.Js -> a.b:\n'
          b'    int x -> a\n'
          b'net.wizardfactory.todayweather.ui.chart.Chart -> c.d:\n'
          b'net.wizardfactory.todayweather.ui.Unused -> R8$$REMOVED$$CLASS$$0:\n' + HAND_BACK)
NOT_OBFUSCATED = SHRUNK.replace(b'-> a.b:', b'-> net.wizardfactory.todayweather.core.domain.Js:').replace(
    b'-> c.d:', b'-> net.wizardfactory.todayweather.ui.chart.Chart:').replace(
    b'-> e.f:', b'-> net.wizardfactory.todayweather.HandBackWriter:')
NOT_SHRUNK = SHRUNK.replace(b'net.wizardfactory.todayweather.ui.Unused -> R8$$REMOVED$$CLASS$$0:\n', b'')


def mapping(map_id=APP_ID, body=SHRUNK, recorded=None):
    digest = recorded if recorded is not None else hashlib.sha256(body).hexdigest()
    header = (b'# compiler: R8\n# compiler_version: 9.5.29\n# min_api: 24\n# common_typos_disable\n'
              b'# {"id":"com.android.tools.r8.mapping","version":"2.2"}\n'
              b'# pg_map_id: ' + map_id.encode() + b'\n# pg_map_hash: SHA-256 ' + digest.encode() + b'\n')
    return header + body


MINIFIED = {'classes.dex': dex(marker('R8', **{'pg-map-id': APP_ID, 'r8-mode': 'full'}), fields=[KEPT]),
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
        self.assertIn('ok   R8 kept net.wizardfactory.todayweather.HandBackWriter.consentListener', out)

    def app_dex(self, *fields, strings=()):
        return {**MINIFIED, 'classes.dex': dex(marker('R8', **{'pg-map-id': APP_ID}), fields=fields, strings=strings)}

    def assert_removed(self, entries, body=SHRUNK):
        status, out, _ = self.run_tool(entries, mapping(body=body))
        self.assertEqual(status, 1, out)
        self.assertIn('FAIL R8 removed net.wizardfactory.todayweather.HandBackWriter.consentListener', out)

    def test_fails_when_r8_removed_a_listener_field(self):
        other = ('Le/f;', 'Landroid/content/SharedPreferences;', 'a')
        self.assert_removed(self.app_dex(other))

    def test_fails_for_the_first_2_0_1_build(self):
        # HandBackWriter as the 2.0.1 build of 30698192a mapped it (R8 9.5.29), its dex without the field: the analytics
        # choice's listener was collected and a grant was withdrawn at the next start.
        first = (b'net.wizardfactory.todayweather.HandBackWriter -> ql1:\n'
                 b'# {"id":"sourceFile","fileName":"HandBack.kt"}\n'
                 b'    android.content.SharedPreferences suite -> a\n'
                 b'    kotlin.jvm.functions.Function0 consent -> b\n'
                 b'      # {"id":"com.android.tools.r8.residualsignature","signature":"Lwn;"}\n'
                 b'    net.wizardfactory.todayweather.core.storage.AppState last -> c\n'
                 b'    32:37:boolean write(net.wizardfactory.todayweather.core.storage.AppState):28 -> a\n')
        self.assert_removed(self.app_dex(('Lql1;', 'Landroid/content/SharedPreferences;', 'a')),
                            SHRUNK.replace(HAND_BACK, first))

    def test_passes_for_the_fixed_2_0_1_build(self):
        # The class and its field kept under their own names: the mapping lists the class but not the field.
        fixed = (b'net.wizardfactory.todayweather.HandBackWriter -> net.wizardfactory.todayweather.HandBackWriter:\n'
                 b'    android.content.SharedPreferences suite -> a\n')
        field = ('Lnet/wizardfactory/todayweather/HandBackWriter;', LISTENER_TYPE, 'consentListener')
        status, out, _ = self.run_tool(self.app_dex(field), mapping(body=SHRUNK.replace(HAND_BACK, fixed)))
        self.assertIn('ok   R8 kept net.wizardfactory.todayweather.HandBackWriter.consentListener', out)

    def test_a_renamed_field_is_found_under_its_new_name(self):
        renamed = HAND_BACK + (b'    android.content.SharedPreferences$OnSharedPreferenceChangeListener'
                               b' consentListener -> d\n')
        status, out, _ = self.run_tool(self.app_dex(('Le/f;', LISTENER_TYPE, 'd')),
                                       mapping(body=SHRUNK.replace(HAND_BACK, renamed)))
        self.assertEqual(status, 0, out)
        self.assertIn('ok   R8 kept net.wizardfactory.todayweather.HandBackWriter.consentListener', out)
        self.assert_removed(self.app_dex(KEPT), SHRUNK.replace(HAND_BACK, renamed))

    def test_the_field_must_be_in_its_class_under_its_mapped_name(self):
        self.assert_removed(self.app_dex(('Lg/h;', LISTENER_TYPE, 'consentListener')))
        self.assert_removed(self.app_dex(('Lnet/wizardfactory/todayweather/HandBackWriter;', LISTENER_TYPE,
                                          'consentListener')))
        self.assert_removed(MINIFIED, SHRUNK.replace(b'HandBackWriter -> e.f:', b'HandBackWriter -> R8$$REMOVED$$CLASS$$1:'))

    def test_a_string_of_the_fields_name_is_not_the_field(self):
        self.assert_removed(self.app_dex(strings=('Le/f;', 'consentListener')))

    def test_the_field_may_be_in_another_dex_file(self):
        entries = {**self.app_dex(), 'classes3.dex': dex(fields=[KEPT])}
        status, out, _ = self.run_tool(entries)
        self.assertEqual(status, 0, out)

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
        self.assertIn('FAIL R8 renamed 0 of the app\'s 4 classes', out)
        self.assertIn('ok   R8 removed 1 of the app\'s classes', out)

    def test_fails_when_r8_did_not_shrink(self):
        status, out, _ = self.run_tool(MINIFIED, mapping(body=NOT_SHRUNK))
        self.assertEqual(status, 1)
        self.assertIn('FAIL R8 removed none of the app\'s classes', out)
        self.assertIn('ok   R8 renamed 3 of the app\'s 4 classes', out)

    def test_fails_when_the_apps_dex_files_have_two_mapping_ids(self):
        other = 'a' * 64
        mixed = {**MINIFIED, 'classes3.dex': dex(marker('R8', **{'pg-map-id': other}))}
        for map_id in (APP_ID, other):
            status, out, _ = self.run_tool(mixed, mapping(map_id=map_id))
            self.assertEqual(status, 1, map_id)
            self.assertIn(f'FAIL mapping pg_map_id {map_id}, the APK\'s R8 code has {" ".join(sorted([APP_ID, other]))}', out)

    def test_a_removed_class_needs_r8s_numbered_name(self):
        status, out, _ = self.run_tool(MINIFIED, mapping(body=SHRUNK.replace(b'CLASS$$0:', b'CLASS$$suffix:')))
        self.assertEqual(status, 1)
        self.assertIn('FAIL R8 removed none of the app\'s classes', out)

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
