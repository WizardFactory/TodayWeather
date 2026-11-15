#!/usr/bin/env python3
"""Run the golden corpus generator under JavaScriptCore and compare every case with the Node corpus.

The corpus (android/tools/corpus/generate.mjs) runs the Cordova client code under Node (V8); the Cordova iOS app
runs the same code in JavaScriptCore. This tool runs the unchanged generator in the JavaScriptCore shell (`jsc`)
with the Node APIs it uses provided by node-shim.js, once per time zone (jsc takes its zone from the TZ of its
process; the generator switches zones with process.env.TZ), and compares the files it writes with the Node corpus:

  core-domain files  ios/Core/Tests/TWDomainTests/Corpus/  (the copy the Swift tests read)
  push.json          android/core-storage/src/test/resources/corpus/push.json

Each file is split into cases (the elements of its top-level lists, or of the lists under its top-level members;
each conversion file is one case). A case is compared, member order and number texts included, in the run of the
zone it was generated in: its own `zone` member, the zone argument of special.json, Asia/Seoul for the push and
alarm-page cases (their functions set it); every other case must be equal in every run.

Every differing value is listed with its Node and JavaScriptCore output. For those values the iOS expectation is
the JavaScriptCore output: they are recorded in ios/Core/Tests/TWDomainTests/JavaScriptCore/differences.json, which
the Swift corpus tests apply to exactly those cases.

Usage (from anywhere in the repository; macOS):
  python3 ios/tools/corpus/compare_jsc.py [--jsc PATH] [--report FILE] [--write]
Exit status 0 when the differences found are exactly the recorded ones (with --write: after recording them),
1 when they are not or a file or case is missing, 2 when a run fails.
"""
import argparse
import json
import os
import platform
import plistlib
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TOOLS = Path(__file__).resolve().parent
GENERATOR = ROOT / "android" / "tools" / "corpus" / "generate.mjs"
ANDROID_CORPUS = ROOT / "android" / "core-domain" / "src" / "test" / "resources" / "corpus"
IOS_CORPUS = ROOT / "ios" / "Core" / "Tests" / "TWDomainTests" / "Corpus"
PUSH = ROOT / "android" / "core-storage" / "src" / "test" / "resources" / "corpus" / "push.json"
DEFAULT_JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc"
JSC_FRAMEWORK_PLIST = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Resources/Info.plist"
EXPECTATIONS_REL = "ios/Core/Tests/TWDomainTests/JavaScriptCore/differences.json"
EXPECTATIONS = ROOT / EXPECTATIONS_REL
ZONES = ["Asia/Seoul", "America/New_York", "UTC"]
# Cases whose generator function sets Asia/Seoul without recording a zone in the case.
SEOUL_SECTIONS = {("push.json", None), ("alarms.json", "pages"), ("alarms.json", "taps")}


def git(*args) -> str:
    return subprocess.run(["git", "-C", str(ROOT), *args], check=True, capture_output=True, text=True).stdout


def commits_for_sources():
    """Last commit of every client file the generator may record in source.json (one `git log` walk)."""
    prefixes = ["client/www/js", "client/www/locales", "tw.ios/www/lib/ionic-timepicker/src"]
    files = set(filter(None, git("ls-files", "--", *prefixes).splitlines()))
    found, commit = {}, None
    for line in git("log", "--format=@%H", "--name-only", "--", *prefixes).splitlines():
        if line.startswith("@"):
            commit = line[1:]
        elif line in files and line not in found:
            found[line] = commit
    return found


def build_script(work: Path) -> Path:
    source = GENERATOR.read_text(encoding="utf-8")
    body = []
    for line in source.splitlines():
        if line.startswith("#!"):
            continue
        if re.match(r"^import .* from '[^']+';$", line):
            continue
        body.append(line)
    text = "\n".join(body).replace("import.meta.url", "__CONFIG.generatorUrl")
    if "import " in "\n".join(l for l in body if l.startswith("import")):
        sys.exit("unexpected import form in the generator")
    # jsc cannot list directories; the generator lists only the default weather images.
    directories = {str(d): os.listdir(d) for d in [ROOT / "client" / "www" / "img" / "weather_default"]}
    config = {"generatorUrl": "file://" + str(GENERATOR), "commits": commits_for_sources(), "directories": directories}
    script = "\n".join([
        f"const __CONFIG = {json.dumps(config)};",
        (TOOLS / "node-shim.js").read_text(encoding="utf-8"),
        "(async () => {",
        text,
        "})().then(() => {",
        "    print('@@CORPUS@@' + JSON.stringify({files: __files, zones: __zonesRequested, log: __log}));",
        "}, (e) => { print('@@ERROR@@' + e + '\\n' + (e && e.stack)); });",
    ])
    path = work / "generate.jsc.js"
    path.write_text(script, encoding="utf-8")
    return path


