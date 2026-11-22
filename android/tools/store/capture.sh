#!/bin/sh
# Ad-free Play Store screens (#3122) from the actual debug app with live read-only data: StoreCaptureTest per locale
# (the four app screens, then its widgets pinned on the launcher's home screen).
#   capture.sh <new out-dir> [locale:region ...]   (default ko-KR:KR en-US:US ja-JP:JP)
# The run owns its device: it creates a disposable AVD (Pixel 8 profile, API 36 Google APIs image, 1080x1920 at 420 dpi,
# Asia/Seoul), cold boots it with wiped data once per locale with that system language (-change-locale; the launcher
# and the clock widget follow it), and kills the emulator and deletes the AVD on every exit. No other emulator or
# device is touched, so nothing has to be restored. The output directory must not exist: a run never replaces or
# deletes an earlier capture. Needs the private debug inputs of tools/manual/README.md and a network; product push
# requests are intercepted by the test application. Writes <out-dir>/<locale>/store-0N-*.png and .json.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
SDK=${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}
IMAGE=${TW_STORE_SYSTEM_IMAGE:-system-images;android-36;google_apis;arm64-v8a}
PKG=net.wizardfactory.todayweather
OUT=${1:?output directory required}
shift
LOCALES=${*:-ko-KR:KR en-US:US ja-JP:JP}
# Only language-REGION:REGION pairs (ko-KR:KR), each locale once; they name the output directories.
SEEN=
for pair in $LOCALES; do
    printf '%s\n' "$pair" | grep -Eqx '[a-z]{2}-[A-Z]{2}:[A-Z]{2}' || { echo "Bad locale pair: $pair" >&2; exit 2; }
    case " $SEEN " in *" ${pair%%:*} "*) echo "Locale given twice: ${pair%%:*}" >&2; exit 2 ;; esac
    SEEN="$SEEN ${pair%%:*}"
done
APP=$HERE/../../app/build/outputs/apk
for apk in "$APP/debug/app-debug.apk" "$APP/androidTest/debug/app-debug-androidTest.apk"; do
    [ -f "$apk" ] || { echo "missing $apk: build assembleDebug assembleDebugAndroidTest first" >&2; exit 2; }
done
# Claimed with a plain mkdir: an existing directory (or a concurrent run that took it first) stops this run here.
mkdir -p "$(dirname "$OUT")"
mkdir "$OUT" 2>/dev/null || { echo "$OUT exists: give a new output directory" >&2; exit 2; }

