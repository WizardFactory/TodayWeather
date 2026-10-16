#!/usr/bin/env python3
"""Offline paired replay: one frozen workload, a baseline and a candidate release process.

Each family module supplies the frozen inputs and starts both sides against task-owned
loopback peers. Every response or acquisition difference is either matched to a declared
difference (with its reason) or reported as unexplained; any unexplained difference fails.
No live shadow configuration, traffic mirroring or provider call is performed.
"""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

import harness
import families

BACKEND_KINDS = ('backend',)


def header_differences(left, right, ignore=()):
    names = sorted((set(left) | set(right)) - set(ignore))
    return [name for name in names if left.get(name) != right.get(name)]


def first_difference(left, right):
    for index, (a, b) in enumerate(zip(left, right)):
        if a != b:
            return index
    return min(len(left), len(right)) if len(left) != len(right) else None


def declared_for(declared, scope, item, pass_name):
    """Return the first declared difference covering a header name or acquisition kind."""
    for entry in declared:
        if entry.get('scope') != scope:
            continue
        if 'passes' in entry and pass_name not in entry['passes']:
            continue
        if item in entry.get('names', []) or item in entry.get('kinds', []):
            return entry['id']
    return None


def acquisitions(hops):
    counts = {}
    for hop in hops:
        if hop[0] not in BACKEND_KINDS:
            counts[hop[0]] = counts.get(hop[0], 0) + 1
    return counts


def compare(baseline, candidate, declared, plan=None):
    """Classify differences between matched baseline/candidate records.

    Records: {id, pass, status, headers, body, hops:[(kind, path, language)]}.
    plan: {request: {pass: {side: {kind: count}}}}. A declared acquisition difference
    applies only when both sides match the planned per-request counts exactly; any
    deviation from a planned count is unexplained even if both sides agree.
    """
    declared_out, unexplained = [], []
    seen = {'baseline': set(), 'candidate': set()}
    for side, records in (('baseline', baseline), ('candidate', candidate)):
        for record in records:
            key = (record['id'], record['pass'])
            if key in seen[side]:
                unexplained.append({'request': key[0], 'pass': key[1], 'kind': 'duplicate-' + side})
            seen[side].add(key)
    index = {(r['id'], r['pass']): r for r in candidate}
    for left in baseline:
        key = (left['id'], left['pass'])
        right = index.pop(key, None)
        where = {'request': left['id'], 'pass': left['pass']}
        if right is None:
            unexplained.append(dict(where, kind='missing-candidate'))
            continue
        if left['status'] != right['status']:
            unexplained.append(dict(where, kind='status', baseline=left['status'], candidate=right['status']))
        if left['body'] != right['body']:
            unexplained.append(dict(where, kind='body', baseline_sha256=hashlib.sha256(left['body']).hexdigest(),
                                    candidate_sha256=hashlib.sha256(right['body']).hexdigest(),
                                    first_difference=first_difference(left['body'], right['body'])))
        for name in header_differences(left['headers'], right['headers']):
            match = declared_for(declared, 'header', name, left['pass'])
            item = dict(where, kind='header', name=name)
            (declared_out if match else unexplained).append(dict(item, declared=match) if match else
                                                            dict(item, baseline=left['headers'].get(name), candidate=right['headers'].get(name)))
        left_backend = [h for h in left['hops'] if h[0] in BACKEND_KINDS]
        right_backend = [h for h in right['hops'] if h[0] in BACKEND_KINDS]
        if left_backend != right_backend:
            unexplained.append(dict(where, kind='backend-hops', baseline=len(left_backend), candidate=len(right_backend)))
        left_acq, right_acq = acquisitions(left['hops']), acquisitions(right['hops'])
        expected = (plan or {}).get(left['id'], {}).get(left['pass'])
        if expected is not None:
            deviations = [(side, observed, expected.get(side, {})) for side, observed in
                          (('baseline', left_acq), ('candidate', right_acq)) if observed != expected.get(side, {})]
            for side, observed, wanted in deviations:
                unexplained.append(dict(where, kind='acquisition-plan', side=side, observed=observed, expected=wanted))
            if deviations:
                continue
        for kind in sorted(set(left_acq) | set(right_acq)):
            if left_acq.get(kind, 0) == right_acq.get(kind, 0):
                continue
            match = declared_for(declared, 'acquisition', kind, left['pass']) if expected is not None else None
            item = dict(where, kind='acquisition', source=kind, baseline=left_acq.get(kind, 0), candidate=right_acq.get(kind, 0))
            (declared_out if match else unexplained).append(dict(item, declared=match) if match else item)
    for key in index:
        unexplained.append({'request': key[0], 'pass': key[1], 'kind': 'missing-baseline'})
    return declared_out, unexplained


def oracle_check(records, cases, transport):
    """Compare records naming an S02 legacy case with its recorded status/body/headers."""
    mismatches, checked = [], 0
    for record in records:
        if not record.get('oracle'):
            continue
        checked += 1
        case = cases.get(record['oracle'])
        if case is None:
            mismatches.append({'request': record['id'], 'pass': record['pass'], 'oracle': record['oracle'],
                               'problems': [{'field': 'oracle', 'expected': record['oracle'], 'observed': None}]})
            continue
        body = base64.b64decode(case['body_base64'])
        expected = {}
        for name, value in case['headers']:
            expected[name] = value if isinstance(value, str) else ', '.join(value)
        problems = []
        if record['status'] != case['status']:
            problems.append({'field': 'status', 'expected': case['status'], 'observed': record['status']})
        if record['body'] != body:
            problems.append({'field': 'body', 'expected_sha256': case['body_sha256'],
                             'observed_sha256': hashlib.sha256(record['body']).hexdigest()})
        for name in sorted(set(expected) - set(transport)):
            if record['headers'].get(name) != expected[name]:
                problems.append({'field': 'header', 'name': name, 'expected': expected[name], 'observed': record['headers'].get(name)})
        if problems:
            mismatches.append({'request': record['id'], 'pass': record['pass'], 'oracle': record['oracle'], 'problems': problems})
    return checked, mismatches


