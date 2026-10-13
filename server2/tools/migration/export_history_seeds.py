#!/usr/bin/env python3
"""Convert one operator-provided legacy history `mongoexport` file into an S14 seed file.

Offline only: reads a local file and writes a local file. It opens no network connection and
no database. Producing the export from a production database is a separately authorized
operator action and is not performed by this tool.

Input: `mongoexport` default output (one Extended JSON document per line, relaxed or
canonical) of one legacy collection, named by its mongoose model at 47a96078:
  kma.town.current | kma.town.shortest | kma.town.short   (--db-version 2.0)
  current | shortest | short                              (--db-version 1.0)
  KmaStnHourly2 | KmaStnMinute2                           (either version)
`--jsonArray` output is rejected because the exact document bytes could not be kept.

Every document must match its legacy schema (allowlisted top-level and row fields plus
`_id`/`__v`); any other field, including coordinates or identifiers, rejects the whole file.

Output (JSON Lines, `\\n`): a manifest line
  {"schema":1,"tool":"export_history_seeds","collection":C,"dbVersion":V,
   "exportedAt":ISO,"sourceSha256":H,"documents":N,"groups":G}
then one line per grid or station in first-seen order
  {"key":{"type":"grid","nx":X,"ny":Y}|{"type":"station","id":S},"lines":[...],"documents":[...]}
whose documents are the original export lines byte for byte, in file order.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path

GRID_V2 = {'kma.town.current': 'currentData', 'kma.town.shortest': 'shortestData', 'kma.town.short': 'shortData'}
GRID_V1 = {'current': 'currentData', 'shortest': 'shortestData', 'short': 'shortData'}
STATION = {'KmaStnHourly2', 'KmaStnMinute2'}
CURRENT_ROW = ['date', 'time', 'mx', 'my', 't1h', 'rn1', 'sky', 'uuu', 'vvv', 'reh', 'pty', 'lgt', 'vec', 'wsd']
SHORTEST_ROW = ['date', 'time', 'mx', 'my', 'pty', 'rn1', 'rn1Text', 'sky', 'lgt', 'pop', 't1h', 'reh',
                'uuu', 'vvv', 'vec', 'wsd']
SHORT_ROW = ['date', 'time', 'mx', 'my', 'pop', 'pty', 'r06', 'r06Text', 'reh', 's06', 's06Text', 'sky',
             't3h', 'tmn', 'tmx', 'uuu', 'vvv', 'wav', 'vec', 'wsd']
DAILY_SOURCE_ROW = ['date', 'time', 't3h', 'tmn', 'tmx', 'sky', 'pty', 'reh', 'pop', 'wsd']
STATION_FIELDS = ['stnId', 'stnName', 'date', 'weather', 'visibility', 'cloud', 'heavyCloud', 't1h', 'dpt',
                  'sensoryTem', 'dspls', 'r1d', 's1d', 'reh', 'wdd', 'vec', 'wsd', 'hPa', 'rs1h', 'rs1d',
                  'rs15m', 'rns']
ROWS = {'currentData': CURRENT_ROW, 'shortestData': SHORTEST_ROW, 'shortData': SHORT_ROW}
# ASCII digits and whole-string matches only, as the Rust importer parses (`fullmatch`, no `\d`).
ISO = re.compile(r'([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,9}))?'
                 r'(Z|[+-][0-9]{2}:[0-9]{2})')
WRAPPERS = ('$numberInt', '$numberLong', '$numberDouble', '$numberDecimal', '$date')


class Invalid(ValueError):
    pass


GROUP_DOCUMENTS = 20000          # Rust importer bound per group
RECORD_BYTES = 8 * 1024 * 1024   # S05 raw record limit (manifest + group line)
SEED_BYTES = 64 * 1024 * 1024    # Rust importer seed bound


I64_MIN, I64_MAX = -(1 << 63), (1 << 63) - 1


# Extended JSON wrapper grammar shared with the Rust importer (legacy.rs `int_text`/`decimal_text`).
INT_TEXT = re.compile(r'[+-]?[0-9]+')
DECIMAL_TEXT = re.compile(r'[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?')
DOUBLE_SPECIALS = {'Infinity': float('inf'), '-Infinity': float('-inf'), 'NaN': float('nan')}


def wrapped_int(text):
    if not isinstance(text, str) or not INT_TEXT.fullmatch(text):
        return None
    parsed = int(text)
    return parsed if I64_MIN <= parsed <= I64_MAX else None


def bounded_int(text):
    """Plain JSON integers must stay within f64 range, as serde_json requires."""
    value = int(text)
    try:
        float(value)
    except OverflowError as error:
        raise Invalid(f'number out of range: {text[:20]}...') from error
    return value


def reject_constant(name):
    raise Invalid(f'non-JSON numeric constant {name}')


def finite_float(text):
    value = float(text)
    if value != value or value in (float('inf'), float('-inf')):
        raise Invalid(f'number out of range: {text}')
    return value


def unique_pairs(pairs):
    names = [name for name, _ in pairs]
    if len(names) != len(set(names)):
        duplicate = sorted({n for n in names if names.count(n) > 1})
        raise Invalid(f'duplicate member name {duplicate[0]!r}')
    return dict(pairs)


MAX_INSTANT_MS = 253402268399999  # 9999-12-31 23:59:59.999 KST, the last supported publication


def parse_iso(text):
    match = ISO.fullmatch(text) if isinstance(text, str) else None
    if not match:
        raise Invalid(f'invalid ISO instant: {text!r}')
    y, mo, d, h, mi, s, frac, zone = match.groups()
    try:
        instant = datetime.datetime(int(y), int(mo), int(d), int(h), int(mi), int(s), tzinfo=datetime.timezone.utc)
    except ValueError as error:
        raise Invalid(f'invalid ISO instant: {text!r}') from error
    millis = int((frac or '0').ljust(3, '0')[:3])
    offset = 0 if zone == 'Z' else (int(zone[1:3]) * 60 + int(zone[4:6])) * (1 if zone[0] == '+' else -1)
    epoch = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)
    ms = int((instant - epoch).total_seconds()) * 1000 + millis - offset * 60000
    if not 0 <= ms <= MAX_INSTANT_MS:
        raise Invalid(f'instant outside the supported range: {text!r}')
    return ms


def format_iso(ms):
    instant = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc) + datetime.timedelta(milliseconds=ms)
    return instant.strftime('%Y-%m-%dT%H:%M:%S') + '.%03dZ' % (ms % 1000)


def number(value):
    """Extended JSON number (relaxed or canonical) or None."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, dict) and len(value) == 1:
        (key, inner), = value.items()
        if not isinstance(inner, str):
            return None
        if key in ('$numberInt', '$numberLong'):
            parsed = wrapped_int(inner)
            return None if parsed is None else float(parsed)
        if key in ('$numberDouble', '$numberDecimal'):
            if inner in DOUBLE_SPECIALS:
                return DOUBLE_SPECIALS[inner]
            return float(inner) if DECIMAL_TEXT.fullmatch(inner) else None
    return None


