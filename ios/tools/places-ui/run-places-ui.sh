#!/bin/sh
# IN-11 (#2960) UI tests with real touches (ios/TodayWeatherUITests/PlacesUITests.swift) on a tw* simulator the caller holds:
#   run-places-ui.sh fixture <out-dir> <tw* simulator udid>      completion criterion 3: a drag across the chart scrolls
#                                                                 only the chart (local fixture server, no Places key)
#   run-places-ui.sh production <out-dir> <tw* simulator udid>   completion criterion 2: 부산 and London searched with the
#                                                                 Places SDK, added, swiped between, London deleted
#                                                                 (read-only weather and geocode GETs to the legacy server)
# The app and the UI tests are built ad hoc signed (the app needs its App Group entitlement to finish its start; an
# unsigned build stays on the launch screen) into ios/build/DerivedData: `fixture` with TW_SERVER_URL set to the local
# fixture server (tools/places-ui/fixture_server.py) and no Places key, `production` with ios/Private.xcconfig
# (TW_SERVER_URL, TW_PLACES_API_KEY_IOS). No GoogleService-Info.plist is in either build, so no FCM token exists and no
# push request can be sent; the production test also checks that no place it adds has an alarm before it deletes one.
# Each run uninstalls the app, writes the answer "Ask App Not to Track" to the simulator's TCC database (no UMP
# explainer over the page, as tools/ads/run-ads-check.sh does), installs nothing itself (xcodebuild installs the app
# fresh) and runs the one test with TEST_RUNNER_TW_PLACES_UI=<mode>. The app's unified log, the xcodebuild log and the
# test's screenshots are saved to <out-dir>; the server host and the Places key are replaced by placeholders in every
# saved log. The app is uninstalled at the end.
set -eu
MODE=$1
OUT=$2
UDID=$3
BUNDLE=net.wizardfactory.todayweather
PORT=18461
case "$MODE" in
  fixture) TEST=testDraggingAChartScrollsOnlyTheChart ;;
  production) TEST=testSearchAddSwipeAndDeleteAgainstProduction ;;
  *) echo "mode: fixture or production" >&2; exit 2 ;;
esac
HERE=$(cd "$(dirname "$0")" && pwd)
IOS=$(cd "$HERE/../.." && pwd)
NAME=$(xcrun simctl list devices | grep "$UDID" | sed 's/ (.*//; s/^ *//')
case "$NAME" in tw*) ;; *) echo "refusing simulator '$NAME' ($UDID): only tw* simulators of this project" >&2; exit 2 ;; esac
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
HOST=placeholder.invalid
KEY=placeholder-key
if [ "$MODE" = production ]; then
  HOST=$(sed -n 's/^TW_SERVER_URL *= *//p' "$IOS/Private.xcconfig" | sed 's#https:/$()/##; s#http:/$()/##; s#/.*##')
  KEY=$(sed -n 's/^TW_PLACES_API_KEY_IOS *= *//p' "$IOS/Private.xcconfig")
  [ -n "$HOST" ] && [ -n "$KEY" ] || { echo "ios/Private.xcconfig needs TW_SERVER_URL and TW_PLACES_API_KEY_IOS" >&2; exit 2; }
fi
redact() { sed -e "s#$HOST#<server>#g" -e "s#$KEY#<places-key>#g"; }
TCC="$HOME/Library/Developer/CoreSimulator/Devices/$UDID/data/Library/TCC/TCC.db"

SERVER_PID=
if [ "$MODE" = fixture ]; then
  python3 "$HERE/fixture_server.py" "$PORT" "$OUT/fixture-requests.json" &
  SERVER_PID=$!
  SETTINGS="TW_SERVER_URL=http://127.0.0.1:$PORT TW_PLACES_API_KEY_IOS= TW_WEATHER_PHOTOS_URL= TW_MAIL_TO="
else
  SETTINGS="TW_WEATHER_PHOTOS_URL= TW_MAIL_TO="
fi
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  [ -n "${LOGPID:-}" ] && kill "$LOGPID" 2>/dev/null || true
  xcrun simctl uninstall "$UDID" "$BUNDLE" 2>/dev/null || true
}
trap cleanup EXIT

# shellcheck disable=SC2086
xcodebuild -project "$IOS/TodayWeather.xcodeproj" -scheme TodayWeatherUITests -destination "platform=iOS Simulator,id=$UDID" \
  -derivedDataPath "$IOS/build/DerivedData" CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual CODE_SIGNING_REQUIRED=YES \
  DEVELOPMENT_TEAM= $SETTINGS build-for-testing > "$OUT/$MODE-build.raw.log" 2>&1 || { redact < "$OUT/$MODE-build.raw.log" > "$OUT/$MODE-build.log"; rm -f "$OUT/$MODE-build.raw.log"; echo "build failed" >&2; exit 1; }
