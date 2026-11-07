#!/usr/bin/env python3
"""Client validation for KMA weather bodies (AK, 2026-11-07).

A server2 body must give the client all the data the client receives today, except the parts
left out on purpose because their provider is slow. The reference is the production answer for
the same path at the same publications.

capture  One GET of base+path with Accept-Language ko-KR (20 s timeout, no retry, no redirect).
         Writes <label>.json (the body as received) and <label>.meta.json (URL, UTC send time,
         status, duration, size and the date/age/x-cache/cache-control/x-amz-cf-pop headers).
         Exit 0 only for HTTP 200 with a JSON object body, otherwise 1; both files are written.

compare  Judges --candidate against --reference. Rows of short and shortest match by date and
         time, midData.dailyData rows by date, other object arrays by index. Every reference row
         and key must be in the candidate, with a valid value wherever the reference value is
         valid. Invalid: absent, null, an empty or blank string where the reference has a value,
         an empty list where the reference list is not, another kind (object or array against a
         scalar or the reverse, a boolean against a number or string or the reverse, a number
         against text), a non-numeric string where the reference is a number, a
         temperature (heatIndex and sensorytem included) at or below -50, a wind component (uuu,
         vvv) at or below -100, or a negative number in a field that is never negative.
         Numeric strings, which legacy also sends, are read as JavaScript's Number() reads a
         decimal string, and the same rules apply to them. A number that reads as infinite (the
         string "1e309", or the JSON number 1e309) is invalid; "NaN" is not a number.
         Not judged: historyObservation and fieldObservations, the contents of the gap lists in
         historyStatus and midData.dailyStatus (which must stay arrays), forecastNarrative. A *Str/*Grade/*Approx/*Hours/*Icon label whose value field
         differs or is absent is value-dependent, not missing (a number and a numeric string of
         equal value are the same value here and in the value differences). Excluded (never missing; listed
         apart when the candidate lacks one, leaves it invalid or keeps it empty): air quality,
         UV, pollen, food poisoning and the KASI extras other than sunrise and sunset. Valid
         values that differ are information only.
         Exit 0 pass, 1 missing data, 2 not comparable (another or unknown place: regionName,
         cityName or townName differs, or is absent, null or blank in either body; a publication,
         currentPubDate, shortestPubDate, shortPubDate, midData.landPubDate or tempPubDate, that
         both bodies carry with different values; or not a KMA body) or unreadable input; the
         report lists are computed in every case. A publication the reference lacks (absent,
         null or blank) is listed as information (reference_lacks_publication), the bodies are
         compared and the candidate need not carry it; one only the candidate lacks is missing data.

Standard library only. Only capture opens a connection.
"""
import argparse
import http.client
import json
import math
import re
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_BASE = 'https://todayweather.wizardfactory.net'
ACCEPT_LANGUAGE = 'ko-KR,ko;q=0.9'
USER_AGENT = 'TodayWeather-kma-client-validation/1'
TIMEOUT = 20
MAX_INPUT = 32 * 1024 * 1024
EDGE_HEADERS = ('date', 'age', 'x-cache', 'cache-control', 'x-amz-cf-pop')
EXIT = {'pass': 0, 'missing': 1, 'not-comparable': 2}
ABSENT = '<absent>'

PLACE = ('regionName', 'cityName', 'townName')
PUBLICATIONS = ('currentPubDate', 'shortestPubDate', 'shortPubDate', 'midData.landPubDate', 'midData.tempPubDate')
ROW_KEYS = {'short': ('date', 'time'), 'shortest': ('date', 'time'), 'midData.dailyData': ('date',)}
# Legacy missing values: -50 for temperatures, -100 for the wind components and -1 for the rest
# (legacy controllerTown.js invalid-value table and empty time table). heatIndex is the temperature
# itself below 80 F and sensorytem a wind chill or the temperature, so both are temperatures.
TEMPERATURES = frozenset(('t1h', 't3h', 'tmx', 'tmn', 't1d', 'taMin', 'taMax', 'sensorytem', 'sensoryTem', 'dpt',
                          'heatIndex'))
