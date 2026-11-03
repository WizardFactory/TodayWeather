#!/usr/bin/env python3
"""Run the bounded, task-owned direct-S3/KMA pilot without retaining credentials."""
import argparse
from datetime import datetime, timezone, timedelta
import hashlib
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import time
import uuid
from urllib.parse import quote

SERVER2 = Path(__file__).resolve().parents[2]
REPO = SERVER2.parent
PROFILE = '141248341265'
BUCKET = 'tw-server2-141248341265-apne2'
REGION = 'ap-northeast-2'


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def private_key_list(path):
    for line in Path(path).read_text().splitlines():
        match = re.match(r'(?:export\s+)?DONGNAE_SECRET_KEYS\s*=\s*(.*)', line)
        if match:
            value = match[1].strip()
            if value[:1] in ('"', "'") and value[-1:] == value[:1]:
                value = value[1:-1]
            if value:
                return value
    raise ValueError('DONGNAE_SECRET_KEYS unavailable')


def child_environment(credentials, keys):
    required = ('AccessKeyId', 'SecretAccessKey')
    if any(not isinstance(credentials.get(k), str) or not credentials[k] for k in required):
        raise ValueError('AWS credential process returned incomplete fields')
    expiration = credentials.get('Expiration')
    if expiration and datetime.fromisoformat(expiration.replace('Z', '+00:00')) < datetime.now(timezone.utc) + timedelta(minutes=35):
        raise ValueError('AWS credential lifetime below bounded campaign')
    env = {k: v for k, v in os.environ.items() if k in ('PATH', 'TMPDIR', 'LANG', 'LC_ALL')}
    env.update(KMA_MEASURE_AWS_KEY=credentials['AccessKeyId'],
               KMA_MEASURE_AWS_SECRET=credentials['SecretAccessKey'], DONGNAE_SECRET_KEYS=keys)
    if credentials.get('SessionToken'):
        env['KMA_MEASURE_AWS_TOKEN'] = credentials['SessionToken']
    return env


def aws(arguments):
    env = dict(os.environ, AWS_MAX_ATTEMPTS='1', AWS_RETRY_MODE='standard', AWS_PAGER='')
    result = subprocess.run(['aws', '--profile', PROFILE, '--region', REGION, *arguments],
                            capture_output=True, text=True, timeout=30, env=env)
    if result.returncode:
        # CLI diagnostics are not copied: credential subprocess stdout is secret.
        raise RuntimeError('AWS prerequisite command failed')
    return json.loads(result.stdout)


def quantiles(samples):
    ordered = sorted(samples)
    return {f'p{p}': ordered[max(0, math.ceil(p / 100 * len(ordered)) - 1)]
            if ordered else None for p in (50, 95, 99)}


def summarize(report):
    phases = {}
    for phase in ('fresh_source_no_disk', 'same_source_no_disk'):
        samples = [r for r in report.get('http', []) if r['phase'] == phase]
        good = [r for r in samples if r['result'].get('status') == 200]
        phases[phase] = dict(
            attempts=len(samples), http_200=len(good), other=len(samples)-len(good),
            all_http_attempt_ms=quantiles([r['elapsed_ms'] for r in samples]),
            http_200_ms=quantiles([r['elapsed_ms'] for r in good]),
            history_complete=0, history_completion_percentiles=None,
            forecast_client_completeness='NOT_QUALIFIED',
            actual_source_reuse_attempts=sum(r.get('trial',0)>0 for r in samples) if phase=='same_source_no_disk' else 0,
            source_reuse_only_ms=quantiles([r['elapsed_ms'] for r in samples if r.get('trial',0)>0]) if phase=='same_source_no_disk' else None,
            percentile_scope='nearest-rank empirical pilot; underpowered for production p95/p99')
    return dict(phases=phases, acquisitions={r['id']: {k: r.get(k) for k in
                ('outcome', 'elapsed_ms', 'acquire_ms', 'publish_ms', 'coverage', 'error')}
                for r in report.get('acquisitions', [])},
                capture_ms=report.get('capture_ms'), admitted=report.get('metrics', {}).get('admitted'),
                conservative_bytes=report.get('metrics', {}).get('conservative_body_and_header_bytes'),
                denied=report.get('metrics', {}).get('denied'),
                deployed_ec2=False, full_empty_s3_client_history_qualified=False)


