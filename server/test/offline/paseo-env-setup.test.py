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
    env = dict(os.environ, PASEO_SOURCE_CHECKOUT_PATH=str(source), GIT_CEILING_DIRECTORIES=str(base))

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

    def exclude(folder):
        path = folder / '.git/info/exclude'
        return path.read_text() if path.exists() else ''

    def clean(folder):
        status = subprocess.run(['git', 'status', '--porcelain', '--untracked-files=all'],
                                cwd=folder, check=True, capture_output=True, text=True)
        assert status.stdout == '', status.stdout

    folder = target('new workspace')
    run(folder)
    copied = folder / 'server/.env'
    assert copied.is_file(), 'server/.env was not copied'
    assert copied.read_bytes() == (source / 'server/.env').read_bytes()
    assert copied.stat().st_mode & 0o777 == 0o600
    ignored(folder)
    assert not (folder / 'server/.gitignore').exists()
    assert exclude(folder).count('/server/.env') == 1
    clean(folder)
    assert (folder / '.aws/credentials').read_bytes() == (source / '.aws/credentials').read_bytes()
    print('PASS copy, 0600, exclude-file ignore, clean status, paths with spaces, AWS preservation, no secret output')

    copied.write_text('keep workspace overrides')
    run(folder)
    assert copied.read_text() == 'keep workspace overrides'
    assert exclude(folder).count('/server/.env') == 1
    clean(folder)
    print('PASS existing environment preserved; ignore setup idempotent')

    folder = target('root ignore')
    (folder / '.gitignore').write_text('.env\n')
    subprocess.run(['git', 'add', '.gitignore'], cwd=folder, check=True)
    subprocess.run(['git', '-c', 'user.name=t', '-c', 'user.email=t@example.invalid',
                    'commit', '-q', '-m', 'ignore'], cwd=folder, check=True)
    run(folder)
    ignored(folder)
    assert '/server/.env' not in exclude(folder)
    assert not (folder / 'server/.gitignore').exists()
    clean(folder)
    print('PASS existing ignore rule reused without writing ignore files')

    folder = target('negated ignore')
    (folder / 'server').mkdir()
    (folder / 'server/.gitignore').write_text('# existing\n!.env')
    run(folder, failure=True)
    assert not (folder / 'server/.env').exists()
    assert (folder / 'server/.gitignore').read_text() == '# existing\n!.env'
    print('PASS unignorable environment refused without copying or editing ignore files')

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

    folder = target('exclude symlink')
    sentinel = base / 'sentinel'
    sentinel.write_text('unchanged')
    (folder / '.git/info').mkdir(exist_ok=True)
    (folder / '.git/info/exclude').unlink(missing_ok=True)
    (folder / '.git/info/exclude').symlink_to(sentinel)
    run(folder, failure=True)
    assert sentinel.read_text() == 'unchanged'
    assert not (folder / 'server/.env').exists()
    print('PASS exclude-file symlink refused')

    folder = base / 'not a repository'
    folder.mkdir()
    run(folder, failure=True)
    assert not (folder / 'server/.env').exists()
    print('PASS setup outside a Git work tree fails before copying')

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
