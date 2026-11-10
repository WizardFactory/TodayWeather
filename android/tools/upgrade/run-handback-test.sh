#!/bin/sh
# The rollback hand-back on an emulator (AN-17, #2896 AC2):
# 1. Cordova 1.1.1, seeded as in the upgrade test (seed-cordova.mjs; analytics opted in);
# 2. this build over it: places, alarms, units, the theme and the analytics choice changed (HandBackDeviceTest edit);
# 3. a fallback Cordova build with a higher versionCode over this build: it shows that state, the stale WebView data
#    notwithstanding, keeps the FCM token (verify-handback.mjs check) and never turns collection on (the measurement
#    SDK's own log of the app's process); its start after this build's newer Firebase SDKs must not crash;
# 4. edits there (verify-handback.mjs edit, with an analytics grant);
# 5. this build again (a lower versionCode, `install -r -d`): it adopts those edits, keeps its own withdrawal and grants
#    (HandBackDeviceTest adopt);
# 6. the fallback build again: it shows the adopted state (check), then a withdrawal there (withdraw);
# 7. this build again: the withdrawal holds (HandBackDeviceTest withdrawn).
#   ANDROID_SERIAL=emulator-5554 android/tools/upgrade/run-handback-test.sh <cordova-1.1.1-debug.apk> <fallback-debug.apk> [out-dir]
# The fallback APK is client/ built with a versionCode above this build's (README, "Rollback hand-back"). The emulator
# stays offline while either app is installed (tools/emulator/offline.sh), so neither gets an FCM token or reaches a
# server; the test app records push requests. Requires the native debug and androidTest APKs (./gradlew assembleDebug
# assembleDebugAndroidTest) signed with the Cordova APKs' debug key.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/../emulator/offline.sh"
emulator_guard
CORDOVA_APK=$1
FALLBACK_APK=$2
OUT=${3:-/tmp/tw-handback}
APP=$HERE/../../app/build/outputs/apk
RUNNER=$PKG.test/$PKG.TestRunner
mkdir -p "$OUT"
trap offline_cleanup EXIT
trap 'exit 130' INT TERM

