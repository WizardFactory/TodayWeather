#!/usr/bin/env python3
"""Offline tests of scripts/private-inputs.py with an in-memory S3 double."""
from __future__ import annotations

import contextlib
import datetime as dt
import hashlib
import importlib.util
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / "private-inputs.py"
spec = importlib.util.spec_from_file_location("private_inputs", SCRIPT)
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)

NOW = dt.datetime(2026, 11, 27, 3, 4, 5, tzinfo=dt.timezone.utc)
ROOT = "mobile/release-backups/"
INPUTS = {
    "android/private.properties": "A=1\n",
    "release/tw-google-services.json": "{}\n",
    "ios/Private.xcconfig": "B = 2\n",
    "ios/GoogleService-Info.plist": "<plist/>\n",
}


class FakeS3:
    def __init__(self):
        self.bucket = "private-bucket"
        self.root = ROOT
        self.objects: dict[str, bytes] = {}
        self.corrupt_reads: set[str] = set()
        self.on_put = None

    def put_new(self, key, path):
        if key in self.objects:
            raise tool.Failure("aws s3api put-object failed (PreconditionFailed)", "PreconditionFailed")
        if self.on_put:
            self.on_put(key)
        self.objects[key] = Path(path).read_bytes()

    def get(self, key, path):
        if key not in self.objects:
            raise tool.Failure("aws s3api get-object failed (NoSuchKey)", "NoSuchKey")
        data = self.objects[key]
        Path(path).write_bytes(data + b"x" if key in self.corrupt_reads else data)

    def runs(self):
        return sorted({k[len(self.root):].split("/", 1)[0] for k in self.objects if k.startswith(self.root)})


class PrivateInputsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name).resolve()
        self.config = self.home / ".config" / "todayweather"
        for name, text in INPUTS.items():
            (self.config / name).parent.mkdir(parents=True, exist_ok=True)
            (self.config / name).write_text(text)
        self.env_file = self.home / "client.env"
        self.env_file.write_text("TW_RELEASE_S3_PREFIX=s3://private-bucket/mobile/\n"
                                 "TW_RELEASE_AWS_PROFILE=release\nTW_RELEASE_AWS_REGION=ap-northeast-2\n")
        self.s3 = FakeS3()
        self.patches = [mock.patch.dict(os.environ, {"HOME": str(self.home)}),
                        mock.patch.object(tool, "CONFIG_ROOT", self.config)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    def run_tool(self, *argv, now=NOW, factory=None):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = tool.main(["--env", str(self.env_file), *argv], s3_factory=factory or (lambda env: self.s3), now=now)
        return code, out.getvalue(), err.getvalue()

    def put_complete(self, prefix, manifest_bytes):
        self.s3.objects[prefix + "manifest.json"] = manifest_bytes
        self.s3.objects[prefix + "COMPLETE"] = hashlib.sha256(manifest_bytes).hexdigest().encode() + b"\n"

    def prefix(self, now=NOW, label="native-inputs"):
        return f"{ROOT}{now.strftime('%Y%m%dT%H%M%SZ')}-{label}/"

    def test_snapshot_stores_payload_restore_and_manifest(self):
        code, out, _ = self.run_tool("snapshot", "--label", "native-inputs")
        self.assertEqual(code, 0)
        prefix = self.prefix()
        self.assertIn("20261127T030405Z-native-inputs", out)
        self.assertEqual(set(self.s3.objects), {prefix + n for n in [*INPUTS, "manifest.json", "RESTORE.md", "COMPLETE"]})
        manifest = json.loads(self.s3.objects[prefix + "manifest.json"])
        self.assertEqual(manifest["schema_version"], 1)
        entry = manifest["files"][0]
        self.assertEqual(entry["restore_local_at_capture"], "~/.config/todayweather/android/private.properties")
        self.assertEqual(entry["sha256"], hashlib.sha256(b"A=1\n").hexdigest())
        self.assertNotIn("A=1", out)  # values are never printed

    def test_manifest_last_and_hashes_the_uploaded_bytes(self):
        order = []

        def change_during_upload(key):
            order.append(key.rsplit("/", 1)[-1])
            if key.endswith("ios/Private.xcconfig"):
                (self.config / "ios/Private.xcconfig").write_text("changed\n")

        self.s3.on_put = change_during_upload
        self.assertEqual(self.run_tool("snapshot", "--label", "native-inputs")[0], 0)
        self.assertEqual(order[-3:], ["RESTORE.md", "manifest.json", "COMPLETE"])
        manifest = json.loads(self.s3.objects[self.prefix() + "manifest.json"])
        for entry in manifest["files"]:
            stored = self.s3.objects[self.prefix() + entry["object_relative"]]
            self.assertEqual(entry["sha256"], hashlib.sha256(stored).hexdigest())
        self.assertEqual(self.s3.objects[self.prefix() + "ios/Private.xcconfig"], b"B = 2\n")

    def test_verify_matches_newest_snapshot_and_reports_changes(self):
        self.run_tool("snapshot", "--label", "native-inputs", now=NOW - dt.timedelta(days=1))
        self.run_tool("snapshot", "--label", "native-inputs")
        code, out, _ = self.run_tool("verify", "--label", "native-inputs")
        self.assertEqual(code, 0)
        self.assertIn("20261127T030405Z-native-inputs", out)
        (self.config / "ios/Private.xcconfig").write_text("B = 3\n")
        code, _, err = self.run_tool("verify", "--label", "native-inputs")
        self.assertEqual(code, 1)
        self.assertIn("~/.config/todayweather/ios/Private.xcconfig: differs from the snapshot", err)
        self.assertNotIn("B = 3", err)
        (self.config / "android/private.properties").unlink()
        _, _, err = self.run_tool("verify", "--label", "native-inputs")
        self.assertIn("android/private.properties: missing locally", err)

    def test_verify_requires_every_file_of_the_label(self):
        manifest = {"files": [{"restore_local_at_capture": "~/.config/todayweather/android/private.properties",
                               "sha256": hashlib.sha256(b"A=1\n").hexdigest()}]}
        self.put_complete(self.prefix(), json.dumps(manifest).encode())
        code, _, err = self.run_tool("verify", "--label", "native-inputs")
        self.assertEqual(code, 1)
        self.assertIn("ios/Private.xcconfig: not in snapshot", err)

    def test_verify_skips_other_labels_and_incomplete_runs(self):
        self.s3.objects[f"{ROOT}20991231T000000Z/manifest.json"] = b"{}"
        self.s3.objects[f"{ROOT}20991231T000000Z-ios-signing/manifest.json"] = b"{}"
        self.s3.objects[f"{ROOT}20991231T000000Z-native-inputs/ios/Private.xcconfig"] = b"partial"
        code, _, err = self.run_tool("verify", "--label", "native-inputs")
        self.assertEqual(code, 2)
        self.assertIn("no complete snapshot labelled 'native-inputs'", err)
        self.run_tool("snapshot", "--label", "native-inputs")
        self.assertEqual(self.run_tool("verify", "--label", "native-inputs")[0], 0)

    def test_failed_readback_leaves_no_manifest(self):
        self.assertEqual(self.run_tool("snapshot", "--label", "native-inputs")[0], 0)
        code, _, err = self.run_tool("snapshot", "--label", "native-inputs")
        self.assertEqual(code, 2)
        self.assertIn("PreconditionFailed", err)
        for offset, name in ((1, "ios/Private.xcconfig"), (2, "RESTORE.md"), (3, "manifest.json")):
            later = NOW + dt.timedelta(seconds=offset)
            self.s3.corrupt_reads.add(self.prefix(later) + name)
            code, _, err = self.run_tool("snapshot", "--label", "native-inputs", now=later)
            self.assertEqual(code, 2)
            self.assertIn(f"read-back of {name} differs", err)
            self.assertNotIn(self.prefix(later) + "COMPLETE", self.s3.objects)
        later = NOW + dt.timedelta(seconds=5)
        self.s3.corrupt_reads.add(self.prefix(later) + "COMPLETE")
        code, _, err = self.run_tool("snapshot", "--label", "native-inputs", now=later)
        self.assertEqual(code, 2)
        self.assertIn("whether the run is complete is unknown", err)
        del self.s3.objects[self.prefix(later) + "COMPLETE"]
        # A COMPLETE that does not hold the manifest's hash does not complete the run.
        later = NOW + dt.timedelta(seconds=4)
        self.s3.objects[self.prefix(later) + "manifest.json"] = b'{"files": []}'
        self.s3.objects[self.prefix(later) + "COMPLETE"] = b"0" * 64
        code, out, _ = self.run_tool("verify", "--label", "native-inputs")
        self.assertEqual(code, 0)
        self.assertIn("20261127T030405Z-native-inputs", out)

    def test_refuses_paths_outside_the_config_root(self):
        outside = self.home / "elsewhere.txt"
        outside.write_text("x")
        (self.config / "link.txt").symlink_to(outside)
        (self.config / "linkdir").symlink_to(self.home)
        for target in (str(outside), "../../elsewhere.txt"):
            code, _, err = self.run_tool("snapshot", "--label", "misc", target)
            self.assertEqual(code, 2, target)
            self.assertIn("is not under", err)
        for target in ("link.txt", "linkdir/elsewhere.txt"):
            code, _, err = self.run_tool("snapshot", "--label", "misc", target)
            self.assertEqual(code, 2, target)
            self.assertIn("is a link or crosses one", err)
        fifo = self.config / "pipe"
        os.mkfifo(fifo)
        code, _, err = self.run_tool("snapshot", "--label", "misc", "pipe")
        self.assertEqual(code, 2)
        self.assertIn("is not a regular file", err)
        # A required input that is a link inside the root is refused too (no silent rename).
        real = self.config / "android/real.properties"
        (self.config / "android/private.properties").rename(real)
        (self.config / "android/private.properties").symlink_to(real)
        code, _, err = self.run_tool("snapshot", "--label", "native-inputs")
        self.assertEqual(code, 2)
        self.assertIn("is a link or crosses one", err)
        self.assertEqual(self.s3.objects, {})
        for path in ("~/elsewhere.txt", "~/.config/todayweather/../x", "~/.config/todayweather/a\u0000b"):
            manifest = {"files": [{"restore_local_at_capture": path, "sha256": "0"}]}
            self.put_complete(self.prefix(label="misc"), json.dumps(manifest).encode())
            code, _, err = self.run_tool("verify", "--label", "misc")
            self.assertEqual(code, 2, path)
            self.assertIn("lists a path outside", err)

    def test_refuses_missing_files_reserved_names_and_bad_input(self):
        code, _, err = self.run_tool("snapshot", "--label", "native-inputs", "android/private.properties")
        self.assertEqual(code, 0)  # required files are always included
        self.assertEqual(len(json.loads(self.s3.objects[self.prefix() + "manifest.json"])["files"]), 4)
        (self.config / "manifest.json").write_text("{}")
        for reserved in ("manifest.json", "manifest.json/fixture", "COMPLETE", "complete/fixture"):
            code, _, err = self.run_tool("snapshot", "--label", "misc", reserved)
            self.assertEqual(code, 2, reserved)
            self.assertIn("reserved snapshot name", err)
        (self.config / "ios/GoogleService-Info.plist").unlink()
        code, _, err = self.run_tool("snapshot", "--label", "native-inputs", now=NOW + dt.timedelta(seconds=9))
        self.assertEqual(code, 2)
        self.assertIn("missing private input: ~/.config/todayweather/ios/GoogleService-Info.plist", err)
        self.assertEqual(self.run_tool("snapshot", "--label", "Bad_Label")[0], 2)
        self.assertEqual(self.run_tool("snapshot", "--label", "unknown")[0], 2)
        self.env_file.write_text("TW_RELEASE_AWS_PROFILE=release\n")
        code, _, err = self.run_tool("verify", "--label", "native-inputs")
        self.assertEqual(code, 2)
        self.assertIn("lacks TW_RELEASE_S3_PREFIX", err)

    def test_unreadable_manifest_and_missing_aws_cli_exit_2(self):
        self.put_complete(self.prefix(), b"not json")
        code, _, err = self.run_tool("verify", "--label", "native-inputs")
        self.assertEqual(code, 2)
        self.assertIn("unreadable manifest.json", err)
        self.put_complete(self.prefix(), b"\xff\xfe")
        self.assertEqual(self.run_tool("verify", "--label", "native-inputs")[0], 2)
        listing, _ = AwsCliTest().adapter(stdout="5")
        code, _, err = self.run_tool("verify", "--label", "native-inputs", factory=lambda env: listing)
        self.assertEqual(code, 2)
        self.assertIn("unreadable output", err)

        def missing(*args, **kwargs):
            raise FileNotFoundError("aws")

        code, _, err = self.run_tool("verify", "--label", "native-inputs",
                                     factory=lambda env: tool.AwsS3(env, run=missing))
        self.assertEqual(code, 2)
        self.assertIn("aws CLI could not start", err)
        self.env_file.write_bytes(b"\xff\xfe=1\n")
        code, _, err = self.run_tool("verify", "--label", "native-inputs")
        self.assertEqual(code, 2)


class AwsCliTest(unittest.TestCase):
    ENV = {"TW_RELEASE_S3_PREFIX": "s3://b/mobile/", "TW_RELEASE_AWS_PROFILE": "p", "TW_RELEASE_AWS_REGION": "r"}

    def adapter(self, returncode=0, stdout="", stderr=""):
        calls = []

        def run(args, **kwargs):
            calls.append(args)
            return subprocess.CompletedProcess(args, returncode, stdout, stderr)

        return tool.AwsS3(self.ENV, run=run), calls

    def test_prefix_parsing(self):
        s3, _ = self.adapter()
        self.assertEqual((s3.bucket, s3.root), ("b", "mobile/release-backups/"))
        self.assertEqual(tool.AwsS3({**self.ENV, "TW_RELEASE_S3_PREFIX": "s3://b"}).root, "release-backups/")

    def test_commands(self):
        s3, calls = self.adapter(stdout='["mobile/release-backups/20261127T000000Z-native-inputs/"]')
        s3.put_new("k", Path("/tmp/f"))
        s3.get("k", Path("/tmp/out"))
        self.assertEqual(s3.runs(), ["20261127T000000Z-native-inputs"])
        put, get, listing = calls
        self.assertEqual(put[:3], ["aws", "s3api", "put-object"])
        for flag, value in (("--if-none-match", "*"), ("--server-side-encryption", "AES256"), ("--body", "/tmp/f"),
                            ("--profile", "p"), ("--region", "r")):
            self.assertEqual(put[put.index(flag) + 1], value)
        self.assertEqual(get[:3], ["aws", "s3api", "get-object"])
        self.assertEqual(get[get.index("--key") + 2], "/tmp/out")  # outfile is positional after the key
        self.assertEqual(listing[listing.index("--delimiter") + 1], "/")
        self.assertEqual(listing[listing.index("--prefix") + 1], "mobile/release-backups/")
        self.assertEqual(listing[listing.index("--query") + 1], "CommonPrefixes[].Prefix")
        self.assertEqual(listing[listing.index("--output") + 1], "json")

    def test_errors_keep_only_the_aws_code(self):
        stderr = ("An error occurred (AccessDenied) when calling the GetObject operation: User: "
                  "arn:aws:iam::123456789012:user/someone is not authorized on arn:aws:s3:::secret-bucket/k\n")
        s3, _ = self.adapter(returncode=254, stderr=stderr)
        with self.assertRaises(tool.Failure) as caught:
            s3.get("k", Path("/tmp/out"))
        self.assertEqual(caught.exception.code, "AccessDenied")
        self.assertNotIn("123456789012", str(caught.exception))
        self.assertNotIn("secret-bucket", str(caught.exception))
        s3, _ = self.adapter(returncode=254, stderr="An error occurred (NoSuchKey) when calling the GetObject operation")
        with self.assertRaises(tool.Failure) as caught:
            s3.get("k", Path("/tmp/out"))
        self.assertEqual(caught.exception.code, "NoSuchKey")


if __name__ == "__main__":
    unittest.main()
