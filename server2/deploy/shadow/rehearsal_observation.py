"""Read the rehearsal VM's guard, resident memory and local S3 accounting."""

from dataclasses import replace
import json
import os
from pathlib import Path
import re

import guard
from rehearsal_measurement import guard_sample


_READS = {'GetObject', 'HeadObject', 'HeadBucket', 'ListObjects'}
_WRITES = {'PutObject', 'DeleteObject', 'PostObject'}
_BASE_COUNTS = ('reads', 'writes', 'put_bytes')
_AREAS = ('standin', 'raw', 'copy', 'log', 'state_other')
_COUNTS = tuple(f'{area}_s3_{count}' for area in _AREAS for count in _BASE_COUNTS)
_MAX_LINE = 64 * 1024


def resident_bytes(status):
    fields = [line for line in status.splitlines() if line.startswith('VmRSS:')]
    match = re.fullmatch(r'VmRSS:[ \t]+([0-9]{1,15}) kB', fields[0]) if len(fields) == 1 else None
    if match is None:
        raise ValueError('invalid candidate resident memory')
    return int(match[1]) * 1024


class OperationCounts:
    """Advance across complete records from one local stand-in process."""

    def __init__(self, path, *, state_bucket):
        if not re.fullmatch(r'server2-shadow-[a-z0-9-]{1,40}-state', state_bucket):
            raise ValueError('invalid rehearsal state bucket')
        self.path = Path(path)
        self.state_bucket = state_bucket
        self.buckets = {state_bucket, state_bucket.removesuffix('-state') + '-raw'}
        self.identity = None
        self.offset = 0
        self.totals = dict.fromkeys(_COUNTS, 0)

    def read(self):
        totals = self.totals.copy()
        offset = self.offset
        with self.path.open('rb') as stream:
            info = os.fstat(stream.fileno())
            identity = (info.st_dev, info.st_ino)
            if self.identity not in (None, identity) or info.st_size < offset:
                raise ValueError('stand-in operation stream changed')
            stream.seek(offset)
            while offset < info.st_size:
                line = stream.readline(min(_MAX_LINE + 1, info.st_size - offset))
                if len(line) > _MAX_LINE:
                    raise ValueError('oversized stand-in operation')
                if not line.endswith(b'\n'):
                    break
                self._count(line, totals)
                offset += len(line)
        self.identity, self.offset, self.totals = identity, offset, totals
        return totals.copy()

    def _count(self, line, totals):
        try:
            entry = json.loads(line)
            if (type(entry) is not dict or type(entry.get('service')) is not str
                    or type(entry.get('action')) is not str):
                raise ValueError
        except (ValueError, UnicodeError):
            raise ValueError('invalid stand-in operation') from None
        bucket = entry.get('bucket')
        if entry['service'] != 's3' or type(bucket) is not str or bucket not in self.buckets:
            return
        action = entry['action']
        key = entry.get('key')
        if type(key) is not str:
            raise ValueError('invalid stand-in key')
        area = 'state_other'
        if bucket != self.state_bucket:
            area = 'raw'
        elif key.startswith('logs/server2/'):
            area = 'log'
        elif key.startswith('evidence/'):
            area = 'copy'
        if action in _READS | _WRITES:
            count = 'reads' if action in _READS else 'writes'
            totals[f'standin_s3_{count}'] += 1
            totals[f'{area}_s3_{count}'] += 1
        if action == 'PutObject':
            size = entry.get('body_bytes')
            if not guard.integer(size):
                raise ValueError('invalid stand-in object accounting')
            totals['standin_s3_put_bytes'] += size
            totals[f'{area}_s3_put_bytes'] += size


class ObserveHost:
    def __init__(self, manifest, operations):
        self.manifest = guard.validate(manifest)
        self.operations = operations

    def __call__(self, slot, elapsed):
        try:
            observation = guard.collect(self.manifest)
            for key in ('pid', 'start_ticks', 'boot_id', 'binary_sha256', 'environment_sha256',
                        'config_sha256', 'config_directory', 'cgroup'):
                if observation.get(key) != self.manifest[key]:
                    raise ValueError('candidate binding changed')
            pid = self.manifest['pid']
            rss = resident_bytes((Path('/proc') / str(pid) / 'status').read_text())
            sample = guard_sample(observation, self.manifest['allowance'], scheduled=slot, elapsed=elapsed)
            return replace(sample, counters=sample.counters | self.operations.read(),
                           gauges=sample.gauges | {'candidate_rss_bytes': rss})
        except (guard.GuardError, OSError, ValueError, KeyError):
            raise ValueError('host measurement unavailable') from None
