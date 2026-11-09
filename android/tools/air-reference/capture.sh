#!/bin/sh
# Captures the Cordova air quality screen S05 that the native screen is compared with (AN-09, #2888): every block of
# the page in seven states (capture.mjs), in ko-KR at 384x832 dp and density 2, and a pollutant followed through the tabs.
#   ANDROID_SERIAL=emulator-5554 android/tools/air-reference/capture.sh <cordova-debug.apk>
# Writes app/src/test/resources/air-reference/ (images cut from the screen, capture.mjs; provenance.mjs). Emulator only;
# offline while the Cordova build is installed (tools/emulator/offline.sh); the display is reset on every exit.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/../emulator/offline.sh"
emulator_guard
CORDOVA_APK=$1
ROOT=$(cd "$HERE/../.." && pwd)
OUT=$ROOT/app/src/test/resources/air-reference
restore_display() { adb shell wm size reset; adb shell wm density reset; }
CLEANUP_HOOK=restore_display
trap offline_cleanup EXIT
trap 'exit 130' INT TERM

go_offline
mkdir -p "$OUT"
find "$OUT" -mindepth 1 -maxdepth 1 ! -name tolerances.json -exec rm -rf {} +
adb shell wm size 768x1664
adb shell wm density 320
adb uninstall $PKG >/dev/null 2>&1 || true
adb install "$CORDOVA_APK" >/dev/null
adb shell cmd locale set-app-locales $PKG --locales ko-KR
adb shell am start -n $PKG/.MainActivity >/dev/null
node "$HERE/capture.mjs" "$ANDROID_SERIAL" "$ROOT"
adb uninstall $PKG >/dev/null
node "$HERE/provenance.mjs" "$ANDROID_SERIAL" "$CORDOVA_APK" "$ROOT"
