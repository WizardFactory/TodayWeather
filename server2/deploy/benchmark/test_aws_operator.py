"""Offline S09 controller regressions; no AWS connection or credential discovery."""
import os
from pathlib import Path
assert os.environ.get('S09_ISOLATED') == '1' and not Path('/sys').exists(), 'use run_isolated.py; no host execution'
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

# Offline fixture time only: never extend the operator approval or real worker clocks.
FIXTURE_NOW = op.EXPIRY-4*3600000

CAPS = {"reads": 4, "writes": 3, "download": 200000, "store": 40000}

class ConsoleOutputTests(unittest.TestCase):
    def test_decoded_text_and_missing_output_are_not_decoded_again(self):
        text = "Linux boot text\nS09_GUARD_V1 fixture\n\uac00"
        self.assertEqual(op.cli_console_text({"Output":text}),text)
        self.assertEqual(op.cli_console_text({}),"")
        self.assertEqual(op.cli_console_text({"Output":""}),"")
        self.assertEqual(op.cli_console_text({"Output":"U09fR1VBUkRfVjEgZml4dHVyZQ=="}),"U09fR1VBUkRfVjEgZml4dHVyZQ==")

    def test_schema_and_exact_utf8_byte_bound_fail_closed(self):
        self.assertEqual(len(op.cli_console_text({"Output":"x"*65536})),65536)
        self.assertEqual(op.cli_console_text({"Output":"\uac00"*43690+"xx"}),"\uac00"*43690+"xx")
        for value in (None,[],"text",{"Output":None},{"Output":False},{"Output":1},{"Output":{}},{"Output":"x"*65537},{"Output":"\uac00"*43691},{"Output":"\ud800"}):
            with self.subTest(value_type=type(value).__name__),self.assertRaises(op.OperatorError):op.cli_console_text(value)

    def test_invalid_console_never_reaches_guard_opening_or_ssm(self):
        for response in ({"Output":None},{"Output":"x"*65537}):
            with tempfile.TemporaryDirectory(prefix="s09-console-reject-") as directory:
                controller=WorkerEvidenceTests().controller(Path(directory));actions=[]
                controller.verify_host_root=lambda:None
                controller.call=lambda service,action,args:actions.append(action) or response
                controller.open_https_after_guard=lambda _:self.fail("invalid console opened egress")
                with self.assertRaises(op.OperatorError):controller.run_host()
                self.assertEqual(actions,["get-console-output"])
                self.assertNotIn("worker_allocation_issued",controller.state.data)

    def test_guard_failure_and_console_host_mismatch_have_distinct_rejections(self):
        for identity, marker, reason in (
                ('owned','S09_GUARD_FAILED fixture','stock guard failed'),
                ('foreign','S09_GUARD_V1 fixture','guard console host mismatch'),
                ('missing','S09_GUARD_V1 fixture','guard console host mismatch')):
            with self.subTest(identity=identity), tempfile.TemporaryDirectory(prefix='s09-console-host-') as directory:
                controller=WorkerEvidenceTests().controller(Path(directory)); actions=[]
                response={'Output':marker}
                if identity!='missing':
                    response['InstanceId']=controller.state.data['resources']['instance'] if identity=='owned' else 'i-foreign'
                controller.verify_host_root=lambda:None
                controller.call=lambda service,action,args:actions.append(action) or response
                controller.open_https_after_guard=lambda _:self.fail('rejected console opened egress')
                controller.wait_online=lambda *a,**kw:self.fail('rejected console polled SSM')
                with self.assertRaisesRegex(op.OperatorError,'^'+reason+'$'):
                    controller.run_host()
                self.assertEqual(actions,['get-console-output'])
                self.assertNotIn('worker_allocation_issued',controller.state.data)

    def test_guard_rejections_remain_reproducible_after_approval_expiry(self):
        from unittest.mock import patch
        with patch.object(op.time,'time',return_value=(op.EXPIRY+86400000)/1000):
            with tempfile.TemporaryDirectory(prefix='s09-after-expiry-fixture-') as directory:
                controller=WorkerEvidenceTests().controller(Path(directory))
                self.assertEqual(controller.clock(),FIXTURE_NOW)
                self.assertGreater(op.now_ms(),op.EXPIRY)
            self.test_invalid_console_never_reaches_guard_opening_or_ssm()
            self.test_guard_failure_and_console_host_mismatch_have_distinct_rejections()


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


class ExportWindowTests(unittest.TestCase):
    def manifest(self, minutes, now=None):
        current=op.EXPIRY-120*60000 if now is None else now
        config=json.loads((HERE/"aws-run.json").read_text())
        config.update(source_revision="a"*40,source_map_sha256="b"*64,source_files={},lock_sha256="c"*64,requested_config_sha256="d"*64)
        state={"deadline_ms":current+int(minutes*60000),"guard_proof_sha256":"e"*64}
        return op.make_manifest(config,state,"i-0123456789abcdef0","f"*64,current,"http://127.0.0.1:1/"),current

    def test_short_host_windows_keep_export_reserve(self):
        for minutes,expected_ms in [(90,3570000),(61,2760000),(45,1800000),(20,300000)]:
            with self.subTest(minutes=minutes):
                manifest,now=self.manifest(minutes)
                self.assertEqual(manifest["benchmark_expires_at_ms"]-now,expected_ms)
                self.assertGreaterEqual(min(manifest["host_expires_at_ms"],op.EXPIRY)-manifest["benchmark_expires_at_ms"],900000)
        for minutes in (5,19.999):
            with self.subTest(minutes=minutes),self.assertRaises(op.OperatorError):self.manifest(minutes)

    def test_approval_boundary_and_dispatch_recheck(self):
        manifest,now=self.manifest(45,now=op.EXPIRY-25*60000)
        self.assertEqual(manifest["benchmark_expires_at_ms"],op.EXPIRY-900000)
        self.assertEqual(op.worker_timeout_seconds(manifest,now),630)
        self.assertEqual(op.worker_timeout_seconds(manifest,now+5*60000),330)
        with self.assertRaises(op.OperatorError):op.worker_timeout_seconds(manifest,now+5*60000+1)
        altered=dict(manifest,host_expires_at_ms=manifest["benchmark_expires_at_ms"]+899999)
        with self.assertRaises(op.OperatorError):op.worker_timeout_seconds(altered,now)
        with self.assertRaises(op.OperatorError):self.manifest(60,now=op.EXPIRY-5*60000)

    def test_grace_fits_existing_plugin_cap_and_reserved_tail(self):
        manifest,now=self.manifest(90)
        seconds=op.worker_timeout_seconds(manifest,now)
        self.assertEqual(seconds,3600)
        self.assertGreaterEqual(min(manifest["host_expires_at_ms"],op.EXPIRY)-(now+seconds*1000),870000)
        self.assertNotIn("worker_allocation_issued",manifest)

