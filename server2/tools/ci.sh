#!/usr/bin/env bash
set -euo pipefail
if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  bash tools/prepare-ci.sh
fi
exec "${SERVER2_PYTHON:-python3}" tools/ci.py
