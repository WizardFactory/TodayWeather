#!/usr/bin/env bash
set -euo pipefail
exec "${SERVER2_PYTHON:-python3}" tools/ci.py
