#!/usr/bin/env python3
"""Cordova iOS settings references (IN-12, #2961): S07 (units), every S08 list, the weather page after a unit and a theme
change and the About popup O10 of the Cordova build on an iOS Simulator: the states of the Cordova manual's pages 25 to
31 and 36 with fixed data.

    capture.py run <simulator-udid> <cordova-app> <ko-KR|en-US>   capture (393x852 pt)
    capture.py provenance <cordova-app>                            write the manifest, the golden and the provenance

<cordova-app> comes from ios/tools/chart-reference/build-cordova.sh with server URL http://127.0.0.1:18456 (the local
fixture server of this tool; a dummy Firebase project, Google's test ad units). `run`:
  1. starts the fixture server on 127.0.0.1:18456: it answers the app's weather request with the corpus response
     kma-seoul, or kma-seoul-f for a request in °F (the server converts units), 404 for any other API path, and takes the
     capture script's records, steps and screenshot requests;
  2. erases the owned simulator, sets the language, installs a copy of the Cordova app with capture.js injected and
     launches it;
  3. capture.js adds 회현동, then (ko-KR) opens S07 and each unit's list, chooses 온도단위 F and goes back to the weather,
     chooses C again, opens the startup page, refresh interval and theme lists, chooses the dark and photo themes (each
     time going back to the weather) and light again, and opens About; en-US: S07 and About. The host takes simulator
     screenshots and crops each page, the status bar, the weather blocks and the popup after finding the WebView's origin
     from a calibration marker (ios/tools/forecast-reference/blocktool.swift);
  4. fails when a request went to a host other than this Mac or a weather request did not use /weather/v000903/coord/;
  5. uninstalls the app and shuts the simulator down.
Outputs (relative to ios/): TodayWeatherTests/SettingsReference/settings-<lang>-<state>[-<part>].png and
settings-<lang>-<state>.json (rects, texts, computed styles). `provenance` adds TodayWeatherTests/SettingsReference/
settings-captures.json (the manifest the app-hosted tests read), Core/Tests/TWDataTests/Golden/settings-capture.json
(the weather request each step sent, WebKit's URL of the mail links and the WebView's user agent) and
provenance/settings-captures.json. Logs go to ios/build/settings-reference/runs/.
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
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
IOS = HERE.parents[1]
ROOT = IOS.parent
CORPUS = IOS / "Core/Tests/TWDomainTests/Corpus"
SHOTS = IOS / "TodayWeatherTests/SettingsReference"
GOLDEN = IOS / "Core/Tests/TWDataTests/Golden/settings.json"
CAPTURE_GOLDEN = IOS / "Core/Tests/TWDataTests/Golden/settings-capture.json"
PROVENANCE = IOS / "provenance/settings-captures.json"
WORK = IOS / "build/settings-reference"
BLOCKTOOL = IOS / "tools/forecast-reference/blocktool.swift"
PORT = 18456
SERVER = f"http://127.0.0.1:{PORT}"
BUNDLE = "net.wizardfactory.todayweather"
LANGS = {"ko-KR": "ko_KR", "en-US": "en_US"}
STATES = {
    "ko-KR": ["units", "radio-temperatureUnit", "radio-windSpeedUnit", "radio-pressureUnit", "radio-distanceUnit",
              "radio-precipitationUnit", "radio-airUnit", "radio-temperatureUnit-f", "units-f", "hourly-f",
              "radio-startupPage", "radio-refreshInterval", "radio-theme", "radio-theme-dark", "hourly-dark",
              "radio-theme-photo", "hourly-photo", "about"],
    "en-US": ["units", "about"],
}
# The owned capture simulator (iOS 26.5, iPhone 16, 393x852 pt, scale 3).
DEVICES = {"517DC815-4EF1-4EC7-835C-FAD594AFB4C5": ("twios_cap_16", "393x852")}
# Sources of the captured pages inside the built app, compared with client/ at the build commit.
PAGE_SOURCES = ["templates/units.html", "templates/setting-radio.html", "templates/tab-forecast.html",
                "js/controller.units.js", "js/controller.setting.radio.js", "js/controller.settingctrl.js",
                "js/service.util.js", "js/controller.forecastctrl.js", "js/app.js", "css/ionic.app.css", "data/theme.js",
                "index.html", "locales/ko.json", "locales/en.json"]
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


def mail_raws():
    """The strings the Cordova mail row assigns to location.href, from the JavaScriptCore golden."""
    golden = json.loads(GOLDEN.read_text("utf-8"))
    return [m["location"] for m in golden["menu"] if m["row"] == "sendMail"]


class Server:
    def __init__(self, udid, out, lang):
        self.udid, self.out, self.lang = udid, out, lang
        self.requests, self.records, self.envs = [], [], []
        self.done = threading.Event()
        self.error = None
        self.final = None
        self.origin = None
        self.origins = []
        self.screen = None
        self.step = None
        self.mail = None
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
        dest = SHOTS / f"settings-{self.lang}-{name}.png"
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
            name = body["name"] if part in ("page", "block") else f"{body['name']}-{part}"
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
                         "method": self.command, "path": self.path, "origin": self.headers.get("Origin"),
                         "acceptLanguage": self.headers.get("Accept-Language")}
                if self.path == "/__tw/observed":
                    entry["observed"] = body
                with server.lock:
                    server.requests.append(entry)
                if self.command == "OPTIONS":
                    return self.reply(204, b"")
                try:
                    url = urlparse(self.path)
                    path = url.path
                    if path == "/__tw/origin":
                        return self.reply(200, json.dumps(server.find_origin(body)).encode())
                    if path == "/__tw/shot":
                        return self.reply(200, json.dumps(server.shot(body)).encode())
                    if path == "/__tw/step":
                        server.step = body["name"]
                        return self.reply(200)
                    if path == "/__tw/env":
                        server.envs.append(body)
                        return self.reply(200)
                    if path == "/__tw/record":
                        server.records.append(body)
                        return self.reply(200)
                    if path == "/__tw/mail-raw":
                        return self.reply(200, json.dumps(mail_raws(), ensure_ascii=False).encode("utf-8"))
                    if path == "/__tw/mail":
                        server.mail = body
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
                        query = parse_qs(url.query)
                        fixture = "kma-seoul-f" if query.get("temperatureUnit") == ["F"] else "kma-seoul"
                        entry["fixture"] = fixture
                        return self.reply(200, json.dumps(fixture_response(fixture), ensure_ascii=False).encode("utf-8"))
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
    shutil.copy(HERE / "capture.js", app / "www/tw-settings-capture.js")
    index = app / "www/index.html"
    html = index.read_text("utf-8")
    html = html.replace("<head>", f"<head>\n    <script>window.TW_SERVER = '{SERVER}'; window.TW_LANG = '{lang}';</script>\n"
                                  f"    <script src=\"tw-settings-capture.js\"></script>", 1)
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
        for p in SHOTS.glob(f"settings-{lang}-*"):
            p.unlink()
    server = Server(udid, out, lang)
    server.start()
    try:
        boot(udid, lang)
        app = injected_app(cordova_app, out, lang)
        simctl("install", udid, str(app))
        simctl("launch", udid, BUNDLE)
        if not server.done.wait(1500):
            raise SystemExit("no result after 1500 s")
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
    if env["language"] != lang:
        raise SystemExit(f"unexpected language {env['language']}")
    names = [r["name"] for r in server.records]
    if names != STATES[lang]:
        raise SystemExit(f"recorded {names}")
    for record in server.records:
        (SHOTS / f"settings-{lang}-{record['name']}.json").write_text(json.dumps(record, ensure_ascii=False) + "\n", "utf-8")
    weather = [{"step": r["step"], "path": r["path"], "fixture": r.get("fixture"), "acceptLanguage": r["acceptLanguage"]}
               for r in server.requests if r["path"].startswith("/weather/")]
    (out / "capture.json").write_text(json.dumps({
        "language": lang, "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "env": env,
        "startEnv": server.envs, "device": info, "webViewOrigins": server.origins, "weather": weather,
        "mail": server.mail}, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"{lang}: {len(names)} states, WebView origins {sorted({(o['x'], o['y']) for o in server.origins})}, "
          f"{len(weather)} weather requests")


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
    """What the app-hosted tests read: each state's files and rects, and the served responses."""
    states = {}
    for lang, names in STATES.items():
        for name in names:
            record = json.loads((SHOTS / f"settings-{lang}-{name}.json").read_text("utf-8"))
            crops = record["shot"]["crops"] if "shot" in record else {}
            entry = {"crops": {k: v["file"] for k, v in crops.items()}}
            if name.startswith("hourly-"):
                entry = {"units": record["units"], "theme": record["theme"], "header": record["header"],
                         "blocks": [{"index": b["index"], "file": b["shot"]["crops"]["block"]["file"], "rect": b["rect"],
                                     "pixels": b["shot"]["crops"]["block"]["pixels"]} for b in record["blocks"]]}
            states[f"{lang}/{name}"] = entry
    # kma-seoul is the forecast references' forecast-kma-seoul.input.json.
    for name in ("kma-seoul-f",):
        (SHOTS / f"settings-{name}.input.json").write_text(json.dumps(fixture_response(name), ensure_ascii=False) + "\n", "utf-8")
    capture = json.loads((WORK / "runs/ko-KR/capture.json").read_text("utf-8"))
    (SHOTS / "settings-captures.json").write_text(json.dumps({
        "source": "ios/tools/settings-reference/capture.py provenance, from the records settings-<lang>-<state>.json",
        "size": "393x852", "devicePixelRatio": capture["env"]["devicePixelRatio"],
        "place": {"name": "회현동", "address": "대한민국 서울특별시 중구 회현동", "country": "KR",
                  "location": {"lat": 37.56, "long": 126.98}},
        "webViewOrigin": capture["webViewOrigins"][0], "states": states}, ensure_ascii=False, indent=1) + "\n", "utf-8")
    return capture


