#!/usr/bin/env python3
"""Cordova iOS shell references (IN-07, #2956): the tab bar, header bar, side menu, status bar and launch screen of the
Cordova build on an iOS Simulator, and how its WebView reports the system languages.

    capture.py run <simulator-udid> <cordova-app> <ko-KR|en-US>   capture the shell in one language
    capture.py languages <simulator-udid> <cordova-app>            record navigator.language(s) and Accept-Language
    capture.py provenance <cordova-app>                            write ios/provenance/shell-captures.json

<cordova-app> comes from ios/tools/chart-reference/build-cordova.sh with server URL http://127.0.0.1:18454 (the local
fixture server of this tool; a dummy Firebase project, Google's test ad units). `run`:
  1. starts the fixture server on 127.0.0.1:18454: it answers the app's weather request with the kma-seoul response of
     the corpus copy, 404 for any other API path, and takes the capture script's records and screenshot requests;
  2. erases the owned simulator, sets the language and region, installs a copy of the Cordova app with capture.js
     injected and launches it;
  3. capture.js shows the place on the Hourly tab in each theme; the host takes simulator screenshots and crops the
     tab bar, the header bar, the open menu and the status bar above the WebView (pngtool.swift of chart-reference);
     the launch screen is taken before the app hides it;
  4. fails when a request went to a host other than this Mac or the weather request did not use
     /weather/v000903/coord/;
  5. uninstalls the app and shuts the simulator down.
Outputs (relative to ios/):
  TodayWeatherTests/ShellReference/shell-<lang>-<theme>-<tab>-{tabs,header,statusbar}.png (each tab),
    shell-<lang>-<theme>-menu.png and -menu-statusbar.png (the menu open on Hourly), shell-<lang>-<theme>.json
  TodayWeatherTests/ShellReference/shell-<lang>-splash.png (scaled to points), shell-captures.json (manifest)
  Core/Tests/TWDomainTests/ShellReference/languages.json (`languages`)
Logs go to ios/build/shell-reference/runs/.
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
SHOTS = IOS / "TodayWeatherTests/ShellReference"
LANGUAGES = IOS / "Core/Tests/TWDomainTests/ShellReference/languages.json"
PROVENANCE = IOS / "provenance/shell-captures.json"
WORK = IOS / "build/shell-reference"
PNGTOOL_SOURCE = IOS / "tools/chart-reference/pngtool.swift"
PORT = 18454
SERVER = f"http://127.0.0.1:{PORT}"
BUNDLE = "net.wizardfactory.todayweather"
THEMES = ["light", "dark", "photo", "old"]
LANGS = {"ko-KR": ("ko_KR",), "en-US": ("en_US",)}
# The owned capture simulator (iOS 26.5, iPhone 16, 393x852 pt, scale 3).
DEVICES = {"517DC815-4EF1-4EC7-835C-FAD594AFB4C5": ("twios_cap_16", "393x852")}
# System language lists (AppleLanguages, AppleLocale) whose WebView language and Accept-Language are recorded.
LANGUAGE_CASES = [
    (["ko-KR"], "ko_KR"), (["en-US"], "en_US"), (["en-KR"], "en_KR"), (["ko-KR", "en-US"], "ko_KR"),
    (["en-US", "ko-KR"], "en_US"), (["ja-JP"], "ja_JP"), (["de-AT"], "de_AT"), (["zh-Hans-CN"], "zh_CN"),
    (["zh-Hant-TW"], "zh_TW"), (["zh-Hant-HK"], "zh_HK"), (["fr-FR", "ko-KR"], "fr_FR"), (["ko"], "ko"),
]
# Shell sources inside the built app, compared with client/ at the build commit.
SHELL_SOURCES = ["index.html", "templates/tabs.html", "js/app.js", "js/controller.tabctrl.js",
                 "js/controller.settingctrl.js", "js/controller.setting.radio.js", "js/service.util.js",
                 "js/service.weatherutil.js", "css/ionic.app.css", "data/theme.js"]
PRODUCTION_HOSTS = {"todayweather.wizardfactory.net", "tw-wzdfac.rhcloud.com", "todayweather-wizardfactory.rhcloud.com",
                    "todayweather.ai"}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(*args, **kw):
    return subprocess.run(list(args), check=True, capture_output=True, text=True, **kw).stdout


def simctl(*args):
    return run("xcrun", "simctl", *args)


def fixture_response():
    return json.loads((CORPUS / "inputs/kma-seoul.json").read_text("utf-8"))


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


def boot(udid, languages, locale, erase):
    subprocess.run(["xcrun", "simctl", "shutdown", udid], capture_output=True)
    if erase:
        simctl("erase", udid)
    simctl("boot", udid)
    simctl("bootstatus", udid, "-b")
    simctl("spawn", udid, "defaults", "write", "-g", "AppleLanguages", "-array", *languages)
    simctl("spawn", udid, "defaults", "write", "-g", "AppleLocale", "-string", locale)
    subprocess.run(["xcrun", "simctl", "shutdown", udid], capture_output=True)
    simctl("boot", udid)
    simctl("bootstatus", udid, "-b")
    simctl("status_bar", udid, "override", "--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100",
           "--cellularMode", "active", "--cellularBars", "4", "--wifiBars", "3", "--dataNetwork", "wifi")


def injected_app(cordova_app, out, script):
    if SERVER not in (Path(cordova_app) / "www/client.config.js").read_text("utf-8"):
        sys.exit(f"the Cordova app does not point at {SERVER}")
    app = out / "Cordova.app"
    shutil.rmtree(app, ignore_errors=True)
    shutil.copytree(cordova_app, app, symlinks=True)
    (app / "www/tw-shell-capture.js").write_text(script, "utf-8")
    index = app / "www/index.html"
    html = index.read_text("utf-8")
    html = html.replace("<head>", f"<head>\n    <script>window.TW_SERVER = '{SERVER}';</script>\n"
                                  f"    <script src=\"tw-shell-capture.js\"></script>", 1)
    index.write_text(html, "utf-8")
    run("codesign", "--force", "--sign", "-", "--timestamp=none", "--preserve-metadata=entitlements", str(app))
    return app


class Server:
    """The fixture server: kma-seoul for the weather request, the capture script's endpoints."""

    def __init__(self, udid, out):
        self.udid, self.out = udid, out
        self.requests, self.records, self.envs = [], [], []
        self.done = threading.Event()
        self.error = None
        self.final = None
        self.origin = None
        self.origins = []
        self.splash = None
        self.probe = None
        self.lock = threading.Lock()
        self.pngtool = WORK / "pngtool"

    def screenshot(self, name):
        path = self.out / f"{name}.png"
        run("xcrun", "simctl", "io", self.udid, "screenshot", "--type=png", str(path))
        return path

    def find_origin(self, body):
        full = self.screenshot(f"{body['name']}-marker")
        dpr, marker = body["dpr"], body["marker"]
        x, y, w, h, width, height = map(int, run(str(self.pngtool), "marker", str(full)).split())
        self.screen = (width, height)
        if w != round(marker["size"] * dpr) or h != round(marker["size"] * dpr):
            raise RuntimeError(f"marker {w}x{h} px, expected {marker['size']} CSS px at {dpr}")
        self.origin = {"x": x - round(marker["left"] * dpr), "y": y - round(marker["top"] * dpr)}
        self.origins.append(self.origin)
        return {"origin": self.origin}

    def crop(self, full, name, x0, y0, x1, y1):
        SHOTS.mkdir(parents=True, exist_ok=True)
        out = SHOTS / f"shell-{self.lang}-{name}.png"
        run(str(self.pngtool), "crop", str(full), str(out), str(x0), str(y0), str(x1 - x0), str(y1 - y0))
        return {"file": out.name, "pixels": {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}}

    def shot(self, body):
        full = self.screenshot(body["name"])
        dpr, origin = body["dpr"], self.origin
        theme = body["name"].split("-")[0]
        crops = {}
        for part, r in body["rects"].items():
            if r == "above":  # the native status bar above the WebView
                crops[part] = self.crop(full, f"{body['name']}-statusbar", 0, 0, self.screen[0], origin["y"])
                continue
            # An element is painted at device pixels rounded from its layout position.
            x0, y0 = round(origin["x"] + r["x"] * dpr), round(origin["y"] + r["y"] * dpr)
            x1, y1 = round(origin["x"] + (r["x"] + r["w"]) * dpr), round(origin["y"] + (r["y"] + r["h"]) * dpr)
            crops[part] = self.crop(full, f"{theme}-menu" if part == "menu" else f"{body['name']}-{part}", x0, y0, x1, y1)
        return {"origin": origin, "crops": crops}

    def take_splash(self):
        full = self.screenshot("splash")
        SHOTS.mkdir(parents=True, exist_ok=True)
        out = SHOTS / f"shell-{self.lang}-splash.png"
        # Scaled to points (393 px wide): the launch image is a photo, and a point-size copy keeps the file small.
        run("sips", "--resampleWidth", "393", str(full), "--out", str(out))
        self.splash = {"file": out.name, "screenshot": full.name}
        return self.splash

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
                    if path == "/__tw/splash":
                        return self.reply(200, json.dumps(server.take_splash()).encode())
                    if path == "/__tw/origin":
                        return self.reply(200, json.dumps(server.find_origin(body)).encode())
                    if path == "/__tw/shot":
                        return self.reply(200, json.dumps(server.shot(body)).encode())
                    if path == "/__tw/env":
                        server.envs.append(body)
                        return self.reply(200)
                    if path == "/__tw/record":
                        server.records.append(body)
                        return self.reply(200)
                    if path == "/__tw/probe":
                        server.probe = {"page": body, "acceptLanguage": self.headers.get("Accept-Language")}
                        server.done.set()
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
                        entry["fixture"] = "kma-seoul"
                        return self.reply(200, json.dumps(fixture_response(), ensure_ascii=False).encode("utf-8"))
                    return self.reply(404)
                except Exception as e:  # reported to the page and to the run
                    server.error = f"{self.path}: {e!r}"
                    server.done.set()
                    return self.reply(500, json.dumps({"error": str(e)}).encode())

            do_GET = do_POST = do_PUT = do_DELETE = do_OPTIONS = handle_any

        return Handler

    def start(self):
        WORK.mkdir(parents=True, exist_ok=True)
        run("xcrun", "swiftc", "-O", "-o", str(self.pngtool), str(PNGTOOL_SOURCE))
        self.http = ThreadingHTTPServer(("127.0.0.1", PORT), self.handler())
        threading.Thread(target=self.http.serve_forever, daemon=True).start()

    def stop(self):
        self.http.shutdown()
        self.http.server_close()


