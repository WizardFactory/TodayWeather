#!/bin/sh
# IN-14 (#2963) notification check on a simulator, without any push server:
#   run-notification-check.sh <tw* simulator udid> <out-dir>
# Builds the app and the UI tests ad hoc signed into ios/build/DerivedData with TW_SERVER_URL pointing at the local
# fixture server of tools/places-ui (weather and geocode only; any other request, a push request included, fails the run)
# and adds a dummy GoogleService-Info.plist (a Firebase project that does not exist: the push plugin runs, S09 asks for
# the permission, and no FCM token, so no registration, can exist). It uninstalls the app, answers the tracking question
# in the simulator's TCC database, sets Korean with the Korean keyboard, and runs NotificationUITests with a handshake directory: at each step the test writes
# <step>.ready, the script delivers a notification shaped like the production FCM/APNs one with `xcrun simctl push`
# (`aps.alert` title and body, `cityIndex` a string, FCM's `gcm.message_id` and `google.c.*` keys) and writes
# <step>.pushed. Steps: foreground (O07), warm (banner tap with the app in the background), cold (tap after the app
# ended). The redacted logs, the test's screenshots, the payloads and the fixture server's requests stay in <out-dir>.
set -eu
UDID=$1
OUT=$2
BUNDLE=net.wizardfactory.todayweather
PORT=18462
HERE=$(cd "$(dirname "$0")" && pwd)
IOS=$(cd "$HERE/../.." && pwd)
NAME=$(xcrun simctl list devices | grep "$UDID" | sed 's/ (.*//; s/^ *//')
case "$NAME" in tw*) ;; *) echo "refusing simulator '$NAME' ($UDID): only tw* simulators of this project" >&2; exit 2 ;; esac
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
HANDSHAKE="$OUT/handshake"
rm -rf "$HANDSHAKE"
mkdir -p "$HANDSHAKE"
TCC="$HOME/Library/Developer/CoreSimulator/Devices/$UDID/data/Library/TCC/TCC.db"

python3 "$IOS/tools/places-ui/fixture_server.py" "$PORT" "$OUT/fixture-requests.json" &
SERVER_PID=$!
PUSHER_PID=
LOGPID=
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  [ -n "$PUSHER_PID" ] && kill "$PUSHER_PID" 2>/dev/null || true
  [ -n "$LOGPID" ] && kill "$LOGPID" 2>/dev/null || true
  xcrun simctl uninstall "$UDID" "$BUNDLE" 2>/dev/null || true
}
trap cleanup EXIT

xcodebuild -project "$IOS/TodayWeather.xcodeproj" -scheme TodayWeatherUITests -destination "platform=iOS Simulator,id=$UDID" \
  -derivedDataPath "$IOS/build/DerivedData" CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual CODE_SIGNING_REQUIRED=YES \
  DEVELOPMENT_TEAM= TW_SERVER_URL=http://127.0.0.1:$PORT TW_PLACES_API_KEY_IOS= TW_WEATHER_PHOTOS_URL= TW_MAIL_TO= \
  build-for-testing > "$OUT/build.log" 2>&1 || { echo "build failed (build.log)" >&2; exit 1; }
APP="$IOS/build/DerivedData/Build/Products/Debug-iphonesimulator/TodayWeather.app"
/usr/libexec/PlistBuddy -c "Print :TWServerURL" "$APP/Info.plist" | grep -q "^http://127.0.0.1:$PORT$" ||
  { echo "the build does not use the local fixture server" >&2; exit 1; }
python3 "$IOS/tools/upgrade/check_upgrade.py" dummy-plist "$APP/GoogleService-Info.plist"
codesign --force --sign - --timestamp=none --preserve-metadata=entitlements "$APP" 2>/dev/null

xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl uninstall "$UDID" "$BUNDLE" 2>/dev/null || true
# Korean, with the Korean keyboard (the test types 부산 into S02's search).
xcrun simctl spawn "$UDID" defaults write -g AppleLanguages -array ko-KR
xcrun simctl spawn "$UDID" defaults write -g AppleLocale ko_KR
xcrun simctl spawn "$UDID" defaults write -g AppleKeyboards -array "ko_KR@sw=Korean;hw=Automatic" "en_US@sw=QWERTY;hw=Automatic"
xcrun simctl shutdown "$UDID" 2>/dev/null || true
sqlite3 "$TCC" "DELETE FROM access WHERE service='kTCCServiceUserTracking' AND client='$BUNDLE';
  INSERT INTO access (service, client, client_type, auth_value, auth_reason, auth_version, flags)
  VALUES ('kTCCServiceUserTracking', '$BUNDLE', 0, 0, 2, 1, 0);"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b >/dev/null

# The notifications: the production server's FCM message (controllerPush.js `sendFcmNotification`: notification title
# and body, data cityIndex as a string) as FCM hands it to APNs.
payload() { # <file> <title> <body> <cityIndex>
  cat > "$1" <<JSON
{"Simulator Target Bundle": "$BUNDLE", "aps": {"alert": {"title": "$2", "body": "$3"}},
 "cityIndex": "$4", "gcm.message_id": "1763280000000000", "google.c.a.e": "1", "google.c.sender.id": "000000000000",
 "google.c.fid": "notification-check"}
JSON
}
payload "$OUT/foreground.json" "부산 맑음 3˚" "내일 아침 -1˚, 낮 9˚" 2
payload "$OUT/warm.json" "부산 맑음 5˚" "오늘 낮 12˚" 2
payload "$OUT/cold.json" "서울 맑음 4˚" "내일 아침 0˚, 낮 10˚" 1
(
  for STEP in foreground warm cold; do
    while [ ! -e "$HANDSHAKE/$STEP.ready" ]; do sleep 0.3; done
    sleep 1
    xcrun simctl push "$UDID" "$BUNDLE" "$OUT/$STEP.json" >> "$OUT/push.log" 2>&1
    echo "$(date -u +%H:%M:%S) pushed $STEP" >> "$OUT/push.log"
    : > "$HANDSHAKE/$STEP.pushed"
  done
) &
PUSHER_PID=$!

xcrun simctl spawn "$UDID" log stream --level info --predicate 'subsystem == "net.wizardfactory.todayweather"' \
  > "$OUT/unified.log" 2>&1 &
LOGPID=$!
STATUS=0
rm -rf "$OUT/notifications.xcresult"
TEST_RUNNER_TW_NOTIFY_DIR="$HANDSHAKE" xcodebuild -project "$IOS/TodayWeather.xcodeproj" -scheme TodayWeatherUITests \
  -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath "$IOS/build/DerivedData" \
  -resultBundlePath "$OUT/notifications.xcresult" test-without-building \
  -only-testing:TodayWeatherUITests/NotificationUITests/testPermissionForegroundMessageAndTaps > "$OUT/xcodebuild.log" 2>&1 || STATUS=$?
kill "$LOGPID" 2>/dev/null || true
LOGPID=
rm -rf "$OUT/screenshots"
mkdir -p "$OUT/screenshots"
xcrun xcresulttool export attachments --path "$OUT/notifications.xcresult" --output-path "$OUT/screenshots" > "$OUT/export.log" 2>&1 || true
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
rm -rf "$OUT/notifications.xcresult"
grep -E "Test Case|passed|failed|skipped|error:" "$OUT/xcodebuild.log" | tail -8
if ! grep -q "Test Case .*testPermissionForegroundMessageAndTaps.* passed" "$OUT/xcodebuild.log"; then
  echo "the notification UI test did not pass (or was skipped)" >&2
  [ "$STATUS" -ne 0 ] || STATUS=1
fi
python3 - "$OUT/fixture-requests.json" <<'PY'
import json, sys
try:
    requests = json.load(open(sys.argv[1]))
except OSError:
    requests = []
bad = [r for r in requests if not r["path"].startswith(("/weather/v000903/coord/", "/geocode/v000903/"))]
print(f"fixture server: {len(requests)} requests, {len(bad)} other (push requests count as other)")
if bad:
    sys.exit(f"unexpected requests: {bad[:5]}")
PY
exit "$STATUS"
