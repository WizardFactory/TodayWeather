#!/bin/sh
# Runs the named device suites of release CI on one emulator and reports every result
# (docs/development/ci-tiers.md, .github/workflows/android-release.yml):
#   ANDROID_SERIAL=emulator-5554 android/tools/release-ci/run-suites.sh <out-dir> <suite> [<suite> ...]
# Suites: device-tests (run-device-tests.sh), parity, shell-fit, window-fit (the existing runners named below;
# shell-fit is for a tablet or a foldable; parity and window-fit accept only an AVD named tw_*, and "fold" in
# the name turns the fold steps on). A failed suite does not stop the next one, so one run shows
# every failure; the status is 1 when any suite failed and 2 for an unknown suite. Each runner refuses anything
# but an emulator, keeps it offline while the app is installed and removes the app. Requires ./gradlew
# assembleDebug assembleDebugAndroidTest.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
TOOLS=$HERE/..
OUT=${1:?pass an evidence directory}
shift
[ $# -gt 0 ] || { echo "name at least one suite" >&2; exit 2; }
for suite in "$@"; do
    case "$suite" in device-tests|parity|shell-fit|window-fit) ;; *) echo "unknown suite $suite" >&2; exit 2 ;; esac
done
mkdir -p "$OUT"
: > "$OUT/summary.txt"
failed=0
for suite in "$@"; do
    case "$suite" in
        device-tests) runner=$HERE/run-device-tests.sh ;;
        parity) runner=$TOOLS/parity-reference/run-native-smoke.sh ;;
        shell-fit) runner=$TOOLS/large-screen/run-shell-fit.sh ;;
        window-fit) runner=$TOOLS/large-screen/run-window-fit.sh ;;
    esac
    echo "== $suite"
    start=$(date +%s)
    status=0
    sh "$runner" "$OUT/$suite" > "$OUT/$suite.log" 2>&1 || status=$?
    seconds=$(($(date +%s) - start))
    if [ "$status" = 0 ]; then
        echo "passed $suite ${seconds}s" | tee -a "$OUT/summary.txt"
    else
        tail -n 60 "$OUT/$suite.log"
        echo "FAILED $suite exit $status ${seconds}s" | tee -a "$OUT/summary.txt"
        failed=1
    fi
done
exit $failed
