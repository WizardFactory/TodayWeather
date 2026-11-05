#!/usr/bin/env python3
"""Offline KMA history and forecast coverage and exact value-difference evidence.

These necessary gates never certify a complete client response by themselves.
Latest products, native raw identity/integrity, recent public slots, provenance,
functional headers and end-to-end timing remain independent acceptance gates.
No provider, legacy service, S3 or credential access is performed.
"""
import argparse
import base64
from collections import Counter
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import json
import math
from pathlib import Path


KST = timezone(timedelta(hours=9))
WEATHER_FIELDS = frozenset(('pop pty r06 r06Approx r06Hours reh s06 s06Approx '
                           's06Hours sky t3h t1h tmn tmx uuu vvv wav vec wsd '
                           'rn1 lgt taMin taMax t1d skyAm skyPm ptyAm ptyPm '
                           'lgtAm lgtPm wfAm wfPm').split())
MAX_INPUT = 32 * 1024 * 1024
# Legacy daily rows reach D+10; every short issue reaches the end of D+2 in three-hour slots.
FORECAST_DAYS = 10
MID_MORNING_HOUR = 8
SHORT_STEP = timedelta(hours=3)
REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = REPOSITORY_ROOT / 'server2' / 'config' / 'contracts' / 'kma-history.v1.json'


def as_kst(value):
    stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if stamp.tzinfo is None:
        raise ValueError('explicit timezone required')
    return stamp.astimezone(KST)


def required_hours(as_of):
    """Seven completed KST days, under native 0000 -> preceding 2400 attribution."""
    end = as_kst(as_of).replace(hour=0, minute=0, second=0, microsecond=0)
    return [(end - timedelta(hours=i)).isoformat() for i in range(167, -1, -1)]


def finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def valid_field(name, value):
    if name in ('wfAm', 'wfPm', 'skyAm', 'skyPm'):
        # Public daily SKY is an icon string after the existing presentation stage.
        return isinstance(value, str) and bool(value.strip())
    if not finite_number(value):
        return False
    if name in ('tmn', 'tmx'):
        return -90 < value < 90 and value != -50
    if name == 'sky':
        return value in (1, 2, 3, 4)
    if name == 'pty':
        return value in range(8)
    return value >= 0


def audit_history(body, as_of, hourly=None):
    required = required_hours(as_of)
    expected = set(required)
    rows = hourly or []
    indexed = {}
    counts = Counter()
    for row in rows:
        key = as_kst(row['valid_at']).isoformat()
        if key in expected:
            counts[key] += 1
            indexed[key] = row
    missing = [t for t in required if t not in indexed]
    hourly_gaps = [dict(valid_at=t, field=field) for t in required if t in indexed
                   for field in ('sky', 'pty') if not valid_field(field, indexed[t].get(field))]
    forbidden = [t for t in required if t in indexed
                 and indexed[t].get('source') not in ALLOWED_SOURCES]
    start = as_kst(required[0]).date()
    dates = [(start + timedelta(days=i)).strftime('%Y%m%d') for i in range(7)]
    daily = body.get('midData', {}).get('dailyData', [])
    daily_counts = Counter(str(r.get('date')) for r in daily)
    daily_by_date = {str(r.get('date')): r for r in daily}
    daily_gaps = []
    for day in dates:
        row = daily_by_date.get(day, {})
        for field in ('tmn', 'tmx', 'rn1', 'skyAm', 'skyPm', 'wfAm', 'wfPm'):
            if not valid_field(field, row.get(field)):
                daily_gaps.append(dict(date=day, field=field))
        if valid_field('tmn', row.get('tmn')) and valid_field('tmx', row.get('tmx')):
            if row['tmn'] > row['tmx']:
                daily_gaps.append(dict(date=day, field='tmn>tmx'))
    duplicate_hours = sorted(t for t, n in counts.items() if n > 1)
    duplicate_dates = [d for d in dates if daily_counts[d] > 1]
    complete = not (missing or hourly_gaps or forbidden or daily_gaps
                    or duplicate_hours or duplicate_dates)
    return dict(history_complete=complete, full_response_qualified=False,
                qualification_scope='necessary seven-day history checks only; no full-response or value-equivalence certification',
                required_hour_count=len(required), missing_hour_count=len(missing),
                missing_hours=missing, hourly_field_gap_count=len(hourly_gaps),
                hourly_field_gaps=hourly_gaps, duplicate_hours=duplicate_hours,
                forbidden_source_hours=forbidden, daily_field_gap_count=len(daily_gaps),
                daily_field_gaps=daily_gaps, duplicate_dates=duplicate_dates,
                native_history_status_is_not_coverage_proof=True)


def slot_time(row):
    """A short slot's end; 0300 as text and 3 as a number are the same hour, 24 ends the day."""
    time = int(row['time'])
    hour = time // 100 if time > 24 else time
    return datetime.strptime(str(row['date']), '%Y%m%d').replace(tzinfo=KST) + timedelta(hours=hour)


