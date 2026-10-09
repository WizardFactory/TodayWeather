#!/usr/bin/env python3
"""Bounded S09 operator. Dry plan is default; no AWS call at import or validation."""
import argparse
import base64
import contextlib
import datetime
import fcntl
import hashlib
import gzip
import json
import os
from pathlib import Path
import re
import secrets
import selectors
import stat
import subprocess
import tempfile
import threading
import time

HERE = Path(__file__).resolve().parent
GiB = 1024 ** 3
MiB = 1024 ** 2
EXPIRY = 1791607799000
EXPORT_CLEANUP_RESERVE_MS = 15 * 60000
MINIMUM_WORKER_WINDOW_MS = 5 * 60000
COMPLETION_GRACE_SECONDS = 30
MAXIMUM_WORKER_WINDOW_MS = (3600 - COMPLETION_GRACE_SECONDS) * 1000
FIXED = {
    "schema": 1, "run_id": "s09-20261008-approval044959", "account": "141248341265",
    "region": "ap-northeast-2", "bucket": "server2-s09-141248341265-apne2-20261008",
    "role": "server2-s09-benchmark-20261008", "security_group": "server2-s09-benchmark-20261008",
    "profile": "141248341265", "ami": "ami-0e677ebf2c8434c2a", "subnet": "subnet-3705246b",
    "vpc": "vpc-a54cb0cc", "instance_type": "c6i.large", "max_instances": 1, "root_gib": 16,
    "host_seconds": 7200, "benchmark_seconds": 3600, "approval_expires_at_ms": EXPIRY,
    "read_attempts": 10000, "write_attempts": 2000, "download_bytes": GiB,
    "bootstrap_download_bytes": 3 * GiB, "host_metadata_download_bytes": 512 * MiB,
    "stored_version_charge_bytes": MiB, "storage_overhead_bytes": 16384, "usd_operator_stop": 5,
}
PIN_FIELDS = {"source_revision", "source_map_sha256", "lock_sha256", "requested_config_sha256",
              "native_review_receipt_sha256", "review_candidate_sha256", "rustup_sha256", "rustup_url", "bucket_policy_sha256",
              "instance_policy_sha256", "bootstrap_sha256", "source_files"}

class OperatorError(Exception):
    """Sanitized terminal operator error; never stores subprocess stderr/credentials."""


class LocalCliParsingRejected(OperatorError):
    """Newly observed AWS CLI exit 252 with its exact local unknown-options marker.

    This type is not retrospective proof about a previously unknown invocation.
    """


class LaunchIdempotencyMismatch(OperatorError):
    """Observed EC2 rejection: no replacement token or automatic relaunch."""


def now_ms():
    return int(time.time() * 1000)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def bounded_json(path, maximum=65536):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > maximum:
        raise OperatorError("invalid input file")
    try:
        def pairs(items):
            result = {}
            for key, value in items:
                if key in result:
                    raise OperatorError("duplicate JSON field")
                result[key] = value
            return result
        return json.loads(path.read_bytes(), object_pairs_hook=pairs)
    except (ValueError, OSError) as exc:
        raise OperatorError("invalid JSON") from None


def validate_config(config, armed=False, now_ms=None, cleanup_only=False):
    if not isinstance(config, dict) or set(config) != set(FIXED) | PIN_FIELDS:
        raise OperatorError("configuration schema")
    for key, expected in FIXED.items():
        if type(config[key]) is not type(expected) or config[key] != expected:
            raise OperatorError("configuration scope")
    current = globals()["now_ms"]() if now_ms is None else now_ms
    if current >= EXPIRY and not cleanup_only:
        raise OperatorError("approval expired")
    if not armed:
        return config
    for key in PIN_FIELDS - {"source_files", "rustup_url", "source_revision"}:
        if not isinstance(config[key], str) or not re.fullmatch("[a-f0-9]{64}", config[key]):
            raise OperatorError("unreviewed configuration pin")
    if not isinstance(config["source_revision"], str) or not re.fullmatch("[a-f0-9]{40}", config["source_revision"]):
        raise OperatorError("source revision pin")
    if config["rustup_url"] != "https://static.rust-lang.org/rustup/archive/1.29.1/x86_64-unknown-linux-gnu/rustup-init":
        raise OperatorError("installer endpoint")
    files = config["source_files"]
    if not isinstance(files, dict) or not files or len(files) > 128:
        raise OperatorError("source file map")
    for path, value in files.items():
        if not path.startswith(("server2/", "docs/", "intent/", "specs/", "plans/")) or not re.fullmatch(r"[A-Za-z0-9_./-]+", path) or ".." in path.split("/") or not re.fullmatch("[a-f0-9]{64}", value):
            raise OperatorError("source map boundary")
    if len(files)!=33: raise OperatorError("source map requires exact33declaredpaths")
    if digest(canonical(files)) != config["source_map_sha256"]:
        raise OperatorError("source map digest")
    for file, key in [("bucket-policy.json", "bucket_policy_sha256"), ("instance-policy.json", "instance_policy_sha256"), ("cloud-init.yml", "bootstrap_sha256")]:
        if digest((HERE / file).read_bytes()) != config[key]:
            raise OperatorError("policy/bootstrap pin")
    for path,sha in files.items():
        candidate=HERE.parents[2]/path
        if not candidate.is_file() or candidate.is_symlink() or digest(candidate.read_bytes())!=sha: raise OperatorError("reviewed local source bytes")
    if digest((HERE.parents[1]/"Cargo.lock").read_bytes())!=config["lock_sha256"]: raise OperatorError("lock pin")
    cfg=bounded_json(HERE.parents[1]/"config/benchmarks/aws.json")
    cfg.update(execution_enabled=True,source_revision=config["source_revision"],source_map_sha256=config["source_map_sha256"],lock_sha256=config["lock_sha256"],review_candidate_sha256=config["review_candidate_sha256"])
    if digest(canonical(cfg))!=config["requested_config_sha256"]: raise OperatorError("requested runtime config bytes")
    return config


def validate_worker_accounting(report):
    """Live-only aggregate report validation; local seam never claims IMDS evidence."""
    if not isinstance(report,dict): raise OperatorError("result accounting schema")
    accounting=report.get("S3_accounting")
    if not isinstance(accounting,dict) or not isinstance(accounting.get("used"),dict): raise OperatorError("result S3 accounting schema")
    used=accounting["used"]
    for field,cap in [("read_attempts",390000),("write_attempts",18000),("download_reserved_bytes",26*GiB),("stored_version_charge_bytes",63*MiB)]:
        value=used.get(field)
        if type(value) is not int or not 0<=value<=cap: raise OperatorError("result accounting unknown or exceeded")
    metadata=report.get("metadata_accounting")
    if not isinstance(metadata,dict) or type(metadata.get("limit_bytes")) is not int or metadata["limit_bytes"]!=512*MiB or not isinstance(metadata.get("used"),dict): raise OperatorError("result metadata accounting schema/subgrant")
    metadata_used=metadata["used"]
    for field,cap in [("admitted_requests",1024),("reserved_bytes",512*MiB),("observed_body_bytes",512*MiB),("unknown_calls",0)]:
        value=metadata_used.get(field)
        if type(value) is not int or not 0<=value<=cap: raise OperatorError("result metadata accounting unknown or exceeded")
    if metadata_used["observed_body_bytes"]>metadata_used["reserved_bytes"]: raise OperatorError("result metadata accounting inconsistent")
    if accounting.get("uncertainty_compliance_pass") is not True or report.get("overall_accounting_compliance_pass") is not True: raise OperatorError("result overall accounting not compliant")
    return True


class Ledger:
    def __init__(self, caps):
        if set(caps) != {"reads", "writes", "download", "store"} or any(type(v) is not int or v < 0 for v in caps.values()):
            raise OperatorError("ledger caps")
        self.caps = dict(caps)
        self.used = {k: 0 for k in caps}
        self.lock = threading.Lock()

    def reserve(self, kind, response_bytes=0, put_bytes=None):
        if kind not in {"GET", "HEAD", "PUT", "LIST"} or type(response_bytes) is not int or not 0 <= response_bytes < 2**63:
            raise OperatorError("operation reservation")
        if put_bytes is not None and (kind != "PUT" or type(put_bytes) is not int or not 0 <= put_bytes < 2**63):
            raise OperatorError("version reservation")
        charge = {"reads": int(kind in {"GET", "HEAD"}), "writes": int(kind in {"PUT", "LIST"}),
                  "download": response_bytes, "store": 0 if put_bytes is None else put_bytes + 16384}
        with self.lock:
            result = {k: self.used[k] + charge[k] for k in charge}
            if any(v > self.caps[k] for k, v in result.items()):
                raise OperatorError("capacity exhausted before dispatch")
            self.used = result
            return dict(charge)


