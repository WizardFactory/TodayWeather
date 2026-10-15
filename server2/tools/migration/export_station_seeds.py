#!/usr/bin/env python3
"""Convert one operator-provided legacy `kmastninfos` `mongoexport` file into an S15b-2 station
registry seed file.

Offline only: reads a local file and writes a local file. It opens no network connection and no
database. Producing the export from a production database is a separately authorized operator
action and is not performed by this tool.

Input: `mongoexport` default output (one Extended JSON document per line, relaxed or canonical)
of the legacy `KmaStnInfo` model (`server/models/modelKmaStnInfo.js`, collection `kmastninfos`).
`--jsonArray` output is rejected. Every document must match the legacy schema: `_id`, `stnId`
(text, 1-8 digits), `stnName`, `addr` (text), `isCityWeather`, `isMountain` (boolean),
`altitude`, `rnsHit`, `rnsCount` (finite numbers), `geo` (`[longitude, latitude]` finite numbers
within the 2d index bounds) and `__v` (integer); any other field rejects the whole file, as does
a repeated `stnId`.

Output (JSON Lines, `\\n`): a manifest line
  {"schema":1,"tool":"export_station_seeds","collection":"kmastninfos",
   "exportedAt":ISO,"sourceSha256":H,"documents":N}
then the original export lines byte for byte, in file order.
"""
import argparse
import datetime
import hashlib
import json
import math
import os
import re
import sys
import tempfile
from pathlib import Path

FIELDS = {'_id', 'stnId', 'stnName', 'addr', 'isCityWeather', 'altitude', 'geo', 'rnsHit', 'rnsCount',
          'isMountain', '__v'}
SEED_BYTES = 8 * 1024 * 1024     # one S05 raw record
ISO = re.compile(r'([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,9}))?'
                 r'(Z|[+-][0-9]{2}:[0-9]{2})')
INT_TEXT = re.compile(r'[+-]?[0-9]+')
DECIMAL_TEXT = re.compile(r'[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?')
STATION = re.compile(r'[0-9]{1,8}')
OID = re.compile(r'[0-9a-f]{24}')


class Invalid(ValueError):
    pass


def number(value):
    """A finite Extended JSON number (relaxed or canonical)."""
    if isinstance(value, bool):
        raise Invalid('number expected')
    if isinstance(value, (int, float)):
        n = float(value)
    elif isinstance(value, dict) and len(value) == 1:
        (wrapper, text), = value.items()
        if not isinstance(text, str):
            raise Invalid('number wrapper')
        if wrapper in ('$numberInt', '$numberLong') and INT_TEXT.fullmatch(text):
            n = float(int(text))
        elif wrapper in ('$numberDouble', '$numberDecimal') and DECIMAL_TEXT.fullmatch(text):
            n = float(text)
        else:
            raise Invalid('number wrapper')
    else:
        raise Invalid('number expected')
    if not math.isfinite(n):
        raise Invalid('number not finite')
    return n


def validate(doc):
    if not isinstance(doc, dict):
        raise Invalid('document is not an object')
    unknown = set(doc) - FIELDS
    if unknown:
        raise Invalid('unknown field ' + sorted(unknown)[0])
    oid = doc.get('_id')
    if not (isinstance(oid, dict) and list(oid) == ['$oid'] and isinstance(oid['$oid'], str)
            and OID.fullmatch(oid['$oid'])):
        raise Invalid('_id')
    stn = doc.get('stnId')
    if not isinstance(stn, str) or not STATION.fullmatch(stn):
        raise Invalid('stnId')
    for field in ('stnName', 'addr'):
        if field in doc and not isinstance(doc[field], str):
            raise Invalid(field)
    for field in ('isCityWeather', 'isMountain'):
        if field in doc and not isinstance(doc[field], bool):
            raise Invalid(field)
    for field in ('altitude', 'rnsHit', 'rnsCount'):
        if field in doc:
            number(doc[field])
    if 'geo' in doc:
        geo = doc['geo']
        if not isinstance(geo, list) or len(geo) not in (0, 2):
            raise Invalid('geo')
        if geo:
            lon, lat = number(geo[0]), number(geo[1])
            if not (-180 <= lon < 180 and -180 <= lat < 180):
                raise Invalid('geo bounds')
    if '__v' in doc:
        v = number(doc['__v'])
        if v != int(v):
            raise Invalid('__v')
    return stn


def convert(exported, source):
    match = ISO.fullmatch(exported or '')
    if not match:
        raise Invalid('--exported-at must be an ISO instant')
    datetime.datetime.fromisoformat(exported.replace('Z', '+00:00'))
    if source.startswith(b'['):
        raise Invalid('--jsonArray output is not accepted')
    if b'\r' in source:
        raise Invalid('CR line endings')
    seen = set()
    documents = []
    for number_, line in enumerate(source.split(b'\n'), 1):
        if not line.strip():
            continue
        try:
            text = line.decode('utf-8')
            doc = json.loads(text, object_pairs_hook=_no_duplicates)
            stn = validate(doc)
        except (UnicodeDecodeError, json.JSONDecodeError, Invalid) as error:
            raise Invalid(f'line {number_}: {error}') from error
        if stn in seen:
            raise Invalid(f'line {number_}: repeated stnId {stn}')
        seen.add(stn)
        documents.append(text)
    if not documents:
        raise Invalid('input holds no documents')
    manifest = {'schema': 1, 'tool': 'export_station_seeds', 'collection': 'kmastninfos', 'exportedAt': exported,
                'sourceSha256': hashlib.sha256(source).hexdigest(), 'documents': len(documents)}
    output = ('\n'.join([json.dumps(manifest, separators=(',', ':'))] + documents) + '\n').encode('utf-8')
    if len(output) > SEED_BYTES:
        raise Invalid('seed exceeds the 8 MiB raw record limit')
    return output, len(documents)


def _no_duplicates(pairs):
    keys = [k for k, _ in pairs]
    if len(keys) != len(set(keys)):
        raise Invalid('duplicate key')
    return dict(pairs)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--exported-at', required=True, help='ISO instant of the export snapshot')
    parser.add_argument('--input', required=True, help='mongoexport output file (one document per line)')
    parser.add_argument('--output', required=True, help='seed file to write')
    args = parser.parse_args(argv)
    try:
        output, documents = convert(args.exported_at, Path(args.input).read_bytes())
    except (OSError, Invalid, ValueError, OverflowError, RecursionError) as error:
        print(f'export_station_seeds: {error}', file=sys.stderr)
        return 2
    target = Path(args.output)
    handle, temporary = tempfile.mkstemp(dir=target.parent, prefix='.seed-')
    try:
        with os.fdopen(handle, 'wb') as stream:
            stream.write(output)
        os.replace(temporary, target)
    except OSError as error:
        Path(temporary).unlink(missing_ok=True)
        print(f'export_station_seeds: {error}', file=sys.stderr)
        return 2
    print(f'seed documents={documents}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
