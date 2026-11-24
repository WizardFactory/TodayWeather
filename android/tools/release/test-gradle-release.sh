#!/bin/sh
# Checks gradle-release.sh with a stand-in gradlew that records its arguments and environment: Gradle gets the
# variables the wrapper names and no other, the Gradle user home it uses is the one the wrapper inspected, Gradle
# init scripts stop the build, and the wrapper runs only in an export. Needs no Gradle, device or network.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
TMP=$(cd "$(mktemp -d)" && pwd -P)
trap 'rm -rf "$TMP"' EXIT
failed=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; failed=1; }
RECORD=$TMP/export/gradlew-record
# A stand-in export: CANDIDATE, the wrapper and a gradlew that records what it was given, next to itself (the
# wrapper passes it no variable of the test).
export_dir() {
    rm -rf "$TMP/export" "$TMP/home" "$TMP/other-home"
    mkdir -p "$TMP/export/android/tools/release" "$TMP/home/.gradle"
    echo 0123456789012345678901234567890123456789 > "$TMP/export/CANDIDATE"
    cp "$HERE/gradle-release.sh" "$TMP/export/android/tools/release/"
    cat > "$TMP/export/android/gradlew" <<'GRADLEW'
#!/bin/sh
here=$(cd "$(dirname "$0")" && pwd)
echo "ARGS $*" > "$here/../gradlew-record"
echo "CWD $(pwd -P)" >> "$here/../gradlew-record"
env >> "$here/../gradlew-record"
[ -f "$here/../stand-in-status" ] && exit "$(cat "$here/../stand-in-status")"
exit 0
GRADLEW
    chmod +x "$TMP/export/android/gradlew"
}
# Runs the wrapper from a shell that holds leftovers of every kind; extra NAME=value arguments are added to them.
# WRAPPER_ARGS, when set, are the wrapper's own arguments.
# The Gradle user home is the test's own: a CI runner names its own, with init scripts, in GRADLE_USER_HOME.
run() { # status in $status, output in $TMP/log
    status=0
    ( cd "$TMP"
      env -u GRADLE_USER_HOME HOME="$TMP/home" ANDROID_HOME=/sdk JAVA_HOME=/jdk LANG=ko_KR.UTF-8 \
          TW_SERVER_URL=https://leftover.invalid TW_ADMOB_APP_ID_ANDROID=leftover TW_ANDROID_KEYSTORE=/keys/release.jks \
          ORG_GRADLE_PROJECT_versionCode=1 'ORG_GRADLE_PROJECT_demo.option=1' GRADLE_OPTS=-Dleft=over \
          JAVA_TOOL_OPTIONS=-Dleft=over "JDK_JAVA_OPTIONS=-Dgradle.user.home=$TMP/other-home" UNRELATED_SETTING=leftover \
          "$@" sh "$TMP/export/android/tools/release/gradle-release.sh" ${WRAPPER_ARGS:-}
    ) > "$TMP/log" 2>&1 || status=$?
}
names() { sed -n '3,$p' "$RECORD" | sed -n 's/^\([A-Za-z_][A-Za-z0-9_.]*\)=.*/\1/p' | sort | tr '\n' ' '; }

export_dir; run
[ "$status" = 0 ] && grep -q "^ARGS --no-daemon --no-build-cache --gradle-user-home $TMP/home/.gradle assembleRelease\$" "$RECORD" && ok "runs assembleRelease without the daemon and the build cache, in the inspected Gradle user home" || { bad "runs assembleRelease (status $status)"; cat "$TMP/log"; cat "$RECORD" 2>/dev/null | head -3; }
# sh adds a few variables of its own (PWD, SHLVL, _, OLDPWD); everything else must be on the wrapper's list.
unexpected=$(names | tr ' ' '\n' | grep -Ev '^(ANDROID_HOME|ANDROID_SDK_ROOT|GRADLE_USER_HOME|HOME|JAVA_HOME|LANG|LC_ALL|LC_CTYPE|LOGNAME|PATH|TERM|TMPDIR|USER|PWD|OLDPWD|SHLVL|_)$' | tr '\n' ' ')
[ -z "$(echo $unexpected)" ] && ok "Gradle gets the listed variables and no other" || bad "variables outside the list reached Gradle: $unexpected"
if grep -Eq 'leftover|left=over|other-home|demo.option|/keys/release.jks' "$RECORD"; then bad "a leftover of the caller's shell reached Gradle"; else ok "no leftover value of the caller's shell reaches Gradle (TW_*, dotted project variables, JVM options, anything else)"; fi
grep -q '^ANDROID_HOME=/sdk$' "$RECORD" && grep -q '^JAVA_HOME=/jdk$' "$RECORD" && grep -q "^HOME=$TMP/home$" "$RECORD" && grep -q '^LANG=ko_KR.UTF-8$' "$RECORD" && grep -q "^GRADLE_USER_HOME=$TMP/home/.gradle$" "$RECORD" && ok "the SDK, the JDK, the home, the locale and the inspected Gradle user home are passed" || bad "the SDK, the JDK, the home, the locale and the inspected Gradle user home are passed"
grep -q "^CWD $TMP/export/android$" "$RECORD" && ok "Gradle runs in the export's android directory" || bad "Gradle runs in the export's android directory"
grep -q 'TW_SERVER_URL' "$TMP/log" && grep -q 'JDK_JAVA_OPTIONS' "$TMP/log" && ! grep -Eq 'leftover|left=over|other-home' "$TMP/log" && ok "the variables kept from Gradle are named, their values are not shown" || { bad "the variables kept from Gradle are named, their values are not shown"; cat "$TMP/log"; }

