#!/bin/sh
# Simulator upgrade test (IN-03, #2952): Cordova 1.1.1 test build -> native debug build.
#   run-upgrade-test.sh <simulator-udid> <cordova-app> <out-dir> [localStorage|suite]
#
# <cordova-app> comes from build-cordova.sh (server URL = this recorder, dummy Firebase project). The script:
#  1. starts recorder.py on 127.0.0.1:18452 and erases the simulator (only a simulator named tw_*);
#  2. installs a copy of the Cordova app with seed-cordova.js injected, launches it, waits for the seed (places,
#     units, settings, alarms, analytics opt-in written through the app's own services) and stops it;
#  3. checks that the opt-in reached the Firebase SDK (persisted collection flag on) and records the SDK's event
#     counters; for "suite" it then deletes Library/WebKit, so only the App Group suite holds the state (an update
#     from 1.0.10 has no app://localhost storage);
#  4. builds the native app for testing, ad hoc signed with its App Group entitlement, adds a dummy
#     GoogleService-Info.plist to a copy of the products and runs TodayWeatherTests over the Cordova install
#     (first start), then again (restart), then launches it with Firebase debug logging (until the SDK takes it);
#  5. fails unless the migrated state matches, the state file is unchanged by the restarts, the SDK's event
#     counters are unchanged and no event is logged, and no request of the Cordova app went to a host other than
#     this Mac (the seed script redirects such requests to the recorder; any API path elsewhere fails too).
# Results: <out-dir>/summary.json and the logs next to it.
set -eu
UDID=$1
CORDOVA_APP=$2
OUT=$3
SOURCE=${4:-localStorage}
case "$SOURCE" in localStorage|suite) ;; *) echo "source must be localStorage or suite" >&2; exit 2 ;; esac
PORT=18452
RECORDER=http://127.0.0.1:$PORT
BUNDLE=net.wizardfactory.todayweather
GROUP=group.net.wizardfactory.todayweather
HERE=$(cd "$(dirname "$0")" && pwd)
IOS=$(cd "$HERE/../.." && pwd)
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}

NAME=$(xcrun simctl list devices | sed -n "s/^ *\(.*\) ($UDID) .*/\1/p")
case "$NAME" in tw_*) ;; *) echo "refusing simulator '$NAME' ($UDID): only simulators named tw_* are erased" >&2; exit 2 ;; esac
grep -q "$RECORDER" "$CORDOVA_APP/www/client.config.js" || { echo "the Cordova app does not point at $RECORDER" >&2; exit 2; }

rm -rf "$OUT"
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$OUT/steps.log"; }
fail() { log "FAIL: $*"; exit 1; }

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

log "install the Cordova test build with the seed script"
cp -R "$CORDOVA_APP" "$OUT/Cordova.app"
cp "$HERE/seed-cordova.js" "$OUT/Cordova.app/www/tw-upgrade-seed.js"
perl -0pi -e "s#<head>#<head>\n    <script>window.TW_RECORDER = '$RECORDER';</script>\n    <script src=\"tw-upgrade-seed.js\"></script>#" "$OUT/Cordova.app/www/index.html"
codesign --force --sign - --timestamp=none --preserve-metadata=entitlements "$OUT/Cordova.app" 2> /dev/null
xcrun simctl install "$UDID" "$OUT/Cordova.app"
xcrun simctl privacy "$UDID" grant location $BUNDLE
xcrun simctl launch "$UDID" $BUNDLE > /dev/null
i=0
until [ -s "$OUT/recorder/seeded.json" ]; do
    i=$((i + 1)); [ $i -le 120 ] || fail "no seed after 240 s"; sleep 2
done
# The containers move to new paths when an app is installed over another; look them up before each check.
containers() {
    DATA=$(xcrun simctl get_app_container "$UDID" $BUNDLE data)
    SHARED=$(xcrun simctl get_app_container "$UDID" $BUNDLE $GROUP)
}
containers
# The SDK stores the event counted under the opt-in asynchronously: keep the app running until it is stored
# (at most 120 s), or a stop would lose it.
i=0
until python3 "$HERE/check_upgrade.py" event-stored "$DATA"; do
    i=$((i + 1)); [ $i -le 60 ] || break; sleep 2