redact < "$OUT/$MODE-build.raw.log" > "$OUT/$MODE-build.log"
rm -f "$OUT/$MODE-build.raw.log"
APP="$IOS/build/DerivedData/Build/Products/Debug-iphonesimulator/TodayWeather.app"
if [ "$MODE" = fixture ]; then
  /usr/libexec/PlistBuddy -c "Print :TWServerURL" "$APP/Info.plist" | grep -q "^http://127.0.0.1:$PORT$" || { echo "the fixture build does not use the local server" >&2; exit 1; }
fi
[ ! -e "$APP/GoogleService-Info.plist" ] || { echo "the build holds a Firebase configuration: no push may be possible here" >&2; exit 1; }

xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl uninstall "$UDID" "$BUNDLE" 2>/dev/null || true
xcrun simctl privacy "$UDID" revoke location "$BUNDLE" 2>/dev/null || true
xcrun simctl shutdown "$UDID" 2>/dev/null || true
sqlite3 "$TCC" "DELETE FROM access WHERE service='kTCCServiceUserTracking' AND client='$BUNDLE';
  INSERT INTO access (service, client, client_type, auth_value, auth_reason, auth_version, flags)
  VALUES ('kTCCServiceUserTracking', '$BUNDLE', 0, 0, 2, 1, 0);"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b >/dev/null

xcrun simctl spawn "$UDID" log stream --level info --predicate 'subsystem == "net.wizardfactory.todayweather"' \
  > "$OUT/$MODE-unified.raw.log" 2>&1 &
LOGPID=$!
STATUS=0
rm -rf "$OUT/$MODE.xcresult"
TEST_RUNNER_TW_PLACES_UI=$MODE xcodebuild -project "$IOS/TodayWeather.xcodeproj" -scheme TodayWeatherUITests \
  -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath "$IOS/build/DerivedData" -resultBundlePath "$OUT/$MODE.xcresult" \
  test-without-building -only-testing:"TodayWeatherUITests/PlacesUITests/$TEST" > "$OUT/$MODE-xcodebuild.raw.log" 2>&1 || STATUS=$?
redact < "$OUT/$MODE-xcodebuild.raw.log" > "$OUT/$MODE-xcodebuild.log"
rm -f "$OUT/$MODE-xcodebuild.raw.log"
kill "$LOGPID" 2>/dev/null || true
LOGPID=
redact < "$OUT/$MODE-unified.raw.log" > "$OUT/$MODE-unified.log"
rm -f "$OUT/$MODE-unified.raw.log"
rm -rf "$OUT/$MODE-screenshots"
mkdir -p "$OUT/$MODE-screenshots"
xcrun xcresulttool export attachments --path "$OUT/$MODE.xcresult" --output-path "$OUT/$MODE-screenshots" > "$OUT/$MODE-export.log" 2>&1 || true
# The test's named screenshots under their names; the recordings and hierarchies of the runner are dropped.
python3 - "$OUT/$MODE-screenshots" <<'PY'
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
        if file.endswith(".png") or name.split("_")[0] in ("before-drag", "after-drag", "after-header-swipe", "busan-hourly",
                                                            "london-hourly", "swiped-to-busan", "places-list", "after-delete"):
            target = name.split("_")[0] + ".png"
            os.replace(os.path.join(d, file), os.path.join(d, target))
            keep.add(target)
for f in os.listdir(d):
    if f not in keep:
        os.remove(os.path.join(d, f))
PY
rm -rf "$OUT/$MODE.xcresult"   # its logs are not redacted; the redacted log and the screenshots are kept
grep -E "Test Case|passed|failed|skipped|error:" "$OUT/$MODE-xcodebuild.log" | tail -8
if ! grep -q "Test Case .*$TEST.* passed" "$OUT/$MODE-xcodebuild.log"; then
  echo "the $MODE UI test did not pass (or was skipped)" >&2
  [ "$STATUS" -ne 0 ] || STATUS=1
fi
if [ "$MODE" = fixture ]; then
  python3 - "$OUT/fixture-requests.json" <<'PY'
import json, sys
requests = json.load(open(sys.argv[1]))
bad = [r for r in requests if not r["path"].startswith(("/weather/v000903/coord/", "/geocode/v000903/"))]
print(f"fixture server: {len(requests)} requests, {len(bad)} other")
if bad:
    sys.exit(f"unexpected requests: {bad[:5]}")
PY
fi
exit "$STATUS"
