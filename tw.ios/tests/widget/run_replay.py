#!/usr/bin/env python3
"""Prepare or run an isolated source-built legacy widget UIKit replay.

Preparation copies resources and writes build-command.json; it never compiles.
The coordinator launches/counts that command under the task's build-attempt cap.
Simulator execution requires an explicit receipt identifying a task-owned device.
"""
import argparse
from datetime import datetime, timedelta
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import time

HERE = Path(__file__).resolve().parent
BUNDLE = "ai.todayweather.local.widgetdailyreplay"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def prepare(args):
    out = args.out.resolve()
    if out.exists():
        raise SystemExit("new output directory required")
    objects = sorted(args.objects.resolve().glob("*.o"))
    if len(objects) != 3 or not all(any(p.name.startswith(name + "-") for p in objects) for name in ("TodayViewController", "TodayWeatherShowMore", "TodayWeatherUtil")):
        raise SystemExit("exactly the three actual widget objects are required")
    out.mkdir(parents=True)
    app = out / "WidgetDailyReplay.app"
    app.mkdir()
    for source in args.resources.resolve().iterdir():
        if source.suffix == ".lproj" or source.name in ("MainInterface.storyboardc", "weatherIcon2-color"):
            shutil.copytree(source, app / source.name) if source.is_dir() else shutil.copy2(source, app / source.name)
    raw_bytes = args.capture.read_bytes()
    body = json.loads(raw_bytes)
    (app / "body.json").write_bytes(raw_bytes)
    fixture = json.loads((HERE / "fixtures/daily.json").read_text())
    yesterday = datetime.now().astimezone() - timedelta(days=1)
    for case in fixture["cases"]:
        if case.get("date_offsets"):
            for index, row in enumerate(case["body"]["midData"]["dailyData"]):
                row["date"] = (yesterday + timedelta(days=index)).strftime("%Y%m%d")
            case["expected"]["dates"][3:] = [(yesterday + timedelta(days=i)).strftime("%m/%d") for i in range(3, 6)]
    for unit in ("C", "F"):
        suffix = unit.lower()
        current = body["thisTime"][1] if len(body["thisTime"]) == 2 else body["thisTime"][0]
        today = next(row for row in body["daily"] if row["date"][:10] == current["date"][:10])
        rows = body["daily"][:6]
        expected = {
            "current": f'{float(current["temp_c"]):.1f}˚' if unit == "C" else f'{int(current["temp_f"])}˚',
            "daily": f'{int(today["tempMin_"+suffix])}˚/ {int(today["tempMax_"+suffix])}˚',
            "time": current["date"][11:],
            "temperatures": [f'{int(row["tempMin_"+suffix])}˚/{int(row["tempMax_"+suffix])}˚' for row in rows],
            "dates": ["Yesterday", "Today", "Tomorrow"] + [row["date"][5:7]+"/"+row["date"][8:10] for row in rows[3:]],
            "icons": 6, "selected_rows": 6,
        }
        fixture["cases"].append({"id": "functional-" + unit, "unit": unit, "functional": True, "body": body, "expected": expected})
    write(app / "cases.json", fixture)
    info = {
        "CFBundleExecutable": "WidgetDailyReplay", "CFBundleIdentifier": BUNDLE,
        "CFBundleName": "Widget Daily Replay", "CFBundleDisplayName": "Widget Daily Replay",
        "CFBundlePackageType": "APPL", "CFBundleVersion": "1", "CFBundleShortVersionString": "1.0",
        "LSRequiresIPhoneOS": True, "MinimumOSVersion": "15.0", "UIDeviceFamily": [1, 2],
        "UILaunchScreen": {}, "NSAppTransportSecurity": {"NSAllowsArbitraryLoads": True},
        "UISupportedInterfaceOrientations": ["UIInterfaceOrientationPortrait"],
    }
    (app / "Info.plist").write_bytes(plistlib.dumps(info))
    sdk = subprocess.check_output(["xcrun", "--sdk", "iphonesimulator", "--show-sdk-path"], text=True).strip()
    command = ["xcrun", "clang", "-target", "arm64-apple-ios15.0-simulator", "-isysroot", sdk,
               "-fobjc-arc", "-fblocks", "-I", str(args.headers.resolve()), str(HERE / "WidgetDailyReplay.m"),
               *map(str, objects), "-framework", "UIKit", "-framework", "Foundation", "-framework", "CoreLocation",
               "-framework", "NotificationCenter", "-o", str(app / "WidgetDailyReplay")]
    write(out / "build-command.json", command)
    write(out / "codesign-command.json", ["codesign", "--force", "--sign", "-", str(app)])
    write(out / "inputs.json", {"object_sha256": {str(p): digest(p) for p in objects},
                               "capture_sha256": digest(args.capture), "test_source_sha256": digest(HERE / "WidgetDailyReplay.m"),
                               "fixture_sha256": digest(HERE / "fixtures/daily.json"), "product_resources": str(args.resources.resolve()),
                               "prepared_at": datetime.now().astimezone().isoformat(), "build_executed": False})
    print(out / "build-command.json")


