"""Synthetic workspace setup regression; never reads operator credentials."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[3]
setup = json.loads((root / 'paseo.json').read_text())['worktree']['setup']
with tempfile.TemporaryDirectory(prefix='tw-paseo-env-') as tmp:
    base = Path(tmp)
    source = base / 'source checkout'
    (source / 'server').mkdir(parents=True)
    (source / '.aws').mkdir()
    (source / 'server/.env').write_text("SERVER_MODE=service\nDUMMY_SECRET='synthetic-only'\n")
    for name in ('aleckim.pem', 'credentials'):
        (source / '.aws' / name).write_text('synthetic-aws-' + name)
    env = dict(os.environ, PASEO_SOURCE_CHECKOUT_PATH=str(source))

    def target(name):
        folder = base / name
        folder.mkdir()
        subprocess.run(['git', 'init', '-q', str(folder)], check=True)
        return folder

    def run(folder, failure=False):
        result = subprocess.run(['sh', '-c', setup], cwd=folder, env=env,
                                capture_output=True, text=True)
        assert (result.returncode != 0) == failure, result.stderr
        assert 'synthetic-only' not in result.stdout + result.stderr
        assert 'synthetic-aws-' not in result.stdout + result.stderr

    def ignored(folder):
        subprocess.run(['git', 'check-ignore', '--quiet', 'server/.env'], cwd=folder, check=True)

    folder = target('new workspace')
    run(folder)
    copied = folder / 'server/.env'
    assert copied.is_file(), 'server/.env was not copied'
    assert copied.read_bytes() == (source / 'server/.env').read_bytes()
    assert copied.stat().st_mode & 0o777 == 0o600
    ignored(folder)
    assert (folder / '.aws/credentials').read_bytes() == (source / '.aws/credentials').read_bytes()
    print('PASS copy, 0600, ignore, paths with spaces, AWS preservation, no secret output')

    copied.write_text('keep workspace overrides')
    run(folder)
    assert copied.read_text() == 'keep workspace overrides'
    assert (folder / 'server/.gitignore').read_text().count('/.env') == 1
    print('PASS existing environment preserved; ignore setup idempotent')

    folder = target('negated ignore')
    (folder / 'server').mkdir()
    (folder / 'server/.gitignore').write_text('# existing\n!.env')
    run(folder)
    ignored(folder)
    assert (folder / 'server/.gitignore').read_text().startswith('# existing\n!.env\n')
    print('PASS pre-existing ignore negation safely overridden without losing content')

    folder = target('missing source')
    env['PASEO_SOURCE_CHECKOUT_PATH'] = str(base / 'absent')
    run(folder)
    assert not (folder / 'server/.env').exists()
    print('PASS missing source skipped')
    env['PASEO_SOURCE_CHECKOUT_PATH'] = str(source)

    folder = target('server symlink')
    (folder / 'server').symlink_to(source / 'server', target_is_directory=True)
    run(folder, failure=True)
    assert not (source / 'server/.gitignore').exists()
    print('PASS server symlink refused')

    folder = target('ignore symlink')
    (folder / 'server').mkdir()
    sentinel = base / 'sentinel'
    sentinel.write_text('unchanged')
    (folder / 'server/.gitignore').symlink_to(sentinel)
    run(folder, failure=True)
    assert sentinel.read_text() == 'unchanged'
    assert not (folder / 'server/.env').exists()
    print('PASS ignore-file symlink refused')

    folder = target('environment symlink')
    (folder / 'server').mkdir()
    (folder / 'server/.env').symlink_to(base / 'nonexistent')
    run(folder)
    assert (folder / 'server/.env').is_symlink()
    assert not (base / 'nonexistent').exists()
    ignored(folder)
    print('PASS existing dangling environment symlink preserved')

    folder = target('missing source variable')
    del env['PASEO_SOURCE_CHECKOUT_PATH']
    run(folder, failure=True)
    print('PASS missing Paseo source variable fails clearly')
