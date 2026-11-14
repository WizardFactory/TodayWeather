#!/usr/bin/env python3
"""Cordova iOS air quality references (IN-09, #2958): the blocks of S05 of the Cordova build on an iOS Simulator, the
states of the Cordova manual's pages 10 to 12 with fixed data, and the other states android/tools/air-reference keeps.

    capture.py run <simulator-udid> <cordova-app>     capture (ko-KR, 393x852 pt)
    capture.py provenance <cordova-app>                write ios/provenance/air-captures.json and the manifest

<cordova-app> comes from ios/tools/chart-reference/build-cordova.sh with server URL http://127.0.0.1:18456 (the local
fixture server of this tool; a dummy Firebase project, Google's test ad units). `run` uses the fixture server, simulator
preparation, block cutter and request check of ios/tools/forecast-reference/capture.py:
  1. starts the fixture server on 127.0.0.1:18456: it answers the app's weather request with the selected corpus
     response (kma-seoul, vc-london, kma-jeju), 404 for any other API path, and takes the capture script's records and
     screenshot requests;
  2. erases the owned simulator, sets ko-KR, installs a copy of the Cordova app with capture.js injected, launches it;
  3. capture.js adds the places and captures each state of S05 (see capture.js), O08, and the navigation of a pollutant
     chosen on S03; the host takes simulator screenshots and crops and stacks the blocks;
  4. fails when a request went to a host other than this Mac or a weather request did not use /weather/v000903/coord/;
  5. uninstalls the app and shuts the simulator down.
Outputs (relative to ios/):
  TodayWeatherTests/AirReference/<state>-<block>.png, o08-airkorea.png   blocks (sRGB, device pixels at scale 3)
  TodayWeatherTests/AirReference/air-captures.json, air-<fixture>.input.json   manifest and the served data
  Core/Tests/TWDomainTests/AirReference/<state>.json, o08-airkorea.json, navigation.json   what each page showed
Logs go to ios/build/air-reference/runs/.
"""
import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
IOS = HERE.parents[1]
ROOT = IOS.parent

_spec = importlib.util.spec_from_file_location("forecast_capture", IOS / "tools/forecast-reference/capture.py")
fc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fc)

SHOTS = IOS / "TodayWeatherTests/AirReference"
RECORDS = IOS / "Core/Tests/TWDomainTests/AirReference"
PROVENANCE = IOS / "provenance/air-captures.json"
WORK = IOS / "build/air-reference"
PORT = 18456
SERVER = f"http://127.0.0.1:{PORT}"
FIXTURES = ["kma-seoul", "vc-london", "kma-jeju"]
STATES = ["kma-seoul", "kma-seoul-pm25", "kma-seoul-station-1", "kma-seoul-o3", "kma-seoul-dark", "vc-london", "kma-jeju-no-air"]
PAGES = ["kma-seoul", "o08-airkorea", "kma-seoul-pm25", "kma-seoul-station-1", "kma-seoul-o3", "kma-seoul-dark", "vc-london",
         "kma-jeju-no-air", "navigation"]
# S05's sources inside the built app, compared with client/ at the build commit.
PAGE_SOURCES = ["templates/tab-air.html", "templates/tabs.html", "js/controller.air.js", "js/controller.tabctrl.js",
                "js/service.weatherutil.js", "js/service.weatherinfo.js", "js/app.js", "css/ionic.app.css", "data/theme.js",
                "index.html", "lib/d3/d3.js"]

# The forecast tool's server writes its stacked blocks to its SHOTS and builds its block tool under its WORK.
fc.SHOTS = SHOTS
fc.WORK = WORK
fc.PORT = PORT
fc.SERVER = SERVER


def injected_app(cordova_app, out):
    if SERVER not in (Path(cordova_app) / "www/client.config.js").read_text("utf-8"):
        sys.exit(f"the Cordova app does not point at {SERVER}")
    app = out / "Cordova.app"
    shutil.rmtree(app, ignore_errors=True)
    shutil.copytree(cordova_app, app, symlinks=True)
    shutil.copy(HERE / "capture.js", app / "www/tw-air-capture.js")
    index = app / "www/index.html"
    html = index.read_text("utf-8")
    html = html.replace("<head>", f"<head>\n    <script>window.TW_SERVER = '{SERVER}';</script>\n"
                                  f"    <script src=\"tw-air-capture.js\"></script>", 1)
    index.write_text(html, "utf-8")
    fc.run("codesign", "--force", "--sign", "-", "--timestamp=none", "--preserve-metadata=entitlements", str(app))
    return app


