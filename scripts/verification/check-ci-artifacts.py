"""Select a CI history range, then run the unchanged read-only artifact checker."""
import argparse
from pathlib import Path
import subprocess
import sys


def check_args(root, event, base, head, default_branch):
    zero = '0' * 40
    if event == 'push' and base == zero:
        if not default_branch:
            raise ValueError('New branch push requires the remote default branch')
        # Only the published default branch supplies the baseline. Excluding all
        # fetched remote refs could hide this task's bad intermediate commits.
        commit = subprocess.check_output([
            'git', '-C', str(root), 'rev-parse', '--verify', '--end-of-options', head + '^{commit}'
        ], stderr=subprocess.PIPE, text=True).strip()
        base = subprocess.check_output([
            'git', '-C', str(root), 'merge-base', '--', commit,
            'refs/remotes/origin/' + default_branch
        ], stderr=subprocess.PIPE, text=True).strip()
        if not base:
            raise ValueError('New branch push has no default-branch merge base')
    if event in ('push', 'pull_request'):
        if not base or base == zero:
            raise ValueError('Push and PR checks require a valid history baseline')
        return ['--range', base, head]
    if event == 'workflow_dispatch':
        return ['--commit', head]
    raise ValueError('Unsupported artifact CI event')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default='.')
    parser.add_argument('--event', required=True)
    parser.add_argument('--base', default='')
    parser.add_argument('--head', required=True)
    parser.add_argument('--default-branch', default='')
    args = parser.parse_args()
    root = Path(args.root).resolve()
    try:
        selected = check_args(root, args.event, args.base, args.head, args.default_branch)
    except (ValueError, subprocess.CalledProcessError):
        print('Artifact CI could not establish a valid event history baseline.', file=sys.stderr)
        return 2
    print('Artifact CI:', args.event, ' '.join(selected), flush=True)
    checker = Path(__file__).resolve().parents[1] / 'check-artifact-policy.py'
    return subprocess.call([sys.executable, str(checker), '--root', str(root), *selected])


if __name__ == '__main__':
    sys.exit(main())
