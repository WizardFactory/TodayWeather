#!/bin/sh
# Captures the Cordova start page of AN-10 (#2889) that the native S01 is compared with: the access notice O01 over the
# start page (manual page 1) and the start page after its OK (manual page 2), in ko-KR and en-US at 384x832 dp and
# density 2 (capture.mjs).
#   ANDROID_SERIAL=emulator-5554 android/tools/start-reference/capture.sh <cordova-debug.apk>
# Writes app/src/test/resources/start-reference/ (images cut from the screen; provenance.mjs). Emulator only; offline
# while the Cordova build is installed (tools/emulator/offline.sh); the display is reset on every exit.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/../emulator/offline.sh"
emulator_guard
CORDOVA_APK=$1
ROOT=$(cd "$HERE/../.." && pwd)
OUT=$ROOT/app/src/test/resources/start-reference
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
    # As for the manual's captures, the notification permission is granted before the first start, so no system
    # dialog covers the page; location stays as a new install has it.
    adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS
    adb shell am start -n $PKG/.MainActivity >/dev/null
    node "$HERE/capture.mjs" "$ANDROID_SERIAL" "$lang" "$ROOT"
    adb uninstall $PKG >/dev/null
done
node "$HERE/provenance.mjs" "$ANDROID_SERIAL" "$CORDOVA_APK" "$ROOT"
