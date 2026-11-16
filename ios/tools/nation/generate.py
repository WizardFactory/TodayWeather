#!/usr/bin/env python3
"""Golden nationwide pages and warnings of the Cordova iOS app (IN-13, #2962).

    python3 ios/tools/nation/generate.py [--jsc PATH]

Runs NationCtrl, NationAirCtrl and KmaSpecialCtrl (client/www/js/controller.nation.js, controller.nation.air.js,
controller.kma.special.js) unchanged, with WeatherUtil.aqiStandard from service.weatherutil.js, in the macOS
JavaScriptCore shell, the engine of the Cordova iOS app (cases.js), over the corpus answers
(ios/Core/Tests/TWDomainTests/Corpus/inputs/nation.json and special.json, the copies of the AN-02 corpus inputs) and
over empty, malformed and failed answers. The record is written to
ios/Core/Tests/TWDomainTests/NationReference/nation-golden.json with the source files' last commit and SHA-256. Only
this tool reads client/; the iOS build and tests read the written file. The output is deterministic: running it again
without source changes changes nothing (CI checks that).
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
SOURCES = ["client/www/js/controller.nation.js", "client/www/js/controller.nation.air.js",
           "client/www/js/controller.kma.special.js", "client/www/js/service.weatherutil.js",
           "client/www/templates/nation.html", "client/www/templates/nation-air.html",
           "client/www/templates/kma-special.html"]
INPUTS = ROOT / "ios" / "Core" / "Tests" / "TWDomainTests" / "Corpus" / "inputs"
OUT = ROOT / "ios" / "Core" / "Tests" / "TWDomainTests" / "NationReference" / "nation-golden.json"
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
    # jsc takes its zone from TZ: the warnings' local times are Seoul's, as on a Korean device.
    env = {"PATH": "/usr/bin:/bin", "TZ": "Asia/Seoul", "LANG": "en_US.UTF-8", "LC_ALL": "en_US.UTF-8"}
    proc = subprocess.run([args.jsc, str(HERE / "cases.js"), "--", str(ROOT / "client" / "www"), str(INPUTS)],
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
    inputs = [{"path": p.relative_to(ROOT).as_posix(), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
              for p in (INPUTS / "nation.json", INPUTS / "special.json")]
    out = {
        "generator": "ios/tools/nation/generate.py (cases.js in the macOS JavaScriptCore shell, TZ Asia/Seoul)",
        "sources": sources,
        "inputs": inputs,
        "note": "nation: per answer (the value getNationWeather resolved with, `production` being inputs/nation.json, or a "
                "rejection) and units, NationCtrl's labels per mode (0 sky/temperature, 1 rain, 2 wind) and "
                "NationAirCtrl's labels per pollutant as nation.html and nation-air.html show them: icon when getIcon is "
                "not undefined, a line {text, unit} per getText1/getText2 that is not undefined (interpolated), the air "
                "background grade2Color; `loading` is $ionicLoading's calls of both controllers. special: per answer of "
                "$http (`answer`, the JSON value; `status`, an error) and WebView language, KmaSpecialCtrl's request, "
                "`error`, `specialList` and, for a list, the cards kma-special.html interpolates (`commentHtml` is what "
                "ng-bind-html receives).",
        "nation": doc["nation"],
        "special": doc["special"],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(out, ensure_ascii=False, indent=1) + "\n"
    counts = f"{len(doc['nation'])} nation cases, {len(doc['special'])} warning cases"
    if OUT.exists() and OUT.read_text(encoding="utf-8") == text:
        print(f"unchanged: {OUT.relative_to(ROOT)} ({counts})")
    else:
        OUT.write_text(text, encoding="utf-8")
        print(f"wrote {OUT.relative_to(ROOT)} ({counts})")


if __name__ == "__main__":
    main()
