#!/bin/sh
# Captures the Cordova saved places S02 of AN-11 (#2890) that the native page is compared with: the list (manual page
# 13), the search for 부산 (14), edit mode (18) and a find-by-location result (19), in ko-KR and en-US at 384x832 dp and
# density 2 (capture.mjs).
#   ANDROID_SERIAL=emulator-5554 android/tools/places-reference/capture.sh <cordova-debug.apk>
# Writes app/src/test/resources/places-reference/ (images cut from the screen; provenance.mjs). Emulator only; offline
# while the Cordova build is installed (tools/emulator/offline.sh); the display is reset on every exit.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/../emulator/offline.sh"
emulator_guard
CORDOVA_APK=$1
ROOT=$(cd "$HERE/../.." && pwd)
OUT=$ROOT/app/src/test/resources/places-reference
restore_display() { adb shell wm size reset; adb shell wm density reset; }
CLEANUP_HOOK=restore_display
trap offline_cleanup EXIT
trap 'exit 130' INT TERM

go_offline
adb shell cmd location set-location-enabled true
adb emu geo fix 126.9780 37.5665 >/dev/null
rm -rf "$OUT/ko-KR" "$OUT/en-US" "$OUT/provenance.json"
adb shell wm size 768x1664
adb shell wm density 320
for lang in ko-KR en-US; do
    adb uninstall $PKG >/dev/null 2>&1 || true
    adb install "$CORDOVA_APK" >/dev/null
    adb shell cmd locale set-app-locales $PKG --locales "$lang"
    # As for the manual's captures, the notification and location permissions are granted before the first start, so no
    # system dialog covers the page; the position is the manual's (Seoul City Hall).
    adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS
    adb shell pm grant $PKG android.permission.ACCESS_FINE_LOCATION
    adb shell pm grant $PKG android.permission.ACCESS_COARSE_LOCATION
    adb shell am start -n $PKG/.MainActivity >/dev/null
    node "$HERE/capture.mjs" "$ANDROID_SERIAL" "$lang" "$ROOT"
    adb uninstall $PKG >/dev/null
done
node "$HERE/provenance.mjs" "$ANDROID_SERIAL" "$CORDOVA_APK" "$ROOT"
