#!/usr/bin/env python3
"""Cordova iOS start page references (IN-10, #2959): S01 of a first launch with its access notice O01 (the Cordova
manual's page 1) and after the notice closed (page 2), as the Cordova build shows them on an iOS Simulator.

    capture.py run <simulator-udid> <cordova-app> <ko-KR|en-US>   capture (393x852 pt)
    capture.py provenance <cordova-app>                            write the manifest and the provenance

<cordova-app> comes from ios/tools/chart-reference/build-cordova.sh with server URL http://127.0.0.1:18460 (the local
fixture server of this tool; a dummy Firebase project, Google's test ad units). `run`:
  1. starts the local server on 127.0.0.1:18460, which takes the capture script's records, steps and screenshot
     requests and answers any other path with 404 (S01 sends no API request before a place is chosen);
  2. erases the owned simulator, sets the language, installs a copy of the Cordova app with capture.js injected and
     launches it (a first launch: S01 with O01);
  3. capture.js records O01 over S01, closes O01 and records S01, then S01 with a typed word and three predictions as
     the Places callback sets them; the host takes simulator screenshots and crops the
     page, the status bar and the popup after finding the WebView's origin from a calibration marker
     (ios/tools/forecast-reference/blocktool.swift);
  4. fails when a request or a script went to a host other than this Mac, or the page sent an API request;
  5. uninstalls the app and shuts the simulator down.
Outputs (relative to ios/): TodayWeatherTests/StartReference/start-<lang>-<state>[-<part>].png and
start-<lang>-<state>.json (rects, texts, computed styles). `provenance` adds TodayWeatherTests/StartReference/
start-captures.json (the manifest the app-hosted tests read) and provenance/start-captures.json. Logs go to
ios/build/start-reference/runs/.
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
SHOTS = IOS / "TodayWeatherTests/StartReference"
PROVENANCE = IOS / "provenance/start-captures.json"
WORK = IOS / "build/start-reference"
BLOCKTOOL = IOS / "tools/forecast-reference/blocktool.swift"
PORT = 18460
SERVER = f"http://127.0.0.1:{PORT}"
BUNDLE = "net.wizardfactory.todayweather"
LANGS = {"ko-KR": "ko_KR", "en-US": "en_US"}
STATES = ["access", "start", "search"]
# The owned capture simulator (iOS 26.5, iPhone 16, 393x852 pt, scale 3).
DEVICES = {"20A3172F-A9DE-4089-926D-C1DE24FDC8FE": ("twios_in10_cap", "393x852")}
# Sources of the captured page inside the built app, compared with client/ at the build commit.
PAGE_SOURCES = ["templates/start.html", "js/controller.start.js", "js/service.util.js", "js/app.js", "css/ionic.app.css",
                "lib/ionic/css/ionic.css", "img/app_icon.png", "img/powered_by_google_on_white.png", "index.html", "locales/ko.json", "locales/en.json"]
PRODUCTION_HOSTS = {"todayweather.wizardfactory.net", "tw-wzdfac.rhcloud.com", "todayweather-wizardfactory.rhcloud.com",
                    "todayweather.ai"}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(*args, **kw):
    return subprocess.run(list(args), check=True, capture_output=True, text=True, **kw).stdout


def simctl(*args):
    return run("xcrun", "simctl", *args)


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
    def __init__(self, udid, out, lang):
        self.udid, self.out, self.lang = udid, out, lang
        self.requests, self.records = [], []
        self.done = threading.Event()
        self.error = None
        self.final = None
        self.origin = None
        self.origins = []
        self.screen = None
        self.step = None
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

    def crop(self, full, name, x0, y0, x1, y1):
        SHOTS.mkdir(parents=True, exist_ok=True)
        dest = SHOTS / f"start-{self.lang}-{name}.png"
        run(str(self.tool), "stack", str(dest), str(full), str(x0), str(y0), str(x1 - x0), str(y1 - y0))
        return {"file": dest.name, "pixels": {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}}

    def shot(self, body):
        full = self.screenshot(body["name"])
        dpr, origin = body["dpr"], self.origin
        crops = {}
        for part, r in body["rects"].items():
            if r == "above":  # the native status bar above the WebView
                crops[part] = self.crop(full, f"{body['name']}-statusbar", 0, 0, self.screen[0], origin["y"])
                continue
            # An element is painted at device pixels rounded from its layout position.
            x0, y0 = round(origin["x"] + r["x"] * dpr), round(origin["y"] + r["y"] * dpr)
            x1 = min(self.screen[0], round(origin["x"] + (r["x"] + r["w"]) * dpr))
            y1 = min(self.screen[1], round(origin["y"] + (r["y"] + r["h"]) * dpr))
            name = body["name"] if part == "page" else f"{body['name']}-{part}"
            crops[part] = self.crop(full, name, x0, y0, x1, y1)
        return {"origin": origin, "crops": crops, "screenshot": full.name}

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
                entry = {"time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "step": server.step,
                         "method": self.command, "path": self.path, "origin": self.headers.get("Origin")}
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
                    if path == "/__tw/shot":
                        return self.reply(200, json.dumps(server.shot(body)).encode())
                    if path == "/__tw/step":
                        server.step = body["name"]
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
                    return self.reply(404)
                except Exception as e:  # reported to the page and to the run
                    server.error = f"{self.path}: {e!r}"
                    server.done.set()
                    return self.reply(500, json.dumps({"error": str(e)}).encode())

            do_GET = do_POST = do_PUT = do_DELETE = do_OPTIONS = handle_any

        return Handler

    def start(self):
        WORK.mkdir(parents=True, exist_ok=True)
        run("xcrun", "swiftc", "-O", "-o", str(self.tool), str(BLOCKTOOL))
        self.http = ThreadingHTTPServer(("127.0.0.1", PORT), self.handler())
        threading.Thread(target=self.http.serve_forever, daemon=True).start()

    def stop(self):
        self.http.shutdown()
        self.http.server_close()


def boot(udid, lang):
    subprocess.run(["xcrun", "simctl", "shutdown", udid], capture_output=True)
    simctl("erase", udid)
    simctl("boot", udid)
    simctl("bootstatus", udid, "-b")
    simctl("spawn", udid, "defaults", "write", "-g", "AppleLanguages", "-array", lang)
    simctl("spawn", udid, "defaults", "write", "-g", "AppleLocale", "-string", LANGS[lang])
    subprocess.run(["xcrun", "simctl", "shutdown", udid], capture_output=True)
    simctl("boot", udid)
    simctl("bootstatus", udid, "-b")
    simctl("status_bar", udid, "override", "--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100",
           "--cellularMode", "active", "--cellularBars", "4", "--wifiBars", "3", "--dataNetwork", "wifi")


def injected_app(cordova_app, out, lang):
    if SERVER not in (Path(cordova_app) / "www/client.config.js").read_text("utf-8"):
        sys.exit(f"the Cordova app does not point at {SERVER}")
    app = out / "Cordova.app"
    shutil.rmtree(app, ignore_errors=True)
    shutil.copytree(cordova_app, app, symlinks=True)
    shutil.copy(HERE / "capture.js", app / "www/tw-start-capture.js")
    index = app / "www/index.html"
    html = index.read_text("utf-8")
    html = html.replace("<head>", f"<head>\n    <script>window.TW_SERVER = '{SERVER}'; window.TW_LANG = '{lang}';</script>\n"
                                  f"    <script src=\"tw-start-capture.js\"></script>", 1)
    index.write_text(html, "utf-8")
    run("codesign", "--force", "--sign", "-", "--timestamp=none", "--preserve-metadata=entitlements", str(app))
    return app


def capture(udid, cordova_app, lang):
    if lang not in LANGS:
        sys.exit(f"language {lang}: one of {sorted(LANGS)}")
    info, size = owned(udid)
    out = WORK / "runs" / lang
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    if SHOTS.exists():
        for p in SHOTS.glob(f"start-{lang}-*"):
            p.unlink()
    server = Server(udid, out, lang)
    server.start()
    try:
        boot(udid, lang)
        app = injected_app(cordova_app, out, lang)
        simctl("install", udid, str(app))
        simctl("launch", udid, BUNDLE)
        if not server.done.wait(900):
            raise SystemExit("no result after 900 s")
        if server.error:
            server.screenshot("error")
            raise SystemExit(f"capture failed: {server.error}")
    finally:
        (out / "requests.json").write_text(json.dumps(server.requests, ensure_ascii=False, indent=1) + "\n", "utf-8")
        subprocess.run(["xcrun", "simctl", "terminate", udid, BUNDLE], capture_output=True)
        subprocess.run(["xcrun", "simctl", "uninstall", udid, BUNDLE], capture_output=True)
        subprocess.run(["xcrun", "simctl", "shutdown", udid], capture_output=True)
        server.stop()

    check_requests(server.requests, server.records)
    env = server.final
    if f"{env['screen']['width']}x{env['screen']['height']}" != size:
        raise SystemExit(f"unexpected display {env}")
    if env["language"] != lang:
        raise SystemExit(f"unexpected language {env['language']}")
    names = [r["name"] for r in server.records]
    if names != STATES:
        raise SystemExit(f"recorded {names}")
    for record in server.records:
        (SHOTS / f"start-{lang}-{record['name']}.json").write_text(json.dumps(record, ensure_ascii=False) + "\n", "utf-8")
    (out / "capture.json").write_text(json.dumps({
        "language": lang, "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "env": env,
        "device": info, "webViewOrigins": server.origins}, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"{lang}: {len(names)} states, WebView origins {sorted({(o['x'], o['y']) for o in server.origins})}")


def local(url):
    host = urlparse(url).hostname or ""
    return host in {"127.0.0.1", "localhost"} or url.startswith(("app://localhost", "data:", "blob:"))


def check_requests(requests, records):
    """No request for another host left this Mac (capture.js sent each to the local server instead), no script was
    loaded from another host (the Maps JavaScript API stand-in), and the page sent no API request."""
    for r in requests:
        o = r.get("observed")
        if o:
            url = urlparse(o["url"])
            if (url.hostname or "") in PRODUCTION_HOSTS or (not local(o["url"]) and not o.get("blocked")):
                raise SystemExit(f"the page requested another host: {o}")
    api = [r["path"] for r in requests if not r["path"].startswith("/__tw/")]
    if api:
        raise SystemExit(f"unexpected requests: {api[:5]}")
    for record in records:
        foreign = [s for s in record.get("scripts", []) if not local(s)]
        if foreign:
            raise SystemExit(f"scripts from another host: {foreign}")


def manifest():
    """What the app-hosted tests read: each state's files and the shortcuts the page showed."""
    states = {}
    for lang in LANGS:
        for name in STATES:
            record = json.loads((SHOTS / f"start-{lang}-{name}.json").read_text("utf-8"))
            states[f"{lang}/{name}"] = {"crops": {k: v["file"] for k, v in record["shot"]["crops"].items()},
                                        "shortcuts": record["shortcuts"]}
    capture = json.loads((WORK / "runs/ko-KR/capture.json").read_text("utf-8"))
    (SHOTS / "start-captures.json").write_text(json.dumps({
        "source": "ios/tools/start-reference/capture.py provenance, from the records start-<lang>-<state>.json",
        "size": "393x852", "devicePixelRatio": capture["env"]["devicePixelRatio"],
        "webViewOrigin": capture["webViewOrigins"][0], "states": states}, ensure_ascii=False, indent=1) + "\n", "utf-8")
    return capture


