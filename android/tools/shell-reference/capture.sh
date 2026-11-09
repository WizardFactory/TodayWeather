#!/bin/sh
# Captures the Cordova shell that the native shell tests compare with (AN-07, #2886): tab bar, header bar
# and side menu in each theme, in Korean and English, at 384x832 dp and density 2.
#   ANDROID_SERIAL=emulator-5554 android/tools/shell-reference/capture.sh <cordova-debug.apk>
# Writes app/src/test/resources/shell-reference/ (images cut from the screen, capture.mjs; provenance.mjs).
# Emulator only; offline while the Cordova build is installed (tools/emulator/offline.sh); the display is reset
# on every exit.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/../emulator/offline.sh"
emulator_guard
CORDOVA_APK=$1
ROOT=$(cd "$HERE/../.." && pwd)
OUT=$ROOT/app/src/test/resources/shell-reference
restore_display() { adb shell wm size reset; adb shell wm density reset; }
CLEANUP_HOOK=restore_display
trap offline_cleanup EXIT
trap 'exit 130' INT TERM

go_offline
rm -rf "$OUT/ko-KR" "$OUT/en-US" "$OUT/provenance.json"
adb shell wm size 768x1664
adb shell wm density 320
for lang in ko-KR en-US; do
    adb uninstall $PKG >/dev/null 2>&1 || true
    adb install "$CORDOVA_APK" >/dev/null
    adb shell cmd locale set-app-locales $PKG --locales "$lang"
    adb shell am start -n $PKG/.MainActivity >/dev/null
    node "$HERE/capture.mjs" "$ANDROID_SERIAL" "$lang" "$ROOT"
    adb uninstall $PKG >/dev/null
done
node "$HERE/provenance.mjs" "$ANDROID_SERIAL" "$CORDOVA_APK" "$ROOT"
