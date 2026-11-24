#!/bin/sh
# Checks a signed release APK before it is uploaded (docs/operations/android-release.md) and prints its identity
# for the release notes:
#   android/tools/release/check-apk.sh <signed.apk> <installed-store-release.apk> <mapping.txt>
# The second APK is the release users have now (the Cordova 1.1.1 store APK for the first native release); the
# mapping is R8's mapping.txt of the build (app/build/outputs/mapping/release/mapping.txt). The check passes when
# both signatures verify, every signer's certificate equals the store release's, the package is the same, the
# versionCode is higher, versionName, minSdk and targetSdk are those of app/build.gradle.kts, the app is not
# debuggable, the AdMob app ID is not Google's sample, the Firebase configuration is in the APK, and R8 shrank the
# code and wrote this mapping (check_r8.py). It reads the files and changes nothing. Status 1: a check failed;
# 2: usage or a missing SDK tool.
set -eu
[ $# -eq 3 ] || { echo "usage: check-apk.sh <signed.apk> <installed-store-release.apk> <mapping.txt>" >&2; exit 2; }
APK=$1
STORE=$2
MAPPING=$3
HERE=$(cd "$(dirname "$0")" && pwd)
GRADLE=$HERE/../../app/build.gradle.kts
SDK=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
[ -n "$SDK" ] || { echo "set ANDROID_HOME" >&2; exit 2; }
TOOLS=$(ls -d "$SDK"/build-tools/* 2>/dev/null | sort -V | tail -n 1)
[ -x "$TOOLS/apksigner" ] && [ -x "$TOOLS/aapt2" ] || { echo "no apksigner and aapt2 under $SDK/build-tools" >&2; exit 2; }
command -v python3 >/dev/null || { echo "no python3" >&2; exit 2; }
for file in "$APK" "$STORE" "$MAPPING"; do [ -f "$file" ] || { echo "no file $file" >&2; exit 2; }; done

failed=0
fail() { echo "FAIL $*"; failed=1; }
pass() { echo "ok   $*"; }
badge() { "$TOOLS/aapt2" dump badging "$1"; }
field() { printf '%s\n' "$1" | sed -n "s/^package:.* $2='\([^']*\)'.*/\1/p"; }
# The SHA-256 digests of every signer's certificate of $1, sorted, on one line; status 1 when the signature does
# not verify.
certificates() {
    verified=$("$TOOLS/apksigner" verify --print-certs "$1" 2>/dev/null) || return 1
    printf '%s\n' "$verified" | sed -n 's/^Signer #[0-9]* certificate SHA-256 digest: //p' | sort | tr '\n' ' ' | sed 's/ $//'
}

cert=""
store_cert=""
if cert=$(certificates "$APK"); then pass "signature verifies"; else fail "apksigner verify"; fi
if store_cert=$(certificates "$STORE"); then pass "the store release's signature verifies"
else fail "apksigner verify of the store release $STORE"; fi
# Every signer must match: the same first signer with another signer added is a different signing identity.
if [ -n "$cert" ] && [ "$cert" = "$store_cert" ]; then pass "signing certificates equal the store release's"
else fail "signing certificates ${cert:-none}, the store release has ${store_cert:-none}"; fi

info=$(badge "$APK")
store_info=$(badge "$STORE")
package=$(field "$info" name)
code=$(field "$info" versionCode)
name=$(field "$info" versionName)
min=$(printf '%s\n' "$info" | sed -n -e "s/^minSdkVersion:'\([0-9]*\)'.*/\1/p" -e "s/^sdkVersion:'\([0-9]*\)'.*/\1/p")
target=$(printf '%s\n' "$info" | sed -n "s/^targetSdkVersion:'\([0-9]*\)'.*/\1/p")
store_code=$(field "$store_info" versionCode)
declared() { sed -n "s/^ *$1 = \"\{0,1\}\([^\"]*\)\"\{0,1\}\$/\1/p" "$GRADLE" | head -n 1; }

[ "$package" = "$(field "$store_info" name)" ] && pass "package $package" || fail "package $package, the store release is $(field "$store_info" name)"
[ "${code:-0}" -gt "${store_code:-0}" ] && pass "versionCode $code is above the store release's $store_code" \
    || fail "versionCode ${code:-none} is not above the store release's ${store_code:-none}"
for pair in "versionCode:$code" "versionName:$name" "minSdk:$min" "targetSdk:$target"; do
    key=${pair%%:*}; value=${pair#*:}
    [ "$value" = "$(declared "$key")" ] && pass "$key $value as in app/build.gradle.kts" \
        || fail "$key $value, app/build.gradle.kts of this checkout says $(declared "$key")"
done
if printf '%s\n' "$info" | grep -q "^application-debuggable"; then fail "the APK is debuggable"; else pass "not debuggable"; fi
manifest=$("$TOOLS/aapt2" dump xmltree --file AndroidManifest.xml "$APK")
if printf '%s\n' "$manifest" | grep -q "ca-app-pub-3940256099942544"; then fail "the AdMob app ID is Google's sample"
elif printf '%s\n' "$manifest" | grep -q "ca-app-pub-"; then pass "an AdMob app ID that is not the sample"
else fail "no AdMob app ID in the manifest"; fi
if "$TOOLS/aapt2" dump resources "$APK" | grep -q "string/google_app_id"; then pass "Firebase configuration present"
else fail "no Firebase configuration (app/google-services.json was missing at build time)"; fi
# R8: every dex file shrunk by R8, and the mapping is this build's and complete (check_r8.py prints its lines).
r8_status=0
r8=$(python3 "$HERE/check_r8.py" "$APK" "$MAPPING" 2>&1) || r8_status=$?
printf '%s\n' "$r8" | grep -v '^- ' || true
[ "$r8_status" -eq 0 ] || fail "R8 check (check_r8.py status $r8_status)"
mapping_digest=$(printf '%s\n' "$r8" | sed -n 's/^- R8 mapping SHA-256: //p')

digest=$( (shasum -a 256 "$APK" 2>/dev/null || sha256sum "$APK" 2>/dev/null) | cut -d' ' -f1)
if printf '%s' "$digest" | grep -Eq '^[0-9a-f]{64}$'; then pass "SHA-256 computed"; else fail "cannot compute the APK's SHA-256"; fi

echo
echo "- versionName: $name"
echo "- versionCode: $code"
echo "- minSdk / targetSdk: $min / $target"
echo "- APK SHA-256: $digest"
echo "- Signing certificate SHA-256: $cert"
echo "- R8 mapping SHA-256: ${mapping_digest:-none}"
exit $failed
