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


HOST_READ_SOURCE = 'server2/tools/benchmark/aws.rs'
HOST_READ_ROLES = {
    ('Path::new', '/opt/server2-s09', 'private-owned-manifest'),
    ('Path::new', '/opt/server2-s09/run', 'private-owned-manifest'),
    ('read_to_string', '/proc/self/status', 'read-only-system'),
    ('read_to_string', '/proc/self/stat', 'read-only-system'),
}


def runtime_host_policy(d):
    """A declaration records fixed reviewed roles; it cannot invent an exemption."""
    if 'runtime_host_reads' not in d:
        return set(), []
    records = d['runtime_host_reads']
    if (d.get('task') != 'S09' or
            d.get('issue') != 'https://github.com/WizardFactory/TodayWeather/issues/2694' or
            not isinstance(records, list) or len(records) != 4):
        return set(), ['invalid exact runtime host-read policy']
    found = set()
    for record in records:
        if (not isinstance(record, dict) or
                set(record) != {'source', 'operation', 'path', 'category', 'reason'} or
                record.get('source') != HOST_READ_SOURCE or
                not isinstance(record.get('reason'), str) or not record['reason'].strip() or
                any(not isinstance(record.get(k), str) for k in ('operation', 'path', 'category'))):
            return set(), ['invalid exact runtime host-read record']
        role = (record['operation'], record['path'], record['category'])
        if role not in HOST_READ_ROLES or role in found:
            return set(), ['runtime host-read role is not a unique reviewed role']
        found.add(role)
    if found != HOST_READ_ROLES or HOST_READ_SOURCE not in d.get('server2_paths', []):
        return set(), ['runtime host-read policy requires every exact reviewed role/source']
    return {(HOST_READ_SOURCE, operation, path) for operation, path, _ in found}, []


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
    errors.extend(runtime_host_policy(d)[1])
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


def rust_character(body, start):
    """Classify one apostrophe per Rust Reference char/byte/lifetime grammar.

    Never resume inside an unclassified quoted region: caller fails incomplete.
    Python identifier checks conservatively bound Unicode lifetime spellings;
    unsupported identifier syntax fails closed instead of masking later code.
    """
    byte = start > 0 and body[start - 1] == 'b'
    pos = start + 1
    if pos >= len(body): return None
    if body[pos] == '\\':
        pos += 1
        if pos >= len(body): return None
        escape = body[pos]; pos += 1
        if escape in "nrt\\0'\"": pass
        elif escape == 'x':
            digits = body[pos:pos + 2]
            if len(digits) != 2 or not re.fullmatch('[0-9a-fA-F]{2}', digits): return None
            if not byte and int(digits, 16) > 127: return None
            pos += 2
        elif escape == 'u' and not byte:
            match = re.match(r'\{((?:[0-9a-fA-F]_*){1,6})\}', body[pos:])
            if not match: return None
            scalar = int(match[1].replace('_', ''), 16)
            if scalar > 0x10ffff or 0xd800 <= scalar <= 0xdfff: return None
            pos += match.end()
        else: return None
    elif body[pos] not in "'\n\r\t":
        scalar = ord(body[pos])
        if byte and scalar > 127 or 0xd800 <= scalar <= 0xdfff: return None
        pos += 1
    else: return None
    if body[pos:pos + 1] == "'": return pos + 1, True
    # A lifetime or label is an apostrophe plus identifier, not a quoted string.
    # Byte/escape prefixes cannot become lifetimes on parse failure.
    if byte or body[start + 1] == '\\': return None
    pos = start + 1
    if body.startswith('r#', pos): pos += 2
    begin = pos
    while pos < len(body) and (body[pos] == '_' or ('a' + body[pos]).isidentifier()): pos += 1
    name = body[begin:pos]
    if not name or not name.isidentifier() or body[pos:pos + 1] == "'": return None
    return pos, False


