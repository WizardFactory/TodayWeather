#!/usr/bin/env python3
"""Cordova iOS nationwide and warning references (IN-13, #2962): S10 (nationwide weather) in its three modes, S11
(nationwide air) in its six tabs and S12 (the warnings) of the Cordova build on an iOS Simulator: the states of the
Cordova manual's pages 32 to 35 with fixed data, and the loading, failed, empty and dark-theme states.

    capture.py run <simulator-udid> <cordova-app>     capture (ko-KR, 393x852 pt)
    capture.py provenance <cordova-app>              write the manifest and the provenance

<cordova-app> comes from ios/tools/chart-reference/build-cordova.sh with server URL http://127.0.0.1:18463 (the local
fixture server of this tool; a dummy Firebase project, Google's test ad units). `run`:
  1. starts the fixture server on 127.0.0.1:18463: it answers the app's weather request with the corpus response
     kma-seoul, /v000903/nation/KR with the corpus input nation.json (late: after 5 s; empty: no cities; fail: 500) and
     /v000903/kma/special with the corpus input special.json (empty: []; fail: 500) as the capture script asks, 404 for
     any other API path, and takes the capture script's records, steps and screenshot requests;
  2. erases the owned simulator, sets ko-KR, installs a copy of the Cordova app with capture.js injected and launches it;
  3. capture.js adds 회현동, records the menu's rows, opens S10 while its answer is late (the loading state), then its
     three modes, S11's six tabs, S12 from the top to the end, the failed and empty answers, and S10 and S12 in the dark
     theme. The host takes simulator screenshots and crops each page and the status bar after finding the WebView's
     origin from a calibration marker (ios/tools/forecast-reference/blocktool.swift);
  4. fails when a request went to a host other than this Mac, or the nation or warning requests did not use their
     v000903 paths;
  5. uninstalls the app and shuts the simulator down.
Outputs (relative to ios/): TodayWeatherTests/NationReference/nation-<state>[-statusbar].png and nation-<state>.json
(rects, texts, computed styles, line boxes). `provenance` adds TodayWeatherTests/NationReference/nation-captures.json
(the manifest the app-hosted tests read, with the requests each step sent) and provenance/nation-captures.json. Logs go
to ios/build/nation-reference/runs/.
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
SHOTS = IOS / "TodayWeatherTests/NationReference"
PROVENANCE = IOS / "provenance/nation-captures.json"
WORK = IOS / "build/nation-reference"
BLOCKTOOL = IOS / "tools/forecast-reference/blocktool.swift"
PORT = 18463
SERVER = f"http://127.0.0.1:{PORT}"
BUNDLE = "net.wizardfactory.todayweather"
LANG = "ko-KR"
# The states in capture order; warnings-<i> follow `warnings` (S12 scrolled a screen at a time) and are checked apart.
STATES = (["nation-loading", "nation-weather", "nation-rain", "nation-wind"]
          + [f"nation-air-{t}" for t in ("pm2.5", "pm10", "o3", "no2", "so2", "co")]
          + ["warnings"])
LATER = ["nation-weather-failed", "nation-air-failed", "nation-weather-empty", "warnings-empty", "warnings-failed",
         "nation-weather-dark", "warnings-dark"]
# The owned capture simulator (iOS 26.5, iPhone 16, 393x852 pt, scale 3).
DEVICES = {"801F667C-21F5-4A84-ABE4-62AED154027E": ("twios_in13_cap", "393x852")}
# Sources of the captured pages inside the built app, compared with client/ at the build commit.
PAGE_SOURCES = ["templates/nation.html", "templates/nation-air.html", "templates/kma-special.html",
                "js/controller.nation.js", "js/controller.nation.air.js", "js/controller.kma.special.js",
                "js/controller.settingctrl.js", "js/service.weatherutil.js", "js/service.util.js", "js/app.js",
                "css/ionic.app.css", "img/kr.png"]
# index.html and locales/*.json are not listed: the build's tracking-settings hook (#2990) adds its menu row and strings
# to the built copies, so they never equal client/ (the nationwide pages use neither change).
PRODUCTION_HOSTS = {"todayweather.wizardfactory.net", "tw-wzdfac.rhcloud.com", "todayweather-wizardfactory.rhcloud.com",
                    "todayweather.ai"}
EMPTY_NATION = {"nation": "KR", "weather": [], "air": []}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(*args, **kw):
    return subprocess.run(list(args), check=True, capture_output=True, text=True, **kw).stdout


def simctl(*args):
    return run("xcrun", "simctl", *args)


def fixture(name):
    return (CORPUS / f"inputs/{name}.json").read_bytes()


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
        self.menu = None
        self.origin = None
        self.origins = []
        self.screen = None
        self.step = None
        self.answers = {"nation": "ok", "special": "ok"}
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
        dest = SHOTS / f"nation-{name}.png"
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
            x0, y0 = round(origin["x"] + r["x"] * dpr), round(origin["y"] + r["y"] * dpr)
            x1 = min(self.screen[0], round(origin["x"] + (r["x"] + r["w"]) * dpr))
            y1 = min(self.screen[1], round(origin["y"] + (r["y"] + r["h"]) * dpr))
            name = body["name"] if part == "page" else f"{body['name']}-{part}"
            crops[part] = self.crop(full, name, x0, y0, x1, y1)
        return {"origin": origin, "crops": crops, "screenshot": full.name}

    def answer(self, path, query):
        """The answer of a nation or warning request as the step asked: (status, body, delay in s)."""
        if path == "/v000903/nation/KR":
            how = self.answers["nation"]
            if how == "fail":
                return 500, b"Internal Server Error", 0
            if how == "empty":
                return 200, json.dumps(EMPTY_NATION).encode(), 0
            return 200, fixture("nation"), 5 if how == "late" else 0
        how = self.answers["special"]
        if how == "fail":
            return 500, b"Internal Server Error", 0
        if how == "empty":
            return 200, b"[]", 0
        return 200, fixture("special"), 0

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
                entry = {"time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "at": time.monotonic(),
                         "step": server.step, "method": self.command, "path": self.path,
                         "origin": self.headers.get("Origin"), "acceptLanguage": self.headers.get("Accept-Language")}
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
                    if path == "/__tw/answer":
                        server.answers[body["kind"]] = body["how"]
                        return self.reply(200)
                    if path == "/__tw/env":
                        server.envs.append(body)
                        return self.reply(200)
                    if path == "/__tw/menu":
                        server.menu = body
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
                        entry["fixture"] = "kma-seoul"
                        return self.reply(200, fixture("kma-seoul"))
                    if path in ("/v000903/nation/KR", "/v000903/kma/special") and self.command == "GET":
                        status, payload, delay = server.answer(path, url.query)
                        entry["answer"] = {"status": status, "delay": delay, "how": server.answers[
                            "nation" if "nation" in path else "special"]}
                        if delay:
                            time.sleep(delay)
                        return self.reply(status, payload)
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


def boot(udid):
    subprocess.run(["xcrun", "simctl", "shutdown", udid], capture_output=True)
    simctl("erase", udid)
    simctl("boot", udid)
    simctl("bootstatus", udid, "-b")
    simctl("spawn", udid, "defaults", "write", "-g", "AppleLanguages", "-array", LANG)
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
    shutil.copy(HERE / "capture.js", app / "www/tw-nation-capture.js")
    index = app / "www/index.html"
    html = index.read_text("utf-8")
    html = html.replace("<head>", f"<head>\n    <script>window.TW_SERVER = '{SERVER}';</script>\n"
                                  f"    <script src=\"tw-nation-capture.js\"></script>", 1)
    index.write_text(html, "utf-8")
    run("codesign", "--force", "--sign", "-", "--timestamp=none", "--preserve-metadata=entitlements", str(app))
    return app


def capture(udid, cordova_app):
    info, size = owned(udid)
    out = WORK / "runs" / LANG
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    if SHOTS.exists():
        for p in SHOTS.glob("nation-*"):
            if not p.name.endswith("tolerances.json"):
                p.unlink()
    server = Server(udid, out)
    server.start()
    try:
        boot(udid)
        app = injected_app(cordova_app, out)
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
    if env["language"] != LANG:
        raise SystemExit(f"unexpected language {env['language']}")
    names = [r["name"] for r in server.records]
    scrolled = [n for n in names if n.startswith("warnings-") and n[len("warnings-"):].isdigit()]
    expected = STATES + scrolled + LATER
    if names != expected:
        raise SystemExit(f"recorded {names}")
    for record in server.records:
        (SHOTS / f"nation-{record['name']}.json").write_text(json.dumps(record, ensure_ascii=False) + "\n", "utf-8")
    start = server.requests[0]["at"] if server.requests else 0
    api = [{"step": r["step"], "path": r["path"], "acceptLanguage": r["acceptLanguage"], "answer": r.get("answer"),
            "fixture": r.get("fixture"), "at": round(r["at"] - start, 1)}
           for r in server.requests if not r["path"].startswith("/__tw/")]
    (out / "capture.json").write_text(json.dumps({
        "language": LANG, "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "env": env,
        "startEnv": server.envs, "device": info, "webViewOrigins": server.origins, "menu": server.menu,
        "requests": api, "scrolled": scrolled}, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"{LANG}: {len(names)} states, WebView origins {sorted({(o['x'], o['y']) for o in server.origins})}, "
          f"{len(api)} API requests")


def check_requests(requests):
    """No request for a TodayWeather host or an API path left this Mac; the nation and warning requests used their
    v000903 paths. capture.js sent every request for another host to the local server instead (blocked: true)."""
    for r in requests:
        o = r.get("observed")
        if o:
            url = urlparse(o["url"])
            local = (url.hostname or "") in {"127.0.0.1", "localhost"} or o["url"].startswith(("app://localhost", "data:", "blob:"))
            api = any(url.path.startswith(p) for p in ("/weather", "/v000", "/geocode", "/push", "/gather"))
            if (url.hostname or "") in PRODUCTION_HOSTS or (api and not local) or (not local and not o.get("blocked")):
                raise SystemExit(f"the page requested another host: {o}")
    nation = [r for r in requests if "/nation/" in r["path"]]
    special = [r for r in requests if "/special" in r["path"]]
    if not nation or any(not r["path"].startswith("/v000903/nation/KR?") for r in nation):
        raise SystemExit(f"unexpected nation requests: {[r['path'] for r in nation][:5]}")
    if not special or any(r["path"] != "/v000903/kma/special" for r in special):
        raise SystemExit(f"unexpected warning requests: {[r['path'] for r in special][:5]}")


def manifest():
    """What the app-hosted tests read: each state's files, and the requests each step sent."""
    capture = json.loads((WORK / f"runs/{LANG}/capture.json").read_text("utf-8"))
    names = STATES + capture["scrolled"] + LATER
    states = {}
    for name in names:
        record = json.loads((SHOTS / f"nation-{name}.json").read_text("utf-8"))
        states[name] = {"crops": {k: v["file"] for k, v in record["shot"]["crops"].items()},
                        "theme": record["theme"], "scrollTop": record["content"]["scrollTop"]}
    (SHOTS / "nation-captures.json").write_text(json.dumps({
        "source": "ios/tools/nation-reference/capture.py provenance, from the records nation-<state>.json",
        "size": "393x852", "devicePixelRatio": capture["env"]["devicePixelRatio"], "language": LANG,
        "env": {k: capture["env"][k] for k in ("language", "languages", "region", "package", "units")},
        "menu": capture["menu"], "webViewOrigin": capture["webViewOrigins"][0], "states": states,
        "requests": capture["requests"]}, ensure_ascii=False, indent=1) + "\n", "utf-8")
    return capture


