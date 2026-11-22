#!/bin/sh
# Ad-free Play Store screens (#3122) from the actual debug app with live read-only data: StoreCaptureTest per locale
# (the four app screens, then its widgets pinned on the launcher's home screen). The emulator's system language is set
# to each locale too (the launcher and the clock widget follow it), which needs `adb root` (a Google APIs image); the
# original language is restored on every exit.
#   ANDROID_SERIAL=emulator-NNNN capture.sh <new out-dir> [locale:region ...]   (default ko-KR:KR en-US:US ja-JP:JP)
# The output directory must not exist: a run never replaces or deletes an earlier capture.
# Same private debug inputs, emulator rules and cleanup as tools/manual/capture.sh: a caller-owned emulator with the
# network on; both test packages are uninstalled on every exit. Writes <out-dir>/<locale>/store-0N-*.png and .json.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/../emulator/offline.sh"
emulator_guard
OUT=${1:?output directory required}
shift
LOCALES=${*:-ko-KR:KR en-US:US ja-JP:JP}
# Only language-REGION:REGION pairs (ko-KR:KR), each locale once; they name the output directories. Checked before any
# side effect.
SEEN=
for pair in $LOCALES; do
    printf '%s\n' "$pair" | grep -Eqx '[a-z]{2}-[A-Z]{2}:[A-Z]{2}' || { echo "Bad locale pair: $pair" >&2; exit 2; }
    case " $SEEN " in *" ${pair%%:*} "*) echo "Locale given twice: ${pair%%:*}" >&2; exit 2 ;; esac
    SEEN="$SEEN ${pair%%:*}"
done
# The run switches the system language and restarts the framework as root, so it takes only this project's own AVDs
# (named tw_*), and one run per emulator at a time (a lock directory in the emulator's AVD directory).
AVD=$(adb emu avd name 2>/dev/null | tr -d '\r' | head -1)
case "$AVD" in tw_*) ;; *) echo "refusing emulator AVD '$AVD': only this project's tw_* AVDs" >&2; exit 2 ;; esac
LOCK=$HOME/.android/avd/$AVD.avd/tw-store-capture.lock
mkdir "$LOCK" 2>/dev/null || { echo "another store capture holds $AVD ($LOCK)" >&2; exit 2; }
APP=$HERE/../../app/build/outputs/apk
# Claimed with a plain mkdir: an existing directory (or a concurrent run that took it first) stops this run here.
mkdir -p "$(dirname "$OUT")"
mkdir "$OUT" 2>/dev/null || { rmdir "$LOCK"; echo "$OUT exists: give a new output directory" >&2; exit 2; }
# adb waits are bounded: a device that does not answer in 120 s fails the run.
adb_wait() { i=0; until [ "$(adb get-state 2>/dev/null)" = device ]; do i=$((i + 1)); [ "$i" -lt 60 ] || return 1; sleep 2; done; }
WAS_ROOT=$(adb shell whoami | tr -d '\r')
# The system language: persist.sys.locale, then a framework restart; done once the language is applied and the
# launcher has focus again. Returns non-zero instead of exiting, so cleanup can still run after a failure.
system_locale() {
    adb root >/dev/null 2>&1 || true
    adb_wait || return 1
    [ "$(adb shell whoami | tr -d '\r')" = root ] || { echo "adb root is needed to set the system language" >&2; return 2; }
    adb shell setprop persist.sys.locale "$1" || return 1
    adb shell setprop ctl.restart zygote || return 1
    sleep 5
    i=0
    until [ "$(adb shell getprop persist.sys.locale 2>/dev/null | tr -d '\r')" = "$1" ] && \
          adb shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus | grep -qi launcher; do
        i=$((i + 1)); [ "$i" -lt 60 ] || { echo "the framework did not come back in $1" >&2; return 4; }
        adb shell input keyevent KEYCODE_HOME >/dev/null 2>&1 || true
        sleep 2
    done
    sleep 5
}
ORIGINAL_LOCALE=$(adb shell getprop persist.sys.locale | tr -d '\r')
# Back to the original language and, when this run made adbd root, to an unrooted adbd; any failure is reported and
# fails the run.
restore_device() {
    ok=0
    if [ "$(adb shell getprop persist.sys.locale 2>/dev/null | tr -d '\r')" != "$ORIGINAL_LOCALE" ]; then
        system_locale "$ORIGINAL_LOCALE" || { echo "could not restore the system language $ORIGINAL_LOCALE" >&2; ok=1; }
    fi
    if [ "$WAS_ROOT" != root ] && [ "$(adb shell whoami 2>/dev/null | tr -d '\r')" = root ]; then
        adb unroot >/dev/null 2>&1; adb_wait
        [ "$(adb shell whoami 2>/dev/null | tr -d '\r')" != root ] || { echo "adbd is still root" >&2; ok=1; }
    fi
    return $ok
}
# Every exit: restore the device, then online_cleanup (uninstall both packages, offline when that cannot be confirmed)
# with the run's status, made a failure when the restore failed. Runs with errexit off.
cleanup() {
    status=$?
    set +e
    restore_device || [ "$status" -ne 0 ] || status=6
    rmdir "$LOCK" 2>/dev/null
    (exit "$status")
    online_cleanup
}
trap cleanup EXIT
trap 'exit 130' INT TERM
[ "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" -ge 33 ] || exit 2
adb shell dumpsys connectivity | grep -q 'Active default network: none' && { echo 'Network required' >&2; exit 3; }
{ adb shell getprop ro.build.fingerprint; echo "sdk: $(adb shell getprop ro.build.version.sdk | tr -d '\r')"
  adb shell wm size; adb shell wm density; adb shell getprop persist.sys.timezone; echo "ads: off"; } > "$OUT/device.txt"
shasum -a 256 "$APP/debug/app-debug.apk" "$APP/androidTest/debug/app-debug-androidTest.apk" > "$OUT/apk.sha256"
for pair in $LOCALES; do
    locale=${pair%%:*}; region=${pair#*:}
    # Each locale is pulled into its own new directory and moved to <out>/<locale> (what the composer reads) only
    # after the checks below pass, so a rejected capture is never an input.
    PULL=$OUT/.$locale.pull
    mkdir "$PULL"
    system_locale "$locale" || exit 4
    # A new install per locale: uninstalling also removes the widgets the previous locale placed on the launcher.
    adb uninstall "$PKG.test" >/dev/null 2>&1 || true
    adb uninstall "$PKG" >/dev/null 2>&1 || true
    adb install "$APP/debug/app-debug.apk" >/dev/null
    adb install "$APP/androidTest/debug/app-debug-androidTest.apk" >/dev/null
    adb shell cmd locale set-app-locales "$PKG" --locales "$locale"
    adb shell am instrument -w -e ads off -e manual true -e weather production -e region "$region" \
        -e class "$PKG.StoreCaptureTest" "$PKG.test/$PKG.TestRunner" > "$PULL/store.log" 2>&1
    grep -q '^OK (2 tests)' "$PULL/store.log" || { echo "Capture failed: $locale; see $PULL/store.log" >&2; exit 1; }
    adb pull "/sdcard/Android/data/$PKG/files/manual/." "$PULL/" >/dev/null || { echo "Pull failed: $locale" >&2; exit 1; }
    # The four screens, each a PNG at the display size with its record: ads off and the requested language.
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
    echo "Captured $locale"
done
