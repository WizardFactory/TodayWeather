#!/usr/bin/env python3
"""S19 integrated release-binary smoke for each ready family.

Runs the actual release binary against task-owned loopback peers: recorded providers,
a frozen legacy origin and the S03 local S3-compatible peer. Asserts process metrics and
peer counters. No live provider, AWS resource, deployment or traffic mirroring.
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
    parser.add_argument('--family', action='append', choices=families.READY,
                        help='repeatable; defaults to every ready family')
    parser.add_argument('--scenario', action='append', help='run only the named scenario IDs')
    parser.add_argument('--report', help='JSON report path (use an ignored reports/ location)')
    args = parser.parse_args(argv)
    binary = str(Path(args.binary).resolve())
    started = datetime.now(timezone.utc).isoformat(timespec='seconds')
    print('execution started UTC ' + started, flush=True)
    report = {'schema': 1, 'started_at_utc': started, 'revision': harness.revision(),
              'binary': {'path': binary, 'sha256': harness.sha256_file(binary)}, 'families': {},
              'limitations': 'Loopback fixtures only; no live provider, AWS, production latency, quota or cutover claim.'}
    status = 0
    for family in args.family or list(families.READY):
        module = families.load(family)
        try:
            results, peers = module.smoke(binary, set(args.scenario) if args.scenario else None)
            report['families'][family] = {'verdict': 'PASS', 'scenarios': results, 'peer_totals': peers}
            print('observed peer totals ' + family + ': ' + json.dumps(peers, sort_keys=True), flush=True)
        except (AssertionError, ValueError) as error:
            # ValueError: an unknown/empty --scenario selection never counts as a pass.
            report['families'][family] = {'verdict': 'FAIL', 'error': str(error)}
            print('FAIL ' + family + ': ' + str(error), flush=True)
            status = 1
    report['verdict'] = 'PASS' if status == 0 else 'FAIL'
    harness.write_report(args.report, report)
    print(report['verdict'] + ' S19 integrated release smoke; loopback fixtures only, no live provider/AWS/cutover claim', flush=True)
    return status


if __name__ == '__main__':
    sys.exit(main())
