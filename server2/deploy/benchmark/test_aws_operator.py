"""Offline S09 controller regressions; no AWS connection or credential discovery."""
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("aws_operator", HERE / "aws_operator.py")
op = importlib.util.module_from_spec(spec)
spec.loader.exec_module(op)

CAPS = {"reads": 4, "writes": 3, "download": 200000, "store": 40000}

class LedgerTests(unittest.TestCase):
    def test_read_plus_one_denied_without_charge_or_dispatch(self):
        ledger = op.Ledger(CAPS)
        for _ in range(4):
            ledger.reserve("GET", response_bytes=10)
        with self.assertRaises(op.OperatorError):
            ledger.reserve("HEAD", response_bytes=0)
        self.assertEqual(ledger.used["reads"], 4)

    def test_each_denied_retry_unknown_put_keeps_version_overhead(self):
        ledger = op.Ledger(CAPS)
        ledger.reserve("PUT", response_bytes=10, put_bytes=100)
        ledger.reserve("PUT", response_bytes=10, put_bytes=100)
        self.assertEqual(ledger.used["store"], 2 * (100 + 16384))
        snapshot = dict(ledger.used)
        with self.assertRaises(op.OperatorError):
            ledger.reserve("PUT", put_bytes=100)
        self.assertEqual(snapshot, ledger.used)

    def test_concurrent_reservations_share_one_cap(self):
        ledger = op.Ledger(CAPS)
        def reserve(_):
            try:
                ledger.reserve("GET", response_bytes=1)
                return True
            except op.OperatorError:
                return False
        with ThreadPoolExecutor(max_workers=8) as pool:
            successes = list(pool.map(reserve, range(32)))
        self.assertEqual(sum(successes), 4)
        self.assertEqual(ledger.used["reads"], 4)

    def test_invalid_or_overflow_input_never_spends(self):
        ledger = op.Ledger(CAPS)
        for kind, size in [("DELETE", 0), ("GET", -1), ("GET", 2**64)]:
            with self.assertRaises(op.OperatorError):
                ledger.reserve(kind, response_bytes=size)
        self.assertFalse(any(ledger.used.values()))

class MetadataAccountingTests(unittest.TestCase):
    def report(self):
        return {"S3_accounting":{"uncertainty_compliance_pass":True,"used":{"read_attempts":39,"write_attempts":25,"download_reserved_bytes":11173832,"stored_version_charge_bytes":386762}},"metadata_accounting":{"limit_bytes":512*op.MiB,"used":{"admitted_requests":4,"reserved_bytes":262844,"observed_body_bytes":700,"unknown_calls":0}},"overall_accounting_compliance_pass":True}

    def test_live_metadata_known_bounded_report_accepted(self):
        self.assertTrue(op.validate_worker_accounting(self.report()))
        report=self.report();report["metadata_accounting"]["used"].update(admitted_requests=1024,reserved_bytes=512*op.MiB,observed_body_bytes=512*op.MiB)
        self.assertTrue(op.validate_worker_accounting(report))

    def test_unknown_overcap_missing_or_false_report_rejected(self):
        mutations=[("unknown_calls",1),("reserved_bytes",512*op.MiB+1),("observed_body_bytes",512*op.MiB+1),("admitted_requests",1025),("admitted_requests",-1),("reserved_bytes",True)]
        for field,value in mutations:
            report=self.report();report["metadata_accounting"]["used"][field]=value
            with self.subTest(field=field,value=value),self.assertRaises(op.OperatorError): op.validate_worker_accounting(report)
        for field in ("metadata_accounting","overall_accounting_compliance_pass"):
            report=self.report();del report[field]
            with self.subTest(missing=field),self.assertRaises(op.OperatorError): op.validate_worker_accounting(report)
        for field in ("overall_accounting_compliance_pass",):
            report=self.report();report[field]=False
            with self.assertRaises(op.OperatorError): op.validate_worker_accounting(report)
        report=self.report();report["S3_accounting"]["uncertainty_compliance_pass"]=False
        with self.assertRaises(op.OperatorError): op.validate_worker_accounting(report)
        report=self.report();report["metadata_accounting"]["limit_bytes"]=513*op.MiB
        with self.assertRaises(op.OperatorError): op.validate_worker_accounting(report)
        for malformed in (None,[],{"used":None,"limit_bytes":512*op.MiB}):
            report=self.report();report["metadata_accounting"]=malformed
            with self.assertRaises(op.OperatorError): op.validate_worker_accounting(report)
        report=self.report();report["metadata_accounting"]["used"]["observed_body_bytes"]=262845
        with self.assertRaises(op.OperatorError): op.validate_worker_accounting(report)
        for field in ("admitted_requests","reserved_bytes","observed_body_bytes","unknown_calls"):
            report=self.report();del report["metadata_accounting"]["used"][field]
            with self.assertRaises(op.OperatorError): op.validate_worker_accounting(report)


