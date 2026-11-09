#!/bin/sh
# Entry links and backup on an emulator (AN-16, #2895):
# 1. EntryLinkDeviceTest: todayweather://2 opened with `am start` (through the manifest's filter) while the app is stopped,
#    then todayweather://1 while it is open, then todayweather://2 as Recents delivers a finished task's first link again;
# 2. a native backup (`bmgr backupnow`, local transport) restored after a reinstall (`bmgr restore`): BackupRestoreTest
#    checks what came back against the policy in android/README.md;
# 3. a Cordova 1.1.1 backup restored into this build: the Cordova data migrates, and Cordova files outside the policy stay
#    behind;
# on API 31+, 2 and 3 again as device transfers: the local transport's `is_device_transfer` parameter makes Android apply
# the device-transfer section of data_extraction_rules.xml (a probe build without app_state.json in that section restored
# it from a cloud backup and not from a transfer).
#   ANDROID_SERIAL=emulator-5554 android/tools/backup/run-backup-test.sh <cordova-debug.apk> [out-dir]
# The emulator stays offline while either app is installed (tools/emulator/offline.sh), so neither gets an FCM token or
# reaches a server; the test app records push requests. The backup transport, its parameters and its on/off state are set
# for the run and put back on every exit. Requires the native debug and androidTest APKs signed with the Cordova APK's debug key.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/../emulator/offline.sh"
emulator_guard
CORDOVA_APK=$1
OUT=${2:-/tmp/tw-backup}
APP=$HERE/../../app/build/outputs/apk
RUNNER=$PKG.test/$PKG.TestRunner
mkdir -p "$OUT"
# The local transport: com.android.localtransport/.LocalTransport, android/com.android.internal.backup.LocalTransport on
# older releases.
LOCAL=$(adb shell bmgr list transports | tr -d '\r' | sed -n 's/^[ *]*\([^ ]*LocalTransport\)$/\1/p' | head -1)
[ -n "$LOCAL" ] || { echo "no local backup transport" >&2; exit 1; }
TRANSPORT=$(adb shell bmgr list transports | sed -n 's/^ *\* *//p' | tr -d '\r')
ENABLED=$(adb shell bmgr enabled | tr -d '\r')
PARAMS=$(adb shell settings get secure backup_local_transport_parameters | tr -d '\r')
put_back() {
    if [ "$PARAMS" = null ]; then adb shell settings delete secure backup_local_transport_parameters >/dev/null 2>&1
    else adb shell settings put secure backup_local_transport_parameters "$PARAMS" >/dev/null 2>&1; fi
    [ -n "$TRANSPORT" ] && adb shell bmgr transport "$TRANSPORT" >/dev/null 2>&1
    case "$ENABLED" in *disabled*) adb shell bmgr enable false >/dev/null 2>&1 ;; esac
}
CLEANUP_HOOK=put_back
trap offline_cleanup EXIT
trap 'exit 130' INT TERM

go_offline
adb shell bmgr enable true >/dev/null
adb shell bmgr transport $LOCAL >/dev/null

fresh() {
    adb uninstall $PKG.test >/dev/null 2>&1 || true
    adb uninstall $PKG >/dev/null 2>&1 || true
    adb install "$APP/debug/app-debug.apk" >/dev/null
    adb install "$APP/androidTest/debug/app-debug-androidTest.apk" >/dev/null
}
# One instrumented test; its output goes to $OUT/<name>.txt and must report one passing test.
check() {
    name=$1; shift
    adb shell am instrument -w "$@" $RUNNER > "$OUT/$name.txt"
    grep -q "^OK (1 test)" "$OUT/$name.txt" || { cat "$OUT/$name.txt" >&2; echo "$name failed" >&2; exit 1; }
}
# A stopped package (force-stop, a fresh install) is not backed up: open the app once and leave it.
backup() {
    adb shell am start -W -n $PKG/.MainActivity >/dev/null
    sleep 3
    adb shell input keyevent KEYCODE_HOME
    sleep 2
    adb shell bmgr backupnow $PKG > "$OUT/$1.txt"
    grep -q "$PKG.*Success" "$OUT/$1.txt" || { cat "$OUT/$1.txt" >&2; exit 1; }
}
# `am start` of a link in the stopped app: the output goes to $OUT/<name>.txt and must show MainActivity started.
open_link() {
    name=$1; shift
    adb shell am start -W -a android.intent.action.VIEW "$@" > "$OUT/$name.txt"
    grep -q "Status: ok" "$OUT/$name.txt" || { cat "$OUT/$name.txt" >&2; exit 1; }
    grep -q "$PKG/.MainActivity" "$OUT/$name.txt" || { cat "$OUT/$name.txt" >&2; exit 1; }
    sleep 6
    adb shell am force-stop $PKG
}
restore() {
    set_token=$(adb shell bmgr list sets | sed -n 's/^ *\([0-9a-f][0-9a-f]*\) *:.*/\1/p' | head -1 | tr -d '\r')
    [ -n "$set_token" ] || { echo "no restore set" >&2; exit 1; }
    adb shell bmgr restore "$set_token" $PKG > "$OUT/$1.txt"
    grep -q "restoreFinished: 0\|done" "$OUT/$1.txt" || { cat "$OUT/$1.txt" >&2; exit 1; }
}

