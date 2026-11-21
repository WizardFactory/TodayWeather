#!/usr/bin/env python3
"""Replay projected official NWS point and message-lifecycle evidence offline."""

import json
from datetime import datetime
from pathlib import Path

SAMPLE = (
    Path(__file__).resolve().parents[1]
    / "docs/evidence/tasks/issue-3074/nws-point-bulletins.json"
)


def timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def identifier(message):
    return message["sender"], message["id"], timestamp(message["sent"])


def point_alerts(messages, at):
    """Evaluate already point-matched bulletin revisions at a historical time."""
    published = [
        message
        for message in messages
        if message["status"] == "Actual"
        and timestamp(message["sent"]) <= at
        and message["messageType"] in ("Alert", "Update", "Cancel")
    ]
    superseded = {
        identifier(reference)
        for message in published
        if message["messageType"] in ("Update", "Cancel")
        for reference in message["references"]
    }
    active = []
    for message in published:
        if message["messageType"] == "Cancel" or identifier(message) in superseded:
            continue
        expires = timestamp(message["expires"])
        if message["ends"]:
            expires = min(expires, timestamp(message["ends"]))
        if timestamp(message["effective"]) <= at < expires:
            active.append(message)
    return active


def checked_point(snapshot, fresh_until, at):
    # The replay passes the chosen freshness horizon explicitly. In production
    # it comes from the applicable issuer/cache freshness requirements.
    if snapshot is None or at >= fresh_until:
        return {"state": "unavailable", "warnings": []}
    return {"state": "current", "warnings": point_alerts(snapshot["features"], at)}


def verify(sample):
    miami, new_york = sample["miami"], sample["newYork"]
    at = timestamp(miami["retrievedAt"])
    fresh_until = timestamp("2026-11-20T08:20:00Z")
    miami_result = checked_point(miami, fresh_until, at)
    assert miami_result["state"] == "current"
    rip_current, flood_watch = miami_result["warnings"]
    assert rip_current["event"] == "Rip Current Statement"
    assert "FLZ173" in rip_current["geocode"]["UGC"]
    assert rip_current["geometry"] is None  # issuer point lookup matched the zone
    assert flood_watch["event"] == "Flood Watch"
    assert checked_point(new_york, fresh_until, at) == {"state": "current", "warnings": []}
    assert checked_point(None, fresh_until, at) == {"state": "unavailable", "warnings": []}
    assert checked_point(miami, fresh_until, fresh_until) == {
        "state": "unavailable",
        "warnings": [],
    }
    print("PASS Miami issuer match, New York empty, lookup failure and stale feed")

    previous = sample["previousFloodWatch"]["feature"]
    assert identifier(previous) in [identifier(reference) for reference in flood_watch["references"]]
    assert previous["geocode"]["UGC"] == flood_watch["geocode"]["UGC"]
    assert flood_watch["messageType"] == "Update"
    revisions = [flood_watch, previous]  # simulate a late older delivery
    assert point_alerts(revisions, timestamp("2026-11-19T20:17:59Z")) == [previous]
    assert point_alerts(revisions, timestamp("2026-11-19T20:18:00Z")) == [flood_watch]
    print("PASS issuer update supersedes still-valid older Flood Watch")

    assert point_alerts(miami["features"], timestamp("2026-11-20T11:59:59Z")) == [
        rip_current,
        flood_watch,
    ]
    assert point_alerts(miami["features"], timestamp("2026-11-20T12:00:00Z")) == [rip_current]
    assert point_alerts(miami["features"], timestamp("2026-11-20T14:00:00Z")) == []
    assert timestamp(rip_current["ends"]) > timestamp(rip_current["expires"])
    print("PASS bulletin expiry and distinct later hazard end")


if __name__ == "__main__":
    verify(json.loads(SAMPLE.read_text(encoding="utf-8")))
