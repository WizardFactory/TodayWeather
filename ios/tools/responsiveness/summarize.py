"""Summarize TW_SAMPLE logs without pooling attempts, rehearsal or failed interactions."""
import argparse
from collections import defaultdict
import csv
from pathlib import Path
from statistics import median
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("logs", nargs="+", type=Path)
args = parser.parse_args()
writer = csv.writer(sys.stdout)
writer.writerow(["source", "action", "batch", "attempted", "failed", "median_ms", "min_ms", "max_ms"])
for path in args.logs:
    rows = defaultdict(list)
    with path.open(errors="replace") as handle:
        for line in handle:
            if line.startswith("TW_SAMPLE,"):
                _, batch, run, action, ms, valid = line.strip().split(",")
                if batch != "0":
                    rows[action, batch].append((float(ms), valid == "true"))
    for (action, batch), values in sorted(rows.items()):
        ok = [ms for ms, valid in values if valid]
        stats = [round(fn(ok), 3) for fn in (median, min, max)] if ok else [""] * 3
        writer.writerow([path.name, action, batch, len(values), len(values)-len(ok), *stats])
