#!/usr/bin/env bash
# Install Linux test isolation on the ephemeral GitHub-hosted Ubuntu runner.
set -euo pipefail
sudo apt-get update
sudo apt-get install --yes --no-install-recommends bubblewrap apparmor

# Ubuntu 24.04 restricts unprivileged user namespaces. Load the distro's
# executable-specific profile, which permits bwrap setup and denies child
# capabilities, rather than disabling the host-wide user namespace policy.
if [[ -r /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]] &&
   [[ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" == "1" ]]; then
  profile=/etc/apparmor.d/bwrap-userns-restrict
  if [[ ! -f "$profile" ]]; then
    profile=/usr/share/apparmor/extra-profiles/bwrap-userns-restrict
  fi
  test -f "$profile"
  sudo apparmor_parser --replace "$profile"
fi