def date_ms(value):
    if not isinstance(value, dict) or len(value) != 1 or '$date' not in value:
        return None
    inner = value['$date']
    try:
        if isinstance(inner, str):
            ms = parse_iso(inner)
        elif isinstance(inner, int) and not isinstance(inner, bool):
            ms = inner
        elif isinstance(inner, dict) and len(inner) == 1 and isinstance(inner.get('$numberLong'), str):
            ms = wrapped_int(inner['$numberLong'])
            if ms is None:
                return None
        else:
            return None
    except (Invalid, ValueError):
        return None
    return ms if 0 <= ms <= MAX_INSTANT_MS else None


def oid(value):
    return (isinstance(value, dict) and len(value) == 1 and isinstance(value.get('$oid'), str)
            and re.fullmatch(r'[0-9a-fA-F]{24}', value['$oid']) is not None)


def scalar(value):
    if isinstance(value, list):
        return False
    if isinstance(value, dict):
        return (len(value) == 1 and next(iter(value)) in WRAPPERS
                and (number(value) is not None or date_ms(value) is not None))
    return True


def only(obj, allowed, where):
    for key in obj:
        if key not in allowed and key not in ('_id', '__v'):
            raise Invalid(f'unknown field {key!r} in {where}')


def metadata(value, where):
    """`_id` must be an ObjectId and `__v` a number wherever they appear."""
    if '_id' in value and not oid(value['_id']):
        raise Invalid(f'invalid _id in {where}')
    if '__v' in value and number(value['__v']) is None:
        raise Invalid(f'invalid __v in {where}')


