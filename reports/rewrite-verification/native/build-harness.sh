#!/bin/sh
# Builds harness-injected test artifacts from the current client/www without touching client/www.
#   build-harness.sh android [mode]  -> /tmp/tw-harness/app-debug.apk
#   build-harness.sh ios [mode]      -> /tmp/tw-harness/TodayWeather.app (copy of the simulator build)
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
CLIENT=$(cd "$HERE/../../../client" && pwd)
OUT=/tmp/tw-harness
mkdir -p "$OUT"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer

MODE=${2:-full}   # full | layout | layout-live | world | upgrade | capture-air | capture-charts
inject() { # $1 = www dir
    cp "$HERE/tw-harness.js" "$1/tw-harness.js"
    perl -0pi -e "s#<head>#<head>\n    <script>window.TW_HARNESS_MODE = '$MODE';</script>\n    <script src=\"tw-harness.js\"></script>#" "$1/index.html"
    grep -q 'tw-harness.js' "$1/index.html"
}

cd "$CLIENT"
case "$1" in
android)
    npx cordova prepare android
    inject platforms/android/app/src/main/assets/www
    npx cordova compile android --debug
    cp platforms/android/app/build/outputs/apk/debug/app-debug.apk "$OUT/app-debug.apk"
    npx cordova prepare android   # restore the platform www without the harness
    ;;
ios)
    npx cordova build ios --emulator
    rm -rf "$OUT/TodayWeather.app"
    cp -R platforms/ios/build/Debug-iphonesimulator/TodayWeather.app "$OUT/TodayWeather.app"
    inject "$OUT/TodayWeather.app/www"
    codesign --force --sign - --timestamp=none "$OUT/TodayWeather.app" 2>&1 | tail -1
    ;;
esac
ls -la "$OUT"
