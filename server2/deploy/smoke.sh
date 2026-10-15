#!/usr/bin/env bash
# S19 integrated smoke: drives the actual release binary (and, where the S3 peer is
# needed, the release loopback_server example: the same process with its S3 root on the
# peer) with a local S3-compatible peer, recorded providers and a frozen legacy origin,
# all on task-owned loopback listeners and in an empty working directory. Stages: reused foundation/S10 smokes, family scenarios with metrics
# assertions, offline paired replay (with a perturbation self-check) and the
# cache-aware rollback rehearsal. It never reads an operator .env, calls a live
# provider, creates AWS resources, deploys or mirrors traffic.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: deploy/smoke.sh [--binary PATH] [--out DIR] [--family NAME]... [--skip-reused] [--skip-deadlines]

  --binary PATH      release binary (default: target/release/server2 under server2/)
  --out DIR          report directory (default: <repo>/reports/server2-smoke/<UTC stamp>, ignored by Git)
  --family NAME      ready family to verify; repeatable (default: every ready family)
  --skip-reused      skip the existing foundation and S10 gateway smokes (CI already runs them)
  --skip-deadlines   skip the stalled-dependency deadline checks in the rollback rehearsal
USAGE
}

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
binary="$here/target/release/server2"
out=""
families=()
reuse=1
deadlines=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --binary) binary="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --family) families+=("$2"); shift 2 ;;
    --skip-reused) reuse=0; shift ;;
    --skip-deadlines) deadlines=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

py="${SERVER2_PYTHON:-python3}"
if [[ ! -x "$binary" ]]; then
  echo "release binary not found: $binary (run: cargo build --locked --release)" >&2
  exit 2
fi
# S10e: S3 and provider roots are not settings; phases that need the loopback peers run the
# release loopback_server example (the same server2 process) built beside the binary.
peer_binary="$(dirname "$binary")/examples/loopback_server"
if [[ ! -x "$peer_binary" ]]; then
  echo "release loopback_server example not found: $peer_binary (run: cargo build --locked --release --example loopback_server)" >&2
  exit 2
fi
if [[ ${#families[@]} -eq 0 ]]; then
  families=(gateway)
fi
out="${out:-$(cd "$here/.." && pwd)/reports/server2-smoke/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$out"
log="$out/smoke.log"

run() {
  echo "+ $*" | tee -a "$log"
  "$@" 2>&1 | tee -a "$log"
}

family_args=()
for family in "${families[@]}"; do
  family_args+=(--family "$family")
done

if [[ $reuse -eq 1 ]]; then
  run "$py" "$here/tools/smoke.py" --binary "$binary"
  for family in "${families[@]}"; do
    if [[ "$family" == gateway ]]; then
      run "$py" "$here/tools/gateway_smoke.py" --binary "$binary"
    fi
  done
fi
run "$py" "$here/tools/shadow/smoke.py" --binary "$binary" "${family_args[@]}" --report "$out/scenarios.json"
for family in "${families[@]}"; do
  run "$py" "$here/tools/shadow/replay.py" --binary "$binary" --family "$family" --self-check --report "$out/replay-$family.json"
  if [[ $deadlines -eq 1 ]]; then
    run "$py" "$here/tools/shadow/rollback.py" --binary "$binary" --family "$family" --report "$out/rollback-$family.json"
  else
    run "$py" "$here/tools/shadow/rollback.py" --binary "$binary" --family "$family" --skip-deadlines --report "$out/rollback-$family.json"
  fi
done
echo "PASS S19 integrated smoke (${families[*]}); reports in $out" | tee -a "$log"
