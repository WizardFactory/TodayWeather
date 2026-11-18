"""Build deterministic, local-only SR-5b finish rehearsal inputs.

The host and ledger use the existing supervisor fixture. The real copy program
writes the committed evidence generations through an on-disk PUT stand-in.
The returned version records and expected hashes can feed an offline CLI fixture.
"""

import gzip
import hashlib
import json
from pathlib import Path
import shutil
from types import SimpleNamespace
from unittest.mock import patch

from test_shadow_supervisor import EvidenceHost, STOPPED_AT, load_evidence_modules, paired_tool, state


FULL_ATTEMPTS = 11_707
FULL_BODY_BYTES = 85_000
ATTEMPTS_PER_HOUR = 70
COLLECTION_HOURS = 168


class _VersionFiles:
    """Save object versions without retaining entire tar files in memory."""

    def __init__(self, root):
        self.root = root
        self.directory = root / 'objects'
        self.directory.mkdir(mode=0o700)
        self.records = []

    def put(self, bucket, key, body, digest, size):
        version = f'v{len(self.records) + 1:05}'
        path = self.directory / f'{version}.object'
        if isinstance(body, bytes):
            path.write_bytes(body)
        else:
            shutil.copyfile(body, path)
        self.records.append(dict(bucket=bucket, key=key, version=version, kind='object',
                                 path=path.relative_to(self.root).as_posix(), size=size,
                                 sha256=digest))

    def delete_marker(self, bucket, key):
        version = f'v{len(self.records) + 1:05}'
        self.records.append(dict(bucket=bucket, key=key, version=version, kind='delete_marker'))


def _freeze_launch(host, source, epoch):
    # The shared collector fixture writes a wall-clock gzip header. Normalize it
    # and its pin to keep the launch digest stable across fixture generations.
    archive = source / 'collector.tar.gz'
    archive.write_bytes(gzip.compress(gzip.decompress(archive.read_bytes()), mtime=0))
    pin = source / 'collector.json'
    settings = json.loads(pin.read_bytes())
    settings['artifacts']['x86_64']['sha256'] = hashlib.sha256(archive.read_bytes()).hexdigest()
    pin.write_text(state.canonical(settings))
    plan = host.launch['plan']
    for artifact in (archive, pin):
        plan['artifacts'][artifact.name] = hashlib.sha256(artifact.read_bytes()).hexdigest()
    for policy in ('cost_policy', 'paid_policy'):
        plan[policy]['observed_at'] = epoch
    host.launch['epoch'] = epoch
    data = (state.canonical(host.launch) + '\n').encode()
    (host.root / 'launch.json').write_bytes(data)
    (source / 'launch.json').write_bytes(data)
    return hashlib.sha256(data).hexdigest()


def build_fixture(root, *, attempts=FULL_ATTEMPTS, body_bytes=FULL_BODY_BYTES, epoch=1000):
    """Create a fresh host and version store, returning paths relative to root.

    The default workload has 23,414 paired files and approximately 1 GB of body
    data. Use explicit small counts and sizes for smoke checks. Pass a fixed epoch
    aligned with the operator clock when the finish deadline matters.
    """
    copy, _ = load_evidence_modules()
    if not 1 <= attempts <= FULL_ATTEMPTS or not 8 <= body_bytes <= copy.MAX_BODY:
        raise ValueError('fixture count or body size')
    if type(epoch) is not int or epoch < 0:
        raise ValueError('fixture epoch')
    root = Path(root)
    root.mkdir(mode=0o700)
    clock = SimpleNamespace(time=lambda: epoch, monotonic=lambda: 0)
    with patch.object(paired_tool, 'time', clock):
        host = EvidenceHost(root)
    try:
        launch_hash = _freeze_launch(host, root / 'source', epoch)

        tree = copy.HostTree(host.root / 'launch.json')
        objects = _VersionFiles(root)
        expected_pairs = {}

        def upload(key, body, digest, size, _time_left):
            objects.put(tree.bucket, key, body, digest, size)

        # Stage the pairs as the simulated week progresses so the real copy
        # program emits bounded batches and a final ledger snapshot.
        padding = bytes(body_bytes - 8)
        for hour, start in enumerate(range(1, attempts + 1, ATTEMPTS_PER_HOUR), 1):
            end = min(attempts, start + ATTEMPTS_PER_HOUR - 1)
            for attempt in range(start, end + 1):
                body = attempt.to_bytes(8, 'big') + padding
                host.attempt(attempt, body=body)
                for suffix in ('json', 'body'):
                    name = f'{attempt}.{suffix}'
                    digest, size = copy.digest_file(host.paired / name)
                    expected_pairs[name] = dict(sha256=digest, size=size)
            with host.ledger.db:
                host.ledger.db.execute('UPDATE attempts SET started=?+id WHERE id BETWEEN ? AND ?',
                                       (epoch + (hour - 1) * 3600 - start, start, end))
            final = end == attempts
            if final:
                host.ledger.terminal('duration-complete')
            unit = ('inactive', STOPPED_AT) if final else ('active', '')
            now = epoch + (COLLECTION_HOURS if final else hour) * 3600
            result = copy.run(tree, final=final, put=upload, clock=lambda: now,
                              unit_state=lambda: unit, log=lambda _: None)
            expected_kind = 'final' if final else 'ordinary'
            if result.get('kind') != expected_kind or result.get('shipped') != end - start + 1:
                raise RuntimeError(f'fixture copy failed at hour {hour}: {result}')
    finally:
        host.ledger.close()

    original_bucket = f'server2-shadow-{tree.run_id}-raw'
    for key, body in (('fixtures/original', b'first'), ('fixtures/original', b'second'),
                      ('fixtures/empty', b'')):
        objects.put(original_bucket, key, body, hashlib.sha256(body).hexdigest(), len(body))
    objects.delete_marker(original_bucket, 'fixtures/original')
    return dict(run_id=tree.run_id, epoch=epoch, launch_sha256=launch_hash,
                paired_directory=host.paired.relative_to(root).as_posix(),
                state_bucket=tree.bucket, versions=objects.records, expected_pairs=expected_pairs)
