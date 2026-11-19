#!/usr/bin/env python3
"""Evaluate retained shadow evidence offline against a pinned criteria document."""

from __future__ import annotations

import argparse
from collections import Counter
from decimal import Decimal, InvalidOperation
from fractions import Fraction
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import sys
import tempfile

TOOLS = Path(__file__).resolve().parent
sys.path[:0] = [str(TOOLS), str(TOOLS.parents[1] / 'deploy/shadow')]

from evidence_audit import audit, file_sha256
from paired_read import MAX_ATTEMPTS, MAX_BODY, validate
from remote import attempt_matches, ledger_identity

DIGEST = re.compile(r'[0-9a-f]{64}')
LABEL = re.compile(r'[A-Za-z0-9_-]{1,64}')
CAP = 2 * MAX_ATTEMPTS
ORIGINS = ('candidate', 'production')
PROFILES = {'local_peer', 'synthetic', 'production_shadow'}
GIB = 1024**3
BASIS_POINTS = 10000
ABSOLUTE_LIMITS = {
    'absolute_error_limits': {'maximum_error_bps': (0, BASIS_POINTS), 'minimum_admitted': (1, MAX_ATTEMPTS)},
    'reader_elapsed_limits': {'maximum_ms': (1, 2**31 - 1), 'minimum_within_bound_bps': (0, BASIS_POINTS),
                              'minimum_admitted': (1, MAX_ATTEMPTS)},
}


class EvidenceError(ValueError):
    """An invalid retained input with a stable failure reason."""


class EvidenceMissing(EvidenceError):
    """An unavailable retained input or a finish that is still incomplete."""


def check(value, reason):
    if not value:
        raise EvidenceError(reason)


def invalid_constant(_):
    raise EvidenceError('non_finite_json')


def unique_object(items):
    value = dict(items)
    check(len(value) == len(items), 'duplicate_json_key')
    return value


def decode(data):
    return json.loads(data, parse_constant=invalid_constant, object_pairs_hook=unique_object)


def canonical(data):
    return json.dumps(data, sort_keys=True, separators=(',', ':'), allow_nan=False)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def safe_path(directory, relative):
    parts = Path(relative).parts
    check(parts and not Path(relative).is_absolute() and '..' not in parts, 'unsafe_evidence_path')
    for part in parts:
        directory = directory / part
        check(not directory.is_symlink(), 'unsafe_evidence_path')
    return directory


def read_file(path, limit):
    check(not path.is_symlink(), 'unsafe_evidence_path')
    if not path.exists():
        raise EvidenceMissing('retained_file_missing')
    check(path.is_file(), 'invalid_retained_file')
    with path.open('rb') as body:
        value = body.read(limit + 1)
    check(len(value) <= limit, 'retained_file_too_large')
    return value


def read_json(path, limit=65536):
    return decode(read_file(path, limit))


FIELD_PATH = re.compile(r'[A-Za-z0-9_-]{1,64}(?:\.[A-Za-z0-9_-]{1,64}){0,7}')
SECTION_TYPES = {'object': dict, 'array': list, 'string': str}
MISSING = object()


def validate_json_contract(contract):
    check(type(contract) is dict and set(contract) == {'sections', 'alignment', 'values'},
          'invalid_json_contract')
    sections, alignment, values = (contract[k] for k in ('sections', 'alignment', 'values'))
    check(type(sections) is dict and sections and type(alignment) is list and type(values) is dict
          and len(sections) + len(values) <= 10 and len(alignment) <= 8 and (not values or alignment)
          and len(set(alignment)) == len(alignment), 'invalid_json_contract')
    check(all(FIELD_PATH.fullmatch(k) for k in [*sections, *alignment, *values])
          and all(kind in SECTION_TYPES for kind in sections.values()), 'invalid_json_path_or_kind')
    for rule in values.values():
        check(rule == 'exact' or (type(rule) is dict and set(rule) == {'absolute_tolerance'}
              and type(rule['absolute_tolerance']) in (int, float) and math.isfinite(rule['absolute_tolerance'])
              and rule['absolute_tolerance'] >= 0), 'invalid_value_rule')


