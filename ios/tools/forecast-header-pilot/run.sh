#!/bin/bash
set -euo pipefail

destination=$1
output=$2
tools=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$output"

status=0
xcodebuild -project TodayWeather.xcodeproj -scheme TodayWeather -destination "$destination" \
  -derivedDataPath "$output/DerivedData" -resultBundlePath "$output/selected.xcresult" \
  CODE_SIGNING_ALLOWED=NO -parallel-testing-enabled NO \
  -only-testing:TodayWeatherTests/WeatherScreenshotTests \
  '-only-testing:TodayWeatherTests/MatrixScreenshotTests/weatherPages(size:language:)' \
  '-only-testing:TodayWeatherTests/WeatherTabTests/rankedSummaryUsesTheWeatherRequestAndKeepsAirAccessible()' \
  '-only-testing:TWDomainTests/ForecastScopeTests/rankedSummaryExpiresAtSeoulMidnight()' \
  '-only-testing:TWDataTests/ClockedDataTests/WeatherRequestTests/datedSummaryKeepsItsRequestWhenReopeningOffline()' \
  test > "$output/xcodebuild.log" 2>&1 || status=$?
tail -n 50 "$output/xcodebuild.log"
if [[ -d "$output/selected.xcresult" ]]; then
  xcrun xcresulttool get test-results tests --path "$output/selected.xcresult" > "$output/test-results.json"
fi
if [[ "$status" != 0 ]]; then exit "$status"; fi
python3 "$tools/inventory.py" "$tools/expected.json" "$output/test-results.json" > "$output/inventory.json"
