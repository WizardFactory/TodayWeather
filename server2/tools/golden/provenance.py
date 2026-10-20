#!/usr/bin/env python3
"""Bounded legacy-source freshness audit, never a semantic oracle or baseline writer."""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import selectors
import shutil
import subprocess
import sys
import time

READER_PARTS = ('server', 'test', 'offline', 'source-fingerprints.js')
SOURCE_FILE_LIMIT = 1024 * 1024
SOURCE_TOTAL_LIMIT = 16 * 1024 * 1024
RESPONSE_LIMIT = 2 * 1024 * 1024
DEADLINE = 5
# The unchanged pinned reader already hashes these three named verification exports.
READER_EXPORTS = frozenset({
    'server/test/offline/oracle-provenance/air/air-fixtures.js',
    'server/test/offline/oracle-provenance/air/sections-air.js',
    'server/test/offline/oracle-provenance/delivery/alarm-scenarios.js',
})
COMPRESSED_LIMIT = 16 * 1024 * 1024
INFLATED_LIMIT = 32 * 1024 * 1024
EXPECTED_POINTERS = {'server2/tests/delivery/fixtures/alarm-oracle.json.gz': ['/source/files'], 'server2/tests/delivery/fixtures/alerts-air-filter.json.gz': ['/source/files'], 'server2/tests/delivery/fixtures/alerts-malformed.json.gz': ['/source/files'], 'server2/tests/delivery/fixtures/alerts-oracle.json.gz': ['/source/files'], 'server2/tests/delivery/fixtures/warnings-oracle.json.gz': ['/sourceHashes'], 'server2/tests/domestic/fixtures/air.json.gz': ['/source/files'], 'server2/tests/domestic/fixtures/air_forecast.json.gz': ['/forecast/source/files', '/harness/source'], 'server2/tests/domestic/fixtures/life.json.gz': ['/source/files'], 'server2/tests/domestic/fixtures/oracle.json.gz': ['/source/files'], 'server2/tests/domestic/fixtures/s3-response.json.gz': ['/source/files'], 'server2/tests/domestic/fixtures/s3-rich-response.json.gz': ['/source/files'], 'server2/tests/domestic/fixtures/source.json.gz': ['/source/files'], 'server2/tests/domestic/fixtures/stations.json.gz': ['/source/files'], 'server2/tests/domestic/fixtures/towns-oracle.json.gz': ['/oracle/files'], 'server2/tests/golden/records.json': ['/source/files'], 'server2/tests/legacy_versions/fixtures/kma-older.json.gz': ['/source/files'], 'server2/tests/legacy_versions/fixtures/kma-town.json.gz': ['/source/files'], 'server2/tests/narrative/contract.json': ['/source_sha256'], 'server2/tests/nation/oracle.json': ['/hash'], 'server2/tests/state/fixtures/push-oracle.json.gz': ['/source/files'], 'server2/tests/world/fixtures/oracle.json.gz': ['/source/files'], 'server2/tests/world/fixtures/widget.json.gz': ['/source/files']}


def require(value, message):
    if not value:
        raise ValueError(message)


def pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, 'duplicate JSON key: '+key)
        result[key] = value
    return result


def load_json(raw):
    return json.loads(raw, object_pairs_hook=pairs)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def is_digest(value):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) is not None


def regular(root, relative):
    require(isinstance(relative, str), 'string relative path required')
    path = PurePosixPath(relative)
    require(not path.is_absolute() and '..' not in path.parts and str(path) == relative,
            'canonical relative path required: '+relative)
    current = root
    for part in path.parts:
        current = current/part
        require(not current.is_symlink(), 'symlink rejected: '+relative)
    require(current.is_file(), 'regular file required: '+relative)
    return current


def read_bounded(path, limit):
    require(path.stat().st_size <= limit, 'input size limit exceeded: '+path.name)
    with path.open('rb') as file:
        raw = file.read(limit+1)
    require(len(raw) <= limit, 'input size limit exceeded: '+path.name)
    return raw


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], stderr=subprocess.PIPE)