def row(value, allowed, where):
    if not isinstance(value, dict):
        raise Invalid(f'{where} must be an object')
    only(value, allowed, where)
    metadata(value, where)
    for key, item in value.items():
        if key not in ('_id', '__v') and not scalar(item):
            raise Invalid(f'non-scalar field {key!r} in {where}')


def validate(collection, doc):
    """Returns the group key ("grid", nx, ny) or ("station", id)."""
    if not isinstance(doc, dict):
        raise Invalid('every document must be an object')
    if '_id' in doc and not oid(doc['_id']):
        raise Invalid('invalid document _id')
    if '__v' in doc and number(doc['__v']) is None:
        raise Invalid('invalid document __v')
    if collection in STATION:
        row(doc, STATION_FIELDS, collection)
        station = number(doc.get('stnId'))
        if station is None or station != int(station) or not 1 <= station <= 4294967295:
            raise Invalid('station document needs a positive 32-bit integer stnId')
        if date_ms(doc.get('date')) is None:
            raise Invalid('station document needs an Extended JSON date')
        return ('station', int(station))
    data = GRID_V2.get(collection) or GRID_V1[collection]
    v1 = collection in GRID_V1
    top = ['mCoord', 'pubDate', data] + (['dailySource'] if collection == 'short' else []) + ([] if v1 else ['fcsDate'])
    only(doc, top, collection)
    coord = doc.get('mCoord')
    if not isinstance(coord, dict) or sorted(coord) != ['mx', 'my']:
        raise Invalid('document needs mCoord {mx,my}')
    nx, ny = number(coord['mx']), number(coord['my'])
    if nx is None or ny is None or nx != int(nx) or ny != int(ny) or not (1 <= nx <= 149 and 1 <= ny <= 253):
        raise Invalid('mCoord outside the KMA grid')
    if v1:
        rows = doc.get(data)
        if not isinstance(rows, list):
            raise Invalid(f'{data} must be an array in DB_DATA_VERSION 1.0')
        for item in rows:
            row(item, ROWS[data], data)
        if 'pubDate' in doc and not isinstance(doc['pubDate'], str):
            raise Invalid('v1 pubDate must be a string')
        if 'dailySource' in doc:
            daily = doc['dailySource']
            if not isinstance(daily, dict):
                raise Invalid('dailySource must be an object')
            only(daily, ['pubDate', 'rows'], 'dailySource')
            metadata(daily, 'dailySource')
            if 'pubDate' in daily and not isinstance(daily['pubDate'], str):
                raise Invalid('dailySource pubDate must be a string')
            if 'rows' in daily:
                if not isinstance(daily['rows'], list):
                    raise Invalid('dailySource rows must be an array')
                for item in daily['rows']:
                    row(item, DAILY_SOURCE_ROW, 'dailySource.rows')
    else:
        item = doc.get(data)
        if not isinstance(item, dict) or '_id' in item:
            raise Invalid(f'{data} must be a plain object in DB_DATA_VERSION 2.0')
        row(item, ROWS[data], data)
        if date_ms(doc.get('fcsDate')) is None or date_ms(doc.get('pubDate')) is None:
            raise Invalid('v2 document needs Extended JSON fcsDate and pubDate')
    return ('grid', int(nx), int(ny))


