#!/usr/bin/env python3
"""Prove the hosted nextest partitions run every workspace test that `cargo test` runs, once.

`cargo test --workspace -- --list` names the runnable and ignored tests per test binary; the doc
tests run separately. Each `cargo nextest list --partition count:k/N` must select a disjoint
part, and together exactly the non-ignored, non-doc tests. A nextest default-filter, a target
selection change or a broken partition count therefore fails this check.
"""
import argparse
from collections import Counter
import json
import subprocess
import sys


def libtest_names(*args):
    out = subprocess.run(['cargo', 'test', '--locked', '--workspace', *args], check=True,
                         capture_output=True, text=True).stdout
    return Counter(line[:-len(': test')] for line in out.splitlines() if line.endswith(': test'))


def nextest_names(partition):
    out = subprocess.run(['cargo', 'nextest', 'list', '--locked', '--workspace', '--message-format', 'json',
                          '--partition', partition], check=True, capture_output=True, text=True).stdout
    names = Counter()
    for suite in json.loads(out)['rust-suites'].values():
        for name, case in suite['testcases'].items():
            if case['filter-match']['status'] == 'matches':
                names[name] += 1
    return names


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--shards', type=int, required=True)
    shards = parser.parse_args().shards
    runnable = (libtest_names('--', '--list') - libtest_names('--', '--list', '--ignored')
                - libtest_names('--doc', '--', '--list'))
    parts = [nextest_names(f'count:{k}/{shards}') for k in range(1, shards + 1)]
    combined = sum(parts, Counter())
    if combined != runnable:
        missing, extra = runnable - combined, combined - runnable
        sys.exit(f'nextest partitions differ from cargo test: {sum(missing.values())} missing '
                 f'{sorted(missing)[:5]}, {sum(extra.values())} extra {sorted(extra)[:5]}')
    print(f'{sum(runnable.values())} tests in {shards} disjoint partitions match cargo test', flush=True)


if __name__ == '__main__':
    main()
