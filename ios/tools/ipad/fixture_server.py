#!/usr/bin/env python3
"""The legacy server for ios/tools/ipad/run-ipad-check.sh (IN-18, #2967): it answers
GET /weather/v000903/coord/... and /v000903/kma/addr/... with the captured response kma-seoul and
GET /geocode/v000903/... with the captured geocode of 회현동 (the copies under ios/TodayWeatherTests/PlacesReference),
GET /v000903/nation/KR and /v000903/kma/special with the corpus answers (ios/Core/Tests/TWDomainTests/Corpus/inputs),
any other path with 404, and writes every request (method, path, Accept-Language) to <log>. Only 127.0.0.1 is served.

    fixture_server.py <port> <log>
"""
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

IOS = Path(__file__).resolve().parents[2]
PLACES = IOS / "TodayWeatherTests/PlacesReference"
CORPUS = IOS / "Core/Tests/TWDomainTests/Corpus/inputs"
PORT, LOG = int(sys.argv[1]), Path(sys.argv[2])
requests = []
lock = threading.Lock()


def answer_for(path):
    if path.startswith(("/weather/v000903/coord/", "/v000903/kma/addr/")):
        return 200, (PLACES / "places-kma-seoul.input.json").read_bytes()
    if path.startswith("/geocode/v000903/"):
        return 200, (PLACES / "places-geocode-seoul.input.json").read_bytes()
    if path.startswith("/v000903/nation/"):
        return 200, (CORPUS / "nation.json").read_bytes()
    if path == "/v000903/kma/special":
        return 200, (CORPUS / "special.json").read_bytes()
    return 404, b"{}"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def answer(self):
        path = self.path.split("?")[0]
        status, payload = answer_for(path) if self.command == "GET" else (404, b"{}")
        with lock:
            requests.append({"method": self.command, "path": self.path, "status": status,
                             "acceptLanguage": self.headers.get("Accept-Language")})
            LOG.write_text(json.dumps(requests, ensure_ascii=False, indent=1) + "\n", "utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    do_GET = do_POST = do_PUT = do_DELETE = answer


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
