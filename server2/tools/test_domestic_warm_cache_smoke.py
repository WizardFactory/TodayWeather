#!/usr/bin/env python3
"""Exercise the runner's actual warm-check block without children, Cargo or network."""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

RUNNER = Path(__file__).with_name('domestic_warm_cache_smoke.py')
LABELS = frozenset((
    'current', 'shortest', 'short', 'rss',
    'mid-fcst/109', 'mid-fcst/156', 'mid-fcst/159',
    'mid-land-fcst/11B00000', 'mid-land-fcst/11F20000', 'mid-land-fcst/11H20000',
    'mid-ta/11B10101', 'mid-ta/11F20501', 'mid-ta/11H20201',
))


def load_checker():
    spec = importlib.util.spec_from_file_location('warm_runner', RUNNER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    tree = ast.parse(RUNNER.read_text(), filename=str(RUNNER))
    main = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'main')
    checks = [node for node in ast.walk(main) if isinstance(node, ast.If)
              and ast.unparse(node.test) == "mode in ('diagnostic', 'http', 'http-disk', 'disk', 'disk-boundary')"]
    assert len(checks) == 1, 'Select exactly the actual runner warm-check block'
    block = compile(ast.fix_missing_locations(ast.Module(body=checks, type_ignores=[])), str(RUNNER), 'exec')

    def check(manifest, record):
        with tempfile.TemporaryDirectory(prefix='d2-strict13-controls-') as name:
            output = Path(name)
            (output/'fixture.json').write_text(json.dumps(manifest))
            (output/'http.stdout').write_text(json.dumps(record)+'\n')
            context = vars(module).copy()
            context.update(mode='http', manifest=output/'fixture.json', output=output)
            exec(block, context)
    return module, check


class WarmBoundaryControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module, checker = load_checker()
        cls.check = staticmethod(checker)
        cls.manifest = {'expected_source_documents': {label: [] for label in sorted(LABELS)},
                        'io_object_labels': {prefix+label: label
                                             for label in sorted(LABELS | {'zone-support'})
                                             for prefix in ('raw/', 'index/v2/catalog/', 'index/v2/groups/')}}

    def record(self, label=None, metric='GET_raw'):
        after = {}
        if label:
            paths = [path for path, value in self.manifest['io_object_labels'].items() if value == label]
            if metric == 'LIST':
                path = next(path for path in paths if path.startswith('index/v2/') and not path.startswith('index/v2/groups/'))
                key = 'OP LIST '+path
            elif metric == 'GET_catalog':
                path = next(path for path in paths if path.startswith('index/v2/') and not path.startswith('index/v2/groups/'))
                key = 'OP GET '+path
            elif metric == 'GET_descriptor':
                path = next(path for path in paths if path.startswith('index/v2/groups/'))
                key = 'OP GET '+path
            else:
                prefix = 'index/v2/catalog/' if metric == 'BODYOUT_bytes' else 'raw/'
                path = next(path for path in paths if path.startswith(prefix))
                key = ('OP GET ' if metric == 'GET_raw' else 'BODYOUT GET ')+path
            after[key] = 1
        return {'phase': 'warm1', 'status_before': {}, 'status_after': after}

    def test_zone_only_is_outside_strict_forecast_boundary(self):
        record = self.record('zone-support')
        before = copy.deepcopy((self.manifest, record))
        self.check(self.manifest, record)
        self.assertEqual(before, (self.manifest, record))

    def test_every_forecast_counter_is_rejected(self):
        for label in sorted(LABELS):
            for metric in ('LIST', 'GET_catalog', 'GET_descriptor', 'GET_raw', 'BODYOUT_bytes', 'BODYOUT_raw_bytes'):
                with self.subTest(label=label, metric=metric):
                    record = self.record(label, metric)
                    before = copy.deepcopy((self.manifest, record))
                    with self.assertRaises(RuntimeError):
                        self.check(self.manifest, record)
                    self.assertEqual(before, (self.manifest, record))

    def test_every_missing_expected_dataset_is_rejected(self):
        for label in sorted(LABELS):
            with self.subTest(label=label):
                manifest = copy.deepcopy(self.manifest)
                del manifest['expected_source_documents'][label]
                with self.assertRaises(RuntimeError):
                    self.check(manifest, self.record())

    def test_missing_classified_dataset_is_rejected(self):
        for label in sorted(LABELS | {'zone-support'}):
            with self.subTest(label=label):
                manifest = copy.deepcopy(self.manifest)
                manifest['io_object_labels'] = {key: value for key, value in manifest['io_object_labels'].items() if value != label}
                with self.assertRaises(RuntimeError):
                    self.check(manifest, self.record())

    def test_unknown_expected_or_classified_label_is_rejected(self):
        for kind in ('expected', 'classified'):
            with self.subTest(kind=kind):
                manifest = copy.deepcopy(self.manifest)
                if kind == 'expected':
                    manifest['expected_source_documents']['new-unapproved-family'] = []
                else:
                    manifest['io_object_labels']['raw/unapproved'] = 'new-unapproved-family'
                with self.assertRaises(RuntimeError):
                    self.check(manifest, self.record())

    def test_unattributed_nonforecast_io_is_preserved_without_mutation(self):
        record = self.record()
        record['status_after']['OP LIST index/v2/nonforecast-optional/absent'] = 1
        before = copy.deepcopy((self.manifest, record))
        self.check(self.manifest, record)
        per_dataset, unknown = self.module.io_delta(record['status_before'], record['status_after'], self.manifest['io_object_labels'])
        self.assertEqual(per_dataset, {})
        self.assertEqual(unknown, record['status_after'])
        self.assertEqual(before, (self.manifest, record))

    def test_folded_checks_allow_controls_and_reject_raw_descriptor_parse_fold(self):
        for metric in ('LIST', 'GET_catalog', 'GET_raw', 'GET_descriptor'):
            record = self.record('current', metric)
            record['phase'] = 'restore'
            record['forecast_cache_before'] = {'parse_acquisitions': 0, 'folds': 0}
            record['forecast_cache_after'] = {'parse_acquisitions': 0, 'folds': 0}
            if metric in ('LIST', 'GET_catalog'):
                self.module.check_folded_forecast_io(record, self.manifest)
            else:
                with self.assertRaises(RuntimeError):
                    self.module.check_folded_forecast_io(record, self.manifest)
        for counter in ('parse_acquisitions', 'folds'):
            record = self.record()
            record['forecast_cache_before'] = {'parse_acquisitions': 0, 'folds': 0}
            record['forecast_cache_after'] = {'parse_acquisitions': 0, 'folds': 0}
            record['forecast_cache_after'][counter] = 1
            with self.assertRaises(RuntimeError):
                self.module.check_folded_forecast_io(record, self.manifest)


if __name__ == '__main__':
    unittest.main(verbosity=2)
