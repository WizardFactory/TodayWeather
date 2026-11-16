#!/bin/sh
# The rollback hand-back on a simulator (IN-17, #2966 AC2; the Android run-handback-test.sh of AN-17):
#   run-handback-test.sh <simulator-udid> <cordova-1.1.1-app> <fallback-app> <out-dir>
# <cordova-1.1.1-app>: build-cordova.sh <dir> http://127.0.0.1:18452 07dbb370 (the shipped 1.1.1, without the reader).
# <fallback-app>:      build-cordova.sh <dir> http://127.0.0.1:18452 HEAD <version> (client/ with the reader; a version
#                      above this build's MARKETING_VERSION).
# 1. Cordova 1.1.1, seeded as in the upgrade test (seed-cordova.js; analytics opted in);
# 2. this build over it: places, alarms, units, the theme and the analytics choice changed (HandBackUpgradeTests edit);
# 3. the fallback build over this build: it shows that state, the stale WebView data notwithstanding, keeps the FCM token,
#    and its start counts and logs no analytics event (handback-cordova.js check; the SDK's event counters; its console);
#    then edits there with an analytics grant (edit). Its starts after this build's Firebase 13 must not crash;
# 4. this build again: it adopts those edits, keeps its own withdrawal, then grants (HandBackUpgradeTests adopt);
# 5. the fallback build again: it shows the adopted state and the native grant (check), then a withdrawal there;
# 6. this build again: the withdrawal holds (HandBackUpgradeTests withdrawn).
# Both Cordova builds have the local recorder as their server; the native build has no server URL. No request may leave
# the Mac (check_upgrade.py requests). Only simulators named tw_* or twios_* are accepted; the simulator is erased.
set -eu
UDID=$1
CORDOVA_APP=$2
FALLBACK_APP=$3
OUT=$4
PORT=18452
RECORDER=http://127.0.0.1:$PORT
BUNDLE=net.wizardfactory.todayweather
GROUP=group.net.wizardfactory.todayweather
HERE=$(cd "$(dirname "$0")" && pwd)
IOS=$(cd "$HERE/../.." && pwd)
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}

NAME=$(xcrun simctl list devices | sed -n "s/^ *\(.*\) ($UDID) .*/\1/p")
case "$NAME" in tw_*|twios_*) ;; *) echo "refusing simulator '$NAME' ($UDID): only simulators named tw_* or twios_* are erased" >&2; exit 2 ;; esac
for APP in "$CORDOVA_APP" "$FALLBACK_APP"; do
    grep -q "$RECORDER" "$APP/www/client.config.js" || { echo "$APP does not point at $RECORDER" >&2; exit 2; }
done
CORDOVA_VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$CORDOVA_APP/Info.plist")
FALLBACK_VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$FALLBACK_APP/Info.plist")
NATIVE_VERSION=$(sed -n 's/.*MARKETING_VERSION = \([0-9.]*\);.*/\1/p' "$IOS/TodayWeather.xcodeproj/project.pbxproj" | head -1)
[ "$CORDOVA_VERSION" = 1.1.1 ] || { echo "the first build must be the shipped 1.1.1 (is $CORDOVA_VERSION)" >&2; exit 4; }
grep -q "_handBack" "$CORDOVA_APP/www/js/service.storage.js" && { echo "the 1.1.1 build must predate the reader" >&2; exit 4; }
grep -q "_handBack" "$FALLBACK_APP/www/js/service.storage.js" || { echo "the fallback build lacks the reader" >&2; exit 4; }
python3 -c "import sys; v=lambda s: [int(x) for x in s.split('.')]; sys.exit(0 if v('$FALLBACK_VERSION') > v('$NATIVE_VERSION') else 1)" ||
    { echo "the fallback build needs a version above this build's ($FALLBACK_VERSION <= $NATIVE_VERSION)" >&2; exit 4; }

rm -rf "$OUT"
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$OUT/steps.log"; }
fail() { log "FAIL: $*"; exit 1; }
log "Cordova $CORDOVA_VERSION, native $NATIVE_VERSION, fallback $FALLBACK_VERSION"

# The port must be free: a server of another run there would get this run's requests (port 18452 is this tool's).
if lsof -nP -iTCP:$PORT -sTCP:LISTEN > /dev/null 2>&1; then fail "port $PORT is in use by another process"; fi
python3 "$HERE/recorder.py" $PORT "$OUT/recorder" > "$OUT/recorder.log" 2>&1 &
RECORDER_PID=$!
trap 'kill $RECORDER_PID 2>/dev/null || true' EXIT INT TERM
sleep 1
kill -0 $RECORDER_PID 2>/dev/null || fail "recorder did not start (port $PORT busy?)"

log "erase $NAME"
xcrun simctl shutdown "$UDID" 2>/dev/null || true
xcrun simctl erase "$UDID"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b > /dev/null
containers() {
    DATA=$(xcrun simctl get_app_container "$UDID" $BUNDLE data)
    SHARED=$(xcrun simctl get_app_container "$UDID" $BUNDLE $GROUP)
}

