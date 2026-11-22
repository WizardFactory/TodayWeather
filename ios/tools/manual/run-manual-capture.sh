#!/bin/sh
# IN-18 part 3 (#2967): the screenshots of the native user manual (docs/user/ios-app) from the running app.
#   run-manual-capture.sh [--no-ads [--store]] <out-dir> <tw* iPhone or iPad simulator udid>
# --no-ads (#3122): the app is built with empty TW_ADMOB_NATIVE_IOS and TW_ADMOB_INTERSTITIAL_IOS, so AdsSettings is nil:
# no UMP, no Ads SDK start and no ad request; the test then fails any screenshot with a native ad. No app code changes.
# --store (with --no-ads): testCaptureTheStoreScreens instead, the four App Store screens (store-0N-*) with Seoul saved.
# Builds the app and the UI tests ad hoc signed (the app needs its App Group entitlement to finish its start) into
# ios/build/DerivedData with ios/Private.xcconfig (TW_SERVER_URL, TW_PLACES_API_KEY_IOS): read-only weather, geocode,
# nationwide and warning GETs to the legacy server and Places predictions from Google. No GoogleService-Info.plist is
# in the build, so no FCM token exists and no push request or Firebase call can be made; the journey discards its
# alarm edits. The run touches only the app: it uninstalls it, sets the simulator's position to Seoul City Hall,
# installs the app and grants it location while in use, writes the answer "Ask App Not to Track" to the TCC database
# (no UMP explainer over the page), runs ManualUITests with TEST_RUNNER_TW_MANUAL_UI=1 (the app in Korean) and exports
# the named screenshots to <out-dir>/raw. The server host and the Places key are parsed with Python and replaced by
# placeholders in every saved log, which are then scanned for them. The app is uninstalled at the end.
set -eu
ADS=on
if [ "${1:-}" = --no-ads ]; then ADS=off; shift; fi
STORE=0
if [ "${1:-}" = --store ]; then STORE=1; shift; fi
if [ "$STORE" = 1 ] && [ "$ADS" != off ]; then echo "--store needs --no-ads" >&2; exit 2; fi
OUT=$1
UDID=$2
BUNDLE=net.wizardfactory.todayweather
TEST=testCaptureTheManual
[ "$STORE" = 0 ] || TEST=testCaptureTheStoreScreens
HERE=$(cd "$(dirname "$0")" && pwd)
IOS=$(cd "$HERE/../.." && pwd)
NAME=$(xcrun simctl list devices | grep "$UDID" | sed 's/ (.*//; s/^ *//')
case "$NAME" in tw*) ;; *) echo "refusing simulator '$NAME' ($UDID): only tw* simulators of this project" >&2; exit 2 ;; esac
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
PRIVATE="$IOS/Private.xcconfig"
[ -f "$PRIVATE" ] || { echo "ios/Private.xcconfig is needed (TW_SERVER_URL, TW_PLACES_API_KEY_IOS)" >&2; exit 2; }
# The private values, parsed with Python (never printed): the server's host and the Places key.
eval "$(python3 - "$PRIVATE" <<'PY'
import shlex, sys
from urllib.parse import urlsplit
values = {}
for line in open(sys.argv[1], encoding="utf-8"):
    if "=" in line and not line.lstrip().startswith("//"):
        k, v = line.split("=", 1)
        values[k.strip()] = v.strip()
server = values.get("TW_SERVER_URL", "").replace("$()", "")
host = urlsplit(server).hostname or ""
key = values.get("TW_PLACES_API_KEY_IOS", "")
if not host or not key:
    sys.exit("ios/Private.xcconfig needs TW_SERVER_URL and TW_PLACES_API_KEY_IOS")
