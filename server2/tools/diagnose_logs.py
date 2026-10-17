#!/usr/bin/env python3
"""Follow generated trace IDs and shared-owner links in bounded, local NDJSON files.
Use: python3 server2/tools/diagnose_logs.py --trace 32_HEX_ID file.ndjson [file2.ndjson]
This is a diagnostic view, never a resend/replay or durability decision.
"""
import argparse
import json
from pathlib import Path
import re
import sys

MAX_BYTES = 128 * 1024 * 1024
MAX_RECORDS = 100_000
ID = re.compile(r'^[0-9a-f]{32}$')

def read_records(paths):
    records = []
    ignored = 0
    total = 0
    for path in paths:
        with path.open('rb') as stream:
            while True:
                line = stream.readline(1025)
                if not line:
                    break
                total += len(line)
                if total > MAX_BYTES or len(records) >= MAX_RECORDS:
                    raise ValueError('input bound exceeded; select a smaller UTC incident window')
                if len(line) > 1024 or not line.endswith(b'\n'):
                    raise ValueError('invalid/oversized NDJSON line; use the operational stderr capture')
                try:
                    record = json.loads(line)
                except ValueError:
                    ignored += 1
                    continue
                if not isinstance(record, dict) or record.get('schema') != 1 or not ID.fullmatch(str(record.get('trace_id', ''))):
                    ignored += 1
                    continue
                records.append(record)
    return records, ignored

def related(records, trace, operation=None):
    if not ID.fullmatch(trace):
        raise ValueError('trace must be a generated 32-digit lowercase hex ID')
    if operation is not None:
        if not re.fullmatch(r'[0-9a-f]{16}', operation):
            raise ValueError('operation must be a generated 16-digit lowercase hex ID')
        def node(record):
            return (record.get('trace_id'), record.get('operation_id'))
        children, parents, links = {}, {}, {}
        workers = set()
        for record in records:
            key = node(record)
            if record.get('component')=='delivery' and record.get('stage')=='worker':
                workers.add(key)
            parent = record.get('parent_operation_id')
            if parent:
                above = (record['trace_id'], parent)
                children.setdefault(above, set()).add(key)
                parents.setdefault(key, set()).add(above)
            if record.get('linked_trace_id') and record.get('linked_operation_id'):
                links.setdefault(key, set()).add((record['linked_trace_id'], record['linked_operation_id']))
        def descendants(seeds):
            pending, found = list(seeds), set()
            while pending:
                key = pending.pop()
                if key in found:
                    continue
                found.add(key)
                pending.extend(children.get(key, ()))
                pending.extend(links.get(key, ()))
            return found
        def ancestors(seeds):
            pending, found = list(seeds), set(seeds)
            while pending:
                for above in parents.get(pending.pop(), ()):
                    if above not in found:
                        found.add(above)
                        pending.append(above)
            return found
        selected = descendants({(trace, operation)})
        batch_roots = ancestors(selected) & workers
        batch = {node(r) for r in records if r.get('component')=='delivery' and r.get('stage') in ('claim','record_result') and (r['trace_id'],r.get('parent_operation_id')) in batch_roots}
        wanted = ancestors(selected | descendants(batch))
        return [r for r in records if node(r) in wanted]
    wanted = {trace}
    # An adjacency map avoids repeated passes over a large incident window.
    graph = {}
    for record in records:
        target = record.get('linked_trace_id')
        if isinstance(target, str) and ID.fullmatch(target):
            origin = record['trace_id']
            graph.setdefault(origin, set()).add(target)
            graph.setdefault(target, set()).add(origin)
    pending = [trace]
    while pending:
        origin = pending.pop()
        for target in graph.get(origin, ()):
            if target not in wanted:
                wanted.add(target)
                pending.append(target)
    return [r for r in records if r['trace_id'] in wanted]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--trace', required=True)
    parser.add_argument('--operation', help='Optional anonymous operation ID; retain its ancestors/shared owner/batch context while excluding unrelated submission sends')
    parser.add_argument('files', nargs='+', type=Path)
    args = parser.parse_args()
    try:
        records, ignored = read_records(args.files)
        selected = related(records, args.trace, args.operation)
    except (OSError, ValueError):
        print('Cannot read a complete bounded NDJSON window; check paths/trace/operation/line size and narrow the input.', file=sys.stderr)
        return 2
    for record in selected:
        print(json.dumps(record, separators=(',', ':'), ensure_ascii=True))
    # Loss records have their own root, so they must be reported even outside the selected trace.
    loss = sum(r.get('event') == 'logging.loss' for r in records)
    print(f'Diagnostic view: {len(selected)} records; {loss} loss summaries in input; {ignored} non-event lines. Missing events never prove success. No resend/replay was performed.', file=sys.stderr)
    return 0 if selected else 1

if __name__ == '__main__':
    raise SystemExit(main())
