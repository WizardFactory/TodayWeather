#!/usr/bin/env python3
"""Exercise installed hooks with real local commits and a local bare push target."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import tempfile

SOURCE = Path(__file__).resolve().parents[2]
env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
env.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM='1',
           GIT_AUTHOR_NAME='Hook smoke', GIT_AUTHOR_EMAIL='fixture@example.invalid',
           GIT_COMMITTER_NAME='Hook smoke', GIT_COMMITTER_EMAIL='fixture@example.invalid')

with tempfile.TemporaryDirectory(prefix='artifact-hook-smoke-') as tmp:
    root, remote = Path(tmp)/'work', Path(tmp)/'remote.git'
    root.mkdir()

    def run(*cmd, ok=True, cwd=None):
        p = subprocess.run(cmd, cwd=cwd or root, env=env, text=True, capture_output=True)
        if ok != (p.returncode == 0):
            raise AssertionError(f'{cmd}: exit {p.returncode}\n{p.stdout}\n{p.stderr}')
        return p

    def git(*args, ok=True):
        return run('git', *args, ok=ok)

    def write(name, data):
        p = root/name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(data)

    git('init', '-q', '-b', 'main')
    write('README.md', '# Hook fixture\n')
    write('.gitignore', '/reports/\n')
    git('add', '.')
    git('commit', '-qm', 'pre-policy baseline')
    baseline = git('rev-parse', 'HEAD').stdout.strip()
    for name in ['scripts/check-artifact-policy.py', 'scripts/install-artifact-hooks.py',
                 '.githooks/pre-commit', '.githooks/pre-push']:
        dest = root/name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SOURCE/name, dest)
    write('scripts/artifact-policy.json', json.dumps({'history_base': baseline}))
    run(sys.executable, 'scripts/install-artifact-hooks.py')
    run(sys.executable, 'scripts/install-artifact-hooks.py', '--check')
    git('add', '.')
    git('commit', '-qm', 'install checked policy')
    print('PASS: explicit installer and valid pre-commit')

    write('reports/raw.json', '{}')
    git('add', '-f', 'reports/raw.json')
    bad = git('commit', '-qm', 'must reject generated output', ok=False)
    assert 'generated/local output' in bad.stderr
    git('rm', '--cached', 'reports/raw.json')
    print('PASS: pre-commit rejected generated output and kept the local file')
    assert (root/'reports/raw.json').is_file()

    write('docs/README.md', '[local](local.json)\n')
    write('docs/local.json', '{}')
    git('add', 'docs/README.md')
    bad = git('commit', '-qm', 'must reject local-only target', ok=False)
    assert 'missing tracked target' in bad.stderr
    git('add', 'docs/local.json')
    git('commit', '-qm', 'include reference target')
    print('PASS: link dependency required in the index')

    run('git', 'init', '--bare', '-q', str(remote))
    git('remote', 'add', 'origin', str(remote))
    git('push', '-q', 'origin', 'main')
    print('PASS: real pre-push to isolated local bare repository')

    # Deliberately bypass only the fixture hook to test pre-push's history coverage.
    git('add', '-f', 'reports/raw.json')
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture forbidden intermediate commit')
    git('rm', 'reports/raw.json')
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture removes generated file')
    bad = git('push', '-q', 'origin', 'main', ok=False)
    assert 'generated/local output' in bad.stderr
    print('PASS: pre-push rejected add-then-delete history despite clean tip')

    # Simulate history already accepted by the remote before policy adoption.
    # Bypass only this fixture push; the new topic push must use the real hook.
    git('-c', 'core.hooksPath=/dev/null', 'push', '-q', 'origin', 'main')
    git('checkout', '-qb', 'topic')
    write('docs/topic.md', '# New branch content\n')
    git('add', '.')
    git('commit', '-qm', 'new topic')
    pushed = git('push', '-q', 'origin', 'topic')
    assert '1 snapshot(s)' in pushed.stdout
    assert run('git', '--git-dir', str(remote), 'rev-parse', 'refs/heads/topic').stdout == git('rev-parse', 'HEAD').stdout
    print('PASS: new-branch hook checked only unpublished work, excluding remote main history')

    git('config', '--local', 'core.hooksPath', 'custom-hooks')
    run(sys.executable, 'scripts/install-artifact-hooks.py', ok=False)
    assert git('config', '--get', 'core.hooksPath').stdout.strip() == 'custom-hooks'
    print('PASS: installer preserved existing hook configuration')
print('All functional hook smoke scenarios passed; temporary repositories removed.')
