#!/usr/bin/env python3
"""Host-side checks of run-handback-test.sh (IN-17, #2966): the suite, the fallback Cordova build's reports, crashes,
the Firebase SDK's event counters and the result bundles.

    check_handback.py suite      <group-container> <out-json> <writer> [min-generation]
                                 the suite's values (strings as stored) once its file holds a complete marker by <writer>
                                 of at least that generation
    check_handback.py marker     <suite-json>                             prints the marker's generation
    check_handback.py measure    <data-container> <out-json>              the Firebase SDK's event counters
    check_handback.py tests      <out> <step> <xcresult> <test-name>      HandBackUpgradeTests/<test-name> passed
    check_handback.py check      <out> <report> <suite-json> <expected-json>
    check_handback.py edit       <out> <report>
    check_handback.py withdraw   <out> <report>
    check_handback.py crashes    <out> <stage> <udid> <since-epoch>       no crash report of the app on this simulator
    check_handback.py events     <out> <stage> <data-container> <before-json> [<after-json>]
    check_handback.py console    <out> <stage> <console-log>              the SDK logged no event in that launch
    check_handback.py requests   <out>                                    nothing left the Mac (check_upgrade.requests)

Every check appends to <out>/summary.json; a failed check exits 1.
"""
import glob
import json
import os
import plistlib
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_upgrade  # noqa: E402

KEYS = check_upgrade.HANDBACK_KEYS
MARKER = check_upgrade.HANDBACK_MARKER


def suite_values(group, out, writer, minimum):
    path = os.path.join(group, "Library/Preferences/group.net.wizardfactory.todayweather.plist")
    # cfprefsd writes the file some time after the app changed the suite: wait until the file holds the marker the last
    # step wrote, at most 90 s; a file that never does fails.
    for _ in range(90):
        values = check_upgrade.plist(path)
        marker = check_upgrade.handback_marker(values) or {}
        if marker.get("complete") is True and marker.get("writer") == writer and marker.get("generation", 0) >= minimum:
            break
        time.sleep(1)
    else:
        sys.exit(f"the suite file holds no complete {writer} marker of generation {minimum} or later: {marker}")
    with open(out, "w") as f:
        json.dump({k: v if isinstance(v, (str, int, float, bool)) else repr(v) for k, v in values.items()}, f,
                  ensure_ascii=False, indent=1)


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def report(out, name):
    path = os.path.join(out, "recorder", name + ".json")
    return load(path) if os.path.exists(path) else None


def same(c, what, actual, expected):
    c.check(what, json.dumps(actual, ensure_ascii=False) == json.dumps(expected, ensure_ascii=False), [actual, expected])


def check(c, out, name, suite_path, expected_json):
    """The fallback build shows the state the native app handed back (the suite pulled before it started), applied it
    once and claimed it."""
    suite = load(suite_path)
    expected = json.loads(expected_json)
    r = report(out, name) or {}
    c.check("the fallback build reported", "result" in r, r.get("error"))
    seen = r.get("result") or {}
    handed = json.loads(suite[MARKER])
    same(c, "hand-back marker", [handed.get("schema"), handed.get("writer"), handed.get("complete"), handed.get("keys")],
         [1, "native", True, KEYS])
    c.record(name, seen)
    cities = [[x.get("name") or None, x.get("address") or None, x.get("location") or None, bool(x.get("disable"))]
              for x in json.loads(suite["cities"])]
    same(c, "places", [[x["name"], x["address"], x["location"], x["disable"]] for x in seen.get("cities", [])], cities)
    same(c, "place names", [x["name"] for x in seen.get("cities", [])], expected["names"])
    same(c, "selected place", seen.get("cityIndex"), int(suite["cityIndex"]))
    same(c, "expected selection", seen.get("cityIndex"), expected["index"])
    same(c, "units", seen.get("units"), json.loads(suite["units"]))
    same(c, "temperature unit", (seen.get("units") or {}).get("temperatureUnit"), expected["temperatureUnit"])
    same(c, "settings", seen.get("settingsInfo"), json.loads(suite["settingsInfo"]))
    same(c, "theme", (seen.get("settingsInfo") or {}).get("theme"), expected["theme"])
    push = json.loads(suite["pushData2"])
    same(c, "alarms and alerts", seen.get("pushList"), push["pushList"])
    same(c, "FCM token", seen.get("fcmToken"), push["fcmToken"])
    same(c, "analytics choice", seen.get("choice"), expected["consent"])
    same(c, "legacy alarms", (seen.get("local") or {}).get("pushData"), None)
    same(c, "applied generation", seen.get("applied"), str(handed["generation"]))
    claim = json.loads(seen["marker"]) if isinstance(seen.get("marker"), str) else seen.get("marker") or {}
    same(c, "claim", [claim.get("schema"), claim.get("generation"), claim.get("writer"), claim.get("complete"), claim.get("keys")],
         [1, handed["generation"] + 1, "cordova", True, KEYS])
    same(c, "the fallback build's origin", seen.get("origin"), "app://localhost")
    # The stored texts: equal to the hand-back unless the app rewrote a key at its start (listed for the record).
    c.record(name + "-rewritten", [{"key": k, "handed": suite.get(k), "stored": (seen.get("local") or {}).get(k)}
                                   for k in KEYS if (seen.get("local") or {}).get(k) != suite.get(k)])


