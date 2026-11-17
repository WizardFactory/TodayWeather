#!/usr/bin/env python3
"""Cordova iOS references at three display sizes in Korean and English (IN-18 part 2, #2967 AC2).

    capture.py run <set> <simulator-udid> <cordova-app> <ko-KR|en-US>   capture one set at the simulator's size
    capture.py collect <set> <size> <lang>                               copy a finished run's matrix states again
    capture.py check                                                     every matrix file present, hashes recorded
    capture.py provenance <cordova-app>                                  write ios/provenance/matrix-captures.json

The matrix follows AK's AN-18 decision of 2026-11-11: each screen S01-S12 and its main dialogs in the state the user
manual shows, at 375x667, 393x852 and 440x956 pt, in Korean and English; the states the other reference sets compare
stay at 393x852 (ko-KR, and en-US where they have it). `run` drives the set's own capture tool unchanged in what it
records (ios/tools/<set>-reference/capture.py and capture.js) with:
  - the owned simulators below (the tool's own list is replaced, so no other simulator is used);
  - a fixture port of this tool (18471-18473, one per simulator, so runs on different simulators may overlap): a copy
    of the Cordova app whose client.config.js server URL is rewritten to it (the only change; the copy is re-signed by
    the set's tool after its capture script is injected);
  - the set's outputs redirected to ios/build/matrix-reference/<set>/<size>/<lang>/, from which the states of the
    matrix are copied into ios/TodayWeatherTests/MatrixReference/ as matrix-<size>-<lang>-<file> (the app-hosted tests
    read their bundle flat, so every name is unique);
  - English: en-US (AppleLanguages en-US, AppleLocale en_US). The Cordova build takes its region from
    navigator.language, and the iOS WebView reports en-US for an en-KR system too (shell-reference's languages.json),
    so an English user of the Cordova iOS app has region US and its default units (F, mph, inHg, mi, in) and air
    standard (airnow); the forecast and air sets, captured in Korean only so far, are captured that way. S10-S12 are
    Korea-only (no menu rows outside KR), so the nation set runs in Korean only.
The set's tool keeps its own checks: no request for another host, weather only under /weather/v000903/coord/, the
display size and the language. The Cordova app comes from ios/tools/chart-reference/build-cordova.sh with server URL
http://127.0.0.1:18460.
"""
import fnmatch
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
OUT = IOS / "TodayWeatherTests/MatrixReference"
WORK = IOS / "build/matrix-reference"
PROVENANCE = IOS / "provenance/matrix-captures.json"
BUILT_SERVER = "http://127.0.0.1:18460"
# The owned simulators (iOS 26.5): name, size, and this tool's fixture port for runs on it.
# The owned simulators (iOS 26.5) by name: size, and this tool's fixture port for runs on it. twios_in18_se (iPhone SE
# 3rd generation) and twios_in18_promax (iPhone 16 Pro Max) are created for a capture batch and deleted by UDID after
# it, so their UDIDs are looked up by name.
NAMES = {"twios_in18_se": ("375x667", 18471), "twios_cap_16": ("393x852", 18472), "twios_in18_promax": ("440x956", 18473)}


def owned_devices():
    """{udid: (name, size, port)} of the owned simulators that exist now."""
    listing = json.loads(subprocess.run(["xcrun", "simctl", "list", "devices", "-j"], check=True, capture_output=True,
                                        text=True).stdout)["devices"]
    return {d["udid"]: (d["name"],) + NAMES[d["name"]] for items in listing.values() for d in items if d["name"] in NAMES}


