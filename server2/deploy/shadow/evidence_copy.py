#!/usr/bin/env python3
"""Copy the paired reader's evidence to the run's state bucket (SR-5a, #3003).

Runs on the qualification host as the oneshot units `<run>-copy.service` (hourly timer
and once at install) and `<run>-finalize.service` (`--final`, started without waiting by
the reader's stop and by the 168-hour stop). Python standard library only: instance-role
credentials from IMDSv2 and SigV4-signed S3 PutObject to `server2-shadow-<run>-state`.

Every run takes an exclusive lock on `state/copy.lock` and is the only writer of
`state/copy.json` (replaced atomically). In order it
  1. publishes `evidence/<run>/contract.json` (launch.json and reader.json, with their
     SHA-256) until one PUT has succeeded;
  2. reserves a new generation g (never reused), snapshots the ledger with SQLite's
     online backup and checks the copy's integrity;
  3. PUTs `batch-<g>.tar` (complete file pairs of completed attempts not yet shipped,
     if any), then `ledger-<g>.sqlite3`, then `index-<g>.json` last: the index is the
     commit point. State changes only after the index PUT succeeded.
A generation is `final` when `state/final.requested` exists (or this is the finalizer)
and the reader has stopped (unit inactive or failed and its owner.lock free);
the request stays until a final generation commits, so any later run retries it.
Nothing starts at or after epoch + 170 h - 10 min, and every wait and PUT ends there.
Output is one JSON line per event with a fixed vocabulary: never a key, URL,
credential or body.
"""
import argparse
import datetime
import fcntl
import hashlib
import hmac
import http.client
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import ssl
import stat
import subprocess
import sys
import tarfile
import time

SCHEMA = 1
REGION = 'ap-northeast-2'
INSTALL_ROOT = Path('/opt/server2-shadow')
# The copy and finalize units stop a run after TimeoutStartSec=600: every wait inside
# one run ends earlier, at this many seconds after its start or at the absolute bound.
RUN_SECONDS = 570
FINAL_WAIT_SECONDS = 120
POLL_SECONDS = 2
LIMIT_MARGIN = 600
# Bounds one batch's temporary file and upload; the rest follows in the next generation.
MAX_BATCH_BYTES = 256 * 1024 ** 2
MAX_METADATA = 65536
MAX_BODY = 2 * 1024 ** 2
MAX_RESULT = 65536
READER_STATES = {'active', 'reloading', 'inactive', 'failed', 'activating', 'deactivating', 'maintenance', 'refreshing'}
STAGES = {'contract', 'batch', 'ledger', 'index', 'snapshot', 'state', 'lock', 'credentials', 'host'}
REASONS = {'deadline', 'lock', 'no_ledger', 'snapshot', 'integrity', 'credentials', 'put', 'state', 'host', 'reader'}
LOG_FIELDS = {'copy_schema', 'level', 'event', 'reason', 'stage', 'status', 'generation', 'kind', 'reader',
              'shipped', 'pending', 'files'}


class CopyError(Exception):
    """One failed step. The message is the reason only; never a key, URL or credential."""
    def __init__(self, reason, *, stage=None, status=None):
        super().__init__(reason)
        self.reason, self.stage, self.status = reason, stage, status


def require(ok, reason, stage=None):
    if not ok:
        raise CopyError(reason, stage=stage)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def emit(line):
    print(line, flush=True)


def record(log, event, level='info', **fields):
    fields = {k: v for k, v in fields.items() if v is not None}
    assert set(fields) <= LOG_FIELDS and fields.get('reason', 'deadline') in REASONS
    assert fields.get('stage', 'host') in STAGES
    log(canonical(dict(copy_schema=SCHEMA, level=level, event=event, **fields)))


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def digest_file(path):
    h = hashlib.sha256()
    size = 0
    with open(path, 'rb') as stream:
        while block := stream.read(1024 ** 2):
            h.update(block)
            size += len(block)
    return h.hexdigest(), size


