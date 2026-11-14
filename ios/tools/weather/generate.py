#!/usr/bin/env python3
"""Golden weather request timing of the Cordova iOS app (IN-08, #2957).

    python3 ios/tools/weather/generate.py [--jsc PATH]

Runs WeatherUtil.getWeatherByGeoInfo (`_getHttp`, `_retryGetHttp`; client/www/js/service.weatherutil.js) and the
ten-minute gate of WeatherInfo (canLoadCity, reloadCity, updateCity; client/www/js/service.weatherinfo.js) in the macOS
JavaScriptCore shell, the engine of the Cordova iOS app, on a virtual clock (cases.js). The record is written to
ios/Core/Tests/TWDataTests/Golden/weather-timed.json with the source files' last commit and SHA-256. Only this tool
reads client/; the iOS build and tests read the written file. The output is deterministic: running it again without
source changes changes nothing (CI checks that).
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
SOURCES = ["client/www/js/service.weatherutil.js", "client/www/js/service.weatherinfo.js"]
OUT = ROOT / "ios" / "Core" / "Tests" / "TWDataTests" / "Golden" / "weather-timed.json"
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
    proc = subprocess.run([args.jsc, str(HERE / "cases.js"), "--", *(str(ROOT / s) for s in SOURCES)],
                          env=env, capture_output=True, text=True, cwd=str(ROOT))
    if proc.returncode != 0 or not proc.stdout.strip():
        sys.exit(f"jsc run failed (exit {proc.returncode}):\n{proc.stdout[-2000:]}{proc.stderr[-2000:]}")
    doc = json.loads(proc.stdout)
    sources = []
    for s in SOURCES:
        commit = git("log", "-1", "--format=%H", "--", s)
        if not commit:
            sys.exit(f"no commit for {s}: the generator needs the Git history")
        sources.append({"path": s, "commit": commit, "sha256": hashlib.sha256((ROOT / s).read_bytes()).hexdigest()})
    out = {
        "generator": "ios/tools/weather/generate.py (cases.js in the macOS JavaScriptCore shell)",
        "sources": sources,
        "note": "retry: getWeatherByGeoInfo on a virtual clock; `at` is ms after the call, `behaviors[i]` attempt i's answer, "
                "failure (with status) or hang until $http's timeout (status -1). Legacy attempts started after the "
                "promise settled (A06) are listed; the native client cancels them (IN-08). gate: canLoadCity at the "
                "given ms after a fixed start.",
        **doc,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(out, ensure_ascii=False, indent=1) + "\n"
    if OUT.exists() and OUT.read_text(encoding="utf-8") == text:
        print(f"unchanged: {OUT.relative_to(ROOT)} ({len(doc['retry'])} retry cases, {len(doc['gate'])} gate cases)")
    else:
        OUT.write_text(text, encoding="utf-8")
        print(f"wrote {OUT.relative_to(ROOT)} ({len(doc['retry'])} retry cases, {len(doc['gate'])} gate cases)")


if __name__ == "__main__":
    main()
