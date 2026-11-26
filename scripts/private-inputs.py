#!/usr/bin/env python3
"""Back up and check private build inputs in the private release S3 backup.

Private inputs (ad unit IDs, server URLs, API keys, Firebase files) stay out of Git
in ~/.config/todayweather/. Every change to them gets a new snapshot under
<TW_RELEASE_S3_PREFIX>release-backups/<UTC>-<label>/ with RESTORE.md and manifest.json,
the layout of the existing release credential backups. See
docs/operations/private-inputs.md.

  private-inputs.py snapshot --label native-inputs [FILE ...]
  private-inputs.py verify --label native-inputs

The bucket, profile and region come from the release environment file
(TW_RELEASE_ENV, default client/.env). Nothing here prints a file's contents or an
AWS error message; failures name the operation and the AWS error code only.
Exit codes: 0 done or matching, 1 local files differ from the snapshot, 2 any other failure.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import stat
import tempfile
from pathlib import Path

CONFIG_ROOT = Path.home() / ".config" / "todayweather"
# Files a label must contain, relative to CONFIG_ROOT. release/tw-google-services.json is the
# Firebase file the native Android build takes as google-services.json.
REQUIRED = {
    "native-inputs": (
        "android/private.properties",
        "release/tw-google-services.json",
        "ios/Private.xcconfig",
        "ios/GoogleService-Info.plist",
    ),
}
RESERVED = {"manifest.json", "RESTORE.md", "COMPLETE"}
LABEL = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
RUN = re.compile(r"^(\d{8}T\d{6}Z)-(.+)$")
AWS_CODE = re.compile(r"An error occurred \(([A-Za-z0-9.]+)\)")
ENV_KEYS = ("TW_RELEASE_S3_PREFIX", "TW_RELEASE_AWS_PROFILE", "TW_RELEASE_AWS_REGION")


class Failure(Exception):
    def __init__(self, message: str, code: str | None = None):
        super().__init__(message)
        self.code = code


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

    def __init__(self, env: dict[str, str], run=subprocess.run):
        prefix = env["TW_RELEASE_S3_PREFIX"][len("s3://"):]
        self.bucket, _, key = prefix.partition("/")
        self.root = (key.rstrip("/") + "/" if key else "") + "release-backups/"
        self.options = ["--profile", env["TW_RELEASE_AWS_PROFILE"], "--region", env["TW_RELEASE_AWS_REGION"]]
        self.run = run

    def _aws(self, operation: str, args: list[str]) -> str:
        try:
            result = self.run(["aws", "s3api", operation, *args, *self.options], capture_output=True, text=True)
        except OSError as error:
            raise Failure(f"aws CLI could not start ({type(error).__name__})") from None
        if result.returncode != 0:
            # Only the error code: AWS messages can name principals and resources.
            match = AWS_CODE.search(result.stderr or "")
            code = match.group(1) if match else None
            raise Failure(f"aws s3api {operation} failed ({code or 'exit ' + str(result.returncode)})", code)
        return result.stdout

    def put_new(self, key: str, path: Path) -> None:
        # Conditional create: an existing object is never replaced.
        self._aws("put-object", ["--bucket", self.bucket, "--key", key, "--body", str(path),
                                 "--server-side-encryption", "AES256", "--if-none-match", "*", "--output", "json"])

    def get(self, key: str, path: Path) -> None:
        self._aws("get-object", ["--bucket", self.bucket, "--key", key, str(path), "--output", "json"])

    def runs(self) -> list[str]:
        out = self._aws("list-objects-v2", ["--bucket", self.bucket, "--prefix", self.root, "--delimiter", "/",
                                            "--query", "CommonPrefixes[].Prefix", "--output", "json"])
        try:
            prefixes = json.loads(out or "null") or []
        except json.JSONDecodeError:
            prefixes = None
        if not isinstance(prefixes, list):
            raise Failure("aws s3api list-objects-v2 returned unreadable output")
        return [p[len(self.root):].rstrip("/") for p in prefixes if isinstance(p, str) and p.startswith(self.root)]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def display(path: Path) -> str:
    home = str(Path.home())
    text = str(path)
    return "~" + text[len(home):] if text.startswith(home + os.sep) else text


def relative_name(name: str) -> str:
    """A path under CONFIG_ROOT as 'a/b/c'; absolute paths must lie under it lexically."""
    if "\0" in name:
        raise Failure("a file name contains a NUL character")
    if os.path.isabs(name):
        name = os.path.relpath(name, CONFIG_ROOT)
    parts = Path(name).parts
    if not parts or any(part in ("..", ".", "") for part in parts) or os.path.isabs(name):
        raise Failure(f"{name} is not under {display(CONFIG_ROOT)}")
    if parts[0] in RESERVED:
        raise Failure(f"{parts[0]} is a reserved snapshot name")
    return "/".join(parts)


def read_private(relative: str) -> bytes | None:
    """Read CONFIG_ROOT/relative without following any link: each directory is opened
    beneath the previous one with O_NOFOLLOW, so a path cannot leave the root between
    a check and the read. None when the file does not exist."""
    nofollow = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    parts = relative.split("/")
    fds = []
    try:
        try:
            fds.append(os.open(CONFIG_ROOT, nofollow | os.O_DIRECTORY))
            for part in parts[:-1]:
                fds.append(os.open(part, nofollow | os.O_DIRECTORY, dir_fd=fds[-1]))
            fd = os.open(parts[-1], nofollow, dir_fd=fds[-1])
        except FileNotFoundError:
            return None
        except OSError as error:
            # ELOOP / ENOTDIR: a link or a non-directory in the path.
            raise Failure(f"{display(CONFIG_ROOT / relative)} is a link or crosses one; use the real file") from None
        fds.append(fd)
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise Failure(f"{display(CONFIG_ROOT / relative)} is not a regular file")
        with os.fdopen(os.dup(fd), "rb") as handle:
            return handle.read()
    finally:
        for fd in fds:
            os.close(fd)


def resolve_files(label: str, files: list[str]) -> list[str]:
    """Object names (relative to CONFIG_ROOT) for a snapshot of the label; required files first."""
    names = []
    for name in (*REQUIRED.get(label, ()), *files):
        relative = relative_name(name)
        if relative not in names:
            names.append(relative)
    if not names:
        raise Failure(f"no default files for label {label!r}; name the files")
    return names


def restore_text(bucket: str, prefix: str, profile: str, run_id: str, files: list[dict]) -> str:
    lines = "\n".join(f"   - `{f['object_relative']}` -> `{f['restore_local_at_capture']}`" for f in files)
    source = shlex.quote(f"s3://{bucket}/{prefix}")
    return f"""# TodayWeather private inputs ({run_id})

