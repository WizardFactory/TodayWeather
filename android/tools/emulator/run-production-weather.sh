#!/bin/sh
# The weather pages against the production server (#2887 AC2): Seoul and London on Hourly and Daily.
#   ANDROID_SERIAL=emulator-5554 android/tools/emulator/run-production-weather.sh [out-dir]
# Requires the debug and androidTest APKs built with the private server URL (TW_SERVER_URL in the environment or
# android/private.properties; README "Private build inputs"). The emulator needs a network for this run: weather
# requests are read-only GETs, push requests are recorded by the test app and never sent, and both packages are
# uninstalled on every exit; when that cannot be confirmed the emulator goes offline and the script exits 5
# (tools/emulator/offline.sh online_cleanup). Screenshots and the instrumentation output go to out-dir.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/offline.sh"
emulator_guard
OUT=${1:-/tmp/tw-production-weather}
APP=$HERE/../../app/build/outputs/apk
mkdir -p "$OUT"
trap online_cleanup EXIT
trap 'exit 130' INT TERM

adb shell dumpsys connectivity | grep -q "Active default network: none" && { echo "The emulator has no network" >&2; exit 3; }
adb uninstall $PKG.test >/dev/null 2>&1 || true
adb uninstall $PKG >/dev/null 2>&1 || true
adb install "$APP/debug/app-debug.apk" >/dev/null
adb install "$APP/androidTest/debug/app-debug-androidTest.apk" >/dev/null
RUNNER=$PKG.test/$PKG.TestRunner
adb shell am instrument -w -e weather production -e class $PKG.ProductionWeatherTest $RUNNER | tee "$OUT/instrument.txt"
adb pull "/sdcard/Android/data/$PKG/files/ac2/." "$OUT/" >/dev/null
grep -q "^OK (1 test)" "$OUT/instrument.txt"
ls "$OUT"/*.png
