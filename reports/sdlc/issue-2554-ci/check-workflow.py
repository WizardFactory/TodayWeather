"""Local contract and failure-propagation evaluation (requires PyYAML)."""
import os
from pathlib import Path
import re
import subprocess
import tempfile
import yaml

path = Path('.github/workflows/rss-offline.yml')
assert path.exists(), 'Missing RSS workflow: regression checks are not automated'
raw = path.read_text()
workflow = yaml.load(raw, Loader=yaml.BaseLoader)
assert set(workflow['on']) == {'push', 'pull_request'}
assert workflow['permissions'] == {'contents': 'read'}
job, = workflow['jobs'].values()
assert job['env']['TZ'] == 'UTC'
assert 0 < int(job['timeout-minutes']) <= 15
assert not any(term in raw for term in ('secrets.', 'continue-on-error', 'pull_request_target', 'SMOKE_POLICIES'))
steps = job['steps']
actions = [s for s in steps if 'uses' in s]
assert all(re.fullmatch(r'actions/[a-z-]+@[0-9a-f]{40}', s['uses']) for s in actions)
assert actions[0]['with']['persist-credentials'] == 'false'
assert actions[1]['with']['node-version'] == '22'
assert actions[1]['with']['package-manager-cache'] == 'false'
runs = [s for s in steps if 'run' in s]
assert len(runs) == 3
assert 'rss-wind.test.js' in runs[0]['run']
assert all(flag in runs[1]['run'] for flag in ('--prefix "$RUNNER_TEMP/', '--ignore-scripts', '--no-audit', '--no-fund'))
assert 'rss-response-smoke.js' in runs[2]['run']
assert runs[2]['env']['NODE_PATH'].startswith('${{ runner.temp }}/')

with tempfile.TemporaryDirectory(prefix='rss-ci-eval-') as temporary:
    root = Path(temporary)
    for command in ('node', 'npm'):
        fake = root / command
        fake.write_text('#!/bin/bash\nprintf "%s %s\\n" "${0##*/}" "$*" >> "$CALL_LOG"\nif [[ -n "$FAIL_MATCH" && "$*" == *"$FAIL_MATCH"* ]]; then exit 23; fi\n')
        fake.chmod(0o755)
    for match, expected_calls in (('', 3), ('rss-wind.test.js', 1), ('rss-response-smoke.js', 3)):
        log = root / 'calls'
        log.write_text('')
        env = dict(os.environ, PATH=temporary + ':' + os.environ['PATH'], RUNNER_TEMP=temporary,
                   CALL_LOG=str(log), FAIL_MATCH=match, **job['env'])
        for step in runs:
            step_env = dict(env, **{k: v.replace('${{ runner.temp }}', temporary) for k, v in step.get('env', {}).items()})
            result = subprocess.run(['bash', '--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step['run']], env=step_env)
            if result.returncode:
                break
        assert result.returncode == (23 if match else 0)
        assert len(log.read_text().splitlines()) == expected_calls
        print('PASS command sequence:', match or 'success', 'exit=', result.returncode)
print('PASS workflow contract and injected failure propagation (local shell evaluation)')
