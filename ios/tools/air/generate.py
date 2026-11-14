#!/usr/bin/env python3
"""Golden grade and scale mapping of the Cordova iOS air page (IN-09, #2958; V32).

    python3 ios/tools/air/generate.py [--jsc PATH]

Runs TabCtrl's `setAirUnit`, `grade2Color` and `getSentimentIcon` (client/www/js/controller.tabctrl.js) over
`WeatherUtil.aqiStandard` (client/www/js/service.weatherutil.js), and AirCtrl's `getLabelPosition`
(client/www/js/controller.air.js), unchanged, in the macOS JavaScriptCore shell, the engine of the Cordova iOS app
(cases.js). The record is written to ios/Core/Tests/TWDomainTests/AirReference/air-scale.json with the source files'
last commit and SHA-256. Only this tool reads client/; the iOS build and tests read the written file. The output is
deterministic: running it again without source changes changes nothing (CI checks that).
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
SOURCES = ["client/www/js/service.weatherutil.js", "client/www/js/controller.tabctrl.js", "client/www/js/controller.air.js"]
OUT = ROOT / "ios" / "Core" / "Tests" / "TWDomainTests" / "AirReference" / "air-scale.json"
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
        "generator": "ios/tools/air/generate.py (cases.js in the macOS JavaScriptCore shell)",
        "sources": sources,
        "note": "standards: setAirUnit per airUnit and the gauge's bands per pollutant ({color, str, text}, text as "
                "tab-air.html interpolates `~ {{obj.value[aqiCode]}}`); grades: grade2Color(grade), grade2Color(grade, "
                "'white') and getSentimentIcon(grade); labels: [airUnit, code, gauge width, label width (0 reads as 52), "
                "grade, value, getLabelPosition(grade, value)]. A missing value is left out; NaN is \"NaN\".",
        "standards": doc["standards"],
        "grades": doc["grades"],
        "labels": doc["labels"],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    lines = [json.dumps({k: v for k, v in out.items() if k != "labels"}, ensure_ascii=False, indent=1)[:-2] + ",",
             ' "labels": [']
    lines += ["  " + json.dumps(row, ensure_ascii=False) + ("," if i < len(out["labels"]) - 1 else "")
              for i, row in enumerate(out["labels"])]
    lines += [" ]", "}"]
    text = "\n".join(lines) + "\n"
    json.loads(text)
    counts = f"{len(doc['standards'])} standards, {len(doc['grades'])} grade cases, {len(doc['labels'])} label cases"
    if OUT.exists() and OUT.read_text(encoding="utf-8") == text:
        print(f"unchanged: {OUT.relative_to(ROOT)} ({counts})")
    else:
        OUT.write_text(text, encoding="utf-8")
        print(f"wrote {OUT.relative_to(ROOT)} ({counts})")


if __name__ == "__main__":
    main()
