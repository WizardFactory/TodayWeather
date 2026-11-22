#!/bin/sh
# Ad-free Play Store screens (#3122) from the actual debug app with live read-only data: StoreCaptureTest per locale.
#   ANDROID_SERIAL=emulator-NNNN capture.sh <out-dir> [locale:region ...]   (default ko-KR:KR en-US:US ja-JP:JP)
# Same private debug inputs, emulator rules and cleanup as tools/manual/capture.sh: a caller-owned emulator with the
# network on; both test packages are uninstalled on every exit. Writes <out-dir>/<locale>/store-0N-*.png and .json.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/../emulator/offline.sh"
emulator_guard
OUT=${1:?output directory required}
shift
LOCALES=${*:-ko-KR:KR en-US:US ja-JP:JP}
APP=$HERE/../../app/build/outputs/apk
mkdir -p "$OUT"
trap online_cleanup EXIT
trap 'exit 130' INT TERM
[ "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" -ge 33 ] || exit 2
adb shell dumpsys connectivity | grep -q 'Active default network: none' && { echo 'Network required' >&2; exit 3; }
adb uninstall "$PKG.test" >/dev/null 2>&1 || true
adb uninstall "$PKG" >/dev/null 2>&1 || true
adb install "$APP/debug/app-debug.apk" >/dev/null
adb install "$APP/androidTest/debug/app-debug-androidTest.apk" >/dev/null
{ adb shell getprop ro.build.fingerprint; adb shell wm size; adb shell wm density; adb shell getprop persist.sys.timezone
  echo "ads: off"; } > "$OUT/device.txt"
shasum -a 256 "$APP/debug/app-debug.apk" "$APP/androidTest/debug/app-debug-androidTest.apk" > "$OUT/apk.sha256"
for pair in $LOCALES; do
    locale=${pair%%:*}; region=${pair#*:}
    mkdir -p "$OUT/$locale"
    adb shell pm clear "$PKG" >/dev/null
    adb shell cmd locale set-app-locales "$PKG" --locales "$locale"
    adb shell am instrument -w -e ads off -e manual true -e weather production -e region "$region" \
        -e class "$PKG.StoreCaptureTest#store" "$PKG.test/$PKG.TestRunner" > "$OUT/$locale/store.log" 2>&1
    adb pull "/sdcard/Android/data/$PKG/files/manual/." "$OUT/$locale/" >/dev/null 2>&1 || true
    grep -q '^OK (1 test)' "$OUT/$locale/store.log" || { echo "Capture failed: $locale; see $OUT/$locale/store.log" >&2; exit 1; }
    echo "Captured $locale"
done