def field(obj, path):
    for part in path.split('.'):
        if type(obj) is not dict or part not in obj:
            return MISSING
        obj = obj[part]
    return obj


def scalar(obj, path):
    value = field(obj, path)
    if type(value) is str:
        return ('string', sha(value.encode('utf-8', 'surrogatepass')))
    if type(value) is bool:
        return ('boolean', value)
    if type(value) in (int, Decimal):
        return ('number', value)
    return None


def body_observation(body, contract):
    data = read_file(body, MAX_BODY)
    try:
        obj = json.loads(data, parse_float=Decimal, parse_constant=invalid_constant,
                         object_pairs_hook=unique_object)
    except (ValueError, RecursionError, InvalidOperation):
        return 'invalid_json', None
    if any(type(field(obj, path)) is not SECTION_TYPES[kind] for path, kind in contract['sections'].items()):
        return 'invalid_section', None
    return 'valid', ([scalar(obj, key) for key in contract['alignment']],
                     {key: scalar(obj, key) for key in contract['values']})


def compare_values(rule, left, right):
    if left is None or right is None:
        return 'missing_value'
    if rule == 'exact':
        return 'within' if left == right else 'different'
    if left[0] != 'number' or right[0] != 'number':
        return 'invalid_type'
    # Bound exponent expansion before converting finite JSON numbers to exact ratios.
    if any(isinstance(x, Decimal) and abs(x.as_tuple().exponent) > 128 for x in (left[1], right[1])):
        return 'unsupported_precision'
    return ('within' if abs(Fraction(left[1]) - Fraction(right[1])) <= Fraction(str(rule['absolute_tolerance']))
            else 'different')


def validate_policy(policy):
    keys = {'schema', 'profile', 'run_id', 'launch_sha256', 'cases', 'minimum_usable_pairs'}
    check(type(policy) is dict and keys <= set(policy) <= keys | ABSOLUTE_LIMITS.keys() and type(policy['schema']) is int
          and policy['schema'] == 1, 'invalid_criteria_schema')
    check(policy['profile'] in PROFILES and re.fullmatch('[a-z0-9-]{1,30}', policy['run_id'])
          and DIGEST.fullmatch(policy['launch_sha256']), 'invalid_criteria_binding')
    cases = policy['cases']
    check(type(cases) is dict and 1 <= len(cases) <= 100, 'invalid_criteria_cases')
    families = set()
    for name, measure in cases.items():
        check(LABEL.fullmatch(name) and type(measure) is dict
              and {'family', 'expected_statuses'} <= set(measure) <= {'family', 'expected_statuses', 'json_contract'} and LABEL.fullmatch(measure['family']),
              'invalid_criteria_case')
        if 'json_contract' in measure:
            validate_json_contract(measure['json_contract'])
        valid = measure['expected_statuses']
        check(type(valid) is list and 1 <= len(valid) <= 500 and all(
            type(status) is int and 100 <= status <= 599 for status in valid
        ) and len(set(valid)) == len(valid), 'invalid_expected_statuses')
        families.add(measure['family'])
    minima = policy['minimum_usable_pairs']
    check(type(minima) is dict and set(minima) == families and all(
        count is None or (type(count) is int and 1 <= count <= MAX_ATTEMPTS) for count in minima.values()
    ), 'invalid_coverage_minima')
    for key, fields in ABSOLUTE_LIMITS.items():
        limits = policy.get(key, {})
        check(type(limits) is dict and set(limits) <= families, 'invalid_' + key)
        for origins in limits.values():
            check(type(origins) is dict and set(origins) <= set(ORIGINS), 'invalid_' + key)
            for limit in origins.values():
                check(type(limit) is dict and set(limit) == set(fields) and all(
                    type(limit[field]) is int and low <= limit[field] <= high
                    for field, (low, high) in fields.items()
                ), 'invalid_' + key)


