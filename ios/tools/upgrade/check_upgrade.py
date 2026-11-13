#!/usr/bin/env python3
"""Host-side checks of run-upgrade-test.sh (simulator containers, Firebase SDK files, recorder log).

    check_upgrade.py dummy-plist <path>
    check_upgrade.py event-stored <data-container>
    check_upgrade.py tests-passed <out> <phase> <xcresult> [CordovaUpgradeTests|PushUpgradeTests]
    check_upgrade.py before <out> <data-container> <group-container> <localStorage|suite>
    check_upgrade.py after  <out> <data-container> <group-container> <localStorage|suite> <first|restart>
    check_upgrade.py final  <out> <data-container> <group-container> <localStorage|suite>
    check_upgrade.py push   <out> <data-container> <group-container> <localStorage|suite> <token-a|token-b>

The Firebase SDK files read here are internals of the SDK, observed on the iOS 26.5 simulator with
FirebaseAnalytics 13 (native) and FirebaseX 2.0 / Firebase 12.14 (Cordova):
- standard UserDefaults `/google/measurement/measurement_enabled_state`: 1 after setAnalyticsCollectionEnabled(true),
  2 after (false);
- `APMAnalyticsSuiteName` `consent_settings_3p`: the consent state;
- `Library/Application Support/Google/Measurement/google-app-measurement.sql`, table `events`: per event name the
  lifetime count and the last time it fired; table `raw_events`: events not yet bundled.
Every check appends to <out>/summary.json; a failed check exits 1.
"""
import glob
import hashlib
import json
import os
import plistlib
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlparse

# The TodayWeather hosts named in client/www and the legacy push/API path prefix. The test build's server URL is
# the recorder; a request for one of these hosts, or an API path for any host but this Mac, fails the test.
PRODUCTION_HOSTS = {"todayweather.wizardfactory.net", "tw-wzdfac.rhcloud.com",
                    "todayweather-wizardfactory.rhcloud.com", "todayweather.ai"}
LOCAL_HOSTS = {"127.0.0.1", "localhost"}
# The in-app tests that compare the migrated state with the seed (TodayWeatherTests/CordovaUpgradeTests.swift).
# They are skipped without the seed, so each must be reported as passed, not merely present.
UPGRADE_TESTS = ["migratedStateMatchesTheCordovaState()", "deviceIdIsTheCordovaValue()", "sourcesAreKept()",
                 "aSecondRunChangesNothing()", "analyticsIsOffAlthoughCordovaOptedIn()"]
# The push test (IN-04, TodayWeatherTests/PushUpgradeTests.swift), skipped without the token and the recorder.
SUITE_TESTS = {"CordovaUpgradeTests": UPGRADE_TESTS,
               "PushUpgradeTests": ["migratedAlarmsAndAlertsAreRegisteredAgain()"]}


def test_results(xcresult, suite="CordovaUpgradeTests"):
    """{test case name: result} of `suite` in an .xcresult (`xcresulttool`, Xcode 16+)."""
    out = subprocess.run(["xcrun", "xcresulttool", "get", "test-results", "tests", "--path", xcresult],
                         check=True, capture_output=True, text=True).stdout
    found = {}

    def walk(node, suites):
        if node.get("nodeType") == "Test Case" and suite in suites:
            found[node.get("name")] = node.get("result")
        for child in node.get("children", []):
            walk(child, suites + [node.get("name", "")])

    for node in json.loads(out).get("testNodes", []):
        walk(node, [])
    return found


def tests_passed(out, phase, xcresult, suite="CordovaUpgradeTests"):
    c = Checks(out, f"tests-{phase}")
    results = test_results(xcresult, suite)
    c.record("upgrade_tests", results)
    for name in SUITE_TESTS[suite]:
        c.check(f"{name} ran and passed", results.get(name) == "Passed", results.get(name))
    c.finish()


def dummy_plist(path):
    # A project that does not exist; the shapes pass FirebaseInstallations' checks (API key "A" + 38 characters,
    # app ID "1:<sender>:ios:<hex>").
    with open(path, "wb") as f:
        plistlib.dump({
            "API_KEY": "A" + "tw-in03-upgrade-test-not-a-real-key-00", "GCM_SENDER_ID": "000000000000",
            "PLIST_VERSION": "1", "BUNDLE_ID": "net.wizardfactory.todayweather",
            "PROJECT_ID": "tw-in03-upgrade-test-not-real", "STORAGE_BUCKET": "tw-in03-upgrade-test-not-real.invalid",
            "IS_ADS_ENABLED": False, "IS_ANALYTICS_ENABLED": False, "IS_APPINVITE_ENABLED": False,
            "IS_GCM_ENABLED": True, "IS_SIGNIN_ENABLED": False,
            "GOOGLE_APP_ID": "1:000000000000:ios:0000000000000000000000",
        }, f)
    assert len("A" + "tw-in03-upgrade-test-not-a-real-key-00") == 39


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def plist(path):
    if not os.path.exists(path):
        return {}
    with open(path, "rb") as f:
        return plistlib.load(f)


