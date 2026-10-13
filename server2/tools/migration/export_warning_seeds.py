#!/usr/bin/env python3
"""Convert operator-provided legacy warning exports into one canonical S12 seed file.

Offline only: reads local `mongoexport` output files (JSON array or one document per
line, relaxed or canonical Extended JSON) and writes a local file. It opens no network
connection and no database. Producing the export from a production database is a
separately authorized operator action and is not performed by this tool.

Input collections (legacy models at ca8735cf):
  --special  KmaSpecialWeatherSituation documents (`server/models/modelKmaSpecialWeatherSituation.js`)
  --zones    KmaSpecialWeatherZone documents, including the `_sync` marker (optional)

Output: {"schema":1,"exportedAt":ISO,"special":[...],"zones":[...]} with document key
order preserved. `_id`/`__v` are removed as legacy reads project them away
(`{_id:0,__v:0}`; `getCurrent` also deletes situation/info `_id`).
"""
import argparse
import datetime
import json
import sys
from pathlib import Path

ISO_FORMAT = '%Y-%m-%dT%H:%M:%S'


def iso_from_ms(ms):
    instant = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc) + datetime.timedelta(milliseconds=ms)
    return instant.strftime(ISO_FORMAT) + '.%03dZ' % (ms % 1000)


def parse_iso(text):
    if not isinstance(text, str) or not text.endswith('Z'):
        raise ValueError('date must be an ISO UTC string')
    body = text[:-1]
    if '.' in body:
        body, fraction = body.split('.', 1)
        if not fraction.isdigit():
            raise ValueError('invalid date fraction')
        millis = int((fraction + '000')[:3])
    else:
        millis = 0
    instant = datetime.datetime.strptime(body, ISO_FORMAT).replace(tzinfo=datetime.timezone.utc)
    epoch = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)
    return int((instant - epoch).total_seconds()) * 1000 + millis


def scalar(value):
    """Extended JSON wrappers to plain JSON values."""
    if isinstance(value, dict) and len(value) == 1:
        (key, inner), = value.items()
        if key == '$date':
            if isinstance(inner, dict):
                inner = scalar(inner)
            if isinstance(inner, (int, float)) and not isinstance(inner, bool):
                return iso_from_ms(int(inner))
            return iso_from_ms(parse_iso(inner))
        if key in ('$numberInt', '$numberLong'):
            return int(inner)
        if key in ('$numberDouble', '$numberDecimal'):
            number = float(inner)
            return int(number) if number.is_integer() else number
        if key == '$oid':
            return inner
    return value


def convert(value, drop_ids):
    value = scalar(value)
    if isinstance(value, dict):
        return {k: convert(v, drop_ids) for k, v in value.items()
                if not (drop_ids and k in ('_id', '__v'))}
    if isinstance(value, list):
        return [convert(v, drop_ids) for v in value]
    return value


def read_documents(path):
    text = Path(path).read_text(encoding='utf-8').strip()
    if not text:
        return []
    if text.startswith('['):
        documents = json.loads(text)
    else:
        documents = [json.loads(line) for line in text.splitlines() if line.strip()]
    if not all(isinstance(d, dict) for d in documents):
        raise ValueError('every exported document must be an object')
    return documents


def special_documents(path):
    out = []
    for raw in read_documents(path):
        doc = convert(raw, True)
        if doc.get('type') not in (1, 2, 3, 4):
            raise ValueError('special document type must be 1..4')
        if not isinstance(doc.get('announcement'), str):
            raise ValueError('special document needs an announcement date')
        parse_iso(doc['announcement'])
        out.append(doc)
    return out


def zone_documents(path):
    return [convert(raw, True) for raw in read_documents(path)]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--special', required=True, help='mongoexport output of KmaSpecialWeatherSituation')
    parser.add_argument('--zones', help='mongoexport output of KmaSpecialWeatherZone')
    parser.add_argument('--exported-at', required=True, help='ISO UTC instant of the export snapshot')
    parser.add_argument('--output', required=True)
    args = parser.parse_args(argv)
    try:
        exported_at = iso_from_ms(parse_iso(args.exported_at))
        seed = {'schema': 1, 'exportedAt': exported_at, 'special': special_documents(args.special)}
        if args.zones:
            seed['zones'] = zone_documents(args.zones)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f'export_warning_seeds: {error}', file=sys.stderr)
        return 2
    Path(args.output).write_text(json.dumps(seed, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'seed documents special={len(seed["special"])} zones={len(seed.get("zones", []))}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
