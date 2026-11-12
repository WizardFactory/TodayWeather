#!/bin/sh
# Offline production-activity smoke for the parity changes. Requires both debug APKs.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/../emulator/offline.sh"
emulator_guard
case "$(adb emu avd name | tr -d '\r' | sed -n '1p')" in tw_*) ;; *) echo 'Use a task-owned tw_ AVD' >&2; exit 2;; esac
OUT=${1:?pass an evidence directory}
APK=$HERE/../../app/build/outputs/apk
OLD_SIZE=$(adb shell wm size | sed -n 's/Override size: //p' | tr -d '\r')
OLD_DENSITY=$(adb shell wm density | sed -n 's/Override density: //p' | tr -d '\r')
OLD_FONT=$(adb shell settings get system font_scale | tr -d '\r')
OLD_AUTO=$(adb shell settings get system accelerometer_rotation | tr -d '\r')
OLD_ROTATION=$(adb shell settings get system user_rotation | tr -d '\r')
restore_setting() {
    if [ "$2" = null ]; then adb shell settings delete system "$1" >/dev/null;
    else adb shell settings put system "$1" "$2"; fi
}
restore_display() {
    adb shell wm size "${OLD_SIZE:-reset}"
    adb shell wm density "${OLD_DENSITY:-reset}"
    restore_setting font_scale "$OLD_FONT"
    restore_setting accelerometer_rotation "$OLD_AUTO"
    restore_setting user_rotation "$OLD_ROTATION"
}
CLEANUP_HOOK=restore_display
trap offline_cleanup EXIT
trap 'exit 130' INT TERM
go_offline
mkdir -p "$OUT"
adb shell wm density 320
adb shell settings put system font_scale 1.0
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 0
for lang in ko-KR en-US; do
    if [ "$lang" = ko-KR ]; then size=640x1388; else size=824x1784; fi
    adb shell wm size "$size"
    adb uninstall "$PKG.test" >/dev/null 2>&1 || true
    adb uninstall "$PKG" >/dev/null 2>&1 || true
    adb install "$APK/debug/app-debug.apk" >/dev/null
    adb install "$APK/androidTest/debug/app-debug-androidTest.apk" >/dev/null
    adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS
    adb shell cmd locale set-app-locales "$PKG" --locales "$lang"
    adb shell input keyevent KEYCODE_WAKEUP
    adb shell wm dismiss-keyguard
    adb shell am instrument -w -e class "$PKG.ParityDeviceTest" "$PKG.test/$PKG.TestRunner" > "$OUT/$lang.txt"
    cat "$OUT/$lang.txt"
    mkdir -p "$OUT/$lang"
    adb exec-out run-as "$PKG" tar -C files -cf - parity-smoke | tar -xf - -C "$OUT/$lang"
    grep -q '^OK (1 test)' "$OUT/$lang.txt"
done
echo 'native parity smoke passed in Korean 320x694 and English 412x892'
