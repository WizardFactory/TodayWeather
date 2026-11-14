#!/usr/bin/env bash
# Install the server2 log pipeline on a Linux host (run as root).
#
#   install.sh [--collector-tarball PATH]
#
# Installs the pinned collector (Vector) after checking its SHA-256 against
# collector.json, the renderer, the server2 and collector units and the journal
# settings, then enables both units. Without --collector-tarball the pinned
# release is downloaded. It does not install the server2 binary or its .env:
# those come from the release procedure (/opt/server2/bin/server2 and
# /opt/server2/config/.env). It never starts server2.service or the collector;
# it starts only the status timer, which does nothing while the collector is stopped.
set -euo pipefail

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
tarball=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --collector-tarball) tarball=${2:?}; shift 2 ;;
    *) echo "usage: install.sh [--collector-tarball PATH]" >&2; exit 2 ;;
  esac
done
[[ $(id -u) -eq 0 ]] || { echo 'install.sh: run as root' >&2; exit 2; }

arch=$(uname -m)
read -r url sha member < <(python3 -I - "$here/collector.json" "$arch" <<'PY'
import json, sys
artifact = json.load(open(sys.argv[1]))['artifacts'].get(sys.argv[2])
if artifact is None:
    sys.exit('install.sh: no pinned collector for this architecture')
print(artifact['url'], artifact['sha256'], artifact['binary'])
PY
)

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
if [[ -z "$tarball" ]]; then
  tarball="$work/collector.tar.gz"
  curl --fail --silent --show-error --location --proto '=https' --max-time 300 -o "$tarball" "$url"
fi
echo "$sha  $tarball" | sha256sum --check --status || { echo 'install.sh: collector archive hash mismatch' >&2; exit 1; }
tar -xzf "$tarball" -C "$work" "$member"

getent group server2 >/dev/null || groupadd --system server2
getent passwd server2 >/dev/null || useradd --system --gid server2 --home-dir /opt/server2 --no-create-home --shell /usr/sbin/nologin server2
install -d -m 0755 /opt/server2 /opt/server2/bin /opt/server2/logging
install -d -m 0750 -o root -g server2 /opt/server2/config
install -m 0755 "$work/$member" /opt/server2/logging/vector
install -m 0644 "$here/render.py" "$here/status.py" "$here/spot_watch.py" "$here/collector.json" /opt/server2/logging/
install -m 0644 "$here/units/server2.service" "$here/units/server2-logs.service" \
  "$here/units/server2-logs-status.service" "$here/units/server2-logs-status.timer" \
  "$here/units/server2-logs-watch.service" /etc/systemd/system/
install -m 0644 "$here/units/journald@server2.conf" /etc/systemd/journald@server2.conf
install -d -m 0755 /etc/systemd/journald.conf.d
install -m 0644 "$here/units/journald-system.conf" /etc/systemd/journald.conf.d/server2-system.conf

systemctl daemon-reload
systemctl restart systemd-journald.service
systemctl enable server2.service server2-logs.service server2-logs-status.timer server2-logs-watch.service
# The status timer only acts while the collector runs (its service checks that).
systemctl start server2-logs-status.timer
echo "install.sh: installed $(/opt/server2/logging/vector --version | head -n 1)"