def validate_registry(registry, declaration):
    require(set(registry) == {'schema', 'reader_sha256', 'legacy_sources', 'fixtures',
                              'semantics', 'other_test_json', 'verification_exports'}, 'unknown registry fields')
    require(type(registry['schema']) is int and registry['schema'] == 1 and registry['semantics'] == 'NOT_EVALUATED',
            'unsupported registry schema/semantic scope')
    require(is_digest(registry['reader_sha256']), 'invalid reader identity')
    sources = registry['legacy_sources']
    require(isinstance(sources, list) and len(sources) == 187 and sources == sorted(set(sources)),
            'exact unique 187-product-source registry required')
    require(all(isinstance(p, str) and p.startswith('server/') for p in sources), 'invalid legacy source registry')
    exports = registry['verification_exports']
    require(isinstance(exports, list) and exports == sorted(set(exports)) and all(
        isinstance(p, str) and p.startswith('server/test/offline/oracle-provenance/')
        for p in exports) and not set(exports) & set(sources), 'invalid verification export registry')
    declared = {item['path'] for item in declaration.get('outside', [])
                if item.get('category') == 'legacy-export'
                and isinstance(item.get('path'), str)
                and item['path'].startswith('server/test/offline/oracle-provenance/')}
    require(set(exports) <= declared and READER_EXPORTS <= set(exports),
            'undeclared or missing reader verification export')
    fixtures = registry['fixtures']
    require(isinstance(fixtures, list) and len(fixtures) == 22, 'exact 22-fixture registry required')
    require(all(isinstance(f, dict) for f in fixtures), 'fixture objects required')
    names = [f.get('path') for f in fixtures]
    require(len(set(names)) == 22 and set(names) == set(EXPECTED_POINTERS), 'unknown or missing fixture')
    references = set()
    for fixture in fixtures:
        require(set(fixture) == {'path', 'sha256', 'compression', 'maps', 'provenance'}, 'unknown fixture fields')
        require(is_digest(fixture['sha256']), 'invalid fixture digest')
        require(fixture['compression'] == ('gzip' if fixture['path'].endswith('.gz') else 'none'), 'fixture compression mismatch')
        maps = fixture['maps']
        require(isinstance(maps, list) and all(isinstance(m, dict) for m in maps) and [m.get('pointer') for m in maps] == EXPECTED_POINTERS[fixture['path']], 'missing/unknown source map')
        for item in maps:
            require(set(item) == {'pointer', 'paths'} and isinstance(item['paths'], list), 'invalid map registry')
            paths = item['paths']
            require(paths and paths == sorted(set(paths)) and set(paths) <= set(sources) | set(exports), 'invalid map source paths')
            references.update(paths)
    require(references == set(sources) | set(exports), 'uncovered source/export registry')
    require(set(exports) == references & declared, 'verification export/reference mismatch')
    other = registry['other_test_json']
    require(isinstance(other, list) and other == sorted(set(other)) and not set(other) & set(names), 'invalid other-test inventory')
    require(all(isinstance(p, str) and p.startswith('server2/tests/') and p.endswith(('.json', '.json.gz')) for p in other), 'invalid other-test path')
    return registry


def reader_path(root, declaration):
    named = '/'.join(READER_PARTS)
    entries = [item for item in declaration.get('outside', []) if item.get('category') == 'legacy-export' and item.get('path') == named]
    require(len(entries) == 1 and entries[0].get('path') == named, 'exact named fingerprint export declaration required')
    return regular(root, named)


