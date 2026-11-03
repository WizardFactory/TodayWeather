#!/usr/bin/env python3
"""One bounded latest-forecast campaign; no retained credentials or production changes."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import signal
import statistics
import subprocess
import time
import uuid
from urllib.parse import quote

import kma_cold_measure as common

SERVER2, REPO = common.SERVER2, common.REPO
SOURCES = (
    'server2/examples/kma_response_first_measure.rs',
    'server2/examples/kma_response_first_measure/source.rs',
    'server2/examples/kma_response_first_measure/pending.rs',
    'server2/examples/kma_cold_measure/scope.rs',
    'server2/tools/verification/kma_response_first_measure.py',
    'server2/tools/verification/kma_cold_measure.py',
    'server2/Cargo.lock',
)


def summarize(report):
    profiles = {}
    for name in ('P1_provider_response_first', 'S1_targeted_canonical_restore',
                 'A0_durable_first_control', 'S0_unmodified_native_discovery'):
        rows = [r for r in report.get('http', []) if r['profile'] == name]
        times = [r['result']['elapsed_ms'] for r in rows]
        profiles[name] = dict(
            attempts=len(rows), samples_ms=times,
            full_body_http_200=sum(r['result'].get('status') == 200 and
                                   r['result'].get('full_body_received', False) for r in rows),
            median_ms=statistics.median(times) if times else None,
            min_ms=min(times) if times else None, max_ms=max(times) if times else None,
            p95_ms=None, p99_ms=None,
            history_complete=False, production_qualified=False,
        )
    paired = [r for r in report.get('http', []) if r['profile'] == 'S1_targeted_canonical_restore']
    cases = report.get('cases', [])
    return dict(
        profiles=profiles,
        paired_body_equal=sum(r.get('body_equal_to_provider', False) for r in paired),
        paired_headers_equal=sum(r.get('functional_headers_equal', False) for r in paired),
        paired_attempts=len(paired),
        acquisition_jobs=sum(len(c.get('writer', {}).get('jobs', [])) for c in cases),
        complete_jobs=sum(j.get('complete', False) for c in cases for j in c.get('writer', {}).get('jobs', [])),
        durable_groups=sum(p.get('durable', False) for c in cases for p in c.get('writer', {}).get('publications', [])),
        metrics={k: v for k, v in report.get('metrics', {}).items() if k != 'events'},
        full_seven_day_history='NOT_QUALIFIED',
        measurement_scope='workstation latest-only7 prototype, not deployed runtime or tail qualification',
    )


def run(binary, out):
    binary, out = Path(binary).resolve(), Path(out).resolve()
    if not out.is_relative_to(REPO / 'reports') or out.exists():
        raise ValueError('new output directory below reports/ required')
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise ValueError('retained executable required')
    before = {p: common.digest(REPO / p) for p in SOURCES}
    before['binary'] = common.digest(binary)
    out.mkdir(parents=True)
    for rel in SOURCES:
        target = out / 'source' / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPO / rel, target)
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=REPO, text=True).strip()
    started = datetime.now(timezone.utc).isoformat()
    t = time.monotonic()
    deadline = t + 1800
    credentials = common.aws(['configure', 'export-credentials', '--format', 'process'])
    env = common.child_environment(credentials, common.private_key_list(SERVER2 / '.env'))
    del credentials
    namespace = 'verification/kma-20261024-rf-' + uuid.uuid4().hex[:16] + '/'
    roots = [root + namespace for root in ('raw/v2/', 'index/v2/', 'budgets/v2/')]
    for root in roots:
        existing = common.aws(['s3api', 'list-objects-v2', '--bucket', common.BUCKET,
                               '--prefix', root, '--max-keys', '1', '--output', 'json'])
        if existing.get('Contents') or existing.get('IsTruncated'):
            raise ValueError('exclusive namespace is not empty')
    config = dict(schema=1, bucket=common.BUCKET, region=common.REGION, prefix=namespace,
                  provider_cases=3, request_path='/v000903/kma/addr/' + '/'.join(
                      quote(s, safe='') for s in ('서울특별시', '종로구', '청운효자동')))
    (out / 'config.json').write_text(json.dumps(config, indent=2) + '\n')
    provenance = dict(revision=revision, started=started,
                      artifacts=before, physical_prefixes=roots, preflight_lists=3,
                      limits=dict(provider_wire_upper=256, provider_admissions=64, s3_reads=50000,
                                  writes=5000, conservative_bytes=250*1024*1024, seconds=1800),
                      credential_values_retained=False,
                      test_client_receipt_gate=True, production_remote_receipt_hook=False)
    (out / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    with (out / 'stdout.log').open('w') as stdout, (out / 'stderr.log').open('w') as stderr:
        process = subprocess.Popen([str(binary), str(out / 'config.json'), str(out / 'raw-report.json')],
                                   cwd=SERVER2, env=env, stdout=stdout, stderr=stderr, start_new_session=True)
        del env
        try:
            code = process.wait(timeout=max(0, deadline-time.monotonic()))
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            code = -1
    after = {p: common.digest(REPO / p) for p in SOURCES}
    after['binary'] = common.digest(binary)
    provenance.update(finished=datetime.now(timezone.utc).isoformat(), exit_code=code,
                      elapsed_seconds=time.monotonic()-t, artifacts_unchanged=before == after)
    (out / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    raw = out / 'raw-report.json'
    result = summarize(json.loads(raw.read_text())) if raw.exists() else {'status': 'NO_REPORT'}
    result.update(exit_code=code, artifacts_unchanged=before == after)
    (out / 'summary.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    if code or before != after:
        raise SystemExit(1)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    run(args.binary, args.out)
