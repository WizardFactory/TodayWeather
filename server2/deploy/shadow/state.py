#!/usr/bin/env python3
"""Offline durable state for bounded shadow supervision; never dispatches AWS.

Only the coordinator writes this journal. Host guards and readers use separate
state. A reservation is consumed before its external effect and never refunded.
An existing directory is never treated as a new run, even after partial creation.
"""
from __future__ import annotations

import argparse
import base64
import datetime
from contextlib import contextmanager
from dataclasses import dataclass
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import stat
import time
from typing import Any


HOST_LIFETIME_SECONDS = 170 * 3600
OPERATOR_READ_ATTEMPTS = 80_000
OPERATOR_WRITE_ATTEMPTS = 10_000
OPERATOR_CLEANUP_ATTEMPTS = 1_000
OPERATOR_EXPORT_BYTES = 4 * 1024**3
OPERATOR_WORK_ENVELOPE_BYTES = 8 * 1024**3
OPERATOR_CLEANUP_ENVELOPE_BYTES = 4 * 1024**3
# The operator reserves this envelope before each finish-finalize SSH call.
FINISH_CONTROL_ENVELOPE_BYTES = 65_536


class StateError(ValueError):
    """Sanitized failure; callers must stop acquisition and retain the journal."""


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def integer(value: Any, maximum: int) -> int:
    if type(value) is not int or not 0 <= value <= maximum:
        raise StateError('invalid bounded integer')
    return value


def label(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,79}', value):
        raise StateError('invalid identifier')
    return value


