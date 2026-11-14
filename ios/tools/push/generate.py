#!/usr/bin/env python3
"""Golden push requests of the Cordova iOS app (IN-04, #2953).

    python3 ios/tools/push/generate.py [--jsc PATH]

Runs the Cordova `Push` service (client/www/js/service.push.js, with service.weatherutil.js for the town of a
Korean address) in the macOS JavaScriptCore shell, the engine of the Cordova iOS app, with the platform reporting
iOS (cases.js). One jsc process runs per time zone, because jsc takes its zone from TZ. The requests of every case
are written to ios/Core/Tests/TWStorageTests/Fixtures/push/push.json, and the timed cases (tokens delivered at
given times around the 3-second list post, failing requests; IN-04 review) to
ios/Core/Tests/TWDataTests/Golden/push-timed.json, each with the source files' last commit and SHA-256. Only this tool reads client/; the iOS build and tests read the written file. The output is deterministic:
running it again without source changes changes nothing (CI checks that).
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SOURCES = ["client/www/js/service.push.js", "client/www/js/service.weatherutil.js"]
OUT = ROOT / "ios" / "Core" / "Tests" / "TWStorageTests" / "Fixtures" / "push" / "push.json"
TIMED_OUT = ROOT / "ios" / "Core" / "Tests" / "TWDataTests" / "Golden" / "push-timed.json"
DEFAULT_JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc"
ZONES = ["Asia/Seoul", "America/New_York"]


def git(*args) -> str:
    return subprocess.run(["git", "-C", str(ROOT), *args], check=True, capture_output=True, text=True).stdout.strip()


def run_zone(jsc: str, zone: str) -> dict:
    env = {"PATH": "/usr/bin:/bin", "TZ": zone, "LANG": "en_US.UTF-8", "LC_ALL": "en_US.UTF-8"}
    args = [jsc, str(HERE / "cases.js"), "--", *(str(ROOT / s) for s in SOURCES), zone]
    proc = subprocess.run(args, env=env, capture_output=True, text=True, cwd=str(ROOT))
    if proc.returncode != 0 or not proc.stdout.strip():
        sys.exit(f"jsc run in {zone} failed (exit {proc.returncode}):\n{proc.stdout[-2000:]}{proc.stderr[-2000:]}")
    return json.loads(proc.stdout)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--jsc", default=DEFAULT_JSC)
    args = parser.parse_args()
    for s in SOURCES:
        if not (ROOT / s).is_file():
            sys.exit(f"missing {s}: the generator needs client/ (the iOS build reads only the written copy)")
    if not os.access(args.jsc, os.X_OK):
        sys.exit(f"no JavaScriptCore shell at {args.jsc}")
    runs = [run_zone(args.jsc, zone) for zone in ZONES]
    doc = {k: v for k, v in runs[0].items() if k not in ("cases", "timed")}
    for run in runs[1:]:
        if {k: v for k, v in run.items() if k not in ("cases", "timed")} != doc:
            sys.exit("the zones disagree on the shared inputs")
    sources = []
    for s in SOURCES:
        commit = git("log", "-1", "--format=%H", "--", s)
        if not commit:
            sys.exit(f"no commit for {s}: the generator needs the Git history")
        sources.append({"path": s, "commit": commit, "sha256": hashlib.sha256((ROOT / s).read_bytes()).hexdigest()})
    out = {
        "generator": "ios/tools/push/generate.py (cases.js in the macOS JavaScriptCore shell)",
        "sources": sources,
        "note": "Requests of the Cordova Push service on iOS. Paths carry the client's /v000902; the native app "
                "sends /v000903 (#2948).",
        **doc,
        "cases": [c for run in runs for c in run["cases"]],
    }
    timed = {
        "generator": out["generator"],
        "sources": sources,
        "note": "Requests of the Cordova Push service on iOS on a virtual clock: `at` is the time in ms after Push.init "
                "when the request was sent; tokens of `events` arrive through the token callback at their time; "
                "`fail` lists the methods whose requests fail. Paths carry /v000902; the native app sends /v000903.",
        **doc,
        "cases": [c for run in runs for c in run.get("timed", [])],
    }
    write(OUT, out)
    write(TIMED_OUT, timed)


def write(path, doc):
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(doc, ensure_ascii=False, indent=1) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == text:
        print(f"unchanged: {path.relative_to(ROOT)} ({len(doc['cases'])} cases)")
    else:
        path.write_text(text, encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)} ({len(doc['cases'])} cases)")


if __name__ == "__main__":
    main()