# 1. Entry links.
fresh
check link-seed -e link seed -e class $PKG.EntryLinkDeviceTest#seed
adb shell am force-stop $PKG
open_link link-cold-start -d todayweather://2
check link-cold -e link cold -e class $PKG.EntryLinkDeviceTest#coldStartSelectedThePlace
check link-warm -e link warm -e class $PKG.EntryLinkDeviceTest#warmStartSelectsThePlace
check link-recents -e link recents -e class $PKG.EntryLinkDeviceTest#aRelaunchFromRecentsKeepsThePlace

# 2. A native backup restored into a fresh install; $1 names the pass's files.
native_restore() {
    fresh
    check backup-seed$1 -e backup seed -e class $PKG.BackupRestoreTest#seed
    backup backup-native$1
    adb uninstall $PKG >/dev/null
    adb install "$APP/debug/app-debug.apk" >/dev/null
    restore restore-native$1
    check backup-native-check$1 -e backup native -e token token-b -e class $PKG.BackupRestoreTest#nativeBackupRestoresThePolicy
}

# 3. A Cordova 1.1.1 backup restored into this build; $1 names the pass's files.
cordova_restore() {
    adb uninstall $PKG.test >/dev/null 2>&1 || true
    adb uninstall $PKG >/dev/null 2>&1 || true
    adb install "$CORDOVA_APK" >/dev/null
    adb shell am start -n $PKG/.MainActivity >/dev/null
    node "$HERE/../upgrade/seed-cordova.mjs" "$ANDROID_SERIAL" > "$OUT/seeded$1.json"
    adb shell am force-stop $PKG
    adb shell run-as $PKG ls -R . > "$OUT/cordova-files$1.txt"
    # Files of the Cordova app the policy leaves out and the restored native app does not make while the test runs.
    ABSENT=""
    for f in app_webview/Default/Cookies shared_prefs/WebViewChromiumPrefs.xml app_webview/Default/Preferences; do
        adb shell run-as $PKG ls "$f" >/dev/null 2>&1 && ABSENT="$ABSENT$f,"
    done
    [ -n "$ABSENT" ] || { echo "no Cordova file outside the policy to check" >&2; exit 1; }
    echo "Cordova files that must stay behind: $ABSENT" | tee "$OUT/absent$1.txt"
    backup backup-cordova$1
    adb uninstall $PKG >/dev/null
    adb install "$APP/debug/app-debug.apk" >/dev/null
    adb install "$APP/androidTest/debug/app-debug-androidTest.apk" >/dev/null
    restore restore-cordova$1
    SEEDED=$(base64 < "$OUT/seeded$1.json" | tr -d '\n')
    check backup-cordova-check$1 -e backup cordova -e seeded "$SEEDED" -e absent "$ABSENT" -e class $PKG.BackupRestoreTest#cordovaBackupRestoresAndMigrates
}

native_restore ""
cordova_restore ""
# Device transfers use their own section of the rules from API 31 (earlier releases apply fullBackupContent to both).
if [ "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" -ge 31 ]; then
    adb shell settings put secure backup_local_transport_parameters is_device_transfer=true
    native_restore -transfer
    cordova_restore -transfer
    echo "device transfers passed"
fi
echo "entry links and backup passed; evidence in $OUT"
