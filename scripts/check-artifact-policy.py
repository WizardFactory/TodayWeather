#!/usr/bin/env python3
"""Check staged or committed repository artifacts without changing files or the index."""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import posixpath
import re
import struct
import subprocess
import sys
from urllib.parse import unquote, urlsplit

FORBIDDEN = ('reports/', '.archify/', '.planning/', 'test-results/', 'playwright-report/')
POLICY = 'scripts/artifact-policy.json'
MANIFEST = 'docs/rewrite/screenshots/manifest.json'
TEXT_ROOTS = ('docs/', 'intent/', 'specs/', 'plans/', 'scripts/verification/')
ROOT_DOCS = {'README.md', 'AGENTS.md', 'CLAUDE.md', 'server/test/offline/README.md'}


class Invalid(Exception):
    pass


def git(root, *args, data=None):
    p = subprocess.run(['git', '-C', str(root), *args], input=data, capture_output=True)
    if p.returncode:
        raise Invalid(p.stderr.decode(errors='replace').strip() or 'Git command failed')
    return p.stdout


class Snapshot:
    def __init__(self, root, revision=None):
        self.root, self.revision, self.entries, self.cache = root, revision, {}, {}
        args = ('ls-files', '--stage', '-z') if revision is None else ('ls-tree', '-r', '-z', revision)
        for row in git(root, *args).split(b'\0'):
            if not row:
                continue
            meta, name = row.split(b'\t', 1)
            fields = meta.decode().split()
            if revision is None:
                mode, oid, stage = fields
                if stage != '0':
                    raise Invalid('Unmerged index: ' + name.decode())
            else:
                mode, _, oid = fields
            self.entries[name.decode()] = (mode, oid)

    def read(self, name):
        if name not in self.entries:
            raise Invalid('Missing tracked file: ' + name)
        if name not in self.cache:
            self.cache[name] = git(self.root, 'cat-file', 'blob', self.entries[name][1])
        return self.cache[name]

    def target_exists(self, name):
        # Resolve tracked symlinks using the snapshot, never the host filesystem.
        for _ in range(16):
            if name == '.':
                return bool(self.entries)
            parts = name.split('/')
            for i in range(1, len(parts) + 1):
                prefix = '/'.join(parts[:i])
                if self.entries.get(prefix, ('',))[0] == '120000':
                    link = self.read(prefix).decode().strip()
                    if link.startswith('/'):
                        return False
                    name = posixpath.normpath(posixpath.join(posixpath.dirname(prefix), link, *parts[i:]))
                    if name == '..' or name.startswith('../'):
                        return False
                    break
            else:
                return name in self.entries or any(p.startswith(name.rstrip('/') + '/') for p in self.entries)
        return False


class HTMLLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key in ('src', 'href') and value:
                self.links.append(value)


def local_links(text, markdown):
    if markdown:
        text = re.sub(r'^\s*(`{3,}|~{3,})[^\n]*\n.*?^\s*\1\s*$', '', text, flags=re.M | re.S)
        # Inline code is documentation, not a rendered link.
        text = re.sub(r'`[^`\n]+`', '', text)
        for m in re.finditer(r'!?\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["\'][^\n]*?["\'])?\s*\)', text):
            yield m[1] or m[2]
        for m in re.finditer(r'^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))', text, flags=re.M):
            yield m[1] or m[2]
    parser = HTMLLinks()
    parser.feed(text)
    yield from parser.links


def resolve(owner, raw):
    url = urlsplit(raw)
    if url.scheme == 'file':
        raise Invalid('Local file URI is not portable: ' + raw)
    if url.scheme or url.netloc or not url.path:
        return None
    path = unquote(url.path)
    if path.startswith('/'):
        return posixpath.normpath(path.lstrip('/'))
    return posixpath.normpath(posixpath.join(posixpath.dirname(owner), path))