def rust_tokens(body):
    """Small bounded lexer: mask comments/strings, retaining direct string identities.

    This is not a Rust semantic analyzer. Unknown computed/aliased runtime paths
    need manual review; unsupported direct compiler resource arguments fail closed.
    """
    masked = list(body); literals = {}; errors = []; i = 0
    def hide(start, end, literal=False):
        for pos in range(start, end): masked[pos] = ' '
        if literal: masked[start] = '@'
    while i < len(body):
        if body.startswith('//', i):
            end = body.find('\n', i)
            end = len(body) if end < 0 else end
            hide(i, end); i = end; continue
        if body.startswith('/*', i):
            start = i; i += 2; depth = 1
            while i < len(body) and depth:
                if body.startswith('/*', i): depth += 1; i += 2
                elif body.startswith('*/', i): depth -= 1; i += 2
                else: i += 1
            if depth: errors.append('unterminated Rust comment')
            hide(start, i); continue
        # Classify the complete char escape before moving past any apostrophe.
        if body[i] == "'":
            char = rust_character(body, i)
            if char is None:
                errors.append('unsupported Rust character/lifetime token')
                hide(i, len(body)); break
            end, character = char
            if character: hide(i, end)
            i = end; continue
        raw = re.match(r'r(#{0,255})"', body[i:])
        if raw:
            start = i; content = i + raw.end(); end = body.find('"' + raw[1], content)
            if end < 0:
                errors.append('unterminated Rust raw string'); hide(start,len(body)); break
            finish = end + 1 + len(raw[1]); value = body[content:end]
            malformed = body[finish:finish + 1] == '#'
        elif body[i] == '"':
            start = i; content = i + 1; end = content
            while end < len(body):
                if body[end] == '\\': end += 2
                elif body[end] == '"': break
                else: end += 1
            if end >= len(body):
                errors.append('unterminated Rust string'); hide(start,len(body)); break
            finish = end + 1; value = body[content:end]; malformed = False
        else:
            i += 1; continue
        literals[start] = dict(value=value, end=finish,
                               encoded=('\\' in value or '\n' in value or '\r' in value or malformed))
        hide(start,finish,True); i = finish
    return ''.join(masked), literals, errors


def direct_literal(masked, literals, start, wrappers=False):
    while start < len(masked) and (masked[start].isspace() or (wrappers and masked[start] in '&(')):
        start += 1
    return literals.get(start)


def audit_source(root, path, body, host_reads=None):
    masked, literals, lexical = rust_tokens(body)
    errors = [f'{path}: incomplete Rust literal check: {error}' for error in lexical]
    # All valid Rust macro delimiters and comment separators are recognized.
    for m in re.finditer(r'\b(?:include|include_bytes|include_str)\s*!\s*', masked):
        start = m.end()
        parsed = direct_literal(masked,literals,start + 1) if masked[start:start + 1] in '([{' and start < len(masked) else None
        if parsed is None or parsed['encoded']:
            errors.append(f'{path}: unsupported/encoded compiler resource argument')
        elif not inside(root, root / path, parsed['value']):
            errors.append(f'{path}: resource/include escape: {parsed["value"]}')
        else: parsed['compiler_owned'] = True
    # Bare path and nested cfg_attr attributes; string contents/comments are masked.
    for m in re.finditer(r'#\s*!?\s*\[',masked):
        start=m.end();end=start;depth=1
        while end<len(masked) and depth:
            if masked[end]=='[':depth+=1
            elif masked[end]==']':depth-=1
            end+=1
        attribute=masked[start:end-1]
        if not re.match(r'\s*(?:r#)?(?:path\s*=|cfg_attr\s*\()',attribute):continue
        for found in re.finditer(r'\bpath\s*=\s*',attribute):
            parsed=direct_literal(masked,literals,start+found.end())
            if parsed is None or parsed['encoded']:
                errors.append(f'{path}: unsupported/encoded compiler resource argument')
            elif not inside(root,root/path,parsed['value']):
                errors.append(f'{path}: resource/include escape: {parsed["value"]}')
            else: parsed['compiler_owned'] = True
    runtime = r'\b(?:read|read_to_string|read_dir|open|create)\s*\(|\b(?:Path|PathBuf)\s*::\s*(?:new|from)\s*\('
    for m in re.finditer(runtime,masked):
        parsed=direct_literal(masked,literals,m.end(),wrappers=True)
        if parsed is None:continue  # Computed/aliased calls are explicitly manual review.
        value=parsed['value']
        if parsed['encoded']:
            errors.append(f'{path}: unsupported/encoded runtime filesystem argument')
        elif '..' in PurePosixPath(value).parts or not inside(root,root/'server2'/'runtime',value):
            operation = re.sub(r'\s+', '', m.group(0).split('(', 1)[0])
            if (path, operation, value) not in (host_reads or set()):
                errors.append(f'{path}: runtime filesystem escape: {value}')
    # Preserve the previous Rust-wide legacy reference rule, plus sibling assets.
    # Path constructors and command arguments cannot silently weaken that boundary.
    for token in literals.values():
        # Compiler paths are relative to source and already verified owned; e.g.
        # ../config is valid there and is not a runtime-CWD parent traversal.
        if token.get('compiler_owned'): continue
        value=token['value']
        path_like='/' in value or re.search(r'\\(?:x(?:2[fFeE]|5[cC])|u\{0*(?:2[fFeE]|5[cC])\})',value)
        if token['encoded'] and path_like:
            errors.append(f'{path}: encoded path-like Rust literal requires owned plain/raw path')
        elif external_literal(value) or re.search(r'(?:^|/)server/',value):
            errors.append(f'{path}: legacy/external resource reference')
    return errors