def measurement(data):
    """The SDK's event counters and the unbundled events, read from a copy of its database."""
    src = os.path.join(data, "Library/Application Support/Google/Measurement/google-app-measurement.sql")
    if not os.path.exists(src):
        return None
    tmp = tempfile.mkdtemp()
    try:
        dst = os.path.join(tmp, "m.sql")
        shutil.copy(src, dst)
        if os.path.exists(src + "-wal"):
            shutil.copy(src + "-wal", dst + "-wal")
        db = sqlite3.connect(dst)
        try:
            events = {name: [count, last] for name, count, last in
                      db.execute("SELECT name, lifetime_count, last_fire_timestamp FROM events ORDER BY name")}
            raw = [list(r) for r in db.execute("SELECT name, timestamp FROM raw_events ORDER BY timestamp")]
        except sqlite3.Error:
            return None  # copied while the SDK was creating or writing it; read again
        finally:
            db.close()
        return {"events": events, "raw_events": raw}
    finally:
        shutil.rmtree(tmp)


def webkit_files(data):
    files = sorted(glob.glob(os.path.join(data, "Library/WebKit/**/LocalStorage/*"), recursive=True))
    return {os.path.relpath(f, data): sha(f) for f in files if os.path.isfile(f) and not f.endswith("-shm")}


class Checks:
    def __init__(self, out, stage):
        self.out, self.stage, self.failures = out, stage, []
        path = os.path.join(out, "summary.json")
        self.summary = json.load(open(path)) if os.path.exists(path) else {}
        self.summary.setdefault(stage, {})

    def record(self, key, value):
        self.summary[self.stage][key] = value

    def check(self, name, ok, detail=None):
        self.summary[self.stage].setdefault("checks", []).append({"check": name, "ok": bool(ok), "detail": detail})
        if not ok:
            self.failures.append(name)
            print(f"FAIL {self.stage}: {name}: {detail}", file=sys.stderr)

    def finish(self):
        with open(os.path.join(self.out, "summary.json"), "w") as f:
            json.dump(self.summary, f, indent=1, ensure_ascii=False)
        sys.exit(1 if self.failures else 0)


def requests(c, out):
    entries = [json.loads(line) for line in open(os.path.join(out, "recorder", "requests.jsonl"), encoding="utf-8")]
    observed = [e["observed"] for e in entries if "observed" in e]
    blocked = sorted({o["url"].split("?")[0] for o in observed if o.get("blocked")})
    leaked = [o for o in observed if not o.get("blocked") and urlparse(o["url"]).hostname not in LOCAL_HOSTS
              and not o["url"].startswith("app://localhost/")]
    production = [o["url"] for o in observed if urlparse(o["url"]).hostname in PRODUCTION_HOSTS or
                  ("/v0009" in o["url"] and urlparse(o["url"]).hostname not in LOCAL_HOSTS)]
    c.record("requests_recorded", len(entries))
    c.record("requests_observed", len(observed))
    c.record("requests_redirected_to_recorder", blocked)
    c.record("api_requests_on_recorder", sorted({e["path"].split("?")[0] for e in entries
                                                 if not e["path"].startswith("/__tw/")}))
    c.check("every request of the page went to this Mac or was redirected to the recorder", not leaked, leaked)
    c.check("no request for a production host or an API path elsewhere", not production, production)


