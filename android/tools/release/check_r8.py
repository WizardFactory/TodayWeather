#!/usr/bin/env python3
"""Checks that a release APK was shrunk by R8 and that a mapping file is the one of its build.

    android/tools/release/check_r8.py <release.apk> <mapping.txt>

check-apk.sh runs it (docs/operations/android-release.md, step 4). D8 and R8 write a marker string into the dex files
they produce: `~~D8{...}` or `~~R8{...}`, a JSON object; R8's carries `pg-map-id`, the ID of the mapping file it wrote
(`# pg_map_id:` in that file's header), and `~~L8{...}` marks the desugared Java library that R8 compiles separately.
The check passes when
- no dex file of the APK has a D8 marker (code that skipped R8 would be neither shrunk nor obfuscated);
- the R8 markers of the app's code (dex files without an L8 marker) name exactly one mapping ID, the mapping's
  pg_map_id, so the mapping covers all of the app's dex;
- the mapping's content has the SHA-256 its header records (`# pg_map_hash: SHA-256 <hex>`: the lines after the
  header), so the file to upload to Play is complete;
- R8 obfuscated and shrank the app's own classes (APP_PACKAGE): the mapping maps more of them to other names than
  to their own, and maps some to `R8$$REMOVED$$CLASS$$<n>`, the name R8 9.x gives a class it removed. R8 run with
  -dontobfuscate or -dontshrink writes neither.
Prints one ok or FAIL line per check, and the mapping file's SHA-256 for the release notes. Status 1: a check
failed; 2: usage or an unreadable file.
"""
import hashlib
import json
import re
import sys
import zipfile

MARKER = re.compile(rb"~~(D8|R8|L8)(\{[^}]*\})")
DEX = re.compile(r"classes\d*\.dex")
APP_PACKAGE = "net.wizardfactory.todayweather."
CLASS_LINE = re.compile(rb"^(\S+) -> (\S+):\r?$", re.MULTILINE)
REMOVED = "R8$$REMOVED$$CLASS$$"


def markers(data):
    """The (tool, fields) markers in a dex file's bytes; fields is {} when the JSON does not parse."""
    found = []
    for tool, body in MARKER.findall(data):
        try:
            fields = json.loads(body.decode("utf-8"))
        except ValueError:
            fields = {}
        found.append((tool.decode(), fields if isinstance(fields, dict) else {}))
    return found


def mapping_header(data):
    """pg_map_id, the recorded SHA-256 and the SHA-256 of the lines after the header of a mapping file."""
    lines = data.split(b"\n")
    header = 0
    while header < len(lines) and lines[header].startswith(b"#"):
        header += 1
    fields = {}
    for line in lines[:header]:
        match = re.match(rb"# (pg_map_id|pg_map_hash): (.*)$", line.rstrip(b"\r"))
        if match:
            fields[match.group(1).decode()] = match.group(2).decode("utf-8", "replace").strip()
    recorded = fields.get("pg_map_hash", "")
    recorded = recorded[len("SHA-256 "):] if recorded.startswith("SHA-256 ") else ""
    return fields.get("pg_map_id", ""), recorded, hashlib.sha256(b"\n".join(lines[header:])).hexdigest()


def own_classes(data):
    """(kept, renamed, removed) counts of the app's own classes in a mapping file."""
    kept = renamed = removed = 0
    for original, new in CLASS_LINE.findall(data):
        original, new = original.decode("utf-8", "replace"), new.decode("utf-8", "replace")
        if not original.startswith(APP_PACKAGE):
            continue
        if new.startswith(REMOVED):
            removed += 1
        elif new == original:
            kept += 1
        else:
            renamed += 1
    return kept, renamed, removed


def main(argv):
    if len(argv) != 3:
        print("usage: check_r8.py <release.apk> <mapping.txt>", file=sys.stderr)
        return 2
    apk_path, mapping_path = argv[1], argv[2]
    try:
        with zipfile.ZipFile(apk_path) as apk:
            dex = {name: apk.read(name) for name in apk.namelist() if DEX.fullmatch(name)}
        with open(mapping_path, "rb") as handle:
            mapping = handle.read()
    except (OSError, zipfile.BadZipFile) as error:
        print(f"cannot read: {error}", file=sys.stderr)
        return 2

    failed = False

    def check(ok, passed, failure):
        nonlocal failed
        print(f"ok   {passed}" if ok else f"FAIL {failure}")
        failed = failed or not ok

    found = {name: markers(data) for name, data in sorted(dex.items())}
    d8 = [name for name, marks in found.items() if any(tool == "D8" for tool, _ in marks)]
    app_marks = [fields for marks in found.values() if not any(t == "L8" for t, _ in marks)
                 for tool, fields in marks if tool == "R8"]
    valid = [fields["pg-map-id"] for fields in app_marks
             if isinstance(fields.get("pg-map-id"), str) and fields["pg-map-id"]]
    invalid = [fields["pg-map-id"] for fields in app_marks
               if "pg-map-id" in fields and not (isinstance(fields["pg-map-id"], str) and fields["pg-map-id"])]
    app_ids = sorted(set(valid))
    map_id, recorded, actual = mapping_header(mapping)
    kept, renamed, removed = own_classes(mapping)

    check(bool(dex), f"{len(dex)} dex files", "no classes*.dex in the APK")
    check(not d8, "no dex file compiled by D8 alone", f"compiled by D8, not shrunk by R8: {' '.join(d8)}")
    check(bool(app_ids) and not invalid, "R8 compiled the app's code",
          f"R8 marker with an invalid pg-map-id: {invalid!r}" if invalid
          else "no R8 marker with a mapping ID outside the desugared library")
    check(bool(map_id) and app_ids == [map_id], f"mapping pg_map_id {map_id} is the APK's",
          f"mapping pg_map_id {map_id or 'none'}, the APK's R8 code has {' '.join(app_ids) or 'none'}")
    check(renamed > kept, f"R8 renamed {renamed} of the app's {renamed + kept} classes",
          f"R8 renamed {renamed} of the app's {renamed + kept} classes ({APP_PACKAGE}*): not obfuscated")
    check(removed > 0, f"R8 removed {removed} of the app's classes",
          f"R8 removed none of the app's classes ({APP_PACKAGE}*): not shrunk")
    check(bool(recorded) and recorded == actual, "mapping content has the SHA-256 of its header",
          f"mapping content SHA-256 {actual}, its header records {recorded or 'none'}")
    print(f"- R8 mapping SHA-256: {hashlib.sha256(mapping).hexdigest()}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