class WorkerEvidenceTests(unittest.TestCase):
    def controller(self, root):
        config=json.loads((HERE/"aws-run.json").read_text())
        state=op.State.create(root/"state.json",{"run_id":config["run_id"],"deadline_ms":op.EXPIRY,"resources":{"instance":"i-0123456789abcdef0"}})
        return op.Operator(config,state,None,clock=lambda:FIXTURE_NOW)

    def export_fixture(self, controller, report, errors=b"sanitized abort\n"):
        import base64
        artifacts={"result.json":report,"result-errors.log":errors}
        def ssm(commands,seconds=30):
            script=commands[0]
            path=next(name for name in artifacts if name in script)
            body=artifacts[path]
            if "stat().st_size" in script:
                return json.dumps({"exists":body is not None,"size":len(body) if body is not None else 0})
            offset=int(op.re.search(r"f.seek\(([0-9]+)\)",script).group(1))
            return base64.b64encode(body[offset:offset+12288]).decode()
        controller.ssm=ssm

    def test_failed_noncompliant_report_persisted_before_rejection(self):
        with tempfile.TemporaryDirectory(prefix="s09-abort-export-") as temp:
            root=Path(temp);controller=self.controller(root)
            manifest={"run_id":controller.config["run_id"]}
            body=op.canonical(dict(manifest,run_status="ABORTED",abort_reason="uncertain publication",overall_accounting_compliance_pass=False))
            self.export_fixture(controller,body)
            with self.assertRaises(op.OperatorError):
                controller.export_worker_result("/opt/server2-s09/run/fixture",manifest,{"Status":"Failed","ResponseCode":2})
            self.assertEqual((root/"state.result.json").read_bytes(),body)
            self.assertEqual((root/"state.worker-errors.log").read_bytes(),b"sanitized abort\n")
            saved=json.loads((root/"state.json").read_text())
            self.assertIs(saved["worker_accounting_compliance"],False)
            self.assertEqual(saved["worker_report_sha256"],op.digest(body))
            self.assertEqual(saved["worker_terminal"]["Status"],"Failed")

    def test_missing_report_preserves_errors_and_diagnostic(self):
        with tempfile.TemporaryDirectory(prefix="s09-preclaim-export-") as temp:
            root=Path(temp);controller=self.controller(root)
            self.export_fixture(controller,None,b"setup rejected\n")
            with self.assertRaises(op.OperatorError): controller.export_worker_result("/opt/server2-s09/run/fixture",{}, {"Status":"Failed","ResponseCode":1})
            self.assertEqual((root/"state.worker-errors.log").read_bytes(),b"setup rejected\n")
            self.assertFalse((root/"state.result.json").exists())
            self.assertEqual(controller.state.data["worker_artifacts"]["result"]["status"],"missing")
            self.assertIs(controller.state.data["worker_accounting_compliance"],False)

    def test_invalid_or_oversize_report_never_compliant(self):
        for body in (b"invalid JSON", b"x"*(2*op.MiB+1)):
            with tempfile.TemporaryDirectory(prefix="s09-invalid-export-") as temp:
                root=Path(temp);controller=self.controller(root);self.export_fixture(controller,body)
                with self.assertRaises(op.OperatorError):controller.export_worker_result("/opt/server2-s09/run/fixture",{}, {"Status":"Success","ResponseCode":0})
                self.assertIs(controller.state.data["worker_accounting_compliance"],False)
                self.assertEqual((root/"state.worker-errors.log").read_bytes(),b"sanitized abort\n")
                self.assertEqual((root/"state.result.json").exists(),len(body)<=2*op.MiB)

    def test_failed_ssm_terminal_capture_keeps_default_rejection(self):
        class Runner:
            def call(self,service,action,args):
                if action=="send-command": return {"Command":{"CommandId":"01234567-0123-0123-0123-012345678901"}}
                return {"Status":"Failed","ResponseCode":2,"StandardErrorContent":"not copied as terminal metadata"}
        with tempfile.TemporaryDirectory(prefix="s09-ssm-failure-") as temp:
            controller=self.controller(Path(temp));controller.runner=Runner()
            self.assertEqual(controller.ssm(["worker"],capture_terminal=True),{"Status":"Failed","ResponseCode":2})
            with self.assertRaises(op.OperatorError): controller.ssm(["ordinary command"])

    def test_stock_ssm_version_gate_has_no_permission_fallback(self):
        with tempfile.TemporaryDirectory(prefix="s09-agent-version-") as temp:
            controller=self.controller(Path(temp))
            for version in (None,"3.3.39.0","3.3.40","3.3.40.0-extra","9"*100):
                with self.subTest(version=version),self.assertRaises(op.OperatorError):controller.verify_ssm_agent({"AgentVersion":version})
            for version in ("3.3.40.0","3.3.2299.0","4.0.0.0"):
                controller.verify_ssm_agent({"AgentVersion":version})
                self.assertEqual(controller.state.data["stock_SSM_agent_version"],version)

    def test_old_online_agent_blocks_runcommand_and_allocation(self):
        with tempfile.TemporaryDirectory(prefix="s09-online-agent-") as temp:
            controller=self.controller(Path(temp));actions=[]
            controller.verify_host_root=lambda:None
            controller.open_https_after_guard=lambda _:None
            from test_online_window import install_ready_fixture
            # Deterministic guard/readiness clocks; elapsed wall milliseconds
            # between fixture creation and guard opening are not host evidence.
            controller.clock=lambda:op.EXPIRY-600000
            ready=install_ready_fixture(controller)
            def call(service,action,args):
                actions.append(action)
                if action=="get-console-output":return ready
                if action=="describe-instance-information":return {"InstanceInformationList":[{"InstanceId":controller.state.data["resources"]["instance"],"PingStatus":"Online","AgentVersion":"3.3.39.0"}]}
                raise AssertionError("RunCommand before supported stock agent")
            controller.call=call
            with self.assertRaises(op.OperatorError):controller.run_host()
            self.assertEqual(actions,["get-console-output","get-console-output","describe-instance-information"])
            self.assertNotIn("worker_allocation_issued",controller.state.data)

    def test_existing_evidence_and_symlink_never_overwritten(self):
        with tempfile.TemporaryDirectory(prefix="s09-preserve-artifact-") as temp:
            root=Path(temp);controller=self.controller(root);self.export_fixture(controller,b"invalid JSON")
            target=root/"original";target.write_bytes(b"original")
            (root/"state.result.json").symlink_to(target)
            with self.assertRaises(op.OperatorError):controller.export_worker_result("/opt/server2-s09/run/fixture",{}, {"Status":"Failed","ResponseCode":2})
            self.assertEqual(target.read_bytes(),b"original")
            self.assertTrue((root/"state.result.json").is_symlink())
            self.assertEqual(controller.state.data["worker_artifacts"]["result"]["status"],"export_failed")
            self.assertIs(controller.state.data["worker_accounting_compliance"],False)

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

    def test_exact_declared_source_map_accepts_and_missing_files_reject(self):
        current=self.pinned_config()
        declaration=json.loads((HERE.parents[1]/"config/tasks/S09.json").read_text())
        expected=declaration['server2_paths']+[v['path'] for v in declaration['outside']]
        self.assertEqual(set(current['source_files']),set(expected))
        self.assertIn('server2/deploy/benchmark/ssm_startup_recovery.py',current['source_files'])
        self.assertEqual(op.validate_config(current,armed=True,now_ms=1791435000000),current)
        for missing in ('server2/deploy/benchmark/run_isolated.py','server2/deploy/benchmark/ssm_startup_recovery.py'):
            bad=dict(current,source_files={k:v for k,v in current['source_files'].items() if k!=missing})
            bad['source_map_sha256']=op.digest(op.canonical(bad['source_files']))
            with self.assertRaises(op.OperatorError):op.validate_config(bad,armed=True,now_ms=1791435000000)
        extra=dict(current,source_files=dict(current['source_files'],**{'server2/unreviewed.py':'a'*64}))
        extra['source_map_sha256']=op.digest(op.canonical(extra['source_files']))
        with self.assertRaises(op.OperatorError):op.validate_config(extra,armed=True,now_ms=1791435000000)
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
            runner=Runner();controller=op.Operator(config,state,runner,clock=lambda:FIXTURE_NOW)
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
            with self.assertRaises(op.OperatorError): op.Operator(config,state,Runner(),clock=lambda:FIXTURE_NOW).verify_host_root()
            self.assertNotIn("root_volume",state.data["resources"])

    def test_unknown_creation_absence_is_not_cleanup_success(self):
        class Runner:
            def call(self,*args): raise op.OperatorError("AWS status NoSuchEntity")
        with tempfile.TemporaryDirectory(prefix="s09-cleanup-unknown-") as temp:
            state=op.State.create(Path(temp)/"state.json",{"deadline_ms":op.EXPIRY,"creation_intents":{"role":"unknown"},"resources":{}})
            with self.assertRaises(op.OperatorError): op.Operator(self.config(),state,Runner(),clock=lambda:FIXTURE_NOW).cleanup()
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
        self.assertIn("\nruncmd:", text)
        self.assertNotIn("\nbootcmd:", text)
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
        self.assertEqual(text.count("--property=MemoryMax=3221225472 --property=MemorySwapMax=0"),1)
        self.assertEqual(text.count("--setenv=RUSTUP_TOOLCHAIN=1.99.0"),1)
        self.assertNotIn("cargo test",text)

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
            self.assertEqual(op.Operator(config,state,Runner(),clock=lambda:FIXTURE_NOW).ssm(["fixture"],seconds=15),"done")
        self.assertEqual(len(calls),2)

    def test_phase_guard_generated_python_compiles_and_does_not_reset(self):
        with tempfile.TemporaryDirectory(prefix="s09-phase-script-") as temp:
            config=json.loads((HERE/"aws-run.json").read_text())
            state=op.State.create(Path(temp)/"state.json",{"run_id":config["run_id"],"deadline_ms":FIXTURE_NOW+7200000})
            controller=op.Operator(config,state,None,clock=lambda:FIXTURE_NOW)
            observed=[]
            def fake_ssm(commands,seconds):
                script=commands[0].split("\n",1)[1].rsplit("PY",1)[0]
                compile(script,"phase-guard-script","exec")
                observed.append(script)
                return json.dumps({"status":"guarded","observed_at_ms":FIXTURE_NOW,"host_rx_bytes":100})
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
            state=op.State.create(Path(temp)/"state.json",{"run_id":config["run_id"],"nonce":"d"*64,"deadline_ms":FIXTURE_NOW+7200000})
            controller=op.Operator(config,state,None,clock=lambda:FIXTURE_NOW)
            with self.assertRaises(op.OperatorError): controller.render_bootstrap()