def slot_label(moment):
    day = moment - timedelta(hours=1)
    midnight = day.replace(hour=0)
    return f"{day.strftime('%Y%m%d')}:{int((moment - midnight).total_seconds()) // 3600:02}"


def audit_forecast(body, as_of):
    """Forecast coverage format rules cannot see: a valid body can still miss days."""
    today = as_kst(as_of).replace(hour=0, minute=0, second=0, microsecond=0)
    mid = body.get('midData', {})
    status = mid.get('dailyStatus')
    healthy = isinstance(status, dict) and status.get('healthy') is True
    reasons = list(status.get('reasons', [])) if isinstance(status, dict) else ['daily-status-missing']
    dates = {str(r.get('date')) for r in mid.get('dailyData', [])}
    # The mid target before 08 KST is the previous day's 18:00 issue, so its last day is D+9.
    last_day = FORECAST_DAYS if as_kst(as_of).hour >= MID_MORNING_HOUR else FORECAST_DAYS - 1
    expected = [(today + timedelta(days=i)).strftime('%Y%m%d') for i in range(last_day + 1)]
    missing = [d for d in expected if d not in dates]
    slots = sorted(slot_time(r) for r in body.get('short', []))
    starts = bool(slots) and slots[0] <= as_kst(as_of) + SHORT_STEP
    gaps = []
    for earlier, later in zip(slots, slots[1:]):
        moment = earlier + SHORT_STEP
        while moment < later:
            gaps.append(slot_label(moment))
            moment += SHORT_STEP
    reaches = bool(slots) and slots[-1] >= today + timedelta(days=3)
    return dict(forecast_complete=healthy and not missing and starts and reaches and not gaps,
                daily_status_healthy=healthy, daily_status_reasons=reasons,
                missing_forecast_dates=missing, short_slot_count=len(slots),
                short_starts_by_now=starts, short_reaches_second_future_day=reaches,
                short_slot_gaps=gaps)


def value_at(row, key):
    return dict(present=True, value=row[key]) if key in row else dict(present=False)


def historical_differences(before, after, as_of):
    today = as_kst(as_of).strftime('%Y%m%d')
    differences = []
    for view in ('short', 'daily'):
        def index(body):
            rows = body.get('short', []) if view == 'short' else body.get('midData', {}).get('dailyData', [])
            return {(str(r['date']), int(r.get('time', 0))): r for r in rows
                    if str(r['date']) < today}
        a, b = index(before), index(after)
        for slot in sorted(a.keys() | b.keys()):
            left, right = a.get(slot, {}), b.get(slot, {})
            for key in sorted(WEATHER_FIELDS & (left.keys() | right.keys())):
                if json.dumps(value_at(left, key), sort_keys=True) != json.dumps(value_at(right, key), sort_keys=True):
                    differences.append(dict(view=view, slot=f'{slot[0]}:{slot[1]:02}',
                                            field=key, before=value_at(left, key),
                                            after=value_at(right, key)))
    return differences


def load(path):
    path = Path(path)
    if path.stat().st_size > MAX_INPUT:
        raise ValueError('input exceeds 32 MiB')
    with (gzip.open(path, 'rb') if path.suffix == '.gz' else path.open('rb')) as f:
        data = f.read(MAX_INPUT + 1)
    if len(data) > MAX_INPUT:
        raise ValueError('expanded input exceeds 32 MiB')
    def reject(value):
        raise ValueError(f'non-JSON number {value}')
    result = json.loads(data, parse_constant=reject)
    return result


CONTRACT_KEYS = ('contract', 'version', 'scope', 'aggregation_policy_version', 'sources', 'nodes',
                 'edges', 'rules', 'invariants', 'budgets', 'not_declared')
NATURES = frozenset(('observed', 'forecast'))
STAGES = frozenset(('hourly', 'slot', 'half', 'day', 'wire'))
APPROVALS = frozenset(('approved', 'proposed', 'rejected'))
VERIFICATIONS = frozenset(('verified', 'unverified', 'failed', 'existing'))
CONFORMANCE = frozenset(('passed', 'failed', 'unknown'))


def load_contract(path=CONTRACT_PATH):
    contract = load(path)
    if not isinstance(contract, dict):
        raise ValueError('history contract must be a JSON object')
    return contract


