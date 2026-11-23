#!/bin/sh
# Checks instrumentation_passed (offline.sh) against recorded `am instrument -w -r` outputs. Needs no device.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/offline.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
failed=0
# name, expected tests, expected status (0 passes), then the output's lines; $ADB is the status adb ended with
ADB=0
check() {
    name=$1; count=$2; want=$3; shift 3
    printf '%s\r\n' "$@" > "$TMP/$name.txt"
    got=0
    instrumentation_passed "$TMP/$name.txt" "$count" "$ADB" || got=1
    if [ "$got" = "$want" ]; then echo "ok   $name"; else echo "FAIL $name: status $got, want $want"; failed=1; fi
}
START="INSTRUMENTATION_STATUS_CODE: 1"
DONE="INSTRUMENTATION_CODE: -1"
check passed 2 0 "$START" "INSTRUMENTATION_STATUS_CODE: 0" "$START" "INSTRUMENTATION_STATUS_CODE: 0" "OK (2 tests)" "$DONE"
check assumption-skipped 1 1 "$START" "INSTRUMENTATION_STATUS_CODE: -4" "OK (1 test)" "$DONE"
check one-skipped-of-two 2 1 "$START" "INSTRUMENTATION_STATUS_CODE: 0" "$START" "INSTRUMENTATION_STATUS_CODE: -4" "OK (2 tests)" "$DONE"
check ignored 1 1 "INSTRUMENTATION_STATUS_CODE: -3" "OK (0 tests)" "$DONE"
check failed 1 1 "$START" "INSTRUMENTATION_STATUS_CODE: -2" "FAILURES!!!" "$DONE"
check error 1 1 "$START" "INSTRUMENTATION_STATUS_CODE: -1" "$DONE"
check fewer-than-expected 2 1 "$START" "INSTRUMENTATION_STATUS_CODE: 0" "OK (1 test)" "$DONE"
check more-than-expected 1 1 "$START" "INSTRUMENTATION_STATUS_CODE: 0" "$START" "INSTRUMENTATION_STATUS_CODE: 0" "$DONE"
check process-crashed 1 1 "$START" "INSTRUMENTATION_RESULT: shortMsg=Process crashed." "INSTRUMENTATION_CODE: 0"
check unfinished 1 1 "$START" "INSTRUMENTATION_STATUS_CODE: 0"
check empty 1 1 ""
# A passing output does not make up for an adb that failed.
ADB=7
check passed-but-adb-failed 2 1 "$START" "INSTRUMENTATION_STATUS_CODE: 0" "$START" "INSTRUMENTATION_STATUS_CODE: 0" "OK (2 tests)" "$DONE"
exit $failed
