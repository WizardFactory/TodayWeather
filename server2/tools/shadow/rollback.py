#!/usr/bin/env python3
"""Cache-aware rollback rehearsal for a ready family, using the actual release binary.

For the gateway family the rehearsal restarts legacy -> native(mock) -> legacy with the
same legacy origin, so /weather and /geocode switch together. Each phase checks the
Cache-Control contract, cross-switch ETag revalidation, no-store errors, empty-memory
re-acquisition cost and the 9s/5s/3s deadline caps. Loopback peers only.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

import harness
import families


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True)
    parser.add_argument('--family', default='gateway', choices=families.READY)
    parser.add_argument('--skip-deadlines', action='store_true', help='omit the ~25s stalled-dependency checks')
    parser.add_argument('--report', help='JSON report path (use an ignored reports/ location)')
    args = parser.parse_args(argv)
    binary = str(Path(args.binary).resolve())
    started = datetime.now(timezone.utc).isoformat(timespec='seconds')
    print('rollback rehearsal started UTC ' + started + ' family=' + args.family, flush=True)
    report = {'schema': 1, 'family': args.family, 'started_at_utc': started, 'revision': harness.revision(),
              'binary': {'path': binary, 'sha256': harness.sha256_file(binary)},
              'limitations': 'Process-restart switch on loopback peers; no production traffic, CloudFront or deployment action.'}
    try:
        report['phases'] = families.load(args.family).rollback(binary, deadlines=not args.skip_deadlines)
        report['verdict'] = 'PASS'
    except AssertionError as error:
        report['verdict'] = 'FAIL'
        report['error'] = str(error)
        print('FAIL rollback: ' + str(error), flush=True)
    harness.write_report(args.report, report)
    print(report['verdict'] + ' cache-aware rollback rehearsal ' + args.family + ' (' +
          ' -> '.join(p['mode'] for p in report.get('phases', [])) + ')', flush=True)
    return 0 if report['verdict'] == 'PASS' else 1


if __name__ == '__main__':
    sys.exit(main())