def provenance(cordova_app):
    capture = manifest()
    english = json.loads((WORK / "runs/en-US/capture.json").read_text("utf-8"))
    CAPTURE_GOLDEN.write_text(json.dumps({
        "source": "ios/tools/settings-reference/capture.py: what the Cordova iOS build (settings-captures provenance) sent "
                  "and parsed on the owned twios_cap_16 simulator",
        "note": "weather: every weather request with the capture step that caused it (path and query as the fixture server "
                "received them; the server URL left out). mail: WebKit's URL (`new URL(text).href` in the WKWebView) of "
                "the strings the Cordova mail row assigns to location.href (Golden/settings.json). userAgent: "
                "navigator.userAgent of the WKWebView.",
        "weather": capture["weather"], "mail": capture["mail"]["hrefs"], "userAgent": capture["mail"]["userAgent"],
        "englishWeather": english["weather"]}, ensure_ascii=False, indent=1) + "\n", "utf-8")
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
        sources.append({"file": client, "appSha256": sha256(built), "tracked": tracked,
                        "clientSha256": hashlib.sha256(blob).hexdigest() if blob is not None else None,
                        "matchesClient": blob is not None and hashlib.sha256(blob).hexdigest() == sha256(built),
                        "lastCommit": last})
    files = sorted([p for p in SHOTS.iterdir() if p.suffix in (".png", ".json") and not p.name.endswith("tolerances.json")]
                   + [CAPTURE_GOLDEN])
    PROVENANCE.write_text(json.dumps({
        "tool": "ios/tools/settings-reference/capture.py",
        "build": {"recipe": "ios/tools/chart-reference/build-cordova.sh <out> http://127.0.0.1:18456", **build,
                  "note": "client/ from Git at the commit; serverUrl = the local fixture server; dummy Firebase project; "
                          "Google test ad units"},
        "data": {"served": "the corpus responses kma-seoul and, for a request in °F, kma-seoul-f "
                           "(Core/Tests/TWDomainTests/Corpus/inputs) for GET /weather/v000903/coord/...",
                 "place": "회현동 (kma-seoul) alone", "settings": "Korean default units, light theme at the start"},
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
