#!/bin/sh
# Ad-free Play Store screens (#3122) from the actual debug app with live read-only data: StoreCaptureTest per locale.
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
# Only language-REGION:REGION pairs (ko-KR:KR); they name the output directories. Checked before any side effect.
for pair in $LOCALES; do
    printf '%s\n' "$pair" | grep -Eqx '[a-z]{2}-[A-Z]{2}:[A-Z]{2}' || { echo "Bad locale pair: $pair" >&2; exit 2; }
done
APP=$HERE/../../app/build/outputs/apk
# Claimed with a plain mkdir: an existing directory (or a concurrent run that took it first) stops this run here.
mkdir -p "$(dirname "$OUT")"
mkdir "$OUT" 2>/dev/null || { echo "$OUT exists: give a new output directory" >&2; exit 2; }
trap online_cleanup EXIT
trap 'exit 130' INT TERM
[ "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" -ge 33 ] || exit 2
adb shell dumpsys connectivity | grep -q 'Active default network: none' && { echo 'Network required' >&2; exit 3; }
adb uninstall "$PKG.test" >/dev/null 2>&1 || true
adb uninstall "$PKG" >/dev/null 2>&1 || true
adb install "$APP/debug/app-debug.apk" >/dev/null
adb install "$APP/androidTest/debug/app-debug-androidTest.apk" >/dev/null
{ adb shell getprop ro.build.fingerprint; echo "sdk: $(adb shell getprop ro.build.version.sdk | tr -d '\r')"
  adb shell wm size; adb shell wm density; adb shell getprop persist.sys.timezone; echo "ads: off"; } > "$OUT/device.txt"
shasum -a 256 "$APP/debug/app-debug.apk" "$APP/androidTest/debug/app-debug-androidTest.apk" > "$OUT/apk.sha256"
for pair in $LOCALES; do
    locale=${pair%%:*}; region=${pair#*:}
    # Each locale is pulled into its own new directory and moved to <out>/<locale> (what the composer reads) only
    # after the checks below pass, so a rejected capture is never an input.
    PULL=$OUT/.$locale.pull
    mkdir "$PULL"
    adb shell pm clear "$PKG" >/dev/null
    adb shell cmd locale set-app-locales "$PKG" --locales "$locale"
    adb shell am instrument -w -e ads off -e manual true -e weather production -e region "$region" \
        -e class "$PKG.StoreCaptureTest#store" "$PKG.test/$PKG.TestRunner" > "$PULL/store.log" 2>&1
    grep -q '^OK (1 test)' "$PULL/store.log" || { echo "Capture failed: $locale; see $PULL/store.log" >&2; exit 1; }
    adb pull "/sdcard/Android/data/$PKG/files/manual/." "$PULL/" >/dev/null || { echo "Pull failed: $locale" >&2; exit 1; }
    # The four screens, each a PNG at the display size with its record: ads off and the requested language.
    python3 - "$PULL" "$locale" "$(adb shell wm size | tr -d '\r' | sed -n 's/.*size: //p' | tail -1)" <<'PY' || exit 1
import json, struct, sys
from pathlib import Path
d, locale, size = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
w, h = (int(x) for x in size.split("x"))
for n in ("01-compare", "02-hourly", "03-daily", "04-air"):
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
