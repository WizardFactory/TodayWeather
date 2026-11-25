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
- R8 obfuscated and shrank the app's own classes (APP_PACKAGE): of the classes it kept, the mapping gives more a
  new name than their own (R8 run with -dontobfuscate renames none), and it maps some to `R8$$REMOVED$$CLASS$$<n>`,
  the name R8 9.x gives a class it removed (with -dontshrink it removes none);
- every field of KEPT_FIELDS is declared in a dex file's class definitions (`class_defs` / `class_data_item`), under the
  names the mapping gives its class and the field (R8 writes no mapping line for a member it keeps under its own name):
  the field holds a listener that a registry keeps only weakly, and nothing reads it, so without its keep rule R8 removes
  it and the listener is collected.
Prints one ok or FAIL line per check, and the mapping file's SHA-256 for the release notes. Status 1: a check
failed; 2: usage or an unreadable file.
"""
import hashlib
import json
import re
import struct
import sys
import zipfile

MARKER = re.compile(rb"~~(D8|R8|L8)(\{[^}]*\})")
DEX = re.compile(r"classes\d*\.dex")
APP_PACKAGE = "net.wizardfactory.todayweather."
CLASS_LINE = re.compile(rb"^(\S+) -> (\S+):\r?$", re.MULTILINE)
REMOVED = re.compile(r"R8\$\$REMOVED\$\$CLASS\$\$[0-9]+")
# (class, field): SharedPreferences keeps its change listeners only weakly, so the app holds the analytics choice's
# listener in this field (@field:Keep); the first 2.0.1 build lost it and withdrew a grant at the next start.
# app/src/test/.../ListenerKeepTest.kt checks that the app's sources and this list agree.
KEPT_FIELDS = (
    ("net.wizardfactory.todayweather.HandBackWriter", "consentListener"),
)
# A field in a mapping: `    <type> <name> -> <new name>`; methods have parameters and may have line numbers.
FIELD_LINE = re.compile(r"^ {4}[^\s(#:]+ ([^\s(]+) -> (\S+)$")


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
        if REMOVED.fullmatch(new):
            removed += 1
        elif new == original:
            kept += 1
        else:
            renamed += 1
    return kept, renamed, removed


def mapped_names(data):
    """For each (class, field) of KEPT_FIELDS, the names R8 gave them: the class's mapping line (None when R8 removed
    the class), the field's line, or the original names where the mapping has no line for them."""
    names = {pair: list(pair) for pair in KEPT_FIELDS}
    current = None
    for raw in data.decode("utf-8", "replace").splitlines():
        line = raw.rstrip("\r")
        if not line.startswith((" ", "#")):
            match = re.match(r"^(\S+) -> (\S+):$", line)
            current = match.group(1) if match else None
            for (owner, _), mapped in names.items():
                if match and owner == current:
                    mapped[0] = None if REMOVED.fullmatch(match.group(2)) else match.group(2)
            continue
        field = FIELD_LINE.match(line)
        if current and field and (current, field.group(1)) in names:
            names[(current, field.group(1))][1] = field.group(2)
    return {pair: (mapped[0], mapped[1]) for pair, mapped in names.items()}


def read_uleb128(data, offset):
    """Read an unsigned LEB128 (at most 5 bytes, 32-bit value) from data at offset; return (value, next_offset)."""
    value = 0
    for shift in (0, 7, 14, 21, 28):
        byte = data[offset]
        offset += 1
        if shift == 28 and byte > 0x0f:
            raise ValueError("uleb128 overflow")
        value |= (byte & 0x7f) << shift
        if not byte & 0x80:
            return value, offset
    raise ValueError("unterminated uleb128")


def dex_fields(data):
    """The (class descriptor, field name) pairs declared by a dex file's class_defs / class_data_item; empty on error."""
    try:
        if len(data) < 0x70 or data[:4] != b"dex\n":
            return set()
        endian_tag = struct.unpack_from("<I", data, 0x28)[0]
        if endian_tag != 0x12345678:
            return set()
        string_count, string_off, type_count, type_off = struct.unpack_from("<IIII", data, 0x38)
        field_count, field_off = struct.unpack_from("<II", data, 0x50)
        class_def_count, class_def_off = struct.unpack_from("<II", data, 0x60)
        if (string_off + 4 * string_count > len(data) or type_off + 4 * type_count > len(data) or
                field_off + 8 * field_count > len(data) or class_def_off + 32 * class_def_count > len(data)):
            return set()

        def string(index):
            if index >= string_count:
                raise IndexError(index)
            offset = struct.unpack_from("<I", data, string_off + 4 * index)[0]
            _, offset = read_uleb128(data, offset)  # UTF-16 unit length, followed by MUTF-8 bytes ending in 0
            return data[offset:data.index(b"\x00", offset)].decode("utf-8", "replace")

        def type_name(index):
            if index >= type_count:
                raise IndexError(index)
            return string(struct.unpack_from("<I", data, type_off + 4 * index)[0])

        found = set()
        for i in range(class_def_count):
            class_idx, _, _, _, _, _, class_data_off, _ = struct.unpack_from("<IIIIIIII", data, class_def_off + 32 * i)
            if class_idx >= type_count:
                raise IndexError(class_idx)
            if class_data_off == 0:
                continue
            off = class_data_off
            static_count, off = read_uleb128(data, off)
            instance_count, off = read_uleb128(data, off)
            _, off = read_uleb128(data, off)  # direct_methods_size
            _, off = read_uleb128(data, off)  # virtual_methods_size
            owner = type_name(class_idx)
            for count in (static_count, instance_count):
                field_idx = 0
                for _ in range(count):
                    diff, off = read_uleb128(data, off)
                    _, off = read_uleb128(data, off)  # access_flags
                    field_idx += diff
                    if field_idx >= field_count:
                        raise IndexError(field_idx)
                    f_class_idx, f_type_idx, f_name_idx = struct.unpack_from("<HHI", data, field_off + 8 * field_idx)
                    if f_class_idx != class_idx or f_type_idx >= type_count or f_name_idx >= string_count:
                        raise ValueError("invalid field_id")
                    found.add((owner, string(f_name_idx)))
        return found
    except (struct.error, IndexError, ValueError):
        return set()


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
    fields = set().union(*(dex_fields(data) for data in dex.values())) if dex else set()
    for (owner, field), (new_owner, new_field) in mapped_names(mapping).items():
        present = new_owner is not None and ("L" + new_owner.replace(".", "/") + ";", new_field) in fields
        check(present, f"R8 kept {owner}.{field}",
              f"R8 removed {owner}.{field}: the listener it holds is kept only weakly and can be collected")
    check(bool(recorded) and recorded == actual, "mapping content has the SHA-256 of its header",
          f"mapping content SHA-256 {actual}, its header records {recorded or 'none'}")
    print(f"- R8 mapping SHA-256: {hashlib.sha256(mapping).hexdigest()}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