def external_literal(value):
    # Canonical direct paths to sibling assets, including absolute checkout references.
    return bool(re.search(r'(?:^|[\s"\'=])(?:[^\s"\']*/)?(?:\.\./)+(?:server|client|packages|config|scripts|deploy)(?:/|$|[\s\"\'])', value) or
                re.search(r'(?:^|[\s"\'=])(?:/[^\s"\']*)/(?:server|client|packages)/(?:[^\s"\']*)', value) or
                re.match(r'^(?:server|client|packages)/', value))


GOLDEN_HANDLERS = {
    'server/app.js', 'server/routes/gateway.js',
    'server/routes/v000705/routeTownForecast.js',
    'server/routes/v000705/routePushNotification.js',
    'server/routes/v000803/routeTownForecast.js',
    'server/routes/v000803/route.nation.js',
    'server/routes/v000901/route.kma.addr.js',
    'server/routes/v000901/route.dsf.coord.js',
    'server/routes/v000902/route.kma.v000902.js',
    'server/routes/v000902/route.dsf.coord.v000902.js',
    'server/routes/v000902/route.push.update.list.js',
    'server/routes/v000903/route.kma.v000903.js',
    'server/routes/v000903/route.dsf.coord.v000903.js',
}


def inert_golden_identities(tree):
    """Exact test fixture role only; no runtime config/file-wide exemption."""
    if not isinstance(tree, dict) or tree.get('schema') != 1 or isinstance(tree.get('schema'), bool):
        raise ValueError('golden provenance schema must be1')
    source = tree.get('source', {})
    files = source.get('files') if isinstance(source, dict) else None
    cases = tree.get('cases')
    if not isinstance(files, dict) or not files or not isinstance(cases, list) or not cases:
        raise ValueError('golden provenance needs source hashes and wire cases')
    for case in cases:
        if not isinstance(case, dict) or case.get('kind') != 'wire' or not isinstance(case.get('handler'), str):
            raise ValueError('golden handler identity type mismatch')
        handler = case['handler']
        if handler not in GOLDEN_HANDLERS or not isinstance(files.get(handler), str) or not re.fullmatch('[0-9a-f]{64}', files[handler]):
            raise ValueError('golden handler is not a known source-hashed identity')
        if not isinstance(case.get('status'), int) or isinstance(case.get('status'), bool) or not 100 <= case['status'] <= 599 or not isinstance(case.get('headers'), list):
            raise ValueError('golden wire response shape mismatch')
        if not isinstance(case.get('body_base64'), str) or not isinstance(case.get('body_sha256'), str):
            raise ValueError('golden raw response shape mismatch')
    # Only this identity is removed from direct-resource scanning. Every other
    # string, including any added runtime_source field, remains scanned below.
    return dict(tree, cases=[{k: v for k, v in c.items() if k != 'handler'} for c in cases])


