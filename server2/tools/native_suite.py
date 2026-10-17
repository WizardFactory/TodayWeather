#!/usr/bin/env python3
"""Run existing server2 verification through one explicit artifact/report contract.

Owned loopback fixtures only. Layers and selection are recorded separately; PASS
never qualifies whole-service rollback, production performance or live shadow.
"""
import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Check:
    id: str
    family: str
    layer: str
    roles: tuple
    timeout: int
    limit: str


CHECKS = (
    Check('kma-core', 'kma', 'paired-http-replay', ('server2', 'kma_s3_replay'), 300,
          'Frozen CORE oracle and native S3 HTTP; not an earlier-release rollback.'),
    Check('kma-rich', 'kma-rich', 'paired-http-replay', ('server2', 'kma_s3_replay'), 300,
          'Rich corpus has its own denominator; not an earlier-release rollback.'),
    Check('world', 'world', 'http-coexistence-smoke', ('server2', 'loopback_server'), 180,
          'Includes a frozen legacy coexistence/rollback fixture; not legacy-free recovery.'),
    Check('warnings', 'warnings', 'loopback-http-smoke', ('warnings_smoke',), 60,
          'Synthetic recorded provider and owned S3; no live warning acquisition.'),
    Check('summary-model', 'summary', 'library-tests', ('summary',), 120,
          'Model/recorder/lookup tests use in-memory doubles; not HTTP evidence.'),
    Check('summary-http', 'summary', 'http-integration-tests', ('domestic',), 300,
          'Existing summary_s3 tests only; not all domestic tests or production history.'),
    Check('state', 'state', 'library-and-http-tests', ('state',), 180,
          'Registration journal/parity/restore/import tests; not whole-service recovery.'),
    Check('notice', 'notice', 'loopback-http-smoke', ('notice_smoke',), 60,
          'Synthetic owned translation/S3/API peers; no paid translation.'),
    Check('conditional-alert', 'delivery', 'loopback-http-smoke', ('conditional_alert_smoke',), 60,
          'Owned weather/OAuth/FCM peers and durable claim; no device send.'),
    Check('warning-push', 'delivery', 'loopback-http-smoke', ('warning_push_smoke',), 60,
          'Owned warning catalog/geocode/OAuth/FCM peers; no device send.'),
    Check('workers', 'workers', 'process-matrix', ('runtime_services',), 1200,
          'Current factory: nine phases and three stop triggers; no prior-release qualification.'),
)
ROLES = tuple(dict.fromkeys(role for check in CHECKS for role in check.roles))


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def utc():
    return datetime.now(timezone.utc).isoformat()


def source_revision():
    try:
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        dirty = bool(subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'],
                                            cwd=ROOT, text=True).strip())
        return {'commit': commit, 'dirty': dirty}
    except (OSError, subprocess.CalledProcessError):
        return {'commit': None, 'dirty': None}


def choose(selection):
    ids = list(selection) if selection is not None else [c.id for c in CHECKS]
    if not ids or len(set(ids)) != len(ids) or set(ids) - {c.id for c in CHECKS}:
        raise ValueError('selection must contain distinct known check IDs')
    # Registry order remains stable even when flags appear in a different order.
    return [check for check in CHECKS if check.id in ids]


def verify_artifact(role, artifact):
    path = Path(artifact['path'])
    if not path.is_file() or not os.access(path, os.X_OK):
        raise ValueError(role + ': executable regular file required')
    if sha256(path) != artifact['sha256']:
        raise ValueError(role + ': artifact hash mismatch')


def load_artifacts(manifest, selected):
    manifest = Path(manifest).resolve()
    data = json.loads(manifest.read_text())
    if (not isinstance(data, dict) or set(data) != {'schema', 'revision', 'artifacts'}
            or data['schema'] != 1 or not isinstance(data['revision'], str)
            or not re.fullmatch('[0-9a-f]{40}', data['revision'])
            or not isinstance(data['artifacts'], dict)):
        raise ValueError('artifact manifest schema/revision mismatch')
    if set(data['artifacts']) - set(ROLES):
        raise ValueError('unknown artifact role; manifest commands are not supported')
    needed = {role for check in selected for role in check.roles}
    artifacts = {}
    for role in sorted(needed):
        item = data['artifacts'].get(role)
        if (not isinstance(item, dict) or set(item) != {'path', 'sha256', 'profile'}
                or not isinstance(item['path'], str) or not item['path']
                or not isinstance(item['sha256'], str)
                or not re.fullmatch('[0-9a-f]{64}', item['sha256']) or item['profile'] != 'release'):
            raise ValueError(role + ': path, SHA-256 and release profile required')
        artifact = dict(item, path=str((manifest.parent / item['path']).resolve()))
        verify_artifact(role, artifact)
        artifacts[role] = artifact
    if 'kma_s3_replay' in artifacts:
        expected = Path(artifacts['server2']['path']).parent / 'examples/kma_s3_replay'
        if expected.resolve() != Path(artifacts['kma_s3_replay']['path']):
            raise ValueError('KMA adapter requires the verified example beside server2')
    return {'revision': data['revision'], 'artifacts': artifacts}