def push(c, out, data, seed, token):
    """IN-04: the native requests (/v000903) on the recorder against the seeded records and the Cordova app's post
    of the same records (/v000902, the seed's reference request)."""
    entries = [json.loads(line) for line in open(os.path.join(out, "recorder", "requests.jsonl"), encoding="utf-8")]
    native = [e for e in entries if e["path"].startswith("/v000903/")]
    cordova = [e for e in entries if e["path"] == "/v000902/push-list" and e["method"] == "POST"]
    stored = json.loads(seed["storage"]["pushData2"])
    seeded_token = stored["fcmToken"]

    def key(o):
        return [o.get("cityIndex"), o.get("id"), o.get("category")]

    def members(o):
        # Members in order with their values, but for the app version and the token.
        return [(k, v) for k, v in o.items() if k not in ("appVersion", "fcmToken")]

    seeded_keys = sorted(key(r) for r in stored["pushList"])
    c.record("native_requests", [{k: e.get(k) for k in ("time", "method", "path", "host", "headers")} for e in native])
    c.record("cordova_reference_headers", [e.get("headers") for e in cordova])
    changed = token != seeded_token
    lines = [f"{e['method']} {e['path']}" for e in native]
    expected = (["PUT /v000903/push"] if changed else []) + ["POST /v000903/push-list"] * 2
    c.check("native requests: the replacement once for a changed token, the list once per open", lines == expected,
            lines)
    c.check("every native request reached the recorder on this Mac",
            all((e.get("host") or "").split(":")[0] in LOCAL_HOSTS for e in native), [e.get("host") for e in native])
    c.check("every native request has the Cordova Device-Id",
            all((e.get("headers") or {}).get("Device-Id") == seed["deviceId"] for e in native))
    c.check("one Cordova reference post of the seeded records", len(cordova) == 1, len(cordova))
    ref = cordova[0] if cordova else {"headers": {}, "body": []}
    ref_body = ref.get("body") if isinstance(ref.get("body"), list) else []
    c.check("the Cordova reference posts every seeded record with type ios",
            sorted(key(o) for o in ref_body) == seeded_keys and all(o.get("type") == "ios" for o in ref_body),
            [key(o) for o in ref_body])
    cordova_put = [e for e in entries if e["path"] == "/v000902/push" and e["method"] == "PUT"]
    c.check("one Cordova reference token request (the seed's first token)",
            len(cordova_put) == 1 and cordova_put[0].get("body") == {"newToken": seeded_token, "oldToken": None},
            [e.get("body") for e in cordova_put])
    if changed and native:
        put = native[0]
        c.check("replacement body", put.get("body") == {"newToken": token, "oldToken": seeded_token}, put.get("body"))
        # The headers the system adds (Accept-Language) included: compared as the recorder received them.
        ref_put = (cordova_put[0].get("headers") if cordova_put else None) or {}
        c.check("replacement headers as in the Cordova token request", put.get("headers") == ref_put,
                [put.get("headers"), ref_put])
    posts = [e for e in native if e["path"] == "/v000903/push-list"]
    for i, post in enumerate(posts, 1):
        body = post.get("body") if isinstance(post.get("body"), list) else []
        keys = [key(o) for o in body]
        c.check(f"post {i}: every migrated alarm and alert once", sorted(keys) == seeded_keys, keys)
        c.check(f"post {i}: type ios, the Cordova uuid and the token",
                all(o.get("type") == "ios" and o.get("uuid") == seed["deviceId"] and o.get("fcmToken") == token
                    for o in body))
        headers = post.get("headers") or {}
        for h in ("Content-Type", "Accept-Language", "Device-Id", "Accept"):
            c.check(f"post {i}: {h} as in the Cordova post", headers.get(h) == ref["headers"].get(h),
                    [headers.get(h), ref["headers"].get(h)])
        diffs = [{"native": o, "cordova": r} for o in body for r in ref_body
                 if key(o) == key(r) and members(o) != members(r)]
        c.check(f"post {i}: records equal to the Cordova post (members, order, values) but for appVersion and "
                "fcmToken", not diffs, diffs[:2])
    state = json.load(open(os.path.join(data, "Library/Application Support/TodayWeather/app_state.json")))
    c.check("the token is stored", state["push"]["fcmToken"] == token, state["push"]["fcmToken"])
    c.check("the records are kept", sorted(key(r) for r in state["push"]["records"]) == seeded_keys)
    queue_path = os.path.join(data, "Library/Application Support/TodayWeather/push_tokens.json")
    queue = json.load(open(queue_path))["tokens"] if os.path.exists(queue_path) else []
    c.check("no token waits in the queue", queue == [], queue)


