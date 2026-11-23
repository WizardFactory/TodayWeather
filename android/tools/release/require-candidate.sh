#!/bin/sh
# Passes only when this checkout is exactly the release candidate (docs/operations/android-release.md, step 4):
#   android/tools/release/require-candidate.sh <full 40-character SHA of the commit release CI verified>
# HEAD is that commit, no tracked file differs from it (staged or not, and no file is hidden from that comparison by
# an assume-unchanged or skip-worktree flag), no untracked file exists whatever status.showUntrackedFiles says, and
# no ignored file sits in a source set (android/*/src), where the build would compile it. Ignored files elsewhere
# are the private inputs and build output and do not count. Every git command must succeed.
# Status 1: the checkout is not the candidate, or git failed; 2: usage. It changes nothing.
set -eu
[ $# -eq 1 ] || { echo "usage: require-candidate.sh <full SHA>" >&2; exit 2; }
CANDIDATE=$1
printf '%s' "$CANDIDATE" | grep -Eq '^[0-9a-f]{40}$' || { echo "name the candidate by its full 40-character SHA, not '$CANDIDATE'" >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
refuse() { echo "not the release candidate: $*" >&2; exit 1; }
ROOT=$(git -C "$HERE" rev-parse --show-toplevel) || refuse "git cannot find the checkout"
cd "$ROOT"
head=$(git rev-parse HEAD) || refuse "git cannot read HEAD"
[ "$head" = "$CANDIDATE" ] || refuse "HEAD is $head, the candidate is $CANDIDATE"
changes=$(git status --porcelain --untracked-files=all) || refuse "git status failed"
[ -z "$changes" ] || refuse "the checkout differs from the commit:
$changes"
flags=$(git ls-files -v) || refuse "git ls-files failed"
# git ls-files -v marks assume-unchanged files with a lower-case letter and skip-worktree files with S.
hidden=$(printf '%s\n' "$flags" | grep '^[a-zS] ' || true)
[ -z "$hidden" ] || refuse "files are hidden from git status by an index flag:
$hidden"
ignored=$(git ls-files --others --ignored --exclude-standard -- 'android/*/src') || refuse "git ls-files failed"
[ -z "$ignored" ] || refuse "ignored files in a source set would be built:
$ignored"
echo "the checkout is the candidate $CANDIDATE"
