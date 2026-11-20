#!/usr/bin/env python3
"""Verify UMP request ordering, SDK outcomes and analytics consent in the three-launch simulator smoke."""
import json
import sqlite3
import sys
from pathlib import Path


def lines(path: Path):
    return path.read_text(encoding="utf-8", errors="replace").splitlines() if path.exists() else []


def events(out: Path, name: str):
    """Event names in the SDK's database copy after a launch (lifetime counters and unbundled events)."""
    db_path = out / f"{name}.sql"
    if not db_path.exists():
        marker = out / f"{name}.measurement-absent"
        return [] if marker.is_file() and marker.stat().st_size > 0 else None
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        counted = [r[0] for r in db.execute("SELECT name FROM events WHERE lifetime_count > 0")]
        raw = [r[0] for r in db.execute("SELECT name FROM raw_events")]
        return sorted(set(counted + raw))
    except sqlite3.Error as error:
        return [f"unreadable: {error}"]
    finally:
        db.close()


def main():
    out = Path(sys.argv[1])
    names = ["1-explainer", "2-denied", "3-allowed-opted-in"]
    # The console and the unified log of each launch (the SDK's debug log is in the latter).
    logs = {n: lines(out / f"{n}.log") + lines(out / f"{n}.oslog") for n in names}
    checks = []

    def check(name, ok, detail=None):
        checks.append({"check": name, "ok": bool(ok), "detail": detail})

    def find(log, text):
        return next((i for i, l in enumerate(log) if text in l), None)

    first = logs["1-explainer"]
    formats = ("native", "interstitial")
    check("launch 1: neither format may request during the UMP explainer",
          find(first, '"operation":"request_policy"') is None
          and all(find(first, f"{fmt} request") is None for fmt in formats))

    for name, status, personalized in (("2-denied", "denied", "false"), ("3-allowed-opted-in", "authorized", "true")):
        # Use one chronological stream for ordering. The console and unified log can duplicate events differently.
        log = lines(out / f"{name}.oslog")
        policy = find(log, '"operation":"request_policy"')
        expected = ('{"component":"admob","operation":"request_policy","att_status":"%s","personalized":%s,'
                    '"result":"applied"}' % (status, personalized))
        check(f"{name}: Ads SDK started", find(log, "admob initialize ready") is not None)
        check(f"{name}: live consent policy", policy is not None and expected in log[policy])
        requests = {fmt: find(log, f"{fmt} request") for fmt in formats}
        check(f"{name}: saved places requests a native test ad after the policy; no earlier interstitial",
              policy is not None and requests["native"] is not None
              and all(index > policy for index in requests.values() if index is not None), requests)
        outcome = next((event for event in ("loaded", "failed") if find(log, f"native {event}") is not None), None)
        check(f"{name}: native SDK request received an outcome", outcome is not None, outcome)
        check(f"{name}: no fixed banner is requested", find(log, "banner request") is None)

    # The SDK logs each event ("Logging event:") at the debug level of the unified log. A launch counts only when its
    # stream holds the SDK's start and at least one of its debug-level messages, so an empty event list is a reading
    # of the debug log, not a missing log (CODEX-IN15-2).
    started = {n: any("[I-ACS023007] Analytics v." in l for l in logs[n]) for n in names}
    debug = {n: any(" Db " in l and "[FirebaseAnalytics]]" in l for l in logs[n]) for n in names}
    check("every launch started the Analytics SDK and its debug-level log was captured",
          all(started.values()) and all(debug.values()), {"started": started, "debug_level_messages": debug})
    before = [l.strip() for n in names[:2] for l in logs[n] if "Logging event:" in l]
    check("no analytics event logged before the opt-in", not before, before[:10])
    stored = {n: events(out, n) for n in names}
    check("no analytics event stored before the opt-in", all(not stored[n] for n in names[:2]), stored)
    logged = [l.strip() for l in logs[names[2]] if "Logging event:" in l and "screen_view" in l]
    check("after the opt-in, the debug log shows screen_view logged",
          logged, {"logged": logged[:3], "stored": stored[names[2]]})

    summary = {"out": str(out), "passed": all(c["ok"] for c in checks), "checks": checks, "analytics_debug_logging_on": debug}
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for c in checks:
        print(("PASS " if c["ok"] else "FAIL ") + c["check"])
    print(f"analytics debug logging on: {debug}")
    sys.exit(0 if summary["passed"] else 1)


if __name__ == "__main__":
    main()
