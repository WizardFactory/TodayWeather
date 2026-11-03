#!/usr/bin/env python3
"""Owned-loopback C1 reject/restart/corrupt-restore smoke; never uses real credentials."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.request

import narrative_smoke as fixture


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    binary = args.binary.resolve()
    output = args.output.resolve()
    server2 = Path(__file__).resolve().parents[1]
    if not binary.is_file() or not os.access(binary, os.X_OK):
        parser.error("an existing executable is required")
    if output == server2 or server2 in output.parents or output.exists():
        parser.error("a new output directory outside server2 is required")
    output.mkdir(parents=True)
    digest = lambda: hashlib.sha256(binary.read_bytes()).hexdigest()
    report = {
        "verdict": "FAIL",
        "binary_sha256": digest(),
        "production_eligible": False,
        "live_actions": False,
        "scope": "owned-loopback synthetic registration state; no IAM, quota or live send proof",
        "requests": [],
    }
    peer = fixture.module.make()
    worker = threading.Thread(target=peer.serve_forever, daemon=True)
    worker.start()
    endpoint = f"http://127.0.0.1:{peer.server_port}/"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    process = None

    def request(base, path, method="GET", value=None, raw=None):
        headers = {}
        if base == endpoint:
            # Only the owned test peer accepts this synthetic, non-AWS header.
            headers["X-Server2-Test-Key"] = peer.config["test_access_key"]
            if method == "PUT":
                headers["If-None-Match"] = "*"
                headers["Content-MD5"] = base64.b64encode(hashlib.md5(raw).digest()).decode()
            path = peer.config["bucket"] + "/" + path
        if value is not None:
            headers["content-type"] = "application/json"
            raw = json.dumps(value).encode()
        call = urllib.request.Request(base + path, data=raw, method=method, headers=headers)
        try:
            reply = opener.open(call, timeout=15)
        except urllib.error.HTTPError as error:
            reply = error
        with reply:
            row = {"method": method, "path": path, "status": reply.status, "body": reply.read().decode()}
        report["requests"].append(row)
        return row

    def start(label):
        nonlocal process
        # Deliberately construct the whole environment: no parent .env, provider key or FCM account.
        env = {
            "PATH": "/usr/bin:/bin", "PORT": "0", "AWS_EC2_METADATA_DISABLED": "true",
            "SERVER2_NATIVE_FAMILIES": "push,notice", "SERVER2_S3_BUCKET": "server2-local",
            "AWS_ACCESS_KEY": "server2-local", "AWS_SECRET_KEY": "server2-local-secret",
            "SERVER2_S3_REGION": "ap-northeast-2", "SERVER2_LOG_RATE": "1000",
            "DONGNAE_SECRET_KEYS": '["synthetic-state-key-0001"]',
            "VC_SECRET_KEY": "synthetic-state-vc",
        }
        with (output / f"{label}.stderr.log").open("w") as stderr:
            process = subprocess.Popen([str(binary), "--s3", endpoint], cwd=output, env=env,
                                       stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=stderr,
                                       text=True, start_new_session=True)
        with selectors.DefaultSelector() as select:
            select.register(process.stdout, selectors.EVENT_READ)
            assert select.select(20), "startup timeout"
            line = process.stdout.readline()
        (output / f"{label}.stdout.log").write_text(line)
        address = re.fullmatch(r"server2 public=(127\.0\.0\.1:\d+) metrics=(127\.0\.0\.1:\d+)\n", line)
        assert address, (line, process.poll())
        return "http://" + address[1]

    def stop():
        nonlocal process
        process.send_signal(signal.SIGTERM)
        assert process.wait(timeout=40) == 0, "process did not drain successfully"
        process.stdout.close()
        process = None

    def registration(token, category="alarm"):
        return {"type": "android", "fcmToken": token, "cityIndex": 0, "id": 1,
                "category": category, "location": {"lat": 37.5, "long": 127.1},
                "source": "KMA", "pushTime": -1}

    def journal():
        return {key: obj.body for key, obj in peer.objects.items() if "/journal/" in key}

    try:
        base = start("initial")
        bad = registration("owned-bad")
        bad["units"] = [{"$x": 1}]
        reply = request(base, "/v000705/push", "POST", bad)
        assert (reply["status"], reply["body"]) == (500, "push state storage unavailable"), reply
        assert not journal(), "bad insertion was journaled"
        good = registration("owned-good")
        reply = request(base, "/v000705/push", "POST", good)
        assert reply["status"] == 200 and json.loads(reply["body"])["ok"] == 1, reply
        alert = registration("owned-alert", "alert")
        reply = request(base, "/v000902/push-list", "POST", [alert])
        assert "owned-alert" in reply["body"], reply
        previous = journal()
        bad_alert = dict(alert, precipAlerts=[{"$x": 1}])
        reply = request(base, "/v000902/push-list", "POST", [bad_alert])
        assert (reply["status"], reply["body"]) == (200, "[null]"), reply
        assert journal() == previous, "bad update changed journal state"
        reply = request(base, "/v000902/push", "PUT", {"oldToken": "owned-alert", "newToken": "owned-renamed"})
        assert reply["status"] == 200 and any(r["nModified"] == 1 for r in json.loads(reply["body"])), reply
        stop()
        base = start("restored")
        reply = request(base, "/v000902/push", "PUT", {"oldToken": "owned-renamed", "newToken": "owned-restored"})
        assert reply["status"] == 200 and any(r["nModified"] == 1 for r in json.loads(reply["body"])), reply
        stop()

        # Inject an old invalid entry into this owned peer only; the runtime must not repair/skip it.
        seq = len(journal()) + 1
        key = f"index/v2/push/state/journal/{seq:012}.json"
        raw = (json.dumps({"schema": 1, "seq": seq, "nonce": "owned-corrupt", "next_n": 3, "changes": 1})
               + '\n' + json.dumps({"c": "pushes", "n": 2, "_id": "f" * 24, "doc": {"units": [{"$x": 1}]}}) + '\n').encode()
        reply = request(endpoint, key, "PUT", raw=raw)
        assert reply["status"] == 200, reply
        previous = journal()
        base = start("corrupt")
        reply = request(base, "/v000902/push", "PUT", {"oldToken": "owned-restored", "newToken": "never-acknowledged"})
        assert (reply["status"], reply["body"]) == (500, "push state storage unavailable"), reply
        health = request(base, "/health")
        assert (health["status"], health["body"]) == (200, "OK"), health
        stop()
        events = [json.loads(line) for line in (output / "corrupt.stderr.log").read_text().splitlines()]
        assert any(event.get("component") == "push_state" and event.get("stage") == "restore"
                   and event.get("cause") == "corrupt" and event.get("outcome") == "failed"
                   for event in events), "restore did not report the injected corrupt entry"
        assert not any(event.get("event") == "operation.panic" for event in events), "restore panicked"
        assert journal() == previous, "corrupt acknowledged history was rewritten"
        report["journal_entries"] = len(previous)
        report["corrupt_bytes_preserved"] = True
        report["corrupt_restore_without_panic"] = True

        # A second fresh store isolates header corruption from the bad document above.
        peer.shutdown()
        peer.server_close()
        worker.join(timeout=5)
        peer = fixture.module.make()
        worker = threading.Thread(target=peer.serve_forever, daemon=True)
        worker.start()
        endpoint = f"http://127.0.0.1:{peer.server_port}/"
        raw = b'{"schema":1,"seq":1,"next_n":0,"changes":1e30}\n'
        reply = request(endpoint, "index/v2/push/state/journal/000000000001.json", "PUT", raw=raw)
        assert reply["status"] == 200, reply
        count_journal = journal()
        base = start("corrupt-count")
        reply = request(base, "/v000902/push", "PUT", {"oldToken": "absent", "newToken": "never-acknowledged"})
        assert (reply["status"], reply["body"]) == (500, "push state storage unavailable"), reply
        stop()
        events = [json.loads(line) for line in (output / "corrupt-count.stderr.log").read_text().splitlines()]
        assert any(event.get("component") == "push_state" and event.get("stage") == "restore"
                   and event.get("cause") == "corrupt" and event.get("outcome") == "failed"
                   for event in events), "restore did not reject the huge header count"
        assert not any(event.get("event") == "operation.panic" for event in events), "header restore panicked"
        assert journal() == count_journal, "corrupt header bytes were changed"
        report["huge_count_restore_without_panic"] = True
        assert digest() == report["binary_sha256"], "executable changed during smoke"
        report["verdict"] = "PASS"
    finally:
        if process is not None:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            process.stdout.close()
        peer.shutdown()
        peer.server_close()
        worker.join(timeout=5)
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"verdict": report["verdict"], "report": str(output / "report.json")}))


if __name__ == "__main__":
    main()