def functional_smoke(recovery=False,recovery_fault=None,retained_bucket=False):
    """Distinct loopback fake-CLI orchestration; never an AWS/kernel/SSM proof."""
    import base64
    import http.server
    import os
    import sys
    from unittest.mock import patch
    with tempfile.TemporaryDirectory(prefix="s09-operator-functional-") as temp:
        root=Path(temp);calls=[];user_data_payloads=[];terminated=[False];root_pending=[True]
        config=json.loads((HERE/"aws-run.json").read_text())
        config.update(source_revision="a"*40,rustup_sha256="b"*64,rustup_url="https://static.rust-lang.org/rustup/archive/1.29.1/x86_64-unknown-linux-gnu/rustup-init",source_files={"server2/Cargo.toml":"c"*64})
        config["source_files"]["server2/deploy/benchmark/ssm_startup_recovery.py"] = op.digest((HERE/"ssm_startup_recovery.py").read_bytes())
        instance="i-0123456789abcdef0"
        if recovery:
            original,config,recovery_state,authority,current=RecoveryTests().fixture(root)
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
                elif retained_bucket and service == "s3api": out=RetainedBucketRunner(config).call(service,action,args[pos+2:-2])
                elif action=="head-bucket": code=255;error="404"
                elif action in {"get-role","get-instance-profile"}:
                    if recovery or any("create-role" in c for c in calls):
                        field="Role" if action=="get-role" else "InstanceProfile"
                        out={field:{"Arn":"arn:aws:iam::"+config["account"]+(":role/" if field=="Role" else ":instance-profile/")+config["role"],"Tags":[{"Key":"RunId","Value":config["run_id"]},{"Key":"Purpose","Value":"synthetic-benchmark-only"}],"Roles":[{"RoleName":config["role"],"Arn":"arn:aws:iam::"+config["account"]+":role/"+config["role"]}]}}
                    else: code=255;error="NoSuchEntity"
                elif action=="describe-security-groups":
                    out={"SecurityGroups":[]} if "--filters" in args else {"SecurityGroups":[{"GroupId":"sg-0123456789abcdef0","GroupName":config["security_group"],"VpcId":config["vpc"],"Tags":[{"Key":"RunId","Value":config["run_id"]},{"Key":"Purpose","Value":"synthetic-benchmark-only"}],"IpPermissions":[],"IpPermissionsEgress":[] if recovery or any("revoke-security-group-egress" in c for c in calls) else [{"IpProtocol":"-1","IpRanges":[{"CidrIp":"0.0.0.0/0"}]}]}]}
                elif action=="create-security-group": out={"GroupId":"sg-0123456789abcdef0"}
                elif action=="create-role": out={"Role":{"Arn":"arn:aws:iam::"+config["account"]+":role/"+config["role"]}}
                elif action=="run-instances":
                    value=args[args.index('--user-data')+1]
                    assert value.startswith('fileb://')
                    user_data_payloads.append(Path(value[8:]).read_bytes())
                    if recovery_fault=='local':code=252;error='Unknown options: --synthetic-invalid-option'
                    elif recovery_fault=='mismatch':code=255;error='An error occurred (IdempotentParameterMismatch) when calling RunInstances'
                    else:out={"Instances":[{"InstanceId":instance}]}
                elif action in {"get-bucket-location","get-bucket-versioning","get-public-access-block","get-bucket-encryption"}:
                    out=RecoveryRunner(config,recovery_state.data).call(service,action,args)
                    if recovery_fault=='prelaunch' and action=='get-bucket-versioning':out={'Status':'Suspended'}
                elif recovery and action=="describe-instances" and (recovery_fault in {'local','mismatch','prelaunch'} or not any("run-instances" in c for c in calls)):out={"Reservations":[]}
                elif action=="describe-instances": out={"Reservations":[{"Instances":[{"InstanceId":instance,"Tags":[{"Key":"RunId","Value":config["run_id"]},{"Key":"Purpose","Value":"synthetic-benchmark-only"}],"ClientToken":recovery_state.data["client_token"] if recovery else "s09-functional","BlockDeviceMappings":[{"DeviceName":"/dev/sda1","Ebs":{"VolumeId":"vol-0123456789abcdef0"}}],"State":{"Name":"terminated" if terminated[0] else "running"}}]}]}
                elif recovery and action=="describe-volumes" and (recovery_fault in {'local','mismatch','prelaunch'} or not any("run-instances" in c for c in calls)):out={"Volumes":[]}
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
                if recovery:
                    state=recovery_state;controller=op.Operator(config,state,op.Cli(config,str(fake)),clock=lambda:current)
                    controller.prepare_recovery(original,authority)
                    if recovery_fault:
                        try:controller.resume_failed_creation();raise AssertionError("fault did not stop recovery")
                        except op.OperatorError:pass
                        before=len(calls)
                        try:controller.resume_failed_creation();raise AssertionError("faulted recovery replay")
                        except op.OperatorError:pass
                        assert len(calls)==before
                        result=controller.cleanup()
                        assert result['status']=='cleaned_host_resources_S3_retained' and result['current_absence_cleanup'] is True and result['historical_launch_unknown_preserved'] is True
                        predecessor=op.bounded_json(state.path.with_suffix('.recovery1.predecessor.json'))
                        assert predecessor['launch_attempted'] is True and state.data['launch_attempted'] is True
                        assert state.data['resources']=={'bucket':config['bucket']} and not state.data['worker_allocation_issued']
                        assert not any('create-' in value or value in {'send-command','delete-object','delete-bucket','authorize-security-group-egress'} for call in calls for value in call)
                        return {'status':'PASS_failed_recovery_current_owned_cleanup','fault':recovery_fault,'calls':len(calls),'launch_dispatch_attempts':sum('run-instances' in c for c in calls),'original_usage_preserved':state.data['operator_calls']==36+len(calls),'historical_launch_unknown_preserved':True,'S3_retained':True,'actual_AWS_IMDS_calls':0}
                    result=controller.resume_failed_creation();assert result=={"status":"recovery_host_acknowledged","instance_id":instance}
                    assert not any(any(a.startswith("create-") or a in {"put-role-policy","add-role-to-instance-profile","send-command"} for a in call) for call in calls)
                    before=len(calls)
                    try:controller.resume_failed_creation();raise AssertionError("replayed recovery")
                    except op.OperatorError:pass
                    assert len(calls)==before and not state.data['worker_allocation_issued']
                else:
                    state=op.State.create(root/"state.json",{"run_id":config["run_id"],"deadline_ms":FIXTURE_NOW+7200000,"client_token":"s09-functional","nonce":"d"*64,"resources":{"root_volume":"vol-0123456789abcdef0"}})
                    controller=op.Operator(config,state,op.Cli(config,str(fake)),clock=lambda:FIXTURE_NOW)
                    virtual_profile_clock(controller)
                    self_id=controller.provision();assert self_id==instance
                assert not any("authorize-security-group-egress" in c for c in calls)
                payload=next(c[c.index("--user-data")+1] for c in calls if "run-instances" in c)
                import gzip
                assert payload.startswith('fileb://') and not Path(payload[8:]).exists()
                decoded=user_data_payloads[0];assert len(decoded)<=16384
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
                if retained_bucket:
                    assert not any(a in call for call in calls for a in {"create-bucket","put-bucket-policy","put-bucket-versioning","put-bucket-encryption","put-public-access-block"})
                    assert state.data["version_inventory"]["versions"] == 0
                return {"status":"PASS_fake_only","retained_bucket":retained_bucket,"calls":len(calls),"decoded_userdata_bytes":len(decoded),"guard_denied_dispatch":0,"S3_deletes":0,"new_hosts":sum("run-instances" in c for c in calls),"ledger":state.data["ledger"],"kernel_SSM_AWS_proven":False,"recovery":recovery,"original_usage_preserved":state.data["operator_calls"]==36+len(calls) if recovery else None}
        finally: server.shutdown();server.server_close();thread.join(timeout=2)

