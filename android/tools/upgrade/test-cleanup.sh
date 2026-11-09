#!/bin/sh
# Checks the cleanup of run-upgrade-test.sh with an adb test double (test/adb): the network comes back only
# when the package query succeeds with a complete list that has neither package; a failed, partial or
# mixed answer or a remaining package makes the script exit 5 and the device stays offline. The same answers
# make run-production-weather.sh, which runs online, take the device offline and exit 5. Needs no device.
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
check partial-then-fails 5 0
check pm-error 5 0
check mixed-error 5 0
check still-installed 5 0
check removed 1 3

# run-production-weather.sh runs online: unless both packages are confirmed gone it takes the device offline
# (airplane mode, Wi-Fi and data off) and exits 5.
online() { # case, expected exit status, expected count of network-cutting calls
    : > "$TMP/log"
    status=0
    FAKE_ADB_ONLINE=1 FAKE_ADB_CASE=$1 FAKE_ADB_LOG="$TMP/log" PATH="$TMP/bin:$PATH" ANDROID_SERIAL=emulator-5554 \
        sh "$HERE/../emulator/run-production-weather.sh" "$TMP/out" >/dev/null 2>&1 || status=$?
    cut=$(grep -cE "airplane-mode enable|svc wifi disable|svc data disable" "$TMP/log" || true)
    if [ "$status" = "$2" ] && [ "$cut" = "$3" ]; then
        echo "ok   online $1: exit $status, $cut network-cutting calls"
    else
        echo "FAIL online $1: exit $status (want $2), $cut network-cutting calls (want $3)"; failed=1
    fi
}
online list-fails 5 3
online partial-then-fails 5 3
online pm-error 5 3
online mixed-error 5 3
online still-installed 5 3
online removed 1 0
exit $failed