WIND_COMPONENTS = frozenset(('uuu', 'vvv'))
SIGNED = TEMPERATURES | WIND_COMPONENTS | {'fromToday'}
LABEL_SUFFIXES = ('Str', 'Grade', 'Approx', 'Hours', 'Icon')
ATTRIBUTION = frozenset(('historyObservation', 'fieldObservations'))
NOT_JUDGED = {'': frozenset(('forecastNarrative',))}
# Objects whose lists are gap diagnostics (missing hours and days, unavailable mid dates and reasons).
GAP_LISTS_IN = frozenset(('historyStatus', 'midData.dailyStatus'))
# Slow-provider parts, by the normalized path of the object that holds them.
EXCLUDED = {
    '': frozenset(('airInfoList', 'airInfo')),
    'current': frozenset(('arpltn', 'summaryAir')),
    'midData.dailyData[]': frozenset(('dustForecast', 'moonrise', 'moonset', 'moontransit', 'suntransit', 'civilm',
                                      'civile', 'nautm', 'naute', 'astm', 'aste', 'locationName', 'locationGeo')),
}
EXCLUDED_PREFIXES = ('ultrv', 'flower', 'pollen', 'fsn')
PREFIXES_IN = frozenset(('current', 'midData.dailyData[]'))
# JavaScript white space and line terminators, which Number() strips from a string.
JS_SPACE = '\t\n\x0b\x0c\r \xa0\u1680' + ''.join(map(chr, range(0x2000, 0x200b))) + '\u2028\u2029\u202f\u205f\u3000\ufeff'
DECIMAL = re.compile(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?')
NO_REFERENCE = object()


def load_json(data):
    def reject(value):
        raise ValueError(f'non-JSON number {value}')
    return json.loads(data.decode('utf-8'), parse_constant=reject)


def read_json(path):
    data = Path(path).read_bytes()
    if len(data) > MAX_INPUT:
        raise ValueError(f'{path} exceeds 32 MiB')
    return load_json(data)


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def scalar_list(value):
    return isinstance(value, list) and not any(isinstance(item, dict) for item in value)


def js_number(value):
    """A number, or a decimal numeric string read as JavaScript's Number() reads it; else None."""
    if number(value):
        return value
    if isinstance(value, str) and DECIMAL.fullmatch(value.strip(JS_SPACE)):
        return float(value.strip(JS_SPACE))
    return None


def blank(value):
    return isinstance(value, str) and not value.strip(JS_SPACE)


def emptied(reference, value):
    """An object or array the candidate keeps empty where the reference one holds data."""
    return isinstance(value, (dict, list)) and not value and isinstance(reference, (dict, list)) and bool(reference)


def kind(value):
    if isinstance(value, bool):
        return 'boolean'
    if number(value):
        return 'number'
    if isinstance(value, str):
        return 'string'
    return 'array' if isinstance(value, list) else 'object'


def same(a, b):
    """JSON equality: 1 equals 1.0, true never equals 1."""
    if number(a) and number(b):
        return a == b
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    return type(a) is type(b) and a == b


def same_data(a, b):
    """Like same(), except that a finite number and a numeric string of equal value are the same data."""
    if isinstance(a, str) != isinstance(b, str):
        x, y = js_number(a), js_number(b)
        if x is not None and y is not None and math.isfinite(x) and math.isfinite(y):
            return x == y
    return same(a, b)


def invalid(key, value, reference=NO_REFERENCE):
    """Why `value` carries no data, or None. A candidate value is judged against the valid reference value."""
    if value is None:
        return 'null'
    if reference is not NO_REFERENCE:
        mine, theirs = kind(value), kind(reference)
        other_kind = f"{mine} where the reference has {'an' if theirs in ('object', 'array') else 'a'} {theirs}"
        if mine != theirs and {'object', 'array'} & {mine, theirs}:
            return other_kind
        if blank(value) and not blank(reference):
            return 'empty string'
        if mine != theirs and 'boolean' in (mine, theirs):
            return other_kind
        if mine == 'string' and js_number(value) is None and js_number(reference) is not None:
            return 'not a number'
        if mine == 'number' and theirs == 'string' and js_number(reference) is None:
            return other_kind
        if mine == 'array' and not value and scalar_list(reference) and reference:
            return 'empty list'
    amount = js_number(value)
    if amount is not None:
        if not math.isfinite(amount):
            return 'not finite'
        if key in TEMPERATURES and amount <= -50:
            return 'temperature at or below -50'
        if key in WIND_COMPONENTS and amount <= -100:
            return 'wind component at or below -100'
        if key not in SIGNED and amount < 0:
            return 'negative'
    return None


def brief(value):
    if isinstance(value, dict):
        return f'<object of {len(value)} keys>'
    if isinstance(value, list) and not scalar_list(value):
        return f'<array of {len(value)}>'
    return value


def join(path, key):
    return f'{path}.{key}' if path else key


def normalize(path):
    return re.sub(r'\[[^\]]*\]', '[]', path)


def key_part(value):
    return str(int(value)) if number(value) and float(value).is_integer() else str(value)


def label_stem(key, ref, cand):
    for suffix in LABEL_SUFFIXES:
        stem = key[:-len(suffix)]
        if key.endswith(suffix) and stem and (stem in ref or stem in cand):
            return stem
    return None


def excluded(norm, key):
    return key in EXCLUDED.get(norm, ()) or (norm in PREFIXES_IN and key.startswith(EXCLUDED_PREFIXES))


class Comparison:
    def __init__(self):
        self.missing_rows, self.missing_fields, self.invalid_values = [], [], []
        self.excluded_missing, self.value_dependent, self.differences = [], [], {}

    def objects(self, ref, cand, path, norm):
        for key, rv in ref.items():
            if key in ATTRIBUTION or key in NOT_JUDGED.get(norm, ()):
                continue
            p, n = join(path, key), join(norm, key)
            if p in PUBLICATIONS and unknown(rv):
                continue  # a reference publication without a value demands nothing, as in comparability
            present, cv = key in cand, cand.get(key)
            valid = invalid(key, rv) is None
            lost = valid and (not present or invalid(key, cv, rv) is not None)
            if excluded(norm, key):
                if lost or (valid and present and emptied(rv, cv)):
                    self.excluded_missing.append(p)
                continue
            stem = label_stem(key, ref, cand)
            if stem and not (stem in ref and stem in cand and same_data(ref[stem], cand[stem])):
                if lost:
                    self.value_dependent.append(dict(path=p, stem=stem, reference=brief(ref.get(stem, ABSENT)),
                                                     candidate=brief(cand.get(stem, ABSENT))))
                continue
            if not valid:
                continue
            if not present:
                self.missing_fields.append(p)
            elif norm in GAP_LISTS_IN and isinstance(rv, list):
                # Gap diagnostics: presence and the array kind are judged, contents and emptiness are not.
                reason = 'null' if cv is None else None if isinstance(cv, list) else invalid(key, cv, rv)
                if reason:
                    self.invalid_values.append(dict(path=p, reference=brief(rv), candidate=brief(cv), reason=reason))
            else:
                self.value(key, rv, cv, p, n)

    def value(self, key, rv, cv, path, norm):
        reason = invalid(key, cv, rv)
        if reason:
            self.invalid_values.append(dict(path=path, reference=brief(rv), candidate=brief(cv), reason=reason))
        elif isinstance(rv, dict):
            self.objects(rv, cv, path, norm)
        elif isinstance(rv, list) and not scalar_list(rv):
            self.rows(key, rv, cv, path, norm)
        elif not same_data(rv, cv):
            group = self.differences.setdefault(norm, dict(count=0, examples=[]))
            group['count'] += 1
            if len(group['examples']) < 3:
                group['examples'].append(dict(path=path, reference=brief(rv), candidate=brief(cv)))

    def rows(self, key, rv, cv, path, norm):
        keys = ROW_KEYS.get(norm)
        if keys:
            index = {}
            for row in cv:
                if isinstance(row, dict):
                    index.setdefault(' '.join(key_part(row.get(k)) for k in keys), row)
            for row in rv:
                if not isinstance(row, dict):
                    continue
                name = ' '.join(key_part(row.get(k)) for k in keys)
                if name in index:
                    self.objects(row, index[name], f'{path}[{name}]', norm + '[]')
                else:
                    self.missing_rows.append(f'{path}[{name}]')
            return
        for i, item in enumerate(rv):
            if invalid(key, item) is not None:
                continue
            if i < len(cv):
                self.value(key, item, cv[i], f'{path}[{i}]', norm + '[]')
            else:
                self.missing_rows.append(f'{path}[{i}]')


def kma_body(body):
    return (isinstance(body, dict) and isinstance(body.get('short'), list)
            and isinstance(body.get('current'), dict) and isinstance(body.get('midData'), dict))


def unknown(value):
    return value is None or value == ABSENT or blank(value)


def shown(value):
    return 'null' if value is None else value


def publication(body, name):
    node = body
    for part in name.split('.'):
        node = node.get(part, ABSENT) if isinstance(node, dict) else ABSENT
    return node


def comparability(reference, candidate, unreadable):
    reasons = []
    for name, body in (('reference', reference), ('candidate', candidate)):
        if name in unreadable:
            reasons.append(f'{name} unreadable: {unreadable[name]}')
        elif not kma_body(body):
            reasons.append(f'{name} is not a KMA body (an object with short, current and midData)')
    place, differing, lacking = {}, {}, []
    if isinstance(reference, dict) and isinstance(candidate, dict):
        for name in PLACE:
            r, c = publication(reference, name), publication(candidate, name)
            if unknown(r) or unknown(c) or not same(r, c):
                place[name] = dict(reference=r, candidate=c)
                state = 'unknown' if unknown(r) and unknown(c) else 'differs'
                reasons.append(f'place {state}: {name} {shown(r)} vs {shown(c)}')
        # Only a publication both bodies carry can make them not comparable. One the reference lacks is
        # information; one only the candidate lacks is missing data that the field comparison reports.
        for name in PUBLICATIONS:
            r, c = publication(reference, name), publication(candidate, name)
            if unknown(r):
                lacking.append(name)
            elif not unknown(c) and not same(r, c):
                differing[name] = dict(reference=r, candidate=c)
    if differing:
        reasons.append('publications differ: ' + ', '.join(differing))
    return dict(ok=not reasons, reasons=reasons, differing_place=place, differing_publications=differing,
                reference_lacks_publication=lacking)


def judge(reference, candidate, unreadable=None):
    """The client validation report of `candidate` against `reference`."""
    comparable = comparability(reference, candidate, unreadable or {})
    c = Comparison()
    if isinstance(reference, dict) and isinstance(candidate, dict):
        c.objects(reference, candidate, '', '')
    lists = dict(missing_rows=c.missing_rows, missing_fields=c.missing_fields, invalid_values=c.invalid_values,
                 excluded_missing=c.excluded_missing, value_dependent=c.value_dependent)
    missing = c.missing_rows or c.missing_fields or c.invalid_values
    verdict = 'not-comparable' if not comparable['ok'] else 'missing' if missing else 'pass'
    counts = {name: len(items) for name, items in lists.items()}
    counts.update(value_differences=sum(g['count'] for g in c.differences.values()),
                  value_difference_paths=len(c.differences))
    return dict(schema=1, verdict=verdict, comparable=comparable, counts=counts, **lists,
                value_differences=c.differences)


def compare_files(reference_path, candidate_path):
    bodies, unreadable = {}, {}
    for name, path in (('reference', reference_path), ('candidate', candidate_path)):
        try:
            bodies[name] = read_json(path)
        except (OSError, ValueError) as error:
            bodies[name], unreadable[name] = None, f'{type(error).__name__}: {error}'
    report = judge(bodies['reference'], bodies['candidate'], unreadable)
    return dict(reference=str(reference_path), candidate=str(candidate_path), **report)


def describe(item):
    if isinstance(item, str):
        return item
    show = lambda v: v if v == ABSENT else json.dumps(v, ensure_ascii=False)
    if 'stem' in item:
        return f"{item['path']} ({item['stem']} {show(item['reference'])} vs {show(item['candidate'])})"
    return f"{item['path']} {show(item['reference'])} -> {show(item['candidate'])}"


def summary(report, groups_shown=12):
    lines = [f"verdict: {report['verdict']} (exit {EXIT[report['verdict']]})"]
    lines += [f'not comparable: {reason}' for reason in report['comparable']['reasons']]
    for kind in ('differing_place', 'differing_publications'):
        for name, pair in report['comparable'][kind].items():
            lines.append(f"  {name}: reference {shown(pair['reference'])}, candidate {shown(pair['candidate'])}")
    if report['comparable']['reference_lacks_publication']:
        lines.append('reference lacks publication (information): '
                     + ', '.join(report['comparable']['reference_lacks_publication']))
    sections = (('missing_rows', 'missing rows'), ('missing_fields', 'missing fields'),
                ('invalid_values', 'invalid values'), ('excluded_missing', 'excluded parts missing (not counted)'),
                ('value_dependent', 'value-dependent labels (not counted)'))
    for key, title in sections:
        groups = {}
        for item in report[key]:
            groups.setdefault(normalize(item if isinstance(item, str) else item['path']), []).append(describe(item))
        lines.append(f'{title}: {len(report[key])}')
        for group, entries in list(groups.items())[:groups_shown]:
            more = f', ... {len(entries) - 3} more' if len(entries) > 3 else ''
            lines.append(f'  {group} ({len(entries)}): ' + ', '.join(entries[:3]) + more)
        if len(groups) > groups_shown:
            lines.append(f'  ... {len(groups) - groups_shown} more paths in the JSON report')
    counts = report['counts']
    lines.append(f"value differences (information): {counts['value_differences']} at "
                 f"{counts['value_difference_paths']} paths")
    ranked = sorted(report['value_differences'].items(), key=lambda item: -item[1]['count'])
    lines += [f"  {path} ({group['count']})" for path, group in ranked[:5]]
    return lines


def default_label(path, sent):
    stem = re.sub(r'[^A-Za-z0-9.]+', '-', path).strip('-.') or 'capture'
    return stem + '-' + sent.strftime('%Y%m%dT%H%M%SZ')


def capture(url, out, label, sent):
    """One GET of `url`; writes both files; 0 for HTTP 200 with a JSON object body, else 1."""
    parts = urllib.parse.urlsplit(url)
    kind = http.client.HTTPSConnection if parts.scheme == 'https' else http.client.HTTPConnection
    target = (parts.path or '/') + (f'?{parts.query}' if parts.query else '')
    status, body, error = None, b'', None
    headers = dict.fromkeys(EDGE_HEADERS)
    start = time.monotonic()
    connection = kind(parts.hostname, parts.port, timeout=TIMEOUT)
    try:
        connection.request('GET', target, headers={'Accept-Language': ACCEPT_LANGUAGE, 'User-Agent': USER_AGENT})
        response = connection.getresponse()
        status = response.status
        headers = {name: response.getheader(name) for name in EDGE_HEADERS}
        body = response.read()
    except (OSError, http.client.HTTPException) as failure:
        body = getattr(failure, 'partial', body) or b''
        error = f'{type(failure).__name__}: {failure}'
    finally:
        connection.close()
    duration = round((time.monotonic() - start) * 1000, 1)
    json_object = False
    if status == 200 and error is None:
        try:
            json_object = isinstance(load_json(body), dict)
        except ValueError:
            pass
    meta = dict(url=url, sent_at=sent.isoformat(timespec='milliseconds').replace('+00:00', 'Z'), status=status,
                duration_ms=duration, bytes=len(body), headers=headers, json_object=json_object, error=error,
                accept_language=ACCEPT_LANGUAGE)
    out.mkdir(parents=True, exist_ok=True)
    (out / f'{label}.json').write_bytes(body)
    (out / f'{label}.meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f"capture: HTTP {status if status is not None else '-'}, {len(body)} bytes, {duration} ms, "
          f"x-cache {headers['x-cache']}, age {headers['age']}, date {headers['date']}"
          + (f', error {error}' if error else '') + ('' if json_object else ', not a JSON object'))
    print(f'wrote {out / label}.json and {label}.meta.json')
    return 0 if json_object else 1


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    capture_args = commands.add_parser('capture', help='one GET of an API path')
    capture_args.add_argument('--path', required=True, help='for example /weather/v000903/coord/37.566,126.978')
    capture_args.add_argument('--out', required=True, help='directory for <label>.json and <label>.meta.json')
    capture_args.add_argument('--label', help='file name stem; default: the path and the UTC send time')
    capture_args.add_argument('--base', default=DEFAULT_BASE, help=f'default {DEFAULT_BASE}')
    compare_args = commands.add_parser('compare', help='judge a candidate body against a reference body')
    compare_args.add_argument('--reference', required=True, help='for example a production capture')
    compare_args.add_argument('--candidate', required=True, help='for example a server2 body')
    compare_args.add_argument('--json', help='write the full report to this file')
    args = parser.parse_args(argv)
    if args.command == 'capture':
        url = args.base.rstrip('/') + args.path
        parts = urllib.parse.urlsplit(url)
        try:
            usable = args.path.startswith('/') and parts.scheme in ('http', 'https') and parts.hostname
            usable = usable and (parts.port is None or parts.port > 0)
        except ValueError:
            usable = False
        if not usable:
            parser.error('--base must be an http(s) URL and --path must start with /')
        sent = datetime.now(timezone.utc)
        label = args.label or default_label(args.path, sent)
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', label):
            parser.error('--label must be a plain file name')
        out = Path(args.out)
        if (out / f'{label}.json').exists() or (out / f'{label}.meta.json').exists():
            parser.error(f'{out / label}.json or .meta.json exists; choose another --label')
        return capture(url, out, label, sent)
    report = compare_files(args.reference, args.candidate)
    if args.json:
        Path(args.json).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('\n'.join(summary(report)))
    return EXIT[report['verdict']]


if __name__ == '__main__':
    sys.exit(main())
