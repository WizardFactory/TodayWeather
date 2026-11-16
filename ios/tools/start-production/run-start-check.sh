#!/bin/sh
# IN-10 (#2959) completion criterion 2 on the owned simulator against production (read-only GETs to the legacy server
# and the Places SDK with the private key): on a fresh install the app reaches S03 for the simulated position
# (`granted`), and with location denied, for a searched place (`denied`).
#   run-start-check.sh <granted|denied> <out-dir>
#
# Prerequisite: the app and its tests built with the private inputs of ios/Private.xcconfig (TW_SERVER_URL,
# TW_PLACES_API_KEY_IOS) into ios/build/DerivedData:
#   xcodebuild -project TodayWeather.xcodeproj -scheme TodayWeather -destination 'platform=iOS Simulator,id=<udid>' \
#     -derivedDataPath build/DerivedData CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual CODE_SIGNING_REQUIRED=YES \
#     DEVELOPMENT_TEAM= build-for-testing
# (ad hoc signed: the app needs its App Group entitlement to finish its start; an unsigned build stays on the launch
# screen).
# Each run uninstalls the app, sets the simulator's position to Seoul City Hall, installs the app (a fresh install),
# grants or revokes its location permission (the system prompt is not driven; S01's prompt path is covered by the
# app-hosted and package tests), and runs ProductionStartTests in that mode. The app's unified log (routes only; the
# places and URLs are private) and the test's own records are copied to <out-dir>; the server host and the Places key
# are replaced by placeholders in every saved log. The app is uninstalled at the end.
set -eu
MODE=$1
OUT=$2
UDID=5A3446F8-E79B-4728-94B8-EDE3BD83AE3B   # twios_in10_dev (owned by IN-10)
BUNDLE=net.wizardfactory.todayweather
case "$MODE" in granted|denied) ;; *) echo "mode: granted or denied" >&2; exit 2 ;; esac
HERE=$(cd "$(dirname "$0")" && pwd)
IOS=$(cd "$HERE/../.." && pwd)
NAME=$(xcrun simctl list devices | grep "$UDID" | sed 's/ (.*//; s/^ *//')
[ "$NAME" = "twios_in10_dev" ] || { echo "simulator $UDID is not twios_in10_dev" >&2; exit 2; }
APP="$IOS/build/DerivedData/Build/Products/Debug-iphonesimulator/TodayWeather.app"
[ -d "$APP" ] || { echo "build first: $APP" >&2; exit 2; }
HOST=$(sed -n 's/^TW_SERVER_URL *= *//p' "$IOS/Private.xcconfig" | sed 's#https:/$()/##; s#http:/$()/##; s#/.*##')
KEY=$(sed -n 's/^TW_PLACES_API_KEY_IOS *= *//p' "$IOS/Private.xcconfig")
[ -n "$HOST" ] && [ -n "$KEY" ] || { echo "ios/Private.xcconfig needs TW_SERVER_URL and TW_PLACES_API_KEY_IOS" >&2; exit 2; }
redact() { sed -e "s#$HOST#<server>#g" -e "s#$KEY#<places-key>#g"; }
mkdir -p "$OUT"

xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl uninstall "$UDID" "$BUNDLE" 2>/dev/null || true
xcrun simctl location "$UDID" set 37.5665,126.9780
xcrun simctl install "$UDID" "$APP"
if [ "$MODE" = granted ]; then xcrun simctl privacy "$UDID" grant location "$BUNDLE"; else xcrun simctl privacy "$UDID" revoke location "$BUNDLE"; fi

xcrun simctl spawn "$UDID" log stream --level info --predicate 'subsystem == "net.wizardfactory.todayweather"' \
  > "$OUT/$MODE-unified.raw.log" 2>&1 &
LOGPID=$!
STATUS=0
TEST_RUNNER_TW_PRODUCTION_START=$MODE xcodebuild -project "$IOS/TodayWeather.xcodeproj" -scheme TodayWeather \
  -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath "$IOS/build/DerivedData" \
  test-without-building -only-testing:TodayWeatherTests/ProductionStartTests > "$OUT/$MODE-xcodebuild.raw.log" 2>&1 || STATUS=$?
redact < "$OUT/$MODE-xcodebuild.raw.log" > "$OUT/$MODE-xcodebuild.log"
rm -f "$OUT/$MODE-xcodebuild.raw.log"
kill "$LOGPID" 2>/dev/null || true
redact < "$OUT/$MODE-unified.raw.log" > "$OUT/$MODE-unified.log"
rm -f "$OUT/$MODE-unified.raw.log"
DATA=$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data 2>/dev/null || true)
[ -n "$DATA" ] && [ -d "$DATA/tmp/start-production" ] && cp "$DATA/tmp/start-production/"* "$OUT/" || true
xcrun simctl uninstall "$UDID" "$BUNDLE" 2>/dev/null || true
xcrun simctl location "$UDID" clear || true
grep -E "Test run with|✘|✔ Test" "$OUT/$MODE-xcodebuild.log" | tail -5
# The other mode's test is skipped; this mode's must have run and passed (a build without the private inputs skips both).
if ! grep -q "✔ Test .*passed" "$OUT/$MODE-xcodebuild.log"; then
  echo "the $MODE production test did not pass (or was skipped)" >&2
  [ "$STATUS" -ne 0 ] || STATUS=1
fi
exit "$STATUS"
