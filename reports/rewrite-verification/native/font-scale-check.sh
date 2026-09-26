#!/bin/sh
# Android system text size vs. the WebView: legacy builds called MobileAccessibility.usePreferredTextZoom(false);
# the PoC has no such plugin. Captures hourly at font_scale 1.0 and 1.3, then restores the original scale.
# Usage: font-scale-check.sh <outDir>   (app must be installed with at least one city)
set -eu
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
PKG=net.wizardfactory.todayweather
OUT="$1"; mkdir -p "$OUT"
orig=$("$ADB" shell settings get system font_scale | tr -d '\r')
shot() { "$ADB" exec-out screencap -p | perl -0777 -pe 's/^.*?(\x89PNG)/$1/s' > "$OUT/$1.png"; }
for scale in 1.0 1.3; do
    "$ADB" shell settings put system font_scale "$scale"
    "$ADB" shell am force-stop "$PKG"; sleep 2
    "$ADB" shell am start -n "$PKG/.MainActivity" >/dev/null; sleep 14
    "$ADB" shell input keyevent KEYCODE_BACK; sleep 1   # closes the update-info popup (Android back resolves it)
    shot "font-scale-$scale"
    "$ADB" logcat -d | grep -o '"TWSTEP [^"]*deviceready[^"]*"' | tail -1 || true
done
"$ADB" shell settings put system font_scale "${orig:-1.0}"
"$ADB" shell am force-stop "$PKG"
echo "restored font_scale=${orig:-1.0}"
