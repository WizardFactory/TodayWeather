#!/bin/sh
# The simulator check of IN-15 (#2964 AC2 and the consent order of AC3): a debug build waits for UMP's IDFA explainer,
# then loads Google's test banner; no analytics event is logged before an opt-in, and screen_view after it, so the
# first check cannot pass vacuously.
#   run-ads-check.sh <tw* simulator udid> <Debug-iphonesimulator TodayWeather.app> <out-dir>
#
# - Refuses simulators not named tw*; uninstalls and installs the app there and shuts the simulator down between
#   launches (it never erases or deletes it).
# - A copy of the app gets a GoogleService-Info.plist of a Firebase project that does not exist (the IN-03 recipe,
#   ios/tools/upgrade/check_upgrade.py dummy-plist), so nothing can reach the production Firebase project. The
#   debug build carries Google's test AdMob app ID and banner unit, whose UMP setup shows Google's IDFA explainer;
#   no TodayWeather server is configured.
# - Unsigned builds have no App Group container, so the migrated state is injected (state.json: the place 회현동,
#   S01 closed); the shell opens on the Hourly tab and the ads start.
# - Launch 1: ATT not determined. UMP's explainer stays open (nobody answers it), so no banner may be requested.
# - Launch 2: the ATT answer "Ask App Not to Track" is written to the simulator's TCC database (simctl has no tracking
#   service), as after the user's answer; no explainer, ads ready, npa requests, a test banner.
# - Launch 3: ATT allowed and a stored analytics grant (both consent files, as the app writes them on 동의).
# - Every launch passes -FIRAnalyticsDebugEnabled and has the SDK's persisted debug mode on; check_ads.py reads the consoles and the SDK's measurement database
#   (as check_upgrade.py does) and writes summary.json; a screenshot ends each launch.
set -eu
UDID=$1
APP=$2
OUT=$3
HERE=$(cd "$(dirname "$0")" && pwd)
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

rm -rf "$OUT/TodayWeather.app" "$OUT"/*.log "$OUT"/*.png "$OUT"/*.sql*
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
  log "launch $1 for $2 s"
  SIMCTL_CHILD_OS_ACTIVITY_DT_MODE=YES xcrun simctl launch --console-pty --terminate-running-process "$UDID" $BUNDLE \
    -FIRAnalyticsDebugEnabled -FIRAnalyticsVerboseLoggingEnabled > "$OUT/$1.log" 2>&1 &
  CONSOLE=$!
  sleep "$2"
  xcrun simctl io "$UDID" screenshot "$OUT/$1.png" > /dev/null 2>&1 || true
  xcrun simctl terminate "$UDID" $BUNDLE 2>/dev/null || true
  wait $CONSOLE 2>/dev/null || true
  MEASUREMENT="$DATA/Library/Application Support/Google/Measurement/google-app-measurement.sql"
  for suffix in "" -wal; do
    if [ -f "$MEASUREMENT$suffix" ]; then cp "$MEASUREMENT$suffix" "$OUT/$1.sql$suffix"; fi
  done
}

boot
xcrun simctl uninstall "$UDID" $BUNDLE 2>/dev/null || true
log "install on $NAME"
xcrun simctl install "$UDID" "$OUT/TodayWeather.app"
DATA=$(xcrun simctl get_app_container "$UDID" $BUNDLE data)
STATE="$DATA/Library/Application Support/TodayWeather"
mkdir -p "$STATE"
cp "$HERE/state.json" "$STATE/app_state.json"
shutdown
debugmode
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