AAPT2=$(ls -d "${ANDROID_HOME:-$HOME/Library/Android/sdk}"/build-tools/*/aapt2 | tail -1)
version() { "$AAPT2" dump badging "$1" | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p"; }
[ "$(version "$FALLBACK_APK")" -gt "$(version "$APP/debug/app-debug.apk")" ] ||
    { echo "the fallback APK needs a versionCode above this build's" >&2; exit 4; }

# One instrumented test; its output goes to $OUT/<name>.txt and must report one passing test.
check() {
    name=$1; shift
    adb shell am instrument -w "$@" $RUNNER > "$OUT/$name.txt"
    grep -q "^OK (1 test)" "$OUT/$name.txt" || { cat "$OUT/$name.txt" >&2; echo "$name failed" >&2; exit 1; }
}
# A private file of the app, copied to $OUT/<name>.
pull() { adb exec-out run-as $PKG cat "$1" > "$OUT/$2"; }
# The generation in the hand-back marker of a pulled suite.
generation() {
    node -e 'const x=require("fs").readFileSync(process.argv[1],"utf8").match(/<string name="_twHandBack">([^<]*)</);
        process.stdout.write(String(JSON.parse(x[1].replace(/&quot;/g,"\"").replace(/&amp;/g,"&")).generation))' "$OUT/$1"
}
# The fallback build over this build, opened; logcat starts empty so its crashes and errors can be read afterwards.
fallback() {
    adb logcat -c
    adb install -r "$FALLBACK_APK" >/dev/null
    adb shell am start -n $PKG/.MainActivity >/dev/null
}
# After a fallback run: no crash of the app, and the Firebase SDKs' errors kept for the record.
fallback_logs() {
    adb logcat -d -b crash > "$OUT/$1-crash.txt"
    adb logcat -d | grep -iE "AndroidRuntime|FATAL|SQLite|downgrade|FirebaseInstallations|FirebaseMessaging|FA-SVC|FA  " \
        > "$OUT/$1-firebase.txt" || true
    if grep -q "$PKG" "$OUT/$1-crash.txt"; then cat "$OUT/$1-crash.txt" >&2; echo "$1: the fallback build crashed" >&2; exit 1; fi
}
flag() { grep -o "name=\"$2\" value=\"[a-z]*\"" "$OUT/$1" | sed 's/.*value="\(.*\)"/\1/'; }

go_offline
# The measurement SDK logs collection switches and events (read in step 3).
adb shell setprop log.tag.FA VERBOSE
adb shell setprop log.tag.FA-SVC VERBOSE
adb uninstall $PKG.test >/dev/null 2>&1 || true
adb uninstall $PKG >/dev/null 2>&1 || true

# 1. Cordova 1.1.1, seeded.
adb install "$CORDOVA_APK" >/dev/null
adb shell am start -n $PKG/.MainActivity >/dev/null
node "$HERE/seed-cordova.mjs" "$ANDROID_SERIAL" > "$OUT/seeded.json"
adb shell am force-stop $PKG
pull shared_prefs/firebasex_settings.xml firebasex-seeded.xml
[ "$(flag firebasex-seeded.xml firebase_analytics_collection_enabled)" = true ] ||
    { echo "precondition: the Cordova opt-in did not enable collection" >&2; exit 4; }

# 2. This build over it, with the native edits.
adb install -r "$APP/debug/app-debug.apk" >/dev/null
adb install -r "$APP/androidTest/debug/app-debug-androidTest.apk" >/dev/null
check native-edit -e handBack edit -e class $PKG.HandBackDeviceTest#editsInTheNativeApp
adb shell am force-stop $PKG
pull shared_prefs/group.net.wizardfactory.todayweather.xml suite-native-1.xml

# 3. The fallback build shows the native state; its plugin's collection flag, on since the seed, goes off.
fallback
node "$HERE/verify-handback.mjs" check "$ANDROID_SERIAL" "$OUT/suite-native-1.xml" \
    '{"names":[null,"명동","부산"],"index":2,"temperatureUnit":"C","theme":"light","consent":false}' > "$OUT/fallback-check-1.json"
adb exec-out screencap -p > "$OUT/fallback-1.png"
pull shared_prefs/firebasex_settings.xml firebasex-fallback-1.xml
[ "$(flag firebasex-fallback-1.xml firebase_analytics_collection_enabled)" = false ] ||
    { echo "the fallback build left analytics collection on" >&2; exit 1; }
# Not even for a moment: the WebView's stale grant must not apply before the hand-back was read.
adb logcat -d --pid="$(adb shell pidof $PKG | tr -d '\r')" > "$OUT/fallback-1-process.txt"
grep -q "App measurement disabled by setAnalyticsCollectionEnabled(false)" "$OUT/fallback-1-process.txt" ||
    { echo "precondition: no measurement log of the fallback build's process" >&2; exit 4; }
if grep -E "Setting app measurement enabled \(FE\): true|Logging event" "$OUT/fallback-1-process.txt" >&2; then
    echo "the fallback build turned collection on before the hand-back was read" >&2; exit 1
fi

# 4. Edits in the fallback build.
node "$HERE/verify-handback.mjs" edit "$ANDROID_SERIAL" > "$OUT/fallback-edit.json"
adb shell am force-stop $PKG
fallback_logs fallback-1
pull shared_prefs/group.net.wizardfactory.todayweather.xml suite-fallback-1.xml

# 5. This build again: it adopts the fallback build's state.
adb install -r -d "$APP/debug/app-debug.apk" >/dev/null
check native-adopt -e handBack adopt -e claim "$(generation suite-fallback-1.xml)" -e class $PKG.HandBackDeviceTest#adoptsWhatTheFallbackBuildChanged
adb shell am force-stop $PKG
pull shared_prefs/group.net.wizardfactory.todayweather.xml suite-native-2.xml

# 6. The fallback build again: the adopted state and the native grant (its plugin's flag is on since step 4); a withdrawal.
fallback
node "$HERE/verify-handback.mjs" check "$ANDROID_SERIAL" "$OUT/suite-native-2.xml" \
    '{"names":[null,"명동","대전"],"index":2,"temperatureUnit":"F","theme":"dark","consent":true}' > "$OUT/fallback-check-2.json"
adb exec-out screencap -p > "$OUT/fallback-2.png"
node "$HERE/verify-handback.mjs" withdraw "$ANDROID_SERIAL" > "$OUT/fallback-withdraw.json"
adb shell am force-stop $PKG
fallback_logs fallback-2
pull shared_prefs/group.net.wizardfactory.todayweather.xml suite-fallback-2.xml

# 7. This build again: the withdrawal holds.
adb install -r -d "$APP/debug/app-debug.apk" >/dev/null
check native-withdrawn -e handBack withdrawn -e claim "$(generation suite-fallback-2.xml)" -e class $PKG.HandBackDeviceTest#aWithdrawalInTheFallbackBuildHolds
echo "hand-back passed; evidence in $OUT"
