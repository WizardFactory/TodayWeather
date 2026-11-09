#!/bin/sh
# Device smoke for the native charts (AN-05, #2884): ChartDeviceTest renders the Compose charts on the
# emulator, at each captured size and density 2, and compares them with the Cordova captures of the same
# emulator. Needs ./gradlew assembleDebug assembleDebugAndroidTest.
#   ANDROID_SERIAL=emulator-5554 android/tools/chart-reference/device-smoke.sh [out-dir]
# Emulator only and offline while this build is installed (tools/emulator/offline.sh); the display size
# and density are reset on every exit.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/../emulator/offline.sh"
emulator_guard
OUT=${1:-/tmp/tw-chart-smoke}
APP=$HERE/../../app/build/outputs/apk
restore_display() { adb shell wm size reset; adb shell wm density reset; }
CLEANUP_HOOK=restore_display
trap offline_cleanup EXIT
trap 'exit 130' INT TERM

go_offline
mkdir -p "$OUT"
adb uninstall $PKG.test >/dev/null 2>&1 || true
adb uninstall $PKG >/dev/null 2>&1 || true
adb install "$APP/debug/app-debug.apk" >/dev/null
adb install "$APP/androidTest/debug/app-debug-androidTest.apk" >/dev/null
for size in 384x832 360x780 412x892; do
    adb shell wm size "$((${size%x*} * 2))x$((${size#*x} * 2))"
    adb shell wm density 320
    adb logcat -c
    adb shell am instrument -w -e chartSize "$size" -e class $PKG.ChartDeviceTest $PKG.test/$PKG.TestRunner | tee "$OUT/$size.txt"
    adb logcat -d | grep "chart-device" > "$OUT/$size-metrics.txt" || true
    cat "$OUT/$size-metrics.txt"
    grep -q "^OK (2 tests)" "$OUT/$size.txt"
done
echo "chart device smoke passed; evidence in $OUT"