def run_zone(jsc: str, script: Path, zone: str):
    env = {"PATH": "/usr/bin:/bin", "TZ": zone, "LANG": "en_US.UTF-8", "LC_ALL": "en_US.UTF-8", "HOME": os.environ.get("HOME", "/tmp")}
    proc = subprocess.run([jsc, str(script)], env=env, capture_output=True, text=True, cwd=str(ROOT))
    out = proc.stdout
    if proc.returncode != 0 or "@@CORPUS@@" not in out:
        tail = (out + proc.stderr)[-4000:]
        raise RuntimeError(f"jsc run in {zone} failed (exit {proc.returncode}):\n{tail}")
    payload = json.loads(out[out.index("@@CORPUS@@") + len("@@CORPUS@@"):].strip().splitlines()[0])
    return payload


def corpus_name(written: str) -> str:
    p = Path(written)
    try:
        return p.relative_to(ANDROID_CORPUS).as_posix()
    except ValueError:
        if p == PUSH:
            return "push.json"
        raise RuntimeError(f"generator wrote an unexpected file: {written}")


def reference_text(name: str) -> str:
    path = PUSH if name == "push.json" else IOS_CORPUS / name
    return path.read_text(encoding="utf-8")


def tokens(text: str):
    """JSON with member order and number texts kept, so equality is exact up to white space."""
    return json.loads(text, object_pairs_hook=lambda pairs: ("obj", pairs), parse_float=lambda t: ("num", t),
                      parse_int=lambda t: ("num", t), parse_constant=lambda t: ("num", t))


def member(tree, key):
    if isinstance(tree, tuple) and tree[0] == "obj":
        for k, v in tree[1]:
            if k == key:
                return v
    return None


def units(name: str, tree):
    """(case id, section, value) for each case of a file."""
    if name.startswith("conversion/"):
        return [(name, None, tree)]
    out = []
    if isinstance(tree, list):
        out += [(f"{name}[{i}]", None, v) for i, v in enumerate(tree)]
    elif isinstance(tree, tuple) and tree[0] == "obj":
        for k, v in tree[1]:
            if isinstance(v, list):
                out += [(f"{name}:{k}[{i}]", k, e) for i, e in enumerate(v)]
            else:
                out.append((f"{name}:{k}", k, v))
    else:
        out.append((name, None, tree))
    return out


def zone_of(name: str, section, value):
    z = member(value, "zone")
    if isinstance(z, str):
        return z
    if name == "special.json":
        args = member(value, "args")
        return args[1] if isinstance(args, list) and len(args) > 1 else None
    if (name, None) in SEOUL_SECTIONS or (name, section) in SEOUL_SECTIONS:
        return "Asia/Seoul"
    return None


def differences(a, b, path=()):
    """Every leaf where two token trees differ: (path, Node value, JavaScriptCore value). A path is a tuple of
    member names and array indices."""
    if type(a) is not type(b):
        return [(path, a, b)]
    if isinstance(a, list):
        if len(a) != len(b):
            return [(path, a, b)]
        return [d for i, (x, y) in enumerate(zip(a, b)) for d in differences(x, y, path + (i,))]
    if isinstance(a, tuple) and a[0] == "obj":
        if [k for k, _ in a[1]] != [k for k, _ in b[1]]:
            return [(path, a, b)]
        return [d for (k, x), (_, y) in zip(a[1], b[1]) for d in differences(x, y, path + (k,))]
    return [] if a == b else [(path, a, b)]


def json_text(v) -> str:
    """A token tree back to compact JSON, numbers in their original text."""
    if isinstance(v, tuple) and v[0] == "num":
        return v[1]
    if isinstance(v, tuple) and v[0] == "obj":
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + json_text(x) for k, x in v[1]) + "}"
    if isinstance(v, list):
        return "[" + ",".join(json_text(x) for x in v) + "]"
    return json.dumps(v, ensure_ascii=False)


def path_text(case_id, path):
    return case_id + "".join(f"[{p}]" if isinstance(p, int) else f".{p}" for p in path)


def short(v):
    if isinstance(v, tuple) and v[0] == "num":
        return v[1]
    s = json.dumps(v, ensure_ascii=False, default=str)
    return s if len(s) < 200 else s[:200] + "…"


