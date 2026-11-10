#!/bin/sh
# Captures the Cordova menu rows of AN-15 (#2894) that the native app is compared with: the usage analytics popup over
# the menu, the menu after an opt-in, and what the ad privacy, privacy policy and terms rows do, in ko-KR and en-US at
# 384x832 dp and density 2 (capture.mjs).
#   ANDROID_SERIAL=emulator-5554 android/tools/privacy-reference/capture.sh <cordova-debug.apk>
# Writes app/src/test/resources/privacy-reference/ (images cut from the screen; provenance.mjs). Emulator only;
# offline while the Cordova build is installed (tools/emulator/offline.sh), so the opt-in sends nothing; the display is
# reset on every exit.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/../emulator/offline.sh"
emulator_guard
CORDOVA_APK=$1
ROOT=$(cd "$HERE/../.." && pwd)
OUT=$ROOT/app/src/test/resources/privacy-reference
restore_display() { adb shell wm size reset; adb shell wm density reset; }
CLEANUP_HOOK=restore_display
trap offline_cleanup EXIT
trap 'exit 130' INT TERM

go_offline
rm -rf "$OUT/ko-KR" "$OUT/en-US" "$OUT/provenance.json"
adb shell wm density 320
# The WebView must be 384x762 dp, the size the native tests render: the room between the status and navigation bars is
# 1524 px. The references were first captured on 768x1664 under a 46 dp status bar; the capture emulator's was 24 dp
# on 2026-11-10, so the height follows the bars (SystemUI needs a moment after each change).
bar() { adb shell dumpsys window | sed -n "s/.*type=$1 frame=\\[0,\\([0-9]*\\)\\]\\[[0-9]*,\\([0-9]*\\)\\].*/\\$2/p" | head -1; }
height=1664
for attempt in 1 2 3; do
    adb shell wm size 768x$height
    sleep 3
    room=$(( $(bar navigationBars 1) - $(bar statusBars 2) ))
    [ "$room" -eq 1524 ] && break
    height=$((height + 1524 - room))
done
[ "$room" -eq 1524 ] || { echo "cannot give the WebView 1524 px between the bars ($room)" >&2; exit 1; }
for lang in ko-KR en-US; do
    adb uninstall $PKG >/dev/null 2>&1 || true
    adb install "$CORDOVA_APK" >/dev/null
    adb shell cmd locale set-app-locales $PKG --locales "$lang"
    adb shell am start -n $PKG/.MainActivity >/dev/null
    node "$HERE/capture.mjs" "$ANDROID_SERIAL" "$lang" "$ROOT"
    adb uninstall $PKG >/dev/null
done
node "$HERE/provenance.mjs" "$ANDROID_SERIAL" "$CORDOVA_APK" "$ROOT"