def run(binary, out, samples, restore_parent=None):
    binary = Path(binary).resolve()
    out = Path(out).resolve()
    if not out.is_relative_to(REPO / 'reports') or out.exists():
        raise ValueError('new task output below reports/ required')
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise ValueError('existing executable required')
    if not 1 <= samples <= 100:
        raise ValueError('samples 1..100')
    out.mkdir(parents=True)
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=REPO, text=True).strip()
    source = [SERVER2 / 'examples/kma_cold_measure.rs',
              SERVER2 / 'examples/kma_cold_measure/scope.rs', Path(__file__), SERVER2 / 'Cargo.lock']
    before = {str(p.relative_to(REPO)): digest(p) for p in source}
    before['binary'] = digest(binary)
    credentials = aws(['configure', 'export-credentials', '--format', 'process'])
    env = child_environment(credentials, private_key_list(SERVER2 / '.env'))
    del credentials
    parent=None
    if restore_parent:
        restore_parent=Path(restore_parent).resolve()
        if not restore_parent.is_relative_to(REPO/'reports'):
            raise ValueError('owned parent report required')
        parent=json.loads(restore_parent.read_text())
    namespace = parent['prefix'] if parent else 'verification/kma-20261024-' + uuid.uuid4().hex[:16] + '/'
    roots = ['raw/v2/' + namespace, 'index/v2/' + namespace, 'budgets/v2/' + namespace]
    for prefix in roots:
        if parent:break
        existing = aws(['s3api', 'list-objects-v2', '--bucket', BUCKET, '--prefix', prefix,
                        '--max-keys', '1', '--output', 'json'])
        if existing.get('Contents') or existing.get('IsTruncated'):
            raise ValueError('measurement namespace not empty')
    config = dict(schema=1, bucket=BUCKET, region=REGION, prefix=namespace,
                  http_samples=samples,
                  request_path='/v000903/kma/addr/' + '/'.join(quote(s, safe='') for s in
                       ('서울특별시', '종로구', '청운효자동')))
    if parent:
        prior=json.loads(restore_parent.with_name('provenance.json').read_text())
        if not prior.get('artifacts_unchanged') or parent['metrics'].get('inflight_reserved_bytes')!=0:
            raise ValueError('stable settled parent required')
        deadline=datetime.fromisoformat(prior['started'])+timedelta(minutes=30)
        if deadline<=datetime.now(timezone.utc):raise ValueError('original campaign expired')
        config.update(restore_parent=str(restore_parent),parent_sha256=digest(restore_parent),campaign_deadline_ms=int(deadline.timestamp()*1000))
    (out / 'config.json').write_text(json.dumps(config, indent=2) + '\n')
    provenance = dict(revision=revision, artifacts=before, physical_prefixes=roots,
                      empty_prefix_preflight_lists=0 if parent else 3, sdk_retries=0,
                      read_only_continuation=bool(parent),parent_report_sha256=digest(restore_parent) if parent else None,
                      started=datetime.now(timezone.utc).isoformat(),
                      limits=dict(provider=256, s3_reads=50000, s3_writes=5000,
                                  application_body_bytes=250*1024*1024, wall_seconds=1800),
                      credential_values_retained=False)
    (out / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    started = time.monotonic()
    with (out / 'stdout.log').open('w') as stdout, (out / 'stderr.log').open('w') as stderr:
        process = subprocess.Popen([str(binary), str(out / 'config.json'), str(out / 'raw-report.json')],
                                   cwd=SERVER2, env=env, stdout=stdout, stderr=stderr, start_new_session=True)
        del env
        try:
            result = process.wait(timeout=1800)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            result = -1
    after = {str(p.relative_to(REPO)): digest(p) for p in source}
    after['binary'] = digest(binary)
    provenance.update(exit_code=result, elapsed_seconds=time.monotonic()-started,
                      artifacts_unchanged=before == after,
                      finished=datetime.now(timezone.utc).isoformat())
    (out / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    raw = out / 'raw-report.json'
    summary = summarize(json.loads(raw.read_text())) if raw.exists() else {'status': 'NO_REPORT'}
    summary['run_exit_code'] = result
    summary['artifacts_unchanged'] = before == after
    (out / 'summary.json').write_text(json.dumps(summary, indent=2, allow_nan=False) + '\n')
    print(json.dumps({k: summary.get(k) for k in ('run_exit_code', 'phases', 'admitted', 'denied')}, indent=2))
    return 0 if result == 0 and before == after else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--samples', type=int, default=30)
    parser.add_argument('--restore-parent')
    args = parser.parse_args()
    return run(args.binary, args.out, args.samples, args.restore_parent)


if __name__ == '__main__':
    raise SystemExit(main())
