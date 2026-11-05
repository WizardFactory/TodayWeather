#!/usr/bin/env python3
"""Client delivery eval for KMA weather response bodies.

Each body is checked against the legacy wire profile of its API version and surface, learned
from the pinned legacy recordings, and against the consumer reads declared in
server2/config/contracts/kma-client-wire.v1.json. Observed-history rules are violations only
with --observed-history. No network, provider, S3 or credential access is performed.
"""
import argparse
import base64
import gzip
import json
import re
import sys
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = REPOSITORY_ROOT / 'server2' / 'config' / 'contracts' / 'kma-client-wire.v1.json'
MAX_INPUT = 32 * 1024 * 1024
ROUTE = re.compile(r'^/(?:weather/)?(v\d{6})/(kma/addr|town|coord)(?:/|$)')
WET_ICON = re.compile(r'rain|snow', re.IGNORECASE)


def read_bytes(path):
    path = Path(path)
    data = gzip.open(path, 'rb').read(MAX_INPUT + 1) if path.suffix == '.gz' else path.read_bytes()
    if len(data) > MAX_INPUT:
        raise ValueError(f'{path} exceeds 32 MiB')
    return data


def load_json(data):
    def reject(value):
        raise ValueError(f'non-JSON number {value}')
    return json.loads(data, parse_constant=reject)


def load_contract(path=CONTRACT_PATH):
    return load_json(read_bytes(path))


def classify(path):
    """(version, surface) of a request path; the unversioned gateway path is the v000901 default."""
    if path.startswith('/weather/coord/'):
        return 'v000901', 'gateway'
    match = ROUTE.match(path)
    if not match:
        return None
    version, kind = match.groups()
    surface = {'kma/addr': 'addr', 'town': 'town', 'coord': 'gateway'}[kind]
    if surface == 'gateway' and not path.startswith('/weather/'):
        return None
    return version, surface


def kma_text(text):
    """A KMA weather body: empty (legacy v000705 town), usage text, or an object with short/midData."""
    stripped = text.strip()
    if not stripped:
        return True
    if not stripped.startswith('{'):
        return False
    body = load_json(stripped)
    return 'short' in body or 'midData' in body or set(body) == {'usage'}


def legacy_bodies(contract, root=REPOSITORY_ROOT):
    """HTTP 200 KMA weather bodies recorded from legacy, with their version and surface."""
    bodies = []
    for corpus in contract['legacy_corpora']:
        data = load_json(read_bytes(Path(root) / corpus['path']))
        if corpus['kind'] == 'golden':
            for case in data['cases']:
                where = classify(case['request']['path'])
                if case.get('status') != 200 or not where or 'world' in case['id']:
                    continue
                text = base64.b64decode(case.get('body_base64') or '').decode('utf-8')
                if kma_text(text):
                    bodies.append(dict(id='golden:' + case['id'], version=where[0], surface=where[1], text=text))
            continue
        for scenario in data['scenarios']:
            # HEAD answers carry no body by HTTP semantics.
            if scenario.get('status') != 200 or scenario.get('method') == 'HEAD':
                continue
            version = scenario.get('version') or corpus.get('version')
            bodies.append(dict(id=f"{Path(corpus['path']).name}:{scenario['id']}", version=version,
                               surface=corpus['surface'], text=scenario.get('body') or ''))
    return [b for b in bodies if b['version'] in contract['versions']]


def json_type(value):
    if value is None:
        return 'null'
    if isinstance(value, bool):
        return 'boolean'
    if isinstance(value, (int, float)):
        return 'number'
    if isinstance(value, str):
        return 'string'
    return 'array' if isinstance(value, list) else 'object'


def walk(value, path='$'):
    yield path, value
    if isinstance(value, dict):
        for key, child in value.items():
            yield from walk(child, f'{path}.{key}')
    elif isinstance(value, list):
        for child in value:
            yield from walk(child, f'{path}[]')


def build_profile(bodies):
    """{(version, surface): {path: set of JSON types}} from the legacy JSON object bodies."""
    profile = {}
    for item in bodies:
        if not item['text'].lstrip().startswith('{'):
            continue
        body = load_json(item['text'])
        if set(body) == {'usage'}:
            continue
        paths = profile.setdefault((item['version'], item['surface']), {})
        for path, value in walk(body):
            paths.setdefault(path, set()).add(json_type(value))
    return profile


def finding(rule, severity, path, detail):
    return dict(rule=rule, severity=severity, path=path, detail=detail)


def number(value):
    return value if json_type(value) == 'number' else None


