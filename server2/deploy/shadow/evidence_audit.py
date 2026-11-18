#!/usr/bin/env python3
"""Bucket-only audit and assembly of paired evidence (SR-5a, #3003).

A pure function over objects already downloaded from the run's state bucket (every
version of every key, as the source export retains them): no SSH, host or AWS access.

Rules (design-round2/3 of SR-5):
- `evidence/<run>/contract.json` is required. Its launch.json SHA-256 must equal the
  journal's launch hash and its reader.json SHA-256 the launch's pinned reader artifact;
  missing: `contract_missing`, different: `contract_mismatch`. Never complete without it.
- A generation g is valid only when `index-<g>.json` exists and its ledger and batch
  objects match the index's sizes and hashes, and the batch holds exactly the listed files.
  Objects of a generation without an index are ignored (`incomplete`).
- The newest valid `final` generation (a snapshot taken after the reader stopped) is
  audited against the files of all valid generations. The same attempt with the same
  bytes in two generations is one shipment; different bytes are a conflict.
- Per attempt of that ledger, in order: result NULL is pending; a result with
  `"captured": false` and no body fields is a capture failure (no files); otherwise both
  files are required and must match the result (partial or different: mismatched).
- Only ordinary generations: `tail_unverified` with the newest snapshot time.
No weather or product parity is judged here (`qualification: not_assessed`).
"""
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import tarfile

from evidence_copy import MAX_BODY, MAX_METADATA
from remote import attempt_matches, ledger_identity

MAX_INDEX = 16 * 1024 ** 2


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def file_sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        while block := stream.read(1024 ** 2):
            h.update(block)
    return h.hexdigest()


def report(status, **fields):
    base = dict(complete=status == 'complete', status=status, qualification='not_assessed')
    base.update(fields)
    return base


def valid_index(value, prefix, generation):
    def digest(value):
        return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) is not None

    entry = lambda v: (type(v) is dict and set(v) == {'key', 'sha256', 'size'} and isinstance(v['key'], str)
                       and digest(v['sha256']) and type(v['size']) is int and v['size'] >= 0)
    if not (type(value) is dict and type(value.get('generation')) is int and value['generation'] == generation
            and value.get('kind') in ('ordinary', 'final')
            and type(value.get('at')) is int and entry(value.get('ledger'))
            and value['ledger']['key'] == f'{prefix}ledger-{generation}.sqlite3'
            and 'batch' in value and (value['batch'] is None or (entry(value['batch'])
                                                 and value['batch']['key'] == f'{prefix}batch-{generation}.tar'))
            and type(value.get('reader')) is dict and type(value['reader'].get('stopped')) is bool
            and type(value.get('files')) is list):
        return False
    if value['kind'] == 'final' and not value['reader']['stopped']:
        return False
    fields = {'id', 'json_size', 'json_sha256', 'body_size', 'body_sha256'}
    files = value['files']
    return (all(type(f) is dict and set(f) == fields and type(f['id']) is int and f['id'] > 0
                and type(f['json_size']) is int and 0 <= f['json_size'] <= MAX_METADATA
                and type(f['body_size']) is int and 0 <= f['body_size'] <= MAX_BODY
                and digest(f['json_sha256']) and digest(f['body_sha256']) for f in files)
            and len({f['id'] for f in files}) == len(files))


def batch_files(path, index):
    """The listed files of a batch, verified member by member; None if anything differs."""
    listed = {}
    for f in index['files']:
        listed[f'{f["id"]}.json'] = (f['json_size'], f['json_sha256'])
        listed[f'{f["id"]}.body'] = (f['body_size'], f['body_sha256'])
    found = {}
    try:
        with tarfile.open(path, mode='r:') as archive:
            for member in archive:
                if not member.isfile() or member.name not in listed or member.name in found:
                    return None
                with archive.extractfile(member) as stream:
                    data = stream.read(listed[member.name][0] + 1)
                if (len(data), sha256(data)) != listed[member.name]:
                    return None
                found[member.name] = data
    except (tarfile.TarError, OSError):
        return None
    return found if set(found) == set(listed) else None


