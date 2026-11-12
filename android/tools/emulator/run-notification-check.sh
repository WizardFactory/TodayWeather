#!/bin/sh
# AN-14 (#2893): notifications on an emulator, offline, with FCM messages delivered by a root broadcast to FCM's own
# receiver (Google APIs images allow `adb root`; nothing reaches a server):
#  1. the Cordova build, seeded (명동 and London with alarms) and past its start page, gets a message for cityIndex 2 in
#     the background, which its FCM SDK posts on fcm_default_channel;
#  2. the native build is installed over it, and the script records whether that notification is still posted;
#  3. native, in the background: a message for cityIndex 1 is posted on fcm_default_channel, and a tap (warm start)
#     selects 명동;
#  4. native, process ended (`am kill`) after a message for cityIndex 2 was posted: a tap (cold start) selects London;
#  5. native in the foreground: a message shows O07 and posts nothing.
# Channels exist from API 26 and the notification permission from API 33; below them those checks do not apply.
#   ANDROID_SERIAL=emulator-5554 android/tools/emulator/run-notification-check.sh <cordova-debug.apk> [out-dir]
# Requires the native debug APK (./gradlew assembleDebug, with app/google-services.json) signed like the Cordova APK.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/offline.sh"
emulator_guard
CORDOVA_APK=$1
OUT=${2:-/tmp/tw-notifications}
APK=$HERE/../../app/build/outputs/apk/debug/app-debug.apk
mkdir -p "$OUT"
trap offline_cleanup EXIT
trap 'exit 130' INT TERM

adb root >/dev/null; sleep 3; adb wait-for-device
go_offline
adb uninstall $PKG.test >/dev/null 2>&1 || true
adb uninstall $PKG >/dev/null 2>&1 || true

SDK=$(adb shell getprop ro.build.version.sdk | tr -d '\r')