def read_contract(policy, launch_bytes, reader_bytes):
    check(sha(launch_bytes) == policy['launch_sha256'], 'launch_digest_mismatch')
    launch, reader = decode(launch_bytes), decode(reader_bytes)
    artifacts = launch['plan']['artifacts']
    check(launch['plan']['run_id'] == policy['run_id'] and sha(reader_bytes) == artifacts['reader.json']
          and reader['candidate_sha256'] == artifacts['server2'] and DIGEST.fullmatch(artifacts['paired_read.py']),
          'launch_reader_binding_mismatch')
    identity = ledger_identity(reader, launch)
    validate(reader, identity['candidate'], identity['production'])
    check(set(policy['cases']) == {case['id'] for case in reader['cases']}, 'criteria_cases_do_not_match_reader')
    return launch, reader, identity


def archived_bucket(finish, policy, selected, directory):
    """Find the original versions represented by the selected finish output."""
    prefix = f"evidence/{policy['run_id']}/"
    bucket = f"server2-shadow-{policy['run_id']}-state"
    sources = safe_path(finish, 'sources')
    manifests = ('evidence-manifest.json', 'manifest.json')
    for name in manifests:
        path = safe_path(sources, name)
        if not path.exists():
            continue
        inventory = read_json(path, 32 * 1024**2)
        check(inventory.get('schema') == 1 and sha(canonical(inventory['inventory']).encode())
              == inventory['inventory_sha256'], 'source_inventory_digest_mismatch')
        if inventory['listings'].get(bucket) != 'complete' or inventory.get('missing_evidence_keys'):
            continue
        rows = [
            row for row in inventory['objects']
            if row['bucket'] == bucket and row['kind'] == 'object' and row['key'].startswith(prefix)
            and not (row['status'] == 'omitted' and row.get('reason') == 'uncommitted')
        ]
        if not rows or any(row['status'] != 'exported' for row in rows):
            continue
        versions = [(row['key'], row['version'], row['sha256']) for row in rows]
        if directory != 'paired-' + sha(canonical(sorted(versions)).encode()):
            continue
        catalog = {row['id']: row for row in inventory['inventory']}
        check(len(catalog) == len(inventory['inventory']) and len({row['id'] for row in rows}) == len(rows)
              and all(all(catalog.get(row['id'], {}).get(field) == row[field]
                          for field in ('bucket', 'key', 'version', 'kind', 'size')) for row in rows),
              'source_inventory_receipt_mismatch')
        check(len(rows) <= 10000 and all(type(row['size']) is int and 0 <= row['size'] <= 2*GIB
                                        for row in rows) and sum(row['size'] for row in rows) <= 2*GIB,
              'bucket_evidence_limit')
        objects, contract = [], None
        for row in rows:
            check(DIGEST.fullmatch(row['sha256']) and re.fullmatch(r'objects/[0-9a-f]{64}/body', row['file']),
                  'invalid_version_receipt')
            original = safe_path(sources, row['file'])
            if not original.exists():
                raise EvidenceMissing('original_evidence_version_missing')
            check(original.is_file() and original.stat().st_size == row['size']
                  and file_sha256(original) == row['sha256'], 'original_evidence_version_changed')
            objects.append((row['key'], original))
            if row['key'] == prefix + 'contract.json':
                contract = original
        if contract is None:
            raise EvidenceMissing('bucket_contract_missing')
        payload = read_json(contract, 1024**2)
        bound = read_contract(policy, payload['launch_json'].encode(), payload['reader_json'].encode())
        with tempfile.TemporaryDirectory(prefix='shadow-evaluation-') as temp:
            recovered = Path(temp) / 'replayed'
            report = audit(objects, run_id=policy['run_id'], launch_sha256=policy['launch_sha256'],
                           workdir=recovered)
            check(report['complete'] and report['kind'] == 'final'
                  and report['generation'] == selected['generation'], 'bucket_audit_disagrees')
            expected_ledger = file_sha256(recovered / 'ledger.sqlite3')
        return bound, expected_ledger
    raise EvidenceMissing('bound_source_inventory_missing')


