"""Observe cached and fresh Seoul temperatures in a dedicated, already-seeded iPhone 16 fixture run."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import plistlib
import subprocess
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("udid")
parser.add_argument("controls", type=Path, help="JSON controls used by the running fixture server")
parser.add_argument("output", type=Path)
args = parser.parse_args()
simctl = ["xcrun", "simctl"]
bundle = "net.wizardfactory.todayweather"
devices = json.loads(subprocess.check_output(simctl + ["list", "devices", "--json"]))["devices"]
device = next(d for group in devices.values() for d in group if d["udid"] == args.udid)
if not device["name"].startswith("tw_profile_3029") or device["state"] != "Booted":
    raise SystemExit("Requires a dedicated, booted profile simulator")


def container(kind):
    return Path(subprocess.check_output(simctl + ["get_app_container", args.udid, bundle, kind], text=True).strip())


info = plistlib.loads((container("app") / "Info.plist").read_bytes())
if not info["TWServerURL"].startswith("http://127.0.0.1:"):
    raise SystemExit("Expected a loopback-only fixture build")
key = hashlib.sha256(b"coord:37.567,126.978").hexdigest()
cache = container("data") / "Library/Caches/weather" / (key + ".json")
original = cache.read_bytes()
seed = json.loads(original)
if seed["weather"]["currentWeather"]["t1h"] != 3.3:
    raise SystemExit("Seed Seoul from the captured fixture before measuring")
seed["weather"]["currentWeather"]["t1h"] = 42.8
original_controls = args.controls.read_bytes() if args.controls.exists() else None
args.output.mkdir(exist_ok=False)


def set_delay(ms):
    tmp = args.controls.with_suffix(".profile-tmp")
    tmp.write_text(json.dumps({"delay_ms": ms}))
    tmp.replace(args.controls)


def start():
    subprocess.run(simctl + ["terminate", args.udid, bundle], stderr=subprocess.DEVNULL)
    cache.write_text(json.dumps(seed, ensure_ascii=False))
    before = time.monotonic()
    subprocess.run(simctl + ["launch", args.udid, bundle, "-AppleLanguages", "(ko-KR)", "-AppleLocale", "ko_KR"],
                   check=True, stdout=subprocess.DEVNULL)
    return before


def capture(name):
    file = args.output / (name + ".png")
    subprocess.run(simctl + ["io", args.udid, "screenshot", str(file)], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    after = time.monotonic()
    pixels = subprocess.check_output(["ffmpeg", "-loglevel", "error", "-i", str(file), "-vf",
                                      "scale=160:340,crop=100:55:26:45", "-vframes", "1",
                                      "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
    return after, pixels


def distance(a, b):
    return sum(abs(x - y) for x, y in zip(a, b)) / len(a)


failures = 0
try:
    set_delay(8000)
    start()
    time.sleep(2)
    _, cold = capture("cached-reference")
    time.sleep(8)
    _, fresh = capture("fresh-reference")
    separation = distance(cold, fresh)
    if separation <= 1.5:
        raise SystemExit("Cache and fresh hero references are indistinguishable")
    set_delay(4500)
    with (args.output / "cache-visible.csv").open("x", buffering=1) as output:
        writer = csv.writer(output)
        writer.writerow(["batch", "run", "cached_by_ms", "fresh_by_ms", "cache_ok", "fresh_ok"])
        for batch in range(3):
            for run in range(1, 2 if batch == 0 else 11):
                before = start()
                cached_by = fresh_by = None
                while time.monotonic() - before < 13 and fresh_by is None:
                    after, pixels = capture("observation")
                    if cached_by is None and distance(pixels, cold) < separation * 0.18:
                        cached_by = round((after - before) * 1000, 3)
                    if distance(pixels, fresh) < separation * 0.18:
                        fresh_by = round((after - before) * 1000, 3)
                writer.writerow([batch, run, cached_by, fresh_by, cached_by is not None, fresh_by is not None])
                if cached_by is None or fresh_by is None:
                    failures += 1
finally:
    subprocess.run(simctl + ["terminate", args.udid, bundle], stderr=subprocess.DEVNULL)
    cache.write_bytes(original)
    if original_controls is None:
        args.controls.unlink(missing_ok=True)
    else:
        args.controls.write_bytes(original_controls)
if failures:
    raise SystemExit(f"{failures} runs missed at least one temperature")
