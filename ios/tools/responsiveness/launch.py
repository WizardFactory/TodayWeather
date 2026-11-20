"""Repeated pristine installs on a disposable profile simulator. Requires validated reference PNGs."""
import argparse
import csv
import json
import plistlib
import shutil
import subprocess
import time
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
for arg in ["udid", "app", "fresh_reference", "upgrade_reference", "output"]:
    parser.add_argument(arg)
args = parser.parse_args()
bundle = "net.wizardfactory.todayweather"
out = Path(args.output)
out.mkdir(exist_ok=False)
simctl = ["xcrun", "simctl"]
devices = json.loads(subprocess.check_output(simctl + ["list", "devices", "--json"]))["devices"]
device = next(d for group in devices.values() for d in group if d["udid"] == args.udid)
if not device["name"].startswith("tw_profile_3029") or device["state"] != "Booted":
    raise SystemExit("Requires a booted disposable tw_profile_3029 simulator")
info = plistlib.loads((Path(args.app) / "Info.plist").read_bytes())
if info["TWServerURL"] != "http://127.0.0.1:18530" or (Path(args.app) / "GoogleService-Info.plist").exists():
    raise SystemExit("Expected local-only profile app")
seed = Path(__file__).resolve().parents[2] / "Core/Tests/TWStorageTests/Fixtures/containers/simulator/Library/WebKit"


def thumbnail(png):
    return subprocess.check_output(["ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-vf",
                                    "scale=160:200", "-vframes", "1", "-f", "rawvideo",
                                    "-pix_fmt", "rgb24", "pipe:1"], input=png)


def roi(frame, box):
    x, y, w, h = box
    return b"".join(frame[(r*160+x)*3:(r*160+x+w)*3] for r in range(y, y+h))


def matches(mode, observed, expected):
    boxes = [(58, 80, 44, 44), (1, 12, 158, 42)] if mode == "fresh" else [
        (74, 6, 13, 5), (55, 36, 50, 35), (2, 87, 153, 53)]
    for box in boxes:
        a, b = roi(observed, box), roi(expected, box)
        if sum(abs(i-j) for i, j in zip(a, b)) / len(a) > 2:
            return False
    return True


references = {k: thumbnail(Path(p).read_bytes()) for k, p in [
    ("fresh", args.fresh_reference), ("upgrade", args.upgrade_reference)]}
failures = 0
with (out / "samples.csv").open("x", buffering=1) as f:
    writer = csv.writer(f)
    writer.writerow(["batch", "run", "state", "visible_by_ms", "samples", "valid"])
    for batch in range(3):
        for run in range(1, 2 if batch == 0 else 11):
            for mode in (["fresh", "upgrade"] if run % 2 else ["upgrade", "fresh"]):
                subprocess.run(simctl + ["uninstall", args.udid, bundle], check=True, stdout=subprocess.DEVNULL)
                subprocess.run(simctl + ["install", args.udid, args.app], check=True)
                data = Path(subprocess.check_output(simctl + ["get_app_container", args.udid, bundle, "data"], text=True).strip())
                state = data / "Library/Application Support/TodayWeather/app_state.json"
                assert not state.exists()
                if mode == "upgrade":
                    shutil.copytree(seed, data / "Library/WebKit")
                start = time.monotonic()
                subprocess.run(simctl + ["launch", args.udid, bundle, "-AppleLanguages", "(en-US)",
                                         "-AppleLocale", "en_US"], check=True, stdout=subprocess.DEVNULL)
                n, valid = 0, False
                while time.monotonic() - start < 15:
                    capture = out / "observation.png"
                    subprocess.run(simctl + ["io", args.udid, "screenshot", str(capture)],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
                    png = capture.read_bytes()
                    elapsed = time.monotonic() - start
                    n += 1
                    if state.exists() and matches(mode, thumbnail(png), references[mode]):
                        app_state = json.loads(state.read_text())
                        if mode == "upgrade":
                            valid = (app_state["placeIndex"] == 2 and app_state["places"][2]["name"] == "London"
                                     and "cities=localStorage" in app_state["migration"]["source"])
                        else:
                            valid = app_state["migration"]["keys"]["cities"] == "absent"
                        break
                writer.writerow([batch, run, mode, round(elapsed*1000, 3), n, valid])
                if not valid:
                    failures += 1
                if not valid or batch == 0:
                    (out / f"{batch}-{run}-{mode}.png").write_bytes(png)

if failures:
    raise SystemExit(f"{failures} launch observations failed the visible-state check")
