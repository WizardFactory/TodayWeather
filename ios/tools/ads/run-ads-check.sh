#!/bin/sh
# The simulator check of IN-15 (#2964 AC2 and the consent order of AC3): a debug build waits for UMP's IDFA explainer,
# then requests a Google native test ad on Saved Places; no analytics event is logged before an opt-in, and screen_view after it, so the
# first check cannot pass vacuously.
#   run-ads-check.sh <tw* simulator udid> <Debug-iphonesimulator TodayWeather.app> <out-dir>
#
# - Refuses simulators not named tw*; uninstalls and installs the app there and shuts the simulator down between
#   launches (it never erases or deletes it).
# - A copy of the app gets a GoogleService-Info.plist of a Firebase project that does not exist (the IN-03 recipe,
#   ios/tools/upgrade/check_upgrade.py dummy-plist), so nothing can reach the production Firebase project. The
#   debug build carries Google's test AdMob app ID and format-specific demo units, whose UMP setup shows Google's IDFA explainer;
#   no TodayWeather server is configured.
# - Unsigned builds have no App Group container, so the migrated state is injected (state.json: the place 회현동,
#   S01 closed); the shell opens on Saved Places and the ads start.
# - Launch 1: ATT not determined. UMP's explainer stays open (nobody answers it), so neither ad format may be requested.
# - Launch 2: the ATT answer "Ask App Not to Track" is written to the simulator's TCC database (simctl has no tracking
#   service), as after the user's answer; no explainer, ads ready, a non-personalized request and an SDK outcome.
# - Launch 3: ATT allowed and a stored analytics grant (both consent files, as the app writes them on 동의).
# - Every launch passes -FIRAnalyticsDebugEnabled and has the SDK's persisted debug mode on. The SDK writes its debug log
#   to the unified log, which each launch streams (<name>.oslog) beside the console (<name>.log); check_ads.py reads
#   both and the SDK's measurement database
#   (as check_upgrade.py does) and writes summary.json; a screenshot ends each launch.
set -eu
UDID=$1
APP=$2
OUT=$3
HERE=$(cd "$(dirname "$0")" && pwd)
# This harness launches the app with dummy Firebase and no production TodayWeather server or ad traffic.
python3 - "$APP/Info.plist" <<'PY'
import plistlib
import sys
with open(sys.argv[1], "rb") as source:
    info = plistlib.load(source)
expected = {
    "CFBundleIdentifier": "net.wizardfactory.todayweather",
    "GADApplicationIdentifier": "ca-app-pub-3940256099942544~1458002511",
    "TWAdMobNativeUnit": "ca-app-pub-3940256099942544/3986624511",
    "TWAdMobInterstitialUnit": "ca-app-pub-3940256099942544/4411468910",
}
if any(info.get(key) != value for key, value in expected.items()) or info.get("TWServerURL"):
    sys.exit("Expected a TodayWeather simulator build with iOS demo units and no TodayWeather server URL")
PY
BUNDLE=net.wizardfactory.todayweather
NAME=$(xcrun simctl list devices | sed -n "s/^ *\(.*\) ($UDID) .*/\1/p")
case "$NAME" in
  tw*) ;;
  *) echo "refusing simulator '$NAME' ($UDID): only tw* simulators of this project" >&2; exit 2 ;;
esac
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
TCC="$HOME/Library/Developer/CoreSimulator/Devices/$UDID/data/Library/TCC/TCC.db"
log() { echo "[$(date -u +%H:%M:%S)] $*"; }

