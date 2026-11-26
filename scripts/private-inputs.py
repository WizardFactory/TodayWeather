#!/usr/bin/env python3
"""Back up and check private build inputs in the private release S3 backup.

Private inputs (ad unit IDs, server URLs, API keys, Firebase files) stay out of Git
in ~/.config/todayweather/. Every change to them gets a new snapshot under
<TW_RELEASE_S3_PREFIX>release-backups/<UTC>-<label>/ with manifest.json and RESTORE.md,
the layout of the existing release credential backups. See
docs/operations/private-inputs.md.

  private-inputs.py snapshot --label native-inputs [FILE ...]
  private-inputs.py verify --label native-inputs

The bucket, profile and region come from the release environment file
(TW_RELEASE_ENV, default client/.env). Nothing here prints a file's contents.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

CONFIG_ROOT = Path.home() / ".config" / "todayweather"
NATIVE_INPUTS = (
    "android/private.properties",
    "ios/Private.xcconfig",
    "ios/GoogleService-Info.plist",
)
DEFAULT_FILES = {"native-inputs": NATIVE_INPUTS}
LABEL = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
RUN = re.compile(r"^(\d{8}T\d{6}Z)-(.+)$")
ENV_KEYS = ("TW_RELEASE_S3_PREFIX", "TW_RELEASE_AWS_PROFILE", "TW_RELEASE_AWS_REGION")


class Failure(Exception):
    pass


def load_env(path: Path) -> dict[str, str]:
    if not path.is_file():
        raise Failure(f"release environment file not found: {path} (set TW_RELEASE_ENV)")
    values = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("'\"")
    missing = [key for key in ENV_KEYS if not values.get(key)]
    if missing:
        raise Failure(f"{path} lacks {', '.join(missing)}")
    if not values["TW_RELEASE_S3_PREFIX"].startswith("s3://"):
        raise Failure("TW_RELEASE_S3_PREFIX must start with s3://")
    return values


class AwsS3:
    """The aws CLI calls this tool needs. Tests replace it with a double."""

    def __init__(self, env: dict[str, str]):
        prefix = env["TW_RELEASE_S3_PREFIX"][len("s3://"):]
        self.bucket, _, key = prefix.partition("/")
        self.root = (key.rstrip("/") + "/" if key else "") + "release-backups/"
        self.options = ["--profile", env["TW_RELEASE_AWS_PROFILE"], "--region", env["TW_RELEASE_AWS_REGION"]]

    def _run(self, args: list[str]) -> str:
        result = subprocess.run(["aws", *args, *self.options], capture_output=True, text=True)
        if result.returncode != 0:
            raise Failure(f"aws {args[0]} {args[1]} failed: {result.stderr.strip().splitlines()[-1:]}")
        return result.stdout

    def put_new(self, key: str, path: Path) -> None:
        # Conditional create: an existing object is never replaced.
        self._run(["s3api", "put-object", "--bucket", self.bucket, "--key", key, "--body", str(path),
                   "--server-side-encryption", "AES256", "--if-none-match", "*", "--output", "json"])

    def get(self, key: str, path: Path) -> None:
        self._run(["s3api", "get-object", "--bucket", self.bucket, "--key", key, str(path), "--output", "json"])

    def runs(self) -> list[str]:
        out = self._run(["s3api", "list-objects-v2", "--bucket", self.bucket, "--prefix", self.root,
                         "--delimiter", "/", "--query", "CommonPrefixes[].Prefix", "--output", "json"])
        prefixes = json.loads(out or "null") or []
        return [p[len(self.root):].rstrip("/") for p in prefixes]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def display(path: Path) -> str:
    home = str(Path.home())
    text = str(path)
    return "~" + text[len(home):] if text.startswith(home + os.sep) else text


def object_name(path: Path) -> str:
    try:
        return path.relative_to(CONFIG_ROOT).as_posix()
    except ValueError:
        raise Failure(f"{display(path)} is not under {display(CONFIG_ROOT)}") from None


def resolve_files(label: str, files: list[str]) -> list[Path]:
    names = files or DEFAULT_FILES.get(label)
    if not names:
        raise Failure(f"no default files for label {label!r}; name the files")
    paths = [(CONFIG_ROOT / name if not os.path.isabs(name) else Path(name)) for name in names]
    missing = [display(p) for p in paths if not p.is_file()]
    if missing:
        raise Failure("missing private input: " + ", ".join(missing))
    return paths


def restore_text(bucket: str, prefix: str, profile: str, run_id: str, files: list[dict]) -> str:
    lines = "\n".join(f"   - `{f['object_relative']}` -> `{f['restore_local_at_capture']}`" for f in files)
    return f"""# TodayWeather private inputs ({run_id})

Recovery material only, not release approval. Never publish these files or their
values in Git, issues, pull requests or logs.

1. Authenticate with the AWS profile `{profile}`.
2. Download this prefix into a private folder (umask 077):
   `aws s3 cp s3://{bucket}/{prefix} ./tw-private-inputs/ --recursive --only-show-errors --profile {profile}`