def retained_evidence(directory, policy):
    check(not directory.is_symlink(), 'unsafe_evidence_path')
    directory = directory.resolve(strict=True)
    receipt = read_json(safe_path(directory, 'result.json'), 4 * 1024**2)
    if receipt.get('schema') != 2 or receipt.get('qualification') != 'not_assessed':
        raise EvidenceMissing('unsupported_finish_receipt')
    selected = receipt['host_evidence']
    if selected['complete'] is not True or selected['status'] != 'complete':
        raise EvidenceMissing('finish_evidence_incomplete')
    name = selected['directory']
    check(name == 'ssh-paired' or re.fullmatch(r'paired-[0-9a-f]{64}', name), 'invalid_paired_evidence_path')
    bundle = safe_path(directory, name)
    files = safe_path(bundle, 'files')
    if not files.is_dir():
        raise EvidenceMissing('paired_files_missing')

    if name == 'ssh-paired':
        bound = read_contract(policy, read_file(safe_path(bundle, 'launch.json'), 65536),
                              read_file(safe_path(bundle, 'reader.json'), 65536))
        ledger = safe_path(bundle, 'data/paired/ledger.sqlite3')
        if not ledger.exists():
            raise EvidenceMissing('stopped_ledger_missing')
        check(ledger.is_file() and 0 < ledger.stat().st_size <= 2*GIB, 'invalid_stopped_ledger')
        ledger_sha = file_sha256(ledger)
    else:
        bound, ledger_sha = archived_bucket(directory, policy, selected, name)
        ledger = safe_path(bundle, 'ledger.sqlite3')
        if not ledger.exists():
            raise EvidenceMissing('stopped_ledger_missing')
        check(ledger.is_file() and 0 < ledger.stat().st_size <= 2*GIB
              and file_sha256(ledger) == ledger_sha, 'stopped_ledger_digest_mismatch')
    check(not safe_path(ledger.parent, 'ledger.sqlite3-journal').exists()
          and not safe_path(ledger.parent, 'ledger.sqlite3-wal').exists(), 'unreconciled_stopped_ledger')
    return bound, ledger, files, ledger_sha


def origin_counts():
    return {'admitted': 0, 'terminal': 0, 'captured': 0, 'pending': 0, 'capture_failures': 0,
            'skipped_no_validator': 0, 'status_counts': {}, 'expected_status': 0,
            'unexpected_status': 0, 'transport_errors': 0, 'timeouts': 0, 'truncated_responses': 0,
            'unusable_http_200': 0, 'known_errors': 0}


def attempt_status(raw, ident, files, expected, counts, elapsed_samples, contract, shapes):
    counts['admitted'] += 1
    if raw is None:
        counts['pending'] += 1
        return None
    check(len(raw) <= 65536, 'attempt_result_limit')
    result = decode(raw)
    error = result.get('error') if type(result) is dict else None
    check(type(result) is dict and type(result.get('elapsed_ms')) is int
          and result['elapsed_ms'] >= 0 and (error is None or (type(error) is str and LABEL.fullmatch(error))),
          'invalid_attempt_result')
    counts['terminal'] += 1
    counts['timeouts'] += int(error == 'deadline')
    counts['truncated_responses'] += int(error in ('oversize', 'IncompleteRead'))
    if result.get('captured') is False:
        check('body_bytes' not in result and 'body_sha256' not in result, 'invalid_attempt_result')
        counts['capture_failures'] += 1
        counts['known_errors'] += 1
        return None

    body = safe_path(files, f'{ident}.body')
    meta = read_json(safe_path(files, f'{ident}.json'))
    if not body.exists():
        raise EvidenceMissing('retained_file_missing')
    check(body.is_file() and body.stat().st_size <= MAX_BODY
          and attempt_matches(result, meta, body.stat().st_size, file_sha256(body)), 'attempt_file_mismatch')
    counts['captured'] += 1
    status = result.get('status')
    if status is not None:
        check(type(status) is int and 100 <= status <= 599, 'invalid_http_status')
        by_status = counts['status_counts']
        by_status[str(status)] = by_status.get(str(status), 0) + 1
        counts['expected_status' if status in expected else 'unexpected_status'] += 1
    transport_error = error is not None or status is None
    counts['transport_errors'] += int(transport_error)
    counts['known_errors'] += int(transport_error or status not in expected)
    counts['unusable_http_200'] += int(status == 200 and transport_error)
    usable = not transport_error and status in expected and 200 <= status < 300
    observation = None
    if usable and contract:
        kind, observation = body_observation(body, contract)
        shapes[kind] += 1
        if kind != 'valid':
            usable = False
            counts['known_errors'] += 1
            counts['unusable_http_200'] += int(status == 200)
    if usable:
        elapsed_samples.append(result['elapsed_ms'])
    return status, usable, observation


