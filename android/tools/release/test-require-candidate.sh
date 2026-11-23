#!/bin/sh
# Checks require-candidate.sh in Git repositories made for the test: it passes only for the named commit with
# nothing in the checkout that Git does not account for, and refuses each other state for its own reason. Every
# case makes a new repository and names that repository's own head, so a refusal cannot come from the SHA when
# the case is about something else. Needs no device and no network.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
REAL_GIT=$(command -v git)
failed=0
count=0
# A new repository with the release tool, ignore rules, ignored private inputs and two commits. Sets $head.
repository() {
    count=$((count + 1))
    REPO=$TMP/repo-$count
    mkdir -p "$REPO/android/tools/release" "$REPO/android/app/src/main" "$REPO/android/app/build"
    cp "$HERE/require-candidate.sh" "$REPO/android/tools/release/"
    cd "$REPO"
    git init -q -b master
    printf 'private.properties\napp/google-services.json\nbuild/\n*.secret\nIgnored.kt\n' > android/.gitignore
    echo one > android/app/src/main/App.kt
    git add -A
    # A different commit in every repository, whatever the clock says.
    GIT_AUTHOR_DATE="2026-01-01T00:00:0$((count % 10))Z" GIT_COMMITTER_DATE="2026-01-01T00:0$((count % 10)):00Z" git commit -q -m "one $count"
    echo two > android/app/src/main/App.kt
    git commit -q -am "two $count"
    echo "TW_SERVER_URL=x" > android/private.properties     # ignored private inputs and build output do not count
    echo "{}" > android/app/google-services.json
    echo class > android/app/build/Generated.class
    head=$(git rev-parse HEAD)
}
# name, expected status, candidate, a pattern the output must match
check() {
    status=0
    sh android/tools/release/require-candidate.sh "$3" > "$TMP/log" 2>&1 || status=$?
    if [ "$status" = "$2" ] && grep -Eq "$4" "$TMP/log"; then
        echo "ok   $1"
    else
        echo "FAIL $1: status $status (want $2), output not matching '$4':"; cat "$TMP/log"; failed=1
    fi
}
repository
check "the candidate, clean, with ignored private inputs and build output" 0 "$head" "the checkout is the candidate $head"
check "another commit" 1 "$(git rev-parse HEAD~1)" "HEAD is $head, the candidate is"
check "a short SHA" 2 "$(git rev-parse --short HEAD)" "full 40-character SHA"
check "a branch name" 2 master "full 40-character SHA"
repository; echo three > android/app/src/main/App.kt
check "a changed tracked file" 1 "$head" "differs from the commit"
repository; echo staged > android/app/src/main/App.kt; git add android/app/src/main/App.kt
check "a staged change" 1 "$head" "differs from the commit"
repository; echo x > android/app/src/main/Stray.kt
check "an untracked source file" 1 "$head" "differs from the commit"
repository; echo x > android/app/src/main/Stray.kt; git config status.showUntrackedFiles no
check "an untracked source file hidden by status.showUntrackedFiles" 1 "$head" "differs from the commit"
repository; echo three > android/app/src/main/App.kt; git update-index --assume-unchanged android/app/src/main/App.kt
check "a changed file marked assume-unchanged" 1 "$head" "hidden from git status by an index flag"
repository; echo three > android/app/src/main/App.kt; git update-index --skip-worktree android/app/src/main/App.kt
check "a changed file marked skip-worktree" 1 "$head" "hidden from git status by an index flag"
repository; echo x > android/app/src/main/Ignored.kt
check "an ignored source file" 1 "$head" "ignored files in a source set.*"
grep -q "android/app/src/main/Ignored.kt" "$TMP/log" || { echo "FAIL the ignored source file is not named"; failed=1; }
repository; mkdir -p android/app/src/main/res/raw; echo x > android/app/src/main/res/raw/deep.secret
check "an ignored file deep in a source set" 1 "$head" "ignored files in a source set"
repository; mkdir -p android/core-data/src/test; echo x > android/core-data/src/test/Ignored.kt
check "an ignored file in another module's source set" 1 "$head" "ignored files in a source set"
repository; echo x >> .git/info/exclude; echo "android/app/src/main/Local.kt" >> .git/info/exclude; echo x > android/app/src/main/Local.kt
check "a source file ignored by .git/info/exclude" 1 "$head" "ignored files in a source set"
# git status itself fails: a git that refuses `status` and passes everything else on
repository
mkdir -p "$TMP/bin"
printf '#!/bin/sh\ncase " $* " in *" status "*) exit 128 ;; esac\nexec "%s" "$@"\n' "$REAL_GIT" > "$TMP/bin/git"
chmod +x "$TMP/bin/git"
# In a subshell: an assignment before a function call would stay in this shell.
( PATH="$TMP/bin:$PATH"; check "git status fails" 1 "$head" "git status failed"; exit $failed ) || failed=1
# It checks the checkout it is part of, wherever it is called from.
repository; echo x > android/app/src/main/Stray.kt
cd "$TMP"
status=0; sh "$REPO/android/tools/release/require-candidate.sh" "$head" > "$TMP/log" 2>&1 || status=$?
if [ "$status" = 1 ] && grep -q "differs from the commit" "$TMP/log"; then echo "ok   called from another directory"; else echo "FAIL called from another directory: status $status"; cat "$TMP/log"; failed=1; fi
exit $failed
