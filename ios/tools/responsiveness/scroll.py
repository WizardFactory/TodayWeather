"""Reduce a ProfileWindow capture to per-touch, per-scroll-view proxy measurements."""
import argparse
import csv
from collections import defaultdict
from pathlib import Path
from statistics import median
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("capture", type=Path)
parser.add_argument("--log", type=Path)
args = parser.parse_args()
windows = []
if args.log:
    for line in args.log.read_text(errors="replace").splitlines():
        if line.startswith("TW_GESTURE,"):
            _, label, lo, hi = line.split(",")
            windows.append((label, float(lo), float(hi)))
groups = defaultdict(list)
for gesture, depth, phase, *values in csv.reader(args.capture.open()):
    sample = tuple(map(float, values))
    groups[sample[-1], int(gesture), int(depth), phase].append(sample)
writer = csv.writer(sys.stdout, lineterminator="\n")
writer.writerow(["gesture", "route", "ancestor", "phase", "axis", "moving_intervals", "median_budget_ms",
                 "first_offset_change_ms", "worst_callback_ms", "excess_ms", "flagged_intervals"])
for (start, gesture, depth, phase), rows in sorted(groups.items()):
    x = [r[2] for r in rows]
    y = [r[3] for r in rows]
    axis = "horizontal" if max(x)-min(x) > max(y)-min(y) else "vertical"
    series = []
    for (t, target, x0, y0, start), (end, _, x1, y1, _) in zip(rows, rows[1:]):
        if (x0, y0) != (x1, y1):
            series.append(((end-t)*1000, (target-t)*1000, (end-start)*1000))
    if not series:
        continue
    flagged = [dt-budget for dt, budget, _ in series if dt > budget*1.5]
    label = next((name for name, lo, hi in windows if lo <= start <= hi), "")
    writer.writerow([gesture, label, depth, phase, axis, len(series), round(median(r[1] for r in series), 3),
                     round(series[0][2], 3), round(max(r[0] for r in series), 3), round(sum(flagged), 3), len(flagged)])