def finish_app(udid):
    subprocess.run(["xcrun", "simctl", "terminate", udid, BUNDLE], capture_output=True)
    subprocess.run(["xcrun", "simctl", "uninstall", udid, BUNDLE], capture_output=True)


def capture(udid, cordova_app, lang):
    if lang not in LANGS:
        sys.exit(f"language {lang}: one of {sorted(LANGS)}")
    info, size = owned(udid)
    out = WORK / "runs" / lang
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    server = Server(udid, out)
    server.lang = lang
    server.start()
    try:
        boot(udid, [lang], LANGS[lang][0], erase=True)
        app = injected_app(cordova_app, out, (HERE / "capture.js").read_text("utf-8"))
        simctl("install", udid, str(app))
        simctl("launch", udid, BUNDLE)
        if not server.done.wait(900):
            raise SystemExit("no result after 900 s")
        if server.error:
            server.screenshot("error")
            raise SystemExit(f"capture failed: {server.error}")
    finally:
        (out / "requests.json").write_text(json.dumps(server.requests, ensure_ascii=False, indent=1) + "\n", "utf-8")
        finish_app(udid)
        subprocess.run(["xcrun", "simctl", "shutdown", udid], capture_output=True)
        server.stop()

    check_requests(server.requests)
    env = server.final
    if f"{env['screen']['width']}x{env['screen']['height']}" != size:
        raise SystemExit(f"unexpected display {env}")
    if env["language"] != lang:
        raise SystemExit(f"unexpected language {env['language']}")
    if [r["theme"] for r in server.records] != THEMES:
        raise SystemExit(f"recorded {[r['theme'] for r in server.records]}")
    for record in server.records:
        (SHOTS / f"shell-{lang}-{record['theme']}.json").write_text(json.dumps(record, ensure_ascii=False) + "\n", "utf-8")
    accept = sorted({r["acceptLanguage"] for r in server.requests if r["path"].startswith("/weather/")})
    (out / "capture.json").write_text(json.dumps({
        "language": lang, "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "env": env,
        "startEnv": server.envs, "device": info, "webViewOrigins": server.origins, "splash": server.splash,
        "weatherAcceptLanguage": accept}, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"{lang}: themes {THEMES}, WebView origins {sorted({(o['x'], o['y']) for o in server.origins})}, "
          f"Accept-Language {accept}")


PROBE = """(function () {
    document.addEventListener('deviceready', function () {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', window.TW_SERVER + '/__tw/probe', true);
        xhr.setRequestHeader('Content-Type', 'text/plain');
        xhr.send(JSON.stringify({language: navigator.language, languages: navigator.languages,
            userAgent: navigator.userAgent}));
    }, false);
})();
"""


def languages(udid, cordova_app):
    info, _ = owned(udid)
    out = WORK / "runs" / "languages"
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    results = []
    server = Server(udid, out)
    server.start()
    try:
        boot(udid, ["ko-KR"], "ko_KR", erase=True)
        app = injected_app(cordova_app, out, PROBE)
        simctl("install", udid, str(app))
        for langs, locale in LANGUAGE_CASES:
            server.done.clear()
            server.probe = None
            boot(udid, langs, locale, erase=False)
            preferred = run("xcrun", "simctl", "spawn", udid, "defaults", "read", "-g", "AppleLanguages")
            simctl("launch", udid, BUNDLE)
            if not server.done.wait(120):
                raise SystemExit(f"no probe for {langs}")
            subprocess.run(["xcrun", "simctl", "terminate", udid, BUNDLE], capture_output=True)
            results.append({"appleLanguages": langs, "appleLocale": locale,
                            "navigatorLanguage": server.probe["page"]["language"],
                            "navigatorLanguages": server.probe["page"]["languages"],
                            "acceptLanguage": server.probe["acceptLanguage"]})
            print(json.dumps(results[-1], ensure_ascii=False))
            time.sleep(1)
    finally:
        (out / "requests.json").write_text(json.dumps(server.requests, ensure_ascii=False, indent=1) + "\n", "utf-8")
        finish_app(udid)
        subprocess.run(["xcrun", "simctl", "shutdown", udid], capture_output=True)
        server.stop()
    check_requests(server.requests)
    LANGUAGES.parent.mkdir(parents=True, exist_ok=True)
    build = json.loads((Path(cordova_app).parent / "build-cordova.json").read_text("utf-8"))
    LANGUAGES.write_text(json.dumps({
        "source": "ios/tools/shell-reference/capture.py languages: the Cordova iOS build's WKWebView after setting the "
                  "simulator's AppleLanguages and AppleLocale; Accept-Language as the WebView sent it with an XHR",
        "build": {"commit": build["commit"], "client_version": build["client_version"], "xcode": build["xcode"]},
        "device": info, "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "cases": results}, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"wrote {LANGUAGES.relative_to(ROOT)}")


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
    if any(not r["path"].startswith("/weather/v000903/coord/") for r in weather):
        raise SystemExit(f"unexpected weather requests: {[r['path'] for r in weather][:5]}")


def provenance(cordova_app):
    app = Path(cordova_app)
    build = json.loads((app.parent / "build-cordova.json").read_text("utf-8"))
    commit = build["commit"]
    sources = []
    for rel in SHELL_SOURCES:
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
    runs = {}
    for lang in LANGS:
        c = json.loads((WORK / "runs" / lang / "capture.json").read_text("utf-8"))
        runs[lang] = {"device": c["device"], "capturedAt": c["capturedAt"], "env": c["env"],
                      "webViewOrigins": c["webViewOrigins"], "weatherAcceptLanguage": c["weatherAcceptLanguage"]}
    manifest = {"source": "ios/tools/shell-reference/capture.py run", "size": "393x852", "devicePixelRatio": 3,
                "fixture": "kma-seoul (Core/Tests/TWDomainTests/Corpus/inputs/kma-seoul.json) as the place 회현동",
                "themes": THEMES, "languages": {lang: {"env": runs[lang]["env"],
                                                        "webViewOrigin": runs[lang]["webViewOrigins"][0]}
                                                 for lang in LANGS}}
    (SHOTS / "shell-captures.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", "utf-8")
    files = sorted(list(SHOTS.glob("shell-*.png")) + list(SHOTS.glob("shell-*.json")) + [LANGUAGES])
    files = [p for p in files if p.name != "shell-tolerances.json"]
    PROVENANCE.write_text(json.dumps({
        "tool": "ios/tools/shell-reference/capture.py",
        "build": {"recipe": "ios/tools/chart-reference/build-cordova.sh <out> http://127.0.0.1:18454", **build,
                  "note": "client/ from Git at the commit; serverUrl = the local fixture server; dummy Firebase project; "
                          "Google test ad units"},
        "data": {"served": "the kma-seoul response for GET /weather/v000903/coord/...", "place": "회현동",
                 "settings": "defaults (startup page 0, refresh 0); themes light, dark, photo, old in turn"},
        "shellSources": sources,
        "runs": runs,
        "files": [{"path": p.relative_to(IOS).as_posix(), "sha256": sha256(p)} for p in files],
    }, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"wrote {PROVENANCE.relative_to(ROOT)} ({len(files)} files)")


if __name__ == "__main__":
    cmd = sys.argv[1:2]
    if cmd == ["run"] and len(sys.argv) == 5:
        capture(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == ["languages"] and len(sys.argv) == 4:
        languages(sys.argv[2], sys.argv[3])
    elif cmd == ["provenance"] and len(sys.argv) == 3:
        provenance(sys.argv[2])
    else:
        sys.exit(__doc__)
