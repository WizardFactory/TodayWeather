#!/usr/bin/env python3
"""Read-only S04 placement gate. Python3.11+, Git snapshot plus task diff.

Static checks complement human review; computed filesystem paths are not proven.
Task declarations are reviewable contracts, not authority to widen scope.
"""
import argparse
import ast
import json
import re
import subprocess
import sys
import tomllib
from pathlib import Path, PurePosixPath


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args])


def clean(path):
    p = PurePosixPath(path)
    return bool(path) and not p.is_absolute() and '..' not in p.parts and str(p) == path.rstrip('/')


def declaration_errors(d):
    errors = []
    if not d.get('task') or not d.get('issue'):
        errors.append('declaration needs task and issue')
    for path in d.get('server2_paths', []):
        if not clean(path) or not path.startswith('server2/'):
            errors.append(f'invalid server2 declaration: {path}')
    if not d.get('server2_paths'):
        errors.append('declaration needs owned server2 paths')
    for x in d.get('outside', []):
        p = x.get('path', '')
        category = x.get('category')
        allowed = {'documentation': ('docs/', 'intent/', 'specs/', 'plans/'), 'agent-guidance': ('AGENTS.md',), 'ci-wiring': ('.github/workflows/server2.yml',), 'legacy-oracle': ('server/test/offline/golden-record.js',), 'legacy-export': ('server/',), 'legacy-coexistence': ('server/',), 'legacy-retirement': ('server/',)}
        if not clean(p) or p.endswith('/') or not x.get('reason') or category not in allowed:
            errors.append(f'invalid exact outside exception: {p}')
        elif not any(p == prefix or (prefix.endswith('/') and p.startswith(prefix)) for prefix in allowed[category]):
            errors.append(f'category does not permit outside path: {p}')
    return errors


def declared(path, d):
    return any(path == p.rstrip('/') or (p.endswith('/') and path.startswith(p)) for p in d.get('server2_paths', [])) or any(path == x['path'] for x in d.get('outside', []))


def changed_paths(root, base):
    # -M includes both endpoints; never let a rename delete/move an undeclared asset.
    tokens = git(root, 'diff', '--name-status', '-z', '-M', base, '--').decode().split('\0')
    paths = []
    i = 0
    while i < len(tokens) and tokens[i]:
        status = tokens[i]; i += 1
        count = 2 if status.startswith(('R', 'C')) else 1
        paths.extend(tokens[i:i + count]); i += count
    paths.extend(git(root, 'ls-files', '--others', '--exclude-standard', '-z').decode().split('\0'))
    return sorted(set(p for p in paths if p))


def inside(root, source, literal):
    candidate = (source.parent / literal).resolve()
    return candidate == root / 'server2' or (root / 'server2') in candidate.parents


def audit_manifest(root, path, body):
    errors = []
    try:
        doc = tomllib.loads(body)
    except tomllib.TOMLDecodeError as e:
        return [f'{path}: invalid TOML: {e}']
    def walk(x):
        if isinstance(x, dict):
            for key, value in x.items():
                if key == 'path' and isinstance(value, str) and not inside(root, root / path, value):
                    errors.append(f'{path}: local dependency/target escape: {value}')
                if key in ('members', 'default-members') and isinstance(value, list):
                    for member in value:
                        if not inside(root, root / path, member):
                            errors.append(f'{path}: workspace member escape: {member}')
                if key == 'build' and isinstance(value, str) and not inside(root, root / path, value):
                    errors.append(f'{path}: build script escape: {value}')
                if key in ('rustc-wrapper', 'rustc-workspace-wrapper', 'runner', 'linker') and isinstance(value, str) and ('/' in value or '\\' in value) and not inside(root, root / path, value):
                    errors.append(f'{path}: build tool escape: {value}')
                walk(value)
        elif isinstance(x, list):
            for value in x: walk(value)
    walk(doc)
    return errors


