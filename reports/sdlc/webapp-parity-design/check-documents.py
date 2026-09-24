"""Bounded content checks for the local webapp design; never starts the app."""
from pathlib import Path
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[3]
REPORT = ROOT / "reports/sdlc/webapp-parity-design"
checks = []


def record(name, ok, detail):
    checks.append({"name": name, "passed": bool(ok), "detail": detail})


docs = sorted((ROOT / "docs/webapp").rglob("*.md"))
docs += sorted(REPORT.glob("*.md"))
broken = []
link_count = 0
for path in docs:
    for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", path.read_text()):
        if re.match(r"[a-z]+:", target) or target.startswith("#"):
            continue
        target = target.split("#", 1)[0]
        if not target:
            continue
        link_count += 1
        if not (path.parent / target).exists():
            broken.append(f"{path.relative_to(ROOT)} -> {target}")
record("local-links", not broken, {"checked": link_count, "broken": broken})

spec = (ROOT / "docs/webapp/specification.md").read_text()
rows = re.findall(r"^\| (S\d{2})\b", spec, re.M)
record("legacy-screen-coverage", sorted(rows) == [f"S{i:02}" for i in range(1, 17)], rows)
record("native-and-commercial-boundaries", all(value.casefold() in spec.casefold() for value in [
    "widgets", "Watch", "S13", "S09", "Decision", "ad-free", "Native app storage"
]), "Screen and platform exceptions are explicit; main agent reviewed their meaning.")

anchors = {
    "client/www/index.html": ["document.addEventListener('deviceready'", "angular.bootstrap"],
    "client/www/js/service.weatherutil.js": ["'/v000903'", "airForecastSource=kaq", "geoInfo.location.lat", "}, 2000)"],
    "client/www/js/controller.units.js": ["temperatureUnit", "windSpeedUnit", "pressureUnit", "distanceUnit", "precipitationUnit", "airUnit"],
    "client/www/js/service.storage.js": ["appPreferences"],
    "client/www/js/controller.purchase.js": ["/check-purchase"],
    "client/gulpfile.js": ["build_tw_ios", "build_tw_android", "build_ta_ios", "build_ta_android"],
    "server/app.js": ["app.use(cors())"],
    "server/routes/v000903/index.js": ["'/nation'", "'/kma'", "'/dsf/coord'"],
}
missing = []
for name, fragments in anchors.items():
    content = (ROOT / name).read_text()
    missing += [f"{name}: {fragment}" for fragment in fragments if fragment not in content]
record("current-source-anchors", not missing, {"files": len(anchors), "missing": missing})

delivery = json.loads((REPORT / "diagram-delivery.json").read_text())
browser = json.loads((REPORT / "diagram-browser-command.json").read_text())
for name, key in [("webapp-architecture.json", "specification"), ("webapp-architecture.html", "artifact")]:
    content = (ROOT / "docs/webapp/diagrams" / name).read_bytes()
    record(f"diagram-{key}-identity", hashlib.sha256(content).hexdigest() == delivery[key]["sha256"]
           and len(content) == delivery[key]["bytes"], delivery[key])
record("showcase-artifact", delivery["ok"] and delivery["validation"]["checksPassed"] == 9
       and delivery["validation"]["errors"] == 0 and delivery["validation"]["warnings"] == 0,
       delivery["validation"])
record("artifact-bound-browser-evidence", browser["status"] == "pass"
       and browser["artifact"]["sha256"] == delivery["artifact"]["sha256"]
       and len(browser["containment"]["viewports"]) == 4
       and all(v["ok"] for v in browser["containment"]["viewports"])
       and len(browser["captures"]["screenshots"]) == 4,
       "Four desktop sizes contained; four endpoint light/dark captures.")

head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
record("source-baseline", head == "87b8855f308611a07897cd3a39c45fefb3088d77", head)
diff = subprocess.run(["git", "diff", "--check"], cwd=ROOT, capture_output=True, text=True)
record("tracked-diff-whitespace", diff.returncode == 0, diff.stdout + diff.stderr)
record("root-discovery-link", "docs/webapp/README.md" in (ROOT / "README.md").read_text(), "README links the proposal.")

result = {"scope": "Document/source/artifact checks only; no app tests or live API calls.",
          "passed": all(c["passed"] for c in checks), "checks": checks}
print(json.dumps(result, indent=2))
raise SystemExit(0 if result["passed"] else 1)
