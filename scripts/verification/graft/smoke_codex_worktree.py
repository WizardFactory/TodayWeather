#!/usr/bin/env python3
"""Inspect real Codex linked-worktree hook discovery with an isolated user config."""
import argparse
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[3]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    codex = shutil.which('codex')
    if not codex:
        parser.error('Installed Codex CLI required')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='graft-codex-worktree-') as tmp:
        base = Path(tmp).resolve()
        repo, worktree, home = base / 'repo', base / 'worktree', base / 'codex-home'
        home.mkdir()
        subprocess.run(['git', 'init', '-q', str(repo)], check=True)
        shutil.copytree(ROOT / '.codex', repo / '.codex', symlinks=True)
        # Store only hook config; broken fixture skill link is unrelated to hook discovery.
        shutil.rmtree(repo / '.codex/skills')
        subprocess.run(['git', '-C', str(repo), 'add', '.codex'], check=True)
        subprocess.run(['git', '-C', str(repo), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture hooks'], check=True)
        subprocess.run(['git', '-C', str(repo), 'worktree', 'add', '-q', '-b', 'fixture', str(worktree)], check=True)
        (home / 'config.toml').write_text('[projects.' + json.dumps(str(repo)) + ']\ntrust_level = "trusted"\n')
        env = dict(os.environ, HOME=str(base / 'isolated-home'), CODEX_HOME=str(home), DO_NOT_TRACK='1')
        (base / 'isolated-home').mkdir()
        process = subprocess.Popen([codex, 'app-server'], cwd=worktree, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)

        def rpc(i, method, params):
            process.stdin.write(json.dumps({'id': i, 'method': method, 'params': params}) + '\n')
            process.stdin.flush()
            until = time.monotonic() + 20
            while time.monotonic() < until:
                if not selector.select(1):
                    continue
                message = json.loads(process.stdout.readline())
                if message.get('id') == i:
                    assert 'error' not in message, message
                    return message['result']
            raise RuntimeError('Codex response timeout')
        try:
            rpc(1, 'initialize', {'clientInfo': {'name': 'graft-worktree-smoke', 'version': '1'}, 'capabilities': {'experimentalApi': True}})
            response = rpc(2, 'hooks/list', {'cwds': [str(worktree)]})
            hooks = [h for entry in response['data'] for h in entry['hooks'] if 'graft-hooks.cjs' in h.get('command', '')]
            assert len(hooks) == 4, response
            assert all(h['sourcePath'] == str(repo / '.codex/hooks.json') and h['source'] == 'project' for h in hooks), hooks
            assert all(h['trustStatus'] == 'untrusted' for h in hooks), 'Fresh-user trust must never be inherited'
            output = {'codex_version': subprocess.check_output([codex, '--version'], text=True).strip(), 'hooks': [{'event': h['eventName'], 'source': 'original-repository/.codex/hooks.json', 'trust': h['trustStatus']} for h in hooks], 'user_configuration_isolated': True, 'model_task_submitted': False}
            args.output.write_text(json.dumps(output, indent=2) + '\n')
            print('Codex linked-worktree discovery passed: four original-repository hooks; fresh user requires trust.')
        finally:
            process.terminate()
            process.wait(timeout=5)
            selector.close()


if __name__ == '__main__':
    main()