def rust_literal(body, start):
    """Bounded direct string scanner; encoded/continued strings fail conservatively."""
    start += len(body[start:]) - len(body[start:].lstrip())
    raw = re.match(r'r(#{0,255})"', body[start:])
    if raw:
        content = start + raw.end()
        end = body.find('"' + raw[1], content)
        if end < 0: return None
        finish = end + 1 + len(raw[1])
        value = body[content:end]
    elif body[start:start + 1] == '"':
        content = start + 1
        end = content
        while end < len(body):
            if body[end] == '\\':
                # Skip compiler escape before detecting closing quote, then reject it.
                end += 2
            elif body[end] == '"': break
            else: end += 1
        if end >= len(body): return None
        finish = end + 1
        value = body[content:end]
    else: return None
    if '\\' in value or '\n' in value or '\r' in value: return None
    # Raw hash delimiter must match exactly; don't silently truncate malformed literals.
    if body[finish:finish + 1] == '#': return None
    return value, finish


def audit_source(root, path, body):
    errors = []
    compiler = r'(?:include|include_bytes|include_str)!\s*\(\s*|#\s*\[\s*path\s*=\s*'
    for m in re.finditer(compiler, body):
        parsed = rust_literal(body, m.end())
        if parsed is None:
            errors.append(f'{path}: unsupported/encoded compiler resource argument')
        elif not inside(root, root / path, parsed[0]):
            errors.append(f'{path}: resource/include escape: {parsed[0]}')
    runtime = r'(?:read|read_to_string|read_dir|open|create)\s*\(\s*'
    for m in re.finditer(runtime, body):
        start = m.end()
        # Borrowed/parenthesized literals remain static paths, not computed access.
        while start < len(body) and body[start] in '&( \t\r\n': start += 1
        arg = body[start:]
        # Computed/aliased runtime calls need manual review. Direct strings cannot skip.
        if arg.startswith(('/*', '//')):
            errors.append(f'{path}: commented runtime filesystem argument requires a direct owned literal')
            continue
        if not re.match(r'(?:"|r#*")', arg): continue
        parsed = rust_literal(body, start)
        if parsed is None:
            errors.append(f'{path}: unsupported/encoded runtime filesystem argument')
        elif '..' in PurePosixPath(parsed[0]).parts or not inside(root, root / 'server2' / 'runtime', parsed[0]):
            errors.append(f'{path}: runtime filesystem escape: {parsed[0]}')
    return errors


def external_literal(value):
    # Canonical direct paths to sibling assets, including absolute checkout references.
    return bool(re.search(r'(?:^|[\s"\'=])(?:[^\s"\']*/)?(?:\.\./)+(?:server|client|packages|config|scripts|deploy)(?:/|$|[\s\"\'])', value) or
                re.search(r'(?:^|[\s"\'=])(?:/[^\s"\']*)/(?:server|client|packages)/(?:[^\s"\']*)', value) or
                re.match(r'^(?:server|client|packages)/', value))


def audit_nonrust(path, body):
    """Direct executable Python call arguments, decoded JSON, literal shell/config paths.

    Fixture path/payload exemption is exact file + self.write/fixture_symlink data roles, not a file bypass.
    Computed paths, aliases, custom loaders and macros require manual review.
    """
    values = []
    if path.endswith('.py'):
        try: tree = ast.parse(body)
        except SyntaxError as e: return [f'{path}: incomplete Python path check: {e}']
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call): continue
            name = node.func.id if isinstance(node.func, ast.Name) else node.func.attr if isinstance(node.func, ast.Attribute) else ''
            if name not in {'open', 'Path', 'read', 'read_text', 'read_bytes', 'write', 'write_text', 'write_bytes', 'run', 'Popen', 'check_output', 'check_call', 'load', 'symlink_to', 'system', 'popen', 'chdir', 'listdir', 'scandir', 'unlink', 'rename', 'replace', 'remove'}: continue
            fixture = (path == 'server2/tools/test_placement.py' and isinstance(node.func, ast.Attribute)
                       and node.func.attr in ('write', 'fixture_symlink') and isinstance(node.func.value, ast.Name)
                       and node.func.value.id == 'self')
            for index, arg in enumerate(node.args):
                if fixture: continue
                for literal in ast.walk(arg):
                    if isinstance(literal, ast.Constant) and isinstance(literal.value, str): values.append(literal.value)
            for keyword in node.keywords:
                if isinstance(keyword.value, ast.Constant) and isinstance(keyword.value.value, str): values.append(keyword.value.value)
    elif path.endswith(('.json', '.toml')):
        try: tree = json.loads(body) if path.endswith('.json') else tomllib.loads(body)
        except ValueError as e: return [f'{path}: incomplete JSON path check: {e}']
        if re.fullmatch(r'server2/config/tasks/[^/]+\.json', path):
            # Declaration identities do not read assets. Only validated outside.path
            # roles are exempt; arbitrary runtime configuration in this file is scanned.
            invalid = declaration_errors(tree)
            if invalid: return [f'{path}: {error}' for error in invalid]
            tree = dict(tree, outside=[{key: value for key, value in item.items() if key != 'path'}
                                       for item in tree.get('outside', [])])
        def walk(x):
            if isinstance(x, str): values.append(x)
            elif isinstance(x, list):
                for v in x: walk(v)
            elif isinstance(x, dict):
                for v in x.values(): walk(v)
        walk(tree)
    else: values.append(body)
    return [f'{path}: direct external resource reference' for value in values if external_literal(value)]


