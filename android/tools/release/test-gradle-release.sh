#!/bin/sh
# Checks gradle-release.sh with a stand-in gradlew that records its arguments and environment: no variable of
# the caller's shell that the build reads as an input reaches Gradle, Gradle init scripts stop the build, and the
# wrapper runs only in an export. Needs no Gradle, device or network.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
failed=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; failed=1; }
# A stand-in export: CANDIDATE, the wrapper and a gradlew that records what it was given.
export_dir() {
    rm -rf "$TMP/export" "$TMP/home"
    mkdir -p "$TMP/export/android/tools/release" "$TMP/home/.gradle"
    echo 0123456789012345678901234567890123456789 > "$TMP/export/CANDIDATE"
    cp "$HERE/gradle-release.sh" "$TMP/export/android/tools/release/"
    cat > "$TMP/export/android/gradlew" <<'GRADLEW'
#!/bin/sh
echo "ARGS $*" > "$RECORD"
env >> "$RECORD"
exit "${STAND_IN_STATUS:-0}"
GRADLEW
    chmod +x "$TMP/export/android/gradlew"
    : > "$TMP/record"
}
run() { # status in $status, output in $TMP/log; the caller's shell holds leftovers of every kind
    status=0
    ( cd "$TMP"
      HOME="$TMP/home" RECORD="$TMP/record" TW_SERVER_URL=https://leftover.invalid TW_ADMOB_APP_ID_ANDROID=leftover \
      TW_ANDROID_KEYSTORE=/keys/release.jks ORG_GRADLE_PROJECT_versionCode=1 GRADLE_OPTS=-Dleft=over \
      JAVA_TOOL_OPTIONS=-Dleft=over ANDROID_HOME=/sdk "$@" sh "$TMP/export/android/tools/release/gradle-release.sh"
    ) > "$TMP/log" 2>&1 || status=$?
}

export_dir; run env
[ "$status" = 0 ] && grep -q '^ARGS --no-daemon --no-build-cache assembleRelease$' "$TMP/record" && ok "runs assembleRelease without the daemon and the build cache" || { bad "runs assembleRelease (status $status)"; cat "$TMP/log"; }
if grep -Eq '^(TW_|ORG_GRADLE_PROJECT_|GRADLE_OPTS=|JAVA_TOOL_OPTIONS=)' "$TMP/record"; then bad "a build input of the caller's shell reached Gradle: $(grep -Eo '^(TW_|ORG_GRADLE_PROJECT_|GRADLE_OPTS|JAVA_TOOL_OPTIONS)[A-Za-z0-9_]*' "$TMP/record" | tr '\n' ' ')"; else ok "no TW_*, ORG_GRADLE_PROJECT_* or JVM option variable reaches Gradle"; fi
grep -q '^ANDROID_HOME=/sdk$' "$TMP/record" && grep -q "^HOME=$TMP/home$" "$TMP/record" && ok "the SDK location and the rest of the environment are kept" || bad "the SDK location and the rest of the environment are kept"
grep -q 'TW_SERVER_URL' "$TMP/log" && ! grep -q 'leftover' "$TMP/log" && ok "the removed variables are named, their values are not shown" || { bad "the removed variables are named, their values are not shown"; cat "$TMP/log"; }
[ "$(cd "$TMP" && pwd)" != "$(sed -n 's/^PWD=//p' "$TMP/record")" ] && sed -n 's/^PWD=//p' "$TMP/record" | grep -q '/export/android$' && ok "Gradle runs in the export's android directory" || bad "Gradle runs in the export's android directory"

export_dir; run env STAND_IN_STATUS=7
[ "$status" = 7 ] && ok "a failed build keeps its status" || bad "a failed build keeps its status (status $status)"

for script in init.gradle init.gradle.kts init.d/corp.gradle init.d/corp.init.gradle.kts; do
    export_dir; mkdir -p "$TMP/home/.gradle/init.d"; echo "// init" > "$TMP/home/.gradle/$script"; run env
    [ "$status" = 1 ] && grep -q "init script" "$TMP/log" && [ ! -s "$TMP/record" ] && ok "a Gradle init script stops the build: $script" || { bad "a Gradle init script stops the build: $script (status $status)"; cat "$TMP/log"; }
done
export_dir; mkdir -p "$TMP/other-home/init.d"; echo "// init" > "$TMP/other-home/init.d/a.gradle"; run env GRADLE_USER_HOME="$TMP/other-home"
[ "$status" = 1 ] && [ ! -s "$TMP/record" ] && ok "an init script in GRADLE_USER_HOME stops the build" || bad "an init script in GRADLE_USER_HOME stops the build (status $status)"

export_dir; printf 'org.gradle.jvmargs=-Xmx4g\nsecretToken=do-not-print\n' > "$TMP/home/.gradle/gradle.properties"; run env
[ "$status" = 0 ] && grep -q 'org.gradle.jvmargs' "$TMP/log" && grep -q 'secretToken' "$TMP/log" && ! grep -q 'do-not-print' "$TMP/log" && ok "the user's Gradle properties are named for the record, without values" || { bad "the user's Gradle properties are named for the record"; cat "$TMP/log"; }

export_dir; rm "$TMP/export/CANDIDATE"; run env
[ "$status" = 1 ] && grep -q "not an export" "$TMP/log" && [ ! -s "$TMP/record" ] && ok "refuses to build outside an export" || { bad "refuses to build outside an export (status $status)"; cat "$TMP/log"; }
export_dir; mkdir "$TMP/export/.git"; run env
[ "$status" = 1 ] && grep -q "not an export" "$TMP/log" && [ ! -s "$TMP/record" ] && ok "refuses to build in a checkout" || bad "refuses to build in a checkout (status $status)"
exit $failed