def audit_nonrust(path, body):
    """Direct executable Python call arguments, decoded JSON, literal shell/config paths.

    Fixture path/payload exemption is exact file + self.write/fixture_symlink data roles, not a file bypass.
    Computed paths, aliases, custom loaders and macros require manual review.
    """
    values = []
    if path.endswith('.py') or (body.startswith('#!') and 'python' in body.splitlines()[0]):
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
        if path == 'server2/tests/golden/records.json':
            try: tree = inert_golden_identities(tree)
            except ValueError as e: return [f'{path}: {e}']
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
    if re.search(r'^jobs:\s*$', body, re.M):
        expected_foundation='name: Server2\non:\n  pull_request:\n    paths:\n      - "server2/**"\n      - ".github/workflows/server2.yml"\npermissions:\n  contents: read\njobs:\n  foundation:\n    runs-on: ubuntu-latest\n    timeout-minutes: 30\n    defaults:\n      run:\n        working-directory: server2\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n      - run: bash tools/ci.sh\n'
        expected_goldens="  goldens:\n    runs-on: ubuntu-latest\n    timeout-minutes: 30\n    defaults:\n      run:\n        working-directory: server2\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n      - uses: actions/setup-node@v4\n        with:\n          node-version: '16.20.2'\n      - uses: actions/setup-python@v5\n        with:\n          python-version: '3.11'\n      - run: python tools/golden/ci.py --install\n"
        # Exact job/source wiring; no env, expressions, arbitrary actions or run steps.
        if body.strip() in {expected_foundation.strip(), (expected_foundation+expected_goldens).strip()}:
            return []
        return ['server2 workflow differs from exact reviewed foundation/goldens wiring']
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
    # S09 approved reads stay explicitly audited in every later task's whole tree.
    # The canonical file is never a blanket source, compiler or encoded exception.
    host_reads = set()
    policy_path = root / 'server2/config/tasks/S09.json'
    if policy_path.exists() or policy_path.is_symlink():
        if policy_path.is_symlink():
            return ['canonical runtime host-read policy cannot be a symlink']
        try:
            canonical = json.loads(policy_path.read_text())
            if not isinstance(canonical, dict):
                return ['invalid canonical runtime host-read declaration']
            policy_errors = declaration_errors(canonical)
            host_reads, role_errors = runtime_host_policy(canonical)
            policy_errors.extend(role_errors)
            if policy_errors:
                return ['canonical S09 policy: ' + e for e in policy_errors]
        except (OSError, ValueError, TypeError):
            return ['incomplete canonical runtime host-read policy']
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
        source = file.suffix in ('.rs', '.toml', '.sh', '.bash', '.zsh', '.py', '.json', '.service', '.conf', '.yaml', '.yml') or file.name in ('Dockerfile', '.env')
        raw_body = file.read_bytes()
        executable = modes.get(path) == '100755' or bool(file.stat().st_mode & 0o111) or raw_body.startswith(b'#!')
        if source or executable:
            try: body = raw_body.decode('utf-8')
            except UnicodeDecodeError:
                if source: errors.append(f'{path}: incomplete non-UTF8 source path check')
                continue  # Binary executables need human dependency/provenance review.
            if '\0' in body:
                if source: errors.append(f'{path}: incomplete binary source path check')
                continue
            if file.name == 'Cargo.toml' or path.startswith('server2/.cargo/'):
                errors.extend(audit_manifest(root, path, body))
            if file.suffix == '.rs': errors.extend(audit_source(root, path, body, host_reads))
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
