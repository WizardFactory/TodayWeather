"""Maintained successor integration contracts, only through namespace runner."""
import os
from pathlib import Path
assert os.environ.get('S09_ISOLATED') == '1' and not Path('/sys').exists(), 'use run_isolated.py; no host execution'
import unittest
from unittest.mock import Mock
import aws_operator as op

def manifest_publication_program(manifest):
    """Extract only the maintained manifest transfer, never execute run_host."""
    import ast,base64,inspect,textwrap
    tree=ast.parse(textwrap.dedent(inspect.getsource(op.Operator.run_host)))
    function=tree.body[0]
    assert isinstance(function,ast.FunctionDef)
    statement=next(node for node in function.body if isinstance(node,ast.Assign)
        and any(isinstance(target,ast.Name) and target.id=='commands' for target in node.targets))
    namespace={'run_directory':'/opt/server2-s09/run/'+op.FIXED['run_id'],
        'encoded':base64.b64encode(op.canonical(manifest)).decode()}
    exec(compile(ast.Module(body=[statement],type_ignores=[]),'<manifest-command>','exec'),namespace)
    lines=namespace['commands']
    assert lines[0]=="python3 - <<'PY'" and lines[-1]=='PY'
    return '\n'.join(lines[1:-1])

def manifest_functional_smoke():
    """Actual Python publication -> compiled Rust private_manifest, no AWS/IMDS."""
    import subprocess
    root=Path('/opt/server2-s09')
    assert os.environ.get('S09_MANIFEST_BINARY')=='/worker' and not root.exists()
    root.mkdir(mode=0o700)
    config=dict(op.FIXED,source_revision='a'*40,source_map_sha256='b'*64,
        lock_sha256='c'*64,requested_config_sha256='d'*64,source_files={})
    from test_aws_operator import worker2_authority_fixture
    manifest=op.make_manifest(config,{**worker2_authority_fixture(),'deadline_ms':op.EXPIRY,'guard_proof_sha256':'e'*64},
        'i-0123456789abcdef0','f'*64,op.EXPIRY-3600000,'http://127.0.0.1:1/')
    previous=os.umask(0o022)
    try:exec(compile(manifest_publication_program(manifest),'<maintained-manifest-publication>','exec'),{})
    finally:os.umask(previous)
    result=subprocess.run(['/worker','--aws-config','/candidate/server2/config/benchmarks/aws.json',
        '--run-manifest',str(root/'run'/op.FIXED['run_id']/'manifest.json'),'--execute-approved-run'],
        capture_output=True,text=True,timeout=5)
    # GNU fixture binary must reach the architecture fence AFTER the real private
    # path/schema checks, and BEFORE claims, IMDS or AWS transport construction.
    assert result.returncode==1 and result.stderr.strip()=='benchmark failed: intended Linux x86_64 musl required',result.stderr
    assert not result.stdout and not (root/'run'/op.FIXED['run_id']/'worker.claim').exists()
    return {'actual_private_manifest_accepted':True,'stopped_at_non_musl_fence':True,
        'actual_AWS_calls':0,'worker_claim_created':False,'manifest_ancestor_modes':
        [oct(path.stat().st_mode & 0o777) for path in (root,root/'run',root/'run'/op.FIXED['run_id'])]}

