#!/usr/bin/env python3
"""Cordova iOS weather page references (IN-08, #2957): the blocks of S03 (Hourly) and S04 (Daily) of the Cordova build
on an iOS Simulator, the states of the Cordova manual's pages 3 to 9 with fixed data.

    capture.py run <simulator-udid> <cordova-app>     capture (ko-KR, light theme, 393x852 pt)
    capture.py provenance <cordova-app>                write ios/provenance/forecast-captures.json and the manifest

<cordova-app> comes from ios/tools/chart-reference/build-cordova.sh with server URL http://127.0.0.1:18455 (the local
fixture server of this tool; a dummy Firebase project, Google's test ad units). `run`:
  1. starts the fixture server on 127.0.0.1:18455: it answers the app's weather request with the selected corpus
     response (kma-seoul, vc-london; `fail`: HTTP 503), 404 for any other API path, and takes the capture script's
     records and screenshot requests;
  2. erases the owned simulator, sets ko-KR, installs a copy of the Cordova app with capture.js injected, launches it;
  3. capture.js adds 회현동 (kma-seoul), captures Hourly (and its chart with the detail rows) and Daily, adds 런던
     (vc-london) and captures both pages again, then O03 after a failed reload; the host takes simulator screenshots
     and crops and stacks the blocks (blocktool.swift) after finding the WebView's origin from a calibration marker;
  4. fails when a request went to a host other than this Mac or a weather request did not use /weather/v000903/coord/;
  5. uninstalls the app and shuts the simulator down.
Outputs (relative to ios/):
  TodayWeatherTests/ForecastReference/<page>-<block>.png, o03-weather.png   blocks (sRGB, device pixels at scale 3)
  TodayWeatherTests/ForecastReference/forecast-captures.json, forecast-<fixture>.input.json   (provenance) manifest and the served data
  Core/Tests/TWDomainTests/ForecastReference/<page>.json, o03-weather.json  every element of every block
Logs go to ios/build/forecast-reference/runs/.
"""
import hashlib
import json
import shutil
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
IOS = HERE.parents[1]
ROOT = IOS.parent
CORPUS = IOS / "Core/Tests/TWDomainTests/Corpus"
SHOTS = IOS / "TodayWeatherTests/ForecastReference"
RECORDS = IOS / "Core/Tests/TWDomainTests/ForecastReference"
PROVENANCE = IOS / "provenance/forecast-captures.json"
WORK = IOS / "build/forecast-reference"
PORT = 18455
SERVER = f"http://127.0.0.1:{PORT}"
BUNDLE = "net.wizardfactory.todayweather"
FIXTURES = ["kma-seoul", "vc-london"]
PAGES = ["kma-seoul-hourly", "kma-seoul-hourly-expanded", "kma-seoul-daily", "vc-london-hourly", "vc-london-daily", "o03-weather"]
# The owned capture simulator (iOS 26.5, iPhone 16, 393x852 pt, scale 3).
DEVICES = {"517DC815-4EF1-4EC7-835C-FAD594AFB4C5": ("twios_cap_16", "393x852")}
# Page sources inside the built app, compared with client/ at the build commit.
PAGE_SOURCES = ["templates/tab-forecast.html", "templates/tab-dailyforecast.html", "js/controller.forecastctrl.js",
                "js/controller.tabctrl.js", "js/service.weatherutil.js", "js/service.weatherinfo.js", "js/app.js",
                "css/ionic.app.css", "data/theme.js", "index.html"]
PRODUCTION_HOSTS = {"todayweather.wizardfactory.net", "tw-wzdfac.rhcloud.com", "todayweather-wizardfactory.rhcloud.com",
                    "todayweather.ai"}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(*args, **kw):
    return subprocess.run(list(args), check=True, capture_output=True, text=True, **kw).stdout


def simctl(*args):
    return run("xcrun", "simctl", *args)


def fixture_response(name):
    return json.loads((CORPUS / f"inputs/{name}.json").read_text("utf-8"))


