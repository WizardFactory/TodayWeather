#!/usr/bin/env bash
# Install Linux test isolation on the ephemeral GitHub-hosted Ubuntu runner.
set -euo pipefail
sudo apt-get update
sudo apt-get install --yes --no-install-recommends bubblewrap