class PrivateManifestPublicationTests(unittest.TestCase):
    def test_unsafe_ancestor_is_rejected_before_manifest_publication(self):
        import tempfile,stat
        for index in range(3):
            for unsafe in ('mode','symlink','foreign_owner'):
                with self.subTest(index=index,unsafe=unsafe),tempfile.TemporaryDirectory() as directory:
                    root=Path(directory)/'server2-s09'
                    directories=(root,root/'run',root/'run'/op.FIXED['run_id'])
                    for path in directories:path.mkdir(mode=0o700)
                    path=directories[index]
                    if unsafe=='mode':path.chmod(0o755)
                    if unsafe=='symlink':
                        moved=Path(directory)/'redirected';path.rename(moved);path.symlink_to(moved,target_is_directory=True)
                    program=manifest_publication_program({'fixture':True}).replace('/opt/server2-s09',str(root))
                    from unittest.mock import patch
                    original=Path.lstat
                    def metadata(item):
                        value=original(item)
                        if unsafe=='foreign_owner' and item==path:
                            fields=list(value);fields[4]=1;value=os.stat_result(fields)
                        return value
                    with patch.object(Path,'lstat',metadata),self.assertRaises((AssertionError,OSError)):
                        exec(compile(program,'<maintained-manifest-publication>','exec'),{})
                    self.assertFalse((directories[-1]/'manifest.json').exists())
                    if unsafe=='mode':self.assertEqual(stat.S_IMODE(path.stat().st_mode),0o755)
                    if unsafe=='symlink':self.assertTrue(path.is_symlink())

    def test_existing_manifest_is_never_overwritten(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'server2-s09';root.mkdir(mode=0o700)
            program=manifest_publication_program({'fixture':True}).replace('/opt/server2-s09',str(root))
            exec(compile(program,'<maintained-manifest-publication>','exec'),{})
            path=root/'run'/op.FIXED['run_id']/'manifest.json';original=path.read_bytes()
            with self.assertRaises(FileExistsError):exec(compile(program,'<maintained-manifest-publication>','exec'),{})
            self.assertEqual(path.read_bytes(),original)

    def test_all_ancestors_are_private_under_permissive_ssm_umask(self):
        import tempfile,json,stat
        for mask in (0o022,0o000,0o077):
            with self.subTest(mask=oct(mask)),tempfile.TemporaryDirectory() as directory:
                root=Path(directory)/'server2-s09';root.mkdir(mode=0o700)
                program=manifest_publication_program({'fixture':True}).replace('/opt/server2-s09',str(root))
                previous=os.umask(mask)
                try:exec(compile(program,'<maintained-manifest-publication>','exec'),{})
                finally:os.umask(previous)
                for path in (root,root/'run',root/'run'/op.FIXED['run_id']):
                    self.assertEqual(stat.S_IMODE(path.stat().st_mode),0o700,str(path))
                    self.assertEqual(path.stat().st_uid,0)
                manifest=root/'run'/op.FIXED['run_id']/'manifest.json'
                self.assertEqual(stat.S_IMODE(manifest.stat().st_mode),0o600)
                self.assertEqual(json.loads(manifest.read_bytes()),{'fixture':True})

class ProfileIntegrationTests(unittest.TestCase):
    def test_profile_readback_waits_full_sixty_seconds_without_launch(self):
        self.assertTrue(hasattr(op.Operator, 'wait_profile_ready'), 'bounded profile settling missing')
        now = [op.EXPIRY-7200000]
        role = 'arn:aws:iam::'+op.FIXED['account']+':role/'+op.FIXED['role']
        state = Mock(data={'deadline_ms':op.EXPIRY})
        controller = op.Operator(dict(op.FIXED), state, Mock(), clock=lambda:now[0])
        calls = []
        def call(service, action, args):
            calls.append((action, now[0]))
            self.assertEqual(action, 'get-instance-profile')
            return {'InstanceProfile': {'Arn':'arn:aws:iam::'+op.FIXED['account']+':instance-profile/'+op.FIXED['role'],
                'Tags':[{'Key':'RunId','Value':op.FIXED['run_id']},{'Key':'Purpose','Value':'synthetic-benchmark-only'}],
                'Roles':[{'RoleName':op.FIXED['role'],'Arn':role}]}}
        controller.call = call
        start = now[0]
        def sleep(seconds): now[0] += int(seconds*1000)
        controller.wait_profile_ready(role, sleep=sleep)
        self.assertEqual(now[0]-start, 60000)
        self.assertEqual(len(calls), 13)

class BootstrapIntegrationTests(unittest.TestCase):
    def test_render_embeds_exact_maintained_recovery_and_private_identity(self):
        import base64, gzip
        from pathlib import Path
        here = Path(op.__file__).parent
        script = (here/'ssm_startup_recovery.py').read_bytes()
        config = dict(op.FIXED, source_revision='a'*40, rustup_sha256='b'*64,
            rustup_url='https://example.invalid/pinned', source_files={
                'server2/deploy/benchmark/ssm_startup_recovery.py':op.digest(script)})
        state = Mock(data={'nonce':'d'*64, 'deadline_ms':op.EXPIRY-1000})
        controller = op.Operator(config, state, Mock(), clock=lambda:op.EXPIRY-2000)
        try: payload = controller.render_bootstrap()
        except op.OperatorError as error: self.fail('maintained recovery render failed: '+str(error))
        text = gzip.decompress(payload).decode()
        self.assertLessEqual(len(payload),16384)
        self.assertNotIn('@@',text)
        self.assertIn(base64.b64encode(script).decode(), text)
        self.assertEqual(text.count(state.data['readiness_key']),1)
        state.save.assert_called()
        self.assertIn('git checkout --detach',text)
        self.assertIn('SOURCE_REVISION',text)
        config['source_files']['server2/deploy/benchmark/ssm_startup_recovery.py']='0'*64
        with self.assertRaisesRegex(op.OperatorError,'recovery source pin'):
            controller.render_bootstrap()

class AuthorityIntegrationTests(unittest.TestCase):
    def test_fixed_renewed_expiry_without_grant_expansion(self):
        import json
        from pathlib import Path
        self.assertEqual(op.EXPIRY,1791648000000)
        config=json.loads((Path(op.__file__).parent/'aws-run.json').read_text())
        self.assertEqual(config['approval_expires_at_ms'],op.EXPIRY)
        self.assertEqual(op.validate_config(config,now_ms=1791647999999),config)
        for file in ('aws_operator.py','ssm_startup_recovery.py'):
            source=(Path(op.__file__).parent/file).read_text()
            self.assertIn('1791648000000',source)
            self.assertNotIn('EXPIRY = 1791642600000',source)
            self.assertNotIn("min(v['deadline_ms'],1791642600000)",source)
            self.assertNotIn('min(args.deadline_ms, 1791642600000)',source)
        with self.assertRaisesRegex(op.OperatorError,'configuration scope'):
            op.validate_config(dict(config,approval_expires_at_ms=1791642600000),now_ms=1791630000000)
        with self.assertRaisesRegex(op.OperatorError,'approval expired'):
            op.validate_config(config,now_ms=1791648000000)
        self.assertEqual((config['host_seconds'],config['max_instances'],config['usd_operator_stop']), (7200,1,5))
        self.assertEqual((config['read_attempts'],config['write_attempts'],config['download_bytes']), (10000,2000,op.GiB))

class ManualProvenanceTests(unittest.TestCase):
    def test_renderer_does_not_label_every_host_macos(self):
        from pathlib import Path
        source=(Path(op.__file__).parents[2]/'tools/render_feasibility_manual.py').read_text()
        self.assertNotIn("'Rust1.99/macOS, public Python loopback peer'",source)
        self.assertIn('platform.system()',source)



class ReconciledUsageTests(unittest.TestCase):
    def test_reconciled_cli_requires_pair_and_debits_before_state(self):
        import sys
        from unittest.mock import patch
        config=dict(op.FIXED,source_revision='a'*40,native_review_receipt_sha256='b'*64)
        auth={k:config[k] for k in ('run_id','source_revision','native_review_receipt_sha256')}
        auth.update(AWS_execution_authorized=True,expires_at_ms=op.EXPIRY)
        base=['operator','--execute-reviewed-run','--state','/scratch/new','--authorization','/scratch/auth',
            '--prior-state','/scratch/p1','--prior-state','/scratch/p2']
        for extra in ([],['--reconciled-prior-state','/scratch/p3'],['--prior-reconciliation','/scratch/proof']):
            with patch.object(sys,'argv',base+extra), patch.object(op,'validate_config',return_value=config), \
                 patch.object(op,'bounded_json',side_effect=[config,auth]), patch.object(op,'carry_prior_usage',side_effect=AssertionError('prior accounting reached without required reconciliation')), patch.object(op.State,'create') as create:
                with self.assertRaisesRegex(op.OperatorError,'paired reconciliation inputs'):
                    op.main()
                create.assert_not_called()
        carried={'ledger':{},'operator_calls':453}
        with patch.object(sys,'argv',base+['--reconciled-prior-state','/scratch/p3','--prior-reconciliation','/scratch/proof','--cleaned-prior-state','/scratch/p4','--prior-cleanup-proof','/scratch/cleanup','--fifth-prior-state','/scratch/fifth','--prior-worker-proof','/scratch/worker-proof']), \
             patch.object(op,'validate_config',return_value=config), patch.object(op,'bounded_json',side_effect=[config,auth]), \
             patch.object(op,'carry_prior_usage',return_value={}), patch.object(op,'carry_reconciled_usage',return_value=carried) as carry, \
             patch.object(op,'carry_cleaned_usage',return_value=carried), \
             patch.object(op,'carry_failed_worker_usage',return_value=carried), \
             patch.object(op.State,'create',side_effect=op.OperatorError('stop before launch')) as create:
            with self.assertRaisesRegex(op.OperatorError,'stop before launch'):op.main()
            self.assertEqual(create.call_args.args[1]['operator_calls'],453)
            carry.assert_called_once_with({},Path('/scratch/p3'),Path('/scratch/proof'))

    def test_third_cumulative_attempt_is_carried_once_without_mutation(self):
        import tempfile, json
        with tempfile.TemporaryDirectory() as directory:
            paths=[]
            for index in range(2):
                path=Path(directory)/str(index)
                path.write_text(json.dumps({'run_id':op.FIXED['run_id'],
                    'status':'cleaned_host_resources_S3_retained','worker_allocation_issued':False,
                    'operator_calls':90,'watchdog_reserved_reads':50,
                    'watchdog_reserved_download_bytes':50*131072,
                    'ledger':{'reads':90,'writes':1,'download':90*131072,'store':0}}))
                paths.append(path)
            previous=op.carry_prior_usage(paths)
            third=dict(previous,run_id=op.FIXED['run_id'],status='creation',worker_allocation_issued=False,
                launch_attempted=True,client_token='s09-fixture',config_sha256='b'*64,
                watchdog_reserved_reads=50,watchdog_reserved_download_bytes=50*131072)
            third['ledger']=dict(reads=300,writes=3,download=303*131072,store=0)
            third['operator_calls']=303
            state=Path(directory)/'third';state.write_text(json.dumps(third))
            receipt={'schema':1,'run_id':op.FIXED['run_id'],'state_sha256':op.digest(op.canonical(third)),
                'config_sha256':third['config_sha256'],'client_token_sha256':op.digest(third['client_token'].encode()),
                'cloudtrail_event_id':'93fea912-2f69-40e5-a387-96b0b8c9a602',
                'launch_error':'Client.InvalidParameterValue: Encoded User data is limited to 25600 bytes',
                'host_absent':True,'volumes_absent':True,'role_absent':True,'profile_absent':True,
                'security_group_absent':True,'bucket_retained':True,'worker_dispatched':False,
                'external_call_reservation':100,'evidence_sha256':['c'*64]}
            proof=Path(directory)/'proof';proof.write_text(json.dumps(receipt))
            original=state.read_bytes()
            self.assertTrue(hasattr(op,'carry_reconciled_usage'),'reconciled cumulative carry missing')
            result=op.carry_reconciled_usage(previous,state,proof)
            self.assertEqual(result['ledger'],dict(reads=450,writes=103,download=453*131072,store=0))
            self.assertEqual(result['operator_calls'],453)
            self.assertEqual(result['prior_state_sha256'],previous['prior_state_sha256']+[op.digest(op.canonical(third))])
            self.assertEqual(state.read_bytes(),original)
            for field,value in [('worker_dispatched',True),('state_sha256','d'*64),('host_absent',False),('external_call_reservation',True)]:
                bad=dict(receipt);bad[field]=value;proof.write_text(json.dumps(bad))
                with self.assertRaises(op.OperatorError):op.carry_reconciled_usage(previous,state,proof)
            proof.write_text(json.dumps(receipt))
            for field,value in [('worker_allocation_issued',True),('prior_state_sha256',[]),('operator_calls',2),('recovery1',{})]:
                bad=dict(third);bad[field]=value;state.write_text(json.dumps(bad))
                rebound=dict(receipt,state_sha256=op.digest(op.canonical(bad)));proof.write_text(json.dumps(rebound))
                with self.assertRaises(op.OperatorError):op.carry_reconciled_usage(previous,state,proof)

class CleanedUsageTests(unittest.TestCase):
    def fixture(self, directory):
        import json
        root=Path(directory)
        def write(name,value):
            path=root/name;path.write_text(json.dumps(value));return path
        paths=[write(str(i),dict(run_id=op.FIXED['run_id'],status='cleaned_host_resources_S3_retained',
            worker_allocation_issued=False,operator_calls=90,watchdog_reserved_reads=50,
            watchdog_reserved_download_bytes=50*131072,ledger=dict(reads=90,writes=1,download=90*131072,store=0))) for i in range(2)]
        previous=op.carry_prior_usage(paths)
        third=dict(previous,run_id=op.FIXED['run_id'],status='creation',worker_allocation_issued=False,
            launch_attempted=True,client_token='s09-third',config_sha256='b'*64,
            watchdog_reserved_reads=50,watchdog_reserved_download_bytes=50*131072,
            ledger=dict(reads=300,writes=3,download=303*131072,store=0),operator_calls=303)
        third_path=write('third',third)
        reconciliation=dict(schema=1,run_id=op.FIXED['run_id'],state_sha256=op.digest(op.canonical(third)),
            config_sha256=third['config_sha256'],client_token_sha256=op.digest(third['client_token'].encode()),
            cloudtrail_event_id='93fea912-2f69-40e5-a387-96b0b8c9a602',
            launch_error='Client.InvalidParameterValue: Encoded User data is limited to 25600 bytes',
            host_absent=True,volumes_absent=True,role_absent=True,profile_absent=True,
            security_group_absent=True,bucket_retained=True,worker_dispatched=False,
            external_call_reservation=100,evidence_sha256=['c'*64])
        third_proof=write('reconciliation',reconciliation)
        previous=op.carry_reconciled_usage(previous,third_path,third_proof)
        fourth=dict(previous,run_id=op.FIXED['run_id'],status='cleaned_host_resources_S3_retained',
            worker_allocation_issued=False,launch_attempted=True,client_token='s09-fourth',config_sha256='d'*64,
            root_volume_absence_verified=True,watchdog_reserved_reads=50,watchdog_reserved_download_bytes=50*131072,
            ledger=dict(reads=546,writes=104,download=550*131072,store=0),operator_calls=550)
        state=write('fourth',fourth)
        cleanup=dict(schema=1,run_id=op.FIXED['run_id'],state_sha256=op.digest(op.canonical(fourth)),
            config_sha256=fourth['config_sha256'],client_token_sha256=op.digest(fourth['client_token'].encode()),
            prior_reconciliation_sha256=previous['prior_reconciliation_sha256'],
            host_absent=True,volumes_absent=True,role_absent=True,profile_absent=True,
            security_group_absent=True,bucket_retained=True,worker_dispatched=False,
            external_call_reservation=100,evidence_sha256=['e'*64,'f'*64])
        proof=write('cleanup',cleanup)
        return previous,state,proof,paths+[third_path,third_proof,state,proof]

    def test_cli_requires_fourth_pair_and_debits_before_state_or_watchdog(self):
        import tempfile,json,sys
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            previous,state,proof,inputs=self.fixture(directory)
            config=dict(op.FIXED,source_revision='a'*40,native_review_receipt_sha256='b'*64)
            authority={k:config[k] for k in ('run_id','source_revision','native_review_receipt_sha256')}
            authority.update(AWS_execution_authorized=True,expires_at_ms=op.EXPIRY)
            config_path=Path(directory)/'config';config_path.write_text(json.dumps(config))
            auth_path=Path(directory)/'auth';auth_path.write_text(json.dumps(authority))
            base=['operator','--execute-reviewed-run','--config',str(config_path),'--state',directory+'/new',
                '--authorization',str(auth_path),'--prior-state',str(inputs[0]),'--prior-state',str(inputs[1]),
                '--reconciled-prior-state',str(inputs[2]),'--prior-reconciliation',str(inputs[3])]
            pair=['--cleaned-prior-state',str(state),'--prior-cleanup-proof',str(proof)]
            for extra in ([],pair[:2],pair[2:]):
                with patch.object(sys,'argv',base+extra), patch.object(op,'validate_config',return_value=config), \
                     patch.object(op,'Cli',return_value=Mock()), \
                     patch.object(op.State,'create',side_effect=AssertionError('state reached without fourth inputs')) as create, \
                     patch.object(op.subprocess,'Popen',side_effect=AssertionError('watchdog reached')) as popen:
                    with self.assertRaisesRegex(op.OperatorError,'paired fourth cleanup inputs'):op.main()
                    create.assert_not_called();popen.assert_not_called()
            with patch.object(sys,'argv',base+pair+['--fifth-prior-state','/scratch/fifth','--prior-worker-proof','/scratch/worker-proof']), patch.object(op,'validate_config',return_value=config), \
                 patch.object(op,'carry_failed_worker_usage',side_effect=lambda previous,*args:previous), \
                 patch.object(op,'Cli',return_value=Mock()), \
                 patch.object(op.State,'create',side_effect=op.OperatorError('stop before launch')) as create, \
                 patch.object(op.subprocess,'Popen',side_effect=AssertionError('watchdog reached')) as popen:
                with self.assertRaisesRegex(op.OperatorError,'stop before launch'):op.main()
                carried=create.call_args.args[1]
                self.assertEqual(carried['operator_calls'],700)
                self.assertEqual(carried['ledger'],dict(reads=696,writes=204,download=700*131072,store=0))
                self.assertEqual(len(carried['prior_state_sha256']),4)
                popen.assert_not_called()
                create.reset_mock()
                proof.write_text('{}')
                with self.assertRaisesRegex(op.OperatorError,'cleaned prior evidence identity'):op.main()
                create.assert_not_called();popen.assert_not_called()

    def test_fourth_cumulative_chain_cleanup_and_reservations_without_mutation(self):
        import tempfile,json,copy
        with tempfile.TemporaryDirectory() as directory:
            previous,state,proof,inputs=self.fixture(directory)
            originals={p:p.read_bytes() for p in inputs}
            self.assertTrue(hasattr(op,'carry_cleaned_usage'),'fourth cumulative carry missing')
            result=op.carry_cleaned_usage(previous,state,proof)
            self.assertEqual(result['ledger'],dict(reads=696,writes=204,download=700*131072,store=0))
            self.assertEqual(result['operator_calls'],700)
            self.assertEqual(result['prior_state_sha256'],previous['prior_state_sha256']+[op.digest(op.canonical(json.loads(originals[state])))])
            self.assertEqual(result['prior_reconciliation_sha256'],previous['prior_reconciliation_sha256'])
            self.assertEqual(result['prior_cleanup_sha256'],op.digest(op.canonical(json.loads(originals[proof]))))
            self.assertEqual({p:p.read_bytes() for p in inputs},originals)
            fourth=json.loads(originals[state]);cleanup=json.loads(originals[proof])
            for field,value in [('state_sha256','0'*64),('config_sha256','0'*64),('client_token_sha256','0'*64),
                ('prior_reconciliation_sha256','0'*64),('worker_dispatched',True),('schema',True),
                ('external_call_reservation',True),('external_call_reservation',99),('evidence_sha256',[]),
                ('evidence_sha256',['bad']),('extra',True)]+[(k,False) for k in ('host_absent','volumes_absent',
                    'role_absent','profile_absent','security_group_absent','bucket_retained')]:
                with self.subTest(proof_field=field,value=value):
                    bad=dict(cleanup);bad[field]=value;proof.write_text(json.dumps(bad))
                    with self.assertRaises(op.OperatorError):op.carry_cleaned_usage(previous,state,proof)
            proof.write_bytes(originals[proof])
            changes=[('worker_allocation_issued',True),('status','creation'),('run_id','foreign'),
                ('root_volume_absence_verified',False),('launch_attempted',False),('prior_state_sha256',[]),
                ('prior_state_sha256',list(reversed(previous['prior_state_sha256']))),
                ('prior_reconciliation_sha256','0'*64),('operator_calls',2),('operator_calls',True),
                ('operator_calls',3350),('watchdog_reserved_reads',49),('watchdog_reserved_download_bytes',0),
                ('recovery1',{}),('prior_cleanup_sha256','0'*64),('client_token',None),('config_sha256','bad')]
            for key in previous['ledger']:
                bad=dict(fourth['ledger']);bad[key]=previous['ledger'][key]-1;changes.append(('ledger',bad))
                bad=dict(fourth['ledger']);bad[key]=True;changes.append(('ledger',bad))
            for key,cap in dict(reads=9800,writes=1900,download=512*op.MiB-200*131072,store=op.MiB).items():
                bad=dict(fourth['ledger']);bad[key]=cap;changes.append(('ledger',bad))
            for field,value in changes:
                with self.subTest(state_field=field,value=value):
                    bad=copy.deepcopy(fourth);bad[field]=value;state.write_text(json.dumps(bad))
                    rebound=dict(cleanup,state_sha256=op.digest(op.canonical(bad)))
                    proof.write_text(json.dumps(rebound))
                    with self.assertRaises(op.OperatorError):op.carry_cleaned_usage(previous,state,proof)
            for p,raw in originals.items():p.write_bytes(raw)
            for missing in (state,proof):
                missing.unlink()
                with self.assertRaises(op.OperatorError):op.carry_cleaned_usage(previous,state,proof)
                missing.write_bytes(originals[missing])
            self.assertEqual({p:p.read_bytes() for p in inputs},originals)

class FailedWorkerUsageTests(unittest.TestCase):
    def fixture(self, directory):
        import json
        root=Path(directory)
        previous,fourth,cleanup,inputs=CleanedUsageTests().fixture(directory)
        previous=op.carry_cleaned_usage(previous,fourth,cleanup)
        def write(name,value):
            path=root/name;path.write_text(json.dumps(value));return path
        config=dict(op.FIXED,approval_expires_at_ms=1791642600000)
        config_path=write('config.json',config)
        error=b'benchmark failed: private directory ownership\n'
        errors=root/'fifth.worker-errors.log';errors.write_bytes(error)
        result=root/'fifth.result.json';result.write_bytes(b'')
        artifacts={k:dict(status='exported',bytes=len(v),sha256=op.digest(v))
                   for k,v in [('errors',error),('result',b'')]}
        fifth=dict(previous,run_id=op.FIXED['run_id'],status='cleaned_host_resources_S3_retained',
            worker_allocation_issued=True,launch_attempted=True,client_token='s09-fifth',
            config_sha256=op.digest(op.canonical(config)),root_volume_absence_verified=True,
            watchdog_reserved_reads=50,watchdog_reserved_download_bytes=50*131072,
            ledger=dict(reads=857,writes=205,download=112984064,store=0),operator_calls=862,
            worker_accounting_compliance=False,worker_terminal=dict(Status='Failed',ResponseCode=1),
            worker_artifacts=artifacts,worker_report_sha256=op.digest(b''),result_sha256=op.digest(b''),
            current_launch_outcome='acknowledged_or_reconciled',
            resources=dict(instance='i-0123456789abcdef0',root_volume='vol-0123456789abcdef0',bucket=op.FIXED['bucket']))
        state=write('fifth.json',fifth)
        absence=write('final-exact-absence.json',dict(instance_id=fifth['resources']['instance'],
            instance_state='terminated',root_volume_id=fifth['resources']['root_volume'],
            active_RunId_instances=[],root_volume_absent=True,tagged_volumes_absent=True,
            role_absent=True,profile_absent=True,security_group_absent=True,bucket_retained=True,
            worker_allocation_issued=True))
        external=write('external-accounting.json',dict(carried_conservative_reservation=100,
            total_external_calls_covered=47,no_refund=True))
        evidence={'config':config_path,'errors':errors,'result':result,'absence':absence,'external':external}
        proof=write('worker-proof',dict(schema=1,run_id=op.FIXED['run_id'],
            state_sha256=op.digest(op.canonical(fifth)),config_sha256=fifth['config_sha256'],
            client_token_sha256=op.digest(fifth['client_token'].encode()),
            prior_reconciliation_sha256=previous['prior_reconciliation_sha256'],
            prior_cleanup_sha256=previous['prior_cleanup_sha256'],
            prior_allocation_id=op.FIXED['run_id']+'-worker1',
            successor_allocation_id=op.FIXED['run_id']+'-worker2',
            successor_attempt=6,successor_expires_at_ms=1791648000000,
            worker_outcome='private_directory_ownership_rejected',worker_dispatched=True,
            worker_accounting_compliance=False,prior_worker_reservation_burned=True,
            host_absent=True,volumes_absent=True,role_absent=True,profile_absent=True,
            security_group_absent=True,bucket_retained=True,external_call_reservation=100,
            evidence_sha256={k:op.digest(v.read_bytes()) for k,v in evidence.items()}))
        return previous,state,proof,inputs+list(evidence.values())+[state,proof]

    def test_distinct_worker2_manifest_and_full_second_reservation_before_dispatch(self):
        import tempfile,json,copy
        with tempfile.TemporaryDirectory() as directory:
            previous,path,proof,inputs=self.fixture(directory)
            carried=op.carry_failed_worker_usage(previous,path,proof)
            config=dict(op.FIXED,source_revision='a'*40,source_map_sha256='b'*64,source_files={},
                lock_sha256='c'*64,requested_config_sha256='d'*64)
            data=dict(carried,deadline_ms=op.EXPIRY,guard_proof_sha256='e'*64,worker_allocation_issued=False)
            state=op.State.create(Path(directory)/'new',data)
            args=(config,state.data,'i-0123456789abcdef0','f'*64,op.EXPIRY-3600000,'http://127.0.0.1:1/')
            manifest=op.make_manifest(*args)
            self.assertEqual(manifest['allocation_id'],op.FIXED['run_id']+'-worker2')
            self.assertEqual(manifest['allocations'],carried['cumulative_worker_reservations'])
            history=copy.deepcopy(state.data['worker_allocation_history'])
            self.assertTrue(hasattr(op,'reserve_worker_allocation'),'second worker reservation missing')
            op.reserve_worker_allocation(state,manifest)
            saved=json.loads(state.path.read_text())
            self.assertTrue(saved['worker_allocation_issued'])
            self.assertEqual(saved['worker_allocation_history'][:1],history)
            self.assertEqual(saved['worker_allocation_history'][1],dict(allocation_id=manifest['allocation_id'],
                reservation=manifest['allocations'],disposition='issued_nonrefundable'))
            self.assertEqual(saved['cumulative_worker_reservations'],
                {k:2*v for k,v in manifest['allocations'].items()})
            with self.assertRaises(op.OperatorError):op.reserve_worker_allocation(state,manifest)
            self.assertEqual(json.loads(state.path.read_text()),saved)
            with self.assertRaises(op.OperatorError):op.make_manifest(*args)
            for field in ('additional_worker_authority','worker_allocation_history','prior_worker_proof_sha256'):
                bad=dict(data);bad.pop(field)
                with self.assertRaises(op.OperatorError):
                    op.make_manifest(config,bad,*args[2:])

    def test_rejects_rebound_uncertain_noncleaned_regressed_or_exhausted_fifth(self):
        import tempfile,json,copy
        with tempfile.TemporaryDirectory() as directory:
            previous,state,proof,inputs=self.fixture(directory)
            originals={p:p.read_bytes() for p in inputs}
            fifth=json.loads(originals[state]);receipt=json.loads(originals[proof])
            mutations=[('worker_allocation_issued',False),('status','creation'),('run_id','foreign'),
                ('root_volume_absence_verified',False),('launch_attempted',False),
                ('current_launch_outcome','unknown'),('worker_accounting_compliance',True),
                ('worker_terminal',dict(Status='Unknown',ResponseCode=None)),
                ('worker_terminal',dict(Status='Failed',ResponseCode=True)),
                ('worker_terminal',dict(Status='Failed',ResponseCode=2)),('worker_artifacts',{}),
                ('worker_report_sha256','0'*64),('result_sha256','0'*64),
                ('prior_state_sha256',[]),('prior_state_sha256',list(reversed(previous['prior_state_sha256']))),
                ('prior_reconciliation_sha256','0'*64),('prior_cleanup_sha256','0'*64),
                ('operator_calls',2),('operator_calls',True),('operator_calls',3350),
                ('watchdog_reserved_reads',49),('watchdog_reserved_download_bytes',0),
                ('recovery1',{}),('worker_allocation_history',[]),('cumulative_worker_reservations',{}),
                ('prior_worker_proof_sha256','a'*64),('additional_worker_authority',{}),('client_token',None)]
            for key in previous['ledger']:
                for value in (previous['ledger'][key]-1,True):
                    ledger=dict(fifth['ledger']);ledger[key]=value;mutations.append(('ledger',ledger))
            for key,cap in dict(reads=9800,writes=1900,download=512*op.MiB-200*131072,store=op.MiB).items():
                ledger=dict(fifth['ledger']);ledger[key]=cap;mutations.append(('ledger',ledger))
            for field,value in mutations:
                with self.subTest(field=field):
                    bad=copy.deepcopy(fifth);bad[field]=value;state.write_text(json.dumps(bad))
                    rebound=dict(receipt,state_sha256=op.digest(op.canonical(bad)));proof.write_text(json.dumps(rebound))
                    with self.assertRaises(op.OperatorError):op.carry_failed_worker_usage(previous,state,proof)
            state.write_bytes(originals[state])
            for field,value in [('state_sha256','0'*64),('config_sha256','0'*64),('client_token_sha256','0'*64),
                ('prior_reconciliation_sha256','0'*64),('prior_cleanup_sha256','0'*64),
                ('schema',True),('extra',True),('external_call_reservation',99),('successor_attempt',5),
                ('successor_expires_at_ms',1791642600000),('successor_allocation_id',op.FIXED['run_id']+'-worker1'),
                ('worker_dispatched',False),('prior_worker_reservation_burned',False),('evidence_sha256',{})]+[
                    (k,False) for k in ('host_absent','volumes_absent','role_absent','profile_absent',
                        'security_group_absent','bucket_retained')]:
                with self.subTest(proof_field=field):
                    bad=copy.deepcopy(receipt);bad[field]=value;proof.write_text(json.dumps(bad))
                    with self.assertRaises(op.OperatorError):op.carry_failed_worker_usage(previous,state,proof)
            proof.write_bytes(originals[proof])
            for path in inputs[6:]:
                with self.subTest(missing=path.name):
                    path.unlink()
                    with self.assertRaises(op.OperatorError):op.carry_failed_worker_usage(previous,state,proof)
                    path.write_bytes(originals[path])
            self.assertEqual({p:p.read_bytes() for p in inputs},originals)

    def test_rebound_artifacts_absence_and_external_evidence_cannot_widen_exception(self):
        import tempfile,json,copy
        with tempfile.TemporaryDirectory() as directory:
            previous,state,proof,inputs=self.fixture(directory)
            originals={p:p.read_bytes() for p in inputs}
            fifth=json.loads(originals[state]);receipt=json.loads(originals[proof])
            root=Path(directory)
            cases=[('errors',state.with_suffix('.worker-errors.log'),b'benchmark failed: uncertain publication\n'),
                ('result',state.with_suffix('.result.json'),b'{}'),
                ('config',root/'config.json',dict(op.FIXED)),
                ('absence',root/'final-exact-absence.json',dict(instance_state='running')),
                ('external',root/'external-accounting.json',dict(total_external_calls_covered=101)),
                ('external',root/'external-accounting.json',dict(total_external_calls_covered=True)),
                ('external',root/'external-accounting.json',dict(no_refund=False))]
            for name,path,change in cases:
                with self.subTest(evidence=name,change_type=type(change).__name__):
                    if isinstance(change,dict):
                        value=json.loads(originals[path]);value.update(change);raw=json.dumps(value).encode()
                    else:raw=change
                    path.write_bytes(raw)
                    bad=copy.deepcopy(fifth);rebound=copy.deepcopy(receipt)
                    rebound['evidence_sha256'][name]=op.digest(raw)
                    if name in ('errors','result'):
                        bad['worker_artifacts'][name]=dict(status='exported',bytes=len(raw),sha256=op.digest(raw))
                        if name=='result':bad.update(result_sha256=op.digest(raw),worker_report_sha256=op.digest(raw))
                    if name=='config':
                        bad['config_sha256']=op.digest(op.canonical(json.loads(raw)))
                        rebound['config_sha256']=bad['config_sha256']
                    rebound['state_sha256']=op.digest(op.canonical(bad))
                    state.write_text(json.dumps(bad));proof.write_text(json.dumps(rebound))
                    with self.assertRaises(op.OperatorError):op.carry_failed_worker_usage(previous,state,proof)
                    for p,raw in originals.items():p.write_bytes(raw)

    def test_cli_requires_fifth_pair_before_state_or_watchdog(self):
        import tempfile,json,sys
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            previous,state,proof,inputs=self.fixture(directory)
            config=dict(op.FIXED,source_revision='a'*40,native_review_receipt_sha256='b'*64)
            auth={k:config[k] for k in ('run_id','source_revision','native_review_receipt_sha256')}
            auth.update(AWS_execution_authorized=True,expires_at_ms=op.EXPIRY)
            cp=Path(directory)/'current-config';cp.write_text(json.dumps(config))
            ap=Path(directory)/'authority';ap.write_text(json.dumps(auth))
            argv=['operator','--execute-reviewed-run','--config',str(cp),'--authorization',str(ap),
                '--state',directory+'/new','--prior-state',str(inputs[0]),'--prior-state',str(inputs[1]),
                '--reconciled-prior-state',str(inputs[2]),'--prior-reconciliation',str(inputs[3]),
                '--cleaned-prior-state',str(inputs[4]),'--prior-cleanup-proof',str(inputs[5])]
            pair=['--fifth-prior-state',str(state),'--prior-worker-proof',str(proof)]
            for extra in ([],pair[:2],pair[2:]):
                with patch.object(sys,'argv',argv+extra),patch.object(op,'validate_config',return_value=config), \
                     patch.object(op,'Cli',return_value=Mock()), \
                     patch.object(op.State,'create',side_effect=AssertionError('unfunded state')) as create, \
                     patch.object(op.subprocess,'Popen',side_effect=AssertionError('unfunded watchdog')) as popen:
                    with self.assertRaisesRegex(op.OperatorError,'paired fifth worker inputs'):op.main()
                    create.assert_not_called();popen.assert_not_called()
            with patch.object(sys,'argv',argv+pair),patch.object(op,'validate_config',return_value=config), \
                 patch.object(op,'Cli',return_value=Mock()), \
                 patch.object(op.State,'create',side_effect=op.OperatorError('stop before launch')) as create, \
                 patch.object(op.subprocess,'Popen',side_effect=AssertionError('watchdog reached')) as popen:
                with self.assertRaisesRegex(op.OperatorError,'stop before launch'):op.main()
                carried=create.call_args.args[1]
                self.assertEqual(carried['operator_calls'],1012)
                self.assertEqual(len(carried['prior_state_sha256']),5)
                self.assertEqual(carried['worker_allocation_history'][0]['disposition'],'burned_nonrefundable')
                self.assertFalse(carried['worker_allocation_issued']) # new worker2 only
                popen.assert_not_called()
                create.reset_mock();proof.write_text('{}')
                with self.assertRaisesRegex(op.OperatorError,'fifth prior evidence identity'):op.main()
                create.assert_not_called();popen.assert_not_called()

    def test_fifth_cumulative_usage_once_and_prior_worker_full_reservation_burned(self):
        import tempfile,json
        with tempfile.TemporaryDirectory() as directory:
            previous,state,proof,inputs=self.fixture(directory)
            originals={p:p.read_bytes() for p in inputs}
            self.assertTrue(hasattr(op,'carry_failed_worker_usage'),'fifth worker successor accounting missing')
            carried=op.carry_failed_worker_usage(previous,state,proof)
            self.assertEqual(carried['ledger'],dict(reads=1007,writes=305,download=132644864,store=0))
            self.assertEqual(carried['operator_calls'],1012)
            self.assertEqual(carried['prior_state_sha256'],previous['prior_state_sha256']+
                [op.digest(op.canonical(json.loads(originals[state])))])
            self.assertEqual(carried['prior_cleanup_sha256'],previous['prior_cleanup_sha256'])
            self.assertEqual(carried['prior_worker_proof_sha256'],op.digest(op.canonical(json.loads(originals[proof]))))
            reservation=dict(read_attempts=390000,write_attempts=18000,download_bytes=26*op.GiB,
                stored_version_charge_bytes=63*op.MiB,metadata_download_bytes=512*op.MiB)
            self.assertEqual(carried['worker_allocation_history'],[dict(allocation_id=op.FIXED['run_id']+'-worker1',
                state_sha256=carried['prior_state_sha256'][-1],reservation=reservation,
                disposition='burned_nonrefundable')])
            self.assertEqual(carried['cumulative_worker_reservations'],reservation)
            self.assertEqual(carried['additional_worker_authority'],dict(attempt=6,
                allocation_id=op.FIXED['run_id']+'-worker2',expires_at_ms=op.EXPIRY))
            self.assertEqual({p:p.read_bytes() for p in inputs},originals)

class CarryPriorUsageTests(unittest.TestCase):
    def test_carries_two_cleaned_preworker_states_and_watchdog_reservations(self):
        import tempfile, json
        from pathlib import Path
        with tempfile.TemporaryDirectory() as directory:
            paths=[]
            for index in range(2):
                path=Path(directory)/str(index)
                path.write_text(json.dumps({'run_id':op.FIXED['run_id'],
                    'status':'cleaned_host_resources_S3_retained',
                    'worker_allocation_issued':False,'operator_calls':90,
                    'watchdog_reserved_reads':50,'watchdog_reserved_download_bytes':50*131072,
                    'ledger':{'reads':90,'writes':1,'download':90*131072,'store':0}}))
                paths.append(path)
            value=op.carry_prior_usage(paths)
            self.assertEqual(value['ledger'],{'reads':280,'writes':2,'download':280*131072,'store':0})
            self.assertEqual(value['operator_calls'],280)
            self.assertEqual(len(value['prior_state_sha256']),2)
            runner=Mock();runner.call.return_value={}
            state=Mock();state.data=dict(value,deadline_ms=op.EXPIRY,watchdog_reserved_reads=50)
            controller=op.Operator(dict(op.FIXED),state,runner,clock=lambda:op.EXPIRY-1000)
            controller.call('sts','get-caller-identity',[])
            self.assertEqual(controller.calls,281)
            self.assertEqual(controller.ledger.used['reads'],281)
            self.assertEqual(state.data['operator_calls'],281)
            runner.call.assert_called_once()
            with self.assertRaises(op.OperatorError):op.carry_prior_usage(paths+paths[:1])
            bad=json.loads(paths[0].read_text());bad['worker_allocation_issued']=True
            paths[0].write_text(json.dumps(bad))
            with self.assertRaises(op.OperatorError):op.carry_prior_usage(paths)

    def test_new_attempt_requires_both_inputs_before_state_or_watchdog(self):
        import sys
        from unittest.mock import patch, Mock
        config=dict(op.FIXED,source_revision='a'*40,native_review_receipt_sha256='b'*64)
        authority={k:config[k] for k in ('run_id','source_revision','native_review_receipt_sha256')}
        authority.update(AWS_execution_authorized=True,expires_at_ms=op.EXPIRY)
        for extra in ([],['--prior-state','/scratch/only-one']):
            with patch.object(sys,'argv',['operator','--execute-reviewed-run','--state','/scratch/new','--authorization','/scratch/auth']+extra), \
                 patch.object(op,'validate_config',return_value=config), \
                 patch.object(op,'bounded_json',side_effect=[config,authority]), \
                 patch.object(op.State,'create') as create, \
                 patch.object(op.subprocess,'Popen') as popen:
                with self.assertRaisesRegex(op.OperatorError,'two prior states required'):
                    op.main()
                create.assert_not_called();popen.assert_not_called()