# A copy of a Cordova build with <script> as its first script; extra lines set window.TW_* values.
inject() {
    src=$1; dst=$2; script=$3; extra=$4
    rm -rf "$dst"
    cp -R "$src" "$dst"
    cp "$HERE/$script" "$dst/www/tw-test-$script"
    perl -0pi -e "s#<head>#<head>\n    <script>window.TW_RECORDER = '$RECORDER';$extra</script>\n    <script src=\"tw-test-$script\"></script>#" "$dst/www/index.html"
    codesign --force --sign - --timestamp=none --preserve-metadata=entitlements "$dst" 2> /dev/null
}

# 1. Cordova 1.1.1, seeded.
log "1. install the Cordova 1.1.1 build with the seed script"
inject "$CORDOVA_APP" "$OUT/Cordova.app" seed-cordova.js ""
xcrun simctl install "$UDID" "$OUT/Cordova.app"
xcrun simctl privacy "$UDID" grant location $BUNDLE
xcrun simctl launch "$UDID" $BUNDLE > /dev/null
i=0
until [ -s "$OUT/recorder/seeded.json" ]; do
    i=$((i + 1)); [ $i -le 120 ] || fail "no seed after 240 s"; sleep 2
done
containers
i=0
until python3 "$HERE/check_upgrade.py" event-stored "$DATA"; do
    i=$((i + 1)); [ $i -le 60 ] || break; sleep 2
done
xcrun simctl terminate "$UDID" $BUNDLE
containers
python3 "$HERE/check_upgrade.py" before "$OUT" "$DATA" "$SHARED" localStorage || fail "state before the update"

log "build the native app for testing"
DERIVED="$IOS/build/DerivedData"
(cd "$IOS" && xcodebuild build-for-testing -project TodayWeather.xcodeproj -scheme TodayWeather \
    -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath "$DERIVED" \
    CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual CODE_SIGNING_REQUIRED=YES DEVELOPMENT_TEAM= TW_SERVER_URL= \
    > "$OUT/build-for-testing.log" 2>&1) || fail "build-for-testing (see build-for-testing.log)"
XCTESTRUN=$(ls "$DERIVED"/Build/Products/TodayWeather_*iphonesimulator*.xctestrun | head -1)
mkdir -p "$OUT/products"
cp -R "$DERIVED/Build/Products/Debug-iphonesimulator" "$OUT/products/"
cp "$XCTESTRUN" "$OUT/products/TodayWeather.xctestrun"
APP="$OUT/products/Debug-iphonesimulator/TodayWeather.app"
python3 "$HERE/check_upgrade.py" dummy-plist "$APP/GoogleService-Info.plist"
[ -z "$(/usr/libexec/PlistBuddy -c 'Print :TWServerURL' "$APP/Info.plist")" ] || fail "the native build has a server URL"
codesign --force --sign - --timestamp=none --preserve-metadata=entitlements "$APP" 2> /dev/null
xcrun segedit "$APP/TodayWeather" -extract __TEXT __entitlements "$OUT/native-entitlements.plist"
grep -q "$GROUP" "$OUT/native-entitlements.plist" || fail "native app lacks the App Group entitlement"

# One step of HandBackUpgradeTests in the native build over what is installed; it must have run and passed.
native() {
    step=$1; test=$2; claim=${3:-}
    log "native app: $step"
    TEST_RUNNER_TW_HANDBACK_STEP="$step" TEST_RUNNER_TW_HANDBACK_CLAIM="$claim" \
        xcodebuild test-without-building -xctestrun "$OUT/products/TodayWeather.xctestrun" \
        -destination "platform=iOS Simulator,id=$UDID" -only-testing:TodayWeatherTests/HandBackUpgradeTests \
        -resultBundlePath "$OUT/native-$step.xcresult" > "$OUT/test-native-$step.log" 2>&1 ||
        fail "HandBackUpgradeTests $step (see test-native-$step.log)"
    python3 "$HERE/check_handback.py" tests "$OUT" "$step" "$OUT/native-$step.xcresult" "$test" || fail "$test did not run and pass"
    xcrun simctl terminate "$UDID" $BUNDLE 2>/dev/null || true
    containers
}

# The scene sessions UIKit keeps for the app (Library/Saved Application State): the native app's session names SwiftUI's
# scene delegate, which the Cordova build does not have, and UIKit restores it there, so the fallback build opens to a
# black window (seen on the iOS 26.5 simulator; ios/README.md, "Rollback hand-back"). Each fallback start below first
# removes them, as discarding the app from the app switcher does; the delegate classes found are kept as evidence.
forget_scenes() {
    containers
    saved="$DATA/Library/Saved Application State"
    python3 -c "
import glob, plistlib, sys
for path in glob.glob(sys.argv[1] + '/*/KnownSceneSessions/data.data'):
    for key, blob in plistlib.load(open(path, 'rb')).items():
        print(key, [o for o in plistlib.loads(blob)['\$objects'] if isinstance(o, str) and 'Delegate' in o])
" "$saved" > "$OUT/scene-sessions-$1.txt" 2>&1 || true
    rm -rf "$saved"
}