# A message as FCM delivers it: the notification's title and body, the data's cityIndex, a message id.
deliver() {
    adb shell am broadcast -n $PKG/com.google.firebase.iid.FirebaseInstanceIdReceiver -a com.google.android.c2dm.intent.RECEIVE \
        --es gcm.n.e 1 --es gcm.notification.title "'$1'" --es gcm.notification.body "'$2'" --es cityIndex "$3" \
        --es google.message_id "$4" --es from 1234567890 >/dev/null
    sleep 3
}
# The app's notifications: tag, channel and title of each.
posted() { adb shell dumpsys notification --noredact | grep -A3 "pkg=$PKG" | grep -E "NotificationRecord|android.title" || true; }
# Taps the notification titled $1 in the shade.
tap() {
    adb shell cmd statusbar expand-notifications; sleep 2
    adb shell uiautomator dump /sdcard/tw-ui.xml >/dev/null 2>&1
    POINT=$(adb exec-out cat /sdcard/tw-ui.xml | python3 -c '
import re, sys
title = sys.argv[1]
for m in re.finditer(r"<node [^>]*>", sys.stdin.read()):
    n = m.group(0)
    if f"text=\"{title}\"" in n and "android:id/title" in n:
        x0, y0, x1, y1 = map(int, re.search(r"bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"", n).groups())
        print((x0 + x1) // 2, (y0 + y1) // 2); break' "$1")
    test -n "$POINT" || { echo "no notification titled $1" >&2; exit 1; }
    adb shell input tap $POINT; sleep 6
}
# The app's notification is posted, on fcm_default_channel where channels exist.
on_channel() { grep -q NotificationRecord "$1" && { [ "$SDK" -lt 26 ] || grep -q "channel=fcm_default_channel" "$1"; }; }
place() { adb exec-out run-as $PKG cat files/app_state.json | python3 -c 'import json,sys; print(json.load(sys.stdin)["placeIndex"])'; }

# 1. The Cordova build in the background gets a message.
adb install "$CORDOVA_APK" >/dev/null
if [ "$SDK" -ge 33 ]; then adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS; fi
adb shell am start -n $PKG/.MainActivity >/dev/null
node "$HERE/../upgrade/seed-cordova.mjs" "$ANDROID_SERIAL" > "$OUT/seeded.json"
node "$HERE/notification-start.mjs" "$ANDROID_SERIAL" | tee "$OUT/start.txt"
adb shell input keyevent HOME; sleep 8
deliver "London 흐림" "Cordova" 2 "0:cordova-1"
posted > "$OUT/1-cordova.txt"; cat "$OUT/1-cordova.txt"
on_channel "$OUT/1-cordova.txt"

# 2. The update.
adb install -r "$APK" >/dev/null
sleep 2
posted > "$OUT/2-after-update.txt"
echo "after the update: $(grep -c NotificationRecord "$OUT/2-after-update.txt" || true) notification(s) of the app posted"

# 3. Native in the background: FCM posts; a tap brings the app back and selects 명동.
adb shell am start -W -n $PKG/.MainActivity >/dev/null; sleep 6
echo "opened on place $(place)" | tee "$OUT/3-opened.txt"
adb shell input keyevent HOME; sleep 8
deliver "명동 맑음" "warm" 1 "0:native-warm"
posted > "$OUT/3-posted.txt"; cat "$OUT/3-posted.txt"
on_channel "$OUT/3-posted.txt"
tap "명동 맑음"
echo "warm tap: place $(place)" | tee -a "$OUT/3-opened.txt"
test "$(place)" = 1
adb exec-out screencap -p > "$OUT/3-warm.png"

# 4. The process ends after the message is posted; a tap starts the app and selects London.
adb shell input keyevent HOME; sleep 8
deliver "London 흐림" "cold" 2 "0:native-cold"
# API 24's `am kill` without a user answers "Invalid packageName" and kills nothing.
adb shell am kill --user current $PKG; sleep 2
if [ -n "$(adb shell pidof $PKG || true)" ]; then
    adb shell dumpsys activity processes > "$OUT/4-processes.txt"; adb shell dumpsys activity services $PKG > "$OUT/4-services.txt"
    echo "the process is still running" >&2; exit 1
fi
tap "London 흐림"
echo "cold tap: place $(place)" | tee "$OUT/4-cold.txt"
test "$(place)" = 2
adb exec-out screencap -p > "$OUT/4-cold.png"

# Taps the node whose text is $1 when one shows (no failure otherwise).
tap_text() {
    adb shell uiautomator dump /sdcard/tw-ui.xml >/dev/null 2>&1
    POINT=$(adb exec-out cat /sdcard/tw-ui.xml | python3 -c '
import re, sys
for m in re.finditer(r"<node [^>]*>", sys.stdin.read()):
    n = m.group(0)
    if f"text=\"{sys.argv[1]}\"" in n:
        x0, y0, x1, y1 = map(int, re.search(r"bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"", n).groups())
        print((x0 + x1) // 2, (y0 + y1) // 2); break' "$1")
    if [ -n "$POINT" ]; then adb shell input tap $POINT; sleep 2; fi
}

# 5. In the foreground: O07, nothing posted. Offline, the place's load fails and its retry confirmation (O03) is
# closed first: the Cordova app's popups also wait for each other.
adb shell cmd statusbar collapse; sleep 2
tap_text Close
tap_text 닫기
BEFORE=$(posted | grep -c NotificationRecord || true)
deliver "명동 맑음 O07" "foreground" 1 "0:native-foreground"
AFTER=$(posted | grep -c NotificationRecord || true)
adb shell uiautomator dump /sdcard/tw-ui.xml >/dev/null 2>&1
adb exec-out cat /sdcard/tw-ui.xml > "$OUT/5-foreground.xml"
adb exec-out screencap -p > "$OUT/5-foreground.png"
echo "foreground: posted before $BEFORE, after $AFTER" | tee "$OUT/5-foreground.txt"
test "$AFTER" = "$BEFORE"
grep -q "명동 맑음 O07" "$OUT/5-foreground.xml"
echo "notification check passed; evidence in $OUT"