def capture(udid, cordova_app):
    info, size = fc.owned(udid)
    out = WORK / "runs" / "ko-KR"
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    for d in (SHOTS, RECORDS):
        if d.exists():
            for p in d.iterdir():
                if p.suffix in (".png", ".json") and not p.name.endswith("tolerances.json") and p.name != "air-scale.json":
                    p.unlink()
    server = fc.Server(udid, out)
    server.start()
    try:
        fc.boot(udid)
        app = injected_app(cordova_app, out)
        fc.simctl("install", udid, str(app))
        fc.simctl("launch", udid, fc.BUNDLE)
        if not server.done.wait(1800):
            raise SystemExit("no result after 1800 s")
        if server.error:
            server.screenshot("error")
            raise SystemExit(f"capture failed: {server.error}")
    finally:
        (out / "requests.json").write_text(json.dumps(server.requests, ensure_ascii=False, indent=1) + "\n", "utf-8")
        subprocess.run(["xcrun", "simctl", "terminate", udid, fc.BUNDLE], capture_output=True)
        subprocess.run(["xcrun", "simctl", "uninstall", udid, fc.BUNDLE], capture_output=True)
        subprocess.run(["xcrun", "simctl", "shutdown", udid], capture_output=True)
        server.stop()

    fc.check_requests(server.requests)
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
        (SHOTS / f"air-{name}.input.json").write_text(json.dumps(fc.fixture_response(name), ensure_ascii=False) + "\n", "utf-8")
    accept = sorted({r["acceptLanguage"] or "" for r in server.requests if r["path"].startswith("/weather/")})
    (out / "capture.json").write_text(json.dumps({
        "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "env": env, "startEnv": server.envs,
        "device": info, "webViewOrigins": server.origins, "weatherAcceptLanguage": accept}, ensure_ascii=False, indent=1) + "\n",
        "utf-8")
    print(f"pages {PAGES}, WebView origins {sorted({(o['x'], o['y']) for o in server.origins})}, Accept-Language {accept}")


def manifest():
    """What the app-hosted tests read (they cannot read the package's test resources): each state's places, link code,
    taps and blocks with their image, class and CSS size, and O08's texts."""
    capture = json.loads((WORK / "runs/ko-KR/capture.json").read_text("utf-8"))
    states = {}
    for state in STATES:
        record = json.loads((RECORDS / f"{state}.json").read_text("utf-8"))
        states[state] = {"places": record["places"], "url": record["url"], "body": record["body"],
                         "scope": record["scope"], "gauge": record["gauge"], "header": record["header"],
                         "blocks": [{"index": b["index"], "cls": b["cls"], "file": b["image"]["file"], "rect": b["rect"],
                                     "hidden": b.get("hidden", 0), "pieces": len(b["pieces"]), "pixels": b["image"]["size"]}
                                    for b in record["blocks"]]}
    o08 = json.loads((RECORDS / "o08-airkorea.json").read_text("utf-8"))
    els = o08["popup"]["elements"]
    popup = {"file": o08["image"]["file"], "rect": o08["popup"]["rect"], "pixels": o08["image"]["size"],
             "body": [e["text"] for e in els if e["tag"] not in ("button", "h3") and "popup-title" not in e["cls"] and e["text"]],
             "buttons": [{"text": b["text"], "className": b["className"]} for b in o08["buttons"]]}
    nav = json.loads((RECORDS / "navigation.json").read_text("utf-8"))
    (SHOTS / "air-captures.json").write_text(json.dumps({
        "source": "ios/tools/air-reference/capture.py manifest, from Core/Tests/TWDomainTests/AirReference",
        "size": "393x852", "devicePixelRatio": capture["env"]["devicePixelRatio"], "language": "ko-KR",
        "units": capture["env"]["units"], "states": states, "o08": popup, "navigation": nav["steps"],
        "webViewOrigin": capture["webViewOrigins"][0]}, ensure_ascii=False, indent=1) + "\n", "utf-8")


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
        last = fc.run("git", "-C", str(ROOT), "log", "-1", "--format=%H", commit, "--", client).strip() if tracked else None
        sources.append({"file": client, "appSha256": fc.sha256(built), "tracked": tracked,
                        "clientSha256": hashlib.sha256(blob).hexdigest() if blob is not None else None,
                        "matchesClient": blob is not None and hashlib.sha256(blob).hexdigest() == fc.sha256(built),
                        "lastCommit": last})
    capture = json.loads((WORK / "runs/ko-KR/capture.json").read_text("utf-8"))
    files = sorted([p for p in SHOTS.iterdir() if p.suffix in (".png", ".json") and not p.name.endswith("tolerances.json")] +
                   [p for p in RECORDS.glob("*.json") if p.name != "air-scale.json"])
    PROVENANCE.write_text(json.dumps({
        "tool": "ios/tools/air-reference/capture.py",
        "build": {"recipe": "ios/tools/chart-reference/build-cordova.sh <out> http://127.0.0.1:18456", **build,
                  "note": "client/ from Git at the commit; serverUrl = the local fixture server; dummy Firebase project; "
                          "Google test ad units"},
        "data": {"served": "the corpus responses (Core/Tests/TWDomainTests/Corpus/inputs) for GET /weather/v000903/coord/...",
                 "places": "회현동 (kma-seoul) alone; then 런던 (vc-london) added and selected; then 연동 (kma-jeju without "
                           "airInfoList and currentWeather.arpltn) added and selected",
                 "settings": "defaults (Korean units, airkorea); light theme, dark for kma-seoul-dark"},
        "pageSources": sources,
        "run": {"device": capture["device"], "capturedAt": capture["capturedAt"], "env": capture["env"],
                "webViewOrigins": capture["webViewOrigins"], "weatherAcceptLanguage": capture["weatherAcceptLanguage"]},
        "files": [{"path": p.relative_to(IOS).as_posix(), "sha256": fc.sha256(p)} for p in files],
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