class HostTree:
    """The installed run: launch.json, reader.json, state/ and data/paired/."""
    def __init__(self, launch_path):
        self.launch_path = Path(launch_path)
        self.root = self.launch_path.parent
        require(self.launch_path.stat().st_size <= 65536, 'host', 'host')
        self.launch_bytes = self.launch_path.read_bytes()
        launch = json.loads(self.launch_bytes)
        run_id = launch['plan']['run_id']
        require(isinstance(run_id, str) and re.fullmatch('[a-z0-9-]{1,30}', run_id), 'host', 'host')
        require(type(launch['epoch']) is int and launch['epoch'] >= 0, 'host', 'host')
        self.launch, self.run_id, self.epoch = launch, run_id, launch['epoch']
        reader = self.root / 'reader.json'
        require(reader.stat().st_size <= 65536, 'host', 'host')
        self.reader_bytes = reader.read_bytes()
        # The collector's destination (coordinator.logging_settings): the run's state bucket.
        self.bucket = f'server2-shadow-{run_id}-state'
        self.prefix = f'evidence/{run_id}/'
        self.limit = self.epoch + 170 * 3600 - LIMIT_MARGIN
        self.state_dir = self.root / 'state'
        self.paired = self.root / 'data/paired'
        self.reader_unit = f'server2-shadow-{run_id}-reader.service'
        self.latch = self.state_dir / 'final.requested'

    def contract(self):
        return canonical(dict(
            schema=SCHEMA, run_id=self.run_id,
            launch_json=self.launch_bytes.decode('utf-8'),
            launch_sha256=hashlib.sha256(self.launch_bytes).hexdigest(),
            reader_json=self.reader_bytes.decode('utf-8'),
            reader_sha256=hashlib.sha256(self.reader_bytes).hexdigest())).encode()


def initial_state():
    return dict(schema=SCHEMA, reserved=0, committed=0, contract=False, shipped=[])


def load_state(tree):
    path = tree.state_dir / 'copy.json'
    if not path.exists():
        return initial_state()
    value = json.loads(path.read_text())
    require(type(value) is dict and set(value) == set(initial_state()) and value['schema'] == SCHEMA
            and type(value['reserved']) is int and type(value['committed']) is int
            and 0 <= value['committed'] <= value['reserved'] and type(value['contract']) is bool
            and type(value['shipped']) is list and all(type(i) is int for i in value['shipped']), 'state', 'state')
    return value