def audit_workflow(body):
    errors = []
    runs = re.findall(r'^[ \t]*-?[ \t]*run:[ \t]*([^\r\n]+)$', body, re.M)
    uses = re.findall(r'^[ \t]*-?[ \t]*uses:[ \t]*([^\r\n]+)$', body, re.M)
    dirs = re.findall(r'^[ \t]*working-directory:[ \t]*([^\r\n]+)$', body, re.M)
    timeouts = re.findall(r'^[ \t]*timeout-minutes:[ \t]*([^\r\n]+)$', body, re.M)
    if runs != ['bash tools/ci.sh'] or dirs != ['server2']:
        errors.append('server2 workflow must only invoke bash tools/ci.sh from server2')
    if uses != ['actions/checkout@v4'] or re.findall(r'^[ \t]*fetch-depth:[ \t]*([^\r\n]+)$', body, re.M) != ['0']:
        errors.append('server2 workflow permits only actions/checkout@v4 with full history')
    if timeouts != ['30']:
        errors.append('server2 workflow requires the 30-minute job timeout')
    return errors


def check(root, declaration, base):
    root = Path(root).resolve()
    errors = declaration_errors(declaration)
    if errors: return errors
    for path in changed_paths(root, base):
        if not declared(path, declaration): errors.append(f'undeclared changed path: {path}')
    # Audit every tracked asset, including unchanged files; untracked owned files too.
    raw = git(root, 'ls-files', '--stage', '-z').decode()
    modes = {}
    for row in raw.split('\0'):
        if row:
            info, path = row.split('\t', 1); modes[path] = info.split()[0]
    all_paths = set(modes) | set(changed_paths(root, base))
    for path in sorted(all_paths):
        file = root / path
        if path in ('Cargo.toml', 'Cargo.lock', 'rust-toolchain', 'rust-toolchain.toml') or path.startswith('.cargo/'):
            errors.append(f'root Rust asset forbidden: {path}')
        if path == '.github/workflows/server2.yml' and file.exists():
            errors.extend(audit_workflow(file.read_text()))
        if not path.startswith('server2/') or not (file.exists() or file.is_symlink()): continue
        if file.is_symlink() or modes.get(path) == '120000':
            if not inside(root, file, str(file.readlink())): errors.append(f'{path}: symlink escape')
            continue
        if file.suffix in ('.rs', '.toml', '.sh', '.py', '.json', '.service', '.conf', '.yaml', '.yml') or file.name in ('Dockerfile', '.env'):
            body = file.read_text()
            if file.name == 'Cargo.toml' or path.startswith('server2/.cargo/'):
                errors.extend(audit_manifest(root, path, body))
            if file.suffix == '.rs': errors.extend(audit_source(root, path, body))
            elif file.name != 'Cargo.toml': errors.extend(audit_nonrust(path, body))
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default='..')
    parser.add_argument('--declaration', required=True)
    parser.add_argument('--base', required=True, help='Exact task base/merge-base, never silently reduced')
    args = parser.parse_args()
    try:
        errors = check(args.root, json.loads(Path(args.declaration).read_text()), args.base)
    except (OSError, ValueError, subprocess.CalledProcessError) as e:
        print(f'incomplete placement check: {e}', file=sys.stderr); return 2
    for error in errors: print(error, file=sys.stderr)
    if errors: return 1
    print('PASS server2 task paths, full tracked layout and literal dependency/resource boundary')
    return 0

if __name__ == '__main__':
    sys.exit(main())