def audit(objects, *, run_id, launch_sha256, workdir):
    """Audit `objects` [(key, local path), ...] of the run's state bucket into `workdir`."""
    workdir = Path(workdir)
    workdir.mkdir(mode=0o700)
    files_dir = workdir / 'files'
    files_dir.mkdir(mode=0o700)
    prefix = f'evidence/{run_id}/'
    versions = {}
    for key, path in objects:
        if isinstance(key, str) and key.startswith(prefix):
            versions.setdefault(key[len(prefix):], []).append(Path(path))
    digests = {name: {file_sha256(p) for p in paths} for name, paths in versions.items()}
    # A key is written once (a contract retry writes identical bytes); different bytes
    # under one key cannot be attributed and make the evidence incomplete.
    if any(len(d) > 1 for d in digests.values()):
        return report('object_conflict', keys=sorted(n for n, d in digests.items() if len(d) > 1))
    path_of = {name: paths[0] for name, paths in versions.items()}

    if 'contract.json' not in path_of:
        return report('contract_missing')
    try:
        contract = json.loads(path_of['contract.json'].read_text())
        launch_bytes = contract['launch_json'].encode()
        reader_bytes = contract['reader_json'].encode()
        launch, reader = json.loads(launch_bytes), json.loads(reader_bytes)
        bound = (contract.get('run_id') == run_id and sha256(launch_bytes) == contract['launch_sha256'] == launch_sha256
                 and sha256(reader_bytes) == contract['reader_sha256'] == launch['plan']['artifacts']['reader.json']
                 and launch['plan']['run_id'] == run_id)
    except (ValueError, KeyError, TypeError, AttributeError, UnicodeError):
        bound = False
    if not bound:
        return report('contract_mismatch')

    generations = {}
    for name in path_of:
        match = re.fullmatch(r'(index|ledger|batch)-([1-9][0-9]{0,9})\.(json|sqlite3|tar)', name)
        if match and match.group(3) == {'index': 'json', 'ledger': 'sqlite3', 'batch': 'tar'}[match.group(1)]:
            generations.setdefault(int(match.group(2)), set()).add(match.group(1))
    valid, ignored, incomplete = {}, 0, 0
    shipped, conflicts = {}, set()
    for generation in sorted(generations):
        if 'index' not in generations[generation]:
            incomplete += 1
            continue
        try:
            path = path_of[f'index-{generation}.json']
            index = json.loads(path.read_bytes()) if path.stat().st_size <= MAX_INDEX else None
        except ValueError:
            index = None
        found = None
        if valid_index(index, prefix, generation):
            ledger = path_of.get(index['ledger']['key'][len(prefix):])
            ok = ledger is not None and (ledger.stat().st_size, file_sha256(ledger)) == (index['ledger']['size'],
                                                                                          index['ledger']['sha256'])
            if ok and index['batch'] is not None:
                batch = path_of.get(index['batch']['key'][len(prefix):])
                ok = batch is not None and (batch.stat().st_size, file_sha256(batch)) == (index['batch']['size'],
                                                                                         index['batch']['sha256'])
                found = batch_files(batch, index) if ok else None
                ok = found is not None
            elif ok:
                ok = index['files'] == []
                found = {}
        else:
            ok = False
        if not ok:
            ignored += 1
            continue
        valid[generation] = (index, path_of[index['ledger']['key'][len(prefix):]])
        for name, data in found.items():
            ident = int(name.split('.', 1)[0])
            known = shipped.setdefault(ident, {})
            if name in known:
                if known[name] != sha256(data):
                    conflicts.add(ident)
                continue
            known[name] = sha256(data)
            target = files_dir / name
            with open(target, 'xb') as stream:
                stream.write(data)
    counts = dict(valid=len(valid), ignored=ignored, incomplete=incomplete)
    finals = [g for g, (index, _) in valid.items() if index['kind'] == 'final']
    if not finals:
        if not generations:
            return report('no_paired_evidence', generations=counts)
        newest = max(valid) if valid else None
        return report('tail_unverified', generations=counts,
                      newest_snapshot_at=valid[newest][0]['at'] if newest else None)
    generation = max(finals)
    index, ledger_object = valid[generation]
    ledger_path = workdir / 'ledger.sqlite3'
    ledger_path.write_bytes(ledger_object.read_bytes())
    from urllib.parse import quote
    try:
        db = sqlite3.connect('file:' + quote(str(ledger_path.resolve())) + '?mode=ro&immutable=1', uri=True)
        try:
            if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                return report('ledger_invalid', generations=counts)
            identity = json.loads(db.execute('SELECT value FROM meta WHERE key=?', ('identity',)).fetchone()[0])
            rows = db.execute('SELECT id,substr(result,1,65537) FROM attempts ORDER BY id').fetchmany(12001)
        finally:
            db.close()
    except (sqlite3.Error, TypeError, ValueError):
        return report('ledger_invalid', generations=counts)
    if identity != ledger_identity(reader, launch) or not 0 < len(rows) <= 12000:
        return report('ledger_invalid', generations=counts)
    pending, failures, missing = [], [], []
    for attempt, raw in rows:
        if raw is None:
            pending.append(attempt)
            continue
        try:
            result = json.loads(raw) if len(raw) <= 65536 else None
        except ValueError:
            result = None
        if type(result) is not dict:
            missing.append(attempt)
            continue
        if result.get('captured') is False and 'body_bytes' not in result and 'body_sha256' not in result:
            failures.append(attempt)
            continue
        meta_path, body_path = files_dir / f'{attempt}.json', files_dir / f'{attempt}.body'
        try:
            if attempt in conflicts or not meta_path.exists() or not body_path.exists():
                raise ValueError('absent')
            metadata = json.loads(meta_path.read_bytes()) if meta_path.stat().st_size <= MAX_METADATA else None
            if not attempt_matches(result, metadata, body_path.stat().st_size, file_sha256(body_path)):
                raise ValueError('mismatch')
        except Exception:   # absent, unreadable or invalid: never pending
            missing.append(attempt)
    complete = not missing and not conflicts
    return report('complete' if complete else 'incomplete', generations=counts, generation=generation,
                  kind=index['kind'], reader=index['reader'], at=index['at'], attempts=len(rows),
                  pending=pending, capture_failures=failures, missing_or_mismatched=missing,
                  conflicts=sorted(conflicts), newest_snapshot_at=valid[max(valid)][0]['at'])
