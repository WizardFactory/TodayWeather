#!/usr/bin/env python3
"""Exercise the scoped operation stream and Linux RSS parser offline."""

import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'deploy' / 'shadow'))
from rehearsal_observation import OperationCounts, resident_bytes


BUCKET = 'server2-shadow-sr6-rehearsal-state'


def operation(action, *, key='', body=0, bucket=BUCKET):
    return json.dumps(dict(service='s3', action=action, key=key, body_bytes=body, bucket=bucket)).encode() + b'\n'


class RehearsalObservationTests(unittest.TestCase):
    def test_partially_written_row_retries_without_duplicate_counts(self):
        rows = operation('GetObject', key='evidence/old') + operation('PutObject', key='logs/server2/write', body=80)
        partial = operation('PutObject', key='evidence/batch', body=150)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'operations.jsonl'
            path.write_bytes(rows + partial[:80])
            counts = OperationCounts(path, state_bucket=BUCKET)
            first = counts.read()
            self.assertEqual({k: v for k, v in first.items() if v},
                             dict(standin_s3_reads=1, standin_s3_writes=1, standin_s3_put_bytes=80,
                                  copy_s3_reads=1, log_s3_writes=1, log_s3_put_bytes=80))
            with path.open('ab') as stream:
                stream.write(partial[80:])
            later = counts.read()
            self.assertEqual({k: v for k, v in later.items() if v},
                             dict(standin_s3_reads=1, standin_s3_writes=2, standin_s3_put_bytes=230,
                                  copy_s3_reads=1, copy_s3_writes=1, copy_s3_put_bytes=150,
                                  log_s3_writes=1, log_s3_put_bytes=80))
            self.assertEqual(counts.read(), later)
            self.assertIsNot(first, later)

    def test_stream_scope_and_descriptive_records_never_get_charged(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'operations.jsonl'
            path.write_bytes(operation('GetObject', bucket=BUCKET.replace('-state', '-raw'))
                             + operation('GetObject', bucket='other')
                             + operation('Overwrite') + operation('Denied'))
            counts = OperationCounts(path, state_bucket=BUCKET)
            self.assertEqual(counts.read()['standin_s3_reads'], 1)
            self.assertEqual(counts.read()['standin_s3_writes'], 0)

    def test_shortened_or_replaced_stream_sets_a_measurement_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'operations.jsonl'
            path.write_bytes(operation('GetObject'))
            counts = OperationCounts(path, state_bucket=BUCKET)
            self.assertEqual(counts.read()['standin_s3_reads'], 1)
            renamed = path.with_suffix('.past')
            path.rename(renamed)
            path.write_bytes(renamed.read_bytes())
            with self.assertRaises(ValueError):
                counts.read()

    def test_resident_memory_uses_integral_byte_units(self):
        self.assertEqual(resident_bytes('Name:\tserver2\nVmRSS:\t  357 kB\n'), 357 * 1024)
        for status in ('VmRSS: secret kB', 'VmRSS: 357 MB', 'VmRSS: 1 kB\nVmRSS: 2 kB', ''):
            with self.subTest(status=status), self.assertRaises(ValueError):
                resident_bytes(status)


if __name__ == '__main__':
    unittest.main()