def validate_contract(contract, root=None):
    """Structural checks only; behavior is checked by the Rust tests the invariants name."""
    errors = [f'missing {key}' for key in CONTRACT_KEYS if key not in contract]
    if errors:
        return errors
    sources, nodes, rules = contract['sources'], contract['nodes'], contract['rules']
    for sid, source in sources.items():
        if source.get('nature') not in NATURES:
            errors.append(f'source {sid} nature {source.get("nature")}')
        if not isinstance(source.get('history_allowed'), bool):
            errors.append(f'source {sid} history_allowed')
        if not source.get('evidence_label'):
            errors.append(f'source {sid} evidence_label')
    for nid, node in nodes.items():
        if node.get('stage') not in STAGES:
            errors.append(f'node {nid} stage {node.get("stage")}')
        errors += [f'{nid} input {name}' for name in node.get('inputs', []) if name not in nodes]
        if 'rule' in node and node['rule'] not in rules:
            errors.append(f'{nid} rule {node["rule"]}')
    seen = set()
    for edge in contract['edges']:
        eid, source = edge.get('id'), edge.get('source')
        if eid in seen:
            errors.append(f'duplicate edge id {eid}')
        seen.add(eid)
        if edge.get('node') not in nodes:
            errors.append(f'{eid} node {edge.get("node")}')
        if source not in sources and source not in nodes:
            errors.append(f'{eid} source {source}')
        if edge.get('approval') not in APPROVALS:
            errors.append(f'{eid} approval {edge.get("approval")}')
        if edge.get('verification') not in VERIFICATIONS:
            errors.append(f'{eid} verification {edge.get("verification")}')
        if not edge.get('transform'):
            errors.append(f'{eid} transform')
        if edge.get('approval') == 'approved' and source in sources and not sources[source].get('history_allowed'):
            errors.append(f'I6: approved history edge {eid} uses forbidden source {source}')
    for rid, rule in rules.items():
        implementation = rule.get('implementation')
        if not implementation:
            errors.append(f'{rid} implementation missing')
        elif root is not None and not (Path(root) / implementation).is_file():
            errors.append(f'{rid} implementation {implementation} not found')
    seen = set()
    for invariant in contract['invariants']:
        iid = invariant.get('id')
        if iid in seen:
            errors.append(f'duplicate invariant id {iid}')
        seen.add(iid)
        if not invariant.get('statement'):
            errors.append(f'{iid} statement')
        if not invariant.get('checked_by'):
            errors.append(f'{iid} checked_by')
        elif root is not None:
            errors += [f'{iid} checked_by {path} not found' for path in invariant['checked_by']
                       if not (Path(root) / path).is_file()]
    for bid, budget in contract['budgets'].items():
        if budget.get('conformance') not in CONFORMANCE:
            errors.append(f'{bid} conformance {budget.get("conformance")}')
    if root is not None:
        errors += [f'evidence {path} not found' for path in contract.get('evidence', [])
                   if not (Path(root) / path).is_file()]
    return errors


def allowed_history_labels(contract):
    return frozenset(source['evidence_label'] for source in contract['sources'].values()
                     if source.get('history_allowed') is True)


def coverage_edges(contract):
    """Proposed or rejected rules never count toward coverage."""
    return [edge for edge in contract['edges'] if edge.get('approval') == 'approved']


def references_contract(doc_path, contract_path=CONTRACT_PATH):
    relative = Path(contract_path).resolve().relative_to(REPOSITORY_ROOT).as_posix()
    return relative in Path(doc_path).read_text(encoding='utf-8')


ALLOWED_SOURCES = allowed_history_labels(load_contract())


def response_body(path, record_index=None):
    result = load(path)
    if 'records' in result or 'requests' in result:
        records = result.get('records', result.get('requests'))
        if record_index is None and len(records) != 1:
            raise ValueError('explicit record index required for multiple captured responses')
        index = 0 if record_index is None else record_index
        if not 0 <= index < len(records):
            raise ValueError('captured response index out of range')
        result = json.loads(base64.b64decode(records[index]['body_base64'], validate=True))
    if not isinstance(result, dict):
        raise ValueError('JSON object response required')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--validate-contract', action='store_true',
                        help='check the declared history contract structure and exit')
    parser.add_argument('--body')
    parser.add_argument('--as-of')
    parser.add_argument('--hourly-evidence')
    parser.add_argument('--compare')
    parser.add_argument('--record-index', type=int,
                        help='explicit index in both captured-record inputs; no implicit selection')
    parser.add_argument('--report')
    args = parser.parse_args()
    if args.validate_contract:
        errors = validate_contract(load_contract(), REPOSITORY_ROOT)
        print(json.dumps(dict(contract=CONTRACT_PATH.relative_to(REPOSITORY_ROOT).as_posix(),
                              errors=errors), ensure_ascii=False))
        return 2 if errors else 0
    if not (args.body and args.as_of and args.report):
        parser.error('--body, --as-of and --report are required')
    body = response_body(args.body, args.record_index)
    hourly = load(args.hourly_evidence) if args.hourly_evidence else None
    result = dict(schema=1, as_of=args.as_of,
                  input_sha256=hashlib.sha256(Path(args.body).read_bytes()).hexdigest(),
                  history=audit_history(body, args.as_of, hourly),
                  forecast=audit_forecast(body, args.as_of))
    if args.compare:
        diff = historical_differences(body, response_body(args.compare, args.record_index), args.as_of)
        result['historical_weather_differences'] = diff
        result['historical_weather_difference_count'] = len(diff)
        result['compared_input_sha256'] = hashlib.sha256(Path(args.compare).read_bytes()).hexdigest()
    Path(args.report).write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
    print(json.dumps(dict(history_complete=result['history']['history_complete'],
                          forecast_complete=result['forecast']['forecast_complete'],
                          full_response_qualified=False,
                          historical_weather_difference_count=result.get('historical_weather_difference_count'))))
    return 0 if result['history']['history_complete'] and result['forecast']['forecast_complete'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