def provenance(cordova_app):
    capture = manifest()
    english = json.loads((WORK / "runs/en-US/capture.json").read_text("utf-8"))
    app = Path(cordova_app)
    build = json.loads((app.parent / "build-cordova.json").read_text("utf-8"))
    commit = build["commit"]
    sources = []
    for rel in PAGE_SOURCES:
        built = app / "www" / rel
        client = f"client/www/{rel}"
        try:
            blob = subprocess.run(["git", "-C", str(ROOT), "show", f"{commit}:{client}"], check=True, capture_output=True).stdout
            tracked = True
        except subprocess.CalledProcessError:
            blob, tracked = None, False
        last = run("git", "-C", str(ROOT), "log", "-1", "--format=%H", commit, "--", client).strip() if tracked else None
        sources.append({"file": client, "appSha256": sha256(built) if built.exists() else None, "tracked": tracked,
                        "clientSha256": hashlib.sha256(blob).hexdigest() if blob is not None else None,
                        "matchesClient": blob is not None and built.exists() and hashlib.sha256(blob).hexdigest() == sha256(built),
                        "lastCommit": last})
    files = sorted(p for p in SHOTS.iterdir() if p.suffix in (".png", ".json") and not p.name.endswith("tolerances.json"))
    PROVENANCE.write_text(json.dumps({
        "tool": "ios/tools/start-reference/capture.py",
        "build": {"recipe": f"ios/tools/chart-reference/build-cordova.sh <out> {SERVER}", **build,
                  "note": "client/ from Git at the commit; serverUrl = the local fixture server; dummy Firebase project; "
                          "Google test ad units"},
        "data": {"state": "a first launch (no stored state): S01 with O01, then S01 after O01's OK",
                 "places": "an inert stand-in for the Maps JavaScript API (window.google), so no script is fetched"},
        "pageSources": sources,
        "runs": {lang: {"device": c["device"], "capturedAt": c["capturedAt"], "env": c["env"], "webViewOrigins": c["webViewOrigins"]}
                 for lang, c in (("ko-KR", capture), ("en-US", english))},
        "files": [{"path": p.relative_to(IOS).as_posix(), "sha256": sha256(p)} for p in files],
    }, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"wrote {PROVENANCE.relative_to(ROOT)} ({len(files)} files)")


if __name__ == "__main__":
    cmd = sys.argv[1:2]
    if cmd == ["run"] and len(sys.argv) == 5:
        capture(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == ["provenance"] and len(sys.argv) == 3:
        provenance(sys.argv[2])
    else:
        sys.exit(__doc__)
