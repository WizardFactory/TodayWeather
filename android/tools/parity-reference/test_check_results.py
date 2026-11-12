import importlib.util
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('results', Path(__file__).with_name('check-results.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ExecutedCoverageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest = {'sizes': ['320x694'], 'languages': ['en-US'], 'sets': {
            'air': {'testSuites': ['AirScreenshotTest'], 'cases': [{'tolerance': '{lang}/station'}]}}}

    def report(self, output='air-compare 320x694/en-US/station ImageDiff(width=640)', name='AirScreenshotTest', **counts):
        root = ET.Element('testsuite', name='example.' + name, tests='1', **{k: str(v) for k, v in counts.items()})
        ET.SubElement(root, 'system-out').text = output
        ET.ElementTree(root).write(self.root / ('TEST-' + name + '.xml'))

    def verify(self):
        return module.verify_results(self.root, self.manifest)

    def test_accepts_the_declared_case_from_a_successful_owner(self):
        self.report()
        self.assertEqual({'expected': 1, 'observed': 1, 'problems': []}, self.verify())

    def test_missing_execution_fails_even_when_the_test_class_passed(self):
        self.report(output='air-compare historical/en-US/station ImageDiff(width=640)')
        self.assertEqual(0, self.verify()['observed'])
        self.assertIn('missing executed comparison', self.verify()['problems'][0])

    def test_wrong_test_class_cannot_supply_a_receipt(self):
        self.report(name='AnotherTest')
        self.assertEqual(0, self.verify()['observed'])

    def test_failed_or_skipped_execution_is_not_accepted(self):
        for field in ['failures', 'errors', 'skipped']:
            self.report(**{field: 1})
            self.assertTrue(self.verify()['problems'])

    def test_undeclared_cases_and_malformed_reports_fail(self):
        self.report(output='air-compare 320x694/en-US/extra ImageDiff(width=640)')
        self.assertTrue(any('undeclared' in p for p in self.verify()['problems']))
        (self.root / 'TEST-broken.xml').write_text('<testsuite')
        self.assertTrue(any('TEST-broken' in p for p in self.verify()['problems']))


if __name__ == '__main__':
    unittest.main()
