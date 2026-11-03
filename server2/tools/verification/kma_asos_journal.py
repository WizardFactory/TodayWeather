#!/usr/bin/env python3
"""Offline ASOS journal qualification. Never fills runtime data or contacts a provider."""

import argparse
import datetime as dt
import hashlib
import json
import math
import re
from pathlib import Path

# KMA Climate Statistics Guidelines (2021), appendix A 1.3.6 and 1.5.1.
# This is a deliberately bounded textual ISCS grammar, not a generic code decoder.
RAIN = {"비", "이슬비", "안개비", "어는비", "어는이슬비", "소나기", "소낙비"}
SNOW = {"눈", "싸락눈", "가루눈", "소낙눈"}
MIXED = {"진눈깨비", "소낙진눈깨비"}
DRY = {"박무", "연무", "안개", "얼음안개", "황사"}
VISIBILITY = {"시정(미만)", "시정(이상)"}
DISTANCE = {"0.1km", "0.2km", "0.5km", "1km"}


class JournalError(ValueError):
    pass


def _parse_journal(text):
    """Parse evidence without inventing an onset for an intensity checkpoint."""
    if not isinstance(text, str) or len(text) > 20000:
        raise JournalError("missing/oversized journal")
    episodes, part, depth = [], [], 0
    for c in text:
        if c == "{":
            if depth:
                raise JournalError("nested annotation")
            depth = 1
        elif c == "}":
            if not depth:
                raise JournalError("unmatched annotation")
            depth = 0
        if not depth and c.isspace():
            if part:
                episodes.append("".join(part))
                part = []
        else:
            part.append(c)
            if not depth and c == ".":
                episodes.append("".join(part))
                part = []
    if depth:
        raise JournalError("unclosed annotation")
    if part:
        episodes.append("".join(part))
    intervals, boundaries, unknown_prefixes = [], [], []
    first_entries, open_out = {}, 0
    for episode in episodes:
        ended, continued = episode.endswith("."), episode.endswith("-")
        if not (ended or continued):
            raise JournalError("unfinished episode")
        nodes = episode[:-1].split("-")
        carried = nodes[0] == ""
        if carried:
            nodes.pop(0)
        at, kind = None, None
        for i, node in enumerate(nodes):
            match = re.fullmatch(r"((?:\{[^{}]+\})*)(\d{4})?", node)
            if not match:
                raise JournalError("unsupported node")
            tags = re.findall(r"\{([^{}]+)\}", match[1])
            mask, weather, vis = 0, False, False
            for tag in tags:
                if tag in RAIN | SNOW | MIXED | DRY:
                    weather = True
                    mask |= 1 if tag in RAIN else 2 if tag in SNOW else 3 if tag in MIXED else 0
                elif tag in VISIBILITY:
                    if vis:
                        raise JournalError("incomplete visibility annotation")
                    vis = True
                elif tag in DISTANCE and vis:
                    vis = False
                elif re.fullmatch(r"강도[012]", tag):
                    pass
                else:
                    raise JournalError("unsupported annotation: " + tag)
            if vis or (tags and not weather):
                raise JournalError("annotation without phenomenon")
            clock = match[2]
            if clock is None:
                if not (carried and i == 0 and weather):
                    raise JournalError("missing event time")
                minute = 0
            else:
                if carried and i == 0:
                    raise JournalError("timed continuation without an initial carry marker")
                hour, minute_part = int(clock[:2]), int(clock[2:])
                if hour > 24 or minute_part > 59 or (hour == 24 and minute_part):
                    raise JournalError("invalid event time")
                minute = hour * 60 + minute_part
            if at is None:
                if not weather:
                    raise JournalError("missing initial phenomenon")
                if mask and minute and minute % 60 == 0:
                    boundaries.append(minute)
                if not carried and any(re.fullmatch(r"강도[012]", tag) for tag in tags):
                    unknown_prefixes.append((minute, mask))
            else:
                if minute < at or (minute == at and (not weather or mask != kind)):
                    raise JournalError("nonmonotone/zero-duration event")
                intervals.append((at, minute, kind))
                if weather and mask != kind and mask and minute and minute % 60 == 0:
                    boundaries.append(minute)
            if not weather and i != len(nodes) - 1:
                raise JournalError("end time before last node")
            if weather:
                for bit in (1, 2):
                    if mask & bit:
                        first_entries[bit] = min(first_entries.get(bit, minute), minute)
            at, kind = minute, mask if weather else kind
        if continued and (at != 1440 or not weather):
            raise JournalError("continuation without 24:00")
        if continued:
            open_out |= kind
        if not nodes or (not carried and len(nodes) < 2):
            raise JournalError("episode without interval")
    masks = [0] * 24
    for start, end, mask in intervals:
        for i in range(24):
            if start < (i + 1) * 60 and end > i * 60:
                masks[i] |= mask
    types = [{0: 0, 1: 1, 2: 3, 3: 2}[mask] for mask in masks]
    for until, possible in unknown_prefixes:
        for i, known in enumerate(masks):
            if i * 60 < until and possible & ~known:
                types[i] = None
    for minute in boundaries:
        types[minute // 60 - 1] = None
    return {"types": types, "masks": masks, "open_out": open_out, "first_entries": first_entries}


def hourly_types(text):
    """24 preceding-hour PTYs. None preserves uncertain starts or minute endpoints."""
    return _parse_journal(text)["types"]


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


def reference(row, winter):
    """Hourly-code consistency only: the guideline derives these codes from journals."""
    code = row.get("dmstMtphNo")
    amount = number(row.get("rn"))
    normal = row.get("rnQcflg", row.get("rnQcflag")) in ("", "0", 0, None)
    if isinstance(code, str) and code:
        if not code.isascii() or not code.isdigit() or len(code) % 2:
            return None, None, "unsupported code"
        codes = {int(code[i:i + 2]) for i in range(0, len(code), 2)}
        modern = set(range(1, 37)) | set(range(40, 49)) | set(range(50, 61)) | set(range(70, 76)) | set(range(80, 87)) | {90, 91, 92}
        if not codes <= modern or codes & {13, 14, 15, 20, 21, 22, 86}:
            return None, None, "unsupported code"
        rain = bool(codes & {1, 2, 3, 4, 6, 7, 9, 12})
        snow = bool(codes & {5, 6, 8, 9, 10, 11})
        pty = 2 if rain and snow else 1 if rain else 3 if snow else 0
        if pty == 0 and normal and amount is not None and amount >= 0:
            return None, None, "numeric precipitation conflicts with dry type"
        return pty > 0, pty, None
    if code != "":
        return None, None, "missing phenomenon"
    measured = any(number(row.get(field)) is not None and low <= number(row[field]) <= high
                   and (quality is None or row.get(quality) in (None, "", "0", 0))
                   for field, quality, low, high in (("ta", "taQcflg", -100, 100),
                                                      ("hm", "hmQcflg", 0, 100),
                                                      ("dc10Tca", None, 0, 10)))
    if not measured:
        return None, None, "no other valid observation"
    if not normal:
        return None, None, "rain quality rejected"
    if winter:
        # Even a trace/positive three-hour amount says nothing about the last hour.
        return None, None, "winter amount has three-hour support"
    if row.get("rn") == "":
        return False, 0, None
    if amount is not None and amount >= 0:
        return True, None, None
    return None, None, "missing amount and type"


def compare(hourly, daily, station):
    result = {"station": station, "compared": 0, "wet_controls": 0, "dry_controls": 0,
              "mismatches": [], "errors": [], "unknown_reference": [], "ambiguous": [],
              "outside_daily_window": [], "full_history_qualified": False}
    days, seen = {}, set()
    for row in daily:
        date = row.get("tm")
        try:
            if str(row.get("stnId")) != station or date in seen:
                raise JournalError("station mismatch/duplicate day")
            seen.add(date)
            if dt.datetime.strptime(date, "%Y-%m-%d").strftime("%Y-%m-%d") != date:
                raise JournalError("noncanonical day")
            minimum, maximum = number(row.get("minTa")), number(row.get("maxTa"))
            if minimum is None or maximum is None or not -100 <= minimum <= maximum <= 100:
                raise JournalError("missing valid daily measurements")
            parsed = _parse_journal(row.get("iscs"))
            types = parsed["types"]
            if number(row.get("sumRn")) is not None and not any(p for p in types):
                raise JournalError("reported precipitation without a journal event")
            days[date] = parsed
        except (JournalError, ValueError, TypeError) as exc:
            result["errors"].append({"day": date, "reason": str(exc)})
    # A missing next-day carry must not silently close yesterday's ongoing rain.
    # This only propagates uncertainty; it never fills intervening observations.
    for date, parsed in days.items():
        previous = (dt.datetime.strptime(date, "%Y-%m-%d") - dt.timedelta(days=1)).strftime("%Y-%m-%d")
        if previous in days:
            for bit in (1, 2):
                if days[previous]["open_out"] & bit:
                    until = parsed["first_entries"].get(bit, 1440)
                    for i, known in enumerate(parsed["masks"]):
                        if i * 60 < until and bit & ~known:
                            parsed["types"][i] = None
    hourly_seen = set()
    for row in hourly:
        stamp = row.get("tm")
        try:
            if str(row.get("stnId")) != station or stamp in hourly_seen:
                raise JournalError("station mismatch/duplicate hour")
            hourly_seen.add(stamp)
            hour = dt.datetime.strptime(stamp, "%Y-%m-%d %H:%M")
            if hour.minute or hour.strftime("%Y-%m-%d %H:%M") != stamp:
                raise JournalError("not an exact hour")
            prior = hour - dt.timedelta(hours=1)
            day = prior.strftime("%Y-%m-%d")
            if day not in days:
                result["outside_daily_window"].append(stamp)
                continue
            predicted = days[day]["types"][prior.hour]
            if predicted is None:
                result["ambiguous"].append(stamp)
                continue
            wet, pty, reason = reference(row, hour.month <= 3 or hour.month >= 11)
            if wet is None:
                result["unknown_reference"].append({"tm": stamp, "journal_pty": predicted, "reason": reason})
                if reason == "unsupported code":
                    result["errors"].append({"hour": stamp, "reason": "unsupported nonblank reference code"})
                continue
            result["compared"] += 1
            result["wet_controls" if wet else "dry_controls"] += 1
            if wet != (predicted > 0) or (pty is not None and predicted != pty):
                result["mismatches"].append({"tm": stamp, "journal_pty": predicted, "reference_pty": pty, "reference_wet": wet})
        except (JournalError, ValueError, TypeError) as exc:
            result["errors"].append({"hour": stamp, "reason": str(exc)})
    result["type_consistency_gate_passed"] = bool(result["wet_controls"] and result["dry_controls"] and not
                                                  (result["errors"] or result["mismatches"] or result["ambiguous"]))
    result["gauge"] = gauge_controls(hourly, days)
    result["control_gate_passed"] = bool(result["type_consistency_gate_passed"] and
                                         result["gauge"]["gate_passed"])
    return result


def gauge_controls(hourly, days):
    """Separate rainfall-field check; its independence from journal QC is unproven."""
    result = {"compared": 0, "wet": 0, "dry": 0, "mismatches": [], "unknown": []}
    for row in hourly:
        try:
            hour = dt.datetime.strptime(row.get("tm"), "%Y-%m-%d %H:%M")
        except (TypeError, ValueError):
            # compare() has already recorded the invalid input as a gate failure.
            result["unknown"].append(row.get("tm"))
            continue
        winter = hour.month <= 3 or hour.month >= 11
        if winter and hour.hour % 3:
            continue
        normal = row.get("rnQcflg", row.get("rnQcflag")) in (None, "", "0", 0)
        amount = number(row.get("rn"))
        if not normal or not (row.get("rn") == "" or amount is not None and amount >= 0):
            result["unknown"].append(row["tm"])
            continue
        wet = amount is not None
        if not wet and reference(row, False)[2] == "no other valid observation":
            result["unknown"].append(row["tm"])
            continue
        types = []
        for offset in range(1, 4 if winter else 2):
            slot = hour - dt.timedelta(hours=offset)
            parsed = days.get(slot.strftime("%Y-%m-%d"))
            types.append(parsed["types"][slot.hour] if parsed else None)
        predicted = True if any(p is not None and p > 0 for p in types) else None if None in types else False
        if predicted is None:
            result["unknown"].append(row["tm"])
            continue
        result["compared"] += 1
        result["wet" if wet else "dry"] += 1
        if predicted != wet:
            result["mismatches"].append({"tm": row["tm"], "journal_wet": predicted,
                                          "rain_field_wet": wet, "hours": 3 if winter else 1})
    result["gate_passed"] = bool(result["wet"] and result["dry"] and not result["mismatches"])
    return result


def read_rows(path):
    if path.stat().st_size > 8 * 1024 * 1024:
        raise JournalError("input body cap")
    body = path.read_bytes()
    if len(body) > 8 * 1024 * 1024:
        raise JournalError("input body cap")
    value = json.loads(body)["response"]
    if value["header"]["resultCode"] != "00":
        raise JournalError("provider did not return success")
    rows = value["body"]["items"]["item"]
    if not isinstance(rows, list) or value["body"]["totalCount"] != len(rows):
        raise JournalError("incomplete/unexpected page")
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hourly", type=Path, required=True)
    parser.add_argument("--daily", type=Path, required=True)
    parser.add_argument("--station", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.out.exists():
        raise JournalError("refusing to overwrite evidence")
    result = compare(read_rows(args.hourly), read_rows(args.daily), args.station)
    result["scope"] = "Offline source controls only; no runtime fill, amounts, LGT or client timing"
    result["parser_sha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    result["inputs"] = [{"file": str(p), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                        for p in (args.hourly, args.daily)]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({k: result[k] for k in ("station", "compared", "wet_controls", "dry_controls",
                                            "mismatches", "errors", "ambiguous", "control_gate_passed")}))
    return 0 if result["control_gate_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
