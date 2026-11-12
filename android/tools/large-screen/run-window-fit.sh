#!/bin/sh
# AN-18: actual split-screen shell check on an owned tw_ emulator, at font scale 1.0 and 1.3.
# Requires assembleDebug and assembleDebugAndroidTest. Records whole-display captures and window metrics.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/../emulator/offline.sh"
emulator_guard
AVD=$(adb emu avd name | tr -d '\r' | sed -n '1p')
case "$AVD" in tw_*) ;; *) echo "Expected a task-owned tw_ AVD, got $AVD" >&2; exit 1;; esac
case "$AVD" in *fold*) FOLD=true;; *) FOLD=false;; esac
FONT_BEFORE=$(adb shell settings get system font_scale | tr -d '\r')
OUT=${1:-/tmp/tw-window-fit}
APP=$HERE/../../app/build/outputs/apk
NAVBAR=com.android.internal.systemui.navbar
NAV_BEFORE=$(adb shell cmd overlay list android | tr -d '\r' | sed -n "s/^\[x\] \($NAVBAR\.[a-z]*\)$/\1/p")
restore_display() {
    if [ "$FONT_BEFORE" = null ]; then adb shell settings delete system font_scale; else adb shell settings put system font_scale "$FONT_BEFORE"; fi
    adb shell am force-stop com.android.settings
    adb shell wm size reset
    adb shell cmd device_state state reset >/dev/null 2>&1 || true
    adb shell cmd window user-rotation free
    [ -n "$NAV_BEFORE" ] && adb shell cmd overlay enable-exclusive --category "$NAV_BEFORE"
}
CLEANUP_HOOK=restore_display
trap offline_cleanup EXIT
trap 'exit 130' INT TERM

go_offline
mkdir -p "$OUT"
adb uninstall $PKG.test >/dev/null 2>&1 || true
adb uninstall $PKG >/dev/null 2>&1 || true
adb install "$APP/debug/app-debug.apk" >/dev/null
adb install "$APP/androidTest/debug/app-debug-androidTest.apk" >/dev/null
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS
adb shell cmd locale set-app-locales $PKG --locales "${APP_LOCALE:-ko-KR}"
adb shell getprop ro.product.model > "$OUT/device.txt"
for mode in gestural:1.0 gestural:1.3 threebutton:1.3; do
    nav=${mode%:*}
    font=${mode#*:}
    adb shell settings put system font_scale "$font"
    adb shell cmd overlay enable-exclusive --category "$NAVBAR.$nav"
    sleep 3
    # An unlocked, awake screen, so the test's activity comes to the front.
    adb shell input keyevent KEYCODE_WAKEUP
    adb shell wm dismiss-keyguard
    adb shell am instrument -w -e screens "${SCREENS:-true}" -e expectedFont "$font" -e fold "$FOLD" -e class $PKG.WindowFitDeviceTest $PKG.test/$PKG.TestRunner | tee "$OUT/$mode.txt"
    mkdir -p "$OUT/$mode"
    adb exec-out run-as $PKG tar -C files -cf - window-fit | tar -xf - -C "$OUT/$mode"
    grep -q "^OK (1 test)" "$OUT/$mode.txt"
done
echo "actual split-screen shell checks passed; images in $OUT"
