#!/usr/bin/env python3
"""E1/E2 actual-main startup checks in owned directories with isolated configuration.

Positive cases use explicit closed-loopback development coexistence, not a complete
native production deployment. No product request or provider/credential probe is made.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
FAMILIES = "geocode,dsf,kma,kma-v000901,kma-v000902,town,push,notice"


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def closed(port):
    with socket.socket() as sock:
        sock.settimeout(.2)
        return sock.connect_ex(("127.0.0.1", port)) != 0


def run_case(binary, out, label, settings, dotenv, expect_start):
    child, ports = None, []
    with tempfile.TemporaryDirectory(prefix="server2-startup-") as directory:
        cwd = Path(directory)
        if dotenv is not None:
            (cwd / ".env").write_text(dotenv)
        log_path = out / (label + ".log")
        try:
            with log_path.open("w") as log:
                env = {"PATH": os.defpath, "LANG": "C", "TMPDIR": directory, "PORT": "0"}
                env.update(settings)
                child = subprocess.Popen([str(binary)], cwd=cwd, env=env,
                                         stdin=subprocess.DEVNULL, stdout=log,
                                         stderr=subprocess.STDOUT, start_new_session=True)
                deadline = time.monotonic() + 8
                ready = None
                while time.monotonic() < deadline:
                    ready = re.search(r"^server2 public=127\.0\.0\.1:(\d+) metrics=127\.0\.0\.1:(\d+)$",
                                      log_path.read_text(), re.M)
                    if ready or child.poll() is not None:
                        break
                    time.sleep(.02)
                if ready:
                    ports = [int(ready[1]), int(ready[2])]
                if expect_start:
                    require(ready and child.poll() is None, label + ": did not start")
                    # Disable host proxy discovery even for this loopback-only health request.
                    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                    with opener.open("http://127.0.0.1:%d/health" % ports[0], timeout=3) as response:
                        require(response.status == 200, label + ": health failed")
                    child.send_signal(signal.SIGTERM)
                    require(child.wait(timeout=8) == 0, label + ": graceful exit failed")
                else:
                    require(child.wait(timeout=3) != 0, label + ": invalid config accepted")
                    require(not ready, label + ": listener bound before rejection")
                require(all(closed(port) for port in ports), label + ": product listener remains")
                # Startup must not create state or additional files in the owned working dir.
                require(sorted(p.name for p in cwd.iterdir()) == ([".env"] if dotenv is not None else []),
                        label + ": unexpected working-directory output")
                return dict(case=label, status="PASS", started=bool(ready), exit=child.returncode,
                            dotenv_present=dotenv is not None, health_status=200 if expect_start else None,
                            product_ports=ports, product_ports_closed=True)
        finally:
            if child and child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    binary, out = args.binary.resolve(), args.out.resolve()
    if not binary.is_file() or sha(binary) != args.sha256:
        parser.error("retained binary SHA-256 mismatch")
    if out.exists() or out.is_relative_to(ROOT):
        parser.error("new output outside server2 required")
    out.mkdir(parents=True)
    inputs = [Path(__file__).resolve(), binary]
    before = {str(path): sha(path) for path in inputs}
    report = dict(verdict="FAIL", binary_sha256=args.sha256, input_sha256=before, cases=[],
                  live_actions=False, production_eligible=False,
                  limits="Actual production executable; positives are explicit loopback coexistence health only. "
                         "No full-native main startup, product API, packet capture, live provider, "
                         "device, host or operational readiness claim. No host environment or .env inherited.")
    cases = [
        ("bare-env-only", {}, None, False),
        ("missing-v000901", {"SERVER2_NATIVE_FAMILIES": FAMILIES.replace("kma-v000901,", "")}, None, False),
        ("missing-world-version", {"SERVER2_NATIVE_FAMILIES": FAMILIES,
                                   "SERVER2_WORLD_VERSIONS": "v000902,v000903"}, None, False),
        ("missing-required-account", {"SERVER2_NATIVE_FAMILIES": FAMILIES}, None, False),
        ("incomplete-dotenv", {}, "SERVER2_NATIVE_FAMILIES=notice\n", False),
        ("env-only-coexistence", {"SERVER2_GATEWAY_LEGACY_URL": "http://127.0.0.1:9"}, None, True),
        ("file-process-precedence", {}, "PORT=invalid\nSERVER2_GATEWAY_LEGACY_URL=http://127.0.0.1:9\n", True),
    ]
    try:
        for case in cases:
            report["cases"].append(run_case(binary, out, *case))
        require(before == {str(path): sha(path) for path in inputs}, "verification input changed")
        report["verdict"] = "PASS"
    finally:
        (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(dict(verdict=report["verdict"], cases=len(report["cases"]), live_actions=False)))


if __name__ == "__main__":
    main()