def select(body, path):
    """Values at a declared path; `[]` expands an array. Returns (parent, key) pairs."""
    parts = path[2:].split('.') if path.startswith('$.') else []
    nodes = [body]
    for i, part in enumerate(parts):
        many = part.endswith('[]')
        key = part[:-2] if many else part
        nxt = []
        for node in nodes:
            if not isinstance(node, dict) or key not in node:
                continue
            value = node[key]
            if i == len(parts) - 1 and not many:
                nxt.append((node, key))
            elif many and isinstance(value, list):
                nxt.extend(value)
            else:
                nxt.append(value)
        nodes = nxt
    return nodes


def wire_rules(body, known):
    found = []
    skip = []
    for path, value in walk(body):
        if any(path == s or path.startswith(s + '.') or path.startswith(s + '[') for s in skip):
            continue
        types = known.get(path)
        kind = json_type(value)
        if types is None:
            found.append(finding('W4', 'info', path, 'not in the legacy corpus of this version and surface'))
            skip.append(path)
        elif kind == 'null' and 'null' not in types:
            found.append(finding('W1', 'violation', path, 'legacy never sends null here'))
        elif kind != 'null' and kind not in types:
            found.append(finding('W2', 'violation', path, f'{kind}; legacy uses {"/".join(sorted(types))}'))
    return found


def required_rules(body, contract):
    found = []
    for path, keys in contract['required'].items():
        if path == '$':
            rows = [body]
        else:
            rows = [row for row in select(body, path) if isinstance(row, dict)]
        for i, row in enumerate(rows):
            for key in keys:
                if key not in row:
                    found.append(finding('W3', 'violation', f'{path}.{key}', f'missing in row {i}'))
    return found


def axis_rules(body, contract):
    found = []
    allowed = set(contract['slot_times']['number']) | set(contract['slot_times']['string'])
    slots = body.get('short') if isinstance(body.get('short'), list) else []
    order = []
    for i, slot in enumerate(slots):
        time = slot.get('time') if isinstance(slot, dict) else None
        if time not in allowed or isinstance(time, bool):
            found.append(finding('A1', 'violation', '$.short[].time', f'row {i} has {time!r}'))
            continue
        order.append((str(slot.get('date')), int(time)))
    if any(a >= b for a, b in zip(order, order[1:])):
        found.append(finding('A1', 'violation', '$.short[]', 'slots are not strictly ordered by date and time'))
    daily = (body.get('midData') or {}).get('dailyData') if isinstance(body.get('midData'), dict) else None
    dates = [str(row.get('date')) for row in daily or [] if isinstance(row, dict)]
    if any(a >= b for a, b in zip(dates, dates[1:])):
        found.append(finding('A2', 'violation', '$.midData.dailyData[].date', 'dates are not unique and ascending'))
    return found


def consumer_rules(body, version, contract, known=None):
    """A type the legacy corpus also sends at that path is information: server2 is no worse."""
    known = known or {}
    found = []
    for name, consumer in contract['consumers'].items():
        if version not in consumer['versions']:
            continue
        for read in consumer['reads']:
            expected = set(read['type'].split('|'))
            pairs = select(body, read['path'])
            parent_path = read['path'].rsplit('.', 1)[0]
            parents = [body] if parent_path == '$' else [p for p in select(body, parent_path) if isinstance(p, dict)]
            if not read.get('optional') and len(pairs) < len(parents):
                found.append(finding('C1', 'violation', read['path'], f'{name} reads it ({consumer["evidence"]}); missing'))
            for parent, key in pairs:
                kind = json_type(parent[key])
                if kind == 'null' and consumer.get('null_sensitive'):
                    found.append(finding('C1', 'violation', read['path'], f'{name} receives null ({consumer["evidence"]})'))
                elif kind != 'null' and kind not in expected:
                    severity = 'info' if kind in known.get(read['path'], ()) else 'violation'
                    found.append(finding('C1', severity, read['path'], f'{name} expects {read["type"]}, got {kind}'))
    return found


def half_view(row, half):
    present = any(k in row for k in (f'sky{half}', f'sky{half}Icon', f'wf{half}'))
    icon = row.get(f'sky{half}Icon') if isinstance(row.get(f'sky{half}Icon'), str) else row.get(f'sky{half}')
    pty = number(row.get(f'pty{half}'))
    wet = (pty is not None and 1 <= pty <= 7) or (isinstance(icon, str) and bool(WET_ICON.search(icon)))
    return present, wet


