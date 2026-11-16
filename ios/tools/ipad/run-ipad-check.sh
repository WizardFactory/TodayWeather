#!/bin/sh
# IN-18 (#2967) AC4 on an iPad simulator the caller holds (ios/TodayWeatherUITests/IPadUITests.swift):
#   run-ipad-check.sh <out-dir> <tw* iPad simulator udid>
# Every screen and the main dialogs at xxxLarge, with the simulator turned between portrait and landscape on each.
# The app and the UI tests are built ad hoc signed (the app needs its App Group entitlement to finish its start) into
# ios/build/DerivedData with TW_SERVER_URL set to the local fixture server (tools/ipad/fixture_server.py) and no Places
# key, photo feed or mail address. No GoogleService-Info.plist is in the build, so no FCM token exists and no push
# request can be sent; the fixture server fails the run on any request but weather, geocode, nation and warnings. The
# run uninstalls the app, writes the answer "Ask App Not to Track" to the simulator's TCC database (no UMP explainer
# over the page), runs the one test with TEST_RUNNER_TW_IPAD_UI=1 and keeps the xcodebuild log, the fixture server's
# requests and the test's screenshots (<state>-<orientation>.png) in <out-dir>. The app is uninstalled at the end.
set -eu
OUT=$1
UDID=$2
BUNDLE=net.wizardfactory.todayweather
PORT=18470
TEST=testEveryScreenTurnsAtTheLargestTextSize
HERE=$(cd "$(dirname "$0")" && pwd)
IOS=$(cd "$HERE/../.." && pwd)
NAME=$(xcrun simctl list devices | grep "$UDID" | sed 's/ (.*//; s/^ *//')
case "$NAME" in tw*) ;; *) echo "refusing simulator '$NAME' ($UDID): only tw* simulators of this project" >&2; exit 2 ;; esac
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
TCC="$HOME/Library/Developer/CoreSimulator/Devices/$UDID/data/Library/TCC/TCC.db"

python3 "$HERE/fixture_server.py" "$PORT" "$OUT/fixture-requests.json" &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  xcrun simctl uninstall "$UDID" "$BUNDLE" 2>/dev/null || true
}
trap cleanup EXIT

xcodebuild -project "$IOS/TodayWeather.xcodeproj" -scheme TodayWeatherUITests -destination "platform=iOS Simulator,id=$UDID" \
  -derivedDataPath "$IOS/build/DerivedData" CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual CODE_SIGNING_REQUIRED=YES \
  DEVELOPMENT_TEAM= COMPILER_INDEX_STORE_ENABLE=NO TW_SERVER_URL="http://127.0.0.1:$PORT" TW_PLACES_API_KEY_IOS= \
  TW_WEATHER_PHOTOS_URL= TW_MAIL_TO= build-for-testing > "$OUT/build.log" 2>&1 || { echo "build failed" >&2; exit 1; }
APP="$IOS/build/DerivedData/Build/Products/Debug-iphonesimulator/TodayWeather.app"
/usr/libexec/PlistBuddy -c "Print :TWServerURL" "$APP/Info.plist" | grep -q "^http://127.0.0.1:$PORT$" || { echo "the build does not use the local server" >&2; exit 1; }
[ ! -e "$APP/GoogleService-Info.plist" ] || { echo "the build holds a Firebase configuration: no push may be possible here" >&2; exit 1; }

xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl uninstall "$UDID" "$BUNDLE" 2>/dev/null || true
xcrun simctl shutdown "$UDID" 2>/dev/null || true
sqlite3 "$TCC" "DELETE FROM access WHERE service='kTCCServiceUserTracking' AND client='$BUNDLE';
  INSERT INTO access (service, client, client_type, auth_value, auth_reason, auth_version, flags)
  VALUES ('kTCCServiceUserTracking', '$BUNDLE', 0, 0, 2, 1, 0);"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b >/dev/null

STATUS=0
rm -rf "$OUT/ipad.xcresult"
TEST_RUNNER_TW_IPAD_UI=1 xcodebuild -project "$IOS/TodayWeather.xcodeproj" -scheme TodayWeatherUITests \
  -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath "$IOS/build/DerivedData" -resultBundlePath "$OUT/ipad.xcresult" \
  test-without-building -only-testing:"TodayWeatherUITests/IPadUITests/$TEST" > "$OUT/xcodebuild.log" 2>&1 || STATUS=$?
rm -rf "$OUT/screenshots"
mkdir -p "$OUT/screenshots"
xcrun xcresulttool export attachments --path "$OUT/ipad.xcresult" --output-path "$OUT/screenshots" > "$OUT/export.log" 2>&1 || true
# The test's named screenshots under their names; the runner's other attachments are dropped.
python3 - "$OUT/screenshots" <<'PY'
import json, os, sys
d = sys.argv[1]
try:
    manifest = json.load(open(os.path.join(d, "manifest.json")))
except OSError:
    sys.exit(0)
keep = set()
for test in manifest:
    for a in test.get("attachments", []):
        name, file = a.get("suggestedHumanReadableName", ""), a.get("exportedFileName", "")
        if file.endswith(".png"):
            target = name.split("_")[0] + ".png"
            os.replace(os.path.join(d, file), os.path.join(d, target))
            keep.add(target)
for f in os.listdir(d):
    if f not in keep:
        os.remove(os.path.join(d, f))
PY
rm -rf "$OUT/ipad.xcresult"
grep -E "Test Case|passed|failed|skipped|error:" "$OUT/xcodebuild.log" | tail -8
if ! grep -q "Test Case .*$TEST.* passed" "$OUT/xcodebuild.log"; then
  echo "the iPad UI test did not pass (or was skipped)" >&2
  [ "$STATUS" -ne 0 ] || STATUS=1
fi
python3 - "$OUT/fixture-requests.json" <<'PY'
import json, sys
requests = json.load(open(sys.argv[1]))
allowed = ("/weather/v000903/coord/", "/v000903/kma/addr/", "/geocode/v000903/", "/v000903/nation/", "/v000903/kma/special")
bad = [r for r in requests if r["method"] != "GET" or not r["path"].startswith(allowed)]
print(f"fixture server: {len(requests)} requests, {len(bad)} other")
if bad:
    sys.exit(f"unexpected requests: {bad[:5]}")
PY
exit "$STATUS"
