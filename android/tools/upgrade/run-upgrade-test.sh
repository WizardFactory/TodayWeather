#!/bin/sh
# Emulator upgrade test (gate G1 of #2877, state part): Cordova 1.1.1 debug APK -> native debug APK.
#   ANDROID_SERIAL=emulator-5554 android/tools/upgrade/run-upgrade-test.sh <cordova-debug.apk> [out-dir] [token]
# token: the FCM token the native app gets; the seed stores token-a, so token-a is the unchanged case
# and token-b (default) the changed one.
# The emulator stays offline while the Cordova app runs, so it has no FCM token and writes nothing to
# the production push server. Requires the native debug and androidTest APKs (./gradlew assembleDebug
# assembleDebugAndroidTest) signed with the same debug key as the Cordova APK.
set -eu
case "${ANDROID_SERIAL:-}" in emulator-*) ;; *) echo "Set ANDROID_SERIAL to an emulator" >&2; exit 2 ;; esac
CORDOVA_APK=$1
OUT=${2:-/tmp/tw-upgrade}
TOKEN=${3:-token-b}
HERE=$(cd "$(dirname "$0")" && pwd)
APP=$HERE/../../app/build/outputs/apk
PKG=net.wizardfactory.todayweather
mkdir -p "$OUT"

# Offline before the Cordova app starts: airplane mode through `cmd connectivity` (API 29+) or the
# setting and broadcast (older images need `adb root`), plus Wi-Fi and data off. Abort if a default
# network is still active.
adb shell cmd connectivity airplane-mode enable >/dev/null 2>&1 || {
    adb root >/dev/null 2>&1 || true; adb wait-for-device
    adb shell settings put global airplane_mode_on 1
    adb shell am broadcast -a android.intent.action.AIRPLANE_MODE --ez state true >/dev/null
}
adb shell svc wifi disable || true
adb shell svc data disable || true
sleep 3
if ! adb shell dumpsys connectivity | grep -q "Active default network: none"; then
    echo "The emulator still has a network; refusing to start the Cordova app" >&2; exit 3
fi
adb uninstall $PKG.test >/dev/null 2>&1 || true
adb uninstall $PKG >/dev/null 2>&1 || true

adb install "$CORDOVA_APK"
adb shell am start -n $PKG/.MainActivity >/dev/null
node "$HERE/seed-cordova.mjs" "$ANDROID_SERIAL" > "$OUT/seeded.json"
adb shell am force-stop $PKG
adb exec-out run-as $PKG cat shared_prefs/group.net.wizardfactory.todayweather.xml > "$OUT/suite-before.xml"
adb exec-out run-as $PKG cat shared_prefs/com.google.android.gms.measurement.prefs.xml > "$OUT/measurement-before.xml" || true

# Preconditions, so the analytics check cannot pass vacuously: the Cordova opt-in happened, the SDK
# persisted collection as enabled, and the native build carries the Firebase configuration.
node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1]));if(s.analyticsChoice!==true||!s.deviceId)process.exit(1)' "$OUT/seeded.json" \
    || { echo "precondition: Cordova analytics opt-in or device id missing" >&2; exit 4; }
grep -q 'name="measurement_enabled_from_api" value="true"' "$OUT/measurement-before.xml" \
    || { echo "precondition: analytics collection was not enabled before the update" >&2; exit 4; }
AAPT2=$(ls -d "${ANDROID_HOME:-$HOME/Library/Android/sdk}"/build-tools/*/aapt2 | tail -1)
"$AAPT2" dump resources "$APP/debug/app-debug.apk" | grep -q "string/google_app_id" \
    || { echo "precondition: the native APK has no Firebase configuration (app/google-services.json)" >&2; exit 4; }

adb shell setprop log.tag.FA VERBOSE
adb shell setprop log.tag.FA-SVC VERBOSE
adb logcat -c
adb install -r "$APP/debug/app-debug.apk"
adb install -r "$APP/androidTest/debug/app-debug-androidTest.apk"
SEEDED=$(base64 < "$OUT/seeded.json" | tr -d '\n')
RUNNER=$PKG.test/$PKG.TestRunner
adb shell am instrument -w -e seeded "$SEEDED" -e token "$TOKEN" -e class $PKG.CordovaUpgradeTest#firstStartMigratesTheCordovaState $RUNNER | tee "$OUT/first-start.txt"
adb shell am force-stop $PKG
adb shell am instrument -w -e seeded "$SEEDED" -e token "$TOKEN" -e class $PKG.CordovaUpgradeTest#afterRestartNothingChangesAndAnalyticsStaysOff $RUNNER | tee "$OUT/after-restart.txt"
adb logcat -d > "$OUT/logcat.txt"
adb exec-out run-as $PKG cat shared_prefs/com.google.android.gms.measurement.prefs.xml > "$OUT/measurement-after.xml" || true

adb shell cmd connectivity airplane-mode disable >/dev/null 2>&1 || {
    adb shell settings put global airplane_mode_on 0
    adb shell am broadcast -a android.intent.action.AIRPLANE_MODE --ez state false >/dev/null
}
adb shell svc wifi enable || true
adb shell svc data enable || true

grep -q "^OK (1 test)" "$OUT/first-start.txt"
grep -q "^OK (1 test)" "$OUT/after-restart.txt"
EVENTS=$(grep -c "Logging event" "$OUT/logcat.txt" || true)
echo "analytics events logged after the update: $EVENTS"
test "$EVENTS" -eq 0
echo "upgrade test passed; evidence in $OUT"