def bounded_child(command, env):
    # Bound both pipes while running, rather than capture unbounded output and
    # check its length afterwards. Reader cannot spawn child processes.
    process = subprocess.Popen(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    selector = selectors.DefaultSelector()
    buffers = {process.stdout: bytearray(), process.stderr: bytearray()}
    for stream in buffers:
        selector.register(stream, selectors.EVENT_READ)
    end = time.monotonic()+DEADLINE
    try:
        while selector.get_map():
            remaining = end-time.monotonic()
            require(remaining > 0, 'fingerprint reader deadline exceeded')
            events = selector.select(remaining)
            require(events, 'fingerprint reader deadline exceeded')
            for key, _ in events:
                block = os.read(key.fileobj.fileno(), 65536)
                if not block:
                    selector.unregister(key.fileobj)
                else:
                    buffers[key.fileobj].extend(block)
                    require(sum(map(len, buffers.values())) <= RESPONSE_LIMIT, 'fingerprint response size limit exceeded')
        process.wait(timeout=max(0.001, end-time.monotonic()))
        stderr = bytes(buffers[process.stderr]).decode('utf-8', errors='replace')
        require(process.returncode == 0, 'fingerprint reader rejected input: '+stderr.strip())
        require(not stderr, 'unexpected fingerprint reader stderr')
        return bytes(buffers[process.stdout])
    except BaseException:
        process.kill()
        process.wait()
        raise
    finally:
        selector.close()
        process.stdout.close()
        process.stderr.close()


def fingerprint(root, declaration, registry, node):
    reader = reader_path(root, declaration)
    require(digest(read_bounded(reader, SOURCE_FILE_LIMIT)) == registry['reader_sha256'], 'fingerprint reader identity mismatch')
    tracked = set(git(root, 'ls-files', '-z', '--', 'server').decode().split('\0'))
    require(set(registry['legacy_sources']) <= tracked, 'untracked legacy source rejected')
    command = [str(Path(node).resolve()), str(reader), '--root', str(root)]
    raw = bounded_child(command, {'PATH': os.defpath, 'TZ': 'UTC', 'LANG': 'C'})
    result = load_json(raw)
    require(isinstance(result, dict) and set(result) == {'schema', 'node', 'files', 'total_bytes'} and type(result['schema']) is int and result['schema'] == 1, 'invalid fingerprint response schema')
    require(isinstance(result['node'], str) and re.fullmatch(r'v\d+\.\d+\.\d+', result['node']), 'invalid reader node identity')
    require(isinstance(result['files'], dict) and set(result['files']) == set(registry['legacy_sources']) | READER_EXPORTS and all(is_digest(v) for v in result['files'].values()), 'incomplete/invalid fingerprint map')
    require(type(result['total_bytes']) is int and 0 <= result['total_bytes'] <= SOURCE_TOTAL_LIMIT, 'invalid aggregate source size')
    return result


def fixture_document(root, fixture):
    path = regular(root, fixture['path'])
    raw = read_bounded(path, COMPRESSED_LIMIT)
    require(digest(raw) == fixture['sha256'], 'fixture identity mismatch: '+fixture['path'])
    if fixture['compression'] == 'gzip':
        with gzip.GzipFile(fileobj=io.BytesIO(raw)) as file:
            raw = file.read(INFLATED_LIMIT+1)
        require(len(raw) <= INFLATED_LIMIT, 'inflated fixture size limit exceeded')
    else:
        require(len(raw) <= INFLATED_LIMIT, 'fixture size limit exceeded')
    return load_json(raw)


def audit(root, registry, declaration, node):
    root = Path(root).resolve()
    registry = validate_registry(registry, declaration)
    sources = fingerprint(root, declaration, registry, node)
    # Reader exports have exactly one hashing authority: the unchanged Node reader.
    exports = {p: sources['files'][p] for p in READER_EXPORTS}
    export_bytes = 0
    for name in registry['verification_exports']:
        if name in READER_EXPORTS:
            continue
        raw = read_bounded(regular(root, name), SOURCE_FILE_LIMIT)
        export_bytes += len(raw)
        require(export_bytes <= SOURCE_TOTAL_LIMIT, 'aggregate verification export size limit')
        exports[name] = digest(raw)
    current = dict(sources['files'], **exports)
    names = set(f['path'] for f in registry['fixtures'])
    all_json = {p for p in git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'server2/tests').decode().split('\0') if p.endswith(('.json', '.json.gz'))}
    require(all_json == names | set(registry['other_test_json']), 'uncovered/missing test JSON fixture')
    results = []
    for fixture in registry['fixtures']:
        regular(root, fixture['provenance'])
        document = fixture_document(root, fixture)
        maps = []
        for entry in fixture['maps']:
            source_map = document
            for part in entry['pointer'].split('/')[1:]:
                require(isinstance(source_map, dict) and part in source_map, 'missing source map: '+entry['pointer'])
                source_map = source_map[part]
            require(isinstance(source_map, dict) and set(source_map) == set(entry['paths']) and all(is_digest(v) for v in source_map.values()), 'invalid source map: '+entry['pointer'])
            mismatches = [{'path':p, 'recorded_sha256':v, 'current_sha256':current[p]} for p,v in sorted(source_map.items()) if current[p] != v]
            maps.append({'pointer':entry['pointer'], 'references':len(source_map), 'mismatches':mismatches})
        results.append({'fixture':fixture['path'], 'fixture_sha256':fixture['sha256'], 'status':'DRIFT' if any(m['mismatches'] for m in maps) else 'SOURCE_CURRENT', 'maps':maps})
    drift = sum(f['status'] == 'DRIFT' for f in results)
    return {'schema':1, 'status':'DRIFT' if drift else 'SOURCE_CURRENT', 'semantics':'NOT_EVALUATED',
            'checkout_commit':git(root, 'rev-parse', 'HEAD').decode().strip(),
            'legacy_tracked_changes':git(root, 'diff', '--name-only', 'HEAD', '--', 'server').decode().splitlines(), 'reader_sha256':registry['reader_sha256'],
            'node':sources['node'], 'source_total_bytes':sources['total_bytes'], 'legacy_sources':{p:sources['files'][p] for p in registry['legacy_sources']},
            'verification_exports':exports, 'additional_export_bytes':export_bytes,
            'fixture_count':len(results), 'map_count':sum(len(f['maps']) for f in results),
            'references':sum(m['references'] for f in results for m in f['maps']), 'drifted_fixtures':drift,
            'other_test_json_count':len(registry['other_test_json']), 'other_test_json':registry['other_test_json'], 'fixtures':results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[3])
    parser.add_argument('--node', default=shutil.which('node'))
    parser.add_argument('--out', type=Path, required=True, help='New ignored directory under checkout reports/')
    args = parser.parse_args()
    root = args.root.resolve()
    output = args.out.absolute()
    require(output == output.resolve() and output.is_relative_to(root/'reports') and not output.exists(), 'new non-symlink reports output required')
    require(subprocess.run(['git', '-C', str(root), 'check-ignore', '-q', str(output)]).returncode == 0, 'ignored output required')
    registry_raw = read_bounded(regular(root, 'server2/config/golden-provenance.json'), RESPONSE_LIMIT)
    declaration = load_json(read_bounded(regular(root, 'server2/config/tasks/PROV2819.json'), RESPONSE_LIMIT))
    require(args.node and Path(args.node).is_file(), 'installed node executable required')
    report = audit(root, load_json(registry_raw), declaration, args.node)
    report['registry_sha256'] = digest(registry_raw)
    report['checker_sha256'] = digest(Path(__file__).read_bytes())
    output.mkdir(parents=True)
    (output/'report.json').write_text(json.dumps(report, indent=2, sort_keys=True)+'\n')
    print(json.dumps({'status':report['status'], 'semantics':report['semantics'], 'fixture_count':report['fixture_count'], 'drifted_fixtures':report['drifted_fixtures'], 'report':str(output/'report.json')}))
    return 1 if report['status'] == 'DRIFT' else 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError, KeyError, TypeError, RecursionError, subprocess.SubprocessError) as error:
        print('INVALID provenance input: '+str(error), file=sys.stderr)
        raise SystemExit(2)
