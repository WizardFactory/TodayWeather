#!/usr/bin/env bash
# Install Linux test isolation on the ephemeral GitHub-hosted Ubuntu runner.
set -euo pipefail
stage=${1:-all}
case "$stage" in
  placement|python|rust-*|shadow-*|promote) exit 0 ;;
  all) packages=(bubblewrap apparmor musl-tools binutils) ;;
  gnu) packages=(bubblewrap apparmor) ;;
  musl) packages=(musl-tools binutils) ;;
  *) printf 'Unknown Server2 CI stage: %s\n' "$stage" >&2; exit 2 ;;
esac
# A stalled package mirror must fail or retry within minutes instead of holding the
# job until its timeout (one update hung for 54 minutes, #3139).
apt=(sudo apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30)
for attempt in 1 2 3; do
  if timeout 180 "${apt[@]}" update; then
    break
  fi
  if [[ "$attempt" == 3 ]]; then
    printf 'apt-get update failed %s times\n' "$attempt" >&2
    exit 1
  fi
  sleep 10
done
timeout 600 "${apt[@]}" install --yes --no-install-recommends "${packages[@]}"

# Ubuntu 24.04 restricts unprivileged user namespaces. Load the pinned upstream
# executable-specific profile, which permits bwrap setup and denies child
# capabilities, rather than disabling the host-wide user namespace policy.
if [[ "$stage" != "musl" ]] &&
   [[ -r /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]] &&
   [[ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" == "1" ]]; then
  profile=config/ci/bwrap-userns-restrict
  test -f "$profile"
  sudo apparmor_parser --replace "$profile"
fi

# Build the intended x86_64 host artifact before any separately authorized EC2 smoke.
if [[ "$stage" != "gnu" ]]; then
  rustup target add --toolchain 1.99.0 x86_64-unknown-linux-musl
fi
