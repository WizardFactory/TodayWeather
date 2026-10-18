#!/usr/bin/env python3
"""C6 actual shared-process startup against owned peers and public test accounts.

The input executable is the retained runtime_services integration test binary,
not a standalone release bundle. No dotenv, host keys or live endpoints are used.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def closed(port):
    with socket.socket() as sock:
        sock.settimeout(.2)
        return sock.connect_ex(("127.0.0.1", port)) != 0


def run_case(binary, out, label, expect_start):
    # Existing owned peer and account recorder; no new protocol or real credentials.
    peer_module = load("c6_catalog", ROOT / "tests/storage/catalog_peer.py")
    account_module = load("c6_process_fixture", ROOT / "tools/runtime_services_smoke.py")
    peer = peer_module.make()
    thread = threading.Thread(target=peer.serve_forever, daemon=True)
    thread.start()
    root = f"http://127.0.0.1:{peer.server_port}/"
    child = None
    ports = []
    result = None
    try:
        with tempfile.TemporaryDirectory(prefix="server2-c6-") as directory:
            tw = Path(directory) / "public-tw.json"
            ta = Path(directory) / "public-ta.json"
            account_module.account(tw)
            account_module.account(ta)
            active, air, families = str(tw), None, "push"
            if label == "missing":
                active = None
            elif label == "malformed":
                tw.write_text("invalid-public-fixture-json")
            elif label == "unreadable":
                active = str(Path(directory))  # Directory cannot be read as account bytes.
            elif label == "air-only":
                active, air = None, str(ta)
            elif label == "invalid-air":
                air = str(ta)
                ta.write_text("invalid-public-fixture-json")
            elif label == "both-valid":
                air = str(ta)
            elif label == "disabled":
                families, active, air = "", str(tw) + ".missing", str(ta) + ".missing"
            log_path = out / f"{label}.log"
            with log_path.open("w+") as log:
                env = {"PATH": os.defpath, "LANG": "C", "TMPDIR": directory}
                child = subprocess.Popen(
                    [str(binary), "credentials::startup_child", "--exact", "--ignored", "--nocapture"],
                    cwd=ROOT, env=env, stdin=subprocess.PIPE, stdout=log,
                    stderr=subprocess.STDOUT, text=True, start_new_session=True,
                )
                child.stdin.write(json.dumps(dict(root=root, families=families, todayweather=active, todayair=air)))
                child.stdin.close()
                deadline = time.monotonic() + 10
                ready = None
                while time.monotonic() < deadline:
                    text = log_path.read_text()
                    ready = re.search(r"^server2 public=127\.0\.0\.1:(\d+) metrics=127\.0\.0\.1:(\d+)$", text, re.M)
                    if ready or child.poll() is not None:
                        break
                    time.sleep(.02)
                if ready:
                    ports = [int(ready[1]), int(ready[2])]
                if expect_start:
                    assert ready and child.poll() is None, f"{label}: no live readiness line"
                    with urllib.request.urlopen(f"http://127.0.0.1:{ports[0]}/health", timeout=3) as response:
                        assert response.status == 200
                    child.send_signal(signal.SIGTERM)
                    assert child.wait(timeout=8) == 0, f"{label}: stop failed"
                    assert "C6_PROCESS_RESULT stopped" in log_path.read_text()
                else:
                    assert child.wait(timeout=3) != 0, f"{label}: invalid config accepted"
                    assert not ready, f"{label}: listener bound before rejection"
                    assert "C6_PROCESS_RESULT configuration-error" in log_path.read_text()
                with peer.lock:
                    counts = dict(peer.counts)
                assert not any("oauth" in key or "messages:send" in key for key in counts), "startup OAuth/FCM request"
                if not expect_start:
                    assert counts == {}, f"{label}: state work before rejection"
                assert all(closed(port) for port in ports), "product listener remains open"
                result = dict(case=label, status="PASS", started=bool(ready), exit=child.returncode,
                              storage_counts=counts, product_ports=ports, product_ports_closed=True,
                              oauth_fcm_requests=0, device_sends="zero by empty registrations and owned/closed endpoints")
    finally:
        if child and child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=5)
        peer.shutdown()
        peer.server_close()
        thread.join(timeout=3)
        assert not thread.is_alive() and closed(peer.server_port), "owned peer not retired"
    result["owned_peer_closed"] = True
    return result


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
    inputs = [Path(__file__).resolve(), ROOT / "tools/runtime_services_smoke.py",
              ROOT / "tests/storage/catalog_peer.py", ROOT / "deploy/local/peer.py",
              ROOT / "tests/delivery/fixtures/rfc7515-a2-key.pkcs8.b64", binary]
    before = {str(path): sha(path) for path in inputs}
    report = dict(verdict="FAIL", binary_sha256=args.sha256, input_sha256=before, cases=[],
                  live_actions=False, production_eligible=False,
                  limits="Shared production process via isolated test child, no dotenv/main/remote account authorization, release bundle, IAM or EC2 proof")
    try:
        for label, start in [("missing", False), ("malformed", False), ("unreadable", False),
                             ("air-only", False), ("invalid-air", False), ("active-only", True),
                             ("both-valid", True), ("disabled", True)]:
            report["cases"].append(run_case(binary, out, label, start))
        assert before == {str(path): sha(path) for path in inputs}, "verification input changed"
        report["verdict"] = "PASS"
    finally:
        (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(dict(verdict=report["verdict"], cases=len(report["cases"]), live_actions=False)))


if __name__ == "__main__":
    main()
