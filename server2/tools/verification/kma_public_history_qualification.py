#!/usr/bin/env python3
"""Finite unauthenticated city profiles; source feasibility, never an SLO.

Capture once into a new directory. --analyze replays originals without a call.
No credentials, data.go.kr, APIHub or storage operations are supported.
"""

import argparse
import datetime as dt
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


TIMES = ("202610180100", "202610240300", "202601010300", "202610250000")
PROFILES = {"city-current-uri-20261025-four-times": (TIMES, None),
            "city-station-day-20261025-two-pages": (("202610242300", "202601012300"), "108"),
            "city-future-hour-20261025-one-page": (("202610252300",), None)}
DEFAULT_PROFILE = "city-current-uri-20261025-four-times"
LIMIT = 8 * 1024 * 1024
HOSTS = frozenset(("www.weather.go.kr", "weather.go.kr", "www.kma.go.kr"))
BASE = "https://www.weather.go.kr/w/weather/land/city-obs.do"


def public_url(url):
    parts = urlsplit(url)
    if (parts.scheme != "https" or parts.hostname not in HOSTS
            or parts.username or parts.password or parts.port not in (None, 443)):
        raise ValueError("non-public-weather URL")
    return url


def request_url(stamp, profile=DEFAULT_PROFILE):
    times, station = PROFILES[profile]
    if stamp not in times:
        raise ValueError("outside fixed qualification profile")
    hour = dt.datetime.strptime(stamp, "%Y%m%d%H%M")
    query = {"tm": hour.strftime("%Y.%m.%d.%H:00")}
    if station:
        query.update(type="t99", mode="0", reg="100", auto_man="m", stn=station)
    return BASE + "?" + urlencode(query)


class WeatherRedirects(HTTPRedirectHandler):
    def __init__(self):
        super().__init__()
        self.redirects = []

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        public_url(newurl)
        if len(self.redirects) >= 2:
            raise ValueError("redirect cap")
        self.redirects.append(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def bounded_body(response):
    body = response.read(LIMIT + 1)
    if len(body) > LIMIT:
        raise ValueError("body cap")
    return body


class Page(HTMLParser):
    """Keep exact displayed cells for offline field/semantics inspection."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self.inputs = {}
        self.text = []
        self.row = None
        self.cell = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "input" and attrs.get("name") in ("tm", "stn"):
            self.inputs[attrs["name"]] = attrs.get("value", "")
        if tag == "tr":
            self.row = {"cells": [], "links": []}
        elif tag in ("td", "th") and self.row is not None:
            self.cell = []
        elif tag == "a" and self.row is not None and "href" in attrs:
            self.row["links"].append(attrs["href"])

    def handle_data(self, data):
        self.text.append(data)
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.row["cells"].append(" ".join(" ".join(self.cell).split()))
            self.cell = None
        if tag == "tr" and self.row is not None:
            if self.row["cells"]:
                self.rows.append(self.row)
            self.row = None


def inspect(body, requested):
    match = re.search(br"charset\s*=\s*[\"']?([A-Za-z0-9_-]+)", body[:8192], re.I)
    encoding = match.group(1).decode("ascii") if match else "utf-8"
    page = Page()
    page.feed(body.decode(encoding, errors="strict"))
    # A form's requested time is not evidence of the returned observation time.
    # Retain displayed date candidates, without silently selecting the form.
    text = " ".join(" ".join(page.text).split())
    dates = re.findall(r"기상실황표\s*(20\d{2}\.\d{1,2}\.\d{1,2}\.\d{1,2}:\d{2})", text)
    publications = [dt.datetime.strptime(d, "%Y.%m.%d.%H:%M").strftime("%Y%m%d%H%M")
                    for d in dates]
    seoul = [r for r in page.rows if any(re.search(r"(?:[?&])stn=108(?:&|$)", h)
                                       for h in r["links"])]
    return {"requested_kst": requested, "encoding": encoding,
            "form_values": page.inputs, "displayed_dates": list(dict.fromkeys(dates)),
            "single_page_time_match": publications == [requested],
            "header_rows": [r for r in page.rows if not r["links"]][:5],
            "station_108_rows": seoul, "row_count": len(page.rows),
            "time_and_field_qualified": False}


def analyze(out):
    report = json.loads((out / "report.json").read_text())
    result = []
    for entry in report["attempts"]:
        if entry["requested_kst"] not in {t for times, _ in PROFILES.values() for t in times}:
            raise ValueError("outside fixed qualification times")
        path = out / (entry["requested_kst"] + ".html")
        if not path.exists():
            continue
        body = path.read_bytes()
        if hashlib.sha256(body).hexdigest() != entry.get("sha256"):
            raise ValueError("original hash mismatch")
        result.append(inspect(body, entry["requested_kst"]))
    (out / "analysis.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return result


def capture(out, profile=DEFAULT_PROFILE):
    out.mkdir(parents=True, exist_ok=False)
    times, _station = PROFILES[profile]
    report = {"scope": "public city source feasibility; no client or tail sample",
              "profile": profile,
              "tool_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "observed_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
              "attempt_cap": len(times), "retry_cap": 0, "redirect_cap": 2,
              "body_cap_bytes": LIMIT, "timeout_seconds": 10, "attempts": []}
    def checkpoint():
        (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    for stamp in times:
        handler = WeatherRedirects()
        opener = build_opener(handler)
        url = public_url(request_url(stamp, profile))
        entry = {"requested_kst": stamp, "url": url, "outcome": "started"}
        report["attempts"].append(entry)
        checkpoint()  # charge the attempt before any network work
        started = time.monotonic()
        try:
            request = Request(url, headers={"User-Agent": "TodayWeather-server2-source-qualification/1"})
            try:
                response = opener.open(request, timeout=10)
            except HTTPError as error:
                response = error
            with response:
                body = bounded_body(response)
                entry.update(status=response.code, final_url=public_url(response.geturl()),
                             content_type=response.headers.get("Content-Type"))
            (out / (stamp + ".html")).write_bytes(body)
            entry.update(bytes=len(body), sha256=hashlib.sha256(body).hexdigest(), outcome="captured")
        except Exception as error:
            entry.update(outcome="failed", error=type(error).__name__)
        entry.update(redirects=handler.redirects,
                     provider_http_ms=round((time.monotonic() - started) * 1000, 3))
        checkpoint()
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--out", type=Path, help="new original-capture directory; finite profile")
    group.add_argument("--analyze", type=Path, help="existing capture; offline, no network")
    parser.add_argument("--profile", choices=tuple(PROFILES), default=DEFAULT_PROFILE)
    args = parser.parse_args()
    if args.analyze:
        pages = analyze(args.analyze)
        result = {"analysis_path": str(args.analyze / "analysis.json"),
                  "pages": [{"requested_kst": p["requested_kst"],
                             "single_page_time_match": p["single_page_time_match"],
                             "station_108_row_count": len(p["station_108_rows"]),
                             "time_and_field_qualified": p["time_and_field_qualified"]}
                            for p in pages]}
    else:
        result = capture(args.out, args.profile)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