def device_info(udid):
    devices = json.loads(run("xcrun", "simctl", "list", "devices", "-j"))["devices"]
    for runtime, items in devices.items():
        for d in items:
            if d["udid"] == udid:
                return {"name": d["name"], "udid": udid, "runtime": runtime, "deviceType": d.get("deviceTypeIdentifier")}
    sys.exit(f"simulator {udid} not found")


def owned(udid):
    if udid not in DEVICES:
        sys.exit(f"refusing simulator {udid}: only {sorted(DEVICES)} is used")
    name, size = DEVICES[udid]
    info = device_info(udid)
    if info["name"] != name:
        sys.exit(f"simulator {udid} is named {info['name']}, expected {name}")
    return info, size


class Server:
    def __init__(self, udid, out):
        self.udid, self.out = udid, out
        self.requests, self.records, self.envs = [], [], []
        self.done = threading.Event()
        self.error = None
        self.final = None
        self.origin = None
        self.origins = []
        self.selected = None
        self.shots = 0
        self.lock = threading.Lock()
        self.tool = WORK / "blocktool"

    def screenshot(self, name):
        self.shots += 1
        path = self.out / f"{self.shots:03d}-{name}.png"
        run("xcrun", "simctl", "io", self.udid, "screenshot", "--type=png", str(path))
        return path

    def find_origin(self, body):
        full = self.screenshot(f"{body['name']}-marker")
        dpr, marker = body["dpr"], body["marker"]
        x, y, w, h, width, height = map(int, run(str(self.tool), "marker", str(full)).split())
        if w != round(marker["size"] * dpr) or h != round(marker["size"] * dpr):
            raise RuntimeError(f"marker {w}x{h} px, expected {marker['size']} CSS px at {dpr}")
        self.screen = (width, height)
        self.origin = {"x": x - round(marker["left"] * dpr), "y": y - round(marker["top"] * dpr)}
        self.origins.append(self.origin)
        return {"origin": self.origin}

    def stack(self, body):
        dpr, o = body["dpr"], self.origin
        args = []
        pixels = []
        for p in body["pieces"]:
            # An element is painted at device pixels rounded from its layout position.
            x0, y0 = round(o["x"] + p["x"] * dpr), round(o["y"] + p["y"] * dpr)
            x1, y1 = round(o["x"] + (p["x"] + p["w"]) * dpr), round(o["y"] + (p["y"] + p["h"]) * dpr)
            args += [str(self.out / p["file"]), str(x0), str(y0), str(x1 - x0), str(y1 - y0)]
            pixels.append({"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0})
        SHOTS.mkdir(parents=True, exist_ok=True)
        dest = SHOTS / f"{body['name']}.png"
        run(str(self.tool), "stack", str(dest), *args)
        return {"file": dest.name, "pixels": pixels, "origin": o,
                "size": {"width": pixels[0]["width"], "height": sum(p["height"] for p in pixels)}}

    def handler(self):
        server = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def reply(self, status, payload=b"{}"):
                self.send_response(status)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Headers", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def handle_any(self):
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b""
                body = json.loads(raw.decode("utf-8")) if raw and self.path.startswith("/__tw/") else None
                entry = {"time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "method": self.command,
                         "path": self.path, "origin": self.headers.get("Origin"),
                         "acceptLanguage": self.headers.get("Accept-Language")}
                if self.path == "/__tw/observed":
                    entry["observed"] = body
                with server.lock:
                    server.requests.append(entry)
                if self.command == "OPTIONS":
                    return self.reply(204, b"")
                try:
                    path = urlparse(self.path).path
                    if path == "/__tw/origin":
                        return self.reply(200, json.dumps(server.find_origin(body)).encode())
                    if path == "/__tw/screen":
                        return self.reply(200, json.dumps({"file": server.screenshot(body["name"]).name}).encode())
                    if path == "/__tw/stack":
                        return self.reply(200, json.dumps(server.stack(body)).encode())
                    if path == "/__tw/select":
                        server.selected = body["fixture"]
                        return self.reply(200)
                    if path == "/__tw/env":
                        server.envs.append(body)
                        return self.reply(200)
                    if path == "/__tw/record":
                        server.records.append(body)
                        return self.reply(200)
                    if path == "/__tw/done":
                        server.final = body
                        server.done.set()
                        return self.reply(200)
                    if path == "/__tw/error":
                        server.error = server.error or body.get("error")
                        server.done.set()
                        return self.reply(200)
                    if path.startswith("/__tw/"):
                        return self.reply(200)
                    if path.startswith("/weather/v000903/coord/") and self.command == "GET":
                        entry["fixture"] = server.selected
                        if server.selected == "fail":
                            return self.reply(503, b'{"error":"capture"}')
                        return self.reply(200, json.dumps(fixture_response(server.selected), ensure_ascii=False).encode("utf-8"))
                    return self.reply(404)
                except Exception as e:  # reported to the page and to the run
                    server.error = f"{self.path}: {e!r}"
                    server.done.set()
                    return self.reply(500, json.dumps({"error": str(e)}).encode())

            do_GET = do_POST = do_PUT = do_DELETE = do_OPTIONS = handle_any

        return Handler

    def start(self):
        WORK.mkdir(parents=True, exist_ok=True)
        run("xcrun", "swiftc", "-O", "-o", str(self.tool), str(HERE / "blocktool.swift"))
        self.http = ThreadingHTTPServer(("127.0.0.1", PORT), self.handler())
        threading.Thread(target=self.http.serve_forever, daemon=True).start()

    def stop(self):
        self.http.shutdown()
        self.http.server_close()


def boot(udid):
    subprocess.run(["xcrun", "simctl", "shutdown", udid], capture_output=True)
    simctl("erase", udid)
    simctl("boot", udid)
    simctl("bootstatus", udid, "-b")
    simctl("spawn", udid, "defaults", "write", "-g", "AppleLanguages", "-array", "ko-KR")
    simctl("spawn", udid, "defaults", "write", "-g", "AppleLocale", "-string", "ko_KR")
    subprocess.run(["xcrun", "simctl", "shutdown", udid], capture_output=True)
    simctl("boot", udid)
    simctl("bootstatus", udid, "-b")
    simctl("status_bar", udid, "override", "--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100",
           "--cellularMode", "active", "--cellularBars", "4", "--wifiBars", "3", "--dataNetwork", "wifi")


def injected_app(cordova_app, out):
    if SERVER not in (Path(cordova_app) / "www/client.config.js").read_text("utf-8"):
        sys.exit(f"the Cordova app does not point at {SERVER}")
    app = out / "Cordova.app"
    shutil.rmtree(app, ignore_errors=True)
    shutil.copytree(cordova_app, app, symlinks=True)
    shutil.copy(HERE / "capture.js", app / "www/tw-forecast-capture.js")
    index = app / "www/index.html"
    html = index.read_text("utf-8")
    html = html.replace("<head>", f"<head>\n    <script>window.TW_SERVER = '{SERVER}';</script>\n"
                                  f"    <script src=\"tw-forecast-capture.js\"></script>", 1)
    index.write_text(html, "utf-8")
    run("codesign", "--force", "--sign", "-", "--timestamp=none", "--preserve-metadata=entitlements", str(app))
    return app


def capture(udid, cordova_app):
    info, size = owned(udid)
    out = WORK / "runs" / "ko-KR"
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    for d in (SHOTS, RECORDS):
        if d.exists():
            for p in d.iterdir():
                if p.suffix in (".png", ".json") and not p.name.endswith("tolerances.json"):
                    p.unlink()
    server = Server(udid, out)
    server.start()
    try:
        boot(udid)
        app = injected_app(cordova_app, out)
        simctl("install", udid, str(app))
        simctl("launch", udid, BUNDLE)
        if not server.done.wait(1200):
            raise SystemExit("no result after 1200 s")
        if server.error:
            server.screenshot("error")
            raise SystemExit(f"capture failed: {server.error}")
    finally:
        (out / "requests.json").write_text(json.dumps(server.requests, ensure_ascii=False, indent=1) + "\n", "utf-8")
        subprocess.run(["xcrun", "simctl", "terminate", udid, BUNDLE], capture_output=True)
        subprocess.run(["xcrun", "simctl", "uninstall", udid, BUNDLE], capture_output=True)
        subprocess.run(["xcrun", "simctl", "shutdown", udid], capture_output=True)
        server.stop()

    check_requests(server.requests)
    env = server.final
    if f"{env['screen']['width']}x{env['screen']['height']}" != size:
        raise SystemExit(f"unexpected display {env}")
    if env["language"] != "ko-KR" or env["theme"] != "light":
        raise SystemExit(f"unexpected language or theme {env}")
    if [r["page"] for r in server.records] != PAGES:
        raise SystemExit(f"recorded {[r['page'] for r in server.records]}")
    RECORDS.mkdir(parents=True, exist_ok=True)
    for record in server.records:
        (RECORDS / f"{record['page']}.json").write_text(json.dumps(record, ensure_ascii=False) + "\n", "utf-8")
    for name in FIXTURES:
        (SHOTS / f"forecast-{name}.input.json").write_text(json.dumps(fixture_response(name), ensure_ascii=False) + "\n", "utf-8")
    accept = sorted({r["acceptLanguage"] or "" for r in server.requests if r["path"].startswith("/weather/")})
    (out / "capture.json").write_text(json.dumps({
        "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "env": env, "startEnv": server.envs,
        "device": info, "webViewOrigins": server.origins, "weatherAcceptLanguage": accept}, ensure_ascii=False, indent=1) + "\n",
        "utf-8")
    print(f"pages {PAGES}, WebView origins {sorted({(o['x'], o['y']) for o in server.origins})}, Accept-Language {accept}")


def check_requests(requests):
    """No request for a TodayWeather host or an API path left this Mac; the weather requests used the v000903 coordinate
    path. capture.js sent every request for another host to the local server instead (blocked: true)."""
    for r in requests:
        o = r.get("observed")
        if o:
            url = urlparse(o["url"])
            local = (url.hostname or "") in {"127.0.0.1", "localhost"} or o["url"].startswith(("app://localhost", "data:", "blob:"))
            api = any(url.path.startswith(p) for p in ("/weather", "/v000", "/geocode", "/push", "/gather"))
            if (url.hostname or "") in PRODUCTION_HOSTS or (api and not local) or (not local and not o.get("blocked")):
                raise SystemExit(f"the page requested another host: {o}")
    weather = [r for r in requests if r["path"].startswith("/weather/")]
    if not weather or any(not r["path"].startswith("/weather/v000903/coord/") for r in weather):
        raise SystemExit(f"unexpected weather requests: {[r['path'] for r in weather][:5]}")


def manifest():
    """What the app-hosted screenshot tests read (they cannot read the package's test resources): each page's blocks with
    their image, kind and CSS size."""
    capture = json.loads((WORK / "runs/ko-KR/capture.json").read_text("utf-8"))
    pages = {}
    for page in PAGES:
        record = json.loads((RECORDS / f"{page}.json").read_text("utf-8"))
        if page == "o03-weather":
            els = record["popup"]["elements"]
            pages[page] = {"popup": {"file": record["image"]["file"], "rect": record["popup"]["rect"],
                                     "pixels": record["image"]["size"],
                                     "title": next((e["text"] for e in els if "popup-title" in e["cls"]), None),
                                     "body": [e["text"] for e in els if e["tag"] not in ("button", "h3") and "popup-title" not in e["cls"]
                                              and e["text"]],
                                     "buttons": [{"text": b["text"], "className": b["className"]} for b in record["buttons"]]}}
            continue
        pages[page] = {"header": record["header"], "blocks": [
            {"index": b["index"], "cls": b["cls"], "file": b["image"]["file"], "rect": b["rect"], "hidden": b.get("hidden", 0),
             "pieces": len(b["pieces"]), "pixels": b["image"]["size"]} for b in record["blocks"]]}
    (SHOTS / "forecast-captures.json").write_text(json.dumps({
        "source": "ios/tools/forecast-reference/capture.py manifest, from Core/Tests/TWDomainTests/ForecastReference",
        "size": "393x852", "devicePixelRatio": capture["env"]["devicePixelRatio"], "language": "ko-KR", "theme": "light",
        "units": capture["env"]["units"], "places": {
            "kma-seoul": {"name": "회현동", "address": "대한민국 서울특별시 중구 회현동", "country": "KR",
                          "location": {"lat": 37.56, "long": 126.98}, "cityCount": 1},
            "vc-london": {"name": "런던", "address": "영국 런던", "country": "GB", "location": {"lat": 51.51, "long": -0.13},
                          "cityCount": 2}},
        "webViewOrigin": capture["webViewOrigins"][0], "pages": pages}, ensure_ascii=False, indent=1) + "\n", "utf-8")


def provenance(cordova_app):
    manifest()
    app = Path(cordova_app)
    build = json.loads((app.parent / "build-cordova.json").read_text("utf-8"))
    commit = build["commit"]
    sources = []
    for rel in PAGE_SOURCES:
        built = app / "www" / rel
        client = f"client/www/{rel}"
        try:
            blob = subprocess.run(["git", "-C", str(ROOT), "show", f"{commit}:{client}"], check=True,
                                  capture_output=True).stdout
            tracked = True
        except subprocess.CalledProcessError:
            blob, tracked = None, False
        last = run("git", "-C", str(ROOT), "log", "-1", "--format=%H", commit, "--", client).strip() if tracked else None
        sources.append({"file": client, "appSha256": sha256(built), "tracked": tracked,
                        "clientSha256": hashlib.sha256(blob).hexdigest() if blob is not None else None,
                        "matchesClient": blob is not None and hashlib.sha256(blob).hexdigest() == sha256(built),
                        "lastCommit": last})
    capture = json.loads((WORK / "runs/ko-KR/capture.json").read_text("utf-8"))
    files = sorted([p for p in SHOTS.iterdir() if p.suffix in (".png", ".json") and not p.name.endswith("tolerances.json")] +
                   [p for p in RECORDS.glob("*.json")])
    PROVENANCE.write_text(json.dumps({
        "tool": "ios/tools/forecast-reference/capture.py",
        "build": {"recipe": "ios/tools/chart-reference/build-cordova.sh <out> http://127.0.0.1:18455", **build,
                  "note": "client/ from Git at the commit; serverUrl = the local fixture server; dummy Firebase project; "
                          "Google test ad units"},
        "data": {"served": "the corpus responses (Core/Tests/TWDomainTests/Corpus/inputs) for GET /weather/v000903/coord/...; "
                           "`fail`: HTTP 503", "places": "회현동 (kma-seoul) alone, then 런던 (vc-london) added and selected",
                 "settings": "defaults (Korean units, light theme)"},
        "pageSources": sources,
        "run": {"device": capture["device"], "capturedAt": capture["capturedAt"], "env": capture["env"],
                "webViewOrigins": capture["webViewOrigins"], "weatherAcceptLanguage": capture["weatherAcceptLanguage"]},
        "files": [{"path": p.relative_to(IOS).as_posix(), "sha256": sha256(p)} for p in files],
    }, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"wrote {PROVENANCE.relative_to(ROOT)} ({len(files)} files)")


if __name__ == "__main__":
    cmd = sys.argv[1:2]
    if cmd == ["run"] and len(sys.argv) == 4:
        capture(sys.argv[2], sys.argv[3])
    elif cmd == ["provenance"] and len(sys.argv) == 3:
        provenance(sys.argv[2])
    else:
        sys.exit(__doc__)
