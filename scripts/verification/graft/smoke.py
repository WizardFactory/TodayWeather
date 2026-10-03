#!/usr/bin/env python3
"""Real installed-Graft smoke in an isolated fresh source checkout; no LLM calls."""
import argparse
import hashlib
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
    results = []
    with tempfile.TemporaryDirectory(prefix='graft-smoke-') as tmp:
        base = Path(tmp).resolve()
        repo = base / 'repo'
        home = base / 'home'
        home.mkdir()
        env = dict(os.environ, HOME=str(home), CODEX_HOME=str(home / '.codex'), DO_NOT_TRACK='1')
        env.pop('CLAUDE_PROJECT_DIR', None)
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
        subprocess.run(['git', '-C', str(repo), 'add', '-A'], check=True)
        subprocess.run(['git', '-C', str(repo), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fresh fixture'], check=True)

        def home_snapshot():
            return {str(p.relative_to(home)): hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in home.rglob('*') if p.is_file()}

        def unchanged(before):
            assert home_snapshot() == before, 'Hook/MCP changed isolated user configuration'
            assert not subprocess.check_output(['git', 'status', '--porcelain'], cwd=repo), 'Hook/MCP rewrote repository files'


        def run(name, command, stdin=None):
            r = subprocess.run(command, cwd=repo, env=env, input=stdin, text=True, capture_output=True, timeout=90)
            log = '$ ' + ' '.join(command).replace(str(repo), '<fresh-repo>').replace(graft, 'graft') + '\n' + r.stdout + r.stderr
            log = log.replace(str(repo), '<fresh-repo>')
            (args.output / (name + '.log')).write_text(log)
            assert r.returncode == 0, name + ': ' + r.stderr
            results.append({'name': name, 'exit_code': r.returncode})
            return r.stdout

        # Before any build, both host SessionStart commands must be non-mutating.
        codex = json.loads((repo / '.codex/hooks.json').read_text())['hooks']['SessionStart'][0]['hooks'][0]['command']
        claude = json.loads((repo / '.claude/settings.json').read_text())['hooks']['SessionStart'][0]['hooks'][0]['command']
        for stamp in (None, '0.0.0'):
            cache = repo / 'graft/.cache/wiring-stamp.json'
            if stamp:
                cache.parent.mkdir(parents=True, exist_ok=True)
                cache.write_text(json.dumps({'version': stamp, 'hosts': ['claude', 'agents'], 'opts': {'global': True}}))
            elif cache.exists():
                cache.unlink()
            for host, command in [('claude', claude), ('codex', codex)]:
                before = home_snapshot()
                run('unbuilt-' + host + ('-mismatch' if stamp else ''), ['/bin/sh', '-c', command], json.dumps({'cwd': str(repo)}))
                unchanged(before)
        # Seed only the isolated registry-update cache to prevent CLI background fetches.
        update = home / '.graft/update-check.json'
        update.parent.mkdir(parents=True, exist_ok=True)
        update.write_text(json.dumps({'checkedAt': time.time() * 1000, 'latest': None}))
        run('build', ['/bin/sh', 'scripts/build-graft.sh'])
        run('freshness', [graft, 'check', '--json'])
        client = run('client-query', [graft, 'grep', 'WeatherUtil', '--fixed', '--in', 'client/www/js', '--json'])
        assert 'service.weatherutil.js' in client
        server = run('server-api', [graft, 'skeleton', 'server/controllers/controllerManager.js'])
        assert 'function Manager' in server
        run('ignore', ['git', 'check-ignore', 'graft/INDEX.md'])
        assert not subprocess.check_output(['git', 'ls-files', 'graft'], cwd=repo)
        for event in ('session-start', 'prompt'):
            before = home_snapshot()
            text = run('hook-' + event, ['node', '.claude/helpers/graft-hooks.cjs', event], json.dumps({'cwd': str(repo), 'session_id': 'graft-smoke', 'prompt': 'Where is normalizeWeather defined in packages/weather-core?'}))
            assert json.loads(text).get('hookSpecificOutput'), event
            unchanged(before)

        for stamp in (None, '0.0.0'):
            cache = repo / 'graft/.cache/wiring-stamp.json'
            if stamp:
                cache.write_text(json.dumps({'version': stamp, 'hosts': ['claude', 'agents'], 'opts': {'global': True}}))
            elif cache.exists():
                cache.unlink()
            before = home_snapshot()
            command = json.loads((repo / '.mcp.json').read_text())['mcpServers']['graft']
            process = subprocess.Popen([command['command'], *command['args']], cwd=repo, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
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
                (args.output / ('mcp-' + (stamp or 'absent') + '.json')).write_text(json.dumps(result, indent=2) + '\n')
                results.append({'name': 'mcp-' + (stamp or 'absent'), 'exit_code': 0})
            finally:
                process.terminate()
                process.wait(timeout=5)
                selector.close()
            unchanged(before)
    (args.output / 'results.json').write_text(json.dumps({'runs': results, 'real_installed_graft': True, 'provider_calls': False, 'home_isolated': True, 'hook_mcp_config_unchanged': True}, indent=2) + '\n')
    print('Real Graft smoke passed: ' + ', '.join(r['name'] for r in results))


if __name__ == '__main__':
    main()