def coverage(policy, bound, ledger, files):
    launch, reader, identity = bound
    cases = {case['id']: case for case in reader['cases']}
    duration = reader['duration_seconds']
    planned = {name: (duration + case['interval_seconds'] - 1) // case['interval_seconds']
               for name, case in cases.items()}
    families = {name: dict(planned_pairs=0, matched_pairs=0, usable_pairs=0, unaligned_304_pairs=0,
                           differing_status_pairs=0, unavailable_status_pairs=0,
                           cases={}, origins={key: origin_counts() for key in ORIGINS})
                for name in sorted(policy['minimum_usable_pairs'])}
    elapsed_samples = {(family, origin): [] for family in families for origin in ORIGINS}
    shapes, values = {}, {}
    for case, measure in policy['cases'].items():
        contract = measure.get('json_contract')
        if contract:
            check(cases[case]['method'] == 'GET' and not cases[case]['conditional'], 'body_policy_on_nonordinary_get')
            shapes[case] = {origin: Counter(valid=0, invalid_json=0, invalid_section=0) for origin in ORIGINS}
            values[case] = {path: Counter() for path in contract['values']}
    for case, count in planned.items():
        family = families[policy['cases'][case]['family']]
        family['planned_pairs'] += count
        family['cases'][case] = dict(planned_pairs=count, matched_pairs=0, usable_pairs=0,
                                     method=cases[case]['method'], interval_seconds=cases[case]['interval_seconds'])

    db = sqlite3.connect(ledger.as_uri() + '?mode=ro&immutable=1', uri=True)
    try:
        db.execute('PRAGMA trusted_schema=OFF')
        check(db.execute('PRAGMA quick_check').fetchone() == ('ok',), 'invalid_ledger')
        meta = dict(db.execute("SELECT key,value FROM meta WHERE key IN ('started','identity','terminal') LIMIT 4"))
        started = decode(meta['started'])
        check(decode(meta['identity']) == identity and type(started) in (int, float)
              and math.isfinite(started) and started >= launch['epoch'], 'ledger_identity_mismatch')
        terminal = decode(meta['terminal'])
        check(terminal in (None, 'duration-complete', 'origin-outage', 'attempt-cap', 'clock-rollback',
                           'operator-error'), 'invalid_ledger_terminal')

        rows = db.execute('SELECT case_id, slot FROM slots LIMIT ?', (CAP + 1,)).fetchall()
        check(len(rows) <= MAX_ATTEMPTS, 'ledger_slots_limit')
        slots = set(rows)
        check(len(slots) == len(rows) and all(
            case in cases and type(slot) is int and 0 <= slot < planned[case] for case, slot in slots
        ), 'unplanned_ledger_slot')

        seen, observed, pairs = set(), {key: 0 for key in ORIGINS}, {}
        attempts = db.execute('SELECT id,case_id,slot,origin,path,method,started,substr(result,1,65537) '
                              'FROM attempts ORDER BY id LIMIT ?', (CAP + 1,))
        for ident, case, slot, origin, path, method, sent, raw in attempts:
            key = case, slot, origin
            check(type(ident) is int and ident > 0 and (case, slot) in slots and origin in ORIGINS
                  and key not in seen and (path, method) == (cases[case]['path'], cases[case]['method'])
                  and type(sent) in (int, float) and started <= sent < started + duration,
                  'unplanned_attempt')
            seen.add(key)
            observed[origin] += 1
            check(observed[origin] <= reader['max_attempts'], 'attempt_cap_exceeded')
            measure = policy['cases'][case]
            counts = families[measure['family']]['origins'][origin]
            samples = elapsed_samples[measure['family'], origin]
            captured = attempt_status(raw, ident, files, measure['expected_statuses'], counts, samples,
                                      measure.get('json_contract'), shapes.get(case, {}).get(origin))
            if captured is not None:
                pairs.setdefault((case, slot), {})[origin] = captured

        for case, slot, origin, why in db.execute('SELECT case_id,slot,origin,reason FROM skips LIMIT ?', (CAP + 1,)):
            key = case, slot, origin
            check((case, slot) in slots and origin in ORIGINS and key not in seen
                  and cases[case]['conditional'] and why == 'no-validator', 'invalid_skipped_slot')
            seen.add(key)
            families[policy['cases'][case]['family']]['origins'][origin]['skipped_no_validator'] += 1
    finally:
        db.close()

    for (case, _), both in pairs.items():
        if set(both) != set(ORIGINS):
            continue
        family = families[policy['cases'][case]['family']]
        family['matched_pairs'] += 1
        family['cases'][case]['matched_pairs'] += 1
        verdicts = list(both.values())
        statuses = {status for status, _, _ in verdicts}
        if None in statuses:
            family['unavailable_status_pairs'] += 1
        elif len(statuses) != 1:
            family['differing_status_pairs'] += 1
        if 304 in statuses:
            family['unaligned_304_pairs'] += 1
        if len(statuses) == 1 and all(ok for _, ok, _ in verdicts):
            if case in values:
                a, b = (both[origin][2] for origin in ORIGINS)
                for path, rule in policy['cases'][case]['json_contract']['values'].items():
                    if None in a[0] or None in b[0]:
                        result = 'missing_alignment'
                    elif a[0] != b[0]:
                        result = 'unaligned'
                    else:
                        result = compare_values(rule, a[1][path], b[1][path])
                    values[case][path][result] += 1
            family['usable_pairs'] += 1
            family['cases'][case]['usable_pairs'] += 1

    for name, family in families.items():
        minimum = policy['minimum_usable_pairs'][name]
        family['minimum_usable_pairs'] = minimum
        family['status'] = ('unassessed' if minimum is None or not family['usable_pairs']
                            else 'pass' if family['usable_pairs'] >= minimum else 'fail')
        for counts in family['origins'].values():
            counts['unaccounted_slots'] = (family['planned_pairs'] - counts['admitted']
                                           - counts['skipped_no_validator'])
    return families, terminal, elapsed_samples, shapes, values


