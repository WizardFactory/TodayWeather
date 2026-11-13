#!/usr/bin/env python3
"""Cordova iOS chart references (IN-05, #2954): scenes and screenshots of the Cordova charts on iOS Simulators.

    capture.py run <simulator-udid> <cordova-app>     capture one screen size (the simulator's)
    capture.py provenance <cordova-app>                write ios/provenance/chart-captures.json and the manifest
    capture.py dummy-plist <path>                      (build-cordova.sh) a Firebase configuration of no project

<cordova-app> comes from build-cordova.sh (server URL http://127.0.0.1:18453, dummy Firebase project). `run`:
  1. starts the fixture server on 127.0.0.1:18453: it answers the app's weather request with the selected corpus
     fixture (ios/Core/Tests/TWDomainTests/Corpus, the same response the Swift tests convert), 404 for any other
     API path, and takes the capture script's records and screenshot requests;
  2. erases the simulator (only the owned simulators below), sets ko-KR, grants location, installs a copy of the
     Cordova app with capture.js injected and launches it;
  3. capture.js loads every fixture through the app's request path, shows it on the hourly and daily tabs and
     posts the scenes; for kma-seoul it scrolls each chart to the opening position and both ends, and the server
     takes a simulator screenshot and crops it to the chart wrapper (pngtool.swift), after finding the WebView's
     origin from a calibration marker that the page draws outside the chart in the same screenshot;
  4. fails when a request went to a host other than this Mac, when a weather request did not use
     /weather/v000903/coord/, or when the display differs from the expected size;
  5. uninstalls the app and shuts the simulator down.
Outputs (relative to ios/):
  Core/Tests/TWDomainTests/ChartReference/ios/<WxH>/<fixture>.json, capture.json   scenes (as on Android)
  TodayWeatherTests/ChartReference/<WxH>-<chart>-<position>.png                    wrapper screenshots (sRGB)
  TodayWeatherTests/ChartReference/captures.json, kma-seoul.input.json               (provenance) manifest and input
Logs go to ios/build/chart-reference/runs/<WxH>/.
"""
import hashlib
import json
import os
import plistlib
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
SCENES = IOS / "Core/Tests/TWDomainTests/ChartReference/ios"
SHOTS = IOS / "TodayWeatherTests/ChartReference"
PROVENANCE = IOS / "provenance/chart-captures.json"
WORK = IOS / "build/chart-reference"
PORT = 18453
SERVER = f"http://127.0.0.1:{PORT}"
BUNDLE = "net.wizardfactory.todayweather"

# The owned capture simulators (iOS 26.5 runtime) and the screen size each must report.
DEVICES = {
    "52E0C852-6471-487A-A2B5-99E41E0CA3D4": ("tw_cap_se3", "375x667"),
    "9CAAD5CA-A41F-4C19-808E-907D3E1F6F48": ("tw_cap_16", "393x852"),
    "C07BFC9B-AB5D-42CC-B7B5-ABF70B07E50B": ("tw_cap_16promax", "440x956"),
}
BASE_SIZE = "393x852"
# The Android fixture set (android/tools/chart-reference/capture.mjs): kma-seoul (screenshots) and vc-london at
# every size, the others at the base size.
FIXTURES = [
    {"name": "kma-seoul", "allSizes": True, "screenshots": True},
    {"name": "vc-london", "allSizes": True},
    {"name": "kma-jeju"},
    {"name": "vc-newyork"},
    {"name": "vc-sydney"},
    {"name": "vc-tokyo"},
    {"name": "kma-seoul-fahrenheit"},
    {"name": "kma-rain-everywhere"},
    {"name": "kma-current-index-first"},
    {"name": "kma-midnight-today-first-day"},
    # "On the hour": liveTime equal to time + '00' with time % 3 == 0.
    {"name": "kma-seoul-sharp", "from": "kma-seoul", "patch": "liveTime2400"},
]
# Chart sources inside the built app, compared with client/ at the build commit.
CHART_SOURCES = ["js/app.js", "js/controller.forecastctrl.js", "js/controller.tabctrl.js", "js/service.weatherutil.js",
                 "js/service.weatherinfo.js", "templates/tab-forecast.html", "templates/tab-dailyforecast.html",
                 "css/ionic.app.css", "lib/d3/d3.js", "data/theme.js"]
PRODUCTION_HOSTS = {"todayweather.wizardfactory.net", "tw-wzdfac.rhcloud.com", "todayweather-wizardfactory.rhcloud.com",
                    "todayweather.ai"}


