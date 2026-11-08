#!/bin/sh
# Large-screen check of the shell (AN-07, #2886 AC3): runs ShellFitDeviceTest on a tablet or a foldable
# emulator, with gesture navigation and with the three-button navigation bar (at the side of a landscape
# phone-sized screen). The test keeps the app open while the display rotates, shrinks to a split-screen half
# and, on a foldable, folds; the images of each state and the window sizes go to <out-dir>/<navigation>/.
#   ANDROID_SERIAL=emulator-5570 android/tools/large-screen/run-shell-fit.sh [out-dir]
# Emulator only; offline while the app is installed (tools/emulator/offline.sh); the display size, rotation,
# device state and navigation mode are reset on every exit. Requires ./gradlew assembleDebug
# assembleDebugAndroidTest.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/../emulator/offline.sh"
emulator_guard
OUT=${1:-/tmp/tw-shell-fit}
APP=$HERE/../../app/build/outputs/apk
NAVBAR=com.android.internal.systemui.navbar
NAV_BEFORE=$(adb shell cmd overlay list android | tr -d '\r' | sed -n "s/^\[x\] \($NAVBAR\.[a-z]*\)$/\1/p")
restore_display() {
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
adb shell getprop ro.product.model > "$OUT/device.txt"
for nav in gestural threebutton; do
    adb shell cmd overlay enable-exclusive --category "$NAVBAR.$nav"
    sleep 3
    # An unlocked, awake screen, so the test's activity comes to the front.
    adb shell input keyevent KEYCODE_WAKEUP
    adb shell wm dismiss-keyguard
    adb shell am instrument -w -e class $PKG.ShellFitDeviceTest $PKG.test/$PKG.TestRunner | tee "$OUT/$nav.txt"
    mkdir -p "$OUT/$nav"
    adb exec-out run-as $PKG tar -C files -cf - shell-fit | tar -xf - -C "$OUT/$nav"
    grep -q "^OK (1 test)" "$OUT/$nav.txt"
done
echo "shell fits with gesture and three-button navigation; images in $OUT"
