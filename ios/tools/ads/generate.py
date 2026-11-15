#!/usr/bin/env python3
"""Golden ads and analytics decisions of the Cordova iOS app (IN-15, #2964).

    python3 ios/tools/ads/generate.py [--jsc PATH] [--cc PATH]

- The #2945 request rule: client/scripts/ios-ad-request-rule.h, the plain C function the Cordova build copies into the
  AdMob plugin, compiled with the system C compiler and run for every ATT status and consent case of cases.json.
- The JavaScript decisions: cases.js runs client/www/js/service.monetization.js (Remote Config validation, the event
  schema, screens, the att_status user property) and service.admobemi.js (the request_policy line) in the macOS
  JavaScriptCore shell, the engine of the Cordova iOS app.

Writes ios/Core/Tests/TWDomainTests/AdsReference/ads-golden.json with each source's last commit and SHA-256. Only this
tool reads client/; the iOS build and tests read the written file. The output is deterministic: running it again
without source changes changes nothing (CI checks that).
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
RULE = "client/scripts/ios-ad-request-rule.h"
SOURCES = [RULE, "client/www/js/service.monetization.js", "client/www/js/service.admobemi.js"]
OUT = ROOT / "ios" / "Core" / "Tests" / "TWDomainTests" / "AdsReference" / "ads-golden.json"
DEFAULT_JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc"


def git(*args) -> str:
    return subprocess.run(["git", "-C", str(ROOT), *args], check=True, capture_output=True, text=True).stdout.strip()


def c_bytes(text):
    """A C string literal of the UTF-8 bytes, octal escapes only (a NUL ends the C string, as UTF8String's would)."""
    return '"' + "".join(f"\\{b:03o}" for b in text.encode("utf-8")) + '"'


def run_rule(cc: str, rule_cases: dict) -> list:
    rows = [(att, gdpr, purposes) for att in rule_cases["att"] for gdpr in rule_cases["gdprApplies"]
            for purposes in rule_cases["purposeConsents"]]
    lines = ['#include <stdio.h>', f'#include "{ROOT / RULE}"', "int main(void) {"]
    for att, gdpr, purposes in rows:
        arg = "0" if purposes is None else c_bytes(purposes)
        lines.append(f'    printf("%s %d\\n", tw_att_status_name({att}L), '
                     f'tw_ad_request_personalized({att}L, {gdpr}, {arg}));')
    lines += ["    return 0;", "}"]
    with tempfile.TemporaryDirectory() as tmp:
        src, exe = Path(tmp) / "rule.c", Path(tmp) / "rule"
        src.write_text("\n".join(lines) + "\n", encoding="utf-8")
        subprocess.run([cc, "-std=c99", "-Wall", "-Werror", "-o", str(exe), str(src)], check=True)
        output = subprocess.run([str(exe)], check=True, capture_output=True, text=True).stdout.splitlines()
    if len(output) != len(rows):
        sys.exit("the rule driver printed an unexpected number of lines")
    result = []
    for (att, gdpr, purposes), line in zip(rows, output):
        name, personalized = line.split(" ")
        result.append({"att": att, "gdprApplies": gdpr, "purposeConsents": purposes, "attName": name,
                       "personalized": personalized == "1"})
    return result


def run_js(jsc: str) -> dict:
    env = {"PATH": "/usr/bin:/bin", "TZ": "UTC", "LANG": "en_US.UTF-8", "LC_ALL": "en_US.UTF-8"}
    args = [jsc, str(HERE / "cases.js"), "--", str(ROOT / SOURCES[1]), str(ROOT / SOURCES[2]), str(HERE / "cases.json")]
    proc = subprocess.run(args, env=env, capture_output=True, text=True, cwd=str(ROOT))
    if proc.returncode != 0 or not proc.stdout.strip():
        sys.exit(f"jsc run failed (exit {proc.returncode}):\n{proc.stdout[-2000:]}{proc.stderr[-2000:]}")
    return json.loads(proc.stdout)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--jsc", default=DEFAULT_JSC)
    parser.add_argument("--cc", default="cc")
    args = parser.parse_args()
    for s in SOURCES:
        if not (ROOT / s).is_file():
            sys.exit(f"missing {s}: the generator needs client/ (the iOS build reads only the written copy)")
    if not os.access(args.jsc, os.X_OK):
        sys.exit(f"no JavaScriptCore shell at {args.jsc}")
    cases = json.loads((HERE / "cases.json").read_text(encoding="utf-8"))
    sources = []
    for s in SOURCES:
        commit = git("log", "-1", "--format=%H", "--", s)
        if not commit:
            sys.exit(f"no commit for {s}: the generator needs the Git history")
        sources.append({"path": s, "commit": commit, "sha256": hashlib.sha256((ROOT / s).read_bytes()).hexdigest()})
    out = {
        "generator": "ios/tools/ads/generate.py (the C rule compiled with cc; cases.js in the macOS JavaScriptCore shell)",
        "sources": sources,
        "requestRule": run_rule(args.cc, cases["requestRule"]),
        **run_js(args.jsc),
    }
    text = json.dumps(out, ensure_ascii=False, indent=1) + "\n"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    if OUT.exists() and OUT.read_text(encoding="utf-8") == text:
        print(f"unchanged: {OUT.relative_to(ROOT)}")
    else:
        OUT.write_text(text, encoding="utf-8")
        print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
