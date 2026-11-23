#!/bin/sh
# Checks the release CI suites' runners with an adb test double (test/adb): a suite passes only when every test
# passed and adb itself succeeded. An instrumentation that prints a passing result while adb exits with an error,
# and a test skipped by an assumption, must fail the runner and run-suites.sh. Needs no device.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir "$TMP/bin" "$TMP/empty"
cp "$HERE/test/adb" "$TMP/bin/adb"
# The runners wait for the device between steps; the double answers at once.
printf '#!/bin/sh\nexit 0\n' > "$TMP/bin/sleep"
chmod +x "$TMP/bin/adb" "$TMP/bin/sleep"
failed=0
check() { # suite, case, adb status, expected status of run-suites.sh
    status=0
    FAKE_ADB_CASE=$2 FAKE_ADB_STATUS=$3 FAKE_ADB_EMPTY="$TMP/empty" PATH="$TMP/bin:$PATH" ANDROID_SERIAL=emulator-5554 \
        sh "$HERE/run-suites.sh" "$TMP/out-$1-$2-$3" "$1" > "$TMP/log" 2>&1 || status=$?
    if [ "$status" = "$4" ]; then
        echo "ok   $1: $2 output, adb status $3 -> exit $status"
    else
        echo "FAIL $1: $2 output, adb status $3 -> exit $status (want $4)"; tail -n 15 "$TMP/log"; failed=1
    fi
}
for suite in device-tests parity shell-fit window-fit; do
    check "$suite" passed 0 0
    check "$suite" passed 7 1
    check "$suite" skipped 0 1
done
exit $failed
