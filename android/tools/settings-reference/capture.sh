#!/bin/sh
# Captures the Cordova settings pages that the native pages are compared with (AN-12, #2891): S07 and S08 in each
# theme, the weather page after a unit and a theme change, and the About popup, in ko-KR (and S07 and About in en-US)
# at 384x832 dp and density 2, with the requests each step sent (capture.mjs).
#   ANDROID_SERIAL=emulator-5554 android/tools/settings-reference/capture.sh <cordova-debug.apk>
# Writes app/src/test/resources/settings-reference/ (images cut from the screen; provenance.mjs). Emulator only;
# offline while the Cordova build is installed (tools/emulator/offline.sh); the display is reset on every exit.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/../emulator/offline.sh"
emulator_guard
CORDOVA_APK=$1
ROOT=$(cd "$HERE/../.." && pwd)
OUT=$ROOT/app/src/test/resources/settings-reference
restore_display() { adb shell wm size reset; adb shell wm density reset; }
CLEANUP_HOOK=restore_display
trap offline_cleanup EXIT
trap 'exit 130' INT TERM

go_offline
rm -rf "$OUT/ko-KR" "$OUT/en-US" "$OUT/provenance.json"
node "$HERE/photo.mjs" "$ROOT"
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