def main():
    stage = sys.argv[1]
    if stage == "dummy-plist":
        return dummy_plist(sys.argv[2])
    if stage == "tests-passed":
        return tests_passed(*sys.argv[2:6])
    if stage == "event-stored":  # exit 0 once the SDK stored the seed's event (the app keeps running)
        m = measurement(sys.argv[2])
        sys.exit(0 if m is not None and "favorite_change" in m["events"] else 1)
    out, data, shared, source = sys.argv[2:6]
    phase = sys.argv[6] if len(sys.argv) > 6 else None
    c = Checks(out, stage if stage != "after" else f"after-{phase}")
    seed = json.load(open(os.path.join(out, "recorder", "seeded.json")))
    if stage == "push":
        push(c, out, data, seed, phase)
        requests(c, out)
        c.finish()
    # cfprefsd writes the preference files some time after the app changed them (the app's own reads see the new
    # values at once), and the SDK's database can be caught while it is written: wait until the files hold the
    # values of this stage, at most 60 s, then check what they hold.
    for _ in range(60):
        standard = plist(os.path.join(data, "Library/Preferences/net.wizardfactory.todayweather.plist"))
        group = plist(os.path.join(shared, "Library/Preferences/group.net.wizardfactory.todayweather.plist"))
        apm = plist(os.path.join(data, "Library/Preferences/APMAnalyticsSuiteName.plist"))
        m = measurement(data)
        if stage == "before":
            settled = ("cities" in group and standard.get("/google/measurement/measurement_enabled_state") == 1 and
                       m is not None and "favorite_change" in m["events"])
        else:
            settled = (standard.get("/google/measurement/measurement_enabled_state") not in (None, 1) and
                       (apm.get("consent_settings_3p") or {}).get("analytics_storage") == "denied" and m is not None)
        if settled:
            break
        time.sleep(1)
    c.record("measurement_enabled_state", standard.get("/google/measurement/measurement_enabled_state"))
    c.record("consent_settings_3p", apm.get("consent_settings_3p"))
    c.record("measurement", m)

    if stage == "before":
        c.check("seed ran without error", "error" not in seed, seed.get("error"))
        c.check("seeded through app://localhost", seed.get("origin") == "app://localhost", seed.get("origin"))
        c.check("Cordova analytics opt-in stored", seed.get("analyticsChoice") is True and seed.get("optInStored") is True)
        c.check("Firebase SDK reported collection enabled", seed.get("sdkCollectionEnabled") is True)
        c.check("SDK persisted collection flag on (1)",
                standard.get("/google/measurement/measurement_enabled_state") == 1)
        c.check("CDVUUID equals device.uuid", standard.get("CDVUUID") == seed.get("deviceId"), standard.get("CDVUUID"))
        c.check("suite holds the seeded cities", group.get("cities") == seed["suite"].get("cities"))
        c.check("suite holds the analytics opt-in", group.get("twAnalyticsConsentV1") == "true")
        files = webkit_files(data)
        c.check("WebKit localStorage database exists", any(f.endswith("localstorage.sqlite3") for f in files), files)
        c.check("the SDK counted an event under the opt-in", m is not None and "favorite_change" in m["events"], m)
        c.record("webkit_files", files)
        c.record("group_sha", sha(os.path.join(shared, "Library/Preferences/group.net.wizardfactory.todayweather.plist")))
        requests(c, out)
        c.finish()

    before = c.summary["before"]
    state_path = os.path.join(data, "Library/Application Support/TodayWeather/app_state.json")
    c.check("app_state.json written", os.path.exists(state_path))
    state_sha = sha(state_path) if os.path.exists(state_path) else None
    c.record("state_sha", state_sha)
    if os.path.exists(state_path):
        state = json.load(open(state_path))
        c.record("migration", state.get("migration"))
    first = c.summary.get("after-first", {}).get("state_sha")
    if stage != "after" or phase != "first":
        c.check("state file unchanged since the first start", state_sha == first, [first, state_sha])
    c.check("SDK persisted collection flag off", standard.get("/google/measurement/measurement_enabled_state") not in (None, 1),
            standard.get("/google/measurement/measurement_enabled_state"))
    consent = apm.get("consent_settings_3p") or {}
    c.check("analytics consent denied", all(consent.get(k) == "denied" for k in
                                             ["analytics_storage", "ad_storage", "ad_user_data", "ad_personalization"]),
            consent)
    c.check("no event counted since the update", m is not None and m["events"] == before["measurement"]["events"],
            [before["measurement"], m])
    c.check("no unbundled event added", m is not None and m["raw_events"] == before["measurement"]["raw_events"])
    c.check("CDVUUID unchanged", standard.get("CDVUUID") == seed.get("deviceId"))
    c.check("suite unchanged", sha(os.path.join(shared, "Library/Preferences/group.net.wizardfactory.todayweather.plist"))
            == before["group_sha"])
    files = webkit_files(data)
    if source == "suite":
        c.check("no WebKit storage (suite-only state)", not files, files)
    else:
        c.check("WebKit localStorage files unchanged", files == before["webkit_files"], files)
    if stage == "final":
        launches = sorted(glob.glob(os.path.join(out, "debug-launch-*.log")))
        lines = {os.path.basename(p): [line for line in open(p, encoding="utf-8", errors="replace").read().splitlines()
                                       if "Firebase" in line or "I-ACS" in line] for p in launches}
        c.record("debug_launches", len(launches))
        c.record("firebase_debug_lines", {name: found[:40] for name, found in lines.items()})
        last = lines[os.path.basename(launches[-1])] if launches else []
        # With -FIRAnalyticsDebugEnabled the SDK logs every event it accepts ("Logging event: ...").
        c.check("Analytics debug logging was on in the last debug launch",
                any("To disable debug logging" in line for line in last))
        c.check("the SDK reported collection disabled", any("Analytics collection disabled" in line for line in last))
        logged = [line for found in lines.values() for line in found if "Logging event" in line]
        c.check("no event logged in any debug launch", not logged, logged)
    requests(c, out)
    c.finish()


if __name__ == "__main__":
    main()
