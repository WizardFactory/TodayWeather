#!/bin/sh
# Checks require-candidate.sh in Git repositories made for the test: it passes only for the named commit with
# nothing in the checkout that Git does not account for. Needs no device and no network.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
failed=0
# A repository with the release tool, an ignored private input and two commits; prints the head's SHA.
repository() {
    rm -rf "$TMP/repo"
    mkdir -p "$TMP/repo/android/tools/release" "$TMP/repo/android/app/src/main"
    cp "$HERE/require-candidate.sh" "$TMP/repo/android/tools/release/"
    cd "$TMP/repo"
    git init -q -b master
    printf 'private.properties\napp/google-services.json\n*.secret\n' > android/.gitignore
    echo one > android/app/src/main/App.kt
    git add -A && git commit -q -m one
    echo two > android/app/src/main/App.kt
    git commit -q -am two
    echo "TW_SERVER_URL=x" > android/private.properties     # ignored private inputs do not count
    echo "{}" > android/app/google-services.json
}
check() { # name, expected status, candidate
    status=0
    sh android/tools/release/require-candidate.sh "$3" > "$TMP/log" 2>&1 || status=$?
    if [ "$status" = "$2" ]; then echo "ok   $1"; else echo "FAIL $1: status $status, want $2"; cat "$TMP/log"; failed=1; fi
}
repository; head=$(git rev-parse HEAD)
check "the candidate, clean, with ignored private inputs" 0 "$head"
check "another commit" 1 "$(git rev-parse HEAD~1)"
check "a short SHA" 2 "$(git rev-parse --short HEAD)"
check "a branch name" 2 master
repository; echo three > android/app/src/main/App.kt
check "a changed tracked file" 1 "$head"
repository; echo x > android/app/src/main/Stray.kt
check "an untracked source file" 1 "$head"
repository; echo x > android/app/src/main/Stray.kt; git config status.showUntrackedFiles no
check "an untracked source file hidden by status.showUntrackedFiles" 1 "$head"
repository; echo three > android/app/src/main/App.kt; git update-index --assume-unchanged android/app/src/main/App.kt
check "a changed file marked assume-unchanged" 1 "$head"
repository; echo three > android/app/src/main/App.kt; git update-index --skip-worktree android/app/src/main/App.kt
check "a changed file marked skip-worktree" 1 "$head"
repository; echo x > android/app/src/main/Hidden.secret
check "an ignored file inside a source set" 1 "$head"
repository; echo staged > android/app/src/main/App.kt; git add android/app/src/main/App.kt
check "a staged change" 1 "$head"
# git status itself fails: a git that refuses `status` and passes everything else on
repository
mkdir "$TMP/bin"
real=$(command -v git)
printf '#!/bin/sh\ncase " $* " in *" status "*) exit 128 ;; esac\nexec "%s" "$@"\n' "$real" > "$TMP/bin/git"
chmod +x "$TMP/bin/git"
PATH="$TMP/bin:$PATH" check "git status fails" 1 "$head"
# It checks the checkout it is part of, wherever it is called from.
repository; echo x > android/app/src/main/Stray.kt
cd "$TMP"
status=0; sh "$TMP/repo/android/tools/release/require-candidate.sh" "$head" > /dev/null 2>&1 || status=$?
if [ "$status" = 1 ]; then echo "ok   called from another directory"; else echo "FAIL called from another directory: status $status"; failed=1; fi
exit $failed