# One start of the fallback build in <mode>, reported as <report>; with the console of the app (Firebase debug logging).
fallback() {
    mode=$1; report=$2
    log "fallback build: $mode ($report)"
    forget_scenes "$report"
    inject "$FALLBACK_APP" "$OUT/Fallback-$report.app" handback-cordova.js \
        " window.TW_HANDBACK_MODE = '$mode'; window.TW_HANDBACK_REPORT = '$report';"
    xcrun simctl install "$UDID" "$OUT/Fallback-$report.app"
    SINCE=$(date +%s)
    SIMCTL_CHILD_OS_ACTIVITY_DT_MODE=YES xcrun simctl launch --console-pty --terminate-running-process "$UDID" $BUNDLE \
        -FIRAnalyticsDebugEnabled -FIRAnalyticsVerboseLoggingEnabled > "$OUT/console-$report.log" 2>&1 &
    LAUNCH_PID=$!
    i=0
    until [ -s "$OUT/recorder/$report.json" ]; do
        i=$((i + 1)); [ $i -le 90 ] || { kill $LAUNCH_PID 2>/dev/null || true; fail "no report $report after 180 s"; }; sleep 2
    done
    sleep 10
    xcrun simctl io "$UDID" screenshot "$OUT/$report.png" > /dev/null 2>&1 || true
    xcrun simctl terminate "$UDID" $BUNDLE 2>/dev/null || true
    kill $LAUNCH_PID 2>/dev/null || true
    containers
    python3 "$HERE/check_handback.py" crashes "$OUT" "$report" "$UDID" "$SINCE" || fail "the fallback build crashed ($report)"
}

# 2. This build over 1.1.1, with the native edits.
native edit "editsInTheNativeApp()"
python3 "$HERE/check_handback.py" suite "$SHARED" "$OUT/suite-native-1.json" native || fail "the native hand-back"
python3 "$HERE/check_handback.py" measure "$DATA" "$OUT/measurement-native-1.json"

# 3. The fallback build shows the native state; its start counts no event; then edits there.
fallback check fallback-check-1
python3 "$HERE/check_handback.py" check "$OUT" fallback-check-1 "$OUT/suite-native-1.json" \
    '{"names":[null,"명동","부산"],"index":2,"temperatureUnit":"C","theme":"light","consent":false}' || fail "fallback check 1"
python3 "$HERE/check_handback.py" events "$OUT" fallback-check-1 "$DATA" "$OUT/measurement-native-1.json" \
    "$OUT/measurement-fallback-1.json" || fail "the fallback build counted an event under the native withdrawal"
python3 "$HERE/check_handback.py" console "$OUT" fallback-check-1 "$OUT/console-fallback-check-1.log" ||
    fail "the fallback build logged an event under the native withdrawal"
fallback edit fallback-edit
python3 "$HERE/check_handback.py" edit "$OUT" fallback-edit || fail "fallback edit"
python3 "$HERE/check_handback.py" suite "$SHARED" "$OUT/suite-fallback-1.json" cordova || fail "the fallback claim"
CLAIM1=$(python3 "$HERE/check_handback.py" marker "$OUT/suite-fallback-1.json")

# 4. This build again: it adopts the fallback build's state.
native adopt "adoptsWhatTheFallbackBuildChanged()" "$CLAIM1"
# The adoption (claim + 1) and the grant (claim + 2).
python3 "$HERE/check_handback.py" suite "$SHARED" "$OUT/suite-native-2.json" native $((CLAIM1 + 2)) || fail "the native hand-back"

# 5. The fallback build again: the adopted state and the native grant; a withdrawal.
fallback check fallback-check-2
python3 "$HERE/check_handback.py" check "$OUT" fallback-check-2 "$OUT/suite-native-2.json" \
    '{"names":[null,"명동","대전"],"index":2,"temperatureUnit":"F","theme":"dark","consent":true}' || fail "fallback check 2"
fallback withdraw fallback-withdraw
python3 "$HERE/check_handback.py" withdraw "$OUT" fallback-withdraw || fail "fallback withdrawal"
python3 "$HERE/check_handback.py" suite "$SHARED" "$OUT/suite-fallback-2.json" cordova $((CLAIM1 + 3)) || fail "the fallback claim"
CLAIM2=$(python3 "$HERE/check_handback.py" marker "$OUT/suite-fallback-2.json")

# 6. This build again: the withdrawal holds.
native withdrawn "aWithdrawalInTheFallbackBuildHolds()" "$CLAIM2"
python3 "$HERE/check_handback.py" suite "$SHARED" "$OUT/suite-native-3.json" native $((CLAIM2 + 1)) || fail "the native hand-back"

python3 "$HERE/check_handback.py" requests "$OUT" || fail "a request left the Mac"
log "PASS"
