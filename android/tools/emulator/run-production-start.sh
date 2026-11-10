#!/bin/sh
# A new install's start page against the production server (#2889 AC2, ProductionStartTest): on a new install each,
# 현재위치 날씨보기 allowed in the system's dialog reaches the weather of the emulator's position (Seoul City Hall,
# `geo fix`), and with location denied a searched place reaches its weather (a Places prediction with the build's
# TW_PLACES_API_KEY_ANDROID, else a bundled town).
#   ANDROID_SERIAL=emulator-5554 android/tools/emulator/run-production-start.sh [out-dir]
# Requires the debug and androidTest APKs built with the private server URL and, for the Places search, the Places key
# (README "Private build inputs"), and an API 33+ emulator with Google Play services. The emulator needs a network:
# geocode and weather requests are read-only GETs, push requests are recorded by the test app and never sent, and both
# packages are uninstalled on every exit; when that cannot be confirmed the emulator goes offline and the script exits
# 5 (offline.sh online_cleanup). Screenshots and the instrumentation output go to out-dir.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/offline.sh"
emulator_guard
OUT=${1:-/tmp/tw-production-start}
APP=$HERE/../../app/build/outputs/apk
mkdir -p "$OUT"
trap online_cleanup EXIT
trap 'exit 130' INT TERM

adb shell dumpsys connectivity | grep -q "Active default network: none" && { echo "The emulator has no network" >&2; exit 3; }
adb shell cmd location set-location-enabled true
adb emu geo fix 126.9780 37.5665 >/dev/null
adb uninstall $PKG.test >/dev/null 2>&1 || true
adb uninstall $PKG >/dev/null 2>&1 || true
adb install "$APP/debug/app-debug.apk" >/dev/null
adb install "$APP/androidTest/debug/app-debug-androidTest.apk" >/dev/null
RUNNER=$PKG.test/$PKG.TestRunner
for step in position search; do
    # A new install each time: no data, no permission.
    adb shell pm clear $PKG >/dev/null
    adb shell cmd locale set-app-locales $PKG --locales ko-KR
    case $step in
        position) test=thePositionOpensItsWeather ;;
        search) test=aSearchedPlaceOpensItsWeatherWithLocationDenied ;;
    esac
    adb shell am instrument -w -e weather production -e start $step -e class "$PKG.ProductionStartTest#$test" $RUNNER | tee "$OUT/instrument-$step.txt"
    adb pull "/sdcard/Android/data/$PKG/files/start/." "$OUT/" >/dev/null
    grep -q "^OK (1 test)" "$OUT/instrument-$step.txt"
done
ls "$OUT"/*.png