print(f"HOST={shlex.quote(host)}; KEY={shlex.quote(key)}")
PY
)"
redact() { python3 -c 'import sys
host, key = sys.argv[1], sys.argv[2]
sys.stdout.write(sys.stdin.read().replace(host, "<server>").replace(key, "<places-key>"))' "$HOST" "$KEY"; }
TCC="$HOME/Library/Developer/CoreSimulator/Devices/$UDID/data/Library/TCC/TCC.db"
cleanup() { xcrun simctl uninstall "$UDID" "$BUNDLE" 2>/dev/null || true; }
trap cleanup EXIT

NO_ADS=
[ "$ADS" = on ] || NO_ADS="TW_ADMOB_NATIVE_IOS= TW_ADMOB_INTERSTITIAL_IOS="
# shellcheck disable=SC2086 # NO_ADS is two build settings or nothing.
xcodebuild -project "$IOS/TodayWeather.xcodeproj" -scheme TodayWeatherUITests -destination "platform=iOS Simulator,id=$UDID" \
  -derivedDataPath "$IOS/build/DerivedData" CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual CODE_SIGNING_REQUIRED=YES \
  DEVELOPMENT_TEAM= COMPILER_INDEX_STORE_ENABLE=NO TW_WEATHER_PHOTOS_URL= TW_MAIL_TO= $NO_ADS build-for-testing \
  > "$OUT/build.raw.log" 2>&1 || { redact < "$OUT/build.raw.log" > "$OUT/build.log"; rm -f "$OUT/build.raw.log"; echo "build failed" >&2; exit 1; }
redact < "$OUT/build.raw.log" > "$OUT/build.log"
rm -f "$OUT/build.raw.log"
APP="$IOS/build/DerivedData/Build/Products/Debug-iphonesimulator/TodayWeather.app"
[ ! -e "$APP/GoogleService-Info.plist" ] || { echo "the build holds a Firebase configuration: no push may be possible here" >&2; exit 1; }
# The ad settings the build carries, each key present: --no-ads keeps the app ID with both units empty; otherwise
# Google's test app ID and test units (the Debug values of Support/App.xcconfig).
python3 - "$APP/Info.plist" "$ADS" <<'PY' || exit 1
import plistlib, sys
info, ads = plistlib.load(open(sys.argv[1], "rb")), sys.argv[2]
keys = ("GADApplicationIdentifier", "TWAdMobNativeUnit", "TWAdMobInterstitialUnit")
missing = [k for k in keys if not isinstance(info.get(k), str)]
if missing:
    sys.exit(f"the built Info.plist lacks {missing}")
app, native, interstitial = (info[k] for k in keys)
if app != "ca-app-pub-3940256099942544~1458002511":
    sys.exit("the built app does not carry Google's test app ID (the Debug value)")
if ads == "off":
    if native or interstitial:
        sys.exit("--no-ads: the built app still has ad units")
elif (native, interstitial) != ("ca-app-pub-3940256099942544/3986624511", "ca-app-pub-3940256099942544/4411468910"):
    sys.exit("the built app does not carry Google's test ad units: build again without --no-ads")
PY
echo "ads: $ADS" > "$OUT/ads.txt"

xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl uninstall "$UDID" "$BUNDLE" 2>/dev/null || true
xcrun simctl shutdown "$UDID" 2>/dev/null || true
sqlite3 "$TCC" "DELETE FROM access WHERE service='kTCCServiceUserTracking' AND client='$BUNDLE';
  INSERT INTO access (service, client, client_type, auth_value, auth_reason, auth_version, flags)
  VALUES ('kTCCServiceUserTracking', '$BUNDLE', 0, 0, 2, 1, 0);"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl location "$UDID" set 37.5662952,126.9779451
xcrun simctl status_bar "$UDID" override --time "9:41" --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3
# The app installed first and location granted while in use; xcodebuild installs it again over it (data and grants kept).
xcrun simctl install "$UDID" "$APP"
xcrun simctl privacy "$UDID" grant location "$BUNDLE"

STATUS=0
rm -rf "$OUT/manual.xcresult"
TEST_RUNNER_TW_MANUAL_UI=1 TEST_RUNNER_TW_MANUAL_ADS=$ADS TEST_RUNNER_TW_STORE_UI=$STORE xcodebuild -project "$IOS/TodayWeather.xcodeproj" -scheme TodayWeatherUITests \
  -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath "$IOS/build/DerivedData" -resultBundlePath "$OUT/manual.xcresult" \
  test-without-building -only-testing:"TodayWeatherUITests/ManualUITests/$TEST" > "$OUT/xcodebuild.raw.log" 2>&1 || STATUS=$?
redact < "$OUT/xcodebuild.raw.log" > "$OUT/xcodebuild.log"
rm -f "$OUT/xcodebuild.raw.log"
xcrun simctl status_bar "$UDID" clear || true
rm -rf "$OUT/raw"
mkdir -p "$OUT/raw"
# The screenshots must all come out (CODEX-IN18P3-1, -4): a failed export, a missing manifest or a set other than the
# test's own shot("NN-name") names fails the run. The test's names are not the published ones (publishing renumbers
# them: the test has no 25 and the shoot-only 27, 28, 32), so the set comes from ManualUITests.swift, not manual.json.
xcrun xcresulttool export attachments --path "$OUT/manual.xcresult" --output-path "$OUT/raw" > "$OUT/export.log" 2>&1 || {
  echo "exporting the screenshots failed (export.log)" >&2; [ "$STATUS" -ne 0 ] || STATUS=1; }
python3 - "$OUT/raw" "$IOS/TodayWeatherUITests/ManualUITests.swift" "$STORE" <<'PY' || { [ "$STATUS" -ne 0 ] || STATUS=1; }
import json, os, re, sys
d, test_source, store = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
# The manual's shots are NN-name, the store's store-NN-name (testCaptureTheStoreScreens).
pattern = r'shot\("(store-\d\d-[^"]+)"\)' if store else r'shot\("(\d\d-[^"]+)"\)'
ours = (lambda n: n.startswith("store-")) if store else (lambda n: n[:2].isdigit())
try:
    manifest = json.load(open(os.path.join(d, "manifest.json")))
except OSError:
    sys.exit("no attachment manifest in the export")
keep = set()
for test in manifest:
    for a in test.get("attachments", []):
        name, file = a.get("suggestedHumanReadableName", ""), a.get("exportedFileName", "")
        if file.endswith(".png") and ours(name):
            target = name.split("_")[0] + ".png"
            os.replace(os.path.join(d, file), os.path.join(d, target))
            keep.add(target)
for f in os.listdir(d):
    if f not in keep:
        os.remove(os.path.join(d, f))
expected = {name + ".png" for name in re.findall(pattern, open(test_source).read())}
if not expected or keep != expected:
    sys.exit(f"screenshots missing: {sorted(expected - keep)}; unexpected: {sorted(keep - expected)}")
PY
rm -rf "$OUT/manual.xcresult"   # its logs are not redacted; the redacted log and the screenshots are kept
# No saved log may hold the private values.
for f in "$OUT"/*.log; do
  python3 -c 'import sys
text = open(sys.argv[1], encoding="utf-8", errors="replace").read()
sys.exit(1 if sys.argv[2] in text or sys.argv[3] in text else 0)' "$f" "$HOST" "$KEY" || { echo "a private value in $f" >&2; exit 1; }
done
grep -E "Test Case|passed|failed|skipped|error:" "$OUT/xcodebuild.log" | tail -8
ls "$OUT/raw" | wc -l
if ! grep -q "Test Case .*$TEST.* passed" "$OUT/xcodebuild.log"; then
  echo "the manual capture did not pass (or was skipped)" >&2
  [ "$STATUS" -ne 0 ] || STATUS=1
fi
exit "$STATUS"