rm -rf "$OUT/TodayWeather.app" "$OUT"/*.log "$OUT"/*.oslog "$OUT"/*.png "$OUT"/*.sql* "$OUT"/*.measurement-absent
cp -R "$APP" "$OUT/TodayWeather.app"
python3 "$HERE/../upgrade/check_upgrade.py" dummy-plist "$OUT/TodayWeather.app/GoogleService-Info.plist"

boot() {
  xcrun simctl boot "$UDID" 2>/dev/null || true
  xcrun simctl bootstatus "$UDID" -b > /dev/null
}
shutdown() { xcrun simctl shutdown "$UDID" 2>/dev/null || true; }

# Analytics debug mode as -FIRAnalyticsDebugEnabled persists it (the SDK did not take the argument on these
# launches, as IN-03 also saw), written while the simulator is shut down.
debugmode() {
  PREFS="$DATA/Library/Preferences/$BUNDLE.plist"
  [ -f "$PREFS" ] || plutil -create xml1 "$PREFS"
  plutil -replace /google/measurement/debug_mode -bool YES "$PREFS"
}

# tracking <auth_value>: 0 denied, 2 allowed (kTCCServiceUserTracking for the app), with the simulator shut down.
tracking() {
  shutdown
  debugmode
  sqlite3 "$TCC" "DELETE FROM access WHERE service='kTCCServiceUserTracking' AND client='$BUNDLE';
    INSERT INTO access (service, client, client_type, auth_value, auth_reason, auth_version, flags)
    VALUES ('kTCCServiceUserTracking', '$BUNDLE', 0, $1, 2, 1, 0);"
  boot
}

launch() {
  # simctl bootstatus can finish before Launch Services has restored this app's record after a restart.
  # Re-register the identical build if needed, then verify that all three launches use the seeded container.
  if ! xcrun simctl get_app_container "$UDID" "$BUNDLE" app >/dev/null 2>&1; then
    xcrun simctl install "$UDID" "$OUT/TodayWeather.app"
  fi
  DATA=$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data)
  STATE="$DATA/Library/Application Support/TodayWeather"
  if [ "$(cat "$STATE/.ads-smoke-session" 2>/dev/null)" != "$SESSION" ]; then
    echo "The seeded simulator app state is unavailable before $1" >&2
    exit 1
  fi
  log "launch $1 for $2 s"
  # The Firebase SDK logs to the unified log, not to the console: stream the app's messages (debug level) beside it.
  xcrun simctl spawn "$UDID" log stream --level debug --style compact --predicate 'process == "TodayWeather"' \
    > "$OUT/$1.oslog" 2>&1 &
  STREAM=$!
  # Launch only once the stream is attached (it prints its header first), so the SDK's first lines are in it.
  for _ in $(seq 1 120); do grep -Eq "^(Timestamp|Filtering the log data)" "$OUT/$1.oslog" 2>/dev/null && break; sleep 0.5; done
  sleep 3
  SIMCTL_CHILD_OS_ACTIVITY_DT_MODE=YES xcrun simctl launch --console-pty --terminate-running-process "$UDID" $BUNDLE \
    -FIRAnalyticsDebugEnabled -FIRAnalyticsVerboseLoggingEnabled > "$OUT/$1.log" 2>&1 &
  CONSOLE=$!
  sleep "$2"
  if grep -q "Simulator device failed to launch" "$OUT/$1.log"; then
    kill "$STREAM" 2>/dev/null || true
    wait "$STREAM" 2>/dev/null || true
    echo "The simulator failed to launch the app for $1" >&2
    exit 1
  fi
  xcrun simctl io "$UDID" screenshot "$OUT/$1.png" > /dev/null 2>&1 || true
  xcrun simctl terminate "$UDID" $BUNDLE 2>/dev/null || true
  wait $CONSOLE 2>/dev/null || true
  sleep 2
  kill $STREAM 2>/dev/null || true
  wait $STREAM 2>/dev/null || true
  MEASUREMENT="$DATA/Library/Application Support/Google/Measurement/google-app-measurement.sql"
  MEASUREMENT_DIR=$(dirname "$MEASUREMENT")
  if [ -f "$MEASUREMENT" ]; then
    cp "$MEASUREMENT" "$OUT/$1.sql"
    if [ -f "$MEASUREMENT-wal" ]; then cp "$MEASUREMENT-wal" "$OUT/$1.sql-wal"; fi
  elif [ -d "$MEASUREMENT_DIR" ] && [ -r "$MEASUREMENT_DIR" ]; then
    # The SDK may defer creation until analytics is opted in.
    date -u +"No measurement database in app directory after launch at %FT%TZ" > "$OUT/$1.measurement-absent"
  fi
}

boot
xcrun simctl uninstall "$UDID" $BUNDLE 2>/dev/null || true
log "install on $NAME"
xcrun simctl install "$UDID" "$OUT/TodayWeather.app"
DATA=$(xcrun simctl get_app_container "$UDID" $BUNDLE data)
STATE="$DATA/Library/Application Support/TodayWeather"
mkdir -p "$STATE"
SESSION=$(uuidgen)
printf '%s' "$SESSION" > "$STATE/.ads-smoke-session"
# Keep the ad anchor below the fold during consent. These synthetic saved places need no weather requests.
python3 - "$HERE/state.json" "$STATE/app_state.json" <<'PY'
import json
import sys
from pathlib import Path

state = json.loads(Path(sys.argv[1]).read_text())
place = state["places"][-1]
state["places"].extend(dict(place, name=f"Test Place {n}") for n in range(2, 17))
Path(sys.argv[2]).write_text(json.dumps(state))
PY
shutdown
debugmode
# Repeating the smoke starts with this app's ATT state undetermined on the dedicated simulator.
sqlite3 "$TCC" "DELETE FROM access WHERE service='kTCCServiceUserTracking' AND client='$BUNDLE';"
boot

launch 1-explainer 45
log "ATT answer: Ask App Not to Track"
tracking 0
launch 2-denied 60
log "ATT answer: Allow; store an analytics grant"
printf true > "$STATE/analytics-choice"
printf true > "$STATE/analytics-collection"
tracking 2
launch 3-allowed-opted-in 60
xcrun simctl uninstall "$UDID" $BUNDLE
shutdown
log "uninstalled and shut down; checking"
python3 "$HERE/check_ads.py" "$OUT"
