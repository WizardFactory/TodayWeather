#!/bin/sh
# The debug build's ads and analytics on an emulator (#2894 AC2), with the Analytics debug log (FA and FA-SVC verbose):
# 1. online: AdsDeviceTest waits until a banner of Google's test unit loads and shows; the log must show no analytics
#    event, while it shows that Analytics ran (its own lines);
# 2. offline: AdsDeviceTest opts in through 선택적 이용 통계 and changes tabs; the log must now show logged events, so
#    the first check cannot pass vacuously. Nothing is uploaded: the device has no network, and the app is removed before
#    the network returns.
#   ANDROID_SERIAL=emulator-5554 android/tools/emulator/run-ads-check.sh [out-dir]
# Requires the debug and androidTest APKs with the Firebase configuration (app/google-services.json). Push requests are
# recorded by the test app; the test app sends no weather request. On every exit both packages are uninstalled; when that
# cannot be confirmed the emulator stays or goes offline and the script exits 5 (tools/emulator/offline.sh).
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/offline.sh"
emulator_guard
OUT=${1:-/tmp/tw-ads-check}
APP=$HERE/../../app/build/outputs/apk
RUNNER=$PKG.test/$PKG.TestRunner
mkdir -p "$OUT"
AAPT2=$(ls -d "${ANDROID_HOME:-$HOME/Library/Android/sdk}"/build-tools/*/aapt2 | tail -1)
"$AAPT2" dump resources "$APP/debug/app-debug.apk" | grep -q "string/google_app_id" \
    || { echo "precondition: the APK has no Firebase configuration (app/google-services.json)" >&2; exit 4; }
adb shell dumpsys connectivity | grep -q "Active default network: none" && { echo "The emulator has no network" >&2; exit 3; }
trap online_cleanup EXIT
trap 'exit 130' INT TERM

install() {
    adb uninstall $PKG.test >/dev/null 2>&1 || true
    adb uninstall $PKG >/dev/null 2>&1 || true
    adb install "$APP/debug/app-debug.apk" >/dev/null
    adb install "$APP/androidTest/debug/app-debug-androidTest.apk" >/dev/null
}
adb shell setprop log.tag.FA VERBOSE
adb shell setprop log.tag.FA-SVC VERBOSE

install
adb logcat -c
adb shell am instrument -w -e ads online -e class $PKG.AdsDeviceTest#aTestBannerLoadsAndShowsWhileAnalyticsStaysOff $RUNNER | tee "$OUT/online.txt"
adb logcat -d > "$OUT/logcat-online.txt"
adb pull "/sdcard/Android/data/$PKG/files/ads/." "$OUT/" >/dev/null
adb uninstall $PKG.test >/dev/null
adb uninstall $PKG >/dev/null

# Offline from here: the cleanup restores the network only after both packages are gone.
trap offline_cleanup EXIT
go_offline
install
adb logcat -c
adb shell am instrument -w -e ads optin -e class $PKG.AdsDeviceTest#anOptInStartsCollection $RUNNER | tee "$OUT/optin.txt"
adb logcat -d > "$OUT/logcat-optin.txt"
adb pull "/sdcard/Android/data/$PKG/files/ads/." "$OUT/" >/dev/null

grep -q "^OK (1 test)" "$OUT/online.txt"
grep -q "^OK (1 test)" "$OUT/optin.txt"
ONLINE=$(grep -c "Logging event" "$OUT/logcat-online.txt" || true)
FA=$(grep -c -E " (FA|FA-SVC) *: " "$OUT/logcat-online.txt" || true)
OPTIN=$(grep -c "Logging event" "$OUT/logcat-optin.txt" || true)
echo "online run: $ONLINE analytics events logged, $FA Analytics log lines; opted-in run: $OPTIN events logged"
test "$FA" -gt 0
test "$ONLINE" -eq 0
test "$OPTIN" -gt 0
grep -q "Logging event.*screen_view" "$OUT/logcat-optin.txt"
echo "ads check passed; evidence in $OUT"