def failure_functional_smoke():
    """Distinct failed-command export/cleanup through an actual fake CLI process."""
    import base64,http.server,os,sys
    from unittest.mock import patch
    with tempfile.TemporaryDirectory(prefix="s09-failed-cli-") as temporary:
        root=Path(temporary);config=json.loads((HERE/"aws-run.json").read_text())
        manifest={"run_id":config["run_id"]}
        body=op.canonical(dict(manifest,run_status="ABORTED",abort_reason="uncertain publication",overall_accounting_compliance_pass=False))
        errors=b"sanitized worker abort\n";calls=[];reply=[None]
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(self):
                args=json.loads(self.rfile.read(int(self.headers["Content-Length"])));calls.append(args)
                service=next(x for x in ("ssm","ec2") if x in args);action=args[args.index(service)+1]
                if action=="send-command":
                    script=json.loads(args[args.index("--parameters")+1])["commands"][0]
                    if script=="run failed worker":reply[0]={"Status":"Failed","ResponseCode":2}
                    else:
                        data=errors if "result-errors.log" in script else body
                        if "stat().st_size" in script:output=json.dumps({"exists":True,"size":len(data)})
                        else:
                            offset=int(op.re.search(r"f.seek\(([0-9]+)\)",script).group(1))
                            output=base64.b64encode(data[offset:offset+12288]).decode()
                        reply[0]={"Status":"Success","ResponseCode":0,"StandardOutputContent":output}
                    result={"Command":{"CommandId":"01234567-0123-0123-0123-012345678901"}}
                elif action=="get-command-invocation":result=reply[0]
                elif action=="describe-instances":result={"Reservations":[{"Instances":[{"InstanceId":"i-0123456789abcdef0","State":{"Name":"terminated"},"Tags":[{"Key":"RunId","Value":config["run_id"]},{"Key":"Purpose","Value":"synthetic-benchmark-only"}]}]}]}
                elif action=="describe-volumes":result={"Volumes":[]}
                else:raise AssertionError("unexpected fake action")
                payload=op.canonical(result);self.send_response(200);self.send_header("Content-Length",str(len(payload)));self.end_headers();self.wfile.write(payload)
        server=http.server.ThreadingHTTPServer(("127.0.0.1",0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        fake=root/"fake-aws";fake.write_text("#!/usr/bin/env python3\nimport urllib.request,json,sys,os\nr=urllib.request.urlopen(urllib.request.Request(os.environ['S09_FAKE_CLI_ENDPOINT'],json.dumps(sys.argv[1:]).encode(),method='POST'),timeout=2)\nprint(r.read().decode())\n");fake.chmod(0o700)
        try:
            with patch.dict(os.environ,{"S09_FAKE_CLI_ENDPOINT":"http://127.0.0.1:"+str(server.server_port)+"/"}):
                state=op.State.create(root/"state.json",{"run_id":config["run_id"],"deadline_ms":op.EXPIRY,"resources":{"instance":"i-0123456789abcdef0","root_volume":"vol-0123456789abcdef0"}})
                controller=op.Operator(config,state,op.Cli(config,str(fake)),clock=lambda:FIXTURE_NOW)
                current=FIXTURE_NOW
                window={"host_expires_at_ms":current+61*60000,"benchmark_expires_at_ms":current+46*60000}
                worker_seconds=op.worker_timeout_seconds(window,current)
                terminal=controller.ssm(["run failed worker"],seconds=worker_seconds,capture_terminal=True)
                dispatch=next(v for v in calls if "send-command" in v)
                parameters=json.loads(dispatch[dispatch.index("--parameters")+1])
                assert parameters["executionTimeout"]==[str(worker_seconds)] and worker_seconds==2790
                assert int(dispatch[dispatch.index("--timeout-seconds")+1])==worker_seconds<=3600
                try:controller.export_worker_result("/opt/server2-s09/run/fixture",manifest,terminal);raise AssertionError("failed worker admitted")
                except op.OperatorError:pass
                assert (root/"state.result.json").read_bytes()==body
                assert (root/"state.worker-errors.log").read_bytes()==errors
                assert state.data["worker_accounting_compliance"] is False
                assert controller.cleanup()["status"]=="cleaned_host_resources_S3_retained"
                assert state.data["root_volume_absence_verified"] is True
                return {"status":"PASS_failed_fake_cli_only","calls":len(calls),"failed_report_preserved":True,"error_bytes":len(errors),"compliance":False,"cleanup_observed":True,"worker_timeout_seconds":worker_seconds,"minimum_tail_after_grace_seconds":870,"AWS_IMDS_actual_host":False}
        finally:server.shutdown();server.server_close();thread.join(timeout=2)

def compiled_worker_handshake(binary, fault=False, case_fault=False):
    """Actual controller Cli/SSM envelope -> compiled local-only worker; no AWS/IMDS."""
    import base64, hashlib, http.server, os, subprocess, sys, urllib.request
    from unittest.mock import patch
    repo=HERE.parents[2];binary=Path(binary).resolve()
    if not binary.is_file(): raise AssertionError("compiled worker missing")
    declaration=json.loads((repo/"server2/config/tasks/S09.json").read_text())
    paths=declaration["server2_paths"]+[v["path"] for v in declaration["outside"]]
    if not paths or len(paths) != len(set(paths)): raise AssertionError("source paths")
    peer_fault="uncertain-cold-final-trial" if case_fault else "uncertain-provider-publication"
    peer=subprocess.Popen([sys.executable,str(repo/"server2/tools/benchmark/local_peer.py")]+(["--fault",peer_fault] if fault else []),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    endpoint=peer.stdout.readline().strip()
    if not op.re.fullmatch(r"http://127\.0\.0\.1:[0-9]+/",endpoint): raise AssertionError("test peer endpoint")
    try:
      with tempfile.TemporaryDirectory(prefix="s09-compiled-handshake-") as temporary:
        root=Path(temporary);root.chmod(0o700)
        files={str(p):op.digest((repo/p).read_bytes()) for p in sorted(paths)}
        cfg=json.loads((repo/"server2/config/benchmarks/aws.json").read_text())
        cfg["cases"]=[dict(next(v for v in cfg["cases"] if v["mode"]==mode),target_samples=2,revisions=1) for mode in ("cold","warm","provider_data","provider_nodata")]
        if case_fault:
            cold=cfg["cases"][0]
            cfg["cases"]=[dict(cold,name="cold-A",clients=8,owners=1,target_samples=16,revisions=1,record_bytes=128),dict(cold,name="cold-B",clients=8,owners=1,target_samples=16,revisions=2,record_bytes=128)]
        revision=subprocess.check_output(["git","rev-parse","HEAD"],cwd=repo,text=True).strip()
        cfg.update(execution_enabled=True,source_revision=revision,source_map_sha256=op.digest(op.canonical(files)),lock_sha256=op.digest((repo/"server2/Cargo.lock").read_bytes()),review_candidate_sha256="a"*64)
        config_path=root/"aws-config.json";config_path.write_bytes(op.canonical(cfg));config_path.chmod(0o600)
        config=json.loads((HERE/"aws-run.json").read_text());config.update(source_revision=revision,source_files=files,source_map_sha256=cfg["source_map_sha256"],lock_sha256=cfg["lock_sha256"],requested_config_sha256=op.digest(config_path.read_bytes()))
        now=op.now_ms()
        state=op.State.create(root/"state.json",{"run_id":config["run_id"],"deadline_ms":min(op.EXPIRY,now+1800000),"guard_proof_sha256":"b"*64,"resources":{"instance":"i-0123456789abcdef0"}})
        manifest=op.make_manifest(config,state.data,"i-0123456789abcdef0",op.digest(binary.read_bytes()),now,endpoint)
        manifest_path=root/"manifest.json";manifest_path.write_bytes(op.canonical(manifest));manifest_path.chmod(0o600)
        invocation=[str(binary),"--local-approved-worker",str(config_path),"--run-manifest",str(manifest_path),"--loopback-s3",endpoint]
        calls=[];output=[];worker_outputs=[];worker_errors=[];reply=[""]
        class Handler(http.server.BaseHTTPRequestHandler):
          def log_message(self,*args): pass
          def do_POST(self):
            length=int(self.headers["Content-Length"])
            if length>65536: self.send_error(413);return
            args=json.loads(self.rfile.read(length));calls.append(args)
            i=args.index("ssm");action=args[i+1]
            if action=="send-command":
              params=json.loads(args[args.index("--parameters")+1])
              raw_command=params["commands"][0]
              if raw_command.startswith("python3 -c "):
                assert fault
                data=worker_errors[0] if "result-errors.log" in raw_command else worker_outputs[0]
                if "stat().st_size" in raw_command: reply[0]=json.dumps({"exists":True,"size":len(data)})
                else:
                    offset=int(op.re.search(r"f.seek\(([0-9]+)\)",raw_command).group(1));reply[0]=base64.b64encode(data[offset:offset+12288]).decode()
                result={"Command":{"CommandId":"01234567-0123-0123-0123-012345678901"}}
                data=op.canonical(result);self.send_response(200);self.send_header("Content-Length",str(len(data)));self.end_headers();self.wfile.write(data);return
              command=json.loads(raw_command)
              if isinstance(command,dict):
                assert set(command)=={"export_offset"} and type(command["export_offset"]) is int
                offset=command["export_offset"];assert 0<=offset<len(worker_outputs[0])
                reply[0]=base64.b64encode(worker_outputs[0][offset:offset+12288]).decode()
                result={"Command":{"CommandId":"01234567-0123-0123-0123-012345678901"}}
                data=op.canonical(result);self.send_response(200);self.send_header("Content-Length",str(len(data)));self.end_headers();self.wfile.write(data);return
              assert command==invocation
              def execute_worker():
                run=subprocess.run(invocation,cwd=repo/"server2",capture_output=True,timeout=60)
                worker_outputs.append(run.stdout);worker_errors.append(run.stderr)
                if run.returncode or len(run.stdout)>2*op.MiB: output.append({"Status":"Failed","ResponseCode":run.returncode,"StandardOutputContent":run.stdout.decode()[:512]+run.stderr.decode()[:512]})
                else:
                  output.append({"Status":"Success","ResponseCode":0,"StandardOutputContent":op.canonical({"size":len(run.stdout),"sha256":op.digest(run.stdout)}).decode()})
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
            if fault:
              terminal=controller.ssm([op.canonical(invocation).decode()],seconds=60,capture_terminal=True)
              assert terminal=={"Status":"Failed","ResponseCode":2}
              try:controller.export_worker_result("/opt/server2-s09/run/fixture",manifest,terminal);raise AssertionError("uncertain result admitted")
              except op.OperatorError:pass
              report=json.loads((root/"state.result.json").read_bytes())
              assert report["run_status"]=="ABORTED" and report["overall_accounting_compliance_pass"] is False
              assert report["requested_case_coverage_complete"] is False and report["abort_reason"]
              assert state.data["worker_accounting_compliance"] is False
              assert (root/"state.worker-errors.log").read_bytes()==worker_errors[0]
              peer_status=json.load(urllib.request.urlopen(endpoint+"__benchmark/status",timeout=2))
              fault_assertions=None
              if case_fault:
                checkpoint=peer_status["fault_checkpoint"]
                for field in ("requests","request_bytes","version_count","stored_version_charge_bytes"):
                    assert peer_status[field]==checkpoint[field],"dispatch/store grew after case fault"
                fault_assertions={field:checkpoint[field] for field in ("requests","request_bytes","version_count","stored_version_charge_bytes")}
              before=peer_status["requests"]
              repeat=subprocess.run(invocation,cwd=repo/"server2",capture_output=True,timeout=60)
              after=json.load(urllib.request.urlopen(endpoint+"__benchmark/status",timeout=2))["requests"]
              assert repeat.returncode!=0 and before==after
              return {"status":"PASS_aborted_local_worker_evidence","controller_calls":len(calls),"same_allocation_replay_denied_before_IO":True,"worker_report":report,"fake_controller_ledger":state.data["ledger"],"zero_after_fault_dispatch":fault_assertions,"actual_AWS_IMDS_kernel_host_proof":False}
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



class CleanupExceptionTests(unittest.TestCase):
    def config(self):
        return json.loads((HERE / "aws-run.json").read_text())

    def test_local_parser_rejection_is_typed_and_sanitized(self):
        with tempfile.TemporaryDirectory(prefix="s09-local-parser-") as temp:
            fake=Path(temp)/"fake-aws"
            fake.write_text("#!/usr/bin/env python3\nimport sys\nsys.stderr.write('usage: aws [options]\\nUnknown options: --min-count, PRIVATE_SENTINEL_403\\n')\nsys.exit(252)\n")
            fake.chmod(0o700)
            with self.assertRaises(op.OperatorError) as caught:
                op.Cli(self.config(),str(fake)).call("ec2","describe-images",[])
            self.assertEqual(str(caught.exception),"local CLI parsing rejected; request not dispatched")
            self.assertEqual(type(caught.exception).__name__,"LocalCliParsingRejected")
            for code,message in [(1,"Unknown options: PRIVATE_SENTINEL"),(252,"PRIVATE_SENTINEL transport disconnected")]:
                fake.write_text("#!/usr/bin/env python3\nimport sys\nsys.stderr.write("+repr(message)+")\nsys.exit("+str(code)+")\n")
                with self.assertRaises(op.OperatorError) as negative:
                    op.Cli(self.config(),str(fake)).call("ec2","describe-images",[])
                self.assertEqual(str(negative.exception),"AWS action failed; outcome unknown")
                self.assertNotIn("PRIVATE_SENTINEL",str(negative.exception))

    def test_unknown_launch_watchdog_never_claims_termination(self):
        for rows in ([],[{"InstanceId":"i-00000000000000001"},{"InstanceId":"i-00000000000000002"}]):
            config=self.config();actions=[]
            class Runner:
                def call(self,service,action,args):
                    actions.append(action)
                    return {"Reservations":[{"Instances":rows}]}
            with tempfile.TemporaryDirectory(prefix="s09-watchdog-unknown-") as temp:
                path=Path(temp)/"state.json"
                path.write_text(json.dumps({"run_id":config["run_id"],"config_sha256":op.digest(op.canonical(config)),"deadline_ms":0,"launch_attempted":True,"client_token":"synthetic-only","resources":{}}))
                op.watchdog(config,path,Runner())
                report=json.loads(path.with_suffix(".watchdog-finish.json").read_text())
                self.assertEqual(report["status"],"original_launch_unresolved")
                self.assertEqual(report["actual_calls"],1)
                self.assertEqual(actions,["describe-instances"])
                self.assertFalse(report["host_absence_verified"])

    def test_zero_multiple_unknown_cleanup_cannot_delete(self):
        for rows in ([],[{"InstanceId":"i-00000000000000001"},{"InstanceId":"i-00000000000000002"}],None):
            config=self.config();actions=[]
            class Runner:
                def call(self,service,action,args):
                    actions.append(action)
                    if rows is None: raise op.OperatorError("AWS action failed; outcome unknown")
                    return {"Reservations":[{"Instances":rows}]}
            with tempfile.TemporaryDirectory(prefix="s09-cleanup-fence-") as temp:
                state=op.State.create(Path(temp)/"state.json",{"run_id":config["run_id"],"deadline_ms":op.EXPIRY,"launch_attempted":True,"client_token":"synthetic-only","resources":{"role":config["role"],"profile":config["role"],"sg":"sg-00000000000000001"},"worker_allocation_issued":False})
                with self.assertRaises(op.OperatorError): op.Operator(config,state,Runner(),clock=lambda:FIXTURE_NOW).cleanup()
                self.assertEqual(actions,["describe-instances"])
                self.assertEqual(len(state.data["resources"]),3)
                self.assertFalse(state.data["worker_allocation_issued"])
                self.assertEqual(state.data["operator_calls"],1)


def cleanup_functional_smoke():
    """Actual fake CLI subprocess/watchdog cleanup path; no AWS or metadata."""
    config=json.loads((HERE/"aws-run.json").read_text())
    summaries=[]
    with tempfile.TemporaryDirectory(prefix="s09-cleanup-functional-") as temp:
        root=Path(temp);fake=root/"fake-aws";trace=root/"calls.jsonl"
        fake.write_text("#!/usr/bin/env python3\nimport json,sys\nfrom pathlib import Path\na=sys.argv[1:];p=Path("+repr(str(trace))+ ")\nwith p.open('a') as f: f.write(json.dumps(a)+'\\n')\nif 'describe-images' in a:\n sys.stderr.write('Unknown options: PRIVATE_SENTINEL_403\\n');sys.exit(252)\nif 'describe-instances' in a:\n if '--instance-ids' in a: print(json.dumps({'Reservations':[{'Instances':[{'InstanceId':a[a.index('--instance-ids')+1],'Tags':[{'Key':'RunId','Value':"+repr(config['run_id'])+"}]}]}]}))\n else: print(json.dumps({'Reservations':[]}))\nelif 'terminate-instances' in a: print('{}')\nelse: raise RuntimeError('unexpected action')\n")
        fake.chmod(0o700);runner=op.Cli(config,str(fake))
        try: runner.call("ec2","describe-images",[])
        except op.LocalCliParsingRejected as error:
            assert str(error)=="local CLI parsing rejected; request not dispatched"
        else: raise AssertionError("local parse not classified")
        for mode,resources,attempted,expected in [("unknown",{},True,"original_launch_unresolved"),("known",{"instance":"i-00000000000000001"},True,"owned_termination_requested"),("none",{},False,"no_launch_recorded")]:
            path=root/(mode+".json");state={"run_id":config["run_id"],"config_sha256":op.digest(op.canonical(config)),"deadline_ms":0,"launch_attempted":attempted,"client_token":"synthetic-only","resources":resources}
            path.write_text(json.dumps(state));op.watchdog(config,path,runner)
            report=json.loads(path.with_suffix(".watchdog-finish.json").read_text());assert report['status']==expected and report['host_absence_verified'] is False;summaries.append(report)
        state=op.State.create(root/'cleanup.json',{"run_id":config['run_id'],"deadline_ms":0,"launch_attempted":True,"client_token":"synthetic-only","resources":{"role":config['role'],"profile":config['role'],"sg":"sg-00000000000000001"},"worker_allocation_issued":False})
        try:op.Operator(config,state,runner,clock=lambda:FIXTURE_NOW).cleanup()
        except op.OperatorError as error:assert str(error)=="unknown launched host; keep reconciliation armed"
        else:raise AssertionError("unknown cleanup passed")
        calls=[json.loads(line) for line in trace.read_text().splitlines()];assert len(calls)==5 and sum('terminate-instances' in a for a in calls)==1
        assert len(state.data['resources'])==3 and state.data['operator_calls']==1 and not state.data['worker_allocation_issued']
        assert not any(action in a for a in calls for action in ['run-instances','delete-role','delete-instance-profile','delete-security-group','delete-object','send-command'])
        return {"status":"PASS_cleanup_only_local_functional","actual_subprocess_calls":len(calls),"watchdog_outcomes":summaries,"unknown_cleanup_blocked":True,"no_ancillary_deletion":True,"original_allocation_renewed":False,"actual_AWS_IMDS":False}


class RecoveryTests(unittest.TestCase):
    def fixture(self, directory, runner=None):
        current=op.EXPIRY-4*3600000
        old=json.loads((HERE/"aws-run.json").read_text())
        old.update(source_revision="a"*40,native_review_receipt_sha256="a"*64,rustup_sha256="c"*64,rustup_url="https://static.rust-lang.org/rustup/archive/1.29.1/x86_64-unknown-linux-gnu/rustup-init",source_files={"server2/Cargo.toml":"d"*64})
        old["source_files"]["server2/deploy/benchmark/ssm_startup_recovery.py"] = op.digest((HERE/"ssm_startup_recovery.py").read_bytes())
        new=dict(old,source_revision="b"*40,native_review_receipt_sha256="b"*64)
        resources={"bucket":old["bucket"],"role":"arn:aws:iam::"+old["account"]+":role/"+old["role"],"profile":old["role"],"sg":"sg-0123456789abcdef0"}
        data={"run_id":old["run_id"],"config_sha256":op.digest(op.canonical(old)),"client_token":"s09-synthetic-recovery", "nonce":"d"*64,"deadline_ms":current-1000,"launch_attempted":True,"status":"creation","bootstrap_reserved_bytes":3*op.GiB,"worker_allocation_issued":False,"watchdog_reserved_reads":50,"watchdog_reserved_download_bytes":50*131072,"resources":resources,"creation_intents":{k:"acknowledged" for k in resources},"operator_calls":36,"ledger":{"reads":30,"writes":6,"download":4718592,"store":0}}
        state=op.State.create(Path(directory)/"state.json",data)
        authority={"schema":1,"scope":"resume-failed-creation-once","run_id":old["run_id"],"original_state_sha256":op.digest(op.canonical(data)),"original_config_sha256":op.digest(op.canonical(old)),"reviewed_config_sha256":op.digest(op.canonical(new)),"source_revision":new["source_revision"],"native_review_receipt_sha256":new["native_review_receipt_sha256"],"AK_retry_authorized":True,"owned_absent_host_cleanup_authorized":True,"retry_authority_sha256":"e"*64,"original_operator_and_watchdog_quiescent":True,"retry_ordinal":1,"retry_started_at_ms":current,"retry_deadline_ms":current+7200000}
        return old,new,state,authority,current

    def test_recovery_preserves_history_usage_and_one_use(self):
        with tempfile.TemporaryDirectory() as directory:
            old,new,state,a,current=self.fixture(directory)
            controller=op.Operator(new,state,None,clock=lambda:current)
            controller.prepare_recovery(old,a)
            history=op.bounded_json(state.path.with_suffix(".recovery1.predecessor.json"))
            self.assertEqual(op.digest(op.canonical(history)),a["original_state_sha256"])
            self.assertEqual(state.data["ledger"],history["ledger"])
            self.assertEqual(state.data["operator_calls"],36)
            self.assertEqual(state.data["client_token"],history["client_token"])
            self.assertEqual(state.data["nonce"],history["nonce"])
            self.assertTrue(history["launch_attempted"])
            self.assertEqual(state.data["watchdog_reserved_reads"],100)
            self.assertEqual(controller.ledger.caps["reads"],9900)
            self.assertFalse(state.data["worker_allocation_issued"])
            with self.assertRaises(op.OperatorError):controller.prepare_recovery(old,a)

    def test_competing_recovery_publications_have_one_winner_and_no_dispatch(self):
        with tempfile.TemporaryDirectory() as directory:
            old,new,state,a,current=self.fixture(directory)
            controllers=[op.Operator(new,op.State(state.path,op.bounded_json(state.path)),None,clock=lambda:current) for _ in range(8)]
            def prepare(controller):
                try:controller.prepare_recovery(old,a);return True
                except op.OperatorError:return False
            with ThreadPoolExecutor(max_workers=8) as pool:results=list(pool.map(prepare,controllers))
            self.assertEqual(sum(results),1)
            saved=op.bounded_json(state.path)
            self.assertFalse(saved['recovery1']['dispatch_attempted'])
            self.assertEqual(saved['operator_calls'],36)
            self.assertEqual(saved['ledger']['reads'],30)
            self.assertEqual(state.path.with_suffix('.recovery1.predecessor.json').stat().st_mode&0o777,0o600)

    def test_invalid_recovery_binding_worker_or_budget_never_mutates(self):
        for mutation in ("state","config","review","quiescence","worker","used","time","scope"):
            with self.subTest(mutation=mutation),tempfile.TemporaryDirectory() as directory:
                old,new,state,a,current=self.fixture(directory)
                if mutation=="state":a["original_state_sha256"]="f"*64
                if mutation=="config":a["reviewed_config_sha256"]="f"*64
                if mutation=="review":a["native_review_receipt_sha256"]="f"*64
                if mutation=="quiescence":a["original_operator_and_watchdog_quiescent"]=False
                if mutation=="worker":state.data["worker_allocation_issued"]=True
                if mutation=="used":state.data["ledger"]["reads"]=9901
                if mutation=="time":a["retry_deadline_ms"]=current+7200001
                if mutation=="scope":a["extra"]=True
                before=op.canonical(state.data)
                with self.assertRaises(op.OperatorError):op.Operator(new,state,None,clock=lambda:current).prepare_recovery(old,a)
                self.assertEqual(op.canonical(state.data),before)
                self.assertFalse(state.path.with_suffix(".recovery1.claim.json").exists())

class RecoveryRunner:
    """Offline owned resource peer. No credential lookup or external connection."""
    def __init__(self, config, state, mode="zero"):
        self.config,self.state,self.mode=config,state,mode
        self.calls=[];self.launches=0
    def call(self,service,action,args):
        self.calls.append((service,action,list(args)))
        c,s=self.config,self.state
        tags=[{"Key":"RunId","Value":c["run_id"]},{"Key":"Purpose","Value":"synthetic-benchmark-only"}]
        role={"RoleName":c["role"],"Arn":s["resources"]["role"],"Tags":tags}
        host={"InstanceId":"i-0123456789abcdef0","ClientToken":s["client_token"],"Tags":tags}
        if action=="get-caller-identity":return {"Account":c["account"]}
        if action=="describe-instances":
            if self.mode=="unknown":raise op.OperatorError("AWS action failed; outcome unknown")
            rows=[] if self.mode in {'local','mismatch'} else [host] if self.mode in {"one","foreign","different"} or self.launches else [host,dict(host,InstanceId="i-11111111111111111")] if self.mode=="multiple" else []
            if self.mode=="foreign":rows=[dict(host,Tags=[])]
            if self.mode=="different" and any('tag:RunId' in arg for arg in args):rows=[]
            return {"Reservations":[{"Instances":rows}]} if rows else {"Reservations":[]}
        if action=="describe-volumes":return {"Volumes":[]}
        if action=="describe-images":return {"Images":[{"ImageId":c["ami"],"OwnerId":"099720109477","Public":True,"State":"available","Architecture":"x86_64","RootDeviceName":"/dev/sda1","VirtualizationType":"hvm"}]}
        if action=="describe-subnets":return {"Subnets":[{"SubnetId":c["subnet"],"VpcId":c["vpc"],"State":"available","MapPublicIpOnLaunch":True}]}
        if action=="describe-security-groups":return {"SecurityGroups":[{"GroupId":s["resources"]["sg"],"GroupName":c["security_group"],"VpcId":c["vpc"],"IpPermissions":[],"IpPermissionsEgress":[],"Tags":[] if self.mode=="bad-sg" else tags}]}
        if action=="get-role":return {"Role":role}
        if action=="get-instance-profile":return {"InstanceProfile":{"Arn":"arn:aws:iam::"+c["account"]+":instance-profile/"+c["role"],"Tags":tags,"Roles":[role]}}
        if action=="get-bucket-location":return {"LocationConstraint":c["region"]}
        if action=="get-bucket-versioning":return {"Status":"Enabled"}
        if action=="get-public-access-block":return {"PublicAccessBlockConfiguration":{k:True for k in ("BlockPublicAcls","IgnorePublicAcls","BlockPublicPolicy","RestrictPublicBuckets")}}
        if action=="get-bucket-encryption":return {"ServerSideEncryptionConfiguration":{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}}
        if action=="run-instances":
            assert args.count('--count')==1 and args[args.index('--count')+1]=='1'
            assert args[args.index('--client-token')+1]==s['client_token']
            self.launches+=1
            if self.mode=="mismatch":raise op.LaunchIdempotencyMismatch("launch idempotency mismatch; no replacement token")
            if self.mode=="local":raise op.LocalCliParsingRejected("local CLI parsing rejected; request not dispatched")
            if self.mode=="lost":raise op.OperatorError("AWS action failed; outcome unknown")
            return {"Instances":[host]}
        raise AssertionError("unexpected peer action "+action)


class RecoveryDispatchTests(RecoveryTests):
    def test_zero_owned_inventory_permits_one_original_token_launch_without_new_resources(self):
        with tempfile.TemporaryDirectory() as directory:
            old,new,state,a,current=self.fixture(directory);runner=RecoveryRunner(new,state.data)
            controller=op.Operator(new,state,runner,clock=lambda:current);controller.prepare_recovery(old,a)
            result=controller.resume_failed_creation()
            self.assertEqual(result['status'],'recovery_host_acknowledged')
            self.assertEqual(runner.launches,1)
            self.assertEqual(state.data['operator_calls'],36+len(runner.calls))
            self.assertEqual(state.data['ledger']['download'],4718592+131072*len(runner.calls))
            self.assertEqual(state.data['ledger']['store'],0)
            self.assertFalse(state.data['worker_allocation_issued'])
            self.assertFalse(any(action.startswith('create-') or action=='send-command' for _,action,_ in runner.calls))
            before=len(runner.calls)
            with self.assertRaises(op.OperatorError):controller.resume_failed_creation()
            self.assertEqual(len(runner.calls),before)

    def test_existing_unknown_multiple_foreign_or_disagreeing_inventory_never_launches(self):
        for mode in ('one','unknown','multiple','foreign','different','bad-sg'):
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as directory:
                old,new,state,a,current=self.fixture(directory);runner=RecoveryRunner(new,state.data,mode)
                controller=op.Operator(new,state,runner,clock=lambda:current);controller.prepare_recovery(old,a)
                if mode=='one':self.assertEqual(controller.resume_failed_creation()['status'],'existing_owned_host_cleanup_required')
                else:
                    with self.assertRaises(op.OperatorError):controller.resume_failed_creation()
                self.assertEqual(runner.launches,0)
                self.assertFalse(any(action.startswith(('create-','delete-')) for _,action,_ in runner.calls))

    def test_mismatch_and_local_rejection_preserve_old_unknown_and_never_relaunch(self):
        for mode,expected in [('mismatch','idempotency_mismatch'),('local','local_cli_rejected')]:
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as directory:
                old,new,state,a,current=self.fixture(directory);runner=RecoveryRunner(new,state.data,mode)
                controller=op.Operator(new,state,runner,clock=lambda:current);controller.prepare_recovery(old,a)
                with self.assertRaises(op.OperatorError):controller.resume_failed_creation()
                self.assertTrue(state.data['launch_attempted'])
                self.assertEqual(state.data['current_launch_outcome'],expected)
                self.assertTrue(op.bounded_json(state.path.with_suffix('.recovery1.predecessor.json'))['launch_attempted'])
                with self.assertRaises(op.OperatorError):controller.resume_failed_creation()
                self.assertEqual(runner.launches,1)

    def test_lost_launch_response_reconciles_only_and_keeps_same_charge(self):
        with tempfile.TemporaryDirectory() as directory:
            old,new,state,a,current=self.fixture(directory);runner=RecoveryRunner(new,state.data,'lost')
            controller=op.Operator(new,state,runner,clock=lambda:current);controller.prepare_recovery(old,a)
            self.assertEqual(controller.resume_failed_creation()['status'],'recovery_host_acknowledged')
            self.assertEqual(runner.launches,1)
            self.assertEqual(sum(action=='describe-instances' for _,action,_ in runner.calls),3)

    def test_current_absence_cleanup_does_not_override_new_uncertain_write(self):
        with tempfile.TemporaryDirectory() as directory:
            old,new,state,a,current=self.fixture(directory);runner=RecoveryRunner(new,state.data,'unknown')
            controller=op.Operator(new,state,runner,clock=lambda:current);controller.prepare_recovery(old,a)
            state.data['recovery1']['dispatch_attempted']=True;state.data['current_launch_outcome']='unknown'
            with self.assertRaises(op.OperatorError):controller.cleanup()
            self.assertFalse(any(action.startswith('delete-') for _,action,_ in runner.calls))
            self.assertNotIn('current_absence_cleanup',state.data['recovery1'])

    def test_fresh_local_parse_rejection_cannot_become_unknown_dispatch(self):
        with tempfile.TemporaryDirectory() as directory:
            old,new,state,a,current=self.fixture(directory);state.data['launch_attempted']=False
            runner=RecoveryRunner(new,state.data,'local');controller=op.Operator(new,state,runner,clock=lambda:current)
            state.data['deadline_ms']=current+7200000
            with self.assertRaises(op.LocalCliParsingRejected):controller.launch_once(state.data['resources']['sg'],b'fake')
            self.assertFalse(state.data['launch_attempted'])
            self.assertEqual(state.data['current_launch_outcome'],'local_cli_rejected')


def offline_launch_oracle(binary):
    """Validate actual source arguments with the installed CLI, never an API."""
    import base64,gzip,os,subprocess,contextlib
    with tempfile.TemporaryDirectory(prefix='s09-offline-launch-') as directory, contextlib.ExitStack() as stack:
        old,config,state,a,current=RecoveryTests().fixture(directory)
        controller=op.Operator(config,state,None,clock=lambda:current)
        userdata=controller.render_bootstrap()
        assert len(userdata)<=16384 and len(gzip.decompress(userdata))<=65536
        args=stack.enter_context(controller.launch_arguments(state.data['resources']['sg'],userdata))
        assert '--min-count' not in args and '--max-count' not in args and args.count('--count')==1
        value=args[args.index('--user-data')+1]
        assert value.startswith('fileb://') and Path(value[8:]).read_bytes()==userdata
        root=Path(directory);(root/'config').write_text('[profile s09-offline]\nregion=ap-northeast-2\n');(root/'credentials').write_text('[s09-offline]\naws_access_key_id=dummy\naws_secret_access_key=dummy\n')
        env={k:v for k,v in os.environ.items() if not k.startswith('AWS_')}
        env.update(AWS_CONFIG_FILE=str(root/'config'),AWS_SHARED_CREDENTIALS_FILE=str(root/'credentials'),AWS_EC2_METADATA_DISABLED='true',AWS_MAX_ATTEMPTS='1',AWS_PAGER='',AWS_CLI_AUTO_PROMPT='off',AWS_ENDPOINT_URL_EC2='http://127.0.0.1:9')
        version=subprocess.run([binary,'--version'],env=env,capture_output=True,timeout=8)
        assert version.returncode==0 and len(version.stdout)+len(version.stderr)<=131072
        base=[binary,'--profile','s09-offline','--region','ap-northeast-2','--no-cli-pager','--no-paginate','--cli-connect-timeout','1','--cli-read-timeout','4','--cli-binary-format','base64','ec2','run-instances']
        malformed=list(args);position=malformed.index('--network-interfaces')+1;interfaces=json.loads(malformed[position]);interfaces[0]['UnexpectedS09Field']=True;malformed[position]=json.dumps(interfaces)
        obsolete=list(args);position=obsolete.index('--count');obsolete[position:position+2]=['--min-count','1','--max-count','1']
        results=[]
        for name,candidate in [('current',args),('obsolete',obsolete),('malformed-nested',malformed)]:
            result=subprocess.run(base+candidate+['--generate-cli-skeleton','output','--output','json'],env=env,capture_output=True,timeout=8)
            assert len(result.stdout)+len(result.stderr)<=131072
            if name=='current':assert result.returncode==0 and isinstance(json.loads(result.stdout),dict)
            elif name=='obsolete':assert result.returncode==252 and b'Unknown options:' in result.stderr
            else:assert result.returncode!=0 and b'Unknown parameter' in result.stderr
            results.append({'case':name,'exit':result.returncode,'stdout_bytes':len(result.stdout),'stderr_bytes':len(result.stderr)})
        return {'status':'PASS_offline_source_launch_oracle','version':version.stdout.decode().strip(),'cases':results,'payload_sha256':op.digest(userdata),'payload_bytes':len(userdata),'actual_AWS_IMDS_calls':0,'live_semantics_verified':False}

def cli_console_functional_smoke(binary):
    """Actual CLI response customization on loopback only; no live credentials."""
    import base64, http.server, os, subprocess
    current=op.now_ms()
    proof={"run_id":"s09-console-local","instance_id":"i-0123456789abcdef0","source_revision":"a"*40,"deadline_ms":current+60000,"status":"guarded","timer_active":True,"nft_active":True,"ssm_present":True,"observed_before_guard_bytes":0}
    text="[    0.0] Linux boot text\nS09_GUARD_V1 "+json.dumps(proof,separators=(',',':'))+"\n"
    wire=base64.b64encode(text.encode()).decode()
    requests=[]
    class Peer(http.server.BaseHTTPRequestHandler):
        def log_message(self,*_):pass
        def do_POST(self):
            length=int(self.headers.get('Content-Length','0'));assert 0<length<=8192
            body=self.rfile.read(length)
            from urllib.parse import parse_qs
            query=parse_qs(body.decode());assert query['Action']==['GetConsoleOutput'] and query['InstanceId']==['i-0123456789abcdef0']
            requests.append({'action':'GetConsoleOutput','bytes':length})
            xml=('<GetConsoleOutputResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/"><requestId>fixture</requestId><instanceId>i-0123456789abcdef0</instanceId><timestamp>2026-10-08T00:00:00Z</timestamp><output>'+wire+'</output></GetConsoleOutputResponse>').encode()
            self.send_response(200);self.send_header('Content-Type','text/xml');self.send_header('Content-Length',str(len(xml)));self.end_headers();self.wfile.write(xml)
    peer=http.server.ThreadingHTTPServer(('127.0.0.1',0),Peer);thread=threading.Thread(target=peer.serve_forever,daemon=True);thread.start()
    try:
        with tempfile.TemporaryDirectory(prefix='s09-console-cli-') as directory:
            root=Path(directory);(root/'config').write_text('[profile s09-console]\nregion=ap-northeast-2\n');(root/'credentials').write_text('[s09-console]\naws_access_key_id=dummy\naws_secret_access_key=dummy\n')
            env={k:v for k,v in os.environ.items() if not k.startswith('AWS_')}
            env.update(AWS_CONFIG_FILE=str(root/'config'),AWS_SHARED_CREDENTIALS_FILE=str(root/'credentials'),AWS_EC2_METADATA_DISABLED='true',AWS_MAX_ATTEMPTS='1',AWS_PAGER='',AWS_CLI_AUTO_PROMPT='off',AWS_IGNORE_CONFIGURED_ENDPOINT_URLS='true')
            version=subprocess.run([binary,'--version'],env=env,capture_output=True,timeout=8)
            assert version.returncode==0 and len(version.stdout)+len(version.stderr)<=131072
            command=[binary,'--profile','s09-console','--region','ap-northeast-2','--no-cli-pager','--no-paginate','--cli-connect-timeout','1','--cli-read-timeout','4','--cli-binary-format','base64','ec2','get-console-output','--instance-id','i-0123456789abcdef0','--latest','--endpoint-url',f'http://127.0.0.1:{peer.server_port}','--output','json']
            result=subprocess.run(command,env=env,capture_output=True,timeout=8)
            assert result.returncode==0 and len(result.stdout)+len(result.stderr)<=131072
            reply=json.loads(result.stdout);assert reply['Output']==text and reply['Output']!=wire
            console=op.cli_console_text(reply)
            expected={key:proof[key] for key in ('run_id','instance_id','source_revision','deadline_ms')}
            assert op.verify_guard(console,expected,current)==proof
            for invalid in (console+console,console.replace('"status":"guarded"','"status":"failed"'),console.replace('s09-console-local','other-run')):
                try:op.verify_guard(invalid,expected,current)
                except op.OperatorError:pass
                else:raise AssertionError('invalid proof accepted')
            assert len(requests)==1
            return {'status':'PASS_actual_CLI_console_response_transform','version':version.stdout.decode().strip(),'CLI_exit':result.returncode,'wire_encoding':'base64 XML API output','CLI_Output':'decoded UTF8 text, no second decode','console_bytes':len(console.encode()),'valid_guard_verified':True,'invalid_duplicate_status_identity_rejected':True,'loopback_requests':len(requests),'actual_AWS_IMDS_calls':0,'live_host_gate':False}
    finally:
        peer.shutdown();peer.server_close();thread.join(timeout=2)


def virtual_profile_clock(controller):
    """Advance only fixture time; retain real bounded wait/readback/ledger code."""
    original = controller.clock
    offset = [0]
    controller.clock = lambda: original() + offset[0]
    wait = controller.wait_profile_ready
    def sleep(seconds): offset[0] += int(seconds*1000)
    controller.wait_profile_ready = lambda role: wait(role, sleep=sleep)
    return controller


class RetainedBucketRunner:
    """Bounded offline peer for real Operator.provision/call/inventory methods."""
    def __init__(self, config, missing=False, overrides=None, pages=None):
        self.config, self.missing = config, missing
        self.overrides, self.pages = overrides or {}, list(pages or [{"Versions":[], "IsTruncated":False}])
        self.calls = []

    def call(self, service, action, args):
        if len(self.calls) >= 100:
            raise AssertionError("offline peer call bound")
        self.calls.append((service, action, list(args)))
        if action in self.overrides:
            value = self.overrides[action]
            if isinstance(value, Exception):
                raise value
            return value
        c = self.config
        if action == "head-bucket":
            if args != ["--bucket", c["bucket"], "--expected-bucket-owner", op.FIXED["account"]]:
                raise AssertionError("bucket ownership must be fixed before creation")
            if self.missing:
                raise op.OperatorError("AWS status 404")
            return {}
        if action == "get-caller-identity": return {"Account":c["account"]}
        if action == "describe-images": return {"Images":[{"ImageId":c["ami"], "OwnerId":"099720109477", "Public":True, "State":"available", "Architecture":"x86_64", "RootDeviceName":"/dev/sda1", "VirtualizationType":"hvm"}]}
        if action == "describe-subnets": return {"Subnets":[{"SubnetId":c["subnet"], "VpcId":c["vpc"], "State":"available", "MapPublicIpOnLaunch":True}]}
        if action == "get-bucket-location": return {"LocationConstraint":c["region"]}
        if action == "get-bucket-versioning": return {"Status":"Enabled"}
        if action == "get-public-access-block": return {"PublicAccessBlockConfiguration":{k:True for k in ("BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets")}}
        if action == "get-bucket-encryption": return {"ServerSideEncryptionConfiguration":{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}}
        if action == "get-bucket-policy": return {"Policy":json.dumps(json.loads((HERE/"bucket-policy.json").read_text()), indent=3)}
        if action == "list-object-versions":
            if not self.pages: raise AssertionError("inventory exceeded fixture pages")
            return self.pages.pop(0)
        tags=[{"Key":"RunId", "Value":c["run_id"]}, {"Key":"Purpose", "Value":"synthetic-benchmark-only"}]
        role="arn:aws:iam::"+c["account"]+":role/"+c["role"]
        if action == "get-role": raise op.OperatorError("AWS status NoSuchEntity")
        if action == "get-instance-profile":
            if not any(a == "create-instance-profile" for _, a, _ in self.calls): raise op.OperatorError("AWS status NoSuchEntity")
            return {"InstanceProfile":{"Arn":"arn:aws:iam::"+c["account"]+":instance-profile/"+c["role"], "Tags":tags, "Roles":[{"RoleName":c["role"], "Arn":role}]}}
        if action == "describe-security-groups": return {"SecurityGroups":[] if "--filters" in args else [{"IpPermissions":[], "IpPermissionsEgress":[]}]}
        if action == "create-security-group": return {"GroupId":"sg-0123456789abcdef0"}
        if action == "create-role": return {"Role":{"Arn":role}}
        if action == "run-instances": return {"Instances":[{"InstanceId":"i-0123456789abcdef0"}]}
        if action in {"create-bucket", "put-public-access-block", "put-bucket-versioning", "put-bucket-encryption", "put-bucket-policy", "put-role-policy", "create-instance-profile", "add-role-to-instance-profile"}: return {}
        raise AssertionError("unexpected offline action "+action)


class RetainedBucketTests(unittest.TestCase):
    def controller(self, directory, **runner_options):
        config = ConfigAndOwnershipTests().pinned_config()
        config["source_revision"] = "b"*40
        current = op.EXPIRY-4*3600000
        state = op.State.create(Path(directory)/"state.json", {"run_id":config["run_id"], "deadline_ms":current+7200000, "client_token":"s09-offline-retained", "nonce":"d"*64, "resources":{}, "worker_allocation_issued":False})
        runner = RetainedBucketRunner(config, **runner_options)
        return virtual_profile_clock(op.Operator(config, state, runner, clock=lambda:current)), runner

    def test_aes256_with_aws_sse_c_blocking_metadata_is_valid(self):
        encryption = {"ServerSideEncryptionConfiguration":{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}, "BucketKeyEnabled":False, "BlockedEncryptionTypes":{"EncryptionType":["SSE-C"]}}]}}
        with tempfile.TemporaryDirectory(prefix="s09-retained-block-ssec-") as directory:
            controller, runner = self.controller(directory, overrides={"get-bucket-encryption":encryption})
            self.assertTrue(controller.retained_bucket())
            self.assertFalse(any(a.startswith(("create-", "put-", "delete-")) for _, a, _ in runner.calls))

    def test_reuse_inventory_preserves_prior_observations_without_ledger_refund(self):
        with tempfile.TemporaryDirectory(prefix="s09-retained-history-") as directory:
            pages = [{"Versions":[{"Size":7}], "IsTruncated":True, "NextKeyMarker":"old", "NextVersionIdMarker":"v1"}, {"Versions":[{"Size":11}], "IsTruncated":False}, {"Versions":[], "IsTruncated":False}]
            controller, runner = self.controller(directory, pages=pages)
            old = {"potential_version_charge_bytes":99, "versions":1, "body_plus16384_inventory_does_not_refund_ledger":True}
            controller.state.data["version_inventory"] = dict(old)
            controller.ledger.reserve("PUT", put_bytes=123)
            charged = controller.ledger.used["store"]
            controller.provision()
            observation = dict(controller.state.data["version_inventory"])
            self.assertEqual(observation["versions"], 2)
            self.assertEqual(observation["potential_version_charge_bytes"], 2*16384+18)
            self.assertEqual(controller.state.data.get("version_inventory_history"), [old])
            self.assertEqual(controller.inventory_versions(), 0)
            self.assertEqual(controller.state.data.get("version_inventory_history"), [old, observation])
            self.assertEqual(controller.state.data["ledger"]["store"], charged)
            lists = [args for _, action, args in runner.calls if action == "list-object-versions"]
            self.assertIn("--key-marker", lists[1])
            self.assertEqual(lists[1][lists[1].index("--version-id-marker")+1], "v1")

    def test_ambiguous_duplicate_bucket_policy_rejected_before_mutations(self):
        policy = (HERE/"bucket-policy.json").read_text()
        duplicate = '{"Version":"unreviewed",'+policy.lstrip()[1:]
        with tempfile.TemporaryDirectory(prefix="s09-retained-policy-") as directory:
            controller, runner = self.controller(directory, overrides={"get-bucket-policy":{"Policy":duplicate}})
            with self.assertRaises(op.OperatorError): controller.provision()
            self.assertFalse(any(a.startswith(("create-", "put-", "delete-")) for _, a, _ in runner.calls))

    def test_inventory_schema_must_be_complete_and_bounded_before_creation(self):
        invalid = [
            {"Versions":{}, "IsTruncated":False},
            {"Versions":None, "IsTruncated":False},
            {"Versions":[{"Size":0}]*33, "IsTruncated":False},
            {"Versions":[None], "IsTruncated":False},
            {"Versions":[], "DeleteMarkers":{}, "IsTruncated":False},
            {"Versions":[{"Size":True}], "IsTruncated":False},
            {"Versions":[], "IsTruncated":None},
            {"Versions":[], "IsTruncated":True},
            {"Versions":[{"Size":64*op.MiB}], "IsTruncated":False},
            {"DeleteMarkers":[{"Key":"old"}], "IsTruncated":False},
        ]
        for page in invalid:
            with self.subTest(page=page), tempfile.TemporaryDirectory(prefix="s09-retained-inventory-") as directory:
                controller, runner = self.controller(directory, pages=[page])
                with self.assertRaises(op.OperatorError): controller.provision()
                self.assertFalse(any(a.startswith(("create-", "put-", "delete-")) for _, a, _ in runner.calls))
                self.assertNotIn("version_inventory", controller.state.data)

    def test_aes256_default_with_disabled_bucket_key_can_be_reused(self):
        encryption = {"ServerSideEncryptionConfiguration":{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}, "BucketKeyEnabled":False}]}}
        with tempfile.TemporaryDirectory(prefix="s09-retained-aes256-") as directory:
            controller, runner = self.controller(directory, overrides={"get-bucket-encryption":encryption})
            self.assertEqual(controller.provision(), "i-0123456789abcdef0")
            self.assertFalse(any(a == "put-bucket-encryption" for _, a, _ in runner.calls))

    def test_missing_bucket_keeps_original_creation_path(self):
        with tempfile.TemporaryDirectory(prefix="s09-retained-missing-") as directory:
            controller, runner = self.controller(directory, missing=True)
            self.assertEqual(controller.provision(), "i-0123456789abcdef0")
            s3_actions = [a for service, a, _ in runner.calls if service == "s3api"]
            self.assertEqual(s3_actions, ["head-bucket", "create-bucket", "put-public-access-block", "put-bucket-versioning", "put-bucket-encryption", "put-bucket-policy"])
            self.assertEqual(controller.state.data["creation_intents"]["bucket"], "acknowledged")

    def test_foreign_or_unknown_bucket_head_rejects_without_mutations(self):
        for error in ("AWS status 403", "AWS status AccessDenied", "AWS action failed; outcome unknown", "operator subprocess deadline"):
            with self.subTest(error=error), tempfile.TemporaryDirectory(prefix="s09-retained-owner-") as directory:
                controller, runner = self.controller(directory, overrides={"head-bucket":op.OperatorError(error)})
                with self.assertRaises(op.OperatorError): controller.provision()
                self.assertEqual(runner.calls[-1][2], ["--bucket", op.FIXED["bucket"], "--expected-bucket-owner", op.FIXED["account"]])
                self.assertFalse(any(a.startswith(("create-", "put-", "delete-")) for _, a, _ in runner.calls))
                self.assertEqual(controller.state.data["resources"], {})

    def test_wrong_or_unknown_retained_bucket_settings_reject_without_mutations(self):
        public = {k:True for k in ("BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets")}
        cases = [
            ("get-bucket-location", {"LocationConstraint":"us-east-1"}),
            ("get-bucket-versioning", {"Status":"Suspended"}),
            ("get-bucket-versioning", {}),
            ("get-bucket-encryption", {"ServerSideEncryptionConfiguration":{"Rules":[]}}),
            ("get-bucket-encryption", {"ServerSideEncryptionConfiguration":{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"}}]}}),
            ("get-bucket-policy", {"Policy":"{}"}),
            ("get-bucket-policy", {"Policy":"not JSON"}),
            ("get-bucket-policy", {}),
        ]
        for key in public:
            for value in (False, 1): cases.append(("get-public-access-block", {"PublicAccessBlockConfiguration":dict(public, **{key:value})}))
        cases += [(action, None) for action in ("get-bucket-location", "get-bucket-versioning", "get-public-access-block", "get-bucket-encryption", "get-bucket-policy")]
        for action, response in cases:
            with self.subTest(action=action, response=response), tempfile.TemporaryDirectory(prefix="s09-retained-invalid-") as directory:
                controller, runner = self.controller(directory, overrides={action:response})
                with self.assertRaises(op.OperatorError): controller.provision()
                self.assertFalse(any(a.startswith(("create-", "put-", "delete-")) for _, a, _ in runner.calls))
                self.assertEqual(controller.state.data["resources"], {})

    def test_repeated_inventory_marker_rejects_and_keeps_prior_observation(self):
        page = {"Versions":[], "IsTruncated":True, "NextKeyMarker":"old", "NextVersionIdMarker":"v1"}
        with tempfile.TemporaryDirectory(prefix="s09-retained-pagination-") as directory:
            controller, runner = self.controller(directory, pages=[page, page])
            old = {"potential_version_charge_bytes":55, "versions":1}
            controller.state.data["version_inventory"] = dict(old)
            with self.assertRaises(op.OperatorError): controller.provision()
            self.assertEqual(controller.state.data["version_inventory"], old)
            self.assertEqual(sum(a == "list-object-versions" for _, a, _ in runner.calls), 2)
            self.assertEqual(controller.state.data["ledger"]["writes"], 2)
            self.assertFalse(any(a.startswith(("create-", "put-", "delete-")) for _, a, _ in runner.calls))

    def test_nonboolean_bucket_key_setting_rejected_before_mutations(self):
        encryption = {"ServerSideEncryptionConfiguration":{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}, "BucketKeyEnabled":0}]}}
        with tempfile.TemporaryDirectory(prefix="s09-retained-schema-") as directory:
            controller, runner = self.controller(directory, overrides={"get-bucket-encryption":encryption})
            with self.assertRaises(op.OperatorError): controller.provision()
            self.assertFalse(any(a.startswith(("create-", "put-", "delete-")) for _, a, _ in runner.calls))

    def test_valid_retained_bucket_is_read_only_validated_before_new_resources(self):
        with tempfile.TemporaryDirectory(prefix="s09-retained-") as directory:
            controller, runner = self.controller(directory)
            self.assertEqual(controller.provision(), "i-0123456789abcdef0")
            actions = [a for _, a, _ in runner.calls]
            reads = ["head-bucket", "get-bucket-location", "get-bucket-versioning", "get-public-access-block", "get-bucket-encryption", "get-bucket-policy", "list-object-versions"]
            first_create = actions.index("create-security-group")
            for action in reads: self.assertLess(actions.index(action), first_create)
            self.assertFalse(any(a in {"create-bucket", "put-public-access-block", "put-bucket-versioning", "put-bucket-encryption", "put-bucket-policy"} or a.startswith("delete-") for a in actions))
            self.assertEqual(controller.state.data["resources"]["bucket"], op.FIXED["bucket"])
            self.assertNotIn("bucket", controller.state.data["creation_intents"])
            self.assertEqual(controller.state.data["version_inventory"]["versions"], 0)
            self.assertFalse(controller.state.data["worker_allocation_issued"])
            self.assertEqual(controller.config["source_revision"], "b"*40)