def summarize(records):
    """Pass-level percentiles plus the first-pass requests that actually acquired a geocode.

    `cold_pass` is the first pass in a fresh process (it mixes cache misses, RAM hits and
    error routes); `cold_miss` keeps only requests with a non-backend acquisition hop.
    """
    groups = {}
    for record in records:
        groups.setdefault(record['pass'] + '_pass', []).append(record['elapsed_ms'])
        if record['pass'] == 'cold' and acquisitions(record['hops']):
            groups.setdefault('cold_miss', []).append(record['elapsed_ms'])
    return {name: harness.percentiles(values) for name, values in sorted(groups.items())}


def run(family, binary, workload, report_path, self_check):
    module = families.load(family)
    fixture = json.loads(Path(workload).read_text())
    if fixture.get('schema') != 1 or fixture.get('family') != family:
        raise ValueError('workload schema/family mismatch')
    started = datetime.now(timezone.utc).isoformat(timespec='seconds')
    print('replay started UTC ' + started + ' family=' + family, flush=True)
    sides = {}
    for side in ('baseline', 'candidate'):
        records, info = module.replay_side(binary, fixture, side)
        sides[side] = {'records': records, 'info': info}
        print('side ' + side + ': ' + info['configuration'] + '; ' + json.dumps(summarize(records), sort_keys=True), flush=True)
    declared = fixture['declared_differences']
    transport = next((d['names'] for d in declared if d['id'] == 'D-TRANSPORT'), [])
    plan = {item['id']: item['acquisitions'] for item in fixture['workload'] if 'acquisitions' in item}
    declared_out, unexplained = compare(sides['baseline']['records'], sides['candidate']['records'], declared, plan)
    cases = module.oracle_cases()
    passes = list(getattr(module, 'PASSES', ('cold', 'warm')))
    expected_oracles = len(passes) * sum(1 for item in fixture['workload'] if item.get('oracle'))
    oracle = {}
    for side in sides:
        checked, mismatches = oracle_check(sides[side]['records'], cases, transport)
        if checked != expected_oracles:
            mismatches.append({'problems': [{'field': 'oracle-count', 'expected': expected_oracles, 'observed': checked}]})
        merged, merge_mismatches = module.structural_oracle(fixture, sides[side]['records'])
        oracle[side] = {'checked': checked, 'structural_checked': merged, 'mismatches': mismatches + merge_mismatches}
    report = {
        'schema': 1, 'family': family, 'started_at_utc': started,
        'revision': harness.revision(),
        'binary': {'path': str(Path(binary)), 'sha256': harness.sha256_file(binary)},
        'workload': {'path': str(Path(workload).resolve().relative_to(harness.ROOT)), 'sha256': harness.sha256_file(workload),
                     'requests': len(fixture['workload']), 'passes': passes},
        'sides': {side: dict(sides[side]['info'], percentiles_ms=summarize(sides[side]['records'])) for side in sides},
        'declared_differences': {'definitions': declared, 'observed': declared_out},
        'unexplained_differences': unexplained,
        'oracle': oracle,
        'limitations': module.REPLAY_LIMITATIONS,
    }
    failed = bool(unexplained) or any(oracle[s]['mismatches'] for s in oracle)
    if self_check:
        records, info = module.replay_side(binary, fixture, 'baseline', perturb=True)
        _, perturbed = compare(records, sides['candidate']['records'], declared, plan)
        report['self_check'] = {'perturbation': info['perturbation'], 'unexplained': len(perturbed),
                                'detected': bool(perturbed)}
        print('self-check perturbation "' + info['perturbation'] + '": ' + str(len(perturbed)) + ' unexplained differences detected', flush=True)
        failed = failed or not perturbed
    report['verdict'] = 'FAIL' if failed else 'PASS'
    harness.write_report(report_path, report)
    print('declared differences observed: ' + json.dumps(sorted({d['declared'] for d in declared_out})), flush=True)
    print('unexplained differences: ' + str(len(unexplained)), flush=True)
    for item in unexplained[:20]:
        print('  UNEXPLAINED ' + json.dumps(item, ensure_ascii=False, sort_keys=True), flush=True)
    for side in oracle:
        print('oracle ' + side + ': ' + getattr(module, 'ORACLE_LABEL', 'S02') + ' ' + str(oracle[side]['checked']) + ' checked, weather merge ' +
              str(oracle[side]['structural_checked']) + ' checked, ' + str(len(oracle[side]['mismatches'])) + ' mismatches', flush=True)
        for item in oracle[side]['mismatches'][:10]:
            print('  ORACLE ' + json.dumps(item, ensure_ascii=False, sort_keys=True), flush=True)
    print(report['verdict'] + ' paired replay ' + family + '; offline frozen inputs only, not a live shadow', flush=True)
    return 0 if not failed else 1


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True)
    parser.add_argument('--family', default='gateway', choices=families.READY)
    parser.add_argument('--workload', help='frozen workload JSON; defaults to the family fixture')
    parser.add_argument('--report', help='JSON report path (use an ignored reports/ location)')
    parser.add_argument('--self-check', action='store_true', help='also prove a perturbed baseline is flagged')
    args = parser.parse_args(argv)
    workload = args.workload or str(families.load(args.family).REPLAY_FIXTURE)
    return run(args.family, str(Path(args.binary).resolve()), workload, args.report, args.self_check)


if __name__ == '__main__':
    sys.exit(main())
