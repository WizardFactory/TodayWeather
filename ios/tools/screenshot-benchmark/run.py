#!/usr/bin/env python3
"""Build once, then compare diagnostic PNG modes on a dedicated iOS simulator."""
import argparse
import csv
import json
import os
from pathlib import Path
import re
import shutil
import statistics
import subprocess
import time
import uuid

REPO = Path(__file__).resolve().parents[3]
FIXTURES = REPO / "ios/TodayWeatherTests"
APP = "net.wizardfactory.todayweather"
DEVICES = ("375x667", "393x852", "440x956")
LANGUAGES = ("ko-KR", "en-US")
SELECTORS = (
    "NationScreenshotTests/pagesMatchTheCordovaPages()",
    "MatrixScreenshotTests/alarmsPage(size:language:)",
    "MatrixScreenshotTests/weatherPages(size:language:)",
    "MatrixScreenshotTests/sideMenu(size:language:)",
)
PHASES = ("render", "decode", "blur", "compare", "png", "hash")
PAIRS = (("all", "failures"), ("failures", "all"), ("all", "failures"))


def run(*args, **kwargs):
    return subprocess.run(args, cwd=REPO, check=True, **kwargs)


def output(*args):
    return run(*args, text=True, stdout=subprocess.PIPE).stdout.strip()


