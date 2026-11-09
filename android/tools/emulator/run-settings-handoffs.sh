#!/bin/sh
# The menu's hand-offs and About on an emulator (#2891 AC2, SettingsHandoffTest): 널스쿨 풍향, 의견보내기 and 응원리뷰쓰기
# open the browser, the mail app and the store with the Cordova build's intents, and About opens in the app's
# language; on API 33+ in ko-KR and then en-US (per-app locale), else in the device's language.
#   ANDROID_SERIAL=emulator-5554 android/tools/emulator/run-settings-handoffs.sh [out-dir] [store]
# Pass `store` on an image with the Play Store to require the store to open. Requires the debug and androidTest APKs
# built with the feedback address (TW_MAIL_TO, README "Private build inputs") and without a server URL. The run is
# offline: the apps open without a network and the test app sends nothing; both packages are uninstalled on every exit
# and the network comes back only when that is confirmed (tools/emulator/offline.sh). Screenshots and the
# instrumentation output go to out-dir.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/offline.sh"
emulator_guard
OUT=${1:-/tmp/tw-settings-handoffs}
STORE=${2:-}
APP=$HERE/../../app/build/outputs/apk
mkdir -p "$OUT"
trap offline_cleanup EXIT
trap 'exit 130' INT TERM

go_offline
adb uninstall $PKG.test >/dev/null 2>&1 || true
adb uninstall $PKG >/dev/null 2>&1 || true
adb install "$APP/debug/app-debug.apk" >/dev/null
adb install "$APP/androidTest/debug/app-debug-androidTest.apk" >/dev/null
RUNNER=$PKG.test/$PKG.TestRunner
# The apps this image opens the hand-offs with (none: nothing opens).
for target in "https://earth.nullschool.net/" "-c android.intent.category.BROWSABLE mailto:feedback@example.com" "market://details?id=$PKG"; do
    data=${target##* }
    category=${target% "$data"}; [ "$category" = "$target" ] && category=""
    echo "handler of $data: $(adb shell cmd package resolve-activity --brief -a android.intent.action.VIEW $category -d "$data" | tail -1 | tr -d '\r')"
done | tee "$OUT/handlers.txt"
if [ "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" -ge 33 ]; then LANGS="ko-KR en-US"; else LANGS=device; fi
for lang in $LANGS; do
    [ "$lang" = device ] || adb shell cmd locale set-app-locales $PKG --locales "$lang"
    adb shell rm -rf "/sdcard/Android/data/$PKG/files/ac2"
    if [ -n "$STORE" ]; then
        adb shell am instrument -w -e class $PKG.SettingsHandoffTest -e store present $RUNNER | tee "$OUT/instrument-$lang.txt"
    else
        adb shell am instrument -w -e class $PKG.SettingsHandoffTest $RUNNER | tee "$OUT/instrument-$lang.txt"
    fi
    mkdir -p "$OUT/$lang"
    adb pull "/sdcard/Android/data/$PKG/files/ac2/." "$OUT/$lang/" >/dev/null
    grep -q "^OK (4 tests)" "$OUT/instrument-$lang.txt"
done
ls "$OUT"/*/*.png
