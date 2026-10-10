"""Lossy allowlisted bootstrap evidence, never raw logs or arbitrary messages.

Only the final bounded sample is hashed/classified. All sampled lines are withheld,
including classified lines. Missing/unsafe files are explicitly unavailable.
This module is sent in the existing SSM command, NOT in EC2 user-data.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat

PRIVATE = '/opt/server2-s09/private'
LIMIT = 8192
PREFIX = 'S09_BOOTSTRAP_DIAGNOSTICS_V1 '
STAGES = ('guard', 'controller_start', 'apt_sources', 'apt_update', 'apt_install', 'rustup_download',
          'rustup_install', 'target_install', 'source_checkout', 'source_verify',
          'cargo_build', 'binary_verify', 'complete')
LOGS = ('bootstrap.log', 'host-build.log')
EXCEPTIONS = ('AssertionError', 'FileNotFoundError', 'PermissionError', 'ValueError',
              'RuntimeError', 'OSError', 'ModuleNotFoundError', 'TimeoutError')
ERRORS = {'apt_fetch_failed': 'E: Failed to fetch ',
          'apt_package_missing': 'E: Unable to locate package ',
          'apt_lock_failed': 'E: Could not get lock ',
          'disk_full': 'No space left on device',
          'certificate_failed': 'certificate verification failed'}


def sample(name, maximum):
    """Bounded regular-file tail read; reject symlinks at every path component."""
    directory = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in Path(PRIVATE).parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode):
                raise ValueError('not regular')
            os.lseek(fd, max(0, info.st_size-maximum), os.SEEK_SET)
            return os.read(fd, maximum), info.st_size > maximum
        finally:
            os.close(fd)
    finally:
        os.close(directory)


def collect():
    result = {'schema': 1, 'status': 'available', 'stage': 'unavailable', 'logs': {}}
    try:
        raw, truncated = sample('bootstrap-stage', 64)
        stage = raw.decode('ascii').strip()
        if not truncated and stage in STAGES:
            result['stage'] = stage
    except (OSError, ValueError):
        pass
    for name in LOGS:
        try:
            raw, truncated = sample(name, LIMIT)
            text = raw.decode('utf-8', errors='replace')
            signals = {kind for kind in EXCEPTIONS if re.search(r'\b'+kind+r'\b', text)}
            signals.update('curl:'+str(int(code)) for code in re.findall(r'curl: \(([1-9][0-9]?)\)', text))
            signals.update('rust:E'+code for code in re.findall(r'error\[E([0-9]{4})\]', text))
            signals.update('rust:E'+code for code in re.findall(r'"code"\s*:\s*"E([0-9]{4})"', text))
            signals.update(kind for kind, pattern in ERRORS.items() if pattern in text)
            result['logs'][name] = {'status': 'sampled', 'sample_bytes': len(raw),
                'sample_sha256': hashlib.sha256(raw).hexdigest(), 'truncated': truncated,
                'withheld_lines': len(raw.splitlines()), 'signals': sorted(signals)[:16]}
        except (OSError, ValueError):
            result['logs'][name] = {'status': 'unavailable'}
    return result


def decode(output):
    """Untrusted SSM payload: exact schemas, finite strings, bounded numbers."""
    unavailable = {'status': 'unavailable'}
    try:
        if not isinstance(output, str) or len(output) > 4096 or len(output.encode()) > 4096:
            return unavailable
        lines = output.splitlines()
        if len(lines) != 1 or not lines[0].startswith(PREFIX):
            return unavailable
        def pairs(items):
            row = {}
            for key, value in items:
                if key in row: raise ValueError('duplicate')
                row[key] = value
            return row
        data = json.loads(lines[0][len(PREFIX):], object_pairs_hook=pairs)
        if not isinstance(data, dict) or set(data) != {'schema', 'status', 'stage', 'logs'}:
            return unavailable
        if type(data['schema']) is not int or data['schema'] != 1 or data['status'] != 'available' or data['stage'] not in (*STAGES, 'unavailable'):
            return unavailable
        if not isinstance(data['logs'], dict) or set(data['logs']) != set(LOGS):
            return unavailable
        for row in data['logs'].values():
            if row == unavailable: continue
            if not isinstance(row, dict) or set(row) != {'status', 'sample_bytes', 'sample_sha256', 'truncated', 'withheld_lines', 'signals'}:
                return unavailable
            if row['status'] != 'sampled' or type(row['truncated']) is not bool:
                return unavailable
            if any(type(row[k]) is not int or not 0 <= row[k] <= LIMIT for k in ('sample_bytes', 'withheld_lines')):
                return unavailable
            if not isinstance(row['sample_sha256'], str) or not re.fullmatch('[a-f0-9]{64}', row['sample_sha256']):
                return unavailable
            if not isinstance(row['signals'], list) or len(row['signals']) > 16:
                return unavailable
            for signal in row['signals']:
                if not isinstance(signal, str) or (signal not in EXCEPTIONS and signal not in ERRORS and not re.fullmatch(r'curl:[1-9][0-9]?|rust:E[0-9]{4}', signal)):
                    return unavailable
        return data
    except (ValueError, TypeError, KeyError, UnicodeError, RecursionError):
        return unavailable


if __name__ == '__main__':
    print(PREFIX + json.dumps(collect(), sort_keys=True, separators=(',', ':')))
