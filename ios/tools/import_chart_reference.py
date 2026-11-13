#!/usr/bin/env python3
"""Copy the Cordova chart scenes captured for Android into the iOS core's tests, byte for byte, with provenance.

android/tools/chart-reference/capture.sh recorded the SVG that the Cordova chart directives (ngShortChart,
ngShortDetailChart, ngMidChart) drew in the Cordova Android build, for corpus fixtures at three screen sizes. The
Swift chart scenes (TWDomain Chart*) are checked against this copy with the Android metrics, and against the
Cordova iOS captures of ios/tools/chart-reference with the iOS metrics. The iOS build and tests never read
android/. The tool is deterministic: re-running it without changes in the source leaves ios/ unchanged.

Copied: every tracked `*.json` file of android/core-domain/src/test/resources/chart-reference/ (the scenes
`<WxH>/<fixture>.json`, `<WxH>/capture.json` and the Android capture provenance `provenance.json`), except
`tolerances.json` (screenshot tolerances of the Android renderer). The PNG captures of the Android WebView are not
copied: the iOS screenshots are compared with captures of the Cordova iOS build.

Outputs (paths relative to ios/):
  Core/Tests/TWDomainTests/ChartReference/android/**   the copies, same relative paths
  provenance/chart-reference.json                      source path, last commit and SHA-256 of every copy

Usage: python3 ios/tools/import_chart_reference.py   (from anywhere inside the repository; needs full Git history)
"""
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IOS = ROOT / "ios"
SOURCE = ROOT / "android" / "core-domain" / "src" / "test" / "resources" / "chart-reference"
OUTPUT = IOS / "Core" / "Tests" / "TWDomainTests" / "ChartReference" / "android"
PROVENANCE = IOS / "provenance" / "chart-reference.json"
SKIPPED = {"tolerances.json": "screenshot tolerances of the Android renderer (Robolectric), not used on iOS"}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git(*args) -> str:
    return subprocess.run(["git", "-C", str(ROOT), *args], check=True, capture_output=True, text=True).stdout


def tracked_files():
    """The reference files from Git, so untracked or ignored local files are never copied."""
    rel = SOURCE.relative_to(ROOT).as_posix()
    files = sorted(filter(None, git("ls-files", "-z", "--", rel).split("\0")))
    if not files:
        sys.exit(f"no tracked files in {rel}")
    for f in files:
        if not (ROOT / f).is_file():
            sys.exit(f"tracked file missing from the checkout: {f}")
    return [ROOT / f for f in files]


def last_commits(paths):
    """Last commit that touched each path, from one `git log` walk."""
    wanted = {p.relative_to(ROOT).as_posix() for p in paths}
    found, commit = {}, None
    for line in git("log", "--format=@%H", "--name-only", "--", *sorted(wanted)).splitlines():
        if line.startswith("@"):
            commit = line[1:]
        elif line in wanted and line not in found:
            found[line] = commit
    missing = wanted - found.keys()
    if missing:
        sys.exit(f"no commit found for {sorted(missing)[:3]} (needs full history and committed sources)")
    return found


def main():
    tracked = tracked_files()
    sources = [p for p in tracked if p.suffix == ".json" and p.relative_to(SOURCE).as_posix() not in SKIPPED]
    not_copied = sorted(p.relative_to(ROOT).as_posix() for p in tracked if p not in sources)
    commits = last_commits(sources)
    # Replace the copy so files removed from the source disappear here too.
    shutil.rmtree(OUTPUT, ignore_errors=True)
    records = []
    for src in sources:
        data = src.read_bytes()
        out = OUTPUT / src.relative_to(SOURCE)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)
        rel_src = src.relative_to(ROOT).as_posix()
        records.append({
            "source": rel_src,
            "commit": commits[rel_src],
            "source_sha256": sha256(data),
            "output": out.relative_to(IOS).as_posix(),
            "output_sha256": sha256(out.read_bytes()),
        })
    records.sort(key=lambda r: r["output"])
    PROVENANCE.parent.mkdir(parents=True, exist_ok=True)
    PROVENANCE.write_text(json.dumps({
        "tool": "ios/tools/import_chart_reference.py",
        "generator": "android/tools/chart-reference/capture.sh",
        "license": "Same repository and license as android/ and client/ (TodayWeather, WizardFactory)",
        "skipped": {
            "rule": "PNG captures of the Android WebView and the Android screenshot tolerances are not copied",
            "files": [{"source": f, "reason": SKIPPED.get(Path(f).name, "Android WebView capture (PNG)")}
                      for f in not_copied],
        },
        "files": records,
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"imported {len(records)} chart reference files; provenance in {PROVENANCE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
