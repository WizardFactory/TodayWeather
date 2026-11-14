#!/usr/bin/env python3
"""Reads the consoles and measurement databases of run-ads-check.sh (IN-15, #2964) and writes <out>/summary.json.

    check_ads.py <out-dir>

Checks:
- launch 1 (ATT not determined, UMP's explainer open): no request_policy line and no banner request;
- launch 2 (ATT denied): the Ads SDK started, request_policy denied and not personalized before the first banner
  request, a test banner loaded;
- launch 3 (ATT allowed): request_policy authorized and personalized before the first banner request; the banner's
  outcome is recorded (a personalized request of Google's test unit can end in no fill, code 1);
- analytics: no "Logging event" line in launches 1 and 2 and no event in the SDK's database after them; after the
  stored grant (launch 3) screen_view is logged or stored, so the first checks are not vacuous. Whether the SDK took
  debug mode in each launch is recorded. The SDK stores screen_view as "_vs".
Exit 1 when a check fails.
"""
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
        return None
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
    logs = {n: lines(out / f"{n}.log") for n in names}
    checks = []

    def check(name, ok, detail=None):
        checks.append({"check": name, "ok": bool(ok), "detail": detail})

    def find(log, text):
        return next((i for i, l in enumerate(log) if text in l), None)

    first = logs["1-explainer"]
    check("launch 1: no request_policy and no banner request while UMP's explainer is open",
          find(first, '"operation":"request_policy"') is None and find(first, "banner request") is None)

    for name, status, personalized in (("2-denied", "denied", "false"), ("3-allowed-opted-in", "authorized", "true")):
        log = logs[name]
        policy = find(log, '"operation":"request_policy"')
        request = find(log, "banner request")
        line = log[policy].split("[admob] ")[-1].strip() if policy is not None else None
        check(f"{name}: Ads SDK started", find(log, "admob initialize ready") is not None)
        check(f"{name}: request_policy {status}, personalized {personalized}, before the first banner request",
              line == ('{"component":"admob","operation":"request_policy","att_status":"%s","personalized":%s,'
                       '"result":"applied"}' % (status, personalized)) and request is not None and policy < request,
              {"line": line, "policy_index": policy, "first_request_index": request})
        outcome = [l.strip() for l in log if "banner loaded" in l or '"operation":"banner_load"' in l]
        if name == "2-denied":
            check(f"{name}: a test banner loaded", any("banner loaded" in l for l in outcome), outcome[:2])
        else:
            check(f"{name}: the banner request was answered", outcome, outcome[:2])

    before = [l.strip() for n in names[:2] for l in logs[n] if "Logging event" in l]
    check("no analytics event logged before the opt-in", not before, before[:10])
    stored = {n: events(out, n) for n in names}
    check("no analytics event stored before the opt-in", all(not stored[n] for n in names[:2]), stored)
    logged = [l.strip() for l in logs[names[2]] if "Logging event" in l and "screen_view" in l]
    check("after the opt-in, screen_view is logged or stored",
          logged or {"screen_view", "_vs"} & set(stored[names[2]] or []),
          {"logged": logged[:3], "stored": stored[names[2]]})
    debug = {n: any("To disable debug logging" in l for l in logs[n]) for n in names}

    summary = {"out": str(out), "passed": all(c["ok"] for c in checks), "checks": checks, "analytics_debug_logging_on": debug}
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for c in checks:
        print(("PASS " if c["ok"] else "FAIL ") + c["check"])
    print(f"analytics debug logging on: {debug}")
    sys.exit(0 if summary["passed"] else 1)


if __name__ == "__main__":
    main()