3. Check every SHA256 against manifest.json before use.
4. Copy each file to its place; directories 0700, files 0600:
{lines}
5. A newer snapshot with the same label supersedes this one
   (`scripts/private-inputs.py verify --label <label>` compares against the newest).

Objects use server-side encryption (AES256) and conditional creation (no overwrite).
"""


def snapshot(s3, env: dict[str, str], label: str, files: list[str], now: dt.datetime) -> str:
    paths = resolve_files(label, files)
    run_id = f"{now.strftime('%Y%m%dT%H%M%SZ')}-{label}"
    prefix = f"{s3.root}{run_id}/"
    entries = []
    for path in paths:
        data = path.read_bytes()
        entries.append({
            "source_local": display(path),
            "object_relative": object_name(path),
            "restore_local_at_capture": display(path),
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        })
    manifest = {
        "schema_version": 1,
        "purpose": f"Private build inputs ({label}). Recovery material, not release approval.",
        "created_utc": run_id.split("-", 1)[0],
        "run_id": run_id,
        "bucket": s3.bucket,
        "prefix": prefix,
        "aws_profile": env["TW_RELEASE_AWS_PROFILE"],
        "region": env["TW_RELEASE_AWS_REGION"],
        "files": entries,
        "not_included": ["AWS credentials", "signing keys and store keys (separate release backups)"],
    }
    with tempfile.TemporaryDirectory() as work:
        work = Path(work)
        os.chmod(work, 0o700)
        (work / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        (work / "RESTORE.md").write_text(restore_text(s3.bucket, prefix, env["TW_RELEASE_AWS_PROFILE"], run_id, entries))
        payload = [(entry["object_relative"], path) for entry, path in zip(entries, paths)]
        records = [("RESTORE.md", work / "RESTORE.md"), ("manifest.json", work / "manifest.json")]
        # Payload first, read back, then the records; manifest.json last. A run without a
        # manifest is incomplete and verify skips it.
        for group in (payload, records):
            for name, path in group:
                s3.put_new(prefix + name, path)
            for name, path in group:
                copy = work / "readback"
                s3.get(prefix + name, copy)
                if sha256(copy) != sha256(path):
                    raise Failure(f"read-back of {name} differs from the uploaded file; the run stays incomplete")
                copy.unlink()
    return run_id


def newest_manifest(s3, label: str, work: Path) -> tuple[str, dict] | None:
    """The newest complete run of the label: one whose manifest.json exists."""
    runs = sorted((r for r in s3.runs() if (m := RUN.match(r)) and m.group(2) == label), reverse=True)
    for run_id in runs:
        target = work / f"{run_id}.json"
        try:
            s3.get(f"{s3.root}{run_id}/manifest.json", target)
        except Failure as error:
            if "NoSuchKey" in str(error):
                continue  # incomplete run
            raise
        return run_id, json.loads(target.read_text())
    return None


def verify(s3, label: str) -> tuple[str, list[str]]:
    with tempfile.TemporaryDirectory() as work:
        found = newest_manifest(s3, label, Path(work))
    if found is None:
        raise Failure(f"no snapshot labelled {label!r}; run: private-inputs.py snapshot --label {label}")
    run_id, manifest = found
    problems = []
    for entry in manifest.get("files", []):
        local = Path(os.path.expanduser(entry["restore_local_at_capture"]))
        if not local.is_file():
            problems.append(f"{entry['restore_local_at_capture']}: missing locally")
        elif sha256(local) != entry["sha256"]:
            problems.append(f"{entry['restore_local_at_capture']}: differs from the snapshot")
    if not manifest.get("files"):
        problems.append("the snapshot lists no files")
    return run_id, problems


def main(argv: list[str] | None = None, s3_factory=AwsS3, now=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--env", default=os.environ.get("TW_RELEASE_ENV", "client/.env"),
                        help="release environment file with TW_RELEASE_S3_PREFIX, _AWS_PROFILE, _AWS_REGION")
    sub = parser.add_subparsers(dest="command", required=True)
    take = sub.add_parser("snapshot", help="store a new snapshot of the private inputs")
    take.add_argument("--label", required=True)
    take.add_argument("files", nargs="*", help=f"paths under {display(CONFIG_ROOT)} (default for native-inputs: {', '.join(NATIVE_INPUTS)})")
    check = sub.add_parser("verify", help="compare local private inputs with the newest snapshot")
    check.add_argument("--label", required=True)
    args = parser.parse_args(argv)
    try:
        if not LABEL.match(args.label):
            raise Failure("label: lowercase letters, digits and '-' only")
        env = load_env(Path(args.env).expanduser())
        s3 = s3_factory(env)
        if args.command == "snapshot":
            run_id = snapshot(s3, env, args.label, args.files, now or dt.datetime.now(dt.timezone.utc))
            print(f"snapshot {run_id}: stored and read back")
            return 0
        run_id, problems = verify(s3, args.label)
        if problems:
            print(f"private inputs do not match snapshot {run_id}:", *problems, sep="\n  ", file=sys.stderr)
            print(f"If the local change is intended: private-inputs.py snapshot --label {args.label}", file=sys.stderr)
            return 1
        print(f"private inputs match snapshot {run_id}")
        return 0
    except Failure as error:
        print(f"private-inputs: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
