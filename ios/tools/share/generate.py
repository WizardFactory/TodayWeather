#!/usr/bin/env python3
"""Golden share messages of the Cordova iOS app (IN-16, #2965; O16, V20).

    python3 ios/tools/share/generate.py [--jsc PATH]

Runs TabCtrl's `doTabShare` and `_makeMessageForTodayWeather` (client/www/js/controller.tabctrl.js) with WeatherUtil
(client/www/js/service.weatherutil.js) and the catalogs (client/www/locales), unchanged, in the macOS JavaScriptCore
shell, the engine of the Cordova iOS app (cases.js). The record is written to
ios/Core/Tests/TWDataTests/Golden/share.json with the source files' last commit and SHA-256. Only this tool reads
client/; the iOS build and tests read the written file. The output is deterministic: running it again without source
changes changes nothing (CI checks that).
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
LOCALES = ["ko", "en", "ja", "de", "zh-CN", "zh-TW"]
SOURCES = ["client/www/js/service.weatherutil.js", "client/www/js/controller.tabctrl.js",
           *(f"client/www/locales/{code}.json" for code in LOCALES)]
OUT = ROOT / "ios" / "Core" / "Tests" / "TWDataTests" / "Golden" / "share.json"
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
    proc = subprocess.run([args.jsc, str(HERE / "cases.js"), "--", str(ROOT / SOURCES[0]), str(ROOT / SOURCES[1]),
                           str(ROOT / "client" / "www" / "locales")],
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
        "generator": "ios/tools/share/generate.py (cases.js in the macOS JavaScriptCore shell)",
        "sources": sources,
        "note": "doTabShare for the selected city record `city` (absent: no city) with Util.language `language` and the "
                "catalog `catalog` (`texts`): `message` is what window.plugins.socialsharing.share received (with "
                "`shareArguments`, its subject, file and url), `startPopup` that the start choice opened instead, "
                "`threw` the error that ended the weather lines (the message then holds the city line).",
        "texts": doc["texts"],
        "cases": doc["cases"],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(out, ensure_ascii=False, indent=1) + "\n"
    shared = sum(1 for c in out["cases"] if "message" in c)
    summary = f"{len(out['cases'])} cases, {shared} shared"
    if OUT.exists() and OUT.read_text(encoding="utf-8") == text:
        print(f"unchanged: {OUT.relative_to(ROOT)} ({summary})")
    else:
        OUT.write_text(text, encoding="utf-8")
        print(f"wrote {OUT.relative_to(ROOT)} ({summary})")


if __name__ == "__main__":
    main()