class ConfigAndOwnershipTests(unittest.TestCase):
    def config(self):
        return json.loads((HERE / "aws-run.json").read_text())

    def pinned_config(self, include_checker=True):
        config=self.config()
        declaration=json.loads((HERE.parents[1]/"config/tasks/S09.json").read_text())
        paths=declaration["server2_paths"]+[v["path"] for v in declaration["outside"]]
        if not include_checker: paths=[p for p in paths if p not in {"server2/tools/check_placement.py","server2/tools/test_placement.py"}]
        files={name:op.digest((HERE.parents[2]/name).read_bytes()) for name in paths}
        for field in op.PIN_FIELDS-{ "source_files", "rustup_url", "source_revision" }: config[field]="a"*64
        config.update(source_revision="b"*40,source_files=files,source_map_sha256=op.digest(op.canonical(files)),rustup_url="https://static.rust-lang.org/rustup/archive/1.29.1/x86_64-unknown-linux-gnu/rustup-init")
        for file,key in [("bucket-policy.json","bucket_policy_sha256"),("instance-policy.json","instance_policy_sha256"),("cloud-init.yml","bootstrap_sha256")]: config[key]=op.digest((HERE/file).read_bytes())
        config["lock_sha256"]=op.digest((HERE.parents[1]/"Cargo.lock").read_bytes())
        runtime=json.loads((HERE.parents[1]/"config/benchmarks/aws.json").read_text())
        runtime.update(execution_enabled=True,source_revision=config["source_revision"],source_map_sha256=config["source_map_sha256"],lock_sha256=config["lock_sha256"],review_candidate_sha256=config["review_candidate_sha256"])
        config["requested_config_sha256"]=op.digest(op.canonical(runtime))
        return config

    def test_declared33_source_map_accepts_and_old31_rejects(self):
        current=self.pinned_config();self.assertEqual(len(current["source_files"]),33)
        self.assertEqual(op.validate_config(current,armed=True,now_ms=1791435000000),current)
        old=self.pinned_config(include_checker=False);self.assertEqual(len(old["source_files"]),31)
        with self.assertRaises(op.OperatorError): op.validate_config(old,armed=True,now_ms=1791435000000)

    def test_old31_source_map_rejected_before_execution(self):
        old=self.pinned_config(include_checker=False)
        with self.assertRaises(op.OperatorError): op.validate_config(old,armed=True,now_ms=1791435000000)

    def test_template_cannot_execute(self):
        with self.assertRaises(op.OperatorError):
            op.validate_config(self.config(), armed=True, now_ms=1791435000000)

    def test_config_scope_and_unknown_fields(self):
        for key, value in [("account", "other"), ("max_instances", 2), ("region", "us-east-1"), ("download_bytes", 2**40), ("unknown", 1)]:
            config = self.config()
            config[key] = value
            with self.assertRaises(op.OperatorError):
                op.validate_config(config, now_ms=1791435000000)

    def test_exclusive_state_preserves_existing_file_and_symlink(self):
        with tempfile.TemporaryDirectory(prefix="s09-operator-exclusive-") as temp:
            path = Path(temp) / "state.json"
            op.State.create(path, {"run_id": "one"})
            with self.assertRaises(op.OperatorError):
                op.State.create(path, {"run_id": "two"})
            self.assertEqual(json.loads(path.read_text())["run_id"], "one")
            link = Path(temp) / "link.json"
            link.symlink_to(path)
            with self.assertRaises(op.OperatorError):
                op.State.create(link, {"run_id": "two"})
            self.assertTrue(link.is_symlink())

    def test_expired_cleanup_targets_only_tagged_owned_host(self):
        config=self.config()
        class Runner:
            def __init__(self,owned): self.calls=[];self.owned=owned
            def call(self,service,action,args):
                self.calls.append(action)
                if action=="describe-instances": return {"Reservations":[{"Instances":[{"InstanceId":"i-0123456789abcdef0","Tags":[{"Key":"RunId","Value":config["run_id"] if self.owned else "other"},{"Key":"Purpose","Value":"synthetic-benchmark-only"}],"State":{"Name":"running"}}]}]}
                return {}
        with tempfile.TemporaryDirectory(prefix="s09-cleanup-expired-") as temp:
            for owned in (False,True):
                state=op.State.create(Path(temp)/(str(owned)+".json"),{"deadline_ms":op.EXPIRY-1,"resources":{"instance":"i-0123456789abcdef0"}})
                runner=Runner(owned);controller=op.Operator(config,state,runner,clock=lambda:op.EXPIRY+1)
                if owned: self.assertEqual(controller.cleanup()["status"],"termination_requested_cleanup_pending")
                else:
                    with self.assertRaises(op.OperatorError): controller.cleanup()
                self.assertEqual("terminate-instances" in runner.calls,owned)

    def test_root_volume_absence_not_termination_ack_completes_cleanup(self):
        config=self.config()
        class Runner:
            def __init__(self): self.present=True;self.actions=[]
            def call(self,service,action,args):
                self.actions.append(action)
                if action=="describe-volumes": return {"Volumes":[{"VolumeId":"vol-0123456789abcdef0"}]} if self.present else {"Volumes":[]}
                raise AssertionError("unexpected cleanup call")
        with tempfile.TemporaryDirectory(prefix="s09-root-pending-") as temp:
            state=op.State.create(Path(temp)/"state.json",{"deadline_ms":op.EXPIRY,"resources":{"root_volume":"vol-0123456789abcdef0"}})
            runner=Runner();controller=op.Operator(config,state,runner)
            self.assertEqual(controller.cleanup()["status"],"termination_requested_cleanup_pending")
            self.assertNotIn("root_volume_absence_verified",state.data)
            runner.present=False
            self.assertEqual(controller.cleanup()["status"],"cleaned_host_resources_S3_retained")
            self.assertTrue(state.data["root_volume_absence_verified"])
            self.assertEqual(runner.actions,["describe-volumes","describe-volumes"])

    def test_wrong_root_deletion_mapping_blocks_work(self):
        config=self.config()
        class Runner:
            def call(self,service,action,args):
                return {"Reservations":[{"Instances":[{"InstanceId":"i-0123456789abcdef0","ImageId":config["ami"],"InstanceType":"c6i.large","BlockDeviceMappings":[{"DeviceName":"/dev/sda1","Ebs":{"VolumeId":"vol-0123456789abcdef0","DeleteOnTermination":False}}]}]}]}
        with tempfile.TemporaryDirectory(prefix="s09-root-invalid-") as temp:
            state=op.State.create(Path(temp)/"state.json",{"deadline_ms":op.EXPIRY,"resources":{"instance":"i-0123456789abcdef0"}})
            with self.assertRaises(op.OperatorError): op.Operator(config,state,Runner()).verify_host_root()
            self.assertNotIn("root_volume",state.data["resources"])

    def test_unknown_creation_absence_is_not_cleanup_success(self):
        class Runner:
            def call(self,*args): raise op.OperatorError("AWS status NoSuchEntity")
        with tempfile.TemporaryDirectory(prefix="s09-cleanup-unknown-") as temp:
            state=op.State.create(Path(temp)/"state.json",{"deadline_ms":op.EXPIRY,"creation_intents":{"role":"unknown"},"resources":{}})
            with self.assertRaises(op.OperatorError): op.Operator(self.config(),state,Runner()).cleanup()
            self.assertNotEqual(state.data.get("status"),"cleaned_host_resources_S3_retained")

    def test_guard_nonce_deadline_and_bytes_fail_closed(self):
        expected = {"run_id": "test", "nonce": "n"*64, "deadline_ms": 1000000}
        good = dict(expected, status="guarded", timer_active=True, nft_active=True, ssm_present=True, observed_before_guard_bytes=100)
        self.assertTrue(op.verify_guard("S09_GUARD_V1 " + json.dumps(good), expected, now_ms=1))
        for key, value in [("nonce", "x"), ("timer_active", False), ("nft_active", False), ("ssm_present", False), ("observed_before_guard_bytes", 2**40), ("deadline_ms", 2000000)]:
            bad = dict(good, **{key: value})
            with self.assertRaises(op.OperatorError):
                op.verify_guard("S09_GUARD_V1 " + json.dumps(bad), expected, now_ms=1)

    def test_bootstrap_starts_guards_before_network(self):
        text = (HERE / "cloud-init.yml").read_text()
        self.assertIn("bootcmd:", text)
        self.assertLess(text.index("nft -c"), text.index("apt-get update"))
        self.assertLess(text.index("S09_GUARD_V1"), text.index("apt-get update"))
        self.assertNotIn("flush ruleset", text)
        self.assertNotIn("reset quota", text)
        self.assertIn("package_update: false", text)
        self.assertIn("https://archive.ubuntu.com", text)
        self.assertIn("metadata_download_allocation_bytes", text)
        self.assertLess(text.index("systemctl is-active --quiet server2-s09-meter.service"),text.index("S09_GUARD_V1"))
        self.assertIn("RUSTUP_TOOLCHAIN=1.99.0",text)
        self.assertIn("git read-tree -mu HEAD",text)

    def test_bootstrap_bin_matches_actual_cargo_target(self):
        import tomllib
        cargo=tomllib.loads((HERE.parents[1]/"Cargo.toml").read_text())
        bins=[b for b in cargo["bin"] if b["name"]=="server2-feasibility"]
        self.assertEqual(len(bins),1)
        text=(HERE/"cloud-init.yml").read_text()
        self.assertIn("--bin "+bins[0]["name"],text)
        self.assertIn("get('name')=='server2-feasibility'",text)
        self.assertNotIn("--bench feasibility",text)
        self.assertEqual(text.count("--property=MemoryMax=3221225472 --property=MemorySwapMax=0"),2)
        self.assertEqual(text.count("--setenv=RUSTUP_TOOLCHAIN=1.99.0"),2)

    def test_expired_execute_rejects_but_cleanup_config_is_allowed(self):
        with self.assertRaises(op.OperatorError):
            op.validate_config(self.config(),now_ms=op.EXPIRY)
        self.assertEqual(op.validate_config(self.config(),now_ms=op.EXPIRY,cleanup_only=True),self.config())

    def test_bucket_policy_covers_budgets_and_no_delete(self):
        policy = json.loads((HERE / "bucket-policy.json").read_text())
        text = json.dumps(policy)
        self.assertIn("authority.json", text)
        self.assertIn("/blocks/", text)
        self.assertIn("s3:DeleteObjectVersion", text)
        self.assertIn("s3:if-none-match", text)


