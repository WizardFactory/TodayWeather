#!/bin/sh
# Builds the Cordova 1.1.1 iOS Simulator app that the upgrade test installs before the native app.
#   build-cordova.sh <out-dir> <recorder-url>      e.g. build-cordova.sh ios/build/upgrade http://127.0.0.1:18452
#
# The build takes client/ from Git (HEAD) into a temporary directory outside the repository, so no file in
# client/ changes. It is a test build, not the store build:
# - serverUrl is the local recorder (client/.env TW_SERVER_URL), so the app's requests never reach the
#   legacy server;
# - GoogleService-Info.plist is a generated dummy of a project that does not exist, so Firebase cannot write
#   to the production project;
# Google's test ad units are used (make-client-config.mjs without --release). The temporary directory is
# deleted at the end; only <out-dir>/TodayWeather.app and <out-dir>/build-cordova.json remain.
# run-upgrade-test.sh injects the seed script into a copy of that app.
set -eu
OUT=$1
RECORDER=$2
case "$RECORDER" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "recorder must be a loopback URL" >&2; exit 2 ;; esac
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(git -C "$HERE" rev-parse --show-toplevel)
COMMIT=$(git -C "$REPO" rev-parse HEAD)
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
WORK=$(mktemp -d /tmp/tw-in03-cordova.XXXXXX)
trap 'rm -rf "$WORK"' EXIT
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}

git -C "$REPO" archive "$COMMIT" client | tar -x -C "$WORK"
cd "$WORK/client"
printf 'TW_SERVER_URL=%s\n' "$RECORDER" > .env
# A Firebase configuration of a project that does not exist (check_upgrade.py dummy-plist).
python3 "$HERE/check_upgrade.py" dummy-plist GoogleService-Info.plist

npm ci --no-audit --no-fund
npx bower install --allow-root --config.interactive=false
npm run www:css
npm run www:config
npx cordova platform add ios --nosave
# Xcode 27 refuses the iOS 12.0 deployment target of the AdMob/UMP pods; 15.0 is the app's own target.
npx cordova build ios --emulator --buildFlag="IPHONEOS_DEPLOYMENT_TARGET=15.0"

APP=platforms/ios/build/Debug-iphonesimulator/TodayWeather.app
test -d "$APP"
rm -rf "$OUT/TodayWeather.app"
cp -R "$APP" "$OUT/TodayWeather.app"
grep -q "$RECORDER" "$OUT/TodayWeather.app/www/client.config.js"
cat > "$OUT/build-cordova.json" <<EOF
{"commit": "$COMMIT", "client_version": "$(node -p "require('./package.json').version")",
 "xcode": "$(xcodebuild -version | head -1)", "node": "$(node --version)", "recorder": "$RECORDER",
 "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
EOF
echo "built $OUT/TodayWeather.app"
