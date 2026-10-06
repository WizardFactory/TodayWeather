#!/usr/bin/env python3
"""Read-only S04 placement gate. Python3.11+, Git snapshot plus task diff.

Static checks complement human review; computed filesystem paths are not proven.
Task declarations are reviewable contracts, not authority to widen scope.
"""
import argparse
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


def audit_source(root, path, body):
    errors = []
    # Literal includes/path modules/resources and filesystem APIs must stay owned.
    expressions = [r'(?:include|include_bytes|include_str)!\s*\(\s*(r#*"[^"]*"#*|"[^"\n]*")', r'#\s*\[\s*path\s*=\s*("[^"\n]*")']
    for pattern in expressions:
        for m in re.finditer(pattern, body):
            literal = m.group(1).lstrip('r#').strip('"#')
            if not inside(root, root / path, literal):
                errors.append(f'{path}: resource/include escape: {literal}')
    # Runtime paths are CWD-relative, unlike compiler includes. Reject ambiguous
    # parent traversal; allowed relative paths still need an owned CWD in review.
    for m in re.finditer(r'(?:read|read_to_string|read_dir|open|create)\s*\(\s*("[^"\n]*")', body):
        literal = m.group(1).strip('"')
        if '..' in PurePosixPath(literal).parts or not inside(root, root / 'server2' / 'runtime', literal):
            errors.append(f'{path}: runtime filesystem escape: {literal}')
    if re.search(r'(?:include|include_bytes|include_str)!\s*\(\s*(?:concat!|env!|format!)', body):
        errors.append(f'{path}: computed include requires owned literal asset')
    if re.search(r'(?:["\'])(?:[^"\']*/)?server/(?:[^"\']*)', body):
        errors.append(f'{path}: legacy resource reference')
    return errors


def audit_workflow(body):
    errors = []
    # Shared entrypoint is intentionally small; all shell logic is in tools/ci.sh.
    runs = re.findall(r'^[ \t]*-?[ \t]*run:[ \t]*([^\r\n]+)$', body, re.M)
    if runs != ['bash tools/ci.sh'] or 'working-directory: server2' not in body:
        errors.append('server2 workflow must only invoke bash tools/ci.sh from server2')
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
        if file.suffix in ('.rs', '.toml', '.sh', '.py', '.json'):
            body = file.read_text()
            if file.name == 'Cargo.toml' or path.startswith('server2/.cargo/'):
                errors.extend(audit_manifest(root, path, body))
            if file.suffix == '.rs': errors.extend(audit_source(root, path, body))
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
