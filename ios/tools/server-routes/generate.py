#!/usr/bin/env python3
"""Route table of the legacy server for the iOS request-path test (IN-18, #2967; spec R8).

    python3 ios/tools/server-routes/generate.py

Runs the Android route generator (android/tools/server-routes/generate.mjs, AN-18), unchanged, with Node: it reads
server/app.js and every router it mounts as text, without loading them, and builds each router's layers in
registration order with the expression Express 4 matches. `redirect.mjs` (preloaded) makes it write the table to
ios/Core/Tests/TWDataTests/Golden/server-routes/routes.json instead of android/, with this tool named as the generator.
The table records the last commit and SHA-256 of every server file read. Only this tool reads server/ and android/;
the iOS build and tests read the written file. Running it again without changes in server/ changes nothing (CI checks
that). Needs Node 22 or later and the full Git history.
"""
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
GENERATOR = ROOT / "android" / "tools" / "server-routes" / "generate.mjs"
OUT = ROOT / "ios" / "Core" / "Tests" / "TWDataTests" / "Golden" / "server-routes" / "routes.json"
NAME = "ios/tools/server-routes/generate.py (android/tools/server-routes/generate.mjs)"


def main():
    for needed in (GENERATOR, ROOT / "server" / "app.js"):
        if not needed.is_file():
            sys.exit(f"missing {needed.relative_to(ROOT)}: the generator needs server/ and android/tools/server-routes")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, TW_ROUTES_OUT=str(OUT), TW_ROUTES_GENERATOR=NAME)
    result = subprocess.run(["node", "--import", (HERE / "redirect.mjs").as_uri(), str(GENERATOR)],
                            cwd=ROOT, env=env, capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"the route generator failed:\n{result.stdout}{result.stderr}")
    # The generator prints its own output path and counts; report the iOS path with the counts.
    counts = result.stdout.strip().split(": ", 1)[-1]
    print(f"{OUT.relative_to(ROOT)}: {counts}")


if __name__ == "__main__":
    main()
