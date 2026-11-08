#!/bin/sh
# Emulator upgrade test (gate G1 of #2877, state part): Cordova 1.1.1 debug APK -> native debug APK.
#   ANDROID_SERIAL=emulator-5554 android/tools/upgrade/run-upgrade-test.sh <cordova-debug.apk> [out-dir] [token]
# token: the FCM token the native app gets; the seed stores token-a, so token-a is the unchanged case
# and token-b (default) the changed one.
# The emulator stays offline while the Cordova app or the native app is installed, so neither gets an
# FCM token or writes to the production push server: on every exit both packages are uninstalled before
# the network comes back, and the network stays off if they cannot be removed. Requires the native debug
# and androidTest APKs (./gradlew assembleDebug assembleDebugAndroidTest) signed with the same debug key
# as the Cordova APK.
set -eu
case "${ANDROID_SERIAL:-}" in emulator-[0-9]*) ;; *) echo "Set ANDROID_SERIAL to an emulator" >&2; exit 2 ;; esac
[ "$(adb get-state 2>/dev/null)" = device ] || { echo "No device $ANDROID_SERIAL" >&2; exit 2; }
CORDOVA_APK=$1
OUT=${2:-/tmp/tw-upgrade}
TOKEN=${3:-token-b}
HERE=$(cd "$(dirname "$0")" && pwd)
APP=$HERE/../../app/build/outputs/apk
PKG=net.wizardfactory.todayweather
mkdir -p "$OUT"

# Airplane mode on (1) or off (0): `cmd connectivity` on API 29+, which prints nothing on success; older
# images answer "No shell command implementation." with exit status 0 and need the setting and broadcast
# (with `adb root`).
airplane() {
    if [ -n "$(adb shell cmd connectivity airplane-mode "$([ "$1" = 1 ] && echo enable || echo disable)" 2>&1)" ]; then
        adb root >/dev/null 2>&1 || true; adb wait-for-device
        adb shell settings put global airplane_mode_on "$1"
        adb shell am broadcast -a android.intent.action.AIRPLANE_MODE --ez state "$([ "$1" = 1 ] && echo true || echo false)" >/dev/null
    fi
}

cleanup() {
    status=$?
    trap - EXIT INT TERM
    set +e
    adb uninstall $PKG.test >/dev/null 2>&1
    adb uninstall $PKG >/dev/null 2>&1
    # The network comes back only when the package query succeeds, its whole answer is a package list
    # with the framework package, and it lists neither package; anything else counts as still installed.
    if ! packages=$(adb shell pm list packages 2>/dev/null); then
        echo "cleanup: the package query failed; the emulator stays offline" >&2
        exit 5
    fi
    packages=$(printf '%s\n' "$packages" | tr -d '\r' | sed '/^$/d')
    if printf '%s\n' "$packages" | grep -qv "^package:" || ! printf '%s\n' "$packages" | grep -qx "package:android"; then
        echo "cleanup: cannot read the package list; the emulator stays offline" >&2
        exit 5
    fi
    if printf '%s\n' "$packages" | grep -Eqx "package:$PKG(\.test)?"; then
        echo "cleanup: $PKG is still installed; the emulator stays offline" >&2
        exit 5
    fi
    airplane 0
    adb shell svc wifi enable
    adb shell svc data enable
    exit $status
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# Offline before the Cordova app starts: airplane mode plus Wi-Fi and data off. Abort if a default
# network is still active.
airplane 1
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
# A token delivered without an app open; the process ends while its PUT is in flight, and the next
# process completes the stored work (PushTokenWorkTest).
adb shell am instrument -w -e previous "$TOKEN" -e transport hold -e class $PKG.PushTokenWorkTest#tokenWorkIsInterruptedWithItsRequestInFlight $RUNNER | tee "$OUT/token-work-interrupted.txt"
adb shell am instrument -w -e previous "$TOKEN" -e class $PKG.PushTokenWorkTest#tokenWorkCompletesAfterTheProcessEnded $RUNNER | tee "$OUT/token-work-completed.txt"
adb logcat -d > "$OUT/logcat.txt"
adb exec-out run-as $PKG cat shared_prefs/com.google.android.gms.measurement.prefs.xml > "$OUT/measurement-after.xml" || true

grep -q "^OK (1 test)" "$OUT/first-start.txt"
grep -q "^OK (1 test)" "$OUT/after-restart.txt"
grep -q "^OK (1 test)" "$OUT/token-work-interrupted.txt"
grep -q "^OK (1 test)" "$OUT/token-work-completed.txt"
EVENTS=$(grep -c "Logging event" "$OUT/logcat.txt" || true)
echo "analytics events logged after the update: $EVENTS"
test "$EVENTS" -eq 0
echo "upgrade test passed; evidence in $OUT"
