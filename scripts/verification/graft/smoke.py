#!/usr/bin/env python3
"""Real installed-Graft smoke in an isolated fresh source checkout; no LLM calls."""
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
SCOPES = ['server', 'client/www/js', 'client/scripts', 'web/src', 'packages', 'scripts', 'infra']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='Local ignored output directory')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    graft = shutil.which('graft')
    if not graft:
        parser.error('Installed Graft CLI required')
    env = dict(os.environ, DO_NOT_TRACK='1')
    results = []
    with tempfile.TemporaryDirectory(prefix='graft-smoke-') as tmp:
        repo = Path(tmp) / 'repo'
        repo.mkdir()
        # Copy Git-visible maintained sources, excluding ignored release inputs/dependencies.
        files = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=ROOT).split(b'\0')
        for raw in files:
            if not raw:
                continue
            rel = Path(os.fsdecode(raw))
            if not any(rel == Path(s) or Path(s) in rel.parents for s in SCOPES):
                continue
            source = ROOT / rel
            target = repo / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            if source.is_file() and not source.is_symlink():
                shutil.copy2(source, target)
        for rel in ['.gitignore', '.ignore', '.mcp.json', '.codex', '.claude', '.agents']:
            source = ROOT / rel
            if source.is_dir():
                shutil.copytree(source, repo / rel, symlinks=True)
            else:
                shutil.copy2(source, repo / rel)
        subprocess.run(['git', 'init', '-q', str(repo)], check=True)

        def run(name, command, stdin=None):
            r = subprocess.run(command, cwd=repo, env=env, input=stdin, text=True, capture_output=True, timeout=90)
            log = '$ ' + ' '.join(command).replace(str(repo), '<fresh-repo>').replace(graft, 'graft') + '\n' + r.stdout + r.stderr
            log = log.replace(str(repo), '<fresh-repo>')
            (args.output / (name + '.log')).write_text(log)
            assert r.returncode == 0, name + ': ' + r.stderr
            results.append({'name': name, 'exit_code': r.returncode})
            return r.stdout

        run('build', ['/bin/sh', 'scripts/build-graft.sh'])
        run('freshness', [graft, 'check', '--json'])
        client = run('client-query', [graft, 'grep', 'WeatherUtil', '--fixed', '--in', 'client/www/js', '--json'])
        assert 'service.weatherutil.js' in client
        server = run('server-api', [graft, 'skeleton', 'server/controllers/controllerManager.js'])
        assert 'function Manager' in server
        run('ignore', ['git', 'check-ignore', 'graft/INDEX.md'])
        assert not subprocess.check_output(['git', 'ls-files', 'graft'], cwd=repo)
        for event in ('session-start', 'prompt'):
            text = run('hook-' + event, ['node', '.claude/helpers/graft-hooks.cjs', event], json.dumps({'cwd': str(repo), 'session_id': 'graft-smoke', 'prompt': 'Where is normalizeWeather defined in packages/weather-core?'}))
            assert json.loads(text).get('hookSpecificOutput'), event

        process = subprocess.Popen([graft, 'mcp'], cwd=repo, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)

        def rpc(i, method, params):
            process.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': i, 'method': method, 'params': params}) + '\n')
            process.stdin.flush()
            until = time.monotonic() + 20
            while time.monotonic() < until:
                if not selector.select(1):
                    continue
                msg = json.loads(process.stdout.readline())
                if msg.get('id') == i:
                    assert 'error' not in msg, msg
                    return msg['result']
            raise RuntimeError('MCP response timeout')

        try:
            info = rpc(1, 'initialize', {'protocolVersion': '2024-11-05', 'capabilities': {}, 'clientInfo': {'name': 'graft-smoke', 'version': '1'}})
            process.stdin.write(json.dumps({'jsonrpc': '2.0', 'method': 'notifications/initialized'}) + '\n')
            process.stdin.flush()
            tools = rpc(2, 'tools/list', {})
            names = [t['name'] for t in tools['tools']]
            assert set(names) == {'graft_find_code', 'graft_file_api', 'graft_check_freshness', 'graft_trace_calls', 'graft_find_all', 'graft_repo_map'}, names
            check = rpc(3, 'tools/call', {'name': 'graft_check_freshness', 'arguments': {}})
            assert not check.get('isError'), check
            result = {'server': info['serverInfo'], 'tools': names, 'freshness': 'passed'}
            (args.output / 'mcp.json').write_text(json.dumps(result, indent=2) + '\n')
            results.append({'name': 'mcp', 'exit_code': 0})
        finally:
            process.terminate()
            process.wait(timeout=5)
            selector.close()
    (args.output / 'results.json').write_text(json.dumps({'runs': results, 'real_installed_graft': True, 'provider_calls': False}, indent=2) + '\n')
    print('Real Graft smoke passed: ' + ', '.join(r['name'] for r in results))


if __name__ == '__main__':
    main()
