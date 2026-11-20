"""Sample the app process after observed returns in the national-page and settings journey."""
import argparse
import csv
import json
from pathlib import Path
import subprocess
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("run_directory", type=Path)
args = parser.parse_args()
root = args.run_directory
udid = (root / "device").read_text().strip()
log = root / "a.log"
ledger = root / "requests.jsonl"


def app_stats():
    processes = subprocess.check_output(["ps", "-axo", "pid=,rss=,time=,command="], text=True)
    for line in processes.splitlines():
        fields = line.split(None, 3)
        if len(fields) == 4 and f"/Devices/{udid}/" in fields[3] and "/TodayWeather.app/TodayWeather" in fields[3]:
            return fields[:3]
    return None


with (root / "visits.csv").open("x", buffering=1) as out:
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(["batch", "run", "action", "observation_clock_s", "pid", "rss_KiB", "process_cpu_time",
                     "requests_since_server_start", "response_body_bytes_since_server_start"])
    while not log.exists():
        time.sleep(0.2)
    with log.open(errors="replace") as stream:
        journey_started = False
        while True:
            line = stream.readline()
            if not line:
                if (root / "a-metrics.json").exists():
                    break
                time.sleep(0.1)
                continue
            if "testNationalPagesAndSettings]'" in line:
                if "started." in line:
                    journey_started = True
                elif journey_started:
                    break
            if not journey_started or not line.startswith("TW_SAMPLE,"):
                continue
            _, batch, run, action, _, valid = line.strip().split(",")
            if not action.endswith("-back") or valid != "true":
                continue
            stats = app_stats()
            if stats is None:
                continue
            records = [json.loads(row) for row in ledger.read_text().splitlines() if row.endswith("}")]
            writer.writerow([batch, run, action, round(time.monotonic(), 3), *stats, len(records),
                             sum(entry["response_body_bytes"] for entry in records)])