def dummy_plist(path):
    # A Firebase project that does not exist; the shapes pass FirebaseInstallations' checks (API key "A" + 38
    # characters, app ID "1:<sender>:ios:<hex>"), as in ios/tools/upgrade/check_upgrade.py.
    key = "A" + "tw-in05-chart-capture-not-a-real-key-0"
    assert len(key) == 39
    with open(path, "wb") as f:
        plistlib.dump({
            "API_KEY": key, "GCM_SENDER_ID": "000000000000",
            "PLIST_VERSION": "1", "BUNDLE_ID": BUNDLE,
            "PROJECT_ID": "tw-in05-chart-capture-not-real", "STORAGE_BUCKET": "tw-in05-chart-capture-not-real.invalid",
            "IS_ADS_ENABLED": False, "IS_ANALYTICS_ENABLED": False, "IS_APPINVITE_ENABLED": False,
            "IS_GCM_ENABLED": True, "IS_SIGNIN_ENABLED": False,
            "GOOGLE_APP_ID": "1:000000000000:ios:0000000000000000000000",
        }, f)


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(*args, **kw):
    return subprocess.run(list(args), check=True, capture_output=True, text=True, **kw).stdout


def fixture_input(fixture):
    case = json.loads((CORPUS / "conversion" / f"{fixture.get('from', fixture['name'])}.json").read_text("utf-8"))
    data = case["input"] if "input" in case else json.loads((CORPUS / case["inputFile"]).read_text("utf-8"))
    if fixture.get("patch") == "liveTime2400":
        data["current"]["liveTime"] = "2400"
    return data


def device_info(udid):
    devices = json.loads(run("xcrun", "simctl", "list", "devices", "-j"))["devices"]
    for runtime, items in devices.items():
        for d in items:
            if d["udid"] == udid:
                return {"name": d["name"], "udid": udid, "runtime": runtime, "deviceType": d.get("deviceTypeIdentifier")}
    sys.exit(f"simulator {udid} not found")


class Capture:
    def __init__(self, udid, size, out):
        self.udid, self.size, self.out = udid, size, out
        self.selected = None
        self.requests = []
        self.done = threading.Event()
        self.error = None
        self.env = None
        self.origins = []
        self.records = []
        self.lock = threading.Lock()
        self.pngtool = WORK / "pngtool"

    def plan(self):
        return {"fixtures": [{"name": f["name"], "from": f.get("from", f["name"]), "patched": "patch" in f,
                              "screenshots": bool(f.get("screenshots"))}
                             for f in FIXTURES if f.get("allSizes") or self.size == BASE_SIZE]}

    def screenshot(self, name):
        path = self.out / f"{name}.png"
        run("xcrun", "simctl", "io", self.udid, "screenshot", "--type=png", str(path))
        return path

    def shot(self, body):
        full = self.screenshot(f"{body['fixture']}-{body['name']}-full")
        dpr = body["dpr"]
        marker = body["marker"]
        x, y, w, h, width, height = map(int, run(str(self.pngtool), "marker", str(full)).split())
        if w != round(marker["size"] * dpr) or h != round(marker["size"] * dpr):
            raise RuntimeError(f"marker {w}x{h} px, expected {marker['size']} CSS px at {dpr}")
        origin = {"x": x - round(marker["left"] * dpr), "y": y - round(marker["top"] * dpr)}
        self.origins.append(origin)
        r = body["rect"]
        # The wrapper is painted at device pixels rounded from its layout position.
        x0 = round(origin["x"] + r["x"] * dpr)
        y0 = round(origin["y"] + r["y"] * dpr)
        x1 = round(origin["x"] + (r["x"] + r["width"]) * dpr)
        y1 = round(origin["y"] + (r["y"] + r["height"]) * dpr)
        if not (y1 <= y or y0 >= y + h):
            raise RuntimeError("the marker overlaps the chart")
        SHOTS.mkdir(parents=True, exist_ok=True)
        out = SHOTS / f"{self.size}-{body['name']}.png"
        run(str(self.pngtool), "crop", str(full), str(out), str(x0), str(y0), str(x1 - x0), str(y1 - y0))
        return {"file": out.relative_to(IOS).as_posix(), "pixels": {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0},
                "origin": origin, "screenshot": {"width": width, "height": height}}

    def handler(self):
        capture = self

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
                with capture.lock:
                    capture.requests.append(entry)
                if self.command == "OPTIONS":
                    return self.reply(204, b"")
                try:
                    path = urlparse(self.path).path
                    if path == "/__tw/plan":
                        return self.reply(200, json.dumps(capture.plan()).encode())
                    if path == "/__tw/select":
                        name = body["fixture"]
                        capture.selected = next(f for f in FIXTURES if f["name"] == name)
                        return self.reply(200)
                    if path == "/__tw/shot":
                        return self.reply(200, json.dumps(capture.shot(body)).encode())
                    if path == "/__tw/record":
                        capture.records.append(body)
                        return self.reply(200)
                    if path == "/__tw/done":
                        capture.env = body
                        capture.done.set()
                        return self.reply(200)
                    if path == "/__tw/error":
                        capture.error = body.get("error")
                        capture.done.set()
                        return self.reply(200)
                    if path.startswith("/__tw/"):
                        return self.reply(200)
                    if path.startswith("/weather/v000903/coord/") and capture.selected and self.command == "GET":
                        entry["fixture"] = capture.selected["name"]
                        return self.reply(200, json.dumps(fixture_input(capture.selected), ensure_ascii=False).encode("utf-8"))
                    return self.reply(404)
                except Exception as e:  # reported to the page and to the run
                    capture.error = f"{self.path}: {e!r}"
                    capture.done.set()
                    return self.reply(500, json.dumps({"error": str(e)}).encode())

            do_GET = do_POST = do_PUT = do_DELETE = do_OPTIONS = handle_any

        return Handler