def child_environment():
    return {key: value for key, value in os.environ.items()
            if key in ('PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'SYSTEMROOT')}


def stop_group(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=40)
    except subprocess.TimeoutExpired:
        pass
    # Descendants may survive after their direct parent exits; address the whole
    # owned session even when wait() already returned.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


def execute(command, log, env, timeout):
    with Path(log).open('w') as output:
        process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=output,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        timed_out = False
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            stop_group(process)
        except BaseException:
            stop_group(process)
            raise
        else:
            stop_group(process)
    return {'exit_code': process.returncode, 'timed_out': timed_out}


def command_for(check, artifacts, directory):
    binary = lambda role: artifacts[role]['path']
    if check.id in ('kma-core', 'kma-rich'):
        return [sys.executable, str(ROOT / 'tools/shadow/replay.py'), '--binary', binary('server2'),
                '--family', check.family, '--self-check', '--report', str(directory / 'replay.json')]
    if check.id == 'world':
        return [sys.executable, str(ROOT / 'tools/world_smoke.py'), '--binary', binary('server2'),
                '--peer-binary', binary('loopback_server')]
    if check.id == 'warnings':
        return [sys.executable, str(ROOT / 'tests/storage/catalog_peer.py'), '--smoke', binary('warnings_smoke')]
    if check.id == 'workers':
        return [sys.executable, str(ROOT / 'tools/runtime_services_smoke.py'),
                '--binary', binary('runtime_services'), '--out', str(directory / 'process')]
    if check.id in ('summary-model', 'summary-http', 'state'):
        return [binary(check.roles[0]), *(['summary_s3::'] if check.id == 'summary-http' else []),
                '--test-threads=1']
    return [binary(check.roles[0])]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate_result(check, directory, log, artifacts):
    text = log.read_text(errors='replace')
    if check.id in ('kma-core', 'kma-rich'):
        result = json.loads((directory / 'replay.json').read_text())
        require(result['family'] == check.family and result['verdict'] == 'PASS', 'replay family/verdict mismatch')
        require(result['binary']['sha256'] == artifacts['server2']['sha256'], 'replay artifact mismatch')
        require(result['workload']['requests'] > 0 and result['self_check']['detected'] is True,
                'empty replay or failed perturbation control')
        require(set(result['oracle']) == {'baseline', 'candidate'} and not result['unexplained_differences'] and all(
            side['checked'] > 0 and not side['mismatches'] for side in result['oracle'].values()),
            'replay oracle mismatch')
        return {'oracle': result['oracle'], 'workload': result['workload'], 'sides': result['sides']}
    if check.id in ('summary-model', 'summary-http', 'state'):
        counts = re.findall(r'test result: ok\. (\d+) passed; (\d+) failed;', text)
        require(len(counts) == 1 and int(counts[0][0]) > 0 and int(counts[0][1]) == 0,
                'positive successful Rust test count required')
        return {'passed_tests': int(counts[0][0])}
    if check.id == 'workers':
        result = json.loads((directory / 'process/results.json').read_text())
        phases = ('idle', 'registration', 'weather', 'oauth', 'before-post', 'post', 'result', 'ambiguous', 'happy')
        expected = {trigger + '-' + phase for trigger in ('term', 'int', 'listener') for phase in phases}
        rows = result['results']
        require(result['binary_sha256'] == artifacts['runtime_services']['sha256'], 'worker artifact mismatch')
        require(result['live_actions'] is False and len(rows) == 27 and {r['id'] for r in rows} == expected
                and all(r['status'] == 'passed' for r in rows), 'complete 27-case worker matrix required')
        return {'process_cases': len(rows), 'results': rows}
    if check.id == 'world':
        require('PASS S11/S13a release smoke with the real setting names on test peers;' in text,
                'world smoke completion marker missing')
        return {'completion_marker': 'S11/S13a release smoke; coexistence fixture included'}
    records = []
    for line in text.splitlines():
        try:
            records.append(json.loads(line))
        except ValueError:
            pass
    if check.id == 'warnings':
        matches = [r for r in records if isinstance(r, dict) and r.get('result') == 'pass'
                   and r.get('zone_days', 0) > 0 and r.get('provider_stub_requests', 0) > 0]
    else:
        scenario = {'notice': 'notice-cli-s3-api', 'conditional-alert': 'conditional-alert-and-restart',
                    'warning-push': 'warning-feed-and-restart'}[check.id]
        matches = [r for r in records if isinstance(r, dict) and r.get('scenario') == scenario
                   and r.get('outcome') == 'PASS' and r.get('external_calls') == 0]
    require(len(matches) == 1, 'expected structured smoke outcome missing/ambiguous')
    return matches[0]


def write_report(out, report):
    temporary = out / 'report.tmp'
    temporary.write_text(json.dumps(report, indent=2) + '\n')
    temporary.replace(out / 'report.json')


def run(manifest, out, selection=None, runner=execute):
    selected = choose(selection)
    out = Path(out).resolve()
    require(ROOT != out and ROOT not in out.parents, 'outputs must be outside server2 source/fixtures')
    out.mkdir(parents=True, exist_ok=False)
    report = {'schema': 1, 'started_at_utc': utc(), 'selected': [c.id for c in selected],
              'available': [c.id for c in CHECKS], 'full_coverage': False,
              'runner_sha256': sha256(__file__), 'source_revision': source_revision(), 'manifest_sha256': None,
              'declared_artifact_revision': None, 'artifacts': {}, 'checks': [], 'verdict': 'RUNNING',
              'qualification': 'Selected existing checks only; no whole-service rollback, live shadow or production claim.'}
    for check in CHECKS:
        report['checks'].append({'id': check.id, 'family': check.family, 'layer': check.layer,
                                 'limitations': check.limit, 'status': 'NOT_RUN'})
    try:
        report['manifest_sha256'] = sha256(manifest)
        inputs = load_artifacts(manifest, selected)
        report['declared_artifact_revision'] = inputs['revision']
        report['artifacts'] = inputs['artifacts']
    except (OSError, ValueError, TypeError, KeyError) as error:
        report.update(verdict='BLOCKED', error=str(error), finished_at_utc=utc())
        write_report(out, report)
        return 2, report
    write_report(out, report)
    for check in selected:
        result = next(row for row in report['checks'] if row['id'] == check.id)
        directory = out / check.id
        directory.mkdir()
        log = directory / 'stdout.log'
        result.update(started_at_utc=utc(), artifact_roles=list(check.roles), status='RUNNING')
        began = time.monotonic()
        try:
            for role in check.roles:
                verify_artifact(role, inputs['artifacts'][role])
            command = command_for(check, inputs['artifacts'], directory)
            result['command'] = command
            programs = [Path(command[0])]
            if command[0] == sys.executable:
                programs.append(Path(command[1]))
            result['program_sha256'] = {str(p): sha256(p) for p in programs}
            execution = runner(command, log, child_environment(), check.timeout)
            result.update(execution)
            require(not execution['timed_out'] and execution['exit_code'] == 0, 'child failed or timed out')
            result['observed'] = validate_result(check, directory, log, inputs['artifacts'])
            result['status'] = 'PASS'
        except (OSError, ValueError, TypeError, KeyError) as error:
            result.update(status='FAIL', error=str(error))
        result.update(finished_at_utc=utc(), elapsed_seconds=round(time.monotonic() - began, 3))
        result['evidence'] = [{'path': str(p.relative_to(out)), 'sha256': sha256(p)}
                              for p in sorted(directory.rglob('*')) if p.is_file()]
        write_report(out, report)
        print(result['status'] + ' ' + check.id + ' [' + check.layer + ']', flush=True)
    failed = any(row['status'] != 'PASS' for row in report['checks'] if row['id'] in report['selected'])
    report.update(verdict='FAIL' if failed else 'PASS', finished_at_utc=utc(),
                  full_coverage=not failed and len(selected) == len(CHECKS))
    write_report(out, report)
    return int(failed), report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', type=Path, help='explicit schema-1 artifact manifest')
    parser.add_argument('--out', type=Path, help='new caller-owned run directory outside server2/')
    parser.add_argument('--check', action='append', choices=[c.id for c in CHECKS])
    parser.add_argument('--list', action='store_true', help='print check layers/roles/limits without executing')
    args = parser.parse_args(argv)
    if args.list:
        print(json.dumps([c.__dict__ for c in CHECKS], indent=2))
        return 0
    if args.artifacts is None or args.out is None:
        parser.error('--artifacts and --out are required for execution')
    try:
        code, report = run(args.artifacts, args.out, args.check)
    except (OSError, ValueError) as error:
        print('BLOCKED: ' + str(error), file=sys.stderr)
        return 2
    scope = 'all checks selected' if len(report.get('selected', [])) == len(CHECKS) else 'selected checks only'
    print(report['verdict'] + ' native verification: ' + scope + '; ' + str(args.out / 'report.json'))
    return code


if __name__ == '__main__':
    sys.exit(main())
