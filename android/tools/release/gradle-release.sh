#!/bin/sh
# Builds the release in an export of the candidate (docs/operations/android-release.md, step 4):
#   cd <export>/android && tools/release/gradle-release.sh
# The build's inputs are the export's files and nothing of the caller's shell. app/build.gradle.kts reads each
# private input from the environment before android/private.properties, so a variable left in the shell would
# replace the reviewed value: every TW_* and ORG_GRADLE_PROJECT_* variable and the JVM option variables are removed
# for the build, and named. A Gradle init script in the Gradle user home runs in every build and can change it:
# with one present the build does not start. The keys of the user's gradle.properties are named for the build
# record; their values are not shown. The wrapper runs only where export_candidate.py wrote CANDIDATE and never in
# a checkout. It runs ./gradlew --no-daemon --no-build-cache assembleRelease and ends with its status.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ANDROID=$(cd "$HERE/../.." && pwd)
EXPORT=$(cd "$ANDROID/.." && pwd)
refuse() { echo "no release build: $*" >&2; exit 1; }
[ -f "$EXPORT/CANDIDATE" ] && [ ! -e "$EXPORT/.git" ] || refuse "$EXPORT is not an export of export_candidate.py"
GRADLE_HOME_DIR=${GRADLE_USER_HOME:-$HOME/.gradle}
for script in "$GRADLE_HOME_DIR"/init.gradle "$GRADLE_HOME_DIR"/init.gradle.kts "$GRADLE_HOME_DIR"/init.d/*; do
    [ -e "$script" ] && refuse "the Gradle init script $script would run in the release build; move it away for the build"
done
if [ -f "$GRADLE_HOME_DIR/gradle.properties" ]; then
    echo "Gradle user properties in effect ($GRADLE_HOME_DIR/gradle.properties): $(sed -n 's/^[[:space:]]*\([A-Za-z0-9_.-]*\)[[:space:]]*[=:].*/\1/p' "$GRADLE_HOME_DIR/gradle.properties" | tr '\n' ' ')"
fi
removed=$(env | grep -Eo '^(TW_|ORG_GRADLE_PROJECT_)[A-Za-z0-9_]*' || true)
for name in GRADLE_OPTS JAVA_OPTS JAVA_TOOL_OPTIONS _JAVA_OPTIONS; do
    if env | grep -q "^$name="; then removed="$removed $name"; fi
done
set --
for name in $removed; do set -- "$@" -u "$name"; done
[ -z "$removed" ] || echo "removed from the build's environment: $(echo $removed)"
echo "building $(cat "$EXPORT/CANDIDATE") in $ANDROID"
cd "$ANDROID"
exec env "$@" ./gradlew --no-daemon --no-build-cache assembleRelease