export_dir; echo 7 > "$TMP/export/stand-in-status"; run
[ "$status" = 7 ] && ok "a failed build keeps its status" || bad "a failed build keeps its status (status $status)"

for script in init.gradle init.gradle.kts init.d/corp.gradle init.d/corp.init.gradle.kts; do
    export_dir; mkdir -p "$TMP/home/.gradle/init.d"; echo "// init" > "$TMP/home/.gradle/$script"; run
    [ "$status" = 1 ] && grep -q "init script" "$TMP/log" && [ ! -e "$RECORD" ] && ok "a Gradle init script stops the build: $script" || { bad "a Gradle init script stops the build: $script (status $status)"; cat "$TMP/log"; }
done
# GRADLE_USER_HOME names the home: it is the one inspected and the one passed.
export_dir; mkdir -p "$TMP/other-home/init.d"; echo "// init" > "$TMP/other-home/init.d/a.gradle"; run GRADLE_USER_HOME="$TMP/other-home"
[ "$status" = 1 ] && [ ! -e "$RECORD" ] && ok "an init script in GRADLE_USER_HOME stops the build" || bad "an init script in GRADLE_USER_HOME stops the build (status $status)"
export_dir; mkdir -p "$TMP/other-home"; run GRADLE_USER_HOME="$TMP/other-home"
[ "$status" = 0 ] && grep -q "^GRADLE_USER_HOME=$TMP/other-home$" "$RECORD" && grep -q -- "--gradle-user-home $TMP/other-home " "$RECORD" && ok "a clean GRADLE_USER_HOME is inspected and passed" || { bad "a clean GRADLE_USER_HOME is inspected and passed (status $status)"; cat "$TMP/log"; }
# A home with init scripts named only through a JVM option: the option does not reach Gradle, the inspected home does.
export_dir; mkdir -p "$TMP/other-home/init.d"; echo "// init" > "$TMP/other-home/init.d/a.gradle"; run
[ "$status" = 0 ] && grep -q "^GRADLE_USER_HOME=$TMP/home/.gradle$" "$RECORD" && ! grep -q 'other-home' "$RECORD" && ok "a Gradle user home named by a JVM option is not used" || { bad "a Gradle user home named by a JVM option is not used (status $status)"; cat "$TMP/log"; }
export_dir; run GRADLE_USER_HOME=relative/home
[ "$status" = 1 ] && [ ! -e "$RECORD" ] && ok "a Gradle user home that is not an absolute path stops the build" || bad "a relative Gradle user home stops the build (status $status)"

# The user's gradle.properties is reported by its path only: a value continued over lines (Java properties
# allow that) would otherwise show as a key.
export_dir; printf 'org.gradle.jvmargs=-Xmx4g\nsecretToken=first-part \\\n    continued=do-not-print\n' > "$TMP/home/.gradle/gradle.properties"; run
[ "$status" = 0 ] && grep -q "$TMP/home/.gradle/gradle.properties" "$TMP/log" && ! grep -Eq 'do-not-print|first-part|continued|secretToken' "$TMP/log" && ok "the user's gradle.properties is named by its path, nothing of its content is shown" || { bad "the user's gradle.properties is named by its path only"; cat "$TMP/log"; }
# A value of several lines whose second line looks like NAME=value: only real names are listed, no part of a value.
export_dir; run "MULTI_LINE=first
SECOND_LINE_SECRET=do-not-print"
[ "$status" = 0 ] && grep -q 'MULTI_LINE' "$TMP/log" && ! grep -Eq 'SECOND_LINE_SECRET|do-not-print' "$TMP/log" && ! grep -Eq 'SECOND_LINE_SECRET|do-not-print' "$RECORD" && ok "a value of several lines is neither shown nor passed, and its lines are not taken for names" || { bad "a value of several lines is neither shown nor passed"; cat "$TMP/log"; }

# A rebuild that only compares bytes leaves out the Crashlytics mapping upload, and only that; nothing else passes.
export_dir; WRAPPER_ARGS=--without-crashlytics-upload; run; WRAPPER_ARGS=
[ "$status" = 0 ] && grep -q "^ARGS --no-daemon --no-build-cache --gradle-user-home $TMP/home/.gradle assembleRelease -x :app:uploadCrashlyticsMappingFileRelease\$" "$RECORD" && ok "--without-crashlytics-upload excludes the mapping upload task" || { bad "--without-crashlytics-upload (status $status)"; cat "$TMP/log"; head -1 "$RECORD" 2>/dev/null; }
for extra in "-PversionCode=1" "--without-crashlytics-upload -Pother=1" "assembleDebug"; do
    export_dir; WRAPPER_ARGS=$extra; run; WRAPPER_ARGS=
    [ "$status" = 2 ] && grep -q "usage" "$TMP/log" && [ ! -e "$RECORD" ] && ok "refuses the argument $extra" || { bad "refuses the argument $extra (status $status)"; cat "$TMP/log"; }
done

export_dir; rm "$TMP/export/CANDIDATE"; run
[ "$status" = 1 ] && grep -q "not an export" "$TMP/log" && [ ! -e "$RECORD" ] && ok "refuses to build outside an export" || { bad "refuses to build outside an export (status $status)"; cat "$TMP/log"; }
export_dir; mkdir "$TMP/export/.git"; run
[ "$status" = 1 ] && grep -q "not an export" "$TMP/log" && [ ! -e "$RECORD" ] && ok "refuses to build in a checkout" || bad "refuses to build in a checkout (status $status)"
exit $failed
