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
sudo apt-get update
sudo apt-get install --yes --no-install-recommends "${packages[@]}"

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
