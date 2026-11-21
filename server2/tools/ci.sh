#!/usr/bin/env bash
set -euo pipefail
if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  bash tools/prepare-ci.sh "${1:-all}"
fi
exec "${SERVER2_PYTHON:-python3}" tools/ci.py "$@"
