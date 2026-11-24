#!/bin/sh
# Builds the release in an export of the candidate (docs/operations/android-release.md, step 4):
#   cd <export>/android && tools/release/gradle-release.sh [--without-crashlytics-upload]
# The build's inputs are the export's files and nothing of the caller's shell. app/build.gradle.kts reads each
# private input from the environment before android/private.properties, and JVM option variables can redirect
# Gradle itself, so Gradle starts with a new environment that holds the variables listed below and no other:
# whatever else the shell has (TW_*, ORG_GRADLE_PROJECT_*, GRADLE_OPTS, JAVA_TOOL_OPTIONS, JDK_JAVA_OPTIONS, ...)
# does not reach the build. A Gradle init script in the Gradle user home runs in every build and can change it:
# with one present the build does not start, and the home that was inspected is the home Gradle is given, as
# GRADLE_USER_HOME and --gradle-user-home. The names kept from the build are printed for the build record, and
# the path of the user's gradle.properties when there is one; no value and nothing of that file is shown. The wrapper runs only where
# export_candidate.py wrote CANDIDATE and never in a checkout. It runs
# ./gradlew --no-daemon --no-build-cache --gradle-user-home <home> assembleRelease and ends with its status.
# With app/google-services.json the Crashlytics plugin uploads R8's mapping to Firebase after R8, under a new random
# mapping ID. A release build keeps that upload. A rebuild that only compares bytes with a shipped APK (the runbook's
# "Recording a release built outside the runbook") must not upload a mapping that no shipped APK names, and passes
# --without-crashlytics-upload, which adds -x :app:uploadCrashlyticsMappingFileRelease; no other argument is accepted.
set -eu
# The variables Gradle gets, when the shell has them: where things are and how text is encoded. A build that
# needs another one (a proxy, for instance) adds it here in a reviewed change.
PASSED="HOME PATH USER LOGNAME LANG LC_ALL LC_CTYPE TMPDIR TERM ANDROID_HOME ANDROID_SDK_ROOT JAVA_HOME"
HERE=$(cd "$(dirname "$0")" && pwd)
ANDROID=$(cd "$HERE/../.." && pwd)
EXPORT=$(cd "$ANDROID/.." && pwd)
refuse() { echo "no release build: $*" >&2; exit 1; }
EXCLUDE=""
if [ $# -eq 1 ] && [ "$1" = --without-crashlytics-upload ]; then EXCLUDE=":app:uploadCrashlyticsMappingFileRelease"
elif [ $# -ne 0 ]; then echo "usage: gradle-release.sh [--without-crashlytics-upload]" >&2; exit 2
fi
[ -f "$EXPORT/CANDIDATE" ] && [ ! -e "$EXPORT/.git" ] || refuse "$EXPORT is not an export of export_candidate.py"
GRADLE_HOME_DIR=${GRADLE_USER_HOME:-$HOME/.gradle}
case "$GRADLE_HOME_DIR" in /*) ;; *) refuse "the Gradle user home must be an absolute path, not '$GRADLE_HOME_DIR'" ;; esac
for script in "$GRADLE_HOME_DIR"/init.gradle "$GRADLE_HOME_DIR"/init.gradle.kts "$GRADLE_HOME_DIR"/init.d/*; do
    [ -e "$script" ] && refuse "the Gradle init script $script would run in the release build; move it away for the build"
done
# Its content is not read here: a value can continue over lines and would show as a key.
if [ -f "$GRADLE_HOME_DIR/gradle.properties" ]; then
    echo "the user's Gradle properties apply to the build: read $GRADLE_HOME_DIR/gradle.properties before trusting it"
fi
# Every name of the shell's environment that is not passed on, for the record. awk has the environment as names
# and values; the text of `env` would show the later lines of a value of several lines as names.
kept_out=$(awk -v passed=" $PASSED GRADLE_USER_HOME " 'BEGIN { for (name in ENVIRON) if (index(passed, " " name " ") == 0) printf "%s ", name }')
set -- "GRADLE_USER_HOME=$GRADLE_HOME_DIR"
for name in $PASSED; do
    eval "value=\${$name-}"
    [ -z "$value" ] || set -- "$@" "$name=$value"
done
echo "passed to Gradle: GRADLE_USER_HOME $PASSED"
echo "kept from Gradle: ${kept_out:-nothing}"
echo "building $(cat "$EXPORT/CANDIDATE") in $ANDROID with the Gradle user home $GRADLE_HOME_DIR"
cd "$ANDROID"
[ -z "$EXCLUDE" ] || echo "without the Crashlytics mapping upload: -x $EXCLUDE"
exec env -i "$@" ./gradlew --no-daemon --no-build-cache --gradle-user-home "$GRADLE_HOME_DIR" assembleRelease \
    ${EXCLUDE:+-x "$EXCLUDE"}