def absolute_limit_reason(profile, origin, limit, admitted):
    if profile == 'local_peer' and origin == 'production':
        return 'local_peer_is_not_production'
    if profile == 'synthetic':
        return 'synthetic_profile'
    if limit is None:
        return 'absolute_limit_required'
    if admitted < limit['minimum_admitted']:
        return 'insufficient_admitted_attempts'
    return None


def fraction_range(lower, pending, admitted):
    return {'lower_count': lower, 'upper_count': lower + pending, 'admitted': admitted}


def absolute_errors(profile, origin, limit, counts):
    admitted, pending, errors = (counts[field] for field in ('admitted', 'pending', 'known_errors'))
    risk = fraction_range(errors, pending, admitted)
    row = {field: counts[field] for field in ('admitted', 'pending', 'known_errors', 'unexpected_status',
                                              'transport_errors', 'capture_failures', 'timeouts',
                                              'truncated_responses', 'unusable_http_200')}
    row.update(policy=limit, error_fraction=risk, status_501=counts['status_counts'].get('501', 0))
    reason = absolute_limit_reason(profile, origin, limit, admitted)
    status = 'unassessed'
    if reason is None:
        # Compare integer ratios exactly, including an outcome at the policy boundary.
        maximum = limit['maximum_error_bps'] * admitted
        if errors * BASIS_POINTS > maximum:
            status, reason = 'fail', 'known_error_fraction_exceeds_limit'
        elif risk['upper_count'] * BASIS_POINTS <= maximum:
            status, reason = 'pass', 'worst_case_error_fraction_within_limit'
        else:
            reason = 'pending_may_change_result'
    return dict(row, status=status, reason=reason)