class WireAndFunctionalTests(unittest.TestCase):
    def test_fake_cli_endpoint_env_and_flags(self):
        import os
        with tempfile.TemporaryDirectory(prefix="s09-cli-env-") as temp:
            fake=Path(temp)/"fake-aws"
            fake.write_text("#!/usr/bin/env python3\nimport os,json,sys\nprint(json.dumps({'args':sys.argv[1:],'ignore':os.getenv('AWS_IGNORE_CONFIGURED_ENDPOINT_URLS'),'retry':os.getenv('AWS_MAX_ATTEMPTS'),'custom':[k for k in os.environ if k.startswith('AWS_ENDPOINT_URL')]}))\n")
            fake.chmod(0o700)
            config=json.loads((HERE/"aws-run.json").read_text())
            from unittest.mock import patch
            with patch.dict(os.environ,{"AWS_ENDPOINT_URL_EC2":"https://unsafe.invalid","AWS_ENDPOINT_URL":"https://unsafe.invalid"}):
                got=op.Cli(config,str(fake)).call("ec2","describe-images",[])
            self.assertEqual(got["custom"],[])
            self.assertEqual(got["ignore"],"true")
            self.assertEqual(got["retry"],"1")
            self.assertIn("--no-paginate",got["args"])
            for arg in ["--endpoint-url","--endpoint-url=https://unsafe.invalid","--no-verify-ssl","--no-sign-request"]:
                with self.assertRaises(op.OperatorError):
                    op.Cli(config,str(fake)).call("ec2","describe-images",[arg])

    def test_ssm_delivery_minimum_preserves_short_plugin_timeout(self):
        config=json.loads((HERE/"aws-run.json").read_text());calls=[]
        class Runner:
            def call(self,service,action,args):
                calls.append(args)
                if action=="send-command":
                    self_delivery=int(args[args.index("--timeout-seconds")+1]);assert self_delivery>=30
                    params=json.loads(args[args.index("--parameters")+1]);assert params["executionTimeout"]==["15"]
                    return {"Command":{"CommandId":"01234567-0123-0123-0123-012345678901"}}
                return {"Status":"Success","StandardOutputContent":"done"}
        with tempfile.TemporaryDirectory(prefix="s09-ssm-timeout-") as temp:
            state=op.State.create(Path(temp)/"state.json",{"deadline_ms":op.EXPIRY,"resources":{"instance":"i-0123456789abcdef0"}})
            self.assertEqual(op.Operator(config,state,Runner()).ssm(["fixture"],seconds=15),"done")
        self.assertEqual(len(calls),2)

    def test_phase_guard_generated_python_compiles_and_does_not_reset(self):
        with tempfile.TemporaryDirectory(prefix="s09-phase-script-") as temp:
            config=json.loads((HERE/"aws-run.json").read_text())
            state=op.State.create(Path(temp)/"state.json",{"run_id":config["run_id"],"deadline_ms":op.now_ms()+7200000})
            controller=op.Operator(config,state,None)
            observed=[]
            def fake_ssm(commands,seconds):
                script=commands[0].split("\n",1)[1].rsplit("PY",1)[0]
                compile(script,"phase-guard-script","exec")
                observed.append(script)
                return json.dumps({"status":"guarded","observed_at_ms":op.now_ms(),"host_rx_bytes":100})
            controller.ssm=fake_ssm
            controller.phase_guard(transition=True)
            controller.phase_guard()
            self.assertIn("bootstrap_phase",observed[0])
            self.assertNotIn("reset",observed[0])
            self.assertNotIn("flush",observed[0])

    def test_render_size_blocks_decoded_payload_over_16k(self):
        with tempfile.TemporaryDirectory(prefix="s09-render-") as temp:
            config=json.loads((HERE/"aws-run.json").read_text())
            config.update(source_revision="a"*40,rustup_sha256="b"*64,rustup_url="https://static.rust-lang.org/rustup/archive/1.29.1/x86_64-unknown-linux-gnu/rustup-init",source_files={"server2/"+"x"*200+str(n):"c"*64 for n in range(100)})
            state=op.State.create(Path(temp)/"state.json",{"run_id":config["run_id"],"nonce":"d"*64,"deadline_ms":op.now_ms()+7200000})
            controller=op.Operator(config,state,None)
            with self.assertRaises(op.OperatorError): controller.render_bootstrap()