# Unit invocation above must occur after all definitions.

if __name__ == "__main__":
    import sys
    if len(sys.argv)==3 and sys.argv[1]=="--recovery-failure-functional-smoke": print(json.dumps(functional_smoke(recovery=True,recovery_fault=sys.argv[2]),sort_keys=True))
    elif sys.argv[1:]==["--recovery-functional-smoke"]: print(json.dumps(functional_smoke(recovery=True),sort_keys=True))
    elif sys.argv[1:]==["--retained-bucket-functional-smoke"]: print(json.dumps(functional_smoke(retained_bucket=True),sort_keys=True))
    elif sys.argv[1:]==["--functional-smoke"]: print(json.dumps(functional_smoke(),sort_keys=True))
    elif len(sys.argv)==3 and sys.argv[1]=="--cli-console-functional-smoke": print(json.dumps(cli_console_functional_smoke(sys.argv[2]),sort_keys=True))
    elif len(sys.argv)==3 and sys.argv[1]=="--offline-launch-oracle": print(json.dumps(offline_launch_oracle(sys.argv[2]),sort_keys=True))
    elif sys.argv[1:]==["--cleanup-functional-smoke"]: print(json.dumps(cleanup_functional_smoke(),sort_keys=True))
    elif sys.argv[1:]==["--failure-functional-smoke"]: print(json.dumps(failure_functional_smoke(),sort_keys=True))
    elif len(sys.argv)==3 and sys.argv[1]=="--compiled-worker": print(json.dumps(compiled_worker_handshake(sys.argv[2]),sort_keys=True))
    elif len(sys.argv)==3 and sys.argv[1]=="--compiled-worker-abort": print(json.dumps(compiled_worker_handshake(sys.argv[2],fault=True),sort_keys=True))
    elif len(sys.argv)==3 and sys.argv[1]=="--compiled-worker-case-abort": print(json.dumps(compiled_worker_handshake(sys.argv[2],fault=True,case_fault=True),sort_keys=True))
    else: unittest.main()
