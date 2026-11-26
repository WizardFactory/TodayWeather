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
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / "private-inputs.py"
spec = importlib.util.spec_from_file_location("private_inputs", SCRIPT)
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)

NOW = dt.datetime(2026, 11, 27, 3, 4, 5, tzinfo=dt.timezone.utc)


class FakeS3:
    def __init__(self, env):
        self.bucket = "private-bucket"
        self.root = "mobile/release-backups/"
        self.objects: dict[str, bytes] = {}
        self.corrupt_reads: set[str] = set()

    def put_new(self, key, path):
        if key in self.objects:
            raise tool.Failure(f"aws s3api put-object failed: PreconditionFailed {key}")
        self.objects[key] = Path(path).read_bytes()

    def get(self, key, path):
        if key not in self.objects:
            raise tool.Failure(f"aws s3api get-object failed: NoSuchKey {key}")
        data = self.objects[key]
        Path(path).write_bytes(data + b"x" if key in self.corrupt_reads else data)

    def runs(self):
        return sorted({k[len(self.root):].split("/", 1)[0] for k in self.objects if k.startswith(self.root)})


class PrivateInputsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.config = self.home / ".config" / "todayweather"
        for name, text in {"android/private.properties": "A=1\n", "ios/Private.xcconfig": "B = 2\n",
                           "ios/GoogleService-Info.plist": "<plist/>\n"}.items():
            (self.config / name).parent.mkdir(parents=True, exist_ok=True)
            (self.config / name).write_text(text)
        self.env_file = self.home / "client.env"
        self.env_file.write_text("TW_RELEASE_S3_PREFIX=s3://private-bucket/mobile/\n"
                                 "TW_RELEASE_AWS_PROFILE=release\nTW_RELEASE_AWS_REGION=ap-northeast-2\n")
        self.s3 = FakeS3(None)
        self.patches = [mock.patch.dict(os.environ, {"HOME": str(self.home)}),
                        mock.patch.object(tool, "CONFIG_ROOT", self.config)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    def run_tool(self, *argv, now=NOW):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = tool.main(["--env", str(self.env_file), *argv], s3_factory=lambda env: self.s3, now=now)
        return code, out.getvalue(), err.getvalue()

    def test_snapshot_stores_manifest_restore_and_payload(self):
        code, out, _ = self.run_tool("snapshot", "--label", "native-inputs")
        self.assertEqual(code, 0)
        prefix = "mobile/release-backups/20261127T030405Z-native-inputs/"
        self.assertIn("20261127T030405Z-native-inputs", out)
        self.assertEqual(set(self.s3.objects), {prefix + n for n in (
            "android/private.properties", "ios/Private.xcconfig", "ios/GoogleService-Info.plist",
            "manifest.json", "RESTORE.md")})
        manifest = json.loads(self.s3.objects[prefix + "manifest.json"])
        self.assertEqual(manifest["schema_version"], 1)
        entry = manifest["files"][0]
        self.assertEqual(entry["restore_local_at_capture"], "~/.config/todayweather/android/private.properties")
        self.assertEqual(entry["sha256"], hashlib.sha256(b"A=1\n").hexdigest())
        self.assertNotIn("A=1", out)  # values are never printed

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

    def test_verify_ignores_other_labels_and_unlabelled_backups(self):
        self.s3.objects["mobile/release-backups/20991231T000000Z/manifest.json"] = b"{}"
        self.s3.objects["mobile/release-backups/20991231T000000Z-ios-signing/manifest.json"] = b"{}"
        self.s3.objects["mobile/release-backups/20991231T000000Z-native-inputs/ios/Private.xcconfig"] = b"partial"
        code, _, err = self.run_tool("verify", "--label", "native-inputs")
        self.assertEqual(code, 2)
        self.assertIn("no snapshot labelled 'native-inputs'", err)
        self.run_tool("snapshot", "--label", "native-inputs")
        self.assertEqual(self.run_tool("verify", "--label", "native-inputs")[0], 0)

    def test_snapshot_never_overwrites_and_fails_on_bad_readback(self):
        self.assertEqual(self.run_tool("snapshot", "--label", "native-inputs")[0], 0)
        code, _, err = self.run_tool("snapshot", "--label", "native-inputs")
        self.assertEqual(code, 2)
        self.assertIn("PreconditionFailed", err)
        self.s3.corrupt_reads.add("mobile/release-backups/20261127T030406Z-native-inputs/ios/Private.xcconfig")
        code, _, err = self.run_tool("snapshot", "--label", "native-inputs", now=NOW + dt.timedelta(seconds=1))
        self.assertEqual(code, 2)
        self.assertIn("read-back of ios/Private.xcconfig differs", err)
        # The failed run has payload but no manifest: verify uses the earlier complete run.
        failed = "mobile/release-backups/20261127T030406Z-native-inputs/"
        self.assertNotIn(failed + "manifest.json", self.s3.objects)
        code, out, _ = self.run_tool("verify", "--label", "native-inputs")
        self.assertEqual(code, 0)
        self.assertIn("20261127T030405Z-native-inputs", out)

    def test_refuses_missing_files_paths_outside_config_and_bad_input(self):
        (self.config / "ios/GoogleService-Info.plist").unlink()
        code, _, err = self.run_tool("snapshot", "--label", "native-inputs")
        self.assertEqual((code, self.s3.objects), (2, {}))
        self.assertIn("missing private input: ~/.config/todayweather/ios/GoogleService-Info.plist", err)
        outside = self.home / "elsewhere.txt"
        outside.write_text("x")
        code, _, err = self.run_tool("snapshot", "--label", "misc", str(outside))
        self.assertEqual(code, 2)
        self.assertIn("is not under", err)
        self.assertEqual(self.run_tool("snapshot", "--label", "Bad_Label")[0], 2)
        self.assertEqual(self.run_tool("snapshot", "--label", "unknown")[0], 2)
        self.env_file.write_text("TW_RELEASE_AWS_PROFILE=release\n")
        code, _, err = self.run_tool("verify", "--label", "native-inputs")
        self.assertEqual(code, 2)
        self.assertIn("lacks TW_RELEASE_S3_PREFIX", err)

    def test_aws_cli_prefix_parsing(self):
        s3 = tool.AwsS3({"TW_RELEASE_S3_PREFIX": "s3://b/mobile/", "TW_RELEASE_AWS_PROFILE": "p",
                         "TW_RELEASE_AWS_REGION": "r"})
        self.assertEqual((s3.bucket, s3.root), ("b", "mobile/release-backups/"))
        self.assertEqual(tool.AwsS3({"TW_RELEASE_S3_PREFIX": "s3://b", "TW_RELEASE_AWS_PROFILE": "p",
                                     "TW_RELEASE_AWS_REGION": "r"}).root, "release-backups/")


if __name__ == "__main__":
    unittest.main()
