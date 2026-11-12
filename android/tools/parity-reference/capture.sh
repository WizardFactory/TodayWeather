#!/bin/sh
# Exact nominal display, fresh install per size/locale, measured WebView. Existing
# reference roots are preserved. Usage: ANDROID_SERIAL=emulator-N sh capture.sh APK [set]
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
. "$HERE/../emulator/offline.sh"
emulator_guard
case "$(adb emu avd name | tr -d '\r' | sed -n '1p')" in tw_*) ;; *) echo 'Use a task-owned tw_ AVD' >&2; exit 2 ;; esac
APK=$1
SET=${2:-start}
case "$SET" in start|dialog|shell|forecast|air|settings|nation|privacy|places|push|chart) ;; *) echo "Unsupported capture set: $SET" >&2; exit 2 ;; esac
SIZES=${TW_PARITY_SIZES:-'384x832 360x780 412x892 320x694'}
for size in $SIZES; do
    case "$size" in 384x832|360x780|412x892|320x694) ;; *) echo "Invalid size: $size" >&2; exit 2 ;; esac
done
# Restore the prior emulator configuration even after a failed capture.
OLD_SIZE=$(adb shell wm size | sed -n 's/Override size: //p' | tr -d '\r')
OLD_DENSITY=$(adb shell wm density | sed -n 's/Override density: //p' | tr -d '\r')
OLD_LOCATION=$(adb shell cmd location is-location-enabled | tr -d '\r')
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
    adb shell cmd location set-location-enabled "$OLD_LOCATION"
    restore_setting font_scale "$OLD_FONT"
    restore_setting accelerometer_rotation "$OLD_AUTO"
    restore_setting user_rotation "$OLD_ROTATION"
}
CLEANUP_HOOK=restore_display
trap offline_cleanup EXIT
trap 'exit 130' INT TERM
go_offline
adb shell settings put system font_scale 1.0
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 0
adb shell wm density 320
if [ "$SET" = places ]; then
    adb shell cmd location set-location-enabled true
    adb emu geo fix 126.9780 37.5665 >/dev/null
fi
for size in $SIZES; do
    export TW_REFERENCE_SIZE=$size
    export TW_REFERENCE_ROOT=$ROOT/app/src/test/resources/parity-reference/$size/$SET
    adb shell wm size "$((${size%x*} * 2))x$((${size#*x} * 2))"
    sleep 3
    for lang in ${TW_PARITY_LANGS:-ko-KR en-US}; do
        case "$lang" in ko-KR|en-US) ;; *) echo "Invalid language: $lang" >&2; exit 2 ;; esac
        adb uninstall "$PKG" >/dev/null 2>&1 || true
        adb install "$APK" >/dev/null
        locale=$lang
        case "$SET:$lang" in forecast:en-US|air:en-US|settings:en-US|nation:en-US|chart:en-US) locale=en-KR ;; esac
        adb shell cmd locale set-app-locales "$PKG" --locales "$locale"
        export TW_REFERENCE_LANGUAGE=$lang
        adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS
        if [ "$SET" = places ]; then
            adb shell pm grant "$PKG" android.permission.ACCESS_FINE_LOCATION
            adb shell pm grant "$PKG" android.permission.ACCESS_COARSE_LOCATION
        fi
        adb shell am start -n "$PKG/.MainActivity" >/dev/null
        case "$SET" in
            chart) node "$HERE/../chart-reference/capture.mjs" "$ANDROID_SERIAL" "$size" "$ROOT" ;;
            forecast|air) node "$HERE/../$SET-reference/capture.mjs" "$ANDROID_SERIAL" "$ROOT" ;;
            *) node "$HERE/../$SET-reference/capture.mjs" "$ANDROID_SERIAL" "$lang" "$ROOT" ;;
        esac
        adb uninstall "$PKG" >/dev/null
    done
    node "$HERE/../$SET-reference/provenance.mjs" "$ANDROID_SERIAL" "$APK" "$ROOT"
done
