#!/usr/bin/env python3
"""Local recorder for the upgrade test: the Cordova test build's server URL points here.

    python3 recorder.py <port> <out-dir>

Every request is appended to <out-dir>/requests.jsonl and answered locally (404 for API paths, 200 for the
harness paths), so nothing the app sends leaves the Mac. The seed script posts:
- /__tw/observed: a request the page started (XHR or fetch) with its URL, so requests to other hosts are seen too;
- /__tw/seeded: the state it wrote, saved as <out-dir>/seeded.json.
CORS headers allow the app://localhost origin. Stop it with SIGTERM.
"""
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1])
OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)
LOG = os.path.join(OUT, "requests.jsonl")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _record(self, body):
        entry = {"time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "method": self.command,
                 "path": self.path, "host": self.headers.get("Host"), "origin": self.headers.get("Origin"),
                 "length": len(body)}
        if self.path == "/__tw/observed":
            try:
                entry["observed"] = json.loads(body.decode("utf-8"))
            except ValueError:
                entry["observed"] = {"unparsable": body.decode("utf-8", "replace")[:200]}
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def _reply(self, status, payload=b""):
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _handle(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        self._record(body)
        if self.command == "OPTIONS":
            return self._reply(204)
        if self.path == "/__tw/seeded":
            with open(os.path.join(OUT, "seeded.json"), "wb") as f:
                f.write(body)
            return self._reply(200, b"{}")
        if self.path.startswith("/__tw/"):
            return self._reply(200, b"{}")
        return self._reply(404, b"{}")

    do_GET = do_POST = do_PUT = do_DELETE = do_OPTIONS = _handle


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