Recovery material only, not release approval. Never publish these files or their
values in Git, issues, pull requests or logs.

1. Authenticate with the AWS profile {shlex.quote(profile)}.
2. Download this prefix into a private folder (umask 077):
   `aws s3 cp {source} ./tw-private-inputs/ --recursive --only-show-errors --profile {shlex.quote(profile)}`
3. Check every SHA256 against manifest.json before use.
4. Copy each file to its place; directories 0700, files 0600:
{lines}
5. A newer complete snapshot with the same label supersedes this one
   (`scripts/private-inputs.py verify --label <label>` compares against the newest).

Objects use server-side encryption (AES256) and conditional creation (no overwrite).
COMPLETE (the manifest's SHA-256) is written last; a run without it is incomplete.
"""


def publish(s3, prefix: str, name: str, path: Path, work: Path) -> None:
    """Upload one object and read it back; a mismatch leaves the run incomplete."""
    s3.put_new(prefix + name, path)
    copy = work / "readback"
    s3.get(prefix + name, copy)
    same = copy.read_bytes() == path.read_bytes()
    copy.unlink()
    if not same:
        raise Failure(f"read-back of {name} differs from the uploaded file; the run stays incomplete")


def snapshot(s3, env: dict[str, str], label: str, files: list[str], now: dt.datetime) -> str:
    names = resolve_files(label, files)
    run_id = f"{now.strftime('%Y%m%dT%H%M%SZ')}-{label}"
    prefix = f"{s3.root}{run_id}/"
    old_umask = os.umask(0o077)
    try:
        with tempfile.TemporaryDirectory() as work:
            work = Path(work)
            entries, staged = [], []
            # Read each input once: the bytes hashed are the bytes uploaded and checked.
            for index, name in enumerate(names):
                data = read_private(name)
                if data is None:
                    raise Failure(f"missing private input: {display(CONFIG_ROOT / name)}")
                copy = work / f"input-{index}"
                copy.write_bytes(data)
                staged.append((name, copy))
                local = display(CONFIG_ROOT / name)
                entries.append({"source_local": local, "object_relative": name, "restore_local_at_capture": local,
                                "bytes": len(data), "sha256": sha256_bytes(data)})
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
            (work / "RESTORE.md").write_text(restore_text(s3.bucket, prefix, env["TW_RELEASE_AWS_PROFILE"], run_id, entries))
            (work / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
            # Payload, RESTORE.md and manifest.json, each read back; only then COMPLETE, which
            # holds the manifest's SHA-256. A run without a matching COMPLETE is incomplete.
            manifest_bytes = (work / "manifest.json").read_bytes()
            (work / "COMPLETE").write_text(sha256_bytes(manifest_bytes) + "\n")
            for name, path in [*staged, ("RESTORE.md", work / "RESTORE.md"), ("manifest.json", work / "manifest.json"),
                               ("COMPLETE", work / "COMPLETE")]:
                publish(s3, prefix, name, path, work)
    finally:
        os.umask(old_umask)
    return run_id


def read_manifest(data: bytes, label: str) -> dict:
    try:
        manifest = json.loads(data.decode("utf-8"))
        files = manifest["files"]
        if not isinstance(files, list) or not files:
            raise ValueError
        for entry in files:
            if not (isinstance(entry.get("restore_local_at_capture"), str) and isinstance(entry.get("sha256"), str)):
                raise ValueError
    except (ValueError, KeyError, TypeError, AttributeError, UnicodeDecodeError):
        raise Failure(f"the newest {label!r} snapshot has an unreadable manifest.json") from None
    return manifest


def newest_manifest(s3, label: str, work: Path) -> tuple[str, dict] | None:
    """The newest complete run of the label: COMPLETE exists and holds the manifest's hash."""
    runs = sorted((r for r in s3.runs() if (m := RUN.match(r)) and m.group(2) == label), reverse=True)
    for run_id in runs:
        marker, target = work / f"{run_id}.complete", work / f"{run_id}.json"
        try:
            s3.get(f"{s3.root}{run_id}/COMPLETE", marker)
            s3.get(f"{s3.root}{run_id}/manifest.json", target)
        except Failure as error:
            if error.code == "NoSuchKey":
                continue  # incomplete run
            raise
        data = target.read_bytes()
        if marker.read_bytes().strip() != sha256_bytes(data).encode():
            continue  # the manifest is not the one the run completed with
        return run_id, read_manifest(data, label)
    return None


def local_name(capture_path: str, run_id: str) -> str:
    root = display(CONFIG_ROOT).rstrip("/") + "/"
    if not capture_path.startswith(root):
        raise Failure(f"snapshot {run_id} lists a path outside {display(CONFIG_ROOT)}")
    try:
        return relative_name(capture_path[len(root):])
    except Failure:
        raise Failure(f"snapshot {run_id} lists a path outside {display(CONFIG_ROOT)}") from None


def verify(s3, label: str) -> tuple[str, list[str]]:
    with tempfile.TemporaryDirectory() as work:
        found = newest_manifest(s3, label, Path(work))
    if found is None:
        raise Failure(f"no complete snapshot labelled {label!r}; run: private-inputs.py snapshot --label {label}")
    run_id, manifest = found
    problems = []
    listed = set()
    for entry in manifest["files"]:
        name = entry["restore_local_at_capture"]
        relative = local_name(name, run_id)
        listed.add(relative)
        data = read_private(relative)
        if data is None:
            problems.append(f"{name}: missing locally")
        elif sha256_bytes(data) != entry["sha256"]:
            problems.append(f"{name}: differs from the snapshot")
    for required in REQUIRED.get(label, ()):
        if required not in listed:
            problems.append(f"{display(CONFIG_ROOT / required)}: not in snapshot {run_id}")
    return run_id, problems


def main(argv: list[str] | None = None, s3_factory=AwsS3, now=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--env", default=os.environ.get("TW_RELEASE_ENV", "client/.env"),
                        help="release environment file with TW_RELEASE_S3_PREFIX, _AWS_PROFILE, _AWS_REGION")
    sub = parser.add_subparsers(dest="command", required=True)
    take = sub.add_parser("snapshot", help="store a new snapshot of the private inputs")
    take.add_argument("--label", required=True)
    take.add_argument("files", nargs="*", help=f"paths under {display(CONFIG_ROOT)}; a label's required files are always included")
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
    except (OSError, ValueError, UnicodeError) as error:
        print(f"private-inputs: unreadable input ({type(error).__name__})", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