def provenance(cordova_app):
    capture = manifest()
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
    files = sorted(p for p in SHOTS.iterdir() if p.suffix in (".png", ".json") and not p.name.endswith("tolerances.json"))
    PROVENANCE.write_text(json.dumps({
        "tool": "ios/tools/nation-reference/capture.py",
        "build": {"recipe": "ios/tools/chart-reference/build-cordova.sh <out> http://127.0.0.1:18463", **build,
                  "note": "client/ from Git at the commit; serverUrl = the local fixture server; dummy Firebase project; "
                          "Google test ad units"},
        "data": {"served": "the corpus responses (Core/Tests/TWDomainTests/Corpus/inputs): kma-seoul for GET "
                           "/weather/v000903/coord/..., nation.json for GET /v000903/nation/KR?... (late: after 5 s; "
                           "empty: {\"nation\":\"KR\",\"weather\":[],\"air\":[]}; fail: 500), special.json for GET "
                           "/v000903/kma/special (empty: []; fail: 500)",
                 "place": "회현동 (kma-seoul) alone", "settings": "Korean default units, light theme, then dark"},
        "pageSources": sources,
        "run": {"device": capture["device"], "capturedAt": capture["capturedAt"], "env": capture["env"],
                "webViewOrigins": capture["webViewOrigins"]},
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
