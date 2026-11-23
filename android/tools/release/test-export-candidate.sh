#!/bin/sh
# Checks export-candidate.sh in a Git repository made for the test. The export must be the commit's android/ tree
# and nothing else, whatever the checkout looks like: the checkout here has a changed file, a staged change, an
# untracked file, ignored files (one with a non-ASCII name and one with a quote in its name), a file hidden by an
# index flag and status.showUntrackedFiles=no. The oracle is Git's own tree hash of the exported files.
# Needs no device and no network.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
failed=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; failed=1; }
# The Git tree hash of the android/ directory under $1, computed in a repository of its own.
tree_of() {
    rm -rf "$TMP/oracle"
    GIT_DIR="$TMP/oracle" git init -q
    GIT_DIR="$TMP/oracle" GIT_WORK_TREE="$1" git add -A -f . > /dev/null
    GIT_DIR="$TMP/oracle" git rev-parse "$(GIT_DIR="$TMP/oracle" git write-tree):android"
}

REPO=$TMP/repo
mkdir -p "$REPO/android/tools/release" "$REPO/android/app/src/main" "$REPO/client"
cp "$HERE/export-candidate.sh" "$REPO/android/tools/release/"
cd "$REPO"
git init -q -b master
printf 'private.properties\napp/google-services.json\nbuild/\n*.secret\nIgnored*.kt\n' > android/.gitignore
echo one > android/app/src/main/App.kt
echo korean > "android/app/src/main/날씨.kt"
printf '#!/bin/sh\n' > android/gradlew
chmod +x android/gradlew
echo other > client/app.js
git add -A && git commit -q -m one
first=$(git rev-parse HEAD)
echo two > android/app/src/main/App.kt
echo kept > android/app/src/main/Kept.kt
git add -A && git commit -q -m two
head=$(git rev-parse HEAD)
# Everything a checkout can hold that is not the commit.
echo changed > android/app/src/main/App.kt
echo staged > android/gradlew && git add android/gradlew
echo x > android/app/src/main/Stray.kt
echo x > android/app/src/main/Ignored.kt
echo x > "android/app/src/main/Ignored한글.kt"
echo x > 'android/app/src/main/Ignored"quote.kt'
echo x > android/private.properties
mkdir -p android/app/build && echo x > android/app/build/Generated.class
echo hidden > android/app/src/main/Kept.kt && git update-index --assume-unchanged android/app/src/main/Kept.kt
git config status.showUntrackedFiles no

export_to() { # commit, directory; status in $status, output in $TMP/log
    status=0
    sh android/tools/release/export-candidate.sh "$1" "$2" > "$TMP/log" 2>&1 || status=$?
}
export_to "$head" "$TMP/out"
if [ "$status" = 0 ] && grep -q "exported $head" "$TMP/log"; then ok "exports the commit"; else bad "exports the commit (status $status)"; cat "$TMP/log"; fi
[ "$(tree_of "$TMP/out")" = "$(git rev-parse "$head:android")" ] && ok "the export is the commit's android/ tree" || bad "the export is the commit's android/ tree"
[ "$(cat "$TMP/out/android/app/src/main/App.kt")" = two ] && ok "a changed file is exported as committed" || bad "a changed file is exported as committed"
[ "$(cat "$TMP/out/android/app/src/main/Kept.kt")" = kept ] && ok "a file hidden by an index flag is exported as committed" || bad "a file hidden by an index flag is exported as committed"
[ -x "$TMP/out/android/gradlew" ] && [ "$(cat "$TMP/out/android/gradlew")" = '#!/bin/sh' ] && ok "a staged change is not exported, the mode is kept" || bad "a staged change is not exported, the mode is kept"
[ -f "$TMP/out/android/app/src/main/날씨.kt" ] && ok "a tracked file with a non-ASCII name is exported" || bad "a tracked file with a non-ASCII name is exported"
extra=$(cd "$TMP/out" && find . \( -name 'Stray*' -o -name 'Ignored*' -o -name private.properties -o -name build -o -name client \) | head -n 1)
[ -z "$extra" ] && ok "nothing untracked, ignored or outside android/ is exported" || bad "exported $extra"
[ "$(cat "$TMP/out/CANDIDATE")" = "$head" ] && ok "the export names its commit" || bad "the export names its commit"

export_to "$first" "$TMP/out-first"
[ "$status" = 0 ] && [ "$(cat "$TMP/out-first/android/app/src/main/App.kt")" = one ] && [ ! -e "$TMP/out-first/android/app/src/main/Kept.kt" ] \
    && [ "$(tree_of "$TMP/out-first")" = "$(git rev-parse "$first:android")" ] && ok "an earlier commit is exported as it was" || bad "an earlier commit is exported as it was"

refuses() { # name, expected status, pattern, commit, directory
    export_to "$4" "$5"
    if [ "$status" = "$2" ] && grep -Eq "$3" "$TMP/log"; then ok "$1"; else bad "$1: status $status (want $2), output:"; cat "$TMP/log"; fi
}
refuses "a short SHA" 2 "full 40-character SHA" "$(git rev-parse --short HEAD)" "$TMP/o1"
refuses "a branch name" 2 "full 40-character SHA" master "$TMP/o2"
refuses "a commit the repository does not have" 1 "no commit" 0123456789012345678901234567890123456789 "$TMP/o3"
[ ! -e "$TMP/o3" ] && ok "a refused export leaves no directory" || bad "a refused export leaves no directory"
mkdir "$TMP/used" && echo x > "$TMP/used/file"
refuses "a directory that is not empty" 1 "not empty" "$head" "$TMP/used"
refuses "a directory inside the checkout" 1 "outside the checkout" "$head" "$REPO/export"
# An export that is not the commit's tree is refused: export-ignore makes git archive leave a tracked file out.
echo 'app/src/main/Kept.kt export-ignore' > android/.gitattributes
git add android/.gitattributes && git commit -q -m "attributes"
refuses "an export that differs from the commit's tree" 1 "is not the tree of" "$(git rev-parse HEAD)" "$TMP/o4"
exit $failed