def save_state(tree, value):
    """Atomic replacement: temporary file, fsync, rename, fsync the directory."""
    path = tree.state_dir / 'copy.json'
    temporary = tree.state_dir / '.copy.json.tmp'
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(canonical(value) + '\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    sync_directory(tree.state_dir)


def request_final(tree, now):
    """Durable final request; it stays until a final generation commits."""
    try:
        fd = os.open(tree.latch, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return
    with os.fdopen(fd, 'w') as stream:
        stream.write(canonical({'requested_at': int(now)}) + '\n')
        stream.flush()
        os.fsync(stream.fileno())
    sync_directory(tree.state_dir)


def reader_stopped(unit):
    """ActiveState inactive or failed, and the reader known to have ended (its lock free)."""
    active, exited = unit
    return active in ('inactive', 'failed') and bool(exited) and exited != 'n/a'


def snapshot(tree, destination, stopped):
    """SQLite online backup of the live ledger into a private file, then integrity_check.

    A read-only connection never modifies the live ledger. A stopped reader can leave a
    hot rollback journal that a read-only connection cannot roll back: then both files,
    quiescent because the reader has stopped, are copied privately and rolled back there.
    """
    from urllib.parse import quote
    live = tree.paired / 'ledger.sqlite3'
    target = sqlite3.connect(destination)
    try:
        try:
            source = sqlite3.connect('file:' + quote(str(live.resolve())) + '?mode=ro', uri=True, timeout=30)
            try:
                source.backup(target)
            finally:
                source.close()
        except sqlite3.Error:
            journal = tree.paired / 'ledger.sqlite3-journal'
            require(stopped and journal.exists(), 'snapshot', 'snapshot')
            private = destination.parent / ('.rollback-' + destination.name)
            private.mkdir(mode=0o700)
            try:
                for name in ('ledger.sqlite3', 'ledger.sqlite3-journal'):
                    with open(tree.paired / name, 'rb') as incoming, open(private / name, 'xb') as outgoing:
                        while block := incoming.read(1024 ** 2):
                            outgoing.write(block)
                source = sqlite3.connect(private / 'ledger.sqlite3', timeout=30)
                try:
                    source.backup(target)
                finally:
                    source.close()
            finally:
                for child in private.iterdir():
                    child.unlink()
                private.rmdir()
        require(target.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'integrity', 'snapshot')
        rows = target.execute('SELECT id, result FROM attempts ORDER BY id').fetchall()
        terminal = target.execute("SELECT value FROM meta WHERE key='terminal'").fetchone()
    finally:
        target.close()
    return rows, None if terminal is None else json.loads(terminal[0])


def capture_failure(result):
    """The reader stopped the child: nothing captured, no files (paired_read.capture)."""
    return result.get('captured') is False and 'body_bytes' not in result and 'body_sha256' not in result


def regular(path):
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return None
    return info if stat.S_ISREG(info.st_mode) else None


def select_files(tree, rows, shipped):
    """Complete pairs of completed attempts not yet shipped, bounded per batch."""
    chosen, total = [], 0
    for ident, raw in rows:
        if raw is None or ident in shipped or type(ident) is not int or ident <= 0:
            continue
        try:
            result = json.loads(raw) if len(raw) <= MAX_RESULT else None
        except ValueError:
            result = None
        if type(result) is not dict or capture_failure(result):
            continue
        meta_path, body_path = tree.paired / f'{ident}.json', tree.paired / f'{ident}.body'
        meta_info, body_info = regular(meta_path), regular(body_path)
        if meta_info is None or body_info is None or meta_info.st_size > MAX_METADATA or body_info.st_size > MAX_BODY:
            continue
        meta = meta_path.read_bytes()
        try:
            if type(json.loads(meta)) is not dict:
                continue
        except ValueError:
            continue
        if total + len(meta) + body_info.st_size > MAX_BATCH_BYTES and chosen:
            break
        total += len(meta) + body_info.st_size
        chosen.append((ident, meta, body_path))
    return chosen


def write_batch(path, chosen):
    entries = []
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        with tarfile.open(fileobj=stream, mode='w', format=tarfile.USTAR_FORMAT) as archive:
            for ident, meta, body_path in chosen:
                # One body in memory at a time (at most 2 MiB); written files never change.
                body = body_path.read_bytes()
                for name, data in ((f'{ident}.body', body), (f'{ident}.json', meta)):
                    item = tarfile.TarInfo(name)
                    item.size, item.mode, item.mtime = len(data), 0o600, 0
                    archive.addfile(item, io.BytesIO(data))
                entries.append(dict(id=ident, json_size=len(meta), json_sha256=hashlib.sha256(meta).hexdigest(),
                                    body_size=len(body), body_sha256=hashlib.sha256(body).hexdigest()))
        stream.flush()
        os.fsync(stream.fileno())
    return entries


class Lock:
    """Exclusive flock on state/copy.lock, waiting at most until `until`."""
    def __init__(self, tree, clock, sleep, until):
        self.tree, self.clock, self.sleep, self.until = tree, clock, sleep, until
        self.fd = None

    def __enter__(self):
        self.fd = os.open(self.tree.state_dir / 'copy.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        while True:
            try:
                fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except BlockingIOError:
                if self.clock() >= self.until:
                    os.close(self.fd)
                    self.fd = None
                    raise CopyError('lock', stage='lock') from None
                self.sleep(min(1, max(0, self.until - self.clock())))

    def __exit__(self, *_):
        if self.fd is not None:
            os.close(self.fd)


def run(tree, *, final, put, clock, unit_state, sleep=time.sleep, log=emit):
    """One copy run. put(key, body, sha256, size, time_left) raises CopyError on failure."""
    start = clock()
    if start >= tree.limit:
        record(log, 'copy.failed', 'warn', reason='deadline', stage='host')
        return dict(status='failed', reason='deadline', stage='host')
    until = min(tree.limit, start + RUN_SECONDS)
    time_left = lambda: until - clock()
    temporary = []
    try:
        if final:
            request_final(tree, start)
            # The finalizer is started by the reader's stop: wait (bounded) for it to end.
            wait_until = min(until, start + FINAL_WAIT_SECONDS)
            while not reader_stopped(unit_state()) and clock() < wait_until:
                sleep(POLL_SECONDS)
        with Lock(tree, clock, sleep, until):
            state = load_state(tree)
            if not state['contract']:
                body = tree.contract()
                try:
                    require(time_left() > 0, 'deadline', 'contract')
                    put(tree.prefix + 'contract.json', body, hashlib.sha256(body).hexdigest(), len(body), time_left)
                    state['contract'] = True
                    save_state(tree, state)
                except CopyError as error:
                    record(log, 'copy.failed', 'warn', reason=error.reason, stage='contract', status=error.status)
            if not regular(tree.paired / 'ledger.sqlite3'):
                record(log, 'copy.skipped', reason='no_ledger')
                return dict(status='skipped', reason='no_ledger')
            unit = unit_state()
            stopped = reader_stopped(unit)
            kind = 'final' if stopped and (final or tree.latch.exists()) else 'ordinary'
            generation = state['reserved'] + 1
            state['reserved'] = generation
            save_state(tree, state)       # a reserved key is never used again
            ledger_path = tree.state_dir / f'.ledger-{generation}.sqlite3'
            batch_path = tree.state_dir / f'.batch-{generation}.tar'
            temporary += [ledger_path, batch_path]
            ledger_path.unlink(missing_ok=True)
            try:
                rows, terminal = snapshot(tree, ledger_path, stopped)
            except sqlite3.Error:
                raise CopyError('snapshot', stage='snapshot') from None
            shipped = set(state['shipped'])
            chosen = select_files(tree, rows, shipped)
            batch = None
            if chosen:
                batch_path.unlink(missing_ok=True)
                entries = write_batch(batch_path, chosen)
                sha, size = digest_file(batch_path)
                batch = dict(key=f'{tree.prefix}batch-{generation}.tar', sha256=sha, size=size)
            else:
                entries = []
            ledger_sha, ledger_size = digest_file(ledger_path)
            results = [json.loads(raw) if raw is not None else None for _, raw in rows]
            pending = [ident for ident, raw in rows if raw is None]
            failures = sum(1 for r in results if type(r) is dict and capture_failure(r))
            active = unit[0] if unit[0] in READER_STATES else 'unknown'
            index = dict(
                schema=SCHEMA, run_id=tree.run_id, generation=generation, kind=kind, at=int(clock()),
                reader=dict(state=active, stopped=stopped), terminal=terminal,
                ledger=dict(key=f'{tree.prefix}ledger-{generation}.sqlite3', sha256=ledger_sha, size=ledger_size),
                batch=batch,
                attempts=dict(total=len(rows), completed=len(rows) - len(pending), pending=len(pending),
                              capture_failures=failures),
                pending_ids=pending, files=entries, shipped_total=len(shipped | {e['id'] for e in entries}))
            index_bytes = canonical(index).encode()
            # Batch, then ledger, then the index last: the index is the commit point.
            for stage, key, body, sha, size in (
                    ('batch', batch and batch['key'], batch_path, batch and batch['sha256'], batch and batch['size']),
                    ('ledger', index['ledger']['key'], ledger_path, ledger_sha, ledger_size),
                    ('index', f'{tree.prefix}index-{generation}.json', index_bytes,
                     hashlib.sha256(index_bytes).hexdigest(), len(index_bytes))):
                if key is None:
                    continue
                require(time_left() > 0, 'deadline', stage)
                try:
                    put(key, body, sha, size, time_left)
                except CopyError as error:
                    raise CopyError(error.reason, stage=stage, status=error.status) from None
            state['committed'] = generation
            state['shipped'] = sorted(shipped | {e['id'] for e in entries})
            try:
                save_state(tree, state)
            except OSError:
                raise CopyError('state', stage='state') from None
            if kind == 'final':
                tree.latch.unlink(missing_ok=True)
                sync_directory(tree.state_dir)
            record(log, 'copy.committed', generation=generation, kind=kind, reader=active, files=len(entries),
                   shipped=len(state['shipped']), pending=len(pending))
            return dict(status='committed', generation=generation, kind=kind, shipped=len(entries))
    except CopyError as error:
        record(log, 'copy.failed', 'warn', reason=error.reason, stage=error.stage, status=error.status)
        return dict(status='failed', reason=error.reason, stage=error.stage)
    except (OSError, ValueError, KeyError, TypeError):
        record(log, 'copy.failed', 'warn', reason='state', stage='state')
        return dict(status='failed', reason='state', stage='state')
    finally:
        for path in temporary:
            path.unlink(missing_ok=True)


# --- SigV4 S3 PutObject with instance-role credentials (IMDSv2) ---

def sign(secret, region, method, path, headers, payload_sha256, query='', service='s3'):
    """AWS Signature Version 4 over lower-case `headers`; returns (signature, signed, scope)."""
    names = sorted(headers)
    canonical_headers = ''.join(f'{name}:{" ".join(str(headers[name]).split())}\n' for name in names)
    signed = ';'.join(names)
    request = '\n'.join([method, path, query, canonical_headers, signed, payload_sha256])
    amz_date = headers['x-amz-date']
    scope = f'{amz_date[:8]}/{region}/{service}/aws4_request'
    to_sign = '\n'.join(['AWS4-HMAC-SHA256', amz_date, scope, hashlib.sha256(request.encode()).hexdigest()])
    key = ('AWS4' + secret).encode()
    for part in (amz_date[:8], region, service, 'aws4_request'):
        key = hmac.new(key, part.encode(), hashlib.sha256).digest()
    return hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest(), signed, scope


def https(host, timeout):
    return http.client.HTTPSConnection(host, 443, timeout=timeout, context=ssl.create_default_context())


def metadata_connection(host, timeout):
    return http.client.HTTPConnection(host, 80, timeout=timeout)


def imds_credentials(*, connect=metadata_connection, timeout=2):
    """Instance-role credentials through IMDSv2; never printed or stored."""
    def request(method, path, headers):
        conn = connect('169.254.169.254', timeout)
        try:
            conn.request(method, path, headers=headers)
            response = conn.getresponse()
            body = response.read(65536)
            require(response.status == 200, 'credentials', 'credentials')
            return body.decode()
        finally:
            conn.close()
    try:
        token = request('PUT', '/latest/api/token', {'X-aws-ec2-metadata-token-ttl-seconds': '300'})
        headers = {'X-aws-ec2-metadata-token': token}
        role = request('GET', '/latest/meta-data/iam/security-credentials/', headers).strip().splitlines()[0]
        require(re.fullmatch(r'[\w+=,.@-]{1,128}', role) is not None, 'credentials', 'credentials')
        value = json.loads(request('GET', '/latest/meta-data/iam/security-credentials/' + role, headers))
        require(all(isinstance(value.get(k), str) and value[k] for k in ('AccessKeyId', 'SecretAccessKey', 'Token')),
                'credentials', 'credentials')
        return value
    except (OSError, ValueError, IndexError, http.client.HTTPException):
        raise CopyError('credentials', stage='credentials') from None


class S3Client:
    def __init__(self, bucket, region, credentials, *, connect=https, clock=time.time):
        self.bucket, self.region, self.credentials = bucket, region, credentials
        self.connect, self.clock = connect, clock

    def put(self, key, body, sha256, size, time_left):
        require(re.fullmatch(r'[A-Za-z0-9._/-]{1,1024}', key) is not None, 'put')
        credentials = self.credentials()
        host = f'{self.bucket}.s3.{self.region}.amazonaws.com'
        path = '/' + key
        amz_date = datetime.datetime.fromtimestamp(self.clock(), datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        headers = {'host': host, 'x-amz-content-sha256': sha256, 'x-amz-date': amz_date,
                   'x-amz-security-token': credentials['Token']}
        signature, signed, scope = sign(credentials['SecretAccessKey'], self.region, 'PUT', path, headers, sha256)
        remaining = time_left()
        require(remaining > 0, 'deadline')
        conn = self.connect(host, max(1, min(60, remaining)))
        try:
            conn.putrequest('PUT', path, skip_host=True, skip_accept_encoding=True)
            conn.putheader('Host', host)
            for name in ('x-amz-content-sha256', 'x-amz-date', 'x-amz-security-token'):
                conn.putheader(name, headers[name])
            conn.putheader('Authorization', f'AWS4-HMAC-SHA256 Credential={credentials["AccessKeyId"]}/{scope}, '
                                            f'SignedHeaders={signed}, Signature={signature}')
            conn.putheader('Content-Length', str(size))
            conn.endheaders()
            if isinstance(body, bytes):
                conn.send(body)
            else:
                with open(body, 'rb') as stream:
                    while block := stream.read(1024 ** 2):
                        require(time_left() > 0, 'deadline')
                        conn.send(block)
            response = conn.getresponse()
            response.read(65536)
            if response.status != 200:
                raise CopyError('put', status=response.status)
        except (OSError, http.client.HTTPException):
            raise CopyError('put') from None
        finally:
            conn.close()


def reader_gone(lock):
    """True when the reader ran and no process holds its lock any more.

    paired_read holds an exclusive flock on data/paired/owner.lock for its whole life and its
    children share that open file description, so the lock is free only when all of them have
    exited. A missing file means the reader never started. The probe opens the file read-only
    (never creating it) and releases a shared lock at once.
    """
    try:
        fd = os.open(lock, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return False
    try:
        fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
    except BlockingIOError:
        return False
    else:
        fcntl.flock(fd, fcntl.LOCK_UN)
        return True
    finally:
        os.close(fd)


def systemd_unit_state(unit, lock):
    """(ActiveState, ended): ended is non-empty only when the reader's lock is free.

    Not ExecMainExitTimestamp: systemd unloads a cleanly stopped unit that nothing references,
    after which `systemctl show` reports it like a unit never started (empty timestamps).
    """
    answer = subprocess.run(['/usr/bin/systemctl', 'show', '--property=ActiveState', unit],
                            capture_output=True, text=True, timeout=5, check=False, stdin=subprocess.DEVNULL)
    values = dict(line.partition('=')[::2] for line in answer.stdout.splitlines())
    active = values.get('ActiveState', 'unknown')
    ended = 'lock-free' if active in ('inactive', 'failed') and reader_gone(lock) else ''
    return active, ended


def main(argv=None):
    parser = argparse.ArgumentParser(description='Copy paired evidence to the run state bucket.')
    parser.add_argument('--launch', required=True, type=Path)
    parser.add_argument('--final', action='store_true', help='finalizer: request and wait for a final generation')
    args = parser.parse_args(argv)
    try:
        require(sys.platform == 'linux' and os.geteuid() == 0, 'host', 'host')
        tree = HostTree(args.launch)
        require(args.launch == INSTALL_ROOT / tree.run_id / 'launch.json' and not args.launch.is_symlink(), 'host', 'host')
        info = tree.state_dir.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and info.st_mode & 0o077 == 0, 'host', 'host')
    except (CopyError, OSError, ValueError, KeyError, TypeError):
        record(emit, 'copy.failed', 'warn', reason='host', stage='host')
        return 2
    cached = {}
    def credentials():
        if 'value' not in cached:
            cached['value'] = imds_credentials()
        return cached['value']
    client = S3Client(tree.bucket, REGION, credentials)
    result = run(tree, final=args.final, put=client.put, clock=time.time,
                 unit_state=lambda: systemd_unit_state(tree.reader_unit, tree.paired / 'owner.lock'))
    return 0 if result['status'] in ('committed', 'skipped') else 1


if __name__ == '__main__':
    sys.exit(main())