def save(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def expected_cases():
    states = json.loads((FIXTURES / "NationReference/nation-captures.json").read_text())["states"]
    cases = {"nation-" + state: {"method": SELECTORS[0], "size": "393x852", "locale": "ko-KR"} for state in states}
    for device in DEVICES:
        for language in LANGUAGES:
            if device == "393x852" and language == "ko-KR":
                continue
            prefix = f"matrix-{device}-{language}"
            if device != "393x852":
                for state in ("settings", "picker", "confirm"):
                    cases[f"{prefix}-push-{state}"] = {"method": SELECTORS[1], "size": device, "locale": language}
            manifest = json.loads((FIXTURES / "MatrixReference" / f"{prefix}-forecast-captures.json").read_text())
            for page in ("kma-seoul-hourly", "kma-seoul-daily"):
                for block in manifest["pages"][page]["blocks"]:
                    cases[f"{prefix}-forecast-{page}-{block['index']}"] = {
                        "method": SELECTORS[2], "size": device, "locale": language,
                    }
            if device != "393x852":
                for part in ("menu", "tabs", "header"):
                    cases[f"{prefix}-shell-{part}"] = {"method": SELECTORS[3], "size": device, "locale": language}
    return cases


def read_records(log):
    records = {}
    for line in log.read_text(errors="replace").splitlines():
        _, marker, payload = line.partition("TW-SCREENSHOT ")
        if marker and payload.startswith("{"):
            record = json.loads(payload)
            name = record["name"]
            if name in records:
                raise RuntimeError(f"Duplicate comparison in {log}: {name}")
            records[name] = record
    return records


def trial(args, name, mode, expected, mismatch=None, timed=True):
    directory = args.out / name
    directory.mkdir()
    # Relative paths are resolved in the app's own temporary directory.
    suffix = f"chart-compare-{uuid.uuid4()}-{name}"
    env = dict(os.environ, TEST_RUNNER_TW_SCREENSHOT_CAPTURE=mode,
               TEST_RUNNER_TW_SCREENSHOT_TIMING="on" if timed else "off",
               TEST_RUNNER_TW_SCREENSHOT_OUTPUT=suffix,
               TEST_RUNNER_TW_SCREENSHOT_MISMATCH=mismatch or "")
    selectors = SELECTORS[:1] if mismatch else SELECTORS
    command = ["xcodebuild", "-xctestrun", str(args.xctestrun), "-destination", f"id={args.device}",
               "-parallel-testing-enabled", "NO", "-collect-test-diagnostics", "never", "-resultBundlePath", str(directory / "tests.xcresult"),
               *(f"-only-testing:TodayWeatherTests/{item}" for item in selectors), "test-without-building"]
    print(f"{name}: {mode}", flush=True)
    started = time.monotonic()
    with (directory / "xcodebuild.log").open("w") as log:
        result = subprocess.run(command, cwd=REPO, env=env, stdout=log, stderr=subprocess.STDOUT)
    wall = time.monotonic() - started
    records = read_records(directory / "xcodebuild.log")
    save(directory / "cases.json", records)
    if result.returncode != (65 if mismatch else 0):
        raise RuntimeError(f"Unexpected exit {result.returncode}: {directory}/xcodebuild.log")
    if timed and records.keys() != expected.keys():
        raise RuntimeError(f"{name}: missing {sorted(expected.keys() - records.keys())}, unexpected {sorted(records.keys() - expected.keys())}")
    if any(row["passed"] != (key != mismatch) for key, row in records.items()):
        raise RuntimeError(f"{name}: unexpected comparison verdict")
    container = Path(output("xcrun", "simctl", "get_app_container", args.device, APP, "data"))
    images = list((container / "tmp" / suffix).glob("*.png"))
    expected_images = {f"{case}-{kind}.png" for case in (expected if mode == "all" else [mismatch] if mismatch else [])
                       for kind in ("native", "diff")}
    if {image.name for image in images} != expected_images:
        raise RuntimeError(f"{name}: incorrect PNG set in {container / 'tmp' / suffix}")
    if mismatch:
        artifacts = directory / "diagnostics"
        artifacts.mkdir()
        for image in images:
            output("sips", "-g", "pixelWidth", "-g", "pixelHeight", str(image))
            shutil.copy2(image, artifacts / image.name)
    matches = re.findall(r"Test run with .*?(?:passed|failed) after ([0-9.]+) seconds",
                         (directory / "xcodebuild.log").read_text(errors="replace"))
    if len(matches) != 1:
        raise RuntimeError(f"{name}: expected one Swift Testing run, saw {matches}")
    stats = {"mode": mode, "commandWall": wall, "wall": float(matches[0]), "images": len(images), "bytes": sum(image.stat().st_size for image in images)}
    stats.update({phase: sum(row[phase] for row in records.values()) for phase in PHASES})
    stats["residual"] = stats["wall"] - sum(stats[phase] for phase in PHASES)
    stats["byMethod"] = {
        method: {phase: sum(row[phase] for case, row in records.items() if expected[case]["method"] == method)
                 for phase in PHASES}
        for method in selectors
    }
    save(directory / "summary.json", stats)
    if records:
        with (directory / "cases.csv").open("w", newline="") as stream:
            rows = [{**row, **expected[key]} for key, row in records.items()]
            writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
    return stats, records


def compare_runs(baseline, candidate):
    contract = ("reference", "passed", "nativeSize", "referenceSize")
    measurements = ("strong", "mean", "height")
    for case, original in baseline.items():
        other = candidate[case]
        if any(original[key] != other[key] for key in contract) or original["hashes"][1] != other["hashes"][1]:
            raise RuntimeError(f"{case}: changed comparison input, size or verdict")
        if case == "nation-nation-loading" and original["hashes"][0] != other["hashes"][0]:
            # The captured loading indicator's timeline varies between launches.
            print(f"{case}: spinner animation changed the input bitmap", flush=True)
            continue
        if original["hashes"] != other["hashes"] or any(original[key] != other[key] for key in measurements):
            raise RuntimeError(f"{case}: changed bitmap, comparison metrics or mask")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True, help="Dedicated booted simulator UUID")
    parser.add_argument("--xctestrun", type=Path, required=True, help="Output from Debug build-for-testing")
    parser.add_argument("--out", type=Path, required=True, help="New evidence directory")
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--smoke", action="store_true", help="Run only the induced-failure test")
    selection.add_argument("--benchmark-only", action="store_true", help="Reuse independently verified failure-path evidence")
    parser.add_argument("--warm-all-log", type=Path, help="Reuse a passing warmup from the same test binary")
    args = parser.parse_args()
    args.out = args.out.resolve()
    args.xctestrun = args.xctestrun.resolve(strict=True)
    args.out.mkdir(parents=True)
    expected = expected_cases()
    save(args.out / "manifest.json", expected)
    save(args.out / "environment.json", {
        "revision": output("git", "rev-parse", "HEAD"), "xcode": output("xcodebuild", "-version"),
        "macOS": output("sw_vers"), "hardware": output("sysctl", "-n", "hw.model"),
        "simulator": next(device for devices in json.loads(output("xcrun", "simctl", "list", "devices", "booted", "-j"))["devices"].values()
                          for device in devices if device["udid"] == args.device),
        "xctestrun": str(args.xctestrun),
    })
    nation = {name: value for name, value in expected.items() if name.startswith("nation-")}
    if not args.benchmark_only:
        trial(args, "mismatch", "failures", nation, mismatch=min(nation))
    if args.smoke:
        return
    if args.warm_all_log:
        baseline = read_records(args.warm_all_log)
        log_text = args.warm_all_log.read_text(errors="replace")
        if (baseline.keys() != expected.keys() or any(not row["passed"] for row in baseline.values())
                or not re.search(r"Test run with .* passed after [0-9.]+ seconds", log_text)):
            raise RuntimeError("The capture-all warmup did not pass every expected comparison")
        reuse = args.out / "warm-all"
        reuse.mkdir()
        shutil.copy2(args.warm_all_log, reuse / "xcodebuild.log")
        save(reuse / "cases.json", baseline)
    else:
        _, baseline = trial(args, "warm-all", "all", expected)
    _, warm_failures = trial(args, "warm-failures", "failures", expected)
    compare_runs(baseline, warm_failures)
    control, _ = trial(args, "control", "all", expected, timed=False)
    groups = {"all": [], "failures": []}
    savings = []
    for i, order in enumerate(PAIRS, 1):
        pair = {}
        for mode in order:
            stats, records = trial(args, f"pair-{i}-{mode}", mode, expected)
            compare_runs(baseline, records)
            groups[mode].append(stats)
            pair[mode] = stats["wall"]
        savings.append(pair["all"] - pair["failures"])
    noise = max(max(row["wall"] for row in group) - min(row["wall"] for row in group) for group in groups.values())
    saved = statistics.median(savings)
    summary = {"pairedSavingsSeconds": savings, "repeatNoiseSeconds": noise, "medianSavingSeconds": saved,
               "repeatable": min(savings) > 0 and saved > 2 * noise, "comparisonCount": len(expected),
               "control": control, "trials": groups,
               "medianInstrumentationOverheadSeconds": statistics.median(row["wall"] for row in groups["all"]) - control["wall"],
               "captureAllMedianPhaseShare": {phase: statistics.median(row[phase] / row["wall"] for row in groups["all"])
                                               for phase in (*PHASES, "residual")}}
    save(args.out / "summary.json", summary)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