done
xcrun simctl terminate "$UDID" $BUNDLE
containers
python3 "$HERE/check_upgrade.py" before "$OUT" "$DATA" "$SHARED" "$SOURCE" || fail "state before the update"

if [ "$SOURCE" = suite ]; then
    log "remove the WebKit storage (state only in the App Group suite)"
    rm -rf "$DATA/Library/WebKit"
fi

log "build the native app for testing"
DERIVED="$IOS/build/DerivedData"
(cd "$IOS" && xcodebuild build-for-testing -project TodayWeather.xcodeproj -scheme TodayWeather \
    -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath "$DERIVED" \
    CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual CODE_SIGNING_REQUIRED=YES DEVELOPMENT_TEAM= \
    > "$OUT/build-for-testing.log" 2>&1) || fail "build-for-testing (see build-for-testing.log)"
XCTESTRUN=$(ls "$DERIVED"/Build/Products/TodayWeather_*iphonesimulator*.xctestrun | head -1)
mkdir -p "$OUT/products"
cp -R "$DERIVED/Build/Products/Debug-iphonesimulator" "$OUT/products/"
cp "$XCTESTRUN" "$OUT/products/TodayWeather.xctestrun"
APP="$OUT/products/Debug-iphonesimulator/TodayWeather.app"
python3 "$HERE/check_upgrade.py" dummy-plist "$APP/GoogleService-Info.plist"
codesign --force --sign - --timestamp=none --preserve-metadata=entitlements "$APP" 2> /dev/null
# Simulator builds carry their entitlements in the executable's __TEXT,__entitlements section.
xcrun segedit "$APP/TodayWeather" -extract __TEXT __entitlements "$OUT/native-entitlements.plist"
grep -q "$GROUP" "$OUT/native-entitlements.plist" || fail "native app lacks the App Group entitlement"

SEED=$(base64 < "$OUT/recorder/seeded.json" | tr -d '\n')
[ -n "$SEED" ] || fail "no seed to deliver"
for PHASE in first restart; do
    log "native app: $PHASE start and TodayWeatherTests"
    TEST_RUNNER_TW_UPGRADE_SEED="$SEED" TEST_RUNNER_TW_UPGRADE_SOURCE="$SOURCE" TEST_RUNNER_TW_UPGRADE_PHASE="$PHASE" \
        xcodebuild test-without-building -xctestrun "$OUT/products/TodayWeather.xctestrun" \
        -destination "platform=iOS Simulator,id=$UDID" -only-testing:TodayWeatherTests \
        -resultBundlePath "$OUT/$PHASE.xcresult" > "$OUT/test-$PHASE.log" 2>&1 || fail "TodayWeatherTests ($PHASE, see test-$PHASE.log)"
    # The upgrade tests are skipped without the seed: require each of them passed in the result bundle.
    python3 "$HERE/check_upgrade.py" tests-passed "$OUT" "$PHASE" "$OUT/$PHASE.xcresult" ||
        fail "CordovaUpgradeTests did not all run and pass ($PHASE)"
    xcrun simctl terminate "$UDID" $BUNDLE 2>/dev/null || true
    containers
    python3 "$HERE/check_upgrade.py" after "$OUT" "$DATA" "$SHARED" "$SOURCE" "$PHASE" || fail "state after the $PHASE start"
done

# The SDK does not always take the debug arguments on the launch that first passes them (seen on the simulator),
# so launch up to three times until its log says debug logging is on; check_upgrade.py reads every launch's log.
for N in 1 2 3; do
    log "launch once more with Firebase Analytics debug logging ($N)"
    SIMCTL_CHILD_OS_ACTIVITY_DT_MODE=YES xcrun simctl launch --console-pty --terminate-running-process "$UDID" $BUNDLE \
        -FIRAnalyticsDebugEnabled -FIRAnalyticsVerboseLoggingEnabled > "$OUT/debug-launch-$N.log" 2>&1 &
    LAUNCH_PID=$!
    sleep 20
    xcrun simctl terminate "$UDID" $BUNDLE 2>/dev/null || true
    kill $LAUNCH_PID 2>/dev/null || true
    grep -q "To disable debug logging" "$OUT/debug-launch-$N.log" && break
done
containers
python3 "$HERE/check_upgrade.py" final "$OUT" "$DATA" "$SHARED" "$SOURCE" || fail "after the debug launch"
log "PASS ($SOURCE)"
