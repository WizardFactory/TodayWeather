"""Move #Lnnn source anchors in the rewrite docs from one source revision to another.

Anchors into unchanged lines are renumbered from `git diff -U0 OLD NEW`. Anchors that touch a
changed or deleted hunk, or a deleted file, are left as they are and listed for manual review.
Usage (repository root): python3 reports/rewrite-verification/rebaseline-anchors.py OLD NEW [--write]
Run --write once per revision pair: a second run would shift already-moved anchors again, so the
script refuses when rebaseline-flagged.json records that pair as applied.
"""
import argparse
import json
from pathlib import Path
import re
import subprocess

p = argparse.ArgumentParser()
p.add_argument('old')
p.add_argument('new')
p.add_argument('--write', action='store_true', help='rewrite anchors in place; default is a dry run')
args = p.parse_args()
ROOT = Path(__file__).resolve().parents[2]
MARKER = ROOT/'reports/rewrite-verification/rebaseline-flagged.json'
if args.write and MARKER.exists():
    prior = json.loads(MARKER.read_text())
    if prior.get('applied') and (prior.get('old'), prior.get('new')) == (args.old, args.new):
        raise SystemExit(f'Already applied {args.old} -> {args.new}; refusing to shift anchors twice.')
SOURCE_ROOTS = ('client/', 'server/', 'tw.ios/', 'ta.ios/', 'applewatch/')
DOCS = sorted(list((ROOT/'docs/rewrite').rglob('*.md')) + list((ROOT/'reports/rewrite-verification').glob('*.md')))

def git(*cmd):
    return subprocess.check_output(['git', *cmd], cwd=ROOT, text=True)

changed = set(git('diff', '--name-only', args.old, args.new, '--', *SOURCE_ROOTS).split())
deleted = set(git('diff', '--name-only', '--diff-filter=D', args.old, args.new, '--', *SOURCE_ROOTS).split())
hunks = {}
for path in changed - deleted:
    rows = []
    for m in re.finditer(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@', git('diff', '-U0', args.old, args.new, '--', path), re.M):
        a, b, c, d = int(m[1]), int(m[2] or 1), int(m[3]), int(m[4] or 1)
        rows.append((a, b, c, d))
    hunks[path] = rows

def touched(path, lo, hi):
    """True when any old line in [lo, hi] is modified/deleted, or lines are inserted strictly inside the range."""
    for a, b, c, d in hunks[path]:
        if b > 0 and not (a + b - 1 < lo or a > hi):
            return True
        if b == 0 and lo <= a < hi:
            return True
    return False

def shift(path, line):
    delta = 0
    for a, b, c, d in hunks[path]:
        last_old = a + b - 1 if b > 0 else a
        if last_old < line:
            delta += d - b
    return line + delta

link = re.compile(r'\]\(([^)\s#]+)#L(\d+)(?:-L(\d+))?\)')
report = {'old': args.old, 'new': args.new, 'applied': args.write, 'renumbered': 0, 'unchanged': 0, 'flagged': []}
for doc in DOCS:
    text = doc.read_text()
    def fix(m):
        rel = (doc.parent/m[1]).resolve()
        try:
            rel = rel.relative_to(ROOT).as_posix()
        except ValueError:
            return m[0]
        if rel not in changed:
            return m[0]
        lo = int(m[2]); hi = int(m[3] or m[2])
        line_no = text.count('\n', 0, m.start()) + 1
        if rel in deleted or touched(rel, lo, hi):
            report['flagged'].append({'doc': doc.relative_to(ROOT).as_posix(), 'doc_line': line_no, 'link': m[0][2:-1],
                                      'reason': 'file deleted' if rel in deleted else 'anchor touches a changed hunk'})
            return m[0]
        nlo, nhi = shift(rel, lo), shift(rel, hi)
        if (nlo, nhi) == (lo, hi):
            report['unchanged'] += 1
            return m[0]
        report['renumbered'] += 1
        return f']({m[1]}#L{nlo}' + (f'-L{nhi}' if m[3] else '') + ')'
    new_text = link.sub(fix, text)
    if args.write and new_text != text:
        doc.write_text(new_text)
print(json.dumps({k: v for k, v in report.items() if k != 'flagged'} | {'flagged_count': len(report['flagged'])}, indent=2))
if args.write or not (MARKER.exists() and json.loads(MARKER.read_text()).get('applied')):
    MARKER.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
