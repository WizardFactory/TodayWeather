#!/bin/sh
# Exports the release candidate's android/ tree to a new directory, where the release is built
# (docs/operations/android-release.md, step 4):
#   android/tools/release/export-candidate.sh <full 40-character SHA> <new directory outside the checkout>
# The release is built from the export and never from a checkout: a checkout can hold changed, untracked, ignored
# or index-flagged files that a build would take in, and an export holds the commit's files only. After the
# export the tool computes Git's tree hash of the exported android/ directory and requires it to equal the
# commit's, so the build directory is that commit's tree or the tool fails. It writes the SHA to <directory>/CANDIDATE.
# Status 1: no such commit, a directory that exists with content or lies inside the checkout, or an export that is
# not the commit's tree (the directory is removed again); 2: usage. The checkout is not changed.
set -eu
[ $# -eq 2 ] || { echo "usage: export-candidate.sh <full SHA> <new directory>" >&2; exit 2; }
CANDIDATE=$1
DEST=$2
printf '%s' "$CANDIDATE" | grep -Eq '^[0-9a-f]{40}$' || { echo "name the candidate by its full 40-character SHA, not '$CANDIDATE'" >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
refuse() { echo "no export: $*" >&2; exit 1; }
ROOT=$(git -C "$HERE" rev-parse --show-toplevel) || refuse "git cannot find the checkout"
git -C "$ROOT" cat-file -e "$CANDIDATE^{commit}" 2>/dev/null || refuse "no commit $CANDIDATE in this repository (fetch it first)"
expected=$(git -C "$ROOT" rev-parse --verify --quiet "$CANDIDATE:android") || refuse "the commit has no android/ directory"
if [ -e "$DEST" ]; then
    [ -d "$DEST" ] && [ -z "$(ls -A "$DEST")" ] || refuse "$DEST exists and is not empty"
else
    mkdir -p "$DEST"
fi
DEST=$(cd "$DEST" && pwd -P)
case "$DEST/" in "$(cd "$ROOT" && pwd -P)"/*) rmdir "$DEST" 2>/dev/null || true; refuse "$DEST must be outside the checkout $ROOT" ;; esac
WORK=$(mktemp -d)
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT
discard() { rm -rf "$DEST"; refuse "$*"; }

git -C "$ROOT" archive --format=tar "$CANDIDATE" android > "$WORK/export.tar" || discard "git archive failed"
tar -xf "$WORK/export.tar" -C "$DEST" || discard "cannot unpack the export"
# Git's tree hash of what was written, from a repository of its own with no configuration and every file added.
actual=$(
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_DIR="$WORK/verify"
    git init -q && GIT_WORK_TREE="$DEST" git add -A -f . > /dev/null && git rev-parse "$(git write-tree):android"
) || discard "cannot hash the export"
[ "$actual" = "$expected" ] || discard "the export (tree $actual) is not the tree of $CANDIDATE:android ($expected)"
printf '%s\n' "$CANDIDATE" > "$DEST/CANDIDATE"
echo "exported $CANDIDATE to $DEST/android (tree $expected)"
