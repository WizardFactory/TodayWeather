#!/bin/sh
# Captures the Cordova charts that the native chart tests compare with (AN-05, #2884). For each screen
# size the Cordova debug build draws the fixtures through its own services, and capture.mjs records the
# SVG scenes, element rects and PNG captures; provenance.mjs then records where they came from.
#   ANDROID_SERIAL=emulator-5554 android/tools/chart-reference/capture.sh <cordova-debug.apk>
# Writes core-domain/src/test/resources/chart-reference/ (scenes, layouts, PNG captures, provenance).
# Emulator only; the emulator stays offline while the Cordova build is installed (tools/emulator/offline.sh),
# and its display size and density are reset on every exit.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/../emulator/offline.sh"
emulator_guard
CORDOVA_APK=$1
ROOT=$(cd "$HERE/../.." && pwd)
restore_display() { adb shell wm size reset; adb shell wm density reset; }
CLEANUP_HOOK=restore_display
trap offline_cleanup EXIT
trap 'exit 130' INT TERM

go_offline
# New captures replace the previous ones; tolerances.json (maintained with the tests) stays.
rm -rf "$ROOT/core-domain/src/test/resources/chart-reference"/[0-9]*x[0-9]* "$ROOT/core-domain/src/test/resources/chart-reference/provenance.json"
for size in 384x832 360x780 412x892; do
    # Density 2: CSS pixels (dp) are twice the device pixels, as in the native screenshot tests.
    adb shell wm size "$((${size%x*} * 2))x$((${size#*x} * 2))"
    adb shell wm density 320
    adb uninstall $PKG >/dev/null 2>&1 || true
    adb install "$CORDOVA_APK" >/dev/null
    adb shell am start -n $PKG/.MainActivity >/dev/null
    node "$HERE/capture.mjs" "$ANDROID_SERIAL" "$size" "$ROOT"
    adb uninstall $PKG >/dev/null
done
node "$HERE/provenance.mjs" "$ANDROID_SERIAL" "$CORDOVA_APK" "$ROOT"