def check_snapshot(snap):
    errors = []
    for name in snap.entries:
        if name.startswith(FORBIDDEN):
            errors.append(name + ': generated/local output must not be tracked')
        if name.endswith(('.md', '.html')) and (name.startswith(TEXT_ROOTS) or name in ROOT_DOCS):
            text = snap.read(name).decode(errors='replace')
            for raw in local_links(text, name.endswith('.md')):
                try:
                    target = resolve(name, raw)
                except Invalid as exc:
                    errors.append(f'{name}: {exc}')
                    continue
                if target is None:
                    continue
                if target == '..' or target.startswith('../') or not snap.target_exists(target):
                    errors.append(f'{name}: missing tracked target {raw}')
    if MANIFEST in snap.entries:
        try:
            entries = json.loads(snap.read(MANIFEST))
            for item in entries:
                target = resolve(MANIFEST, item['file'])
                data = snap.read(target)
                if data[:8] != b'\x89PNG\r\n\x1a\n' or len(data) < 24:
                    raise Invalid('Invalid reference PNG: ' + target)
                if hashlib.sha256(data).hexdigest() != item['sha256']:
                    errors.append('Reference hash mismatch: ' + target)
                if list(struct.unpack('>II', data[16:24])) != item['pixels']:
                    errors.append('Reference dimensions mismatch: ' + target)
                if item.get('diagnostic'):
                    diagnostic = resolve(MANIFEST, item['diagnostic'])
                    if not snap.target_exists(diagnostic):
                        errors.append('Missing tracked capture diagnostic: ' + diagnostic)
            listed = {resolve(MANIFEST, item['file']) for item in entries}
            for name in snap.entries:
                if name.startswith('docs/rewrite/screenshots/') and name.endswith('.png') and name not in listed:
                    errors.append('Reference PNG missing from manifest: ' + name)
        except (ValueError, KeyError, TypeError, Invalid) as exc:
            errors.append('Screenshot manifest: ' + str(exc))
    return sorted(set(errors))


def commit_id(root, value):
    return git(root, 'rev-parse', '--verify', '--end-of-options', value + '^{commit}').decode().strip()


def history(root, base, tip):
    tip = commit_id(root, tip)
    snap = Snapshot(root, tip)
    exclusions = []
    if base and set(base) != {'0'}:
        exclusions.append(commit_id(root, base))
    if POLICY in snap.entries:
        policy = json.loads(snap.read(POLICY))
        boundary = policy.get('history_base')
        if boundary:
            exclusions.append(commit_id(root, boundary))
    if not exclusions:
        raise Invalid('Cannot establish outgoing history: provide a base or a committed history_base policy')
    commits = git(root, 'rev-list', '--reverse', tip, *['^' + x for x in exclusions]).decode().splitlines()
    # Always check the selected tip even when it was already present remotely.
    return list(dict.fromkeys(commits + [tip]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default='.')
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--staged', action='store_true')
    mode.add_argument('--commit')
    mode.add_argument('--range', nargs=2, metavar=('BASE', 'HEAD'))
    mode.add_argument('--pre-push', metavar='REMOTE', help='read Git pre-push ref updates from stdin')
    args = parser.parse_args()
    root = Path(args.root).resolve()
    try:
        if args.staged:
            snapshots = [(None, Snapshot(root))]
        else:
            commits = []
            if args.commit:
                commits = [commit_id(root, args.commit)]
            elif args.range:
                commits = history(root, *args.range)
            else:
                for line in sys.stdin:
                    fields = line.split()
                    if len(fields) != 4:
                        raise Invalid('Malformed pre-push input')
                    _, local, _, remote = fields
                    if not all(re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}', v) for v in (local, remote)):
                        raise Invalid('Invalid pre-push object ID')
                    if set(local) == {'0'}:
                        continue
                    commits.extend(history(root, remote, local))
            snapshots = [(c, Snapshot(root, c)) for c in dict.fromkeys(commits)]
        failures = []
        for revision, snap in snapshots:
            failures.extend(f'{revision[:12] if revision else "index"}: {e}' for e in check_snapshot(snap))
        if failures:
            print('\n'.join(failures), file=sys.stderr)
            print(f'Artifact policy failed: {len(failures)} finding(s). Files and index were not changed.', file=sys.stderr)
            return 1
        print(f'Artifact policy passed: {len(snapshots)} snapshot(s); files and index were not changed.')
        return 0
    except (Invalid, ValueError, OSError) as exc:
        print('Artifact policy could not complete: ' + str(exc), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
