#!/usr/bin/env bash
# Install Linux test isolation on the ephemeral GitHub-hosted Ubuntu runner.
set -euo pipefail
sudo apt-get update
sudo apt-get install --yes --no-install-recommends bubblewrap apparmor

# Ubuntu 24.04 restricts unprivileged user namespaces. Load the pinned upstream
# executable-specific profile, which permits bwrap setup and denies child
# capabilities, rather than disabling the host-wide user namespace policy.
if [[ -r /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]] &&
   [[ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" == "1" ]]; then
  profile=config/ci/bwrap-userns-restrict
  test -f "$profile"
  sudo apparmor_parser --replace "$profile"
fi