def environment(jsc: str):
    info = {"macOS": platform.mac_ver()[0], "jsc": jsc}
    try:
        with open(JSC_FRAMEWORK_PLIST, "rb") as f:
            plist = plistlib.load(f)
        info["JavaScriptCore.framework"] = f"{plist.get('CFBundleShortVersionString')} ({plist.get('CFBundleVersion')})"
    except OSError:
        pass
    try:
        info["macOS build"] = subprocess.run(["sw_vers", "-buildVersion"], capture_output=True, text=True).stdout.strip()
    except OSError:
        pass
    return info


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--jsc", default=DEFAULT_JSC)
    parser.add_argument("--report", help="write the full result as JSON to this file")
    parser.add_argument("--write", action="store_true", help=f"record the differences found in {EXPECTATIONS_REL}")
    args = parser.parse_args()

    started = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with tempfile.TemporaryDirectory() as tmp:
        script = build_script(Path(tmp))
        runs = {}
        for zone in ZONES:
            try:
                runs[zone] = run_zone(args.jsc, script, zone)
            except RuntimeError as e:
                print(e, file=sys.stderr)
                return 2

    requested = sorted({z for r in runs.values() for z in r["zones"]})
    missing_zones = [z for z in requested if z not in ZONES]
    names = {corpus_name(f) for f in runs[ZONES[0]]["files"]}
    expected_names = {p.relative_to(IOS_CORPUS).as_posix() for p in IOS_CORPUS.rglob("*.json")}
    expected_names.add("push.json")
    # The generator does not write its inputs.
    expected_names = {n for n in expected_names if not n.startswith("inputs/")}

    result = {"started": started, "environment": environment(args.jsc), "zones": ZONES, "zonesRequested": requested,
              "files": {}, "differences": [], "problems": []}
    if missing_zones:
        result["problems"].append(f"the generator asked for zones that were not run: {missing_zones}")
    for n in sorted(expected_names - names):
        result["problems"].append(f"not written under JavaScriptCore: {n}")
    for n in sorted(names - expected_names):
        result["problems"].append(f"written under JavaScriptCore but not in the Node corpus: {n}")

    total_cases = 0
    for name in sorted(names & expected_names):
        ref_text = reference_text(name)
        written = {zone: next(t for f, t in runs[zone]["files"].items() if corpus_name(f) == name) for zone in ZONES}
        byte_equal = {zone: written[zone] == ref_text for zone in ZONES}
        ref_units = units(name, tokens(ref_text))
        run_units = {zone: units(name, tokens(written[zone])) for zone in ZONES}
        file_result = {"bytesEqualInZone": byte_equal, "cases": len(ref_units), "differences": 0}
        for zone in ZONES:
            if [u[0] for u in run_units[zone]] != [u[0] for u in ref_units]:
                result["problems"].append(f"{name}: different case structure in the {zone} run")
        for i, (case_id, section, ref_value) in enumerate(ref_units):
            total_cases += 1
            zone = zone_of(name, section, ref_value)
            compare_in = [zone] if zone else ZONES
            for z in compare_in:
                if z not in run_units or i >= len(run_units[z]):
                    continue
                diffs = differences(ref_value, run_units[z][i][2])
                if diffs:
                    file_result["differences"] += 1
                index = int(case_id.rsplit("[", 1)[1][:-1]) if case_id.endswith("]") else None
                for path, node, jsc in diffs:
                    result["differences"].append({
                        "file": name, "section": section, "index": index, "zone": z, "path": list(path),
                        "node": json_text(node), "javaScriptCore": json_text(jsc), "where": path_text(case_id, path)})
        result["files"][name] = file_result
    result["casesCompared"] = total_cases
    result["finished"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    if args.report:
        Path(args.report).write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    env = result["environment"]
    print(f"JavaScriptCore {env.get('JavaScriptCore.framework', '?')} on macOS {env['macOS']} ({env.get('macOS build', '?')}); "
          f"zones run: {', '.join(ZONES)}; zones the generator set: {', '.join(requested)}")
    for name, f in result["files"].items():
        equal = [z for z, e in f["bytesEqualInZone"].items() if e]
        print(f"  {name}: {f['cases']} cases, {f['differences']} differing; byte-identical in: {', '.join(equal) or 'none'}")
    for p in result["problems"]:
        print(f"PROBLEM: {p}")
    for d in result["differences"]:
        print(f"DIFFERENT ({d['zone']}): {d['where']}: Node {d['node']} | JavaScriptCore {d['javaScriptCore']}")
    print(f"{total_cases} cases in {len(result['files'])} files compared; {len(result['differences'])} differing values; "
          f"{len(result['problems'])} problems")
    if result["problems"]:
        return 1

    # The recorded differences: the iOS expectation for exactly these values is the JavaScriptCore output
    # (TWDomainTests reads this file).
    keys = ("file", "section", "index", "zone", "path", "node", "javaScriptCore")
    found = [{k: d[k] for k in keys} for d in result["differences"]]
    record = {"tool": "ios/tools/corpus/compare_jsc.py", "generator": "android/tools/corpus/generate.mjs",
              "environment": {k: v for k, v in env.items() if k != "jsc"}, "zones": ZONES, "differences": found}
    if args.write:
        EXPECTATIONS.parent.mkdir(parents=True, exist_ok=True)
        EXPECTATIONS.write_text(json.dumps(record, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"wrote {len(found)} differences to {EXPECTATIONS.relative_to(ROOT)}")
        return 0
    recorded = json.loads(EXPECTATIONS.read_text(encoding="utf-8"))["differences"] if EXPECTATIONS.exists() else []
    if recorded == found:
        print(f"every difference is recorded in {EXPECTATIONS.relative_to(ROOT)} ({len(found)})")
        return 0
    print(f"the differences do not match {EXPECTATIONS.relative_to(ROOT)} ({len(recorded)} recorded, {len(found)} found); "
          "check them, update ios/tools/corpus/differences.md and rerun with --write")
    return 1


if __name__ == "__main__":
    sys.exit(main())
