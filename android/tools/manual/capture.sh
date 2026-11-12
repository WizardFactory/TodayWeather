#!/bin/sh
# Actual native manual captures. Requires private debug APK inputs; see README.md.
# Only a caller-owned emulator may be selected. Uninstalls both test packages on every exit.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/../emulator/offline.sh"
emulator_guard
OUT=${1:?output directory required}
STEP=${2:-all}
APP=$HERE/../../app/build/outputs/apk
mkdir -p "$OUT"
trap online_cleanup EXIT
trap 'exit 130' INT TERM
[ "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" -ge 33 ] || exit 2
adb shell dumpsys connectivity | grep -q 'Active default network: none' && { echo 'Network required' >&2; exit 3; }
adb shell cmd location set-location-enabled true
adb emu geo fix 126.9780 37.5665 >/dev/null
adb uninstall "$PKG.test" >/dev/null 2>&1 || true
adb uninstall "$PKG" >/dev/null 2>&1 || true
adb install "$APP/debug/app-debug.apk" >/dev/null
adb install "$APP/androidTest/debug/app-debug-androidTest.apk" >/dev/null
adb shell getprop ro.build.fingerprint > "$OUT/device.txt"
adb shell wm size >> "$OUT/device.txt"
adb shell wm density >> "$OUT/device.txt"
adb shell getprop persist.sys.timezone >> "$OUT/device.txt"
adb shell am get-config >> "$OUT/device.txt"
shasum -a 256 "$APP/debug/app-debug.apk" "$APP/androidTest/debug/app-debug-androidTest.apk" > "$OUT/apk.sha256"
if [ "$STEP" = all ]; then STEPS='firstLaunch weatherAndAir places alarms settings nation privacyAndShare'; else STEPS=$STEP; fi
for section in $STEPS; do
    case "$section" in firstLaunch) CLASS=ManualFirstLaunchTest ;; weatherAndAir|places|alarms|settings|nation|privacyAndShare) CLASS=ManualCaptureTest ;; *) echo 'Unknown section' >&2; exit 2 ;; esac
    adb shell pm clear "$PKG" >/dev/null
    adb shell cmd locale set-app-locales "$PKG" --locales ko-KR
    adb shell am instrument -w -e manual true -e weather production -e photos feed -e class "$PKG.$CLASS#$section" "$PKG.test/$PKG.TestRunner" > "$OUT/$section.log" 2>&1
    adb pull "/sdcard/Android/data/$PKG/files/manual/." "$OUT/" >/dev/null 2>&1 || true
    grep -q '^OK (1 test)' "$OUT/$section.log" || { echo "Capture failed: $section; see $OUT/$section.log" >&2; exit 1; }
    echo "Captured $section"
done
