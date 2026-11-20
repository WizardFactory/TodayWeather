#!/bin/bash
# Create a dedicated simulator and collect Release evidence into a new directory.
set -euo pipefail
if [[ $# != 3 ]]; then
  echo "usage: $0 NEW_OUTPUT_DIR DEVICE_TYPE_ID RUNTIME_ID" >&2
  exit 2
fi
ios=$(cd "$(dirname "$0")/../.." && pwd)
mkdir "$1"
out=$(cd "$1" && pwd)
port=18529
python3 "$ios/tools/responsiveness/server.py" "$port" "$out/requests.jsonl" --controls "$out/controls.json" > "$out/fixture.log" 2>&1 &
server=$!
udid=
monitor=
cleanup() {
  if [[ -n "$monitor" ]]; then kill "$monitor" 2>/dev/null || true; fi
  kill "$server" 2>/dev/null || true
  if [[ -n "$udid" ]]; then xcrun simctl shutdown "$udid" || true; fi
}
trap cleanup EXIT
sleep 0.3
kill -0 "$server"
udid=$(xcrun simctl create "tw_profile_3029_$(date +%s)" "$2" "$3")
printf '%s\n' "$udid" > "$out/device"
xcrun simctl boot "$udid"
xcrun simctl bootstatus "$udid" -b > "$out/boot.log"
xcodebuild -version > "$out/xcode.txt"
git -C "$ios" rev-parse HEAD > "$out/revision.txt"
args=(-project "$ios/TodayWeather.xcodeproj" -scheme TodayWeatherUITests -configuration Release
      -destination "platform=iOS Simulator,id=$udid" -derivedDataPath "$out/DD"
      CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= COMPILER_INDEX_STORE_ENABLE=NO
      ARCHS=arm64 "TW_SERVER_URL=http://127.0.0.1:$port" TW_PLACES_API_KEY_IOS= TW_MAIL_TO=
      TW_WEATHER_PHOTOS_URL= TW_ADMOB_BANNER_IOS=)
xcodebuild "${args[@]}" build-for-testing > "$out/build.log" 2>&1
products="$out/DD/Build/Products/Release-iphonesimulator"
app="$products/TodayWeather.app"
python3 - "$app" "$port" "$out" "$2" "$3" <<'PY'
from pathlib import Path
import hashlib, json, platform, plistlib, sys
app = Path(sys.argv[1])
info = plistlib.loads((app / "Info.plist").read_bytes())
assert info["TWServerURL"] == "http://127.0.0.1:" + sys.argv[2]
assert not any(info.get(k) for k in ("TWPlacesAPIKey", "TWWeatherPhotosURL", "TWAdMobBannerUnit"))
assert not (app / "GoogleService-Info.plist").exists()
manifest = {
    "configuration": "Release",
    "device_type": sys.argv[4],
    "runtime": sys.argv[5],
    "macos": platform.mac_ver()[0],
    "version": info["CFBundleShortVersionString"],
    "build": info["CFBundleVersion"],
    "executable_sha256": hashlib.sha256((app / info["CFBundleExecutable"]).read_bytes()).hexdigest(),
}
(Path(sys.argv[3]) / "build.json").write_text(json.dumps(manifest, indent=2) + "\n")
PY
xcrun --sdk iphonesimulator swiftc -O -target arm64-apple-ios17.0-simulator \
  -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" -I "$products" \
  "$products/TWModel.o" "$products/TWDomain.o" "$ios/tools/responsiveness/TownProbe.swift" -o "$out/TownProbe"
xcrun simctl spawn "$udid" "$out/TownProbe" "$ios/Core/Sources/TWResources/Client/data/towns.json" > "$out/towns.csv"
export TEST_RUNNER_TW_PROFILE_FIXTURE=1 TEST_RUNNER_TW_PROFILE_DATA="$out"
result=0
python3 "$ios/tools/responsiveness/visits.py" "$out" &
monitor=$!
for batch in a b; do
  if [[ $batch == a ]]; then tests=(-only-testing:TodayWeatherUITests/ResponsivenessUITests)
  else tests=(-only-testing:TodayWeatherUITests/ResponsivenessUITests/testNativeRelaunch
              -only-testing:TodayWeatherUITests/ResponsivenessUITests/testHourlyScroll)
  fi
  xcodebuild test-without-building -xctestrun "$out"/DD/Build/Products/TodayWeatherUITests_*.xctestrun \
    -destination "platform=iOS Simulator,id=$udid" -parallel-testing-enabled NO "${tests[@]}" \
    -resultBundlePath "$out/$batch.xcresult" > "$out/$batch.log" 2>&1 || result=1
  xcrun xcresulttool get test-results metrics --path "$out/$batch.xcresult" > "$out/$batch-metrics.json"
done
wait "$monitor"
monitor=
python3 "$ios/tools/responsiveness/summarize.py" "$out/a.log" "$out/b.log" > "$out/summary.csv"
python3 "$ios/tools/responsiveness/idle.py" "$udid" "$out/idle.csv"
exit "$result"