def run(args):
    receipt = json.loads(args.owned_device.read_text())
    if not receipt.get("owned") or receipt.get("udid") != args.udid:
        raise SystemExit("matching task-owned Simulator receipt required")
    app = args.app.resolve()
    if not (app / "WidgetDailyReplay").is_file():
        raise SystemExit("source-built replay executable is missing")
    out = args.out.resolve()
    if out.exists():
        raise SystemExit("new run output directory required")
    out.mkdir(parents=True)
    env = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "DEVELOPER_DIR") if key in os.environ}
    commands = []

    def execute(command, allow_failure=False, child_env=None):
        result = subprocess.run(command, env=child_env or env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        commands.append({"command": command, "exit": result.returncode})
        (out / "commands.log").open("a").write(result.stdout + "\n")
        if result.returncode and not allow_failure:
            write(out / "commands.json", commands)
            raise SystemExit(f"Simulator command failed ({result.returncode}); see commands.log")
        return result.stdout.strip()

    execute(["xcrun", "simctl", "install", args.udid, str(app)])
    child = dict(env, SIMCTL_CHILD_REPLAY_CASE=args.case)
    execute(["xcrun", "simctl", "terminate", args.udid, BUNDLE], allow_failure=True)
    started = time.time()
    execute(["xcrun", "simctl", "launch", args.udid, BUNDLE, "-AppleLanguages", "(en)", "-AppleLocale", "en_US"], child_env=child)
    container = Path(execute(["xcrun", "simctl", "get_app_container", args.udid, BUNDLE, "data"]))
    result_path = container / "Documents" / f"receipt-{args.case}.json"
    # A launch may replace an earlier receipt; insist on this launch's mtime.
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if result_path.is_file() and result_path.stat().st_mtime >= started:
            data = json.loads(result_path.read_text())
            write(out / "receipt.json", data)
            execute(["xcrun", "simctl", "io", args.udid, "screenshot", str(out / "screen.png")])
            execute(["xcrun", "simctl", "terminate", args.udid, BUNDLE], allow_failure=True)
            write(out / "commands.json", commands)
            print(data["verdict"])
            raise SystemExit(0 if data["verdict"] == "PASS" else 1)
        time.sleep(0.25)
    write(out / "commands.json", commands)
    raise SystemExit("replay receipt not observed within 30 seconds")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prep = commands.add_parser("prepare")
    for name in ("objects", "resources", "headers", "capture", "out"):
        prep.add_argument("--"+name, type=Path, required=True)
    runner = commands.add_parser("run")
    for name in ("app", "owned-device", "out"):
        runner.add_argument("--"+name, type=Path, required=True)
    runner.add_argument("--udid", required=True)
    runner.add_argument("--case", default="all")
    args = parser.parse_args()
    (prepare if args.command == "prepare" else run)(args)


if __name__ == "__main__":
    main()
