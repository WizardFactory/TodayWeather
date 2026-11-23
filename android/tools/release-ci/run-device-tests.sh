#!/bin/sh
# Release CI's device tests without a runner of their own (docs/development/ci-tiers.md): the instrumented
# classes that need no private input, no Cordova build and no network, each in a new install on the emulator.
#   ANDROID_SERIAL=emulator-5554 android/tools/release-ci/run-device-tests.sh <out-dir> [Class[:name=value] ...]
# Without classes it runs the release list below. A class passes when every test it declares ran and passed:
# a failed, crashed, ignored or assumption-skipped test (which the plain output still counts in `OK (N tests)`)
# ends the run with status 1, as does a class that reports fewer tests than it declares.
# Emulator only and offline while this build is installed (tools/emulator/offline.sh). Requires
# ./gradlew assembleDebug assembleDebugAndroidTest. The classes with their own runner are run by it:
# ParityDeviceTest (parity-reference/run-native-smoke.sh), ShellFitDeviceTest and WindowFitDeviceTest
# (large-screen/), ChartDeviceTest (chart-reference/device-smoke.sh), SettingsHandoffTest
# (emulator/run-settings-handoffs.sh).
# A test that returns early without its runner argument (EntryIntentTest without migration=hold) still counts as
# passed: name the argument its runner passes.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/../emulator/offline.sh"
emulator_guard
OUT=${1:?pass an evidence directory}
shift
# EntryIntentTest holds the migration, as tools/upgrade/run-upgrade-test.sh runs it after the Cordova upgrade.
[ $# -gt 0 ] || set -- CoreOnDeviceTest PullRefreshDeviceTest ForecastInterstitialDeviceTest EntryIntentTest:migration=hold
APP=$HERE/../../app/build/outputs/apk
SOURCES=$HERE/../../app/src/androidTest/java/net/wizardfactory/todayweather
trap offline_cleanup EXIT
trap 'exit 130' INT TERM

go_offline
mkdir -p "$OUT"
{
    echo "sdk $(adb shell getprop ro.build.version.sdk | tr -d '\r')"
    echo "model $(adb shell getprop ro.product.model | tr -d '\r')"
    echo "abi $(adb shell getprop ro.product.cpu.abi | tr -d '\r')"
} > "$OUT/device.txt"
for spec in "$@"; do
    class=${spec%%:*}
    argument=""
    [ "$class" = "$spec" ] || argument="-e ${spec#*:}"
    argument=$(printf '%s' "$argument" | tr '=' ' ')
    declared=$(grep -c '^ *@Test' "$SOURCES/$class.kt") || { echo "$class declares no test" >&2; exit 1; }
    adb uninstall $PKG.test >/dev/null 2>&1 || true
    adb uninstall $PKG >/dev/null 2>&1 || true
    adb install "$APP/debug/app-debug.apk" >/dev/null
    adb install "$APP/androidTest/debug/app-debug-androidTest.apk" >/dev/null
    # An unlocked, awake screen, so a test's activity comes to the front.
    adb shell input keyevent KEYCODE_WAKEUP
    adb shell wm dismiss-keyguard
    # shellcheck disable=SC2086
    adb shell am instrument -w -r $argument -e class "$PKG.$class" "$PKG.test/$PKG.TestRunner" | tr -d '\r' > "$OUT/$class.txt"
    # Raw status per test: 1 started, 0 passed, -1 error, -2 failure, -3 ignored, -4 assumption not met.
    passed=$(grep -c '^INSTRUMENTATION_STATUS_CODE: 0$' "$OUT/$class.txt" || true)
    other=$(grep -c '^INSTRUMENTATION_STATUS_CODE: -[0-9]*$' "$OUT/$class.txt" || true)
    if [ "$passed" != "$declared" ] || [ "$other" != 0 ] || ! grep -q '^INSTRUMENTATION_CODE: -1$' "$OUT/$class.txt"; then
        grep -E '^INSTRUMENTATION_(STATUS: (test|stack)=|RESULT|FAILED|CODE)|^\s+at |Exception|Error' "$OUT/$class.txt" | head -40 >&2 || true
        echo "$class: $passed of $declared declared tests passed, $other failed or skipped" >&2
        exit 1
    fi
    echo "$class: $passed of $declared declared tests passed"
done
echo "device tests passed: $*; evidence in $OUT"
