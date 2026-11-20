"""Extract visible English s-key feedback and field echo on the 428 × 926 profile phone."""
import argparse
import csv
import json
from pathlib import Path
import re
import subprocess
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("attachments", type=Path, help="Directory from xcresulttool export attachments")
parser.add_argument("log", type=Path, help="xcodebuild stdout for testKey")
parser.add_argument("batch")
args = parser.parse_args()
items = json.loads((args.attachments / "manifest.json").read_text())[0]["attachments"]
movie, = [a for a in items if a["exportedFileName"].endswith(".mp4")]
path = args.attachments / movie["exportedFileName"]
pts = subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v",
    "-show_entries", "frame=best_effort_timestamp_time", "-of", "csv=p=0", path], text=True)
width, height = 428, 926
size = width * height
timestamps = [float(row.rstrip(",")) for row in pts.splitlines() if row.strip()]
frames = []
with subprocess.Popen(["ffmpeg", "-v", "error", "-i", path, "-vf", "scale=428:926,format=gray",
        "-fps_mode", "passthrough", "-f", "rawvideo", "-"], stdout=subprocess.PIPE) as process:
    for t in timestamps:
        frame = process.stdout.read(size)
        if len(frame) != size:
            raise ValueError("Incomplete frame")
        def ink(x1, x2, y1, y2, cutoff):
            return sum(p < cutoff for y in range(y1, y2) for p in frame[y*width+x1:y*width+x2])
        # The enlarged s-key covers the row above it. The typed glyph replaces the long placeholder.
        pressed = ink(68,109,656,688,175) > 70 and ink(80,99,694,707,185) < 4
        typed = ink(75,83,61,75,120) >= 25 and ink(95,180,62,74,180) < 10
        frames.append((t, pressed, typed))
    if process.stdout.read(1) or process.wait():
        raise ValueError("Unexpected frame count or decoder failure")
out = csv.writer(sys.stdout, lineterminator="\n")
out.writerow(["batch","trial_0_rehearsal","key_feedback_pts_s","field_echo_pts_s","feedback_to_echo_ms","dispatch_to_screenshot_ms"])
rows = re.findall(r"^SAMPLE,key,(\d+),([\d.]+),([\d.]+),([\d.]+)", args.log.read_text(), re.M)
if len(rows) != 11 or "TEST EXECUTE SUCCEEDED" not in args.log.read_text():
    raise ValueError("Expected 11 successful interactions on the reference keyboard")
for idx, start, end, epoch in rows:
    lo = float(epoch) - movie["timestamp"]
    hi = lo + float(end) - float(start)
    window = [f for f in frames if lo <= f[0] <= hi]
    key = next(f for f in window if f[1])
    echo = next(f for f in window if f[2] and f[0] >= key[0])
    assert any(not f[2] for f in window if f[0] <= key[0])
    out.writerow([args.batch,idx,key[0],echo[0],round((echo[0]-key[0])*1000,2),round((float(end)-float(start))*1000,2)])
