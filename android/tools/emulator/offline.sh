# Sourced by emulator tools that install the Cordova build or this build (run-upgrade-test.sh,
# chart-reference/capture.sh). The emulator stays offline while either app is installed, so neither
# gets an FCM token or reaches the production server:
#   . "$HERE/../emulator/offline.sh"
#   emulator_guard                 # refuses anything but a running emulator
#   trap offline_cleanup EXIT; trap 'exit 130' INT TERM
#   go_offline                     # before the first install
# On every exit offline_cleanup runs the optional function named in $CLEANUP_HOOK, uninstalls both
# packages and restores the network only when the package query succeeds with a complete list that has
# neither package; otherwise it exits 5 and the device stays offline. online_cleanup is the same check for a
# run that needs the network: when the removal cannot be confirmed it takes the device offline and exits 5.
PKG=net.wizardfactory.todayweather

# Runs `adb shell am instrument -w -r` with the arguments after $1, writes its output to file $1 and shows it.
# adb's status goes to INSTRUMENT_STATUS for instrumentation_passed; the function itself succeeds, so a runner can
# still collect what a failed test left on the device before it decides.
instrument() {
    instrument_file=$1
    shift
    INSTRUMENT_STATUS=0
    adb shell am instrument -w -r "$@" > "$instrument_file" || INSTRUMENT_STATUS=$?
    cat "$instrument_file"
}

# Whether an instrumentation passed: adb's status $3 is 0, and the `am instrument -w -r` output in file $1 shows
# $2 passed tests and nothing else: no failed, crashed, ignored or assumption-skipped test (the plain
# `OK (N tests)` line counts a skipped test as run), and an instrumentation that finished. Raw status per test:
# 1 started, 0 passed, -1 error, -2 failure, -3 ignored, -4 assumption not met.
instrumentation_passed() {
    [ "${3:?pass the status of adb}" = 0 ] || return 1
    [ "$(tr -d '\r' < "$1" | grep -c '^INSTRUMENTATION_STATUS_CODE: 0$')" = "$2" ] || return 1
    if tr -d '\r' < "$1" | grep -q '^INSTRUMENTATION_STATUS_CODE: -'; then return 1; fi
    tr -d '\r' < "$1" | grep -q '^INSTRUMENTATION_CODE: -1$'
}

emulator_guard() {
    case "${ANDROID_SERIAL:-}" in emulator-[0-9]*) ;; *) echo "Set ANDROID_SERIAL to an emulator" >&2; exit 2 ;; esac
    [ "$(adb get-state 2>/dev/null)" = device ] || { echo "No device $ANDROID_SERIAL" >&2; exit 2; }
}

# Airplane mode on (1) or off (0): `cmd connectivity` on API 29+, which prints nothing on success; older
# images answer "No shell command implementation." with exit status 0 and need the setting and broadcast
# (with `adb root`).
airplane() {
    if [ -n "$(adb shell cmd connectivity airplane-mode "$([ "$1" = 1 ] && echo enable || echo disable)" 2>&1)" ]; then
        adb root >/dev/null 2>&1 || true; adb wait-for-device
        adb shell settings put global airplane_mode_on "$1"
        adb shell am broadcast -a android.intent.action.AIRPLANE_MODE --ez state "$([ "$1" = 1 ] && echo true || echo false)" >/dev/null
    fi
}

# Airplane mode plus Wi-Fi and data off; exits 3 if a default network is still active after half a minute.
go_offline() {
    airplane 1
    adb shell svc wifi disable || true
    adb shell svc data disable || true
    sleep 3
    # A device that just booted can take longer to drop its network (a hosted tablet emulator did): look again
    # for half a minute before refusing.
    waited=0
    until adb shell dumpsys connectivity | grep -q "Active default network: none"; do
        waited=$((waited + 1))
        [ "$waited" -lt 10 ] || { echo "The emulator still has a network; refusing to install the apps" >&2; exit 3; }
        sleep 3
    done
}

# Whether both packages are gone: the package query succeeds, its whole answer is a package list with the
# framework package, and it lists neither package; anything else counts as still installed.
packages_removed() {
    packages=$(adb shell pm list packages 2>/dev/null) || return 1
    packages=$(printf '%s\n' "$packages" | tr -d '\r' | sed '/^$/d')
    if printf '%s\n' "$packages" | grep -qv "^package:" || ! printf '%s\n' "$packages" | grep -qx "package:android"; then
        return 1
    fi
    ! printf '%s\n' "$packages" | grep -Eqx "package:$PKG(\.test)?"
}

offline_cleanup() {
    status=$?
    trap - EXIT INT TERM
    set +e
    [ -n "${CLEANUP_HOOK:-}" ] && "$CLEANUP_HOOK"
    adb uninstall $PKG.test >/dev/null 2>&1
    adb uninstall $PKG >/dev/null 2>&1
    # The network comes back only when both packages are confirmed gone.
    if ! packages_removed; then
        echo "cleanup: cannot confirm that $PKG is uninstalled; the emulator stays offline" >&2
        exit 5
    fi
    airplane 0
    adb shell svc wifi enable
    adb shell svc data enable
    exit $status
}

# For a run that needs the network (run-production-weather.sh): on every exit both packages are uninstalled,
# and when that cannot be confirmed the emulator goes offline and the script exits 5, so a build with the
# production configuration never stays on an online device.
online_cleanup() {
    status=$?
    trap - EXIT INT TERM
    set +e
    adb uninstall $PKG.test >/dev/null 2>&1
    adb uninstall $PKG >/dev/null 2>&1
    if ! packages_removed; then
        echo "cleanup: cannot confirm that $PKG is uninstalled; the emulator goes offline" >&2
        airplane 1
        adb shell svc wifi disable
        adb shell svc data disable
        exit 5
    fi
    exit $status
}
