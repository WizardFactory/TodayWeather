#!/usr/bin/env bash
# Verify and render the staged host bundle; no service/cloud mutation here.
# Use the qualified provision.py lifecycle for installation and acquisition.
set -euo pipefail
if [[ "$#" -ne 2 || "$1" != "--check" ]]; then
  echo 'usage: bootstrap.sh --check <new-unit-output-directory>' >&2
  exit 2
fi
bundle=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
exec python3 "$bundle/coordinator.py" render-host --launch "$bundle/launch.json" --output "$2"
