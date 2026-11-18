#!/usr/bin/env python3
"""The legacy server for the fixture mode of ios/tools/places-ui/run-places-ui.sh (IN-11, #2960): it answers
GET /weather/v000903/coord/<lat>,<long> with the corpus response kma-seoul (vc-london for latitude 51.x) and
GET /geocode/v000903/coord/... with geocode-seoul (the copies under ios/TodayWeatherTests/PlacesReference), any other path
with 404, and writes every request (method, path, Accept-Language, Device-Id) to <log>. Only 127.0.0.1 is served.

    fixture_server.py <port> <log>
"""
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REFS = Path(__file__).resolve().parents[2] / "TodayWeatherTests/PlacesReference"
PORT, LOG = int(sys.argv[1]), Path(sys.argv[2])
requests = []
lock = threading.Lock()


def body(name):
    return (REFS / f"places-{name}.input.json").read_bytes()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def answer(self):
        path = self.path.split("?")[0]
        if self.command == "GET" and path == "/fixture/weather-request-count":
            with lock:
                count = sum(r["path"].startswith("/weather/") for r in requests)
            self.reply(200, str(count).encode("ascii"))
            return
        status, payload = 404, b"{}"
        if self.command == "GET" and path.startswith("/weather/v000903/coord/"):
            status, payload = 200, body("vc-london" if path.split("/")[-1].startswith("51.") else "kma-seoul")
        elif self.command == "GET" and path.startswith("/geocode/v000903/coord/"):
            status, payload = 200, body("geocode-seoul")
        with lock:
            requests.append({"method": self.command, "path": self.path, "status": status,
                             "acceptLanguage": self.headers.get("Accept-Language"), "deviceId": self.headers.get("Device-Id")})
            LOG.write_text(json.dumps(requests, ensure_ascii=False, indent=1) + "\n", "utf-8")
        self.reply(status, payload)

    def reply(self, status, payload):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    do_GET = do_POST = do_PUT = do_DELETE = answer


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
