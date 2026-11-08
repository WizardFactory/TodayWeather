#!/bin/sh
# Checks the cleanup of run-upgrade-test.sh with an adb test double (test/adb): the network comes back only
# when the package list can be read and has neither package; otherwise the script exits 5 and the device
# stays offline. Needs no device.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir "$TMP/bin" && cp "$HERE/test/adb" "$TMP/bin/adb"
failed=0
check() { # case, expected exit status, expected count of network-restoring calls
    : > "$TMP/log"
    status=0
    FAKE_ADB_CASE=$1 FAKE_ADB_LOG="$TMP/log" PATH="$TMP/bin:$PATH" ANDROID_SERIAL=emulator-5554 \
        sh "$HERE/run-upgrade-test.sh" "$TMP/missing.apk" "$TMP/out" >/dev/null 2>&1 || status=$?
    restored=$(grep -cE "airplane-mode disable|svc wifi enable|svc data enable" "$TMP/log" || true)
    if [ "$status" = "$2" ] && [ "$restored" = "$3" ]; then
        echo "ok   $1: exit $status, $restored network calls"
    else
        echo "FAIL $1: exit $status (want $2), $restored network calls (want $3)"; failed=1
    fi
}
check list-fails 5 0
check pm-error 5 0
check still-installed 5 0
check removed 1 3
exit $failed
