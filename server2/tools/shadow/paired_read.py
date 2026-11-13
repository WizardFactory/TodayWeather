#!/usr/bin/env python3
"""Bounded paired public reads. Capture evidence; never declare product parity."""
import argparse
import contextlib
import fcntl
import hashlib
import http.client
import json
import math
import multiprocessing
from multiprocessing.reduction import DupFd
import os
from pathlib import Path
import re
import signal
import sqlite3
import stat
import sys
import time
from urllib.parse import quote, urlsplit

PRODUCTION = 'https://todayweather.wizardfactory.net'
MAX_DURATION = 168 * 3600
MAX_ATTEMPTS = 6000
MAX_BODY = 2 * 1024 * 1024
REQUEST_SECONDS = 20
COORDINATES = ('37.566,126.978', '35.1796,129.0756', '37.7519,128.8761',
               '33.4996,126.5312', '40.7128,-74.006', '35.6762,139.6503')
ADDRESS = quote('서울특별시 종로구 송월동', safe='')
PATHS = frozenset(
    [f'/weather{v}/coord/{c}' for v in ('', '/v000901', '/v000902', '/v000903')
     for c in COORDINATES]
    + [f'/geocode/v000903/coord/{c}' for c in COORDINATES]
    + [f'/geocode/{v}/addr/{ADDRESS}' for v in ('v000901', 'v000903')]
    + [f'/{v}/kma/addr/{ADDRESS}' for v in ('v000901', 'v000903')]
    + [f'/{v}/town/{ADDRESS}' for v in ('v000705', 'v000803')]
    + [f'/{v}/nation/KR' for v in ('v000901', 'v000903')]
    + ['/v000903/kma/special', '/v000903/notice/latest',
       '/ww/010000/current/2?gcode=40.7128,-74.006'])
CACHE_HEADERS = frozenset(('date', 'etag', 'last-modified', 'cache-control', 'age',
                           'content-type', 'content-encoding', 'expires', 'vary'))


def require(ok, message):
    if not ok:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def integer(value, lo, hi):
    return type(value) is int and lo <= value <= hi


def validate(manifest, candidate, production, loopback_test=False):
    require(type(manifest) is dict and set(manifest) == {
        'schema', 'duration_seconds', 'max_attempts', 'min_spacing_seconds',
        'candidate_sha256', 'cases'}, 'invalid manifest fields')
    require(type(manifest['schema']) is int and manifest['schema'] == 1, 'schema must be 1')
    require(integer(manifest['duration_seconds'], 1, MAX_DURATION), 'duration exceeds scope')
    require(integer(manifest['max_attempts'], 1, MAX_ATTEMPTS), 'attempt cap exceeds scope')
    require(integer(manifest['min_spacing_seconds'], 1, MAX_DURATION), 'spacing must be >=1s')
    require(type(manifest['candidate_sha256']) is str and
            re.fullmatch('[0-9a-f]{64}', manifest['candidate_sha256']), 'invalid candidate digest')
    for origin in (candidate, production) if loopback_test else (candidate,):
        require(type(origin) is str and re.fullmatch(r'http://127\.0\.0\.1:[0-9]{1,5}', origin),
                'candidate/test origins must be literal loopback HTTP with a port')
        require(1 <= urlsplit(origin).port <= 65535, 'invalid port')
    if not loopback_test:
        require(production == PRODUCTION, 'production origin is fixed')
    cases = manifest['cases']
    require(type(cases) is list and 1 <= len(cases) <= 100, 'invalid cases')
    ids, planned = set(), 0
    for case in cases:
        require(type(case) is dict and set(case) == {
            'id', 'method', 'path', 'interval_seconds', 'conditional'}, 'invalid case fields')
        require(type(case['id']) is str and re.fullmatch('[a-zA-Z0-9_-]{1,64}', case['id'])
                and case['id'] not in ids, 'invalid/duplicate case id')
        ids.add(case['id'])
        require(type(case['method']) is str and case['method'] in ('GET', 'HEAD'), 'read methods only')
        require(type(case['path']) is str and case['path'] in PATHS, 'path outside fixed public inventory')
        require(integer(case['interval_seconds'], 1, MAX_DURATION), 'invalid interval')
        require(type(case['conditional']) is bool, 'conditional must be boolean')
        require(not case['conditional'] or case['method'] == 'GET', 'conditional requires GET')
        planned += math.ceil(manifest['duration_seconds'] / case['interval_seconds'])
    require(planned <= manifest['max_attempts'], 'planned attempts exceed cap')
    return {'planned_attempts_per_origin': planned, 'maximum_attempts_per_origin': manifest['max_attempts'],
            'duration_seconds': manifest['duration_seconds'], 'cases': len(cases),
            'candidate': candidate, 'production': production, 'loopback_test': loopback_test,
            'qualification': 'capture only; product parity is not assessed'}


