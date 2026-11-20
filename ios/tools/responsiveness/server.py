"""Local-only response recorder. Optional JSON controls set delay_ms and weather/nation/special modes."""
import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import urlsplit

ios = Path(__file__).resolve().parents[2]
places = ios / "TodayWeatherTests/PlacesReference"
corpus = ios / "Core/Tests/TWDomainTests/Corpus/inputs"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("port", type=int)
parser.add_argument("log", type=Path)
parser.add_argument("--controls", type=Path)
args = parser.parse_args()
lock = Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def answer(self):
        start = time.monotonic_ns()
        path = urlsplit(self.path).path
        length = int(self.headers.get("Content-Length", 0))
        self.rfile.read(length)
        status, data, route = 404, b"{}", "unexpected"
        if self.command == "GET":
            if path in ("/weather/v000903/coord/37.567,126.978", "/weather/v000903/coord/51.51,-0.13"):
                name = "vc-london" if path.endswith("51.51,-0.13") else "kma-seoul"
                route, file = "weather", places / f"places-{name}.input.json"
            elif path.startswith("/geocode/v000903/"):
                route, file = "geocode", places / "places-geocode-seoul.input.json"
            elif path == "/v000903/nation/KR":
                route, file = "nation", corpus / "nation.json"
            elif path == "/v000903/kma/special":
                route, file = "special", corpus / "special.json"
            if route != "unexpected":
                status, data = 200, file.read_bytes()
        elif self.command == "POST" and path in ("/v000903/push-list", "/v000903/push"):
            status, route = 200, "push"
        controls = json.loads(args.controls.read_text()) if args.controls and args.controls.exists() else {}
        size = controls.get("size")
        if size in ("sparse", "dense") and route == "weather" and "kma" in file.name:
            weather = json.loads(data)
            stations = weather["airInfoList"]
            if size == "sparse":
                weather["short"] = weather["short"][:8]
                weather["airInfoList"] = stations[:1]
            else:
                weather["airInfoList"] = [dict(stations[i % len(stations)],
                    last=dict(stations[i % len(stations)]["last"], stationName=f"Fixture {i+1}")) for i in range(18)]
            data = json.dumps(weather, ensure_ascii=False).encode()
        if size in ("sparse", "dense") and route == "special":
            cards = json.loads(data)
            cards = cards[:1] if size == "sparse" else cards * 6
            data = json.dumps(cards, ensure_ascii=False).encode()
        mode = controls.get(route, "normal")
        if mode == "failed":
            status, data = 503, b"{}"
        elif mode == "empty":
            data = {"special": b"[]", "nation": b'{"nation":"KR","weather":[]}'}.get(route, b"{}")
        time.sleep(controls.get("delay_ms", 0) / 1000)
        completed = False
        try:
            if mode == "disconnect":
                status, data = 0, b""
                self.close_connection = True
                return
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            completed = True
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            record = dict(start_ns=start, end_ns=time.monotonic_ns(), method=self.command, path=self.path,
                          route=route, status=status, mode=mode, request_body_bytes=length,
                          response_body_bytes=len(data), socket_write_completed=completed)
            with lock, args.log.open("a") as f:
                print(json.dumps(record), file=f)

    do_GET = do_POST = do_PUT = do_DELETE = answer


ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