def convert(collection, version, exported_at, source):
    if collection not in GRID_V2 and collection not in GRID_V1 and collection not in STATION:
        raise Invalid(f'unsupported collection {collection!r}')
    expected = ('2.0',) if collection in GRID_V2 else ('1.0',) if collection in GRID_V1 else ('1.0', '2.0')
    if version not in expected:
        raise Invalid(f'db version {version} does not match collection {collection}')
    exported = format_iso(parse_iso(exported_at))
    if b'\r' in source:
        raise Invalid('input must use \\n line endings')
    groups = {}
    order = []
    count = 0
    for number_, raw in enumerate(source.split(b'\n'), start=1):
        if not raw:
            continue
        if raw.lstrip()[:1] == b'[':
            raise Invalid('input must be mongoexport output with one document per line (not --jsonArray)')
        if raw != raw.strip():
            raise Invalid(f'line {number_} has surrounding whitespace')
        try:
            text = raw.decode('utf-8')
            doc = json.loads(text, object_pairs_hook=unique_pairs, parse_constant=reject_constant,
                             parse_float=finite_float, parse_int=bounded_int)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise Invalid(f'line {number_} is not a JSON document') from error
        except Invalid as error:
            raise Invalid(f'line {number_}: {error}') from error
        try:
            key = validate(collection, doc)
        except Invalid as error:
            raise Invalid(f'line {number_}: {error}') from error
        if key not in groups:
            groups[key] = ([], [])
            order.append(key)
        groups[key][0].append(number_)
        groups[key][1].append(text)
        count += 1
    if not count:
        raise Invalid('input holds no documents')
    manifest = {'schema': 1, 'tool': 'export_history_seeds', 'collection': collection, 'dbVersion': version,
                'exportedAt': exported, 'sourceSha256': hashlib.sha256(source).hexdigest(),
                'documents': count, 'groups': len(order)}
    lines = [json.dumps(manifest, separators=(',', ':'))]
    for key in order:
        numbers, documents = groups[key]
        if key[0] == 'grid':
            key_text = '{"type":"grid","nx":%d,"ny":%d}' % (key[1], key[2])
        else:
            key_text = '{"type":"station","id":%d}' % key[1]
        if len(documents) > GROUP_DOCUMENTS:
            raise Invalid(f'more than {GROUP_DOCUMENTS} documents for one key')
        lines.append('{"key":' + key_text + ',"lines":' + json.dumps(numbers, separators=(',', ':'))
                     + ',"documents":[' + ','.join(documents) + ']}')
        if len(lines[0].encode()) + len(lines[-1].encode()) + 2 > RECORD_BYTES:
            raise Invalid('one key group exceeds the 8 MiB raw record limit')
    output = ('\n'.join(lines) + '\n').encode('utf-8')
    if len(output) > SEED_BYTES:
        raise Invalid('seed exceeds 64 MiB; split the export')
    return output, count, len(order)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--collection', required=True, help='legacy mongoose model name')
    parser.add_argument('--db-version', required=True, help='legacy DB_DATA_VERSION of the export (1.0 or 2.0)')
    parser.add_argument('--exported-at', required=True, help='ISO instant of the export snapshot')
    parser.add_argument('--input', required=True, help='mongoexport output file (one document per line)')
    parser.add_argument('--output', required=True, help='seed file to write')
    args = parser.parse_args(argv)
    try:
        output, documents, groups = convert(args.collection, args.db_version, args.exported_at,
                                            Path(args.input).read_bytes())
    except (OSError, Invalid) as error:
        print(f'export_history_seeds: {error}', file=sys.stderr)
        return 2
    target = Path(args.output)
    handle, temporary = tempfile.mkstemp(dir=target.parent, prefix='.seed-')
    try:
        with os.fdopen(handle, 'wb') as stream:
            stream.write(output)
        os.replace(temporary, target)
    except OSError as error:
        Path(temporary).unlink(missing_ok=True)
        print(f'export_history_seeds: {error}', file=sys.stderr)
        return 2
    print(f'seed documents={documents} groups={groups}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
