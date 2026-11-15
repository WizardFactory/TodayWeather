#!/usr/bin/env python3
"""Copy the Android golden corpus into the iOS core's tests, byte for byte, with a provenance record.

The corpus holds outputs of the Cordova client code, generated under Node by android/tools/corpus/generate.mjs
(inputs, expected outputs and the record of the client sources it ran). The Swift port in ios/Core is checked
against this copy; the iOS build and tests never read android/. The tool is deterministic: re-running it without
changes in the source corpus leaves ios/ unchanged.

Outputs (paths relative to ios/):
  Core/Tests/TWDomainTests/Corpus/**   every file of android/core-domain/src/test/resources/corpus/, same paths
  provenance/corpus.json               source path, last commit and SHA-256 of source and output for every file

Usage: python3 ios/tools/import_corpus.py   (from anywhere inside the repository; needs full Git history)
"""
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IOS = ROOT / "ios"
SOURCE = ROOT / "android" / "core-domain" / "src" / "test" / "resources" / "corpus"
OUTPUT = IOS / "Core" / "Tests" / "TWDomainTests" / "Corpus"
PROVENANCE = IOS / "provenance" / "corpus.json"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git(*args) -> str:
    return subprocess.run(["git", "-C", str(ROOT), *args], check=True, capture_output=True, text=True).stdout


def tracked_files():
    """The corpus files from Git, so untracked or ignored local files are never copied."""
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
    sources = tracked_files()
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
        "tool": "ios/tools/import_corpus.py",
        "generator": "android/tools/corpus/generate.mjs",
        "license": "Same repository and license as android/ and client/ (TodayWeather, WizardFactory)",
        "files": records,
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"imported {len(records)} corpus files; provenance in {PROVENANCE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