def functional_smoke():
    """Distinct loopback fake-CLI orchestration; never an AWS/kernel/SSM proof."""
    import base64
    import http.server
    import os
    import sys
    from unittest.mock import patch
    with tempfile.TemporaryDirectory(prefix="s09-operator-functional-") as temp:
        root=Path(temp);calls=[];terminated=[False];root_pending=[True]
        config=json.loads((HERE/"aws-run.json").read_text())
        config.update(source_revision="a"*40,rustup_sha256="b"*64,rustup_url="https://static.rust-lang.org/rustup/archive/1.29.1/x86_64-unknown-linux-gnu/rustup-init",source_files={"server2/Cargo.toml":"c"*64})
        instance="i-0123456789abcdef0"
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self,*args): pass
            def do_POST(self):
                n=int(self.headers["Content-Length"])
                if n>65536: self.send_error(413);return
                args=json.loads(self.rfile.read(n));calls.append(args)
                pos=next(i for i,v in enumerate(args) if v in op.ALLOWED)
                service,action=args[pos:pos+2];out={};code=0;error=""
                if (service,action)==("sts","get-caller-identity"): out={"Account":config["account"]}
                elif action=="describe-images": out={"Images":[{"ImageId":config["ami"],"OwnerId":"099720109477","Public":True,"State":"available","Architecture":"x86_64","RootDeviceName":"/dev/sda1","VirtualizationType":"hvm"}]}
                elif action=="describe-subnets": out={"Subnets":[{"SubnetId":config["subnet"],"VpcId":config["vpc"],"State":"available","MapPublicIpOnLaunch":True}]}
                elif action=="head-bucket": code=255;error="404"
                elif action in {"get-role","get-instance-profile"}:
                    if any("create-role" in c for c in calls):
                        field="Role" if action=="get-role" else "InstanceProfile"
                        out={field:{"Arn":"arn:aws:iam::"+config["account"]+(":role/" if field=="Role" else ":instance-profile/")+config["role"],"Tags":[{"Key":"RunId","Value":config["run_id"]},{"Key":"Purpose","Value":"synthetic-benchmark-only"}],"Roles":[{"RoleName":config["role"],"Arn":"arn:aws:iam::"+config["account"]+":role/"+config["role"]}]}}
                    else: code=255;error="NoSuchEntity"
                elif action=="describe-security-groups":
                    out={"SecurityGroups":[]} if "--filters" in args else {"SecurityGroups":[{"GroupId":"sg-0123456789abcdef0","GroupName":config["security_group"],"VpcId":config["vpc"],"Tags":[{"Key":"RunId","Value":config["run_id"]},{"Key":"Purpose","Value":"synthetic-benchmark-only"}],"IpPermissions":[],"IpPermissionsEgress":[] if any("revoke-security-group-egress" in c for c in calls) else [{"IpProtocol":"-1","IpRanges":[{"CidrIp":"0.0.0.0/0"}]}]}]}
                elif action=="create-security-group": out={"GroupId":"sg-0123456789abcdef0"}
                elif action=="create-role": out={"Role":{"Arn":"arn:aws:iam::"+config["account"]+":role/"+config["role"]}}
                elif action=="run-instances": out={"Instances":[{"InstanceId":instance}]}
                elif action=="describe-instances": out={"Reservations":[{"Instances":[{"InstanceId":instance,"Tags":[{"Key":"RunId","Value":config["run_id"]},{"Key":"Purpose","Value":"synthetic-benchmark-only"}],"State":{"Name":"terminated" if terminated[0] else "running"}}]}]}
                elif action=="describe-volumes":
                    out={"Volumes":[{"VolumeId":"vol-0123456789abcdef0"}]} if root_pending[0] else {"Volumes":[]}
                    root_pending[0]=False
                elif action=="terminate-instances": terminated[0]=True
                body=json.dumps({"stdout":out,"code":code,"error":error}).encode()
                self.send_response(200);self.send_header("Content-Length",str(len(body)));self.end_headers();self.wfile.write(body)
        server=http.server.ThreadingHTTPServer(("127.0.0.1",0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        fake=root/"fake-aws"
        fake.write_text("#!/usr/bin/env python3\nimport urllib.request,json,sys,os\nu=os.environ['S09_FAKE_CLI_ENDPOINT']\nr=urllib.request.urlopen(urllib.request.Request(u,json.dumps(sys.argv[1:]).encode(),method='POST'),timeout=2)\nd=json.load(r)\nprint(json.dumps(d['stdout']))\nif d['code']: print(d['error'],file=sys.stderr)\nsys.exit(d['code'])\n")
        fake.chmod(0o700)
        try:
            with patch.dict(os.environ,{"S09_FAKE_CLI_ENDPOINT":"http://127.0.0.1:"+str(server.server_port)+"/"}):
                state=op.State.create(root/"state.json",{"run_id":config["run_id"],"deadline_ms":op.now_ms()+7200000,"client_token":"s09-functional","nonce":"d"*64,"resources":{"root_volume":"vol-0123456789abcdef0"}})
                controller=op.Operator(config,state,op.Cli(config,str(fake)))
                self_id=controller.provision();assert self_id==instance
                assert not any("authorize-security-group-egress" in c for c in calls)
                payload=next(c[c.index("--user-data")+1] for c in calls if "run-instances" in c)
                import gzip
                decoded=base64.b64decode(payload);assert len(decoded)<=16384
                plain=gzip.decompress(decoded)
                assert b"nft -c" in plain and b"apt-get update" in plain
                expected={"run_id":config["run_id"],"nonce":state.data["nonce"],"deadline_ms":state.data["deadline_ms"],"source_revision":config["source_revision"]}
                bad=dict(expected,status="guarded",timer_active=False,nft_active=True,ssm_present=True,observed_before_guard_bytes=0)
                before=len(calls)
                try: controller.open_https_after_guard("S09_GUARD_V1 "+json.dumps(bad));raise AssertionError("invalid guard admitted")
                except op.OperatorError: pass
                assert len(calls)==before
                good=dict(bad,timer_active=True)
                controller.open_https_after_guard("S09_GUARD_V1 "+json.dumps(good))
                assert sum("authorize-security-group-egress" in c for c in calls)==1
                assert controller.cleanup()["status"]=="termination_requested_cleanup_pending"
                assert controller.cleanup()["status"]=="termination_requested_cleanup_pending"
                assert controller.cleanup()["status"]=="cleaned_host_resources_S3_retained"
                assert state.data["root_volume_absence_verified"] is True
                assert not any(any(a.startswith("delete-object") or a in {"delete-bucket","put-bucket-lifecycle-configuration"} for a in c) for c in calls)
                return {"status":"PASS_fake_only","calls":len(calls),"decoded_userdata_bytes":len(decoded),"guard_denied_dispatch":0,"S3_deletes":0,"new_hosts":sum("run-instances" in c for c in calls),"ledger":state.data["ledger"],"kernel_SSM_AWS_proven":False}
        finally: server.shutdown();server.server_close();thread.join(timeout=2)

def compiled_worker_handshake(binary):
    """Actual controller Cli/SSM envelope -> compiled local-only worker; no AWS/IMDS."""
    import base64, hashlib, http.server, os, subprocess, sys, urllib.request
    from unittest.mock import patch
    repo=HERE.parents[2];binary=Path(binary).resolve()
    if not binary.is_file(): raise AssertionError("compiled worker missing")
    declaration=json.loads((repo/"server2/config/tasks/S09.json").read_text())
    paths=declaration["server2_paths"]+[v["path"] for v in declaration["outside"]]
    if len(paths)!=33: raise AssertionError("source paths")
    peer=subprocess.Popen([sys.executable,str(repo/"server2/tools/benchmark/local_peer.py")],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    endpoint=peer.stdout.readline().strip()
    if not op.re.fullmatch(r"http://127\.0\.0\.1:[0-9]+/",endpoint): raise AssertionError("test peer endpoint")
    try:
      with tempfile.TemporaryDirectory(prefix="s09-compiled-handshake-") as temporary:
        root=Path(temporary);root.chmod(0o700)
        files={str(p):op.digest((repo/p).read_bytes()) for p in sorted(paths)}
        cfg=json.loads((repo/"server2/config/benchmarks/aws.json").read_text())
        cfg["cases"]=[dict(next(v for v in cfg["cases"] if v["mode"]==mode),target_samples=2,revisions=1) for mode in ("cold","warm","provider_data","provider_nodata")]
        revision=subprocess.check_output(["git","rev-parse","HEAD"],cwd=repo,text=True).strip()
        cfg.update(execution_enabled=True,source_revision=revision,source_map_sha256=op.digest(op.canonical(files)),lock_sha256=op.digest((repo/"server2/Cargo.lock").read_bytes()),review_candidate_sha256="a"*64)
        config_path=root/"aws-config.json";config_path.write_bytes(op.canonical(cfg));config_path.chmod(0o600)
        config=json.loads((HERE/"aws-run.json").read_text());config.update(source_revision=revision,source_files=files,source_map_sha256=cfg["source_map_sha256"],lock_sha256=cfg["lock_sha256"],requested_config_sha256=op.digest(config_path.read_bytes()))
        now=op.now_ms()
        state=op.State.create(root/"state.json",{"run_id":config["run_id"],"deadline_ms":min(op.EXPIRY,now+600000),"guard_proof_sha256":"b"*64,"resources":{"instance":"i-0123456789abcdef0"}})
        manifest=op.make_manifest(config,state.data,"i-0123456789abcdef0",op.digest(binary.read_bytes()),now,endpoint)
        manifest_path=root/"manifest.json";manifest_path.write_bytes(op.canonical(manifest));manifest_path.chmod(0o600)
        invocation=[str(binary),"--local-approved-worker",str(config_path),"--run-manifest",str(manifest_path),"--loopback-s3",endpoint]
        calls=[];output=[];worker_outputs=[];reply=[""]
        class Handler(http.server.BaseHTTPRequestHandler):
          def log_message(self,*args): pass
          def do_POST(self):
            length=int(self.headers["Content-Length"])
            if length>65536: self.send_error(413);return
            args=json.loads(self.rfile.read(length));calls.append(args)
            i=args.index("ssm");action=args[i+1]
            if action=="send-command":
              params=json.loads(args[args.index("--parameters")+1])
              command=json.loads(params["commands"][0])
              if isinstance(command,dict):
                assert set(command)=={"export_offset"} and type(command["export_offset"]) is int
                offset=command["export_offset"];assert 0<=offset<len(worker_outputs[0])
                reply[0]=base64.b64encode(worker_outputs[0][offset:offset+12288]).decode()
                result={"Command":{"CommandId":"01234567-0123-0123-0123-012345678901"}}
                data=op.canonical(result);self.send_response(200);self.send_header("Content-Length",str(len(data)));self.end_headers();self.wfile.write(data);return
              assert command==invocation
              def execute_worker():
                run=subprocess.run(invocation,cwd=repo/"server2",capture_output=True,timeout=60)
                if run.returncode or len(run.stdout)>2*op.MiB: output.append({"Status":"Failed","StandardOutputContent":run.stdout.decode()[:512]+run.stderr.decode()[:512]})
                else:
                  worker_outputs.append(run.stdout)
                  output.append({"Status":"Success","StandardOutputContent":op.canonical({"size":len(run.stdout),"sha256":op.digest(run.stdout)}).decode()})
              worker=threading.Thread(target=execute_worker,daemon=True);worker.start()
              result={"Command":{"CommandId":"01234567-0123-0123-0123-012345678901"}}
            elif action=="get-command-invocation": result={"Status":"Success","StandardOutputContent":reply[0]} if reply[0] else output[0] if output else {"Status":"InProgress"}
            else: raise AssertionError("unexpected fake action")
            data=op.canonical(result);self.send_response(200);self.send_header("Content-Length",str(len(data)));self.end_headers();self.wfile.write(data)
        server=http.server.ThreadingHTTPServer(("127.0.0.1",0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        fake=root/"fake-aws"
        fake.write_text("#!/usr/bin/env python3\nimport urllib.request,json,sys,os\nu=os.environ['S09_FAKE_CLI_ENDPOINT']\nr=urllib.request.urlopen(urllib.request.Request(u,json.dumps(sys.argv[1:]).encode(),method='POST'),timeout=65)\nprint(r.read().decode())\n");fake.chmod(0o700)
        try:
          with patch.dict(os.environ,{"S09_FAKE_CLI_ENDPOINT":"http://127.0.0.1:"+str(server.server_port)+"/"}):
            controller=op.Operator(config,state,op.Cli(config,str(fake)))
            response=controller.ssm([op.canonical(invocation).decode()],seconds=60)
            receipt=json.loads(response);assert 0<receipt["size"]<=2*op.MiB
            exported=bytearray()
            for offset in range(0,receipt["size"],12288):
              part=controller.ssm([op.canonical({"export_offset":offset}).decode()],seconds=30)
              exported.extend(base64.b64decode(part,validate=True))
            assert len(exported)==receipt["size"] and op.digest(exported)==receipt["sha256"]
          report=json.loads(exported)
          assert report["measurement_scope"]=="local_worker_handshake" and report["intended_host_gate_pass"] is False
          assert report["AWS_requests"]==0 and report["metadata_requests"]==0
          for field in ("run_id","allocation_id","source_revision","source_map_sha256","binary_sha256","lock_sha256","requested_config_sha256"):
            assert report[field]==manifest[field]
          assert (root/"worker.claim").is_file()
          # Exclusive same-allocation replay rejects before any additional peer request.
          before=json.load(urllib.request.urlopen(endpoint+"__benchmark/status",timeout=2))["requests"]
          repeat=subprocess.run(invocation,cwd=repo/"server2",capture_output=True,timeout=60)
          after=json.load(urllib.request.urlopen(endpoint+"__benchmark/status",timeout=2))["requests"]
          assert repeat.returncode!=0 and before==after
          return {"status":"PASS_local_worker_handshake","controller_calls":len(calls),"same_allocation_replay_denied_before_IO":True,"worker_report":report,"fake_controller_ledger":state.data["ledger"],"actual_AWS_IMDS_kernel_host_proof":False}
        finally: server.shutdown();server.server_close();thread.join(timeout=2)
    finally:
      peer.terminate()
      try: peer.wait(timeout=3)
      except subprocess.TimeoutExpired: peer.kill();peer.wait()
      peer.stdout.close();peer.stderr.close()


# Unit invocation above must occur after all definitions.

if __name__ == "__main__":
    import sys
    if sys.argv[1:]==["--functional-smoke"]: print(json.dumps(functional_smoke(),sort_keys=True))
    elif len(sys.argv)==3 and sys.argv[1]=="--compiled-worker": print(json.dumps(compiled_worker_handshake(sys.argv[2]),sort_keys=True))
    else: unittest.main()
