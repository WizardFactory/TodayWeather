"""Measure elapsed CPU time and resident set of one already-seeded simulator process."""
import argparse
import csv
import subprocess
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("udid")
parser.add_argument("output")
parser.add_argument("--seconds", type=int, default=30)
args = parser.parse_args()
bundle = "net.wizardfactory.todayweather"


def launch(app):
    reply = subprocess.check_output(["xcrun", "simctl", "launch", args.udid, app], text=True)
    return int(reply.strip().split(":")[-1])


pid = launch(bundle)
with open(args.output, "x", newline="") as handle:
    writer = csv.writer(handle)
    writer.writerow(["state", "elapsed_s", "pid", "rss_KiB", "process_cpu_time"])
    for state in ["foreground", "background", "resumed"]:
        active_pid = launch("com.apple.Preferences" if state == "background" else bundle)
        if state != "background" and active_pid != pid:
            raise RuntimeError("Process restarted during measurement")
        start = time.monotonic()
        for offset in range(args.seconds + 1):
            time.sleep(max(0, start + offset - time.monotonic()))
            rss, cpu = subprocess.check_output(
                ["ps", "-p", str(pid), "-o", "rss=,time="], text=True
            ).split()
            writer.writerow([state, time.monotonic() - start, pid, rss, cpu])
            handle.flush()