def edit(c, out, name):
    r = report(out, name) or {}
    c.check("the fallback build reported its edits", "result" in r, r.get("error"))
    result = r.get("result") or {}
    c.record(name, result)
    same(c, "choice saved", result.get("saved"), True)
    same(c, "analytics choice", result.get("choice"), True)
    same(c, "mirrored choice", result.get("mirrored"), "true")
    same(c, "places", result.get("places"), 3)
    same(c, "selected place", result.get("cityIndex"), 2)


def withdraw(c, out, name):
    r = report(out, name) or {}
    c.check("the fallback build reported the withdrawal", "result" in r, r.get("error"))
    result = r.get("result") or {}
    c.record(name, result)
    same(c, "choice saved", result.get("saved"), True)
    same(c, "analytics choice", result.get("choice"), False)
    same(c, "stored choice", result.get("stored"), "false")
    same(c, "mirrored choice", result.get("mirrored"), "false")


def crashes(c, udid, since):
    found = []
    for path in glob.glob(os.path.expanduser("~/Library/Logs/DiagnosticReports/TodayWeather*")):
        if os.path.getmtime(path) < since:
            continue
        with open(path, encoding="utf-8", errors="replace") as f:
            if udid in f.read():
                found.append(os.path.basename(path))
    c.check("no crash report of the app on this simulator", not found, found)


def events(c, data, before_path, after_path=None):
    before = load(before_path)
    m = check_upgrade.measurement(data)
    if after_path:
        with open(after_path, "w") as f:
            json.dump(m, f, indent=1)
    c.record("measurement_before", before)
    c.record("measurement", m)
    before_events = (before or {}).get("events") or {}
    grown = {n: [before_events.get(n), v] for n, v in ((m or {}).get("events") or {}).items()
             if before_events.get(n) is None or v[0] != before_events[n][0]}
    c.check("no event counted in the fallback build's start", m is not None and not grown, grown)


def console(c, path):
    lines = [line for line in open(path, encoding="utf-8", errors="replace").read().splitlines()
             if "Firebase" in line or "I-ACS" in line or "Analytics" in line]
    c.record("firebase_console_lines", lines[:60])
    c.record("debug_logging_on", any("To disable debug logging" in line for line in lines))
    logged = [line for line in lines if "Logging event" in line or "Analytics collection enabled" in line]
    c.check("no event logged and collection never enabled in that launch", not logged, logged)


def main():
    stage = sys.argv[1]
    if stage == "suite":
        return suite_values(sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5]) if len(sys.argv) > 5 else 1)
    if stage == "measure":
        with open(sys.argv[3], "w") as f:
            json.dump(check_upgrade.measurement(sys.argv[2]), f, indent=1)
        return
    if stage == "marker":
        print(json.loads(load(sys.argv[2])[MARKER])["generation"])
        return
    out = sys.argv[2]
    if stage == "requests":
        c = check_upgrade.Checks(out, "requests")
        check_upgrade.requests(c, out)
        return c.finish()
    if stage == "tests":
        step, xcresult, name = sys.argv[3:6]
        c = check_upgrade.Checks(out, f"tests-{step}")
        results = check_upgrade.test_results(xcresult, "HandBackUpgradeTests")
        c.record("tests", results)
        c.check(f"{name} ran and passed", results.get(name) == "Passed", results.get(name))
        return c.finish()
    name = sys.argv[3]
    c = check_upgrade.Checks(out, f"{stage}-{name}")
    if stage == "check":
        check(c, out, name, sys.argv[4], sys.argv[5])
    elif stage == "edit":
        edit(c, out, name)
    elif stage == "withdraw":
        withdraw(c, out, name)
    elif stage == "crashes":
        crashes(c, sys.argv[4], float(sys.argv[5]))
    elif stage == "events":
        events(c, sys.argv[4], sys.argv[5], sys.argv[6] if len(sys.argv) > 6 else None)
    elif stage == "console":
        console(c, sys.argv[4])
    else:
        sys.exit(f"unknown stage {stage}")
    c.finish()


if __name__ == "__main__":
    main()
