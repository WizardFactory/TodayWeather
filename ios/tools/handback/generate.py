#!/usr/bin/env python3
"""Golden starts of the fallback Cordova build over the native hand-back's suite writes (IN-17, #2966).

    python3 ios/tools/handback/generate.py [--jsc PATH]

Runs `TwStorage.init` (client/www/js/service.storage.js, with its `_handBack` reader) and the JavaScript of
cordova-plugin-app-preferences over a model of its iOS side (AppPreferences.m) in the macOS JavaScriptCore shell, the
engine of the Cordova iOS app (reader.js). For each case the start runs over the suite before the native writes, after
each write, and after a write interrupted at each step and done again by the next process. It writes
ios/Core/Tests/TWStorageTests/Fixtures/handback/handback.json with the sources' last commit and SHA-256 and fails when a
start over a non-empty WebView storage shows a mix of two states. HandBackWriterTests compare the Swift writer's
operations with the golden ones. Only this tool reads client/; the iOS build and tests read the written file. The output
is deterministic: running it again without source changes changes nothing (CI checks that).
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
PLUGIN = "client/local-plugins/cordova-plugin-app-preferences"
SOURCES = ["client/www/js/service.storage.js", f"{PLUGIN}/www/apppreferences.js", f"{PLUGIN}/src/ios/AppPreferences.m"]
OUT = ROOT / "ios" / "Core" / "Tests" / "TWStorageTests" / "Fixtures" / "handback" / "handback.json"
DEFAULT_JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc"


def git(*args) -> str:
    return subprocess.run(["git", "-C", str(ROOT), *args], check=True, capture_output=True, text=True).stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--jsc", default=DEFAULT_JSC)
    args = parser.parse_args()
    for s in SOURCES:
        if not (ROOT / s).is_file():
            sys.exit(f"missing {s}: the generator needs client/ (the iOS build reads only the written copy)")
    if not os.access(args.jsc, os.X_OK):
        sys.exit(f"no JavaScriptCore shell at {args.jsc}")
    env = {"PATH": "/usr/bin:/bin", "TZ": "Asia/Seoul", "LANG": "en_US.UTF-8", "LC_ALL": "en_US.UTF-8"}
    proc = subprocess.run([args.jsc, str(HERE / "reader.js"), "--", str(ROOT / SOURCES[0]), str(ROOT / SOURCES[1])],
                          env=env, capture_output=True, text=True, cwd=str(ROOT))
    if proc.returncode != 0 or not proc.stdout.strip():
        sys.exit(f"jsc run failed (exit {proc.returncode}):\n{proc.stdout[-2000:]}{proc.stderr[-2000:]}")
    doc = json.loads(proc.stdout)

    problems = []
    for case in doc["cases"]:
        runs = [("writes", case["outcomes"])] + [(f"resumed after {r['after']}", r["outcomes"]) for r in case["resumed"]]
        for label, outcomes in runs:
            letters = "".join(o[0] for o in outcomes)
            if not case["emptyWebView"] and "M" in letters:
                problems.append(f"{case['name']}, {label}: a start shows a mix ({letters})")
            if case["writes"] and letters[-1] != "W":
                problems.append(f"{case['name']}, {label}: the last start does not show the hand-back ({letters})")
    if problems:
        sys.exit("\n".join(problems))

    sources = []
    for s in SOURCES:
        commit = git("log", "-1", "--format=%H", "--", s)
        if not commit:
            sys.exit(f"no commit for {s}: the generator needs the Git history")
        sources.append({"path": s, "commit": commit, "sha256": hashlib.sha256((ROOT / s).read_bytes()).hexdigest()})
    out = {
        "generator": "ios/tools/handback/generate.py (reader.js in the macOS JavaScriptCore shell)",
        "sources": sources,
        "note": "Starts of the fallback Cordova iOS build (TwStorage.init) over every prefix of the native hand-back's "
                "suite writes. Outcome per start: [S stale WebView state | W new hand-back | P previous native hand-back "
                "| H waits | M mix, trusted (storageReady), the claim's generation or null]. Suite values: {string} "
                "NSString, {number} NSNumber, {bool}, {data} NSData.",
        **doc,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(out, ensure_ascii=False, indent=1) + "\n"
    summary = ", ".join(f"{c['name']}: {''.join(o[0] for o in c['outcomes'])}" for c in doc["cases"])
    if OUT.exists() and OUT.read_text(encoding="utf-8") == text:
        print(f"unchanged: {OUT.relative_to(ROOT)} ({summary})")
    else:
        OUT.write_text(text, encoding="utf-8")
        print(f"wrote {OUT.relative_to(ROOT)} ({summary})")


if __name__ == "__main__":
    main()
