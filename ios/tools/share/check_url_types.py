#!/usr/bin/env python3
"""Which URL schemes and associated domains the Cordova iOS build registers (IN-16, #2965).

    python3 ios/tools/share/check_url_types.py [--app PATH/TodayWeather.app] [--work DIR]

The shipped 1.1.1 IPA is not in this repository, so the build's inputs are read instead:

1. client/config.xml: every `config-file`/`edit-config` for `CFBundleURLTypes` or associated domains;
2. every Cordova package of client/package.json's devDependencies, as client/package-lock.json pins it: the tarball is
   downloaded from its `resolved` URL into DIR (a new temporary directory by default) and refused unless its SHA-512
   equals the lock file's `integrity`, then its plugin.xml and scripts are searched for `CFBundleURLTypes`,
   `CFBundleURLSchemes` and `associated-domains`;
3. with --app, the `CFBundleURLTypes` of a Cordova iOS build's Info.plist (ios/tools/chart-reference/build-cordova.sh or
   ios/tools/upgrade/build-cordova.sh) and its `com.apple.developer.associated-domains` entitlement.

It prints what it found and exits 1 when a `todayweather` scheme appears anywhere. It reads client/ and the npm
registry; the iOS build does not use it.
"""
import argparse
import base64
import hashlib
import json
import plistlib
import re
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PATTERN = re.compile(rb"CFBundleURLTypes|CFBundleURLSchemes|associated-domains|todayweather://")


def config_entries() -> list[str]:
    text = (ROOT / "client" / "config.xml").read_text(encoding="utf-8")
    return [line.strip() for line in text.splitlines()
            if re.search(r"CFBundleURL|associated-domains|applinks:|todayweather://", line)]


def plugin_hits(work: Path) -> dict[str, list[str]]:
    deps = json.loads((ROOT / "client" / "package.json").read_text(encoding="utf-8"))["devDependencies"]
    lock = json.loads((ROOT / "client" / "package-lock.json").read_text(encoding="utf-8"))["packages"]
    hits: dict[str, list[str]] = {}
    for name in sorted(deps):
        entry = lock.get(f"node_modules/{name}", {})
        resolved = entry.get("resolved", "")
        if not resolved.startswith("https://"):
            # A local plugin (file:local-plugins/...): search its checked-in directory.
            folder = ROOT / "client" / resolved if resolved else None
            files = [p for p in folder.rglob("*") if p.is_file()] if folder and folder.is_dir() else []
            hits[name] = [str(p.relative_to(folder)) for p in files if PATTERN.search(p.read_bytes())]
            continue
        if "cordova" not in name and "plugin" not in name:
            continue
        data = urllib.request.urlopen(resolved, timeout=60).read()
        algo, digest = entry["integrity"].split("-", 1)
        if algo != "sha512" or base64.b64encode(hashlib.sha512(data).digest()).decode() != digest:
            sys.exit(f"{name}: tarball does not match package-lock.json's integrity")
        target = work / name.replace("/", "_")
        target.mkdir(parents=True, exist_ok=True)
        archive = work / (target.name + ".tgz")
        archive.write_bytes(data)
        with tarfile.open(archive) as tar:
            members = [m for m in tar.getmembers() if m.isfile() and
                       (m.name.endswith("plugin.xml") or "/scripts/" in m.name or "/hooks/" in m.name)]
            hits[name] = [m.name for m in members if PATTERN.search(tar.extractfile(m).read())]
    return hits


def app_entries(app: Path) -> tuple[list[str], list[str]]:
    info = plistlib.loads((app / "Info.plist").read_bytes())
    schemes = [s for t in info.get("CFBundleURLTypes", []) for s in t.get("CFBundleURLSchemes", [])]
    proc = subprocess.run(["codesign", "-d", "--entitlements", ":-", str(app)], capture_output=True)
    domains: list[str] = []
    if proc.returncode == 0 and proc.stdout.strip():
        domains = plistlib.loads(proc.stdout).get("com.apple.developer.associated-domains", [])
    return schemes, domains


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--app", type=Path)
    parser.add_argument("--work", type=Path)
    args = parser.parse_args()
    work = args.work or Path(tempfile.mkdtemp(prefix="tw-url-types-"))
    found = False
    entries = config_entries()
    print(f"client/config.xml: {entries or 'no URL type or associated-domain entry'}")
    found |= any("todayweather" in e.lower() for e in entries)
    for name, files in plugin_hits(work).items():
        print(f"{name}: {', '.join(files) if files else 'no URL type entry'}")
    if args.app:
        schemes, domains = app_entries(args.app)
        print(f"{args.app.name} Info.plist CFBundleURLSchemes: {schemes}; associated domains: {domains}")
        found |= any(s.lower() == "todayweather" for s in schemes)
    print("todayweather scheme: " + ("REGISTERED" if found else "not registered"))
    sys.exit(1 if found else 0)


if __name__ == "__main__":
    main()
