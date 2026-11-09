#!/bin/sh
# Captures the Cordova nationwide pages and warnings that the native pages are compared with (AN-13, #2892).
# - Pages: S10 in its three modes, S11 in its six tabs, S12 card by card, their loading, empty and failed states,
#   and the header in the dark and old themes.
# - Languages: ko-KR, plus en-KR for the English text; en-KR keeps the region Korea, so the rows of the menu show.
# - Display: 384x832 dp at density 2, recording the requests each step sent (capture.mjs).
#   ANDROID_SERIAL=emulator-5554 android/tools/nation-reference/capture.sh <cordova-debug.apk>
# Writes app/src/test/resources/nation-reference/ (images cut from the screen; provenance.mjs). Emulator only; offline
# while the Cordova build is installed (tools/emulator/offline.sh); the display is reset on every exit.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/../emulator/offline.sh"
emulator_guard
CORDOVA_APK=$1
ROOT=$(cd "$HERE/../.." && pwd)
OUT=$ROOT/app/src/test/resources/nation-reference
restore_display() { adb shell wm size reset; adb shell wm density reset; }
CLEANUP_HOOK=restore_display
trap offline_cleanup EXIT
trap 'exit 130' INT TERM

go_offline
rm -rf "$OUT/ko-KR" "$OUT/en-KR" "$OUT/provenance.json"
adb shell wm size 768x1664
adb shell wm density 320
for lang in ko-KR en-KR; do
    adb uninstall $PKG >/dev/null 2>&1 || true
    adb install "$CORDOVA_APK" >/dev/null
    adb shell cmd locale set-app-locales $PKG --locales "$lang"
    adb shell am start -n $PKG/.MainActivity >/dev/null
    node "$HERE/capture.mjs" "$ANDROID_SERIAL" "$lang" "$ROOT"
    adb uninstall $PKG >/dev/null
done
node "$HERE/provenance.mjs" "$ANDROID_SERIAL" "$CORDOVA_APK" "$ROOT"