def simctl(*args):
    return run("xcrun", "simctl", *args)


def capture_size(udid, cordova_app):
    if udid not in DEVICES:
        sys.exit(f"refusing simulator {udid}: only the owned capture simulators {sorted(DEVICES)} are used")
    name, size = DEVICES[udid]
    info = device_info(udid)
    if info["name"] != name:
        sys.exit(f"simulator {udid} is named {info['name']}, expected {name}")
    if SERVER not in (Path(cordova_app) / "www/client.config.js").read_text("utf-8"):
        sys.exit(f"the Cordova app does not point at {SERVER}")
    out = WORK / "runs" / size
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    WORK.mkdir(parents=True, exist_ok=True)
    run("xcrun", "swiftc", "-O", "-o", str(WORK / "pngtool"), str(HERE / "pngtool.swift"))

    capture = Capture(udid, size, out)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), capture.handler())
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        subprocess.run(["xcrun", "simctl", "shutdown", udid], capture_output=True)
        simctl("erase", udid)
        simctl("boot", udid)
        simctl("bootstatus", udid, "-b")
        # ko-KR, as the Android references; the WebView reports navigator.language from it.
        simctl("spawn", udid, "defaults", "write", "-g", "AppleLanguages", "-array", "ko-KR")
        simctl("spawn", udid, "defaults", "write", "-g", "AppleLocale", "-string", "ko_KR")
        subprocess.run(["xcrun", "simctl", "shutdown", udid], capture_output=True)
        simctl("boot", udid)
        simctl("bootstatus", udid, "-b")
        simctl("status_bar", udid, "override", "--time", "9:41")
        app = out / "Cordova.app"
        shutil.copytree(cordova_app, app, symlinks=True)
        shutil.copy(HERE / "capture.js", app / "www/tw-chart-capture.js")
        index = app / "www/index.html"
        html = index.read_text("utf-8")
        html = html.replace("<head>", f"<head>\n    <script>window.TW_SERVER = '{SERVER}';</script>\n"
                                      f"    <script src=\"tw-chart-capture.js\"></script>", 1)
        index.write_text(html, "utf-8")
        run("codesign", "--force", "--sign", "-", "--timestamp=none", "--preserve-metadata=entitlements", str(app))
        simctl("install", udid, str(app))
        simctl("privacy", udid, "grant", "location", BUNDLE)
        simctl("location", udid, "set", "37.56,126.98")
        simctl("launch", udid, BUNDLE)
        if not capture.done.wait(900):
            raise SystemExit("no result after 900 s")
        if capture.error:
            capture.screenshot("error")
            raise SystemExit(f"capture failed: {capture.error}")
    finally:
        (out / "requests.json").write_text(json.dumps(capture.requests, ensure_ascii=False, indent=1) + "\n", "utf-8")
        subprocess.run(["xcrun", "simctl", "terminate", udid, BUNDLE], capture_output=True)
        subprocess.run(["xcrun", "simctl", "uninstall", udid, BUNDLE], capture_output=True)
        subprocess.run(["xcrun", "simctl", "shutdown", udid], capture_output=True)
        server.shutdown()

    check_requests(capture.requests)
    env = capture.env
    if f"{env['screen']['width']}x{env['screen']['height']}" != size:
        raise SystemExit(f"unexpected display {env}")
    if env["theme"] != "light" or env["language"] != "ko-KR":
        raise SystemExit(f"unexpected theme or language {env}")
    dest = SCENES / size
    shutil.rmtree(dest, ignore_errors=True)
    dest.mkdir(parents=True)
    names = []
    for record in capture.records:
        (dest / f"{record['fixture']}.json").write_text(json.dumps(record, ensure_ascii=False) + "\n", "utf-8")
        names.append(record["fixture"])
    expected = [f["name"] for f in capture.plan()["fixtures"]]
    if names != expected:
        raise SystemExit(f"recorded {names}, expected {expected}")
    (dest / "capture.json").write_text(json.dumps({
        "size": size, "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "env": env,
        "device": info, "webViewOrigins": capture.origins, "fixtures": names}, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"{size}: {len(names)} fixtures, WebView origins {capture.origins}")


def check_requests(requests):
    """No request for a TodayWeather host or an API path left this Mac; the app's weather requests used the v000903
    coordinate path. capture.js sent every request for another host to the local server instead (blocked: true; for
    example the Maps JavaScript API's gen_204 probe), which requests.json lists."""
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
    """The screenshot references for the app-hosted tests (TodayWeatherTests cannot read the package's test
    resources): the scroll position and pixel size of every capture, and a copy of the fixture's response."""
    sizes = {}
    for _, size in sorted(DEVICES.values(), key=lambda d: d[1]):
        capture = json.loads((SCENES / size / "capture.json").read_text("utf-8"))
        record = json.loads((SCENES / size / "kma-seoul.json").read_text("utf-8"))
        charts = {}
        for chart in ("hourly", "daily"):
            charts[chart] = {
                "wrapperHeight": record[chart]["wrapper"]["h"],
                "positions": {c["position"]: {"scrollLeft": c["scrollLeft"], "file": Path(c["file"]).name,
                                              "pixels": c["pixels"]} for c in record[chart]["captures"]},
            }
        sizes[size] = {"devicePixelRatio": capture["env"]["devicePixelRatio"], "fixture": "kma-seoul", **charts}
    fixture = next(f for f in FIXTURES if f.get("screenshots"))
    (SHOTS / "kma-seoul.input.json").write_text(json.dumps(fixture_input(fixture), ensure_ascii=False) + "\n", "utf-8")
    (SHOTS / "captures.json").write_text(json.dumps({
        "source": "ios/tools/chart-reference/capture.py manifest, from Core/Tests/TWDomainTests/ChartReference/ios",
        "input": "kma-seoul.input.json: the response served for kma-seoul (Core/Tests/TWDomainTests/Corpus/inputs/kma-seoul.json)",
        "language": "ko", "units": {"precip": "mm", "wind": "m/s"}, "theme": "light",
        "sizes": sizes}, ensure_ascii=False, indent=1) + "\n", "utf-8")


def provenance(cordova_app):
    manifest()
    app = Path(cordova_app)
    build = json.loads((app.parent / "build-cordova.json").read_text("utf-8"))
    commit = build["commit"]
    sources = []
    for rel in CHART_SOURCES:
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
    sizes = {}
    for udid, (name, size) in sorted(DEVICES.items(), key=lambda d: d[1][1]):
        capture = json.loads((SCENES / size / "capture.json").read_text("utf-8"))
        sizes[size] = {"device": capture["device"], "capturedAt": capture["capturedAt"],
                       "userAgent": capture["env"]["userAgent"], "devicePixelRatio": capture["env"]["devicePixelRatio"],
                       "viewport": capture["env"]["viewport"], "webViewOrigins": capture["webViewOrigins"],
                       "fixtures": capture["fixtures"]}
    files = sorted([p for p in SCENES.rglob("*.json")] + [p for p in SHOTS.glob("*.png")] +
                   [SHOTS / "captures.json", SHOTS / "kma-seoul.input.json"])
    PROVENANCE.write_text(json.dumps({
        "tool": "ios/tools/chart-reference/capture.py",
        "build": {"recipe": "ios/tools/chart-reference/build-cordova.sh", **build,
                  "note": "client/ from Git at the commit; serverUrl = the local fixture server; dummy Firebase project; "
                          "Google test ad units"},
        "data": {"fixtures": "ios/Core/Tests/TWDomainTests/Corpus/conversion (copy of the AN-02 golden corpus)",
                 "served": "the fixture's response for GET /weather/v000903/coord/...; kma-seoul-sharp is kma-seoul with "
                           "current.liveTime \"2400\"",
                 "language": "ko-KR", "theme": "light"},
        "chartSources": sources,
        "sizes": sizes,
        "files": [{"path": p.relative_to(IOS).as_posix(), "sha256": sha256(p)} for p in files],
    }, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"wrote {PROVENANCE.relative_to(ROOT)} ({len(files)} files)")


if __name__ == "__main__":
    cmd = sys.argv[1:2]
    if cmd == ["dummy-plist"]:
        dummy_plist(sys.argv[2])
    elif cmd == ["run"]:
        capture_size(sys.argv[2], sys.argv[3])
    elif cmd == ["provenance"]:
        provenance(sys.argv[2])
    else:
        sys.exit(__doc__)
