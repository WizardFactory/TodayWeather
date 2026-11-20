"""Correlate an iPhone's fixture event ledger with an unchanged alarm XCTest run."""
import argparse
import csv
import re
from pathlib import Path
from statistics import median
import sys

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("events", type=Path)
p.add_argument("log", type=Path)
p.add_argument("batch")
args = p.parse_args()
log = args.log.read_text()
if "TEST EXECUTE SUCCEEDED" not in log:
    raise ValueError("The final editor or return assertion failed")
with args.events.open() as fp:
    events = [(tag,float(now),float(touch),float(up),value)
              for pid,tag,now,touch,up,value in csv.reader(fp)]
def phases(name):
    return re.findall(rf"^SAMPLE,{name},(\d+),([\d.]+),([\d.]+),([\d-]+)",log,re.M)
drags, saves = phases("drag"), phases("save")
assert len(drags) == len(saves) == 11
out = csv.writer(sys.stdout, lineterminator="\n")
out.writerow(["batch","trial_0_rehearsal","target","observed_hours","touch_to_update_ms_each",
              "median_touch_to_update_ms","last_touch_up_to_route_closed_ms","dispatch_to_return_observer_ms","fixture_posts"])
for (i,d0,d1,target),(j,s0,s1,saved) in zip(drags,saves):
    assert (i,target) == (j,saved)
    track = [e for e in events if e[0] == "track" and float(d0) <= e[1] <= float(d1)]
    hours = [int(e[4].split("-")[0]) for e in track]
    assert hours[-1] == int(target.split("-")[0])
    assert len(hours) >= 2 and all(abs(a-b)==1 for a,b in zip(hours,hours[1:]))
    assert all(e[4].split("-")[1] == target.split("-")[1] for e in track)
    change = [(e[1]-e[2])*1000 for e in track]
    within = [e for e in events if float(s0) <= e[1] <= float(s1)]
    assert [e[0] for e in within] == ["save","fixturePost","closed"] and within[1][4]=="1"
    out.writerow([args.batch,i,target," ".join(map(str,hours))," ".join(f"{n:.3f}" for n in change),
                  round(median(change),3),round((within[-1][1]-within[0][3])*1000,3),
                  round((float(s1)-float(s0))*1000,2),1])