class State:
    """Exclusive initial publication; subsequent updates only in private owned directory."""
    def __init__(self, path, data):
        self.path, self.data = Path(path), data
        self.lock = threading.Lock()

    @classmethod
    def create(cls, path, data):
        path = Path(path)
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if path.parent.is_symlink() or path.parent.stat().st_uid != os.getuid():
            raise OperatorError("state directory ownership")
        fd, temporary = tempfile.mkstemp(prefix=".s09-state-", dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as out:
                out.write(canonical(data)); out.flush(); os.fsync(out.fileno())
            os.link(temporary, path, follow_symlinks=False)
        except OSError:
            raise OperatorError("state already exists or publication failed") from None
        finally:
            os.unlink(temporary)
        return cls(path, dict(data))

    def save(self):
        with self.lock:
            before = self.path.lstat()
            if not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid():
                raise OperatorError("state ownership changed")
            fd = os.open(str(self.path), os.O_RDONLY | os.O_NOFOLLOW)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX)
                if os.fstat(fd).st_ino != before.st_ino:
                    raise OperatorError("state identity changed")
                tmp_fd, tmp = tempfile.mkstemp(prefix=".s09-update-", dir=self.path.parent)
                try:
                    with os.fdopen(tmp_fd, "wb") as out:
                        out.write(canonical(self.data)); out.flush(); os.fsync(out.fileno())
                    if self.path.lstat().st_ino != before.st_ino:
                        raise OperatorError("state identity raced")
                    os.replace(tmp, self.path)
                finally:
                    if os.path.exists(tmp):
                        os.unlink(tmp)
            finally:
                os.close(fd)


def cli_console_text(result):
    """AWS CLI get-console-output already decodes the API's base64 Output."""
    if not isinstance(result, dict):
        raise OperatorError("console response schema")
    output = result.get("Output", "")
    if not isinstance(output, str):
        raise OperatorError("console output type")
    # Bound characters and UTF-8 bytes separately: a 64K-character EC2
    # console can exceed 64KiB after the CLI decodes multibyte text.
    # Keep the complete response; never truncate away failure/proof lines.
    # Never decode heuristically: encoded-looking text remains ordinary text.
    if len(output) > 65536:
        raise OperatorError("console output bound")
    try:
        length = len(output.encode("utf-8"))
    except UnicodeError:
        raise OperatorError("console output encoding") from None
    if length > 131072:
        raise OperatorError("console output bound")
    return output


def verify_guard(output, expected, now_ms=None):
    output = cli_console_text({"Output": output})
    if "S09_GUARD_FAILED" in output:
        raise OperatorError("stock guard failed")
    proofs = []
    for line in output.splitlines():
        if line.startswith("S09_GUARD_V1 "):
            try:
                proofs.append(json.loads(line[len("S09_GUARD_V1 "):]))
            except ValueError:
                raise OperatorError("invalid guard proof") from None
    if len(proofs) != 1:
        raise OperatorError("missing or conflicting guard proof")
    proof = proofs[0]
    if any(proof.get(k) != v for k, v in expected.items()):
        raise OperatorError("guard identity mismatch")
    if proof.get("status") != "guarded" or any(proof.get(k) is not True for k in ("timer_active", "nft_active", "ssm_present")):
        raise OperatorError("guard readiness")
    observed = proof.get("observed_before_guard_bytes")
    if type(observed) is not int or not 0 <= observed <= MiB:
        raise OperatorError("pre-guard traffic unknown or exceeded headroom")
    current = globals()["now_ms"]() if now_ms is None else now_ms
    if current >= proof["deadline_ms"]:
        raise OperatorError("guard expired")
    return proof


ALLOWED = {
    "sts": {"get-caller-identity"},
    "ec2": {"describe-instances", "describe-security-groups", "describe-images", "describe-subnets", "get-console-output", "create-security-group", "create-tags", "revoke-security-group-egress", "authorize-security-group-egress", "run-instances", "terminate-instances", "delete-security-group", "describe-volumes"},
    "iam": {"get-role", "get-instance-profile", "create-role", "put-role-policy", "create-instance-profile", "add-role-to-instance-profile", "remove-role-from-instance-profile", "delete-instance-profile", "delete-role-policy", "delete-role"},
    "s3api": {"head-bucket", "create-bucket", "put-bucket-versioning", "put-public-access-block", "put-bucket-encryption", "put-bucket-policy", "get-bucket-location", "get-bucket-versioning", "get-public-access-block", "get-bucket-encryption", "head-object", "put-object", "list-object-versions"},
    "ssm": {"describe-instance-information", "send-command", "get-command-invocation"},
}

class Cli:
    def __init__(self, config, executable="aws"):
        self.config, self.executable = config, executable
    def call(self, service, action, args, timeout=8):
        if service not in ALLOWED or action not in ALLOWED[service] or any(a.split("=",1)[0] in {"--debug","--endpoint-url","--no-verify-ssl","--no-sign-request"} for a in args):
            raise OperatorError("operator action not permitted")
        command = [self.executable, "--profile", self.config["profile"], "--region", self.config["region"], "--no-cli-pager", "--no-paginate", "--cli-connect-timeout", "1", "--cli-read-timeout", "4", "--cli-binary-format", "base64", service, action] + args + ["--output", "json"]
        env = dict(os.environ, AWS_PAGER="", AWS_MAX_ATTEMPTS="1", AWS_RETRY_MODE="standard", AWS_CLI_AUTO_PROMPT="off", AWS_IGNORE_CONFIGURED_ENDPOINT_URLS="true")
        for k in list(env):
            if k.startswith("AWS_ENDPOINT_URL") or k in {"AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY","AWS_SESSION_TOKEN"}: env.pop(k,None)
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, start_new_session=True)
        selector = selectors.DefaultSelector()
        for stream in (process.stdout, process.stderr):
            selector.register(stream, selectors.EVENT_READ)
        output, errors = bytearray(), bytearray()
        deadline = time.monotonic() + timeout
        try:
            while selector.get_map():
                if time.monotonic() >= deadline:
                    raise OperatorError("operator subprocess deadline")
                for key, _ in selector.select(.1):
                    chunk = os.read(key.fileobj.fileno(), 4096)
                    if not chunk:
                        selector.unregister(key.fileobj); continue
                    target = output if key.fileobj is process.stdout else errors
                    target.extend(chunk)
                    if len(output) + len(errors) > 131072:
                        raise OperatorError("operator output exceeded reservation")
            code = process.wait(timeout=1)
            if code:
                # Never emit raw AWS stderr; only expose whitelisted non-secret classifications.
                text = bytes(errors)
                if code == 252 and re.search(rb"(?m)^Unknown options: [^\r\n]+\r?$", text):
                    raise LocalCliParsingRejected("local CLI parsing rejected; request not dispatched")
                if re.search(rb"An error occurred \(IdempotentParameterMismatch\)",text):
                    raise LaunchIdempotencyMismatch("launch idempotency mismatch; no replacement token")
                for token in (b"NotFound", b"NoSuchEntity", b"InvalidGroup.NotFound", b"404", b"403", b"AccessDenied", b"PreconditionFailed", b"412", b"InvocationDoesNotExist"):
                    if token in text:
                        raise OperatorError("AWS status " + token.decode())
                raise OperatorError("AWS action failed; outcome unknown")
            try:
                return json.loads(output or b"{}")
            except ValueError:
                raise OperatorError("AWS output invalid; outcome unknown") from None
        finally:
            selector.close()
            if process.poll() is None:
                os.killpg(process.pid, 9); process.wait()
            process.stdout.close(); process.stderr.close()


