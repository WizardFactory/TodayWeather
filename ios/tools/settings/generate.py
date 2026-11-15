#!/usr/bin/env python3
"""Golden settings steps, menu hand-offs and push re-post of the Cordova iOS app (IN-12, #2961).

    python3 ios/tools/settings/generate.py [--jsc PATH]

Runs the Cordova settings code (client/www/js: service.util.js, controller.units.js, controller.setting.radio.js,
controller.settingctrl.js, and the Push service service.push.js with service.weatherutil.js) in the macOS JavaScriptCore
shell, the engine of the Cordova iOS app, with the platform reporting iOS (cases.js). One jsc process runs per time zone,
because jsc takes its zone from TZ. The record is written to ios/Core/Tests/TWDataTests/Golden/settings.json with the
source files' last commit and SHA-256: S07's rows, each S08 list (opening, the page, every other choice with what it
stores, the request Push.updateUnits sends and the reloads), the push cases that send nothing, and the menu's hand-offs
and About in Korean and English. Only this tool reads client/; the iOS build and tests read the written file. The
output is deterministic: running it again without source changes changes nothing (CI checks that).
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
WWW = ROOT / "client" / "www"
SOURCES = ["client/www/js/service.util.js", "client/www/js/controller.units.js", "client/www/js/controller.setting.radio.js",
           "client/www/js/controller.settingctrl.js", "client/www/js/service.push.js", "client/www/js/service.weatherutil.js",
           "client/www/data/theme.js", "client/www/locales/ko.json", "client/www/locales/en.json"]
OUT = ROOT / "ios" / "Core" / "Tests" / "TWDataTests" / "Golden" / "settings.json"
DEFAULT_JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc"
ZONES = ["Asia/Seoul", "America/New_York"]


def git(*args) -> str:
    return subprocess.run(["git", "-C", str(ROOT), *args], check=True, capture_output=True, text=True).stdout.strip()


def run_zone(jsc: str, zone: str) -> dict:
    env = {"PATH": "/usr/bin:/bin", "TZ": zone, "LANG": "en_US.UTF-8", "LC_ALL": "en_US.UTF-8"}
    proc = subprocess.run([jsc, str(HERE / "cases.js"), "--", str(WWW), zone], env=env, capture_output=True, text=True,
                          cwd=str(ROOT))
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
    seoul, new_york = (run_zone(args.jsc, z) for z in ZONES)
    sources = []
    for s in SOURCES:
        commit = git("log", "-1", "--format=%H", "--", s)
        if not commit:
            sys.exit(f"no commit for {s}: the generator needs the Git history")
        sources.append({"path": s, "commit": commit, "sha256": hashlib.sha256((ROOT / s).read_bytes()).hexdigest()})
    seoul.pop("zone")
    new_york_push = new_york["push"]
    for case in new_york_push:
        case["zone"] = new_york["zone"]
        case["list"] = new_york["pushList"]
    for case in seoul["push"]:
        case["zone"] = ZONES[0]
    out = {
        "generator": "ios/tools/settings/generate.py (cases.js in the macOS JavaScriptCore shell)",
        "sources": sources,
        "note": "Steps of the Cordova settings code on iOS. A trace lists what a step did, in order: TwStorage.set (what it "
                "stores), $http (the request; Push.updateUnits's list post carries /v000902, the native app sends "
                "/v000903, #2948), $broadcast, WeatherInfo.reloadCity, $location.path, toggleLeft (the menu closes), "
                "InAppBrowser.open and $ionicPopup.alert. `location` is the string the mail row assigns to "
                "window.location.href. Units start from the Korean defaults; the stored push list is `pushList` with "
                "token `token-a` unless a push case says otherwise; `now` is the clock of the request's timezoneOffset.",
        **{k: v for k, v in seoul.items() if k != "push"},
        "push": seoul["push"] + new_york_push,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(out, ensure_ascii=False, indent=1) + "\n"
    summary = f"{len(out['lists'])} lists, {len(out['push'])} push cases, {len(out['menu'])} menu rows"
    if OUT.exists() and OUT.read_text(encoding="utf-8") == text:
        print(f"unchanged: {OUT.relative_to(ROOT)} ({summary})")
    else:
        OUT.write_text(text, encoding="utf-8")
        print(f"wrote {OUT.relative_to(ROOT)} ({summary})")


if __name__ == "__main__":
    main()
