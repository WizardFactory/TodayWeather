#!/usr/bin/env python3
"""Writes ios/TodayWeatherTests/MatrixReference/matrix-tolerances.json from the measurements MatrixScreenshotTests prints.

    tolerances.py <xcodebuild-log> [<xcodebuild-log> ...]

Each `MATRIX-MEASURED <case> <strong> <mean> <height>` line is a local measurement; with several logs (for example the
local run and CI's) the larger value of each is taken. A case's tolerance is its measurement times 1.5 plus 0.0005 for
strong and times 1.2 plus 0.2 for mean, rounded up, and the absolute height difference, as the other reference sets
record theirs (CI renders with Xcode 26.6). The reasons of an existing file are kept.
"""
import json
import math
import re
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "TodayWeatherTests/MatrixReference/matrix-tolerances.json"
LINE = re.compile(r"MATRIX-MEASURED (\S+) (\S+) (\S+) (-?\d+)")


def up(value, digits):
    f = 10 ** digits
    return math.ceil(value * f - 1e-9) / f


def main(logs):
    measured = {}
    for log in logs:
        for m in LINE.finditer(Path(log).read_text("utf-8", errors="replace")):
            name, strong, mean, height = m.group(1), float(m.group(2)), float(m.group(3)), abs(int(m.group(4)))
            old = measured.get(name, (0, 0, 0))
            measured[name] = (max(old[0], strong), max(old[1], mean), max(old[2], height))
    if not measured:
        sys.exit("no MATRIX-MEASURED lines")
    previous = json.loads(OUT.read_text("utf-8")) if OUT.exists() else {}
    cases = {}
    for name in sorted(measured):
        strong, mean, height = measured[name]
        cases[name] = {"measured": {"strong": round(strong, 5), "mean": round(mean, 3)},
                       "strong": up(strong * 1.5 + 0.0005, 4), "mean": up(mean * 1.2 + 0.2, 2), "heightDifference": height}
    OUT.write_text(json.dumps({
        "metric": "AN-05: strong = share of pixels whose largest RGB channel differs by more than 64 after a 3x3 box blur; "
                  "mean = mean largest RGB channel difference (0-255); heightDifference = |native - Cordova| px after the "
                  "points a block ends under the tab bar. Each case passes within its value plus `margin`.",
        "margin": {"strong": 0.0015, "mean": 0.3, "heightDifference": 0},
        "reasons": previous.get("reasons", {}),
        "cases": cases}, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"wrote {len(cases)} cases to {OUT}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