class Operator:
    def __init__(self, config, state, runner, clock=now_ms):
        self.config, self.state, self.runner, self.clock = config, state, runner, clock
        self.floor = self.clock()
        watchdog_reads=state.data.get("watchdog_reserved_reads",50)
        if type(watchdog_reads) is not int or watchdog_reads not in {50,100}: raise OperatorError("watchdog reservation identity")
        self.ledger = Ledger({"reads": 10000-watchdog_reads, "writes": 2000, "download": 512 * MiB - watchdog_reads*131072, "store": MiB})
        if "ledger" in state.data:
            used=state.data["ledger"]
            if not isinstance(used,dict) or set(used)!=set(self.ledger.caps) or any(type(v) is not int or not 0<=v<=self.ledger.caps[k] for k,v in used.items()): raise OperatorError("preserved ledger invalid or exhausted")
            self.ledger.used = dict(used)
        self.calls = state.data.get("operator_calls", 0)
        if type(self.calls) is not int or not 0<=self.calls<=3500: raise OperatorError("preserved control-call count")

    def call(self, service, action, args, put_bytes=None, cleanup=False):
        current = self.clock()
        if current < self.floor or (not cleanup and current >= min(EXPIRY, self.state.data["deadline_ms"])):
            raise OperatorError("operator clock/deadline")
        self.floor = current
        if self.calls >= 3500:
            raise OperatorError("operator control-call cap")
        if service == "s3api":
            kind = "LIST" if action.startswith("list-") else "PUT" if action.startswith(("put-", "create-")) else "HEAD" if action.startswith("head-") else "GET"
            self.ledger.reserve(kind, response_bytes=131072, put_bytes=put_bytes)
        else:
            self.ledger.reserve("GET", response_bytes=131072)
        self.calls += 1
        self.state.data.update(ledger=dict(self.ledger.used), operator_calls=self.calls, last_intent={"service": service, "action": action})
        self.state.save()
        return self.runner.call(service, action, args)

    def own(self, key, value):
        self.state.data.setdefault("resources", {})[key] = value
        if key in self.state.data.get("creation_intents",{}): self.state.data["creation_intents"][key]="acknowledged"
        self.state.save()

    def absent(self, service, action, args):
        try:
            self.call(service, action, args)
        except OperatorError as exc:
            if str(exc) in {"AWS status NoSuchEntity", "AWS status NotFound", "AWS status 404"}:
                return
            raise
        raise OperatorError("existing name collision; no adoption")

    def provision(self):
        c, s = self.config, self.state.data
        identity = self.call("sts", "get-caller-identity", [])
        if identity.get("Account") != c["account"]:
            raise OperatorError("configured account mismatch")
        images=self.call("ec2","describe-images",["--image-ids",c["ami"]]).get("Images",[])
        if len(images)!=1 or any(images[0].get(k)!=v for k,v in {"ImageId":c["ami"],"OwnerId":"099720109477","Public":True,"State":"available","Architecture":"x86_64","RootDeviceName":"/dev/sda1","VirtualizationType":"hvm"}.items()): raise OperatorError("AMI identity changed")
        subnets=self.call("ec2","describe-subnets",["--subnet-ids",c["subnet"]]).get("Subnets",[])
        if len(subnets)!=1 or any(subnets[0].get(k)!=v for k,v in {"SubnetId":c["subnet"],"VpcId":c["vpc"],"State":"available","MapPublicIpOnLaunch":True}.items()): raise OperatorError("subnet identity changed")
        self.absent("s3api", "head-bucket", ["--bucket", c["bucket"]])
        self.absent("iam", "get-role", ["--role-name", c["role"]])
        self.absent("iam", "get-instance-profile", ["--instance-profile-name", c["role"]])
        groups = self.call("ec2", "describe-security-groups", ["--filters", "Name=group-name,Values=" + c["security_group"], "Name=vpc-id,Values=" + c["vpc"]])
        if groups.get("SecurityGroups"):
            raise OperatorError("existing SG collision")
        s["creation_intents"]={"bucket":"unknown"};self.state.save()
        self.call("s3api", "create-bucket", ["--bucket", c["bucket"], "--create-bucket-configuration", "LocationConstraint="+c["region"], "--object-ownership", "BucketOwnerEnforced"])
        self.own("bucket", c["bucket"])
        self.call("s3api", "put-public-access-block", ["--bucket", c["bucket"], "--public-access-block-configuration", "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"])
        self.call("s3api", "put-bucket-versioning", ["--bucket", c["bucket"], "--versioning-configuration", "Status=Enabled"])
        self.call("s3api", "put-bucket-encryption", ["--bucket", c["bucket"], "--server-side-encryption-configuration", json.dumps({"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]})])
        self.call("s3api", "put-bucket-policy", ["--bucket", c["bucket"], "--policy", (HERE / "bucket-policy.json").read_text()])
        s["creation_intents"]["sg"]="unknown";self.state.save()
        group = self.call("ec2", "create-security-group", ["--group-name", c["security_group"], "--description", "Owned S09 synthetic measurement", "--vpc-id", c["vpc"], "--tag-specifications", self.tags("security-group")])["GroupId"]
        if not re.fullmatch("sg-[a-f0-9]+", group):
            raise OperatorError("invalid new SG ID")
        self.own("sg", group)
        existing = self.call("ec2", "describe-security-groups", ["--group-ids", group])["SecurityGroups"][0]
        if existing.get("IpPermissions"):
            raise OperatorError("unexpected ingress")
        egress = existing.get("IpPermissionsEgress", [])
        if egress:
            self.call("ec2", "revoke-security-group-egress", ["--group-id", group, "--ip-permissions", json.dumps(egress)])
        guarded_group=self.call("ec2","describe-security-groups",["--group-ids",group]).get("SecurityGroups",[])
        if len(guarded_group)!=1 or guarded_group[0].get("IpPermissions") or guarded_group[0].get("IpPermissionsEgress"): raise OperatorError("initial owned SG must have zero ingress/egress")
        trust = {"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}
        s["creation_intents"]["role"]="unknown";self.state.save()
        role = self.call("iam", "create-role", ["--role-name", c["role"], "--assume-role-policy-document", json.dumps(trust), "--tags", json.dumps(self.tag_values())])["Role"]["Arn"]
        if role != "arn:aws:iam::"+c["account"]+":role/"+c["role"]:
            raise OperatorError("role scope")
        self.own("role", role)
        self.call("iam", "put-role-policy", ["--role-name", c["role"], "--policy-name", "S09SyntheticRuntime", "--policy-document", (HERE / "instance-policy.json").read_text()])
        s["creation_intents"]["profile"]="unknown";self.state.save()
        self.call("iam", "create-instance-profile", ["--instance-profile-name", c["role"], "--tags", json.dumps(self.tag_values())])
        self.own("profile", c["role"])
        self.call("iam", "add-role-to-instance-profile", ["--instance-profile-name", c["role"], "--role-name", c["role"]])
        # Read back the newly owned profile before the only permitted launch attempt.
        for attempt in range(10):
            profile=self.call("iam","get-instance-profile",["--instance-profile-name",c["role"]]).get("InstanceProfile",{})
            tags={t.get("Key"):t.get("Value") for t in profile.get("Tags",[])}
            if profile.get("Arn")!="arn:aws:iam::"+c["account"]+":instance-profile/"+c["role"] or tags.get("RunId")!=c["run_id"] or tags.get("Purpose")!="synthetic-benchmark-only": raise OperatorError("new profile ownership/readiness")
            roles=profile.get("Roles",[])
            if len(roles)==1 and roles[0].get("RoleName")==c["role"] and roles[0].get("Arn")==role: break
            if roles: raise OperatorError("new profile unexpected role")
            time.sleep(1)
        else: raise OperatorError("new profile role propagation not ready; zero launch attempts")
        userdata = self.render_bootstrap()
        return self.launch_once(group, userdata)

    def launch_arguments(self, group, userdata):
        """One source-bound argument builder, also used by the offline CLI oracle."""
        c,s=self.config,self.state.data
        if not re.fullmatch("sg-[a-f0-9]+",group) or not isinstance(userdata,bytes) or len(userdata)>16384:
            raise OperatorError("launch payload boundary")
        return ["--image-id", c["ami"], "--instance-type", "c6i.large", "--count", "1", "--client-token", s["client_token"], "--iam-instance-profile", "Name="+c["role"], "--instance-initiated-shutdown-behavior", "terminate", "--metadata-options", "HttpEndpoint=enabled,HttpTokens=required,HttpPutResponseHopLimit=1", "--network-interfaces", json.dumps([{"DeviceIndex":0,"SubnetId":c["subnet"],"AssociatePublicIpAddress":True,"Groups":[group],"DeleteOnTermination":True}]), "--block-device-mappings", json.dumps([{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":16,"VolumeType":"gp3","Iops":3000,"Throughput":125,"Encrypted":True,"DeleteOnTermination":True}}]), "--tag-specifications", self.tags("instance", "volume"), "--user-data", base64.b64encode(userdata).decode()]

    def launch_once(self, group, userdata):
        s=self.state.data
        recovery=s.get("recovery1")
        if recovery is not None:
            if recovery.get("dispatch_attempted") is not False: raise OperatorError("recovery dispatch already attempted")
            recovery["dispatch_attempted"]=True
        prior_unknown=s.get("launch_attempted",False)
        s["launch_attempted"]=True
        s["current_launch_outcome"]="unknown"
        self.state.save()
        try:
            instances=self.call("ec2","run-instances",self.launch_arguments(group,userdata))["Instances"]
        except LocalCliParsingRejected:
            # This observed invocation did not dispatch. It cannot clear the
            # predecessor's historical uncertainty or authorize another launch.
            s["current_launch_outcome"]="local_cli_rejected"
            if not prior_unknown: s["launch_attempted"]=False
            self.state.save()
            raise
        except LaunchIdempotencyMismatch:
            s["current_launch_outcome"]="idempotency_mismatch";self.state.save()
            raise
        except OperatorError:
            instances=self.token_instances()
        if len(instances)!=1 or not re.fullmatch("i-[a-f0-9]+",instances[0].get("InstanceId","")):
            raise OperatorError("launch outcome unresolved; no second host")
        self.own("instance",instances[0]["InstanceId"])
        s["current_launch_outcome"]="acknowledged_or_reconciled";self.state.save()
        return instances[0]["InstanceId"]

    def token_instances(self):
        response=self.call("ec2","describe-instances",["--filters","Name=client-token,Values="+self.state.data["client_token"]])
        reservations=response.get("Reservations")
        if not isinstance(reservations,list) or any(not isinstance(r,dict) or not isinstance(r.get("Instances"),list) for r in reservations):
            raise OperatorError("host inventory unknown")
        return [item for reservation in reservations for item in reservation["Instances"]]

    def prepare_recovery(self, original_config, authority):
        """One root-attested recovery of this failed pre-worker creation only.

        Authorization is an explicit operator input, not proof synthesized from
        local CLI diagnostics or a zero-result historical inventory.
        """
        s,c=self.state.data,self.config;current=self.clock()
        fields={"schema","scope","run_id","original_state_sha256","original_config_sha256","reviewed_config_sha256","source_revision","native_review_receipt_sha256","AK_retry_authorized","owned_absent_host_cleanup_authorized","retry_authority_sha256","original_operator_and_watchdog_quiescent","retry_ordinal","retry_started_at_ms","retry_deadline_ms"}
        if not isinstance(authority,dict) or set(authority)!=fields: raise OperatorError("recovery authority schema")
        expected={"schema":1,"scope":"resume-failed-creation-once","run_id":c["run_id"],"original_state_sha256":digest(canonical(s)),"original_config_sha256":digest(canonical(original_config)),"reviewed_config_sha256":digest(canonical(c)),"source_revision":c["source_revision"],"native_review_receipt_sha256":c["native_review_receipt_sha256"],"AK_retry_authorized":True,"owned_absent_host_cleanup_authorized":True,"original_operator_and_watchdog_quiescent":True,"retry_ordinal":1}
        if any(type(authority[k]) is not type(v) or authority[k]!=v for k,v in expected.items()) or not isinstance(authority["retry_authority_sha256"],str) or not re.fullmatch("[a-f0-9]{64}",authority["retry_authority_sha256"]):
            raise OperatorError("recovery authority binding")
        start,end=authority["retry_started_at_ms"],authority["retry_deadline_ms"]
        if type(start) is not int or type(end) is not int or not current-60000<=start<=current or not current+1200000<=end<=min(EXPIRY,start+7200000): raise OperatorError("recovery deadline")
        if any(c[k]!=original_config[k] for k in FIXED) or any(c[k]!=original_config[k] for k in ("bucket_policy_sha256","instance_policy_sha256","rustup_url","rustup_sha256")):
            raise OperatorError("recovery original resource/install scope")
        if s.get("run_id")!=c["run_id"] or s.get("config_sha256")!=authority["original_config_sha256"] or s.get("worker_allocation_issued") is not False or s.get("launch_attempted") is not True or "recovery1" in s:
            raise OperatorError("recovery predecessor/replay/worker fence")
        if not isinstance(s.get("client_token"),str) or not re.fullmatch("s09-[A-Za-z0-9-]{1,60}",s["client_token"]) or not isinstance(s.get("nonce"),str) or not re.fullmatch("[a-f0-9]{64}",s["nonce"]): raise OperatorError("recovery original identity")
        expected_resources={"bucket":c["bucket"],"role":"arn:aws:iam::"+c["account"]+":role/"+c["role"],"profile":c["role"]}
        resources=s.get("resources",{})
        if set(resources)!=set(expected_resources)|{"sg"} or any(resources[k]!=v for k,v in expected_resources.items()) or not re.fullmatch("sg-[a-f0-9]+",resources.get("sg","")) or s.get("creation_intents")!={k:"acknowledged" for k in resources}: raise OperatorError("recovery requires original acknowledged resources")
        if s.get("bootstrap_reserved_bytes")!=3*GiB or type(s.get("deadline_ms")) is not int or s.get("watchdog_reserved_reads")!=50 or s.get("watchdog_reserved_download_bytes")!=50*131072: raise OperatorError("recovery original reservations")
        caps={"reads":9900,"writes":2000,"download":512*MiB-100*131072,"store":MiB}
        if set(self.ledger.used)!=set(caps) or any(type(v) is not int or not 0<=v<=caps[k] for k,v in self.ledger.used.items()) or self.calls>=3500: raise OperatorError("recovery remaining aggregate budget")
        # Exclusive immutable predecessor and claim fence competing invocations.
        # A partial publication is a stop condition, never a retry opportunity.
        State.create(self.state.path.with_suffix(".recovery1.predecessor.json"),s)
        State.create(self.state.path.with_suffix(".recovery1.claim.json"),{"authority_sha256":digest(canonical(authority)),"original_state_sha256":authority["original_state_sha256"]})
        s["recovery1"]={"authority":dict(authority),"historical_launch_unknown":True,"entry_attempted":False,"dispatch_attempted":False,"original_deadline_ms":s["deadline_ms"],"original_config_sha256":s["config_sha256"]}
        s.update(config_sha256=digest(canonical(c)),deadline_ms=end,watchdog_reserved_reads=100,watchdog_reserved_download_bytes=100*131072,watchdog_parent=os.getpid(),status="recovery_creation")
        self.ledger.caps=caps;self.state.save()

    def resume_failed_creation(self):
        s,c=self.state.data,self.config
        if "recovery1" not in s or s["recovery1"].get("entry_attempted") is not False: raise OperatorError("recovery not prepared or already entered")
        s["recovery1"]["entry_attempted"]=True;self.state.save()
        if self.call("sts","get-caller-identity",[]).get("Account")!=c["account"]: raise OperatorError("configured account mismatch")
        token=self.token_instances()
        by_tag=self.call("ec2","describe-instances",["--filters","Name=tag:RunId,Values="+c["run_id"]]).get("Reservations")
        if not isinstance(by_tag,list) or any(not isinstance(r,dict) or not isinstance(r.get("Instances"),list) for r in by_tag): raise OperatorError("host inventory unknown")
        tagged_instances=[i for r in by_tag for i in r["Instances"]]
        ids=lambda rows:[r.get("InstanceId") for r in rows]
        if len(token)>1 or len(tagged_instances)>1 or ids(token)!=ids(tagged_instances): raise OperatorError("recovery host inventory ambiguous")
        if token:
            host=token[0];tags={t.get("Key"):t.get("Value") for t in host.get("Tags",[])}
            if not re.fullmatch("i-[a-f0-9]+",host.get("InstanceId","")) or host.get("ClientToken")!=s["client_token"] or tags.get("RunId")!=c["run_id"] or tags.get("Purpose")!="synthetic-benchmark-only": raise OperatorError("recovery existing host ownership")
            self.own("instance",host["InstanceId"])
            return {"status":"existing_owned_host_cleanup_required","instance_id":host["InstanceId"]}
        volumes=self.call("ec2","describe-volumes",["--filters","Name=tag:RunId,Values="+c["run_id"]]).get("Volumes")
        if volumes!=[]: raise OperatorError("recovery volume inventory not empty or unknown")
        images=self.call("ec2","describe-images",["--image-ids",c["ami"]]).get("Images",[])
        if len(images)!=1 or any(images[0].get(k)!=v for k,v in {"ImageId":c["ami"],"OwnerId":"099720109477","Public":True,"State":"available","Architecture":"x86_64","RootDeviceName":"/dev/sda1","VirtualizationType":"hvm"}.items()): raise OperatorError("AMI identity changed")
        subnets=self.call("ec2","describe-subnets",["--subnet-ids",c["subnet"]]).get("Subnets",[])
        if len(subnets)!=1 or any(subnets[0].get(k)!=v for k,v in {"SubnetId":c["subnet"],"VpcId":c["vpc"],"State":"available","MapPublicIpOnLaunch":True}.items()): raise OperatorError("subnet identity changed")
        group=s["resources"]["sg"]
        groups=self.call("ec2","describe-security-groups",["--group-ids",group]).get("SecurityGroups",[])
        if len(groups)!=1 or groups[0].get("GroupId")!=group or groups[0].get("VpcId")!=c["vpc"] or groups[0].get("GroupName")!=c["security_group"] or groups[0].get("IpPermissions")!=[] or groups[0].get("IpPermissionsEgress")!=[]: raise OperatorError("recovery owned SG closed identity")
        def owned(item):
            tags={t.get("Key"):t.get("Value") for t in item.get("Tags",[])}
            if tags.get("RunId")!=c["run_id"] or tags.get("Purpose")!="synthetic-benchmark-only": raise OperatorError("recovery resource ownership")
        owned(groups[0])
        role=self.call("iam","get-role",["--role-name",c["role"]]).get("Role",{})
        profile=self.call("iam","get-instance-profile",["--instance-profile-name",c["role"]]).get("InstanceProfile",{})
        owned(role);owned(profile)
        roles=profile.get("Roles",[])
        if role.get("Arn")!=s["resources"]["role"] or profile.get("Arn")!="arn:aws:iam::"+c["account"]+":instance-profile/"+c["role"] or len(roles)!=1 or roles[0].get("RoleName")!=c["role"] or roles[0].get("Arn")!=role.get("Arn"): raise OperatorError("recovery owned IAM identity/membership")
        if self.call("s3api","get-bucket-location",["--bucket",c["bucket"]]).get("LocationConstraint")!=c["region"] or self.call("s3api","get-bucket-versioning",["--bucket",c["bucket"]]).get("Status")!="Enabled": raise OperatorError("recovery bucket region/versioning")
        public=self.call("s3api","get-public-access-block",["--bucket",c["bucket"]]).get("PublicAccessBlockConfiguration",{})
        if public!={k:True for k in ("BlockPublicAcls","IgnorePublicAcls","BlockPublicPolicy","RestrictPublicBuckets")}: raise OperatorError("recovery bucket privacy")
        encryption=self.call("s3api","get-bucket-encryption",["--bucket",c["bucket"]]).get("ServerSideEncryptionConfiguration",{}).get("Rules",[])
        if not encryption or any(r.get("ApplyServerSideEncryptionByDefault",{}).get("SSEAlgorithm")!="AES256" for r in encryption): raise OperatorError("recovery bucket encryption")
        instance=self.launch_once(group,self.render_bootstrap())
        return {"status":"recovery_host_acknowledged","instance_id":instance}

    def tag_values(self):
        return [{"Key":k,"Value":v} for k,v in {"Task":"issue-2694-s09","Purpose":"synthetic-benchmark-only","RunId":self.config["run_id"],"ExpiresAt":str(self.state.data["deadline_ms"])}.items()]
    def tags(self, *types):
        return json.dumps([{"ResourceType":t,"Tags":self.tag_values()} for t in types])

    def render_bootstrap(self):
        values = {"RUN_ID":self.config["run_id"],"NONCE":self.state.data["nonce"],"SOURCE_REVISION":self.config["source_revision"],"DEADLINE_MS":str(self.state.data["deadline_ms"]),"DEADLINE_UTC":datetime.datetime.fromtimestamp(self.state.data["deadline_ms"]/1000,datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),"RUSTUP_SHA256":self.config["rustup_sha256"],"RUSTUP_URL":self.config["rustup_url"],"SOURCE_MAP_B64":base64.b64encode(canonical(self.config["source_files"])).decode()}
        text = (HERE / "cloud-init.yml").read_text()
        for k,v in values.items():
            text = text.replace("@@"+k+"@@", v)
        if "@@" in text or len(text.encode()) > 65536:
            raise OperatorError("bootstrap render bounds")
        # cloud-init accepts gzip user-data; deterministic compression keeps AWS's decoded blob <=16KiB.
        payload=gzip.compress(text.encode(),mtime=0)
        if len(payload)>16384: raise OperatorError("decoded EC2 user-data exceeds16KiB")
        self.state.data["user_data_plain_sha256"]=digest(text.encode())
        self.state.data["user_data_payload_sha256"]=digest(payload)
        self.state.save()
        return payload

    def open_https_after_guard(self, output):
        s, c = self.state.data, self.config
        proof = verify_guard(output, {"run_id":c["run_id"],"nonce":s["nonce"],"deadline_ms":s["deadline_ms"],"source_revision":c["source_revision"]}, now_ms=self.clock())
        self.call("ec2", "authorize-security-group-egress", ["--group-id", s["resources"]["sg"], "--ip-permissions", json.dumps([{"IpProtocol":"tcp","FromPort":443,"ToPort":443,"IpRanges":[{"CidrIp":"0.0.0.0/0"}]}])])
        s["guard_proof"] = proof; s["guard_proof_sha256"] = digest(canonical(proof)); self.state.save()
        return proof

    def ssm(self, commands, seconds=60, capture_terminal=False):
        instance=self.state.data["resources"]["instance"]
        sent=self.call("ssm","send-command",["--instance-ids",instance,"--document-name","AWS-RunShellScript","--timeout-seconds",str(max(30,min(seconds,3600))),"--parameters",json.dumps({"commands":commands,"executionTimeout":[str(min(seconds,3600))]})])
        command=sent["Command"]["CommandId"]
        if not re.fullmatch(r"[a-f0-9-]{36}",command): raise OperatorError("SSM command identity")
        deadline=min(self.clock()+seconds*1000,self.state.data["deadline_ms"],EXPIRY)
        while self.clock()<deadline:
            try: result=self.call("ssm","get-command-invocation",["--command-id",command,"--instance-id",instance])
            except OperatorError as error:
                if str(error)!="AWS status InvocationDoesNotExist": raise
                time.sleep(2); continue
            status=result.get("Status")
            if capture_terminal and status not in {"Pending","InProgress","Delayed"}:
                code=result.get("ResponseCode")
                return {"Status":status if isinstance(status,str) and status in {"Success","Failed","Cancelled","TimedOut","Cancelling"} else "Unknown","ResponseCode":code if type(code) is int else None}
            if status=="Success":
                output=result.get("StandardOutputContent","")
                if len(output.encode())>24000: raise OperatorError("SSM output incomplete/bound")
                return output
            if status not in {"Pending","InProgress","Delayed"}: raise OperatorError("SSM task failed")
            time.sleep(2)
        if capture_terminal: return {"Status":"ControllerDeadline","ResponseCode":None}
        raise OperatorError("SSM command deadline")

    def verify_ssm_agent(self, row):
        version=row.get("AgentVersion")
        if not isinstance(version,str) or not re.fullmatch(r"[0-9]{1,6}(?:\.[0-9]{1,6}){3}",version) or tuple(map(int,version.split("."))) < (3,3,40,0):
            raise OperatorError("stock SSM agent unsupported or unknown; no fallback")
        self.state.data["stock_SSM_agent_version"]=version
        self.state.save()

    def export_worker_file(self, remote, maximum):
        # Both queries are bounded SSM calls; never read a remote unbounded log.
        script="import pathlib,json;p=pathlib.Path("+repr(remote)+");print(json.dumps({'exists':p.is_file(),'size':p.stat().st_size if p.is_file() else 0}))"
        size=json.loads(self.ssm(["python3 -c "+json.dumps(script)],seconds=30))
        if size.get("exists") is False: return None
        count=size.get("size")
        if size.get("exists") is not True or type(count) is not int or not 0<=count<=maximum:
            raise OperatorError("worker artifact size bound")
        data=bytearray()
        for offset in range(0,count,12288):
            script="import pathlib,base64;p=pathlib.Path("+repr(remote)+");f=p.open('rb');f.seek("+str(offset)+");print(base64.b64encode(f.read(12288)).decode())"
            chunk=self.ssm(["python3 -c "+json.dumps(script)],seconds=30).strip()
            try: raw=base64.b64decode(chunk,validate=True)
            except ValueError: raise OperatorError("worker artifact encoding") from None
            if len(raw)!=min(12288,count-offset): raise OperatorError("worker artifact incomplete")
            data.extend(raw)
        return bytes(data)

    def export_worker_result(self, run_directory, manifest, terminal):
        self.state.data.update(worker_accounting_compliance=False,worker_terminal=terminal,worker_artifacts={})
        self.state.save()
        report_bytes=None
        for name,remote,maximum,suffix in [("result","result.json",2*MiB,".result.json"),("errors","result-errors.log",65536,".worker-errors.log")]:
            evidence={"status":"export_failed"}
            try:
                body=self.export_worker_file(run_directory+"/"+remote,maximum)
                if body is None: evidence={"status":"missing"}
                else:
                    path=self.state.path.with_suffix(suffix)
                    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                    with os.fdopen(fd,"wb") as out: out.write(body);out.flush();os.fsync(out.fileno())
                    evidence={"status":"exported","bytes":len(body),"sha256":digest(body)}
                    if name=="result":
                        report_bytes=body
                        self.state.data.update(worker_report_sha256=digest(body),result_sha256=digest(body))
            except (OperatorError,OSError,ValueError,TypeError,KeyError):
                # Do not expose remote content, credentials or arbitrary exception text.
                evidence={"status":"export_failed","reason":"bounded artifact export failed"}
            self.state.data["worker_artifacts"][name]=evidence
            self.state.save()
        if report_bytes is None: raise OperatorError("worker report missing or export failed; evidence preserved")
        try: report=json.loads(report_bytes)
        except ValueError: raise OperatorError("worker report invalid JSON; evidence preserved") from None
        if not isinstance(report,dict): raise OperatorError("worker report schema; evidence preserved")
        for field in ("run_id","allocation_id","source_revision","source_map_sha256","binary_sha256","lock_sha256","requested_config_sha256"):
            if report.get(field)!=manifest.get(field): raise OperatorError("result identity/hash mismatch; evidence preserved")
        validate_worker_accounting(report)
        if terminal.get("Status")!="Success" or terminal.get("ResponseCode")!=0 or report.get("run_status")=="ABORTED":
            raise OperatorError("worker did not complete successfully; evidence preserved")
        if self.state.data["worker_artifacts"]["errors"]["status"]!="exported": raise OperatorError("worker error evidence unavailable")
        self.state.data["worker_accounting_compliance"]=True
        self.state.save()
        return report

    def phase_guard(self, transition=False):
        # Stock-only script checks fresh kernel state; only the declared phase rule may change.
        script="""import subprocess,json,time,pathlib
run=json.loads(subprocess.check_output(['nft','-j','list','table','inet','server2_s09']))
quotas={x['quota']['name']:x['quota'] for x in run['nftables'] if 'quota' in x}
assert quotas['global_rx']['bytes']==30064771072 and quotas['global_rx']['used']<30064771072
subprocess.run(['systemctl','is-active','--quiet','server2-s09-expiry.timer'],check=True)
subprocess.run(['systemctl','is-active','--quiet','server2-s09-meter.service'],check=True)
"""
        if transition:
            script+=r"""assert 'benchmark_rx' not in quotas and quotas['bootstrap_rx']['used']<2147483648
rules=[x['rule'] for x in run['nftables'] if 'rule' in x and x['rule'].get('comment')=='bootstrap_phase']
assert len(rules)==1 and type(rules[0]['handle']) is int
transaction='add quota inet server2_s09 benchmark_rx { over 25769803776 bytes; }\nadd rule inet server2_s09 input_guard iifname != "lo" quota name "benchmark_rx" drop comment "benchmark_phase"\ndelete rule inet server2_s09 input_guard handle '+str(rules[0]['handle'])+'\n'
subprocess.run(['nft','-c','-f','-'],input=transaction.encode(),check=True)
subprocess.run(['nft','-f','-'],input=transaction.encode(),check=True)
"""
        script+="""after=json.loads(subprocess.check_output(['nft','-j','list','table','inet','server2_s09']))
q={x['quota']['name']:x['quota'] for x in after['nftables'] if 'quota' in x}
assert q['global_rx']['used']>=quotas['global_rx']['used']
assert q['global_rx']['used']<q['global_rx']['bytes']
if 'benchmark_rx' in q: assert q['benchmark_rx']['bytes']==25769803776 and q['benchmark_rx']['used']<25769803776
rx=sum(int(p.read_text()) for p in pathlib.Path('/sys/class/net').glob('*/statistics/rx_bytes') if p.parts[-3]!='lo')
assert rx<30064771072
print(json.dumps({'status':'guarded','observed_at_ms':int(time.time()*1000),'host_rx_bytes':rx,'quotas':q}))
"""
        output=self.ssm(["python3 - <<'PY'\n"+script+"PY"],seconds=30)
        try: proof=json.loads(output)
        except ValueError: raise OperatorError("guard readback JSON") from None
        if proof.get("status")!="guarded" or type(proof.get("observed_at_ms")) is not int or abs(self.clock()-proof["observed_at_ms"])>30000:
            raise OperatorError("guard readback stale")
        self.state.data.setdefault("guard_readbacks",[]).append(proof)
        self.state.data["guard_proof_sha256"]=digest(canonical(proof));self.state.save()
        return proof

    def inventory_versions(self):
        key_marker,version_marker=None,None;seen=set();total=0;versions=0
        while True:
            args=["--bucket",self.config["bucket"],"--max-keys","32"]
            if key_marker is not None: args += ["--key-marker",key_marker,"--version-id-marker",version_marker]
            page=self.call("s3api","list-object-versions",args)
            if page.get("DeleteMarkers"): raise OperatorError("unexpected S3 delete markers")
            for item in page.get("Versions",[]):
                size=item.get("Size")
                if type(size) is not int or size<0: raise OperatorError("invalid version inventory")
                total+=size+16384;versions+=1
                if total>64*MiB: raise OperatorError("observed version bound exceeded")
            if page.get("IsTruncated") is False: break
            if page.get("IsTruncated") is not True: raise OperatorError("version inventory completeness unknown")
            key_marker,version_marker=page.get("NextKeyMarker"),page.get("NextVersionIdMarker")
            if not all(isinstance(x,str) and 0<len(x)<=1024 and not any(ord(c)<32 for c in x) for x in (key_marker,version_marker)) or (key_marker,version_marker) in seen:
                raise OperatorError("version inventory pagination")
            seen.add((key_marker,version_marker))
        self.state.data["version_inventory"]={"potential_version_charge_bytes":total,"versions":versions,"body_plus16384_inventory_does_not_refund_ledger":True};self.state.save()
        return total

    def verify_host_root(self):
        instance=self.state.data["resources"]["instance"]
        actual=self.call("ec2","describe-instances",["--instance-ids",instance])
        rows=[i for r in actual.get("Reservations",[]) for i in r.get("Instances",[])]
        if len(rows)!=1 or rows[0].get("InstanceId")!=instance or rows[0].get("ImageId")!=self.config["ami"] or rows[0].get("InstanceType")!="c6i.large": raise OperatorError("host/root identity")
        mappings=rows[0].get("BlockDeviceMappings",[])
        if len(mappings)!=1 or mappings[0].get("DeviceName")!="/dev/sda1" or mappings[0].get("Ebs",{}).get("DeleteOnTermination") is not True: raise OperatorError("owned root deletion mapping")
        volume=mappings[0]["Ebs"].get("VolumeId","")
        if not re.fullmatch("vol-[a-f0-9]+",volume): raise OperatorError("root volume identity")
        volumes=self.call("ec2","describe-volumes",["--filters","Name=volume-id,Values="+volume]).get("Volumes",[])
        if len(volumes)!=1: raise OperatorError("root volume readback")
        root=volumes[0];tags={t.get("Key"):t.get("Value") for t in root.get("Tags",[])}
        if any(root.get(k)!=v for k,v in {"VolumeId":volume,"Encrypted":True,"VolumeType":"gp3","Size":16}.items()) or tags.get("RunId")!=self.config["run_id"] or tags.get("Purpose")!="synthetic-benchmark-only": raise OperatorError("root volume scope")
        attachments=root.get("Attachments",[])
        if len(attachments)!=1 or attachments[0].get("InstanceId")!=instance or attachments[0].get("Device")!="/dev/sda1" or attachments[0].get("DeleteOnTermination") is not True: raise OperatorError("root attachment scope")
        self.own("root_volume",volume)
        self.state.data["root_mapping_proof_sha256"]=digest(canonical({"mapping":mappings[0],"volume":root}));self.state.save()

    def run_host(self):
        self.verify_host_root()
        instance=self.state.data["resources"]["instance"]
        guard_deadline=min(self.clock()+300000,self.state.data["deadline_ms"])
        while self.clock()<guard_deadline:
            result=self.call("ec2","get-console-output",["--instance-id",instance,"--latest"])
            console=cli_console_text(result)
            if "S09_GUARD_FAILED" in console: raise OperatorError("stock guard failed")
            if "S09_GUARD_V1 " in console:
                self.open_https_after_guard(console); break
            time.sleep(5)
        else: raise OperatorError("console guard readiness timed out")
        ssm_deadline=min(self.clock()+300000,self.state.data["deadline_ms"])
        while self.clock()<ssm_deadline:
            result=self.call("ssm","describe-instance-information",["--filters",json.dumps([{"Key":"InstanceIds","Values":[instance]}])])
            rows=result.get("InstanceInformationList",[])
            if len(rows)==1 and rows[0].get("PingStatus")=="Online":
                self.verify_ssm_agent(rows[0]); break
            time.sleep(5)
        else: raise OperatorError("SSM Online unavailable; no widening")
        # Wait for cloud-init write_files. Background package/snap services stay masked.
        self.ssm(["test -f /opt/server2-s09/private/bootstrap.sh", "systemctl is-active --quiet server2-s09-expiry.timer", "systemctl is-active --quiet server2-s09-meter.service"],seconds=30)
        self.ssm(["set -eu; : >/opt/server2-s09/private/controller-start; timeout 2100 /opt/server2-s09/private/bootstrap.sh >/opt/server2-s09/private/bootstrap.log 2>&1"],seconds=2100)
        receipt=json.loads(self.ssm(["cat /opt/server2-s09/private/build.json"],seconds=30))
        if receipt.get("status")!="built" or receipt.get("source_revision")!=self.config["source_revision"]: raise OperatorError("host source build receipt")
        clock_ticks=receipt.get("clock_ticks_per_second")
        if type(clock_ticks) is not int or not 1<=clock_ticks<=1000000: raise OperatorError("host CPU clock rate unknown")
        self.state.data["host_process_measurement_context"]={"clock_ticks_per_second":clock_ticks,"source":"stock getconf CLK_TCK on the measured host; no assumed value","worker_CPU_scope":"whole worker process including seeding/protocol; not request assembly-only"};self.state.save()
        binary=receipt.get("binary_path","")
        if not re.fullmatch(r"/opt/server2-s09/source/server2/target/x86_64-unknown-linux-musl/release/server2-feasibility",binary): raise OperatorError("host binary path")
        actual=self.ssm(["sha256sum "+binary],seconds=30).split()[0]
        if actual!=receipt.get("binary_sha256"): raise OperatorError("host binary readback digest")
        self.phase_guard(transition=True)
        provider_commands=["set -eu; nohup python3 /opt/server2-s09/source/server2/tools/benchmark/local_peer.py >/opt/server2-s09/private/provider-endpoint 2>/opt/server2-s09/private/provider-errors & echo $! >/opt/server2-s09/private/provider-pid; sleep 1; cat /opt/server2-s09/private/provider-endpoint"]
        endpoint=self.ssm(provider_commands,seconds=15).strip()
        source_config=bounded_json(HERE.parents[1]/"config/benchmarks/aws.json")
        source_config.update(execution_enabled=True,source_revision=self.config["source_revision"],source_map_sha256=self.config["source_map_sha256"],lock_sha256=self.config["lock_sha256"],review_candidate_sha256=self.config["review_candidate_sha256"])
        if digest(canonical(source_config))!=self.config["requested_config_sha256"]: raise OperatorError("requested armed config digest")
        manifest=make_manifest(self.config,self.state.data,instance,actual,self.clock(),endpoint)
        run_directory="/opt/server2-s09/run/"+self.config["run_id"]
        encoded=base64.b64encode(canonical(manifest)).decode()
        if len(encoded)>90000: raise OperatorError("manifest bound")
        commands=["python3 - <<'PY'", "import base64,os,pathlib", "p=pathlib.Path('"+run_directory+"');p.mkdir(parents=True,mode=0o700,exist_ok=True)", "assert not p.is_symlink() and p.stat().st_uid==0", "os.chmod(p,0o700)", "fd=os.open(p/'manifest.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)", "with os.fdopen(fd,'wb') as f: f.write(base64.b64decode('"+encoded+"'));f.flush();os.fsync(f.fileno())", "PY"]
        self.state.data["worker_allocation_issued"]=True;self.state.save()
        self.ssm(["\n".join(commands)],seconds=30)
        # Worker config is reviewed, source-pinned and inert until this private copy is armed.
        config_script="import pathlib,json,os;src=pathlib.Path('/opt/server2-s09/source/server2/config/benchmarks/aws.json');c=json.loads(src.read_text());c['execution_enabled']=True;c['source_revision']='"+self.config["source_revision"]+"';c['source_map_sha256']='"+self.config["source_map_sha256"]+"';c['lock_sha256']='"+self.config["lock_sha256"]+"';c['review_candidate_sha256']='"+self.config["review_candidate_sha256"]+"';p=pathlib.Path('"+run_directory+"/aws-config.json');fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.write(fd,json.dumps(c,separators=(',',':'),sort_keys=True).encode());os.close(fd)"
        self.ssm(["python3 -c "+json.dumps(config_script)],seconds=30)
        self.state.data["worker_accounting_compliance"]=False
        self.state.save()
        # Recheck after private manifest/config transfers. The grace consumes
        # part of the existing tail; it never extends the original host deadline.
        worker_seconds=worker_timeout_seconds(manifest,self.clock())
        try:
            terminal=self.ssm(["set -eu; timeout "+str(worker_seconds)+" "+binary+" --aws-config "+run_directory+"/aws-config.json --run-manifest "+run_directory+"/manifest.json --execute-approved-run >"+run_directory+"/result.json 2>"+run_directory+"/result-errors.log"],seconds=worker_seconds,capture_terminal=True)
        except OperatorError:
            terminal={"Status":"Unknown","ResponseCode":None}
        self.export_worker_result(run_directory,manifest,terminal)
        self.phase_guard()
        self.inventory_versions()
        self.ssm(["python3 - <<'PY'\nimport pathlib,os\np=pathlib.Path('/opt/server2-s09/private/provider-pid');pid=int(p.read_text());cmd=pathlib.Path('/proc/'+str(pid)+'/cmdline').read_bytes();assert b'tools/benchmark/local_peer.py' in cmd;os.kill(pid,15)\nPY"],seconds=15)

    def cleanup(self):
        # Only exact run-tagged new resources are eligible; S3 data remains untouched.
        resources = self.state.data.setdefault("resources", {})
        intents = self.state.data.get("creation_intents", {})
        def tagged(item):
            tags={t.get("Key"):t.get("Value") for t in item.get("Tags",[])}
            if tags.get("RunId")!=self.config["run_id"] or tags.get("Purpose")!="synthetic-benchmark-only":
                raise OperatorError("cleanup ownership not proven")
        def read(service,action,args):
            try: return self.call(service,action,args,cleanup=True)
            except OperatorError as error:
                if str(error) in {"AWS status NoSuchEntity","AWS status InvalidGroup.NotFound","AWS status NotFound"}: return None
                raise
        instance=resources.get("instance")
        recovery=self.state.data.get("recovery1")
        current_absence_cleanup=False
        if not instance and recovery is not None and recovery.get("authority",{}).get("owned_absent_host_cleanup_authorized") is True:
            # A new explicit cleanup authorization and current inventories do
            # not retrospectively prove the predecessor request was unsent.
            # A newly uncertain sent retry cannot use this path.
            outcome=self.state.data.get("current_launch_outcome")
            if recovery.get("dispatch_attempted") is False or outcome in {"local_cli_rejected","idempotency_mismatch"}:
                token=self.call("ec2","describe-instances",["--filters","Name=client-token,Values="+self.state.data["client_token"]],cleanup=True)
                tags=self.call("ec2","describe-instances",["--filters","Name=tag:RunId,Values="+self.config["run_id"]],cleanup=True)
                for inventory in (token,tags):
                    rows=inventory.get("Reservations")
                    if not isinstance(rows,list) or any(not isinstance(r,dict) or not isinstance(r.get("Instances"),list) for r in rows) or any(r["Instances"] for r in rows): raise OperatorError("current absence cleanup host inventory unknown or nonempty")
                volumes=self.call("ec2","describe-volumes",["--filters","Name=tag:RunId,Values="+self.config["run_id"]],cleanup=True).get("Volumes")
                if volumes!=[]: raise OperatorError("current absence cleanup volume inventory unknown or nonempty")
                current_absence_cleanup=True
                recovery["current_absence_cleanup"]={"authorized":True,"operator_calls":self.calls,"historical_launch_unknown_preserved":True}
                self.state.save()
        if not instance and self.state.data.get("launch_attempted") and not current_absence_cleanup:
            actual=self.call("ec2","describe-instances",["--filters","Name=client-token,Values="+self.state.data["client_token"]],cleanup=True)
            rows=[i for r in actual.get("Reservations",[]) for i in r.get("Instances",[])]
            if len(rows)!=1: raise OperatorError("unknown launched host; keep reconciliation armed")
            instance=rows[0]["InstanceId"];self.own("instance",instance)
        if instance:
            actual=self.call("ec2","describe-instances",["--instance-ids",instance],cleanup=True)
            rows=[i for r in actual.get("Reservations",[]) for i in r.get("Instances",[])]
            if len(rows)!=1 or rows[0].get("InstanceId")!=instance: raise OperatorError("cleanup host identity")
            tagged(rows[0])
            if not resources.get("root_volume"):
                roots=[m for m in rows[0].get("BlockDeviceMappings",[]) if m.get("DeviceName")=="/dev/sda1"]
                if len(roots)==1 and re.fullmatch("vol-[a-f0-9]+",roots[0].get("Ebs",{}).get("VolumeId","")):
                    self.own("root_volume",roots[0]["Ebs"]["VolumeId"])
                    self.state.data["cleanup_root_mapping_sha256"]=digest(canonical(roots[0]));self.state.save()
            if rows[0].get("State",{}).get("Name")!="terminated":
                self.call("ec2","terminate-instances",["--instance-ids",instance],cleanup=True)
                return {"status":"termination_requested_cleanup_pending"}
        volume=resources.get("root_volume")
        if instance and not volume:
            raise OperatorError("root volume identity unknown; cleanup proof pending")
        if volume:
            remaining=self.call("ec2","describe-volumes",["--filters","Name=volume-id,Values="+volume],cleanup=True).get("Volumes")
            if not isinstance(remaining,list): raise OperatorError("root volume disappearance unknown")
            if remaining: return {"status":"termination_requested_cleanup_pending"}
            self.state.data["root_volume_absence_verified"]=True;self.state.save()
        for name,action,field in [("profile","get-instance-profile","InstanceProfile"),("role","get-role","Role")]:
            if not resources.get(name) and not intents.get(name): continue
            args=["--instance-profile-name" if name=="profile" else "--role-name",self.config["role"]]
            actual=read("iam",action,args)
            if actual is None and intents.get(name)=="unknown": raise OperatorError("unknown IAM creation may commit later; cleanup pending")
            if actual is not None:
                item=actual[field];tagged(item)
                expected="arn:aws:iam::"+self.config["account"]+(":instance-profile/" if name=="profile" else ":role/")+self.config["role"]
                if item.get("Arn")!=expected: raise OperatorError("cleanup IAM identity")
                if name=="profile":
                    roles=item.get("Roles",[])
                    if len(roles)>1 or any(r.get("RoleName")!=self.config["role"] for r in roles): raise OperatorError("cleanup profile membership")
                    if roles: self.call("iam","remove-role-from-instance-profile",args+["--role-name",self.config["role"]],cleanup=True)
                    self.call("iam","delete-instance-profile",args,cleanup=True)
                else:
                    try: self.call("iam","delete-role-policy",args+["--policy-name","S09SyntheticRuntime"],cleanup=True)
                    except OperatorError as error:
                        if str(error)!="AWS status NoSuchEntity": raise
                    self.call("iam","delete-role",args,cleanup=True)
            resources.pop(name,None);intents.pop(name,None);self.state.save()
        if resources.get("sg") or intents.get("sg"):
            args=["--group-ids",resources["sg"]] if resources.get("sg") else ["--filters","Name=group-name,Values="+self.config["security_group"],"Name=vpc-id,Values="+self.config["vpc"]]
            actual=read("ec2","describe-security-groups",args)
            rows=[] if actual is None else actual.get("SecurityGroups",[])
            if not rows and intents.get("sg")=="unknown": raise OperatorError("unknown SG creation may commit later; cleanup pending")
            if len(rows)>1: raise OperatorError("cleanup SG ambiguous")
            if rows:
                tagged(rows[0])
                if rows[0].get("VpcId")!=self.config["vpc"] or rows[0].get("GroupName")!=self.config["security_group"]: raise OperatorError("cleanup SG identity")
                self.call("ec2","delete-security-group",["--group-id",rows[0]["GroupId"]],cleanup=True)
            resources.pop("sg",None);intents.pop("sg",None);self.state.save()
        self.state.data["status"]="cleaned_host_resources_S3_retained";self.state.save()
        return {"status":self.state.data["status"],"current_absence_cleanup":current_absence_cleanup,"historical_launch_unknown_preserved":bool(recovery and recovery.get("historical_launch_unknown"))}


def worker_timeout_seconds(manifest, current_ms):
    remaining=manifest["benchmark_expires_at_ms"]-current_ms
    tail=min(manifest["host_expires_at_ms"],EXPIRY)-manifest["benchmark_expires_at_ms"]
    if not MINIMUM_WORKER_WINDOW_MS<=remaining<=MAXIMUM_WORKER_WINDOW_MS or tail<EXPORT_CLEANUP_RESERVE_MS:
        raise OperatorError("insufficient worker/export window; no allocation renewal")
    return remaining//1000+COMPLETION_GRACE_SECONDS


def make_manifest(config, state, instance_id, binary_sha256, current_ms, provider_endpoint):
    if not re.fullmatch(r"http://127\.0\.0\.1:[0-9]{1,5}/",provider_endpoint) or not 1 <= int(provider_endpoint.split(":")[-1].rstrip("/")) <= 65535: raise OperatorError("provider loopback endpoint")
    if "guard_proof_sha256" not in state or not re.fullmatch("[a-f0-9]{64}", binary_sha256):
        raise OperatorError("unverified host build/guard")
    deadline = min(state["deadline_ms"], EXPIRY)-EXPORT_CLEANUP_RESERVE_MS
    deadline = min(deadline,current_ms+MAXIMUM_WORKER_WINDOW_MS)
    if deadline-current_ms<MINIMUM_WORKER_WINDOW_MS:
        raise OperatorError("insufficient benchmark/export window")
    manifest = {"schema":1,"run_id":config["run_id"],"allocation_id":config["run_id"]+"-worker1","instance_id":instance_id,
                **{k:config[k] for k in ("account","region","bucket","role","source_revision","source_map_sha256","lock_sha256","requested_config_sha256")},
                "source_map":dict(config["source_files"]),"provider_endpoint":provider_endpoint,"binary_sha256":binary_sha256,"approval_expires_at_ms":EXPIRY,"host_expires_at_ms":state["deadline_ms"],"benchmark_expires_at_ms":deadline,
                "allocations":{"read_attempts":390000,"write_attempts":18000,"download_bytes":26*GiB,"stored_version_charge_bytes":63*MiB,"metadata_download_bytes":512*MiB},
                "operator_reservation_summary":{"read_attempts":10000,"write_attempts":2000,"bootstrap_download_bytes":3*GiB,"administrative_download_bytes":GiB,"stored_version_charge_bytes":MiB},
                "phases":{"protocol":{"read_attempts":5000,"write_attempts":3500},"cold":{"read_attempts":280000,"write_attempts":0},"repair":{"read_attempts":60000,"write_attempts":4000},"warm":{"read_attempts":10000,"write_attempts":0},"funding":{"read_attempts":10000,"write_attempts":5500},"failure":{"read_attempts":25000,"write_attempts":5000}},
                "guard_proof":{"status":"verified","run_id":config["run_id"],"instance_id":instance_id,"source_revision":config["source_revision"],"observed_at_ms":current_ms,"proof_sha256":state["guard_proof_sha256"]}}
    return manifest


def watchdog(config, path, runner):
    state=bounded_json(path)
    if state.get("run_id")!=config["run_id"] or state.get("config_sha256")!=digest(canonical(config)): raise OperatorError("watchdog scope")
    suffix=".recovery1.watchdog-ready" if "recovery1" in state else ".watchdog-ready"
    ready=Path(path).with_suffix(suffix)
    fd=os.open(ready,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    os.close(fd)
    # This child never replenishes the reserved 50 control calls or writes parent state.
    calls=0
    initial=now_ms();floor=initial;end=time.monotonic()+max(0,(min(state["deadline_ms"],EXPIRY)-initial)/1000)
    while now_ms()<min(state["deadline_ms"],EXPIRY) and time.monotonic()<end:
        current_clock=now_ms()
        if current_clock<floor: break
        floor=current_clock
        current=bounded_json(path)
        if current.get("status")=="cleaned_host_resources_S3_retained": return
        parent=current.get("watchdog_parent",0)
        try: os.kill(parent,0)
        except ProcessLookupError: break
        time.sleep(1)
    current=bounded_json(path)
    instance=current.get("resources",{}).get("instance")
    if not instance and current.get("launch_attempted"):
        calls+=1
        response=runner.call("ec2","describe-instances",["--filters","Name=client-token,Values="+state["client_token"]])
        rows=[i for r in response.get("Reservations",[]) for i in r.get("Instances",[])]
        if len(rows)==1: instance=rows[0].get("InstanceId")
    termination_requested=False
    if instance:
        response=runner.call("ec2","describe-instances",["--instance-ids",instance]);calls+=1
        rows=[i for r in response.get("Reservations",[]) for i in r.get("Instances",[])]
        if len(rows)!=1 or {t["Key"]:t["Value"] for t in rows[0].get("Tags",[])}.get("RunId")!=config["run_id"]: raise OperatorError("watchdog ownership mismatch")
        runner.call("ec2","terminate-instances",["--instance-ids",instance]);calls+=1
        termination_requested=True
    outcome="owned_termination_requested" if termination_requested else "original_launch_unresolved" if current.get("launch_attempted") else "no_launch_recorded"
    finish=".recovery1.watchdog-finish.json" if "recovery1" in state else ".watchdog-finish.json"
    fd=os.open(Path(path).with_suffix(finish),os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,"w") as out: json.dump({"status":outcome,"reserved_calls":50,"actual_calls":calls,"host_absence_verified":False},out)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=HERE / "aws-run.json")
    parser.add_argument("--execute-reviewed-run", action="store_true")
    parser.add_argument("--cleanup-only", action="store_true")
    parser.add_argument("--resume-failed-creation",action="store_true",help="One reviewed recovery of the original pre-worker failure")
    parser.add_argument("--original-config",type=Path)
    parser.add_argument("--recovery-authority",type=Path)
    parser.add_argument("--watchdog", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--state", type=Path)
    parser.add_argument("--authorization", type=Path)
    args = parser.parse_args()
    config = validate_config(bounded_json(args.config), armed=args.execute_reviewed_run or args.resume_failed_creation or args.cleanup_only or args.watchdog, cleanup_only=args.cleanup_only or args.watchdog)
    if not args.execute_reviewed_run and not args.resume_failed_creation and not args.cleanup_only and not args.watchdog:
        print(json.dumps({"status":"dry_plan_no_network","run_id":config["run_id"],"instance_type":"c6i.large","initial_egress":[],"S3_delete":False,"execution_pins_complete":all(config[k] for k in PIN_FIELDS)}))
        return
    if args.state is None or args.authorization is None or sum([args.execute_reviewed_run,args.resume_failed_creation,args.cleanup_only,args.watchdog]) != 1:
        raise OperatorError("explicit authority/state required")
    authorization = bounded_json(args.authorization)
    if authorization != {"run_id":config["run_id"],"source_revision":config["source_revision"],"native_review_receipt_sha256":config["native_review_receipt_sha256"],"AWS_execution_authorized":True,"expires_at_ms":EXPIRY}:
        raise OperatorError("execution authority mismatch")
    runner = Cli(config)
    if args.watchdog:
        watchdog(config,args.state,runner)
        return
    if args.cleanup_only:
        state = State(args.state, bounded_json(args.state))
        if state.data.get("run_id") != config["run_id"] or state.data.get("config_sha256") != digest(canonical(config)):
            raise OperatorError("cleanup manifest identity")
        print(json.dumps(Operator(config,state,runner).cleanup()))
        return
    current = now_ms()
    if args.resume_failed_creation:
        if args.original_config is None or args.recovery_authority is None: raise OperatorError("original configuration and recovery authority required")
        info=args.state.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o600 or args.state.parent.is_symlink() or args.state.parent.stat().st_uid!=os.getuid() or stat.S_IMODE(args.state.parent.stat().st_mode)!=0o700: raise OperatorError("recovery private state ownership")
        original=validate_config(bounded_json(args.original_config),armed=False,cleanup_only=True)
        state=State(args.state,bounded_json(args.state))
        operator=Operator(config,state,runner)
        operator.prepare_recovery(original,bounded_json(args.recovery_authority))
    else:
        if args.original_config is not None or args.recovery_authority is not None: raise OperatorError("recovery input on another mode")
        state = State.create(args.state,{"run_id":config["run_id"],"config_sha256":digest(canonical(config)),"client_token":"s09-"+secrets.token_hex(24),"nonce":secrets.token_hex(32),"deadline_ms":min(EXPIRY,current+7200000),"bootstrap_reserved_bytes":3*GiB,"worker_allocation_issued":False,"resources":{},"status":"creation","watchdog_parent":os.getpid()})
        # Child holds its separate pre-reserved control allocation; no worker renewal.
        state.data["watchdog_reserved_reads"]=50
        state.data["watchdog_reserved_download_bytes"]=50*131072
        state.save()
    monitor=subprocess.Popen([os.sys.executable,str(HERE/"aws_operator.py"),"--config",str(args.config.resolve()),"--state",str(args.state.resolve()),"--authorization",str(args.authorization.resolve()),"--watchdog"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
    operator=Operator(config,state,runner)
    measurement_attempted=False
    try:
        for _ in range(50):
            ready=".recovery1.watchdog-ready" if args.resume_failed_creation else ".watchdog-ready"
            if state.path.with_suffix(ready).is_file(): break
            if monitor.poll() is not None: raise OperatorError("watchdog did not arm")
            time.sleep(.1)
        else: raise OperatorError("watchdog readiness deadline")
        if args.resume_failed_creation:
            result=operator.resume_failed_creation()
            if result["status"]=="recovery_host_acknowledged":
                measurement_attempted=True;operator.run_host()
        else:
            operator.provision()
            measurement_attempted=True;operator.run_host()
    finally:
        # Watchdog stays armed until it observes termination. Never kill it on parent exit.
        for _ in range(60):
            status=operator.cleanup()
            if status["status"]=="cleaned_host_resources_S3_retained": break
            time.sleep(5)
        else: raise OperatorError("cleanup pending; watchdog remains armed")
    status="measurement_result_exported_cleanup_requested" if measurement_attempted else "existing_owned_host_cleaned_no_measurement"
    print(json.dumps({"status":status,"measurement_attempted":measurement_attempted,"state":str(args.state),"S3_retained":True}))

if __name__ == "__main__":
    try:
        main()
    except (OperatorError,OSError,KeyError,TypeError) as exc:
        print(json.dumps({"status":"failed_closed","error":str(exc) if isinstance(exc,OperatorError) else "operator setup failure"}))
        raise SystemExit(1)
