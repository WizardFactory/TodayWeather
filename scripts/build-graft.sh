#!/bin/sh
# Reproduce the maintained source scope even when graft/ has not been built yet.
set -eu
export DO_NOT_TRACK=1
if ! command -v graft >/dev/null 2>&1; then
  echo 'Graft CLI is not on PATH; install @nanonets/graft as described in docs/development/graft.md.' >&2
  exit 127
fi
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec graft build "$repo_root" \
  --only-dir server --only-dir client/www/js --only-dir client/scripts \
  --only-dir web/src --only-dir packages --only-dir scripts --only-dir infra