def sha256(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch('[0-9a-f]{64}', value):
        raise StateError('invalid digest')
    return value


def sync_directory(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _finish_output_identity(destination: Path, token: str, *, created: bool) -> dict:
    """Attest the private directory so a pending request can reconcile its own mkdir."""
    directory = os.open(destination, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(directory)
        if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise StateError('finish output is not the private owned directory')
        identity = dict(device=info.st_dev, inode=info.st_ino)
        expected = canonical(dict(identity, token=token)).encode()
        marker = '.finish-binding'
        if created:
            fd = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o600, dir_fd=directory)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(expected)
                stream.flush()
                os.fsync(stream.fileno())
        fd = os.open(marker, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        with os.fdopen(fd, 'rb') as stream:
            saved = os.fstat(stream.fileno())
            if (not stat.S_ISREG(saved.st_mode) or saved.st_uid != os.geteuid()
                    or stat.S_IMODE(saved.st_mode) != 0o600
                    or stream.read(len(expected) + 1) != expected):
                raise StateError('finish output binding marker mismatch')
        current = destination.lstat()
        if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino):
            raise StateError('finish output directory changed')
        os.fsync(directory)
        sync_directory(destination.parent)
        return identity
    finally:
        os.close(directory)


@dataclass(frozen=True)
class CloudResult:
    kind: str
    operation: str
    payload: Any = None
    code: str | None = None


def decode_cloud(operation: str, returncode: int | None, stdout: str = '',
                 stderr: str = '', *, timed_out: bool = False) -> CloudResult:
    """Decode AWS CLI evidence without retaining stderr, which may contain secrets.

    Exit zero with no output is a distinct success, never proof of absence.
    Authentication, network and malformed-result failures stay distinct from JSON.
    """
    label(operation)
    if timed_out:
        return CloudResult('timeout', operation)
    if returncode != 0:
        match = re.search(r'^(?:aws: \[ERROR\]: )?An error occurred '
                          r'\(([A-Za-z0-9_.-]+)\) when calling the '
                          r'([A-Za-z0-9]+) operation(?: \(reached max retries: [0-9]+\))?:',
                          stderr, re.MULTILINE)
        if match and match[2] == operation:
            return CloudResult('service_error', operation, code=match[1])
        return CloudResult('command_error', operation)
    if not stdout.strip():
        return CloudResult('empty_success', operation)
    try:
        payload = json.loads(stdout, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, TypeError):
        return CloudResult('malformed', operation)
    if not isinstance(payload, dict):
        return CloudResult('malformed', operation)
    return CloudResult('json', operation, payload=payload)


def absence(result: CloudResult, *, name: str | None = None) -> bool:
    """Evidence predicates only; caller must bind command/account/resource identity.

    These predicates do not execute or authorize cleanup. False includes unknown.
    Pagination must have been consumed before calling this function.
    """
    if result.kind == 'service_error':
        return result.operation in {'GetRole', 'GetInstanceProfile'} and result.code == 'NoSuchEntity'
    if result.kind != 'json':
        return False
    p = result.payload
    if any(p.get(k) for k in ('NextToken', 'NextContinuationToken', 'Marker', 'IsTruncated')):
        return False
    if result.operation == 'ListBuckets' and isinstance(name, str) and name:
        buckets = p.get('Buckets')
        return (isinstance(buckets, list)
                and all(isinstance(b, dict) and isinstance(b.get('Name'), str) for b in buckets)
                and all(b['Name'] != name for b in buckets))
    if result.operation in {'DescribeSecurityGroups', 'DescribeVolumes'}:
        field = 'SecurityGroups' if result.operation == 'DescribeSecurityGroups' else 'Volumes'
        return p.get(field) == []
    if result.operation == 'DescribeInstances' and isinstance(name, str) and name:
        reservations = p.get('Reservations')
        if not isinstance(reservations, list) or not all(
                isinstance(r, dict) and isinstance(r.get('Instances'), list) for r in reservations):
            return False
        instances = [i for r in reservations for i in r['Instances']]
        return (len(instances) == 1 and isinstance(instances[0], dict)
                and instances[0].get('InstanceId') == name
                and instances[0].get('State') == {'Code': 48, 'Name': 'terminated'})
    return False


def launch_expiry_units(run_id, epoch):
    """Immutable launch-time safety net, independent of the SSH installation."""
    if type(run_id) is not str or not re.fullmatch('[a-z0-9-]{1,30}',run_id):
        raise StateError('expiry run identity')
    integer(epoch,253400000000)
    deadline=datetime.datetime.fromtimestamp(epoch+HOST_LIFETIME_SECONDS,datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
    name='server2-shadow-'+run_id+'-launch-expiry'
    return {
        name+'.service':('[Unit]\nDescription=Original shadow host expiry\n'
                         '[Service]\nType=oneshot\nExecStart=/usr/bin/systemctl --no-block poweroff\n'),
        name+'.timer':('[Unit]\nDescription=Immutable shadow launch deadline\n'
                       '[Timer]\nOnCalendar='+deadline+'\nAccuracySec=1s\nPersistent=true\n'
                       'Unit='+name+'.service\n[Install]\nWantedBy=timers.target\n')}


def launch_user_data(run_id, epoch):
    """Nonsecret first-boot expiry travels with the sole RunInstances attempt.

    A failed bootstrap powers off; no SSH operator is needed to arm the timer.
    Enabled persistent units keep the original deadline across OS reboots.
    """
    deadline=epoch+HOST_LIFETIME_SECONDS
    lines=['#!/bin/bash','set -euo pipefail',
           "trap '/usr/bin/systemctl --no-block poweroff' ERR",
           f'deadline={deadline}',
           'if [ "$(date +%s)" -ge "$deadline" ]; then /usr/bin/systemctl --no-block poweroff; exit 1; fi']
    for unit,content in launch_expiry_units(run_id,epoch).items():
        lines.append("printf '%s' '"+base64.b64encode(content.encode()).decode()+"' | base64 --decode > /etc/systemd/system/"+unit)
        lines.append('chmod 644 /etc/systemd/system/'+unit)
    timer='server2-shadow-'+run_id+'-launch-expiry.timer'
    lines += ['sync','timeout 20 /usr/bin/systemctl daemon-reload',
              'timeout 20 /usr/bin/systemctl enable --now '+timer,
              '/usr/bin/systemctl is-active --quiet '+timer,
              '/usr/bin/systemctl is-enabled --quiet '+timer]
    return base64.b64encode(('\n'.join(lines)+'\n').encode()).decode()


class Journal:
    """Exclusive coordinator journal; explicit create and resume cannot be confused."""
    # The server's own parse caps (storage/allowance.rs); allocations are sized in SR-6.
    CAPS = {'reads': 1_140_000, 'writes': 900_000, 'put_bytes': 2 * 1024**3}

    def __init__(self, directory: Path, *, create: bool = False,
                 run_id: str | None = None, manifest_sha: str | None = None,
                 epoch: int | None = None):
        self.directory = Path(directory)
        self.lock = None
        self.db = None
        if create:
            label(run_id)
            sha256(manifest_sha)
            integer(epoch, 2**53)
            try:
                self.directory.mkdir(mode=0o700)
            except FileExistsError:
                raise StateError('run directory already exists') from None
            sync_directory(self.directory.parent)
        if self.directory.is_symlink() or not self.directory.is_dir():
            raise StateError('missing or invalid run directory')
        try:
            lock_path = self.directory / 'owner.lock'
            flags = os.O_RDWR | os.O_NOFOLLOW | (os.O_CREAT if create else 0)
            self.lock = os.open(lock_path, flags, 0o600)
            try:
                fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise StateError('coordinator already active') from None
            path = self.directory / 'state.sqlite3'
            if path.is_symlink() or (not create and not path.is_file()):
                raise StateError('missing or invalid existing journal')
            if create:
                fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                os.close(fd)
            self.db = sqlite3.connect(path, isolation_level=None)
            self.db.execute('PRAGMA synchronous=FULL')
            self.db.execute('PRAGMA journal_mode=DELETE')
            if create:
                with self.transaction():
                    self.db.execute('CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK(id=1), run_id TEXT, manifest TEXT, epoch INTEGER, last_seen INTEGER, stop TEXT)')
                    self.db.execute('CREATE TABLE generations (id TEXT PRIMARY KEY, reads INTEGER, writes INTEGER, put_bytes INTEGER)')
                    self.db.execute('CREATE TABLE intents (id TEXT PRIMARY KEY, operation TEXT, params_sha TEXT, token TEXT)')
                    self.db.execute('CREATE TABLE requests (id TEXT PRIMARY KEY REFERENCES intents(id), params TEXT NOT NULL, receipt TEXT)')
                    self.db.execute('CREATE TABLE control (id INTEGER PRIMARY KEY CHECK(id=1), reads INTEGER, writes INTEGER, export_bytes INTEGER)')
                    self.db.execute('INSERT INTO control VALUES (1,0,0,0)')
                    self.db.execute('CREATE TABLE transfer (id INTEGER PRIMARY KEY CHECK(id=1), work INTEGER, cleanup INTEGER)')
                    self.db.execute('INSERT INTO transfer VALUES (1,0,0)')
                    self.db.execute('INSERT INTO meta VALUES (1,?,?,?,?,NULL)', (run_id, manifest_sha, epoch, epoch))
                    self.db.execute('PRAGMA user_version=6')
                sync_directory(self.directory)
            version = self.db.execute('PRAGMA user_version').fetchone()[0]
            if version not in (5, 6) or self.db.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                raise StateError('invalid journal schema or integrity')
            # Existing runs must retain the allowances under their frozen cost policy.
            self.control_caps = (10_000, 10_000, 2 * 1024**3) if version == 5 else (
                OPERATOR_READ_ATTEMPTS, OPERATOR_WRITE_ATTEMPTS, OPERATOR_EXPORT_BYTES)
            self.work_envelope = 4 * 1024**3 if version == 5 else OPERATOR_WORK_ENVELOPE_BYTES
            meta = self.snapshot()
            if ((run_id is not None and run_id != meta['run_id'])
                    or (manifest_sha is not None and manifest_sha != meta['manifest_sha'])):
                raise StateError('run identity mismatch')
        except Exception:
            self.close()
            raise

    @contextmanager
    def transaction(self):
        self.db.execute('BEGIN IMMEDIATE')
        try:
            yield
            self.db.execute('COMMIT')
        except BaseException:
            self.db.execute('ROLLBACK')
            raise

    def snapshot(self) -> dict:
        row = self.db.execute('SELECT run_id,manifest,epoch,last_seen,stop FROM meta WHERE id=1').fetchone()
        if row is None:
            raise StateError('missing run identity')
        run_id, manifest, epoch, seen, stop = row
        label(run_id); sha256(manifest); integer(epoch, 2**53); integer(seen, 2**53)
        spent = dict(zip(self.CAPS, self.db.execute('SELECT COALESCE(SUM(reads),0), COALESCE(SUM(writes),0), COALESCE(SUM(put_bytes),0) FROM generations').fetchone()))
        return {'run_id': run_id, 'manifest_sha': manifest, 'epoch': epoch,
                'collection_until': epoch + 168 * 3600, 'cleanup_until': epoch + HOST_LIFETIME_SECONDS,
                'last_seen': seen, 'stop': stop, 'allocated': spent,
                'generations': self.db.execute('SELECT COUNT(*) FROM generations').fetchone()[0]}

    def observe(self, now: int) -> dict:
        integer(now, 2**53)
        with self.transaction():
            s = self.snapshot()
            reason = s['stop']
            if reason is None:
                if now < s['last_seen']:
                    reason = 'clock_rollback'
                elif now >= s['collection_until']:
                    reason = 'collection_deadline'
            self.db.execute('UPDATE meta SET last_seen=?,stop=? WHERE id=1',
                            (max(now, s['last_seen']), reason))
        return self.snapshot()

    def active(self, now: int) -> dict:
        s = self.observe(now)
        if s['stop'] is not None:
            raise StateError('acquisition stopped: ' + s['stop'])
        return s

    def reserve_generation(self, generation: str, amounts: dict, *, now: int) -> dict:
        label(generation)
        if set(amounts) != set(self.CAPS):
            raise StateError('missing or unknown allocation dimension')
        for key, cap in self.CAPS.items():
            integer(amounts[key], cap)
        self.active(now)
        with self.transaction():
            s = self.snapshot()
            if self.db.execute('SELECT 1 FROM generations WHERE id=?', (generation,)).fetchone():
                raise StateError('generation already consumed; reconcile, never relaunch')
            if s['generations'] >= 3 or any(s['allocated'][k] + amounts[k] > v for k,v in self.CAPS.items()):
                raise StateError('generation allocation exhausted')
            self.db.execute('INSERT INTO generations VALUES (?,?,?,?)',
                            (generation, *(amounts[k] for k in self.CAPS)))
        return self.snapshot()

    def reserve_control(self, *, reads: int = 0, writes: int = 0, export_bytes: int = 0,
                        cleanup: bool = False, response_bytes: int = 0) -> dict:
        """Precharge separate operator/export/cleanup reserve; never refund failures.

        Ordinary work cannot consume the final 1,000 read/write attempts or
        cleanup's separate four-GiB response-envelope allowance. Envelopes are
        conservative accounting reservations, not a wire-level bandwidth cap.
        Cleanup may continue after collection expiry. Exhaustion is an explicit
        incomplete-cleanup condition, not permission to reset the ledger.
        """
        amounts = (reads, writes, export_bytes)
        caps = self.control_caps
        envelope = OPERATOR_CLEANUP_ENVELOPE_BYTES if cleanup else self.work_envelope
        integer(response_bytes, envelope)
        if type(cleanup) is not bool or (cleanup and export_bytes):
            raise StateError('cleanup reserve cannot export bodies')
        for amount, cap in zip(amounts, caps):
            integer(amount, cap)
        with self.transaction():
            row = self.db.execute('SELECT reads,writes,export_bytes FROM control WHERE id=1').fetchone()
            if row is None:
                raise StateError('missing operator allowance')
            values = tuple(a+b for a,b in zip(row, amounts))
            limits = caps if cleanup else (caps[0] - OPERATOR_CLEANUP_ATTEMPTS,
                                           caps[1] - OPERATOR_CLEANUP_ATTEMPTS, caps[2])
            if any(v > cap for v,cap in zip(values,caps)) or any(
                    amount and value > limit for amount,value,limit in zip(amounts,values,limits)):
                raise StateError('operator allowance exhausted')
            transfer=self.db.execute('SELECT work,cleanup FROM transfer WHERE id=1').fetchone()
            if transfer is None:raise StateError('missing transfer allowance')
            dimension=1 if cleanup else 0
            total=transfer[dimension]+response_bytes
            if total > envelope:raise StateError('control response allowance exhausted')
            self.db.execute('UPDATE transfer SET '+('cleanup' if cleanup else 'work')+'=? WHERE id=1',(total,))
            self.db.execute('UPDATE control SET reads=?,writes=?,export_bytes=? WHERE id=1',values)
        return dict(zip(('reads','writes','export_bytes'),values))

    def operator_usage(self) -> dict:
        """Return journaled attempted work and precharged transfer bounds."""
        controls = self.db.execute('SELECT reads,writes,export_bytes FROM control WHERE id=1').fetchone()
        envelopes = self.db.execute('SELECT work,cleanup FROM transfer WHERE id=1').fetchone()
        if controls is None or envelopes is None:
            raise StateError('operator accounting unavailable')
        names = ('reads', 'writes', 'export_bytes', 'work_envelope_bytes', 'cleanup_envelope_bytes')
        return dict(zip(names, controls + envelopes))

    def prepare_mutation(self, intent: str, operation: str, params_sha: str,
                         token: str, *, now: int) -> None:
        label(intent); label(operation); label(token); sha256(params_sha)
        self.active(now)
        with self.transaction():
            if self.db.execute('SELECT 1 FROM intents WHERE id=?', (intent,)).fetchone():
                raise StateError('mutation already prepared; reconcile existing intent')
            self.db.execute('INSERT INTO intents VALUES (?,?,?,?)', (intent, operation, params_sha, token))

    def prepare_request(self, intent: str, operation: str, params: dict,
                        token: str, *, now: int, cleanup: bool = False) -> None:
        """Persist exact nonsecret AWS parameters and intent in one transaction.

        Caller validates the operation-specific request. Credential material and
        host configuration never belong in AWS request parameters/UserData.
        Only the exact nonsecret original-epoch expiry script is permitted.
        An interrupted request is reconciled by identity, never prepared again.
        """
        label(intent); label(operation); label(token)
        if type(params) is not dict:
            raise StateError('request parameters must be an object')
        encoded=canonical(params)
        if len(encoded.encode())>65536 or any(key in params for key in ('SecretAccessKey','SessionToken')):
            raise StateError('unsupported request parameters')
        if 'UserData' in params:
            frozen=self.snapshot()
            if operation!='RunInstances' or params['UserData']!=launch_user_data(frozen['run_id'],frozen['epoch']):
                raise StateError('only nonsecret immutable expiry UserData permitted')
        digest=hashlib.sha256(encoded.encode()).hexdigest()
        if cleanup:
            recovery = operation == 'HostEvidence' and re.fullmatch(r'finish-ssh-[0-9a-f]{40}-[0-9]{1,2}', intent)
            if not recovery and (intent, operation) not in {('host-evidence', 'HostEvidence'),
                                                            ('finish-output', 'BindFinishOutput')}:
                raise StateError('unsupported cleanup request')
            self.observe(now)
        else:self.active(now)
        with self.transaction():
            if self.db.execute('SELECT 1 FROM intents WHERE id=?',(intent,)).fetchone():
                raise StateError('request already prepared; reconcile existing request')
            self.db.execute('INSERT INTO intents VALUES (?,?,?,?)',(intent,operation,digest,token))
            self.db.execute('INSERT INTO requests VALUES (?,?,NULL)',(intent,encoded))

    def request(self, intent: str) -> dict | None:
        recorded=self.mutation(intent)
        if recorded is None:return None
        row=self.db.execute('SELECT params,receipt FROM requests WHERE id=?',(intent,)).fetchone()
        if row is None:
            raise StateError('exact request parameters unavailable')
        if hashlib.sha256(row[0].encode()).hexdigest()!=recorded['params_sha']:
            raise StateError('request parameter integrity mismatch')
        return dict(recorded,params=json.loads(row[0]),receipt=json.loads(row[1]) if row[1] is not None else None)

    def record_receipt(self, intent: str, result: CloudResult) -> None:
        """Retain the actual typed acknowledgement once, including uncertainty.

        No overwriting failure with later success. Reconciliation evidence gets
        its own separately named request/receipt. Raw stderr is never retained.
        """
        require_kinds={'json','empty_success','service_error','command_error','timeout','malformed'}
        recorded=self.request(intent)
        if (recorded is None or recorded['receipt'] is not None or not isinstance(result,CloudResult)
                or recorded['operation']!=result.operation or result.kind not in require_kinds):
            raise StateError('receipt identity or state mismatch')
        if result.code is not None:label(result.code)
        if result.kind=='json' and type(result.payload) is not dict:
            raise StateError('receipt payload shape')
        payload=result.payload if result.kind=='json' else None
        encoded=canonical(dict(kind=result.kind,operation=result.operation,payload=payload,code=result.code))
        if len(encoded.encode())>8*1024**2:raise StateError('receipt size')
        with self.transaction():
            changed=self.db.execute('UPDATE requests SET receipt=? WHERE id=? AND receipt IS NULL',(encoded,intent)).rowcount
            if changed!=1:raise StateError('receipt already retained')

    def bind_finish_destination(self, destination: Path, *, now: int) -> Path:
        """Reserve one private output for the original journal and host install.

        The request survives a missing directory and the marker recovers an
        interruption before the receipt. An unmarked directory is ambiguous
        after mkdir, so it is preserved and refused.
        """
        destination = Path(destination)
        if not destination.name or destination.name == '..':
            raise StateError('finish output must name a directory')
        try:
            destination = destination.parent.resolve(strict=True) / destination.name
        except (OSError, RuntimeError):
            raise StateError('finish output parent unavailable') from None
        run = self.snapshot()
        install = self.request('host-install')
        if install is not None and (install['operation'] != 'HostInstall'
                                    or not isinstance(install['params'], dict)):
            raise StateError('finish output host install binding')
        launch = None if install is None else sha256(install['params'].get('launch_sha256'))
        params = dict(destination=str(destination), run_id=run['run_id'],
                      manifest_sha=run['manifest_sha'], epoch=run['epoch'], launch_sha256=launch)
        key, operation = 'finish-output', 'BindFinishOutput'
        request = self.request(key)
        if request is None:
            if os.path.lexists(destination):
                raise StateError('finish output already exists')
            token = secrets.token_hex(16)
            self.prepare_request(key, operation, params, token, now=now, cleanup=True)
            receipt = None
        else:
            if request['operation'] != operation or request['params'] != params:
                raise StateError('finish output request changed')
            token, receipt = request['token'], request['receipt']
        try:
            created = receipt is None and not os.path.lexists(destination)
            if created:
                destination.mkdir(mode=0o700)
            identity = _finish_output_identity(destination, token, created=created)
        except OSError:
            raise StateError('finish output unavailable or unbound') from None
        if receipt is None:
            self.record_receipt(key, CloudResult('json', operation, identity))
        elif (receipt['kind'] != 'json' or receipt['operation'] != operation
              or receipt['payload'] != identity):
            raise StateError('finish output receipt mismatch')
        return destination

    def record_cleanup_ownership(self, params_sha: str, instance_id: str, *, resources: dict | None = None) -> None:
        """Bind proven existing ownership even after collection expiry.

        This records metadata only; it cannot allocate a generation, prepare a
        launch, change the original epoch or clear a stop. Caller proves ownership.
        """
        sha256(params_sha);label(instance_id)
        encoded=canonical(resources) if resources is not None else None
        if encoded is not None and hashlib.sha256(encoded.encode()).hexdigest()!=params_sha:
            raise StateError('ownership resource digest mismatch')
        with self.transaction():
            old=self.db.execute("SELECT operation,params_sha,token FROM intents WHERE id='owned-resources'").fetchone()
            expected=('BindResources',params_sha,instance_id)
            if old is not None:
                if old!=expected:raise StateError('cleanup ownership changed')
            else:self.db.execute('INSERT INTO intents VALUES (?,?,?,?)',('owned-resources',*expected))
            if encoded is not None:
                stored=self.db.execute("SELECT params FROM requests WHERE id='owned-resources'").fetchone()
                if stored is not None and stored[0]!=encoded:raise StateError('ownership resources changed')
                if stored is None:
                    self.db.execute('INSERT INTO requests VALUES (?,?,NULL)',('owned-resources',encoded))

    def mutation(self, intent: str) -> dict | None:
        label(intent)
        row = self.db.execute('SELECT operation,params_sha,token FROM intents WHERE id=?', (intent,)).fetchone()
        return dict(zip(('operation','params_sha','token'),row)) if row else None

    def close(self):
        if self.db is not None:
            self.db.close(); self.db = None
        if self.lock is not None:
            os.close(self.lock); self.lock = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


# Log object PUTs of the host's collector (LP-6, #2983): five sources (server, guard,
# reader, collector and, since SR-5a, the evidence copy), one object per 50 s each,
# through 170 hours: 61,200. Their storage and export fall inside the 20 GB storage
# and the applicable operator export allowance.
LOG_SOURCES=5
LOG_WRITES=65_000
# Evidence copy PUTs (SR-5a, #3003): contract, batch, ledger and index per generation,
# for the install copy and each started hour. Accrual books up to four generations
# per finalizer start (reader stop, 168-hour stop and finish). The reserve also
# budgets possible operator retry starts.
COPY_OBJECTS=4
COPY_FINALIZE_STARTS=3
COPY_FINALIZE_GENERATIONS=4
PRICE_KEYS={'ec2_hour','ipv4_hour','gp3_gb_month','s3_gb_month','s3_read',
            's3_write','cpu_vcpu_hour','outbound_gb'}

# Must match budget/qualification.rs. Units are the existing runtime budget
# units, not necessarily HTTP requests (e.g. Visual Crossing query cost).
PAID_PROVIDERS=('visual_crossing','google_geocode','google_air','openweather')
GENERATIONS=('initial','restart-1','restart-2')


def validate_paid_policy(policy,epoch,*,budget=None):
    """Price all three immutable grants up front, without shared free credits. The
    total must fit the money the cost ceiling leaves (`budget`, SR-4).

    A null tariff disables the provider. The prelaunch audit must bind each
    nonnull USD/runtime-unit rate to the retained official/account tariff and
    its actual API product. A digest is provenance, not automatic price discovery.
    """
    from decimal import Decimal
    if type(policy) is not dict or set(policy)!={'schema','observed_at','prices_sha256','usd_per_unit','grants'}:
        raise StateError('paid policy fields')
    if type(policy['schema']) is not int or policy['schema']!=1:raise StateError('paid policy schema')
    sha256(policy['prices_sha256']);integer(epoch,2**53);integer(policy['observed_at'],2**53)
    if not 0<=epoch-policy['observed_at']<=7*24*3600:raise StateError('paid price snapshot freshness')
    rates=policy['usd_per_unit'];grants=policy['grants']
    if type(rates) is not dict or set(rates)!=set(PAID_PROVIDERS):raise StateError('paid provider prices')
    if type(grants) is not dict or set(grants)!=set(GENERATIONS):raise StateError('paid generation grants')
    total=Decimal(0)
    for name in PAID_PROVIDERS:
        price=rates[name]
        if price is not None and (type(price) is not str or len(price)>24
                or not re.fullmatch(r'[0-9]+(?:\.[0-9]+)?',price) or not 0<Decimal(price)<=1000):
            raise StateError('invalid paid price')
        for generation in GENERATIONS:
            grant=grants[generation]
            if type(grant) is not dict or set(grant)!=set(PAID_PROVIDERS):raise StateError('paid grant fields')
            units=integer(grant[name],1_000_000)
            if price is None and units:raise StateError('unpriced provider enabled')
            if price is not None:total+=Decimal(price)*units
    if budget is not None and total>budget:raise StateError('paid provider budget exhausted')
    return str(total)


COST_FIELDS={'schema','observed_at','prices_sha256','rates','ceiling_usd','prior_spend_usd','finish_reserve_usd'}


def _usd(value,low,high,what):
    from decimal import Decimal
    if (type(value) is not str or len(value)>24 or not re.fullmatch('[0-9]+(?:\\.[0-9]+)?',value)
            or not low<=Decimal(value)<=high):raise StateError(what)
    return Decimal(value)


def _hourly(rates):
    """Instance, IPv4, 32 GB gp3 and 20 GB S3 storage per hour. A 28-day billing month
    and decimal GB conversions deliberately overestimate the monthly allocation."""
    from decimal import Decimal
    gib=Decimal(1024**3)/Decimal(10**9)
    return rates['ec2_hour']+rates['ipv4_hour']+(32*rates['gp3_gb_month']+20*rates['s3_gb_month'])*gib/672


def finish_reserve_floor(rates):
    """Schema-2 minimum for a configured reserve. The estimate prices the remaining tail."""
    from decimal import Decimal

    rates = {key: Decimal(value) for key, value in rates.items()}
    export = Decimal(OPERATOR_EXPORT_BYTES) / 10**9 * rates['outbound_gb']
    return export + (OPERATOR_READ_ATTEMPTS - OPERATOR_CLEANUP_ATTEMPTS) * rates['s3_read'] + 2 * _hourly(rates)


def _background_puts(elapsed):
    log_puts = LOG_SOURCES * ((elapsed + 49) // 50)
    if not elapsed:
        return log_puts
    return log_puts + COPY_OBJECTS * (1 + (elapsed + 3599) // 3600
                                     + COPY_FINALIZE_STARTS * COPY_FINALIZE_GENERATIONS)


def _required_finish_reserve(rates, elapsed, background_puts):
    """Price known host holding, bounded operator work and unaccrued background PUTs."""
    from decimal import Decimal

    operator_bytes = OPERATOR_EXPORT_BYTES + OPERATOR_WORK_ENVELOPE_BYTES + OPERATOR_CLEANUP_ENVELOPE_BYTES
    operator = (OPERATOR_READ_ATTEMPTS * rates['s3_read'] + OPERATOR_WRITE_ATTEMPTS * rates['s3_write']
                + Decimal(operator_bytes) / 10**9 * rates['outbound_gb'])
    remaining = max(0, HOST_LIFETIME_SECONDS - elapsed)
    if not remaining:
        return operator
    # Two starts come from the host timer and reader stop. The remaining starts
    # are operator calls backed by the cleanup envelope. Credit starts accrued
    # above, including the first operator start.
    starts = 2 + OPERATOR_CLEANUP_ENVELOPE_BYTES // FINISH_CONTROL_ENVELOPE_BYTES
    puts_at_deadline = (_background_puts(HOST_LIFETIME_SECONDS)
                        + COPY_OBJECTS * (starts - COPY_FINALIZE_STARTS) * COPY_FINALIZE_GENERATIONS)
    remaining_puts = puts_at_deadline - background_puts
    return (operator + Decimal(remaining) / 3600 * _hourly(rates)
            + remaining_puts * rates['s3_write'])


def validate_cost_policy(policy,epoch):
    """Frozen, externally verified USD tariffs and one cumulative ceiling (SR-4).

    Never invent a missing price. The ceiling covers the whole qualification: the
    recorded spend of earlier attempts plus this run's measured estimate plus the
    finish reserve must stay below it.
    """
    from decimal import Decimal
    if type(policy) is not dict or set(policy)!=COST_FIELDS:
        raise StateError('cost policy fields')
    if type(policy['schema']) is not int or policy['schema']!=2:raise StateError('cost schema')
    sha256(policy['prices_sha256']);integer(epoch,2**53);integer(policy['observed_at'],2**53)
    if not 0<=epoch-policy['observed_at']<=7*24*3600:raise StateError('price snapshot freshness')
    rates=policy['rates']
    if type(rates) is not dict or set(rates)!=PRICE_KEYS:raise StateError('missing price dimension')
    for price in rates.values():_usd(price,Decimal('0.000000001'),Decimal(1000),'invalid price')
    rates={key:Decimal(value) for key,value in rates.items()}
    ceiling=_usd(policy['ceiling_usd'],Decimal(1),Decimal(1000),'invalid ceiling')
    prior=_usd(policy['prior_spend_usd'],Decimal(0),Decimal(1000),'invalid prior spend')
    reserve=_usd(policy['finish_reserve_usd'],Decimal(0),Decimal(1000),'invalid finish reserve')
    if reserve<finish_reserve_floor(policy['rates']):raise StateError('finish reserve below its floor')
    if prior+reserve>=ceiling:raise StateError('cost ceiling exhausted')
    return dict(rates,ceiling=ceiling,prior=prior,reserve=reserve)


def estimate_cost(policy,epoch,now,*,cpu_seconds,s3_reads=0,s3_writes=0,tx_bytes=0,paid_usd='0'):
    """Accrued estimate from measured counters against the cumulative ceiling (SR-4).

    accrued = prior spend + elapsed hours x hourly (instance, IPv4, storage)
            + host nonidle CPU seconds x vCPU-hour price + S3 reads/writes actually
            used + bytes transmitted since the origin x outbound price + an upper bound
            of log object PUTs (five sources, one object per 50 s each) and of evidence
            copy PUTs (four objects per generation from install and each started hour,
            up to four generations for each of three finalizer starts) at the write
            price + paid provider units actually admitted x
            their price.
    The finish reserve is the greater of the configured reserve and the modeled
    remaining host, operator and background costs. The estimate stops when
    accrual reaches the unreserved ceiling. It is distinct from AWS billing.
    Unobserved CPU, host egress and indefinitely retained storage are outside
    the modeled tail.
    """
    from decimal import Decimal, ROUND_CEILING
    p=validate_cost_policy(policy,epoch)
    integer(now,2**53);integer(cpu_seconds,2**53)
    for value in (s3_reads,s3_writes,tx_bytes):integer(value,2**53)
    paid=_usd(paid_usd,Decimal(0),Decimal(1000),'invalid paid spend')
    if now<epoch:raise StateError('cost clock rollback')
    elapsed=now-epoch
    background_puts = _background_puts(elapsed)
    accrued=(p['prior']+Decimal(elapsed)/3600*_hourly(p)+Decimal(cpu_seconds)/3600*p['cpu_vcpu_hour']
             +s3_reads*p['s3_read']+(s3_writes+background_puts)*p['s3_write']
             +Decimal(tx_bytes)/Decimal(10**9)*p['outbound_gb']+paid)
    reserve = max(p['reserve'], _required_finish_reserve(p, elapsed, background_puts))
    limit = max(Decimal(0), p['ceiling'] - reserve)
    return dict(accrued_usd=str(accrued.quantize(Decimal('.000001'),rounding=ROUND_CEILING)),
                limit_usd=format(limit, 'f'),stop='cost_ceiling' if accrued>=limit else None)


def main() -> int:
    parser = argparse.ArgumentParser(description='Offline shadow journal; does not provision or call AWS.')
    parser.add_argument('action', choices=['init', 'inspect'])
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--run-id')
    parser.add_argument('--manifest-sha')
    args = parser.parse_args()
    try:
        with Journal(args.state, create=args.action == 'init', run_id=args.run_id,
                     manifest_sha=args.manifest_sha,
                     epoch=int(time.time()) if args.action == 'init' else None) as journal:
            print(canonical(journal.snapshot()))
        return 0
    except (StateError, OSError, sqlite3.Error, TypeError):
        print(canonical({'error':'journal rejected; no external action performed'}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