SIZES = ["375x667", "393x852", "440x956"]
LANGS = ["ko-KR", "en-US"]
# Per set: its tool, whether its `capture` takes the language, the English system locale of its runs, the sizes it
# runs at per language, and the files of the matrix states (globs over its outputs; {lang} is the language).
SETS = {
    "start": {"tool": "start-reference", "langArg": True, "keep": ["start-{lang}-access*", "start-{lang}-start*"],
              "screens": "S01, O01"},
    "places": {"tool": "places-reference", "langArg": True, "keep": ["places-{lang}-list*"],
               "screens": "S02"},
    "forecast": {"tool": "forecast-reference", "langArg": False, "keep": ["kma-seoul-hourly-[0-9].png",
                 "kma-seoul-daily-[0-9].png", "forecast-captures.json", "forecast-*.input.json"], "screens": "S03, S04",
                 "english393": True},
    "air": {"tool": "air-reference", "langArg": False, "keep": ["kma-seoul-[0-9].png", "air-captures.json",
            "air-*.input.json"], "screens": "S05", "english393": True},
    "shell": {"tool": "shell-reference", "langArg": True, "keep": ["shell-{lang}-light-menu*", "shell-{lang}-light.json",
              "shell-{lang}-light-forecast-tabs.png", "shell-{lang}-light-forecast-header.png"], "screens": "S06, X1"},
    "settings": {"tool": "settings-reference", "langArg": True, "keep": ["settings-{lang}-units.*", "settings-{lang}-units-statusbar.png",
                 "settings-{lang}-radio-temperatureUnit.*", "settings-{lang}-radio-temperatureUnit-statusbar.png",
                 "settings-{lang}-about*"], "screens": "S07, S08, O10", "english393": True},
    "push": {"tool": "push-reference", "langArg": True, "keep": ["alarms-{lang}-settings*", "alarms-{lang}-picker.*",
             "alarms-{lang}-picker-statusbar.png", "alarms-{lang}-confirm*"],
             "screens": "S09, O12, O14"},
    "nation": {"tool": "nation-reference", "langArg": False, "keep": ["nation-nation-weather.*",
               "nation-nation-weather-statusbar.png", "nation-nation-air-pm2.5*", "nation-warnings.*",
               "nation-warnings-statusbar.png"], "screens": "S10, S11, S12", "korean": True},
}
KR_ENGLISH = {"forecast", "air", "nation"}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load(name):
    tool = SETS[name]["tool"]
    spec = importlib.util.spec_from_file_location(f"matrix_{name}", IOS / f"tools/{tool}/capture.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def matrix_runs():
    """Every (set, size, language) the matrix needs: both languages at 375 and 440; at 393 the English runs of the
    sets whose 393x852 references are Korean only (and the settings states the English set lacks)."""
    runs = []
    for name, cfg in SETS.items():
        for size in SIZES:
            for lang in LANGS:
                if size == "393x852" and not (lang == "en-US" and cfg.get("english393")):
                    continue
                # S10-S12 are Korea-only: the Cordova iOS build takes its region from navigator.language (en-US on an
                # English iPhone), hides their menu rows outside KR and shows "USA" with no data if one is opened.
                if cfg.get("korean") and lang != "ko-KR":
                    continue
                runs.append((name, size, lang))
    return runs


def cordova_copy(cordova_app, port):
    """A copy of the Cordova app pointing at this tool's port (only client.config.js's server URL differs)."""
    src = Path(cordova_app)
    config = (src / "www/client.config.js").read_text("utf-8")
    if BUILT_SERVER not in config:
        sys.exit(f"the Cordova app does not point at {BUILT_SERVER}")
    dest = WORK / f"cordova-{port}"
    shutil.rmtree(dest, ignore_errors=True)
    dest.mkdir(parents=True)
    shutil.copytree(src, dest / "TodayWeather.app", symlinks=True)
    shutil.copy(src.parent / "build-cordova.json", dest / "build-cordova.json")
    (dest / "TodayWeather.app/www/client.config.js").write_text(
        config.replace(BUILT_SERVER, f"http://127.0.0.1:{port}"), "utf-8")
    return dest / "TodayWeather.app"


def configure(module, name, udid, size, lang, port, stage):
    """Points the set's tool at this run: the owned simulators, the port, the staging outputs and the language."""
    devices = {u: (n, s) for u, (n, s, _) in owned_devices().items()}
    server = f"http://127.0.0.1:{port}"
    targets = [module] + ([module.fc] if hasattr(module, "fc") else [])
    for m in targets:
        m.DEVICES = devices
        m.PORT, m.SERVER = port, server
        m.SHOTS = stage / "shots"
        m.WORK = stage / "work"
        if hasattr(m, "RECORDS"):
            m.RECORDS = stage / "records"
    if name in KR_ENGLISH:
        language, locale = ("ko-KR", "ko_KR") if lang == "ko-KR" else ("en-US", "en_US")
        for m in targets:
            if hasattr(m, "LANGUAGE"):
                m.LANGUAGE, m.LOCALE = language, locale
        if name == "nation":
            module.LANG, module.LOCALE = language, locale
    if name == "settings" and lang == "en-US":
        # The English set records units and About; the matrix adds S08 (capture.js does with window.TW_MATRIX).
        module.STATES = dict(module.STATES, **{"en-US": ["units", "radio-temperatureUnit", "about"]})
        injected = module.injected_app

        def matrix_app(cordova_app, out, language):
            app = injected(cordova_app, out, language)
            index = app / "www/index.html"
            index.write_text(index.read_text("utf-8").replace("<head>", "<head>\n    <script>window.TW_MATRIX = true;</script>", 1),
                             "utf-8")
            module.run("codesign", "--force", "--sign", "-", "--timestamp=none", "--preserve-metadata=entitlements", str(app))
            return app

        module.injected_app = matrix_app


def prepare(udid):
    """Erases the simulator once and lets iOS post its first-boot notifications (an "Apple Intelligence ready" banner
    covered the first capture after an erase), so the runs' own erase is skipped; each run still uninstalls the app and
    sets the language and region with a reboot."""
    marker = WORK / f"prepared-{udid}"
    if marker.exists():
        return
    subprocess.run(["xcrun", "simctl", "shutdown", udid], capture_output=True)
    subprocess.run(["xcrun", "simctl", "erase", udid], check=True)
    subprocess.run(["xcrun", "simctl", "boot", udid], check=True)
    subprocess.run(["xcrun", "simctl", "bootstatus", udid, "-b"], check=True, capture_output=True)
    time.sleep(150)
    subprocess.run(["xcrun", "simctl", "io", udid, "screenshot", str(WORK / f"prepared-{udid}.png")], capture_output=True)
    subprocess.run(["xcrun", "simctl", "shutdown", udid], capture_output=True)
    marker.write_text(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + "\n")


def without_erase(module):
    """The set's tool erases the simulator in its boot; `prepare` did that once."""
    for m in [module] + ([module.fc] if hasattr(module, "fc") else []):
        if not hasattr(m, "simctl"):
            continue
        original = m.simctl

        def simctl(*args, _original=original):
            if args and args[0] == "erase":
                return ""
            return _original(*args)

        m.simctl = simctl


def run(name, udid, cordova_app, lang):
    if name not in SETS:
        sys.exit(f"set {name}: one of {sorted(SETS)}")
    if lang not in LANGS:
        sys.exit(f"language {lang}: one of {LANGS}")
    devices = owned_devices()
    if udid not in devices:
        sys.exit(f"refusing simulator {udid}: only the owned {sorted(NAMES)}")
    _, size, port = devices[udid]
    if (name, size, lang) not in matrix_runs():
        sys.exit(f"{name} {size} {lang} is not a matrix run (the 393x852 references of that set are compared already)")
    if subprocess.run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN"], capture_output=True).returncode == 0:
        sys.exit(f"port {port} is in use")
    stage = WORK / name / size / lang
    shutil.rmtree(stage, ignore_errors=True)
    stage.mkdir(parents=True)
    WORK.mkdir(parents=True, exist_ok=True)
    prepare(udid)
    module = load(name)
    configure(module, name, udid, size, lang, port, stage)
    without_erase(module)
    app = cordova_copy(cordova_app, port)
    if SETS[name]["langArg"]:
        module.capture(udid, str(app), lang)
    else:
        module.capture(udid, str(app))
    if hasattr(module, "manifest") and name in ("forecast", "air"):
        module.manifest()
    collect(name, size, lang, stage)


def collect(name, size, lang, stage):
    files = [p for d in ("shots", "records") if (stage / d).exists() for p in (stage / d).iterdir() if p.is_file()]
    patterns = [g.format(lang=lang) for g in SETS[name]["keep"]]
    kept = sorted(p for p in files if any(fnmatch.fnmatch(p.name, g) for g in patterns))
    for g in patterns:
        if not any(fnmatch.fnmatch(p.name, g) for p in kept):
            sys.exit(f"{name} {size} {lang}: nothing captured for {g}")
    OUT.mkdir(parents=True, exist_ok=True)
    prefix = f"matrix-{size}-{lang}-"
    for p in OUT.glob(prefix + "*"):
        if any(fnmatch.fnmatch(p.name[len(prefix):], g) for g in patterns):
            p.unlink()
    for p in kept:
        shutil.copy(p, OUT / (prefix + p.name))
    runs = sorted((stage / "work/runs").glob("*/capture.json"))
    capture = json.loads(runs[0].read_text("utf-8")) if runs else {}
    record = {"set": name, "size": size, "language": lang, "files": [prefix + p.name for p in kept],
              "env": capture.get("env"), "device": capture.get("device"), "capturedAt": capture.get("capturedAt"),
              "webViewOrigins": capture.get("webViewOrigins")}
    (OUT / f"{prefix}{name}-run.json").write_text(json.dumps(record, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"{name} {size} {lang}: kept {len(kept)} files, WebView origins {record['webViewOrigins'] and sorted({(o['x'], o['y']) for o in record['webViewOrigins']})}")


def check():
    missing = []
    for name, size, lang in matrix_runs():
        if not (OUT / f"matrix-{size}-{lang}-{name}-run.json").exists():
            missing.append(f"{name} {size} {lang}")
    print("\n".join(missing) or "complete")
    return missing


def provenance(cordova_app):
    app = Path(cordova_app)
    build = json.loads((app.parent / "build-cordova.json").read_text("utf-8"))
    files = sorted(p for p in OUT.iterdir() if p.suffix in (".png", ".json") and p.name != "matrix-tolerances.json")
    PROVENANCE.write_text(json.dumps({
        "tool": "ios/tools/matrix-reference/capture.py",
        "build": {"recipe": f"ios/tools/chart-reference/build-cordova.sh <out> {BUILT_SERVER}", **build,
                  "appSha256": {"www/index.html": sha256(app / "www/index.html")},
                  "note": "client/ from Git at the commit (client/www unchanged since); serverUrl rewritten per run to this "
                          "tool's port in a copy; dummy Firebase project; Google test ad units"},
        "sets": {k: {"tool": f"ios/tools/{v['tool']}/capture.py", "screens": v["screens"], "keep": v["keep"]}
                 for k, v in SETS.items()},
        "devices": {n: {"size": s} for n, (s, _) in NAMES.items()},
        "files": [{"path": p.relative_to(IOS).as_posix(), "sha256": sha256(p)} for p in files],
    }, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"wrote {PROVENANCE.relative_to(ROOT)} ({len(files)} files)")


if __name__ == "__main__":
    cmd = sys.argv[1:2]
    if cmd == ["run"] and len(sys.argv) == 6:
        run(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
    elif cmd == ["collect"] and len(sys.argv) == 5:
        # Copies the matrix states of a finished run again (after a change of the kept files).
        collect(sys.argv[2], sys.argv[3], sys.argv[4], WORK / sys.argv[2] / sys.argv[3] / sys.argv[4])
    elif cmd == ["check"] and len(sys.argv) == 2:
        sys.exit(1 if check() else 0)
    elif cmd == ["provenance"] and len(sys.argv) == 3:
        provenance(sys.argv[2])
    else:
        sys.exit(__doc__)