def absolute_elapsed(profile, origin, limit, counts, samples):
    admitted, pending = counts['admitted'], counts['pending']
    samples = sorted(samples)
    nearest_rank = {f'p{rank}': samples[(rank * len(samples) + 99) // 100 - 1] if samples else None
                    for rank in (50, 95, 99)}
    within = sum(time <= limit['maximum_ms'] for time in samples) if limit else None
    fraction = fraction_range(within, pending, admitted) if within is not None else None
    reason = absolute_limit_reason(profile, origin, limit, admitted)
    status = 'unassessed'
    if reason is None:
        minimum = limit['minimum_within_bound_bps'] * admitted
        if fraction['upper_count'] * BASIS_POINTS < minimum:
            status, reason = 'fail', 'best_case_within_bound_fraction_below_minimum'
        elif not samples:
            reason = 'successful_elapsed_samples_required'
        elif within * BASIS_POINTS >= minimum:
            status, reason = 'pass', 'worst_case_within_bound_fraction_meets_minimum'
        else:
            reason = 'pending_may_change_result'
    return dict(status=status, reason=reason, policy=limit, admitted=admitted, pending=pending,
                capture_failures=counts['capture_failures'], timeouts=counts['timeouts'],
                known_errors=counts['known_errors'], sample_count=len(samples), nearest_rank_ms=nearest_rank,
                within_bound_fraction=fraction)


def outcomes_status(rows):
    statuses = {row['status'] for row in rows}
    return 'fail' if 'fail' in statuses else 'pass' if statuses == {'pass'} else 'unassessed'


def absolute_criteria(policy, families, elapsed_samples):
    profile = policy['profile']
    errors, elapsed = {}, {}
    for family, record in families.items():
        error_limits = policy.get('absolute_error_limits', {}).get(family, {})
        elapsed_limits = policy.get('reader_elapsed_limits', {}).get(family, {})
        errors[family], elapsed[family] = {}, {}
        for origin, counts in record['origins'].items():
            errors[family][origin] = absolute_errors(profile, origin, error_limits.get(origin), counts)
            elapsed[family][origin] = absolute_elapsed(profile, origin, elapsed_limits.get(origin), counts,
                                                      elapsed_samples[family, origin])
    return [
        dict(id='C5', status=outcomes_status(row for family in errors.values() for row in family.values()),
             reason='absolute_admitted_attempt_error_fraction', families=errors, comparable_baseline='unassessed'),
        dict(id='C6', status=outcomes_status(row for family in elapsed.values() for row in family.values()),
             reason='reader_elapsed_ms', families=elapsed, sample_population='expected_http_2xx_without_capture_error',
             cold='unassessed', cache_hit='unassessed', assembly='unassessed', comparable_baseline='unassessed'),
    ]


def evaluate(policy, criteria_sha, evidence):
    report = {'schema': 1, 'criteria_reference': 'qualification_criteria.md', 'profile': policy['profile'], 'profile_provenance': 'declared_by_criteria',
              'run_id': policy['run_id'],
              'criteria_sha256': criteria_sha, 'launch_sha256': policy['launch_sha256'], 'evidence': None}
    integrity = {'id': 'C1', 'status': 'unassessed', 'reason': 'retained_evidence_unavailable'}
    scope = {'id': 'C2', 'status': 'unassessed', 'reason': 'evidence_required'}
    absolute = [dict(id=key, status='unassessed', reason='evidence_required') for key in ('C5', 'C6')]
    shapes, values, http = {}, {}, {}
    try:
        bound, ledger, files, ledger_sha = retained_evidence(evidence, policy)
        families, terminal, elapsed_samples, shapes, values = coverage(policy, bound, ledger, files)
        launch, reader, identity = bound
        binding = {
            'source': 'ssh' if files.parent.name == 'ssh-paired' else 'bucket',
            'launch_source_commit': launch['plan']['source_commit'],
            'ledger_sha256': ledger_sha, 'reader_sha256': launch['plan']['artifacts']['reader.json'],
            'candidate_sha256': reader['candidate_sha256'],
            'sampler_sha256': identity['sampler_sha256'], 'terminal': terminal,
        }
        absolute = absolute_criteria(policy, families, elapsed_samples)
        http = {family: {key: record[key] for key in ('matched_pairs', 'differing_status_pairs',
                                                     'unavailable_status_pairs', 'unaligned_304_pairs')}
                for family, record in families.items()}
        report['evidence'] = binding
        integrity.update(status='pass', reason='retained_launch_reader_ledger_and_pairs_verified')
        scope.update(status=outcomes_status(families.values()), reason='usable_pairs_against_declared_count_minima',
                     families=families, period_coverage='unassessed')
    except (EvidenceMissing, FileNotFoundError) as error:
        if isinstance(error, EvidenceMissing):
            integrity['reason'] = str(error)
    except EvidenceError as error:
        integrity.update(status='fail', reason=str(error))
    except (ValueError, TypeError, KeyError, AttributeError, OSError, sqlite3.Error):
        integrity.update(status='fail', reason='invalid_retained_evidence')
    comparison = ('local_peer_is_not_production' if policy['profile'] == 'local_peer' else
                  'synthetic_profile' if policy['profile'] == 'synthetic' else 'response_policy_required')
    shape_status, value_status = 'unassessed', 'unassessed'
    shape_reason, value_reason = comparison, comparison
    if integrity['status'] != 'pass':
        shapes, values, http = {}, {}, {}
        shape_reason = value_reason = 'verified_evidence_required'
    elif policy['profile'] == 'production_shadow':
        shape_reason = value_reason = 'coverage_and_response_policy_required'
        if any(counts['unexpected_status'] for record in families.values() for counts in record['origins'].values()):
            shape_status, shape_reason = 'fail', 'unexpected_http_status'
        if any(counts['invalid_section'] or counts['invalid_json']
               for origins in shapes.values() for counts in origins.values()):
            shape_status, shape_reason = 'fail', 'required_response_shape_violated'
        if any(counts['different'] or counts['invalid_type'] or counts['missing_value']
               for fields in values.values() for counts in fields.values()):
            value_status, value_reason = 'fail', 'aligned_required_value_violated'
    report['criteria'] = [
        integrity, scope,
        dict(id='C3', status=shape_status, reason=shape_reason, observations=shapes, http_by_family=http),
        dict(id='C4', status=value_status, reason=value_reason, observations=values),
        *absolute,
        dict(id='C7', status='unassessed', reason='rehearsal_measurements_required'),
        dict(id='C8', status='unassessed', reason='production_control_not_supplied'),
    ]
    report['recommendation'] = 'no_go' if any(row['status'] == 'fail' for row in report['criteria']) else 'hold'
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--criteria', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        frozen = read_file(args.criteria, 65536)
        policy = decode(frozen)
        validate_policy(policy)
        report = evaluate(policy, sha(frozen), args.evidence)
        descriptor = os.open(args.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            stream.write(canonical(report) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
    except (ValueError, TypeError, KeyError, OverflowError, RecursionError, OSError):
        parser.exit(2, 'invalid qualification criteria or report output\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
