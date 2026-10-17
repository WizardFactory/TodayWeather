"""Operator trace navigation: cross-request owners, unrelated work and bounded damaged input."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('diagnose', Path(__file__).resolve().parents[2]/'tools/diagnose_logs.py')
diagnose = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnose)

class Diagnosis(unittest.TestCase):
    def test_shared_owner_and_joiners_are_followed_without_unrelated_trace(self):
        a, b, c, other = (str(i)*32 for i in (1, 2, 3, 4))
        records = [dict(trace_id=a, linked_trace_id=b), dict(trace_id=b, outcome='unknown'),
                   dict(trace_id=c, linked_trace_id=b), dict(trace_id=other)]
        selected = diagnose.related(records, a)
        self.assertEqual([r['trace_id'] for r in selected], [a, b, c])
        self.assertEqual(selected[1]['outcome'], 'unknown')

    def test_item_query_keeps_its_ancestors_shared_owner_and_batch_result_but_excludes_sibling_send(self):
        trace, owner = 'a'*32, 'b'*32
        def row(op, parent=None, **fields):
            return dict(trace_id=trace, operation_id=f'{op:016x}', parent_operation_id=f'{parent:016x}' if parent else None, **fields)
        records = [row(1, component='delivery', stage='worker'), row(2, 1, stage='submission'),
                   row(3, 2, linked_trace_id=owner, linked_operation_id=f'{7:016x}'),
                   row(4, 1, component='delivery', stage='record_result', count=2),
                   row(5, 1, stage='submission'), row(6, 5, stage='send'),
                   dict(trace_id=owner, operation_id=f'{7:016x}', parent_operation_id=f'{8:016x}'),
                   dict(trace_id=owner, operation_id=f'{8:016x}'),
                   dict(trace_id=owner, operation_id=f'{9:016x}', parent_operation_id=f'{8:016x}')]
        selected = diagnose.related(records, trace, f'{2:016x}')
        self.assertEqual({r['operation_id'] for r in selected}, {f'{i:016x}' for i in (1,2,3,4,7,8)})
        self.assertEqual(next(r for r in selected if r['operation_id']==f'{4:016x}')['count'], 2)

    def test_oversized_or_partial_window_is_not_silently_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'window.ndjson'
            for raw in (b'x'*1025+b'\n', b'{"schema":1}'):
                path.write_bytes(raw)
                with self.assertRaises(ValueError):
                    diagnose.read_records([path])
        with self.assertRaises(ValueError):
            diagnose.related([], 'incoming-user-request-id')

if __name__ == '__main__':
    unittest.main()