def private_write(path, data):
    with open(path, 'xb') as stream:
        os.chmod(path, 0o600)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


@contextlib.contextmanager
def locked_directory(path, resume):
    path = Path(path)
    if not resume:
        path.mkdir(mode=0o700, parents=False, exist_ok=False)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
            and info.st_mode & 0o077 == 0, 'state must be a private owned directory')
    require(all(not child.is_symlink() for child in path.iterdir()), 'state cannot contain symlinks')
    fd = os.open(path / 'owner.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield path, fd
    finally:
        os.close(fd)


class Ledger:
    """Single-owner, FULL-synchronous admission journal. Pending means consumed."""
    def __init__(self, path, identity, resume):
        self.path = path
        dbpath = path / 'ledger.sqlite3'
        require(dbpath.exists() == resume, 'existing state requires resume; missing ledger cannot resume')
        self.db = sqlite3.connect(dbpath)
        os.chmod(dbpath, 0o600)
        self.db.execute('PRAGMA synchronous=FULL')
        if not resume:
            self.db.executescript('''
              CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
              CREATE TABLE slots (case_id TEXT, slot INTEGER, PRIMARY KEY(case_id,slot));
              CREATE TABLE attempts (id INTEGER PRIMARY KEY, case_id TEXT, slot INTEGER,
                origin TEXT, path TEXT, method TEXT, started REAL, result TEXT,
                UNIQUE(case_id,slot,origin));
              CREATE TABLE skips (case_id TEXT, slot INTEGER, origin TEXT, reason TEXT);
            ''')
            now = time.time()
            with self.db:
                for key, value in {'identity': identity, 'started': now, 'last_clock': now,
                                   'last_attempt': 0, 'failures': {}, 'terminal': None}.items():
                    self.put(key, value)
        require(self.get('identity') == identity, 'run identity changed')
        require(self.get('terminal') is None, 'run is terminal; automatic resume refused')
        self.manifest = identity['manifest']
        self.end = self.get('started') + self.manifest['duration_seconds']
        self.monotonic_end = time.monotonic() + max(0, self.end - time.time())

    def close(self):
        self.db.close()

    def get(self, key):
        return json.loads(self.db.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()[0])

    def put(self, key, value):
        self.db.execute('INSERT OR REPLACE INTO meta VALUES (?,?)', (key, canonical(value)))

    def terminal(self, reason):
        with self.db:
            self.put('terminal', reason)

    def clock(self):
        now = time.time()
        if now < self.get('last_clock'):
            self.terminal('clock-rollback')
            raise ValueError('wall clock moved backwards')
        with self.db:
            self.put('last_clock', now)
        if now >= self.end or time.monotonic() >= self.monotonic_end:
            self.terminal('duration-complete')
            return None
        return now

    def claim_slot(self, case, slot):
        with self.db:
            cur = self.db.execute('INSERT OR IGNORE INTO slots VALUES (?,?)', (case['id'], slot))
        return cur.rowcount == 1

    def reserve(self, case, slot, origin):
        require(self.get('terminal') is None, 'terminal run')
        now = self.clock()
        if now is None:
            return None
        count = self.db.execute('SELECT count(*) FROM attempts WHERE origin=?', (origin,)).fetchone()[0]
        if count >= self.manifest['max_attempts']:
            self.terminal('attempt-cap')
            return None
        require(now >= self.get('last_attempt') + self.manifest['min_spacing_seconds'], 'spacing not elapsed')
        with self.db:
            cur = self.db.execute('INSERT INTO attempts(case_id,slot,origin,path,method,started) VALUES (?,?,?,?,?,?)',
                                  (case['id'], slot, origin, case['path'], case['method'], now))
            self.put('last_attempt', now)
        return cur.lastrowid

    def validator(self, origin, path):
        for row in self.db.execute('SELECT result FROM attempts WHERE origin=? AND path=? AND method=? '
                                   'AND result IS NOT NULL ORDER BY id DESC', (origin, path, 'GET')):
            result = json.loads(row[0])
            if result.get('status') not in (200, 304):
                continue
            headers = result.get('headers', {})
            for source, target in (('etag', 'If-None-Match'), ('last-modified', 'If-Modified-Since')):
                value = headers.get(source)
                if value and len(value) <= 1024 and all(32 <= ord(c) < 127 for c in value):
                    return {target: value}
        return None

    def finish(self, attempt, result):
        with self.db:
            row = self.db.execute('SELECT origin FROM attempts WHERE id=?', (attempt,)).fetchone()
            require(row is not None, 'result requires an admitted attempt')
            origin = row[0]
            self.db.execute('UPDATE attempts SET result=? WHERE id=?', (canonical(result), attempt))
            status = result.get('status', 0)
            failures = self.get('failures')
            failures[origin] = failures.get(origin, 0) + 1 if result.get('error') or status >= 500 else 0
            self.put('failures', failures)
            reason = None
            if result.get('error') in ('deadline', 'oversize'):
                reason = result['error']
            elif status in (401, 403, 429):
                reason = f'http-{status}'
            elif 300 <= status < 400 and status != 304:
                reason = 'redirect'
            elif failures[origin] >= 3:
                reason = 'consecutive-failures'
            if reason:
                self.put('terminal', reason)

    def summary(self):
        return {'terminal': self.get('terminal'), 'attempts': dict(self.db.execute(
            'SELECT origin,count(*) FROM attempts GROUP BY origin')), 'pending': self.db.execute(
            'SELECT count(*) FROM attempts WHERE result IS NULL').fetchone()[0],
            'skipped_conditionals': self.db.execute('SELECT count(*) FROM skips').fetchone()[0],
            'qualification': 'not assessed'}


def http_worker(origin, method, path, headers, directory, attempt, owner_fd, seconds):
    """Child owns its sole socket; parent kills it at the absolute deadline."""
    # The child retains the same flock open-file description as its coordinator.
    # If the coordinator is killed, resume cannot overlap this outstanding socket.
    lock_fd = owner_fd.detach()
    def deadline(signum, frame):
        raise TimeoutError('deadline')
    signal.signal(signal.SIGALRM, deadline)
    parsed = urlsplit(origin)
    cls = http.client.HTTPSConnection if parsed.scheme == 'https' else http.client.HTTPConnection
    conn = cls(parsed.hostname, parsed.port, timeout=REQUEST_SECONDS)
    result, body = {}, b''
    try:
        signal.setitimer(signal.ITIMER_REAL, seconds)
        conn.request(method, path, headers={'User-Agent': 'server2-bounded-verification/1',
                                         'Accept-Encoding': 'identity', **headers})
        response = conn.getresponse()
        result['status'] = response.status
        result['headers'] = {key.lower(): value for key, value in response.getheaders()
                             if key.lower() in CACHE_HEADERS and len(value) <= 4096
                             and all(ord(c) >= 32 and ord(c) != 127 for c in value)}
        body = response.read(MAX_BODY + 1)
        if len(body) > MAX_BODY:
            body = body[:MAX_BODY]
            result['error'] = 'oversize'
    except TimeoutError:
        result['error'] = 'deadline'
    except (OSError, http.client.HTTPException) as error:
        result['error'] = type(error).__name__  # Do not retain arbitrary exception text or URLs.
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        conn.close()
    result.update(body_bytes=len(body), body_sha256=digest(body))
    private_write(Path(directory) / f'{attempt}.body', body)
    private_write(Path(directory) / f'{attempt}.json', canonical(result).encode())
    os.close(lock_fd)


def capture(origin, case, headers, directory, attempt, seconds, owner_fd):
    start = time.monotonic()
    worker = multiprocessing.get_context('spawn').Process(
        target=http_worker, args=(origin, case['method'], case['path'], headers, str(directory), attempt,
                                  DupFd(owner_fd), seconds))
    worker.start()
    try:
        worker.join(seconds)
        if worker.is_alive():
            worker.terminate()
            worker.join(1)
            if worker.is_alive():
                worker.kill()
                worker.join()
            result = {'error': 'deadline'}
        elif worker.exitcode != 0:
            result = {'error': 'worker-exit'}
        else:
            result = json.loads((Path(directory) / f'{attempt}.json').read_text())
        result['elapsed_ms'] = round((time.monotonic() - start) * 1000)
        return result
    finally:
        if worker.is_alive():
            worker.kill()
            worker.join()
        worker.close()


def execute(manifest, candidate, production, state, binary, resume=False, loopback_test=False):
    validate(manifest, candidate, production, loopback_test)
    require(digest(Path(binary).read_bytes()) == manifest['candidate_sha256'], 'candidate file hash mismatch')
    identity = {'manifest': manifest, 'candidate': candidate, 'production': production,
                'loopback_test': loopback_test, 'sampler_sha256': digest(Path(__file__).read_bytes())}
    with locked_directory(state, resume) as (directory, owner_fd):
        ledger = Ledger(directory, identity, resume)
        try:
            while ledger.get('terminal') is None:
                now = ledger.clock()
                if now is None:
                    break
                for case in manifest['cases']:
                    now = ledger.clock()
                    if now is None:
                        break
                    # Only the current slot is eligible: no replay of missed slots after downtime.
                    slot = int((now - ledger.get('started')) // case['interval_seconds'])
                    if not ledger.claim_slot(case, slot):
                        continue
                    for label, origin in (('candidate', candidate), ('production', production)):
                        headers = ledger.validator(label, case['path']) if case['conditional'] else {}
                        if headers is None:
                            with ledger.db:
                                ledger.db.execute('INSERT INTO skips VALUES (?,?,?,?)',
                                                  (case['id'], slot, label, 'no-validator'))
                            continue
                        while ledger.get('terminal') is None:
                            now = ledger.clock()
                            if now is None:
                                break
                            wait = ledger.get('last_attempt') + manifest['min_spacing_seconds'] - now
                            if wait <= 0:
                                break
                            time.sleep(min(wait, 0.2))
                        if ledger.get('terminal') is not None:
                            break
                        attempt = ledger.reserve(case, slot, label)
                        if attempt is None:
                            break
                        seconds = max(0.001, min(REQUEST_SECONDS, ledger.end - time.time(),
                                               ledger.monotonic_end - time.monotonic()))
                        result = capture(origin, case, headers, directory, attempt, seconds, owner_fd)
                        ledger.finish(attempt, result)
                        if ledger.get('terminal') is not None:
                            break
                    if ledger.get('terminal') is not None:
                        break
                if ledger.get('terminal') is None:
                    now = time.time()
                    next_due = min(ledger.get('started') +
                                   (int((now - ledger.get('started')) // case['interval_seconds']) + 1)
                                   * case['interval_seconds'] for case in manifest['cases'])
                    time.sleep(max(0, min(5, next_due - now, ledger.end - now)))
        except KeyboardInterrupt:
            # Pending admission remains consumed. Explicit --resume may continue other slots.
            pass
        except BaseException:
            if ledger.get('terminal') is None:
                ledger.terminal('operator-error')
            raise
        finally:
            summary = ledger.summary()
            ledger.close()
        return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--production', default=PRODUCTION)
    parser.add_argument('--loopback-test', action='store_true')
    parser.add_argument('--execute', action='store_true', help='Without this flag, validate only; no network or state writes')
    parser.add_argument('--state', type=Path)
    parser.add_argument('--candidate-binary', type=Path)
    parser.add_argument('--resume', action='store_true')
    args = parser.parse_args()
    def interrupt(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupt)
    try:
        require(args.manifest.stat().st_size <= 65536, 'manifest exceeds 64KiB')
        manifest = json.loads(args.manifest.read_text())
        plan = validate(manifest, args.candidate, args.production, args.loopback_test)
        if args.execute:
            require(args.state is not None and args.candidate_binary is not None,
                    'execute requires state and candidate-binary')
            plan = execute(manifest, args.candidate, args.production, args.state,
                           args.candidate_binary, args.resume, args.loopback_test)
        else:
            require(not args.resume, 'resume requires execute')
        print(json.dumps(plan, indent=2))
        return 0 if plan.get('terminal') in (None, 'duration-complete') else 2
    except (ValueError, OSError, sqlite3.Error) as error:
        print(f'refused: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
