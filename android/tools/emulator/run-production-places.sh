#!/bin/sh
# Saved places against the production server (#2890 AC2, ProductionPlacesTest): with 서울 saved, 부산 (a bundled town)
# and London (a Places prediction) are searched and added, the header is swiped between them and London is deleted.
#   ANDROID_SERIAL=emulator-5554 android/tools/emulator/run-production-places.sh [out-dir]
# Requires the debug and androidTest APKs built with the private server URL and the Places key (README "Private build
# inputs"). The emulator needs a network: weather and geocode requests are read-only GETs, push requests are recorded by
# the test app and never sent, and both packages are uninstalled on every exit; when that cannot be confirmed the
# emulator goes offline and the script exits 5 (offline.sh online_cleanup). Screenshots and the instrumentation output go
# to out-dir.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/offline.sh"
emulator_guard
OUT=${1:-/tmp/tw-production-places}
APP=$HERE/../../app/build/outputs/apk
mkdir -p "$OUT"
trap online_cleanup EXIT
trap 'exit 130' INT TERM

adb shell dumpsys connectivity | grep -q "Active default network: none" && { echo "The emulator has no network" >&2; exit 3; }
adb uninstall $PKG.test >/dev/null 2>&1 || true
adb uninstall $PKG >/dev/null 2>&1 || true
adb install "$APP/debug/app-debug.apk" >/dev/null
adb install "$APP/androidTest/debug/app-debug-androidTest.apk" >/dev/null
adb shell cmd locale set-app-locales $PKG --locales ko-KR
RUNNER=$PKG.test/$PKG.TestRunner
adb shell am instrument -w -e weather production -e class $PKG.ProductionPlacesTest $RUNNER | tee "$OUT/instrument.txt"
adb pull "/sdcard/Android/data/$PKG/files/places/." "$OUT/" >/dev/null
grep -q "^OK (1 test)" "$OUT/instrument.txt"
ls "$OUT"/*.png