def history_rules(body, observed):
    found = []
    severity = 'violation' if observed else 'info'
    today = str((body.get('current') or {}).get('date') or '')
    if not re.fullmatch(r'\d{8}', today):
        return found
    def rain(row):
        return any((number(row.get(k)) or 0) > 0 for k in ('rn1', 'r06', 's06'))
    status = body.get('historyStatus') if isinstance(body.get('historyStatus'), dict) else None
    missing = set(map(str, (status or {}).get('missingDailyDates') or []))
    for row in (body.get('midData') or {}).get('dailyData') or []:
        if not isinstance(row, dict) or str(row.get('date')) >= today:
            continue
        halves = [half_view(row, h) for h in ('Am', 'Pm')]
        if rain(row) and all(present and not wet for present, wet in halves):
            found.append(finding('H1', severity, '$.midData.dailyData[]', f'{row.get("date")} has measured rain but two dry halves'))
        if status is not None and not all(present for present, _ in halves) and str(row.get('date')) not in missing:
            found.append(finding('H2', severity, '$.historyStatus.missingDailyDates', f'{row.get("date")} omits a half but is not listed'))
    for row in body.get('short') or []:
        if isinstance(row, dict) and str(row.get('date')) < today and rain(row) and number(row.get('pty')) == 0:
            found.append(finding('H1', severity, '$.short[].pty', f'{row.get("date")} {row.get("time")} has measured rain and PTY 0'))
    return found


def evaluate(text, version, surface, contract, profile, observed_history=False):
    """Findings for one response body text."""
    if version not in contract['versions']:
        return [finding('E1', 'violation', '$', f'unknown version {version}')]
    if contract['versions'][version]['body'] == 'empty' and surface == 'town':
        stripped = text.strip()
        usage = stripped.startswith('{') and set(load_json(stripped)) == {'usage'}
        return [] if stripped == '' or usage else [finding('E1', 'violation', '$', 'legacy town weather body is empty')]
    try:
        body = load_json(text)
    except ValueError as error:
        return [finding('W2', 'violation', '$', f'not JSON: {error}')]
    if not isinstance(body, dict):
        return [finding('W2', 'violation', '$', f'{json_type(body)}; legacy uses object')]
    if set(body) == {'usage'}:
        return []
    known = dict(profile.get((version, surface)) or profile.get((version, 'addr')) or {})
    for path, addition in contract['wire_additions'].items():
        if path in known:
            known[path] = set(known[path]) | set(addition['types'])
    return (wire_rules(body, known) + required_rules(body, contract) + axis_rules(body, contract)
            + consumer_rules(body, version, contract, known) + history_rules(body, observed_history))


def summarize(entries):
    results = []
    for name, version, surface, findings in entries:
        results.append(dict(body=name, version=version, surface=surface,
                            violations=sum(f['severity'] == 'violation' for f in findings),
                            info=sum(f['severity'] == 'info' for f in findings), findings=findings))
    return dict(schema=1, contract=CONTRACT_PATH.relative_to(REPOSITORY_ROOT).as_posix(), checked=len(results),
                violations=sum(r['violations'] for r in results), results=results)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--body', help='one response body file')
    parser.add_argument('--version')
    parser.add_argument('--surface', default='addr', choices=('addr', 'town', 'gateway'))
    parser.add_argument('--observed-history', action='store_true',
                        help='treat H rules as violations: the server answered with ASOS-primary history')
    parser.add_argument('--manifest', help='JSON list of {body, version, surface, observed_history}')
    parser.add_argument('--self-check', action='store_true', help='evaluate every legacy recording')
    parser.add_argument('--report')
    args = parser.parse_args(argv)
    contract = load_contract()
    bodies = legacy_bodies(contract)
    profile = build_profile(bodies)
    entries = []
    if args.self_check:
        for item in bodies:
            entries.append((item['id'], item['version'], item['surface'],
                            evaluate(item['text'], item['version'], item['surface'], contract, profile)))
    elif args.manifest:
        manifest = Path(args.manifest)
        for item in load_json(read_bytes(manifest)):
            text = read_bytes(manifest.parent / item['body']).decode('utf-8')
            entries.append((item['body'], item['version'], item.get('surface', 'addr'),
                            evaluate(text, item['version'], item.get('surface', 'addr'), contract, profile,
                                     observed_history=bool(item.get('observed_history')))))
    elif args.body and args.version:
        text = read_bytes(args.body).decode('utf-8')
        entries.append((args.body, args.version, args.surface,
                        evaluate(text, args.version, args.surface, contract, profile, args.observed_history)))
    else:
        parser.error('use --self-check, --manifest, or --body with --version')
    report = summarize(entries)
    if args.report:
        Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(dict(checked=report['checked'], violations=report['violations'])))
    return 2 if report['violations'] else 0


if __name__ == '__main__':
    sys.exit(main())