# This run's device: a run-unique AVD name, refused if it already exists. Cleanup acts only on what this run created:
# the AVD once created (CREATED), and an emulator only when it is this run's process and, for the console kill, when
# the serial reports this run's AVD.
AVD=tw_store_capture_$(uuidgen | tr -d - | cut -c1-12 | tr 'A-F' 'a-f')
AVDS=$("$SDK/emulator/emulator" -list-avds) || { echo "cannot list AVDs" >&2; exit 2; }
! printf '%s\n' "$AVDS" | grep -qx "$AVD" || { echo "AVD $AVD exists already" >&2; exit 2; }
CREATED=
EMULATOR_PID=
SERIAL=
PORT_LOCK=
owns_serial() { [ -n "$SERIAL" ] && [ "$(adb -s "$SERIAL" emu avd name 2>/dev/null | tr -d '\r' | head -1)" = "$AVD" ]; }
stop_emulator() {
    [ -n "$EMULATOR_PID" ] || return 0
    if owns_serial; then adb -s "$SERIAL" emu kill >/dev/null 2>&1; fi
    i=0
    while kill -0 "$EMULATOR_PID" 2>/dev/null; do
        i=$((i + 1))
        if [ "$i" -eq 20 ]; then kill "$EMULATOR_PID" 2>/dev/null; fi
        if [ "$i" -ge 40 ]; then kill -9 "$EMULATOR_PID" 2>/dev/null; break; fi
        sleep 1
    done
    EMULATOR_PID=
}
# Every exit: stop this run's emulator and delete its AVD, verified; anything that cannot be confirmed fails the run.
cleanup() {
    status=$?
    set +e
    stop_emulator
    if [ -n "$CREATED" ]; then
        "$SDK/cmdline-tools/latest/bin/avdmanager" delete avd -n "$AVD" >/dev/null 2>&1
        deleted=$?
        if AVDS=$("$SDK/emulator/emulator" -list-avds 2>/dev/null) && ! printf '%s\n' "$AVDS" | grep -qx "$AVD" \
                && [ ! -e "$HOME/.android/avd/$AVD.avd" ]; then
            :
        else
            echo "cleanup: could not confirm that the AVD $AVD was deleted (avdmanager exit $deleted)" >&2
            [ "$status" -ne 0 ] || status=6
        fi
    fi
    [ -z "$PORT_LOCK" ] || rmdir "$PORT_LOCK" 2>/dev/null
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# A console port for this run (even, 5600-5680), reserved with a lock directory among these runs and free of any
# device or listener on it and the next port; the booted emulator must then report this run's AVD on it.
PORT=
for p in $(seq 5600 2 5680); do
    mkdir "${TMPDIR:-/tmp}/tw-emulator-port-$p.lock" 2>/dev/null || continue
    if adb devices | grep -q "emulator-$p" || nc -z 127.0.0.1 "$p" 2>/dev/null || nc -z 127.0.0.1 $((p + 1)) 2>/dev/null; then
        rmdir "${TMPDIR:-/tmp}/tw-emulator-port-$p.lock"; continue
    fi
    PORT=$p; PORT_LOCK=${TMPDIR:-/tmp}/tw-emulator-port-$p.lock; break
done
[ -n "$PORT" ] || { echo "no free emulator port" >&2; exit 2; }
SERIAL=emulator-$PORT
export ANDROID_SERIAL=$SERIAL

# Marked before creating: the name was checked to be new, so a partly created AVD is this run's to delete.
CREATED=1
echo no | "$SDK/cmdline-tools/latest/bin/avdmanager" create avd -n "$AVD" -k "$IMAGE" -d pixel_8 >/dev/null
CONFIG=$HOME/.android/avd/$AVD.avd/config.ini
sed -i '' 's/^hw.lcd.height=.*/hw.lcd.height=1920/; s/^hw.lcd.width=.*/hw.lcd.width=1080/; s/^hw.lcd.density=.*/hw.lcd.density=420/' "$CONFIG"

# A cold boot with wiped data in the locale's system language; returns once the serial reports this run's AVD and the
# launcher has focus (bounded).
boot() {
    "$SDK/emulator/emulator" -avd "$AVD" -port "$PORT" -no-window -no-audio -no-boot-anim -no-snapshot -wipe-data \
        -timezone Asia/Seoul -change-locale "$1" >"$OUT/.emulator-$1.log" 2>&1 &
    EMULATOR_PID=$!
    i=0
    until owns_serial && [ "$(adb get-state 2>/dev/null)" = device ] \
          && [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] \
          && [ "$(adb shell getprop persist.sys.locale 2>/dev/null | tr -d '\r')" = "$1" ] \
          && adb shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus | grep -qi launcher; do
        i=$((i + 1)); [ "$i" -lt 150 ] || { echo "the emulator did not start in $1" >&2; return 4; }
        kill -0 "$EMULATOR_PID" 2>/dev/null || { echo "the emulator exited; see $OUT/.emulator-$1.log" >&2; return 4; }
        adb shell input keyevent KEYCODE_HOME >/dev/null 2>&1 || true
        sleep 2
    done
    sleep 10
}

for pair in $LOCALES; do
    locale=${pair%%:*}; region=${pair#*:}
    # Each locale is pulled into its own new directory and moved to <out>/<locale> (what the composer reads) only
    # after the checks below pass, so a rejected capture is never an input.
    PULL=$OUT/.$locale.pull
    mkdir "$PULL"
    boot "$locale" || exit 4
    adb shell dumpsys connectivity | grep -q 'Active default network: none' && { echo 'Network required' >&2; exit 3; }
    if [ ! -f "$OUT/device.txt" ]; then
        { adb shell getprop ro.build.fingerprint; echo "sdk: $(adb shell getprop ro.build.version.sdk | tr -d '\r')"
          adb shell wm size; adb shell wm density; adb shell getprop persist.sys.timezone; echo "ads: off"; } > "$OUT/device.txt"
        shasum -a 256 "$APP/debug/app-debug.apk" "$APP/androidTest/debug/app-debug-androidTest.apk" > "$OUT/apk.sha256"
    fi
    adb install "$APP/debug/app-debug.apk" >/dev/null
    adb install "$APP/androidTest/debug/app-debug-androidTest.apk" >/dev/null
    adb shell cmd locale set-app-locales "$PKG" --locales "$locale"
    adb shell am instrument -w -e ads off -e manual true -e weather production -e region "$region" \
        -e class "$PKG.StoreCaptureTest" "$PKG.test/$PKG.TestRunner" > "$PULL/store.log" 2>&1
    grep -q '^OK (2 tests)' "$PULL/store.log" || { echo "Capture failed: $locale; see $PULL/store.log" >&2; exit 1; }
    adb pull "/sdcard/Android/data/$PKG/files/manual/." "$PULL/" >/dev/null || { echo "Pull failed: $locale" >&2; exit 1; }
    # The six screens, each a PNG at the display size with its record: ads off and the requested language.
    python3 - "$PULL" "$locale" "$(adb shell wm size | tr -d '\r' | sed -n 's/.*size: //p' | tail -1)" <<'PY' || exit 1
import json, struct, sys
from pathlib import Path
d, locale, size = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
w, h = (int(x) for x in size.split("x"))
for n in ("01-compare", "02-hourly", "03-daily", "04-air", "05-widgets", "06-widgets"):
    png, rec = d / f"store-{n}.png", d / f"store-{n}.json"
    if not png.is_file() or not rec.is_file():
        sys.exit(f"{locale}: store-{n} missing")
    head = png.read_bytes()[:24]
    if head[:8] != b"\x89PNG\r\n\x1a\n" or struct.unpack(">II", head[16:24]) != (w, h):
        sys.exit(f"{locale}: store-{n}.png is not a {w}x{h} PNG")
    r = json.loads(rec.read_text())
    if r.get("ads") != "off" or r.get("analytics") is not False or r.get("language") != locale.split("-")[0] \
            or (r.get("width"), r.get("height")) != (w, h):
        sys.exit(f"{locale}: store-{n}.json does not record an ad-free {locale.split('-')[0]} {w}x{h} capture: {r}")
PY
    mv "$PULL" "$OUT/$locale"
    stop_emulator
    echo "Captured $locale"
done
