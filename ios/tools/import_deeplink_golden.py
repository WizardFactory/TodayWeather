#!/usr/bin/env python3
"""Copy the shared deep link golden vectors into the iOS core's tests, byte for byte, with a provenance record.

specs/deeplink.golden.json holds the parse and share cases of the `link.todayweather.ai` contract (specs/deeplink.md
§8), which the edge function, the web app and Android check too. The Swift parser in ios/Core is checked against this
copy; the iOS build and tests never read specs/ or packages/ (#3097). The catalog cities the links name
(`packages/weather-core` `PLACES`: slug, name, address, country, coordinates) are extracted from the web source too, so
the Swift catalog is checked against both. The tool is deterministic: re-running it without a change in the sources
leaves ios/ unchanged, and CI checks that.

Outputs (paths relative to ios/):
  Core/Tests/TWDomainTests/DeepLink/deeplink.golden.json   the vectors, same bytes
  Core/Tests/TWDomainTests/DeepLink/places.json            the web catalog's PLACES rows, in order
  provenance/deeplink-golden.json                          source path, last commit and SHA-256 of source and output

Usage: python3 ios/tools/import_deeplink_golden.py   (from anywhere inside the repository; needs full Git history)
"""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IOS = ROOT / "ios"
SOURCE = ROOT / "specs" / "deeplink.golden.json"
OUTPUT = IOS / "Core" / "Tests" / "TWDomainTests" / "DeepLink" / "deeplink.golden.json"
PLACES_SOURCE = ROOT / "packages" / "weather-core" / "src" / "index.ts"
PLACES_OUTPUT = OUTPUT.parent / "places.json"
PROVENANCE = IOS / "provenance" / "deeplink-golden.json"
# A row of `export const PLACES`: ["seoul", "서울", "서울특별시 중구", "KR", 37.567, 126.978],
ROW = re.compile(r'^\s*\["([a-z0-9-]+)", "([^"]*)", "([^"]*)", "([A-Z]{2})", (-?[\d.]+), (-?[\d.]+)\],?\s*$')


def git(*args) -> str:
    return subprocess.run(["git", "-C", str(ROOT), *args], check=True, capture_output=True, text=True).stdout.strip()


def commit_of(path: Path) -> str:
    rel = path.relative_to(ROOT).as_posix()
    if not git("ls-files", "--", rel):
        sys.exit(f"{rel} is not tracked")
    commit = git("log", "-1", "--format=%H", "--", rel)
    if not commit:
        sys.exit(f"no commit found for {rel} (needs full history)")
    return commit


def record(source: Path, output: Path) -> dict:
    return {
        "source": source.relative_to(ROOT).as_posix(),
        "commit": commit_of(source),
        "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "output": output.relative_to(IOS).as_posix(),
        "output_sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
    }


def places() -> list:
    lines = PLACES_SOURCE.read_text(encoding="utf-8").splitlines()
    start = next((i for i, line in enumerate(lines) if line.startswith("export const PLACES")), None)
    if start is None:
        sys.exit("no `export const PLACES` in packages/weather-core/src/index.ts")
    rows = []
    for line in lines[start + 1:]:
        match = ROW.match(line)
        if not match:
            break
        slug, name, address, country, lat, lon = match.groups()
        rows.append({"id": slug, "name": name, "address": address, "country": country,
                     "lat": float(lat), "lon": float(lon)})
    if not rows:
        sys.exit("no PLACES rows found")
    return rows


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_bytes(SOURCE.read_bytes())
    PLACES_OUTPUT.write_text(json.dumps(places(), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    PROVENANCE.write_text(json.dumps({
        "tool": "ios/tools/import_deeplink_golden.py",
        "license": "Same repository and license as specs/ and packages/ (TodayWeather, WizardFactory)",
        "files": [record(SOURCE, OUTPUT), record(PLACES_SOURCE, PLACES_OUTPUT)],
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"copied the deep link vectors and the catalog; provenance in {PROVENANCE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
