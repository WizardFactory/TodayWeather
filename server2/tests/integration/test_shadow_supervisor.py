#!/usr/bin/env python3
"""Offline supervisor acceptance checks: real SQLite and subprocess ownership."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import unittest.mock

SOURCE = Path(__file__).resolve().parents[2] / 'deploy/shadow/state.py'
spec = importlib.util.spec_from_file_location('shadow_state', SOURCE)
state = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = state
sys.modules['state'] = state
spec.loader.exec_module(state)
J = state.Journal
E = state.StateError
DIGEST = 'a' * 64


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'run'

    def create(self):
        return J(self.path, create=True, run_id='qualification-1', manifest_sha=DIGEST, epoch=1000)

    def allocation(self, **override):
        return dict(reads=20, writes=30, put_bytes=40) | override

    def test_reopen_keeps_original_deadlines_and_spend(self):
        with self.create() as j:
            before = j.reserve_generation('initial', self.allocation(), now=1010)
        with J(self.path, run_id='qualification-1', manifest_sha=DIGEST) as j:
            after = j.observe(2000)
            for k in ('epoch','collection_until','cleanup_until','allocated','generations'):
                self.assertEqual(before[k], after[k], k)
            self.assertEqual(after['collection_until'], 1000 + 168*3600)
            self.assertEqual(after['cleanup_until'], 1000 + 170*3600)
            with self.assertRaises(E):
                j.reserve_generation('initial', self.allocation(), now=2000)
            self.assertEqual(j.snapshot()['allocated'], before['allocated'])

    def test_uncertain_mutation_retains_token_and_cannot_dispatch_again(self):
        with self.create() as j:
            j.prepare_mutation('launch', 'RunInstances', DIGEST, 'fixed-token', now=1001)
        with J(self.path) as j:
            self.assertEqual(j.mutation('launch'), {'operation':'RunInstances','params_sha':DIGEST,'token':'fixed-token'})
            for token in ('fixed-token','replacement-token'):
                with self.assertRaises(E):
                    j.prepare_mutation('launch','RunInstances',DIGEST,token,now=1002)
            self.assertIsNone(j.mutation('not-started'))

    def test_exact_request_and_ack_survive_reopen_without_redispatch(self):
        parameters={'ClientToken':'fixed-token','MinCount':1,'MaxCount':1,
                    'InstanceType':'t3.small','SubnetId':'subnet-12345678'}
        with self.create() as j:
            j.prepare_request('launch','RunInstances',parameters,'fixed-token',now=1001)
        with J(self.path) as j:
            request=j.request('launch')
            self.assertEqual(request['params'],parameters)
            self.assertIsNone(request['receipt'])
            with self.assertRaises(E):j.prepare_request('launch','RunInstances',parameters,'fixed-token',now=1002)
            j.record_receipt('launch',state.CloudResult('json','RunInstances',{'Instances':[{'InstanceId':'i-12345678'}]}))
        with J(self.path) as j:
            self.assertEqual(j.request('launch')['receipt']['payload']['Instances'][0]['InstanceId'],'i-12345678')
            with self.assertRaises(E):j.record_receipt('launch',state.CloudResult('json','RunInstances',{}))
            with self.assertRaises(E):j.record_receipt('missing',state.CloudResult('json','RunInstances',{}))

    def test_request_binding_rejects_tampering_and_wrong_operation_receipts(self):
        with self.create() as j:
            j.prepare_request('bucket','CreateBucket',{'Bucket':'server2-shadow-test-raw'},'bucket-token',now=1001)
            with self.assertRaises(E):j.record_receipt('bucket',state.CloudResult('json','CreateRole',{}))
            self.assertIsNone(j.request('bucket')['receipt'])
            j.db.execute("UPDATE requests SET params='{}' WHERE id='bucket'")
            with self.assertRaises(E):j.request('bucket')

    def test_only_exact_original_epoch_expiry_userdata_can_be_journaled(self):
        with self.create() as j:
            for script in ('secret material',state.launch_user_data('qualification-1',1001)):
                with self.assertRaises(E):
                    j.prepare_request('launch','RunInstances',{'UserData':script},'fixed-token',now=1001)
            self.assertIsNone(j.request('launch'))
            j.prepare_request('launch','RunInstances',{'UserData':state.launch_user_data('qualification-1',1000)},'fixed-token',now=1001)

    def test_compound_reservation_rejects_all_dimensions_without_partial_spend(self):
        with self.create() as j:
            j.reserve_generation('initial', self.allocation(put_bytes=J.CAPS['put_bytes']), now=1000)
            before = j.snapshot()
            with self.assertRaises(E):
                j.reserve_generation('restart-1', self.allocation(put_bytes=1), now=1000)
            self.assertEqual(j.snapshot()['allocated'], before['allocated'])
            self.assertEqual(j.snapshot()['generations'], 1)

    def test_run_request_budget_rejects_a_second_grant_above_the_server_cap(self):
        # SR-4: the run's total S3 grant is bounded by the server's own parse cap (900,000);
        # the cost ceiling prices what is actually used.
        self.assertEqual(state.Journal.CAPS['reads'],900_000)
        with self.create() as j:
            j.reserve_generation('initial', self.allocation(reads=900_000,writes=900_000), now=1000)
            with self.assertRaises(E):
                j.reserve_generation('restart-1', self.allocation(reads=1,writes=1), now=1000)
            self.assertEqual(j.snapshot()['generations'],1)

    def test_three_generations_only_even_with_unused_budget(self):
        with self.create() as j:
            for name in ('initial','restart-1','restart-2'):
                j.reserve_generation(name, self.allocation(), now=1000)
            with self.assertRaises(E):
                j.reserve_generation('restart-3', self.allocation(), now=1000)
            self.assertEqual(j.snapshot()['generations'], 3)

    def test_invalid_allocations_never_modify_journal(self):
        with self.create() as j:
            for bad in (-1, True, 0.5, 2**63, '20'):
                with self.subTest(value=bad), self.assertRaises(E):
                    j.reserve_generation('initial', self.allocation(reads=bad), now=1000)
            self.assertEqual(j.snapshot()['generations'], 0)

    def test_clock_rollback_latches_across_reopen(self):
        with self.create() as j:
            j.observe(2000)
            self.assertEqual(j.observe(1999)['stop'], 'clock_rollback')
        with J(self.path) as j:
            with self.assertRaisesRegex(E, 'clock_rollback'):
                j.reserve_generation('initial', self.allocation(), now=3000)
            self.assertEqual(j.snapshot()['generations'], 0)

    def test_deadline_is_inclusive_and_cannot_be_reset(self):
        with self.create() as j:
            end = j.snapshot()['collection_until']
            self.assertIsNone(j.observe(end-1)['stop'])
            self.assertEqual(j.observe(end)['stop'], 'collection_deadline')
            with self.assertRaises(E):
                j.prepare_mutation('launch','RunInstances',DIGEST,'token',now=end)
        with self.assertRaises(E):
            self.create()
        with J(self.path) as j:
            self.assertEqual(j.snapshot()['stop'],'collection_deadline')

    def test_conflicting_identity_does_not_reset_state(self):
        with self.create():
            pass
        for args in ({'run_id':'other'}, {'manifest_sha':'b'*64}):
            with self.subTest(args=args), self.assertRaises(E):
                J(self.path, **args)
        with J(self.path) as j:
            self.assertEqual(j.snapshot()['epoch'], 1000)

    def test_missing_partial_or_corrupt_directory_cannot_be_initialized_over(self):
        with self.assertRaises((E,OSError)):
            J(self.path)
        self.path.mkdir()
        with self.assertRaises(E):
            self.create()
        (self.path/'owner.lock').touch()
        with self.assertRaises(E):
            J(self.path)
        (self.path/'state.sqlite3').write_bytes(b'invalid database')
        with self.assertRaises(state.sqlite3.Error):
            J(self.path)
        with self.assertRaises(E):
            self.create()

    def test_second_process_cannot_own_journal(self):
        with self.create() as j:
            p = subprocess.run([sys.executable,str(SOURCE),'inspect','--state',str(self.path)],capture_output=True,text=True,timeout=5)
            self.assertEqual(p.returncode,2,p.stdout+p.stderr)
            self.assertEqual(j.snapshot()['epoch'],1000)
        p = subprocess.run([sys.executable,str(SOURCE),'inspect','--state',str(self.path)],capture_output=True,text=True,timeout=5)
        self.assertEqual(p.returncode,0,p.stdout+p.stderr)
        self.assertEqual(json.loads(p.stdout)['epoch'],1000)

    def test_process_death_preserves_consumed_generation(self):
        with self.create():
            pass
        code = '''import importlib.util,sys,os
s=importlib.util.spec_from_file_location('shadow_state',sys.argv[1]);m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m)
j=m.Journal(__import__('pathlib').Path(sys.argv[2]));j.reserve_generation('initial',{'reads':20,'writes':30,'put_bytes':40},now=1000);os._exit(19)
'''
        p = subprocess.run([sys.executable,'-c',code,str(SOURCE),str(self.path)],capture_output=True,text=True,timeout=5)
        self.assertEqual(p.returncode,19,p.stderr)
        with J(self.path) as j:
            self.assertEqual(j.snapshot()['allocated']['reads'],20)
            with self.assertRaises(E):
                j.reserve_generation('initial',self.allocation(),now=1000)

    def test_private_files(self):
        with self.create():
            for p in (self.path,self.path/'owner.lock',self.path/'state.sqlite3'):
                self.assertEqual(p.stat().st_mode & 0o077,0)


class ResultTests(unittest.TestCase):
    def decode(self, operation, payload):
        return state.decode_cloud(operation,0,json.dumps(payload))

    def test_errors_empty_and_malformed_are_not_absence(self):
        cases=[state.decode_cloud('GetRole',1,stderr='An error occurred (AccessDenied) when calling the GetRole operation: secret'),
               state.decode_cloud('GetRole',None,timed_out=True),
               state.decode_cloud('GetRole',0,''),
               state.decode_cloud('GetRole',0,'not-json'),
               state.decode_cloud('GetRole',0,'null'),
               state.decode_cloud('GetRole',0,'{"bad":NaN}'),
               state.decode_cloud('GetRole',1,stderr='secret network failure')]
        self.assertEqual([r.kind for r in cases],['service_error','timeout','empty_success','malformed','malformed','malformed','command_error'])
        for r in cases:
            self.assertFalse(state.absence(r))
            self.assertNotIn('secret',repr(r))

    def test_explicit_absence_is_operation_specific(self):
        for operation in ('GetRole','GetInstanceProfile'):
            r=state.decode_cloud(operation,255,stderr=f'An error occurred (NoSuchEntity) when calling the {operation} operation: missing')
            self.assertTrue(state.absence(r))
        mismatch=state.decode_cloud('GetRole',255,stderr='An error occurred (NoSuchEntity) when calling the DeleteRole operation: missing')
        self.assertFalse(state.absence(mismatch))
        self.assertFalse(state.absence(state.decode_cloud('DeleteRole',0,'')))

    def test_current_aws_cli_error_prefix_and_retry_suffix(self):
        for operation in ('GetRole', 'GetInstanceProfile'):
            message = (f'\naws: [ERROR]: An error occurred (NoSuchEntity) when calling the '
                       f'{operation} operation (reached max retries: 0): missing\n')
            self.assertTrue(state.absence(state.decode_cloud(operation, 254, stderr=message)))
            self.assertFalse(state.absence(state.decode_cloud('DeleteRole', 254, stderr=message)))
        for message in (
            'aws: [ERROR]: An error occurred (AccessDenied) when calling the GetRole operation: denied',
            'network error: An error occurred (NoSuchEntity) when calling the GetRole operation: missing',
            'aws: [ERROR]: An error occurred (NoSuchEntity) when calling the GetRole operation (unknown): missing',
        ):
            self.assertFalse(state.absence(state.decode_cloud('GetRole', 254, stderr=message)))

    def test_bucket_absence_requires_complete_successful_inventory(self):
        self.assertTrue(state.absence(self.decode('ListBuckets',{'Buckets':[]}),name='task-bucket'))
        for data in ({}, {'Buckets':[{}]}, {'Buckets':[{'Name':'task-bucket'}]}, {'Buckets':[],'NextToken':'more'}, {'Buckets':[],'IsTruncated':True}):
            self.assertFalse(state.absence(self.decode('ListBuckets',data),name='task-bucket'))

    def test_resource_inventory_and_exact_terminated_instance(self):
        for operation,key in [('DescribeVolumes','Volumes'),('DescribeSecurityGroups','SecurityGroups')]:
            self.assertTrue(state.absence(self.decode(operation,{key:[]})))
            self.assertFalse(state.absence(self.decode(operation,{})))
        p={'Reservations':[{'Instances':[{'InstanceId':'i-owned','State':{'Code':48,'Name':'terminated'}}]}]}
        self.assertTrue(state.absence(self.decode('DescribeInstances',p),name='i-owned'))
        self.assertFalse(state.absence(self.decode('DescribeInstances',p),name='i-other'))
        self.assertFalse(state.absence(self.decode('DescribeInstances',{'Reservations':[]}),name='i-owned'))
        p['Reservations'][0]['Instances'][0]['State']={'Code':32,'Name':'shutting-down'}
        self.assertFalse(state.absence(self.decode('DescribeInstances',p),name='i-owned'))




GUARD_SOURCE = SOURCE.with_name('guard.py')
gspec = importlib.util.spec_from_file_location('shadow_guard', GUARD_SOURCE)
guard = importlib.util.module_from_spec(gspec)
sys.modules[gspec.name] = guard
gspec.loader.exec_module(guard)


def cost_policy():
    # SR-4 (#3002): one cumulative ceiling (owner: USD 300), spend of earlier attempts and a
    # reserve kept for what follows a stop (export, cleanup).
    return dict(schema=2,observed_at=900,prices_sha256='d'*64,rates={
        'ec2_hour':'0.026','ipv4_hour':'0.005','gp3_gb_month':'0.0912',
        's3_gb_month':'0.025','s3_read':'0.00000035','s3_write':'0.0000045',
        'cpu_vcpu_hour':'0.05','outbound_gb':'0.126'},
        ceiling_usd='300',prior_spend_usd='0',finish_reserve_usd='5')


class CostTests(unittest.TestCase):
    def worked_example(self,policy):
        # The guide's worked example, written out independently of state.estimate_cost.
        from decimal import Decimal as D
        r={k:D(v) for k,v in policy['rates'].items()};gib=D(1024**3)/D(10**9)
        hourly=r['ec2_hour']+r['ipv4_hour']+(32*r['gp3_gb_month']+20*r['s3_gb_month'])*gib/672
        # SR-5a: five log sources (copy added), and the evidence copy's PUT bound: four
        # objects per hour from the epoch plus four for each of at most three finalizer starts.
        log_puts=5*((24*3600+49)//50)
        copy_puts=4*24+4*3
        return (D(policy['prior_spend_usd'])+24*hourly+D(3600)/3600*r['cpu_vcpu_hour']
                +10_000*r['s3_read']+5_000*r['s3_write']+D(2*10**9)/D(10**9)*r['outbound_gb']
                +(log_puts+copy_puts)*r['s3_write']+D('1.5'))

    def test_accrued_estimate_uses_measured_counters(self):
        from decimal import Decimal as D
        policy=cost_policy();policy['prior_spend_usd']='10'
        result=state.estimate_cost(policy,1000,1000+24*3600,cpu_seconds=3600,s3_reads=10_000,s3_writes=5_000,
                                   tx_bytes=2*10**9,paid_usd='1.5')
        self.assertAlmostEqual(D(result['accrued_usd']),self.worked_example(policy),places=5)
        self.assertEqual(D(result['limit_usd']),D('295'))
        self.assertIsNone(result['stop'])
        # Nothing is booked up front: an idle start costs only the prior spend.
        idle=state.estimate_cost(cost_policy(),1000,1000,cpu_seconds=0)
        self.assertEqual(D(idle['accrued_usd']),D(0))

    def test_ceiling_stop_at_the_boundary(self):
        from decimal import Decimal as D
        policy=cost_policy()
        base=D(state.estimate_cost(policy,1000,1000+3600,cpu_seconds=0)['accrued_usd'])
        policy['prior_spend_usd']=str((D(295)-base-D('0.000001')).quantize(D('.000001')))
        self.assertIsNone(state.estimate_cost(policy,1000,1000+3600,cpu_seconds=0)['stop'])
        self.assertEqual(state.estimate_cost(policy,1000,1000+3600,cpu_seconds=0,tx_bytes=10**6)['stop'],'cost_ceiling')

    def test_policy_requires_a_ceiling_and_a_sufficient_reserve(self):
        for field in ('ceiling_usd','prior_spend_usd','finish_reserve_usd'):
            p=cost_policy();del p[field]
            with self.assertRaises(E):state.validate_cost_policy(p,1000)
        for field,value in (('ceiling_usd','1001'),('ceiling_usd','0'),('finish_reserve_usd','0.01'),
                            ('prior_spend_usd','296'),('schema',1)):
            p=cost_policy();p[field]=value
            with self.assertRaises(E,msg=(field,value)):state.validate_cost_policy(p,1000)
        missing=cost_policy();del missing['rates']['outbound_gb']
        with self.assertRaises(E):state.estimate_cost(missing,1000,1001,cpu_seconds=0)
        for bad in ('NaN','Infinity','-1','',True,0.1):
            invalid=cost_policy();invalid['rates']['ec2_hour']=bad
            with self.assertRaises(E):state.estimate_cost(invalid,1000,1001,cpu_seconds=0)
        self.assertLess(state.finish_reserve_floor(cost_policy()['rates']),5)


def host_manifest():
    return dict(schema=2,run_id='fixture',generation='initial',epoch=1000,pid=123,
                start_ticks=42,boot_id='11111111-1111-1111-1111-111111111111',
                binary_sha256='a'*64,environment_sha256='b'*64,config_sha256='c'*64,
                config_directory='/opt/server2-shadow/fixture/config',port=3000,metrics_port=3001,
                tx_origin=500,interface='ens5',data_directory='/opt/server2-shadow/fixture/data',
                cgroup='/system.slice/server2-shadow-fixture-candidate.service',
                allowance=dict(reads=100,writes=100,put_bytes=1000),cost_policy=cost_policy(),
                paid_usd_per_unit=dict(visual_crossing='0.0001',google='0.005',google_air_quality='0.005',openweather=None))


def host_sample(m=None):
    m=m or host_manifest()
    s={k:m[k] for k in ('pid','start_ticks','boot_id','binary_sha256','environment_sha256','config_sha256','config_directory','cgroup')}
    s.update(observed_at=1001,listeners=[['127.0.0.1',3000],['127.0.0.1',3001]],
             tx_bytes=1000,free_bytes=10*guard.GiB,accounting_valid=True,cpu_seconds=0,
             metrics=dict(s3_reads=90,s3_writes=90,s3_put_bytes=900,auth_failures=0,quota_failures=0,storage_auth_failures=0),
             diagnostics=dict(local_paid_exhaustions=0,first_rejection=None,paid_units=None,provider_http={}))
    return s


class GuardTests(unittest.TestCase):
    def test_stop_record_is_written_before_the_units_stop(self):
        # LP-6 (#2983): stopping the candidate stops the guard's own unit, which can end
        # the guard during stop_units; its record must already be flushed by then.
        import contextlib,io
        from unittest import mock
        out=io.StringIO()
        def killed(manifest):
            self.assertEqual(json.loads(out.getvalue()),{'stop':'s3_authorization'})
            raise KeyboardInterrupt
        with contextlib.redirect_stdout(out),mock.patch.object(guard,'stop_units',side_effect=killed) as stop:
            with self.assertRaises(KeyboardInterrupt):guard.report_stop({'stop':'s3_authorization'},host_manifest(),True)
        stop.assert_called_once()
        out=io.StringIO()
        with contextlib.redirect_stdout(out),mock.patch.object(guard,'stop_units') as stop:
            guard.report_stop({'stop':'disk_reserve'},host_manifest(),False)
        stop.assert_not_called();self.assertEqual(json.loads(out.getvalue()),{'stop':'disk_reserve'})

    def test_healthy_binding_and_thresholds(self):
        m=host_manifest();s=host_sample(m)
        result=guard.evaluate(m,s,None,1001)
        self.assertIsNone(result['stop'])
        self.assertEqual(result['last_tx'],1000)
        for field in ('pid','start_ticks','boot_id','binary_sha256','environment_sha256','config_sha256','config_directory','cgroup'):
            bad=dict(s);bad[field]=False
            self.assertEqual(guard.evaluate(m,bad,None,1001)['stop'],'binding_'+field)

    def test_wrong_listener_and_unavailable_or_stale_observation(self):
        m=host_manifest();s=host_sample()
        s['listeners']=[['0.0.0.0',3000],['127.0.0.1',3001]]
        self.assertEqual(guard.evaluate(m,s,None,1001)['stop'],'listener_binding')
        # SR-2: one unavailable or stale observation is a miss, not a stop.
        first=guard.evaluate(m,None,None,1001)
        self.assertIsNone(first['stop']);self.assertEqual(first['misses'],1)
        for timestamp in (900,1002):
            s=host_sample();s['observed_at']=timestamp
            stale=guard.evaluate(m,s,None,1001)
            self.assertIsNone(stale['stop']);self.assertEqual(stale['misses'],1)

    def test_six_consecutive_missed_observations_stop_and_success_resets(self):
        m=host_manifest();d=None
        for i in range(5):
            d=guard.evaluate(m,None,d,1001+10*i)
            self.assertIsNone(d['stop']);self.assertEqual(d['misses'],i+1)
        s=host_sample();s['observed_at']=1051
        healthy=guard.evaluate(m,s,d,1051)
        self.assertIsNone(healthy['stop']);self.assertEqual(healthy['misses'],0)
        for kind in ('none','stale','metrics','accounting','diagnostics'):
            d=healthy
            for i in range(6):
                now=1061+10*i;s=host_sample();s['observed_at']=now
                if kind=='none':s=None
                elif kind=='stale':s['observed_at']=now-31
                elif kind=='metrics':del s['metrics']['s3_reads']
                elif kind=='accounting':s['accounting_valid']=False
                else:del s['diagnostics']
                d=guard.evaluate(m,s,d,now)
                self.assertEqual(d['stop'],'observation_lost' if i==5 else None,(kind,i))
            self.assertEqual(d['misses'],6)
            self.assertEqual(guard.evaluate(m,host_sample(),d,1200)['stop'],'observation_lost')

    def test_wrongly_typed_diagnostics_are_a_miss_not_a_crash(self):
        # CX-SR2-004.
        m=host_manifest()
        for first in ({'cause':[],'origin':'event','component':'provider','stage':'acquire','provider':'none','status':None},
                      {'cause':'quota','origin':{},'component':'provider','stage':'acquire','provider':'none','status':None}):
            s=host_sample();s['diagnostics']=dict(s['diagnostics'],first_rejection=first)
            d=guard.evaluate(m,s,None,1001)
            self.assertIsNone(d['stop']);self.assertEqual(d['misses'],1)
        s=host_sample();s['diagnostics']=dict(s['diagnostics'],paid_units={'visual_crossing':[]})
        self.assertEqual(guard.evaluate(m,s,None,1001)['misses'],1)

    def test_missed_observations_survive_a_guard_restart(self):
        # The count lives in the state file: six separate `check` invocations, one miss each.
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);mf=root/'manifest.json';sample=root/'sample.json';st=root/'guard.json'
            mf.write_text(json.dumps(host_manifest()));sample.write_text('null')
            for i in range(6):
                command=[sys.executable,str(GUARD_SOURCE),'check','--manifest',str(mf),'--sample',str(sample),'--state',str(st),'--now',str(1001+10*i)]
                p=subprocess.run(command,capture_output=True,text=True,timeout=5)
                self.assertEqual(p.returncode,2 if i==5 else 0,p.stdout+p.stderr)
                self.assertEqual(json.loads(st.read_text())['misses'],i+1)
            self.assertEqual(json.loads(st.read_text())['stop'],'observation_lost')

    def test_network_disk_and_accounting_boundaries(self):
        m=host_manifest()
        for field,value,reason in [('tx_bytes',499,'network_counter_reset'),
                ('free_bytes',6*guard.GiB-1,'disk_reserve')]:
            s=host_sample();s[field]=value
            self.assertEqual(guard.evaluate(m,s,None,1001)['stop'],reason)
        s=host_sample();s['free_bytes']=6*guard.GiB
        self.assertIsNone(guard.evaluate(m,s,None,1001)['stop'])
        # SR-4: transmit volume is priced, not a stop of its own.
        s=host_sample();s['tx_bytes']=500+40*guard.GiB
        self.assertIsNone(guard.evaluate(m,s,None,1001)['stop'])

    def test_provider_rejections_never_stop_and_storage_authorization_does(self):
        # SR-3 (#3001): provider auth/quota and local budget exhaustion are evidence only;
        # the run's own storage/credential authorization stops at a fixed threshold.
        m=host_manifest()
        for key in ('auth_failures','quota_failures'):
            s=host_sample();s['metrics'][key]=100000;s['diagnostics']['local_paid_exhaustions']=5000
            d=guard.evaluate(m,s,None,1001)
            self.assertIsNone(d['stop']);self.assertEqual(d['diagnostics'][key],100000)
        s=host_sample();s['metrics']['storage_auth_failures']=guard.STORAGE_AUTH_LIMIT-1
        prior=guard.evaluate(m,s,None,1001)
        self.assertIsNone(prior['stop']);self.assertEqual(prior['diagnostics']['storage_auth_failures'],guard.STORAGE_AUTH_LIMIT-1)
        s['metrics']['storage_auth_failures']=guard.STORAGE_AUTH_LIMIT;s['observed_at']=1002
        d=guard.evaluate(m,s,prior,1002)
        self.assertEqual(d['stop'],'s3_authorization')
        self.assertEqual(d['diagnostics']['storage_auth_failures'],guard.STORAGE_AUTH_LIMIT)
        self.assertEqual(guard.STORAGE_AUTH_LIMIT,20)
        # SR-4: an exhausted S3 allocation is refused by the server and recorded, not a stop;
        # a remaining count above the allocation is broken accounting (a miss).
        for key in ('s3_reads','s3_writes','s3_put_bytes'):
            s=host_sample();s['metrics'][key]=0
            self.assertIsNone(guard.evaluate(m,s,None,1001)['stop'])
            s=host_sample();s['metrics'][key]=10**6
            self.assertEqual(guard.evaluate(m,s,None,1001)['misses'],1)
        s=host_sample();del s['metrics']['s3_reads']
        self.assertEqual(guard.evaluate(m,s,None,1001)['misses'],1)

    def test_storage_authorization_counts_within_one_hour(self):
        # CX-SR3-002: isolated rejections spread over the week never add up to a stop; 20
        # within one fixed hourly window stop (a broken role fails every storage call).
        m=host_manifest();self.assertEqual(guard.STORAGE_AUTH_WINDOW,3600)
        def walk(points):
            prior=None
            for t,count in points:
                s=host_sample();s['observed_at']=t;s['metrics']['storage_auth_failures']=count
                prior=guard.evaluate(m,s,prior,t)
                if prior['stop']:return prior,t
            return prior,None
        d,at=walk([(1001+30000*i,i) for i in range(1,21)])   # 20 rejections over 167 h
        self.assertIsNone(at,d)
        d,at=walk([(1001,0),(1001+600,15),(1001+3700,15),(1001+3800,30)])
        self.assertIsNone(at,d)   # 15 in the first hour, 15 in the second
        d,at=walk([(1001,0),(1001+600,15),(1001+3700,15),(1001+3800,34),(1001+3900,35)])
        self.assertEqual((d['stop'],at),('s3_authorization',1001+3900))
        # A role broken from the start stops at the first sample, and one that breaks just as
        # an hour ends stops at the first sample after it (the failures since the last sample
        # belong to the new hour).
        d,at=walk([(1001,25)])
        self.assertEqual((d['stop'],at),('s3_authorization',1001))
        d,at=walk([(1001,0),(1000+3590,0),(1000+3600,20)])
        self.assertEqual((d['stop'],at),('s3_authorization',1000+3600))

    def test_confirmed_stops_are_not_masked_by_a_partial_observation(self):
        # CX-SR2-009: binding, listener, network and disk are decided from the sample's own
        # fields before invalid accounting, metrics or diagnostics count as a miss.
        m=host_manifest()
        def broken(kind,s):
            if kind=='accounting':s['accounting_valid']=False
            elif kind=='metrics':del s['metrics']['s3_reads']
            else:s['diagnostics']={'message':'free text'}
        stops=[('pid',124,'binding_pid'),('pid',None,'binding_pid'),('binary_sha256',None,'binding_binary_sha256'),
               ('listeners',[],'listener_binding'),
               ('tx_bytes',499,'network_counter_reset'),
               ('free_bytes',6*guard.GiB-1,'disk_reserve')]
        for kind in ('accounting','metrics','diagnostics'):
            for field,value,reason in stops:
                with self.subTest(kind=kind,reason=reason):
                    s=host_sample();s[field]=value;broken(kind,s)
                    self.assertEqual(guard.evaluate(m,s,None,1001)['stop'],reason)
            s=host_sample();broken(kind,s)
            d=guard.evaluate(m,s,None,1001)
            self.assertEqual((d['stop'],d['misses']),(None,1))

    def test_stop_latches_and_manifest_cannot_change(self):
        m=host_manifest();s=host_sample();s['listeners']=[]
        prior=guard.evaluate(m,s,None,1001)
        self.assertEqual(guard.evaluate(m,host_sample(),prior,1002)['stop'],'listener_binding')
        changed=dict(m);changed['pid']=124
        with self.assertRaises(guard.GuardError):guard.evaluate(changed,host_sample(changed),prior,1002)
        prior=guard.evaluate(m,host_sample(),None,1001)
        self.assertEqual(guard.evaluate(m,host_sample(),prior,1000)['stop'],'clock_rollback')
        self.assertEqual(guard.evaluate(m,host_sample(),prior,1000+168*3600)['stop'],'collection_deadline')

    def test_cost_ceiling_from_measured_counters_and_cpu_rollback(self):
        from decimal import Decimal as D
        self.assertEqual(guard.host_cpu_seconds('cpu 100 10 30 500 40 2 3 5 80 5\n',100),2)
        # A busy week fits under the ceiling; the decision records the estimate.
        m=host_manifest();sample=host_sample(m);now=m['epoch']+167*3600
        sample['observed_at']=now;sample['cpu_seconds']=2*167*3600
        d=guard.evaluate(m,sample,None,now)
        self.assertIsNone(d['stop'])
        # Used S3 = allocation - remaining (100 - 90), transmit since the origin, paid units used.
        sample['diagnostics']['paid_units']={p:dict(initial=100,remaining=100) for p in guard.PAID_PROVIDERS}
        sample['diagnostics']['paid_units']['google']=dict(initial=100,remaining=40)
        d=guard.evaluate(m,sample,None,now)
        expected=state.estimate_cost(m['cost_policy'],m['epoch'],now,cpu_seconds=2*167*3600,s3_reads=10,s3_writes=10,
                                     tx_bytes=1000-500,paid_usd='0.3')
        self.assertEqual(d['cost'],dict(accrued_usd=expected['accrued_usd'],limit_usd=expected['limit_usd']))
        # Prior spend close to the ceiling: the next sample's cost crosses it.
        m=host_manifest();m['cost_policy']['prior_spend_usd']='294.99995'
        self.assertEqual(guard.evaluate(m,host_sample(m),None,1001)['stop'],'cost_ceiling')
        m=host_manifest();sample=host_sample(m);sample['cpu_seconds']=20
        prior=guard.evaluate(m,sample,None,1001);sample['cpu_seconds']=19
        self.assertEqual(guard.evaluate(m,sample,prior,1001)['stop'],'cpu_accounting_unavailable')

    def test_environment_digest_is_order_independent_and_rejects_duplicates(self):
        self.assertEqual(guard.environment_hash(b'A=x\0B=y\0'),guard.environment_hash(b'B=y\0A=x\0'))
        for value in (b'A=x',b'A=x\0A=y\0',b'bad\0'):
            with self.assertRaises(guard.GuardError):guard.environment_hash(value)

    def test_proc_stat_handles_spaces_and_parentheses_in_comm(self):
        fields=['S']+['0']*18+['987']
        self.assertEqual(guard.process_stat('123 (name with ) spaces) '+' '.join(fields)),987)
        fields[0]='Z'
        with self.assertRaises(guard.GuardError):guard.process_stat('123 (dead) '+' '.join(fields))

    def test_listener_requires_owned_inode_and_literal_loopback(self):
        header='header\n'
        row='0: 0100007F:0BB8 00000000:0000 0A 0 0 0 0 0 777\n'
        self.assertEqual(guard.listeners(header+row,header,{'777'},{3000}),[['127.0.0.1',3000]])
        with self.assertRaises(guard.GuardError):guard.listeners(header+row,header,{'778'},{3000})
        with self.assertRaises(guard.GuardError):guard.listeners(header+row.replace('0100007F','00000000'),header,{'777'},{3000})

    def test_metrics_require_all_fields_exactly_once(self):
        text=''.join(k+' 5\n' for k in guard.METRICS)
        self.assertEqual(len(guard.metric_values(text)),6)
        self.assertEqual(guard.metric_values(text)['storage_auth_failures'],5)
        with self.assertRaises(guard.GuardError):guard.metric_values(text.splitlines()[0])
        with self.assertRaises(guard.GuardError):guard.metric_values(text+text.splitlines()[0])

    DIAGNOSTIC_TEXT=(
        'server2_runtime_local_paid_exhaustions_total 1\n'
        'server2_runtime_first_rejection_info{cause="quota",origin="local_paid_allowance",component="quota",stage="admission",provider="google_air_quality",status="none"} 1\n'
        + ''.join('server2_shadow_paid_units_%s{provider="%s"} %d\n'%(kind,p,n)
                  for p,i,r in [('visual_crossing',25000,24990),('google',100,100),('google_air_quality',400,0),('openweather',0,0)]
                  for kind,n in (('initial',i),('remaining',r)))
        + 'server2_runtime_provider_http_rejections_total{source="airkorea_arpltn",status="429"} 7\n'
        + 'server2_runtime_provider_http_rejections_total{source="public_kma_web",status="401"} 1\n')

    def test_diagnostics_parse_fixed_vocabulary_only(self):
        d=guard.diagnostic_values('server2_logging_filtered_total 3\n'+self.DIAGNOSTIC_TEXT)
        self.assertEqual(d['local_paid_exhaustions'],1)
        self.assertEqual(d['first_rejection'],dict(cause='quota',origin='local_paid_allowance',component='quota',
                         stage='admission',provider='google_air_quality',status=None))
        self.assertEqual(d['paid_units']['google_air_quality'],dict(initial=400,remaining=0))
        self.assertEqual(d['provider_http'],{'airkorea_arpltn':{'429':7},'public_kma_web':{'401':1}})
        self.assertEqual(guard.diagnostic_values('server2_runtime_local_paid_exhaustions_total 0\n'),
                         dict(local_paid_exhaustions=0,first_rejection=None,paid_units=None,provider_http={}))
        bad=[self.DIAGNOSTIC_TEXT.replace('google_air_quality"} 400','google_air_quality"} x'),
             self.DIAGNOSTIC_TEXT.replace('provider="google_air_quality",status','provider="https://x",status'),
             self.DIAGNOSTIC_TEXT.replace('status="none"','status="99"'),
             self.DIAGNOSTIC_TEXT+self.DIAGNOSTIC_TEXT.splitlines()[1]+'\n',
             self.DIAGNOSTIC_TEXT.replace('server2_shadow_paid_units_remaining{provider="openweather"} 0\n',''),
             self.DIAGNOSTIC_TEXT.replace('server2_runtime_local_paid_exhaustions_total 1\n',''),
             self.DIAGNOSTIC_TEXT.replace('} 1\n','} 2\n',1),
             self.DIAGNOSTIC_TEXT.replace('source="airkorea_arpltn"','source="https://apis.data.go.kr"'),
             self.DIAGNOSTIC_TEXT.replace('status="429"} 7','status="500"} 7'),
             self.DIAGNOSTIC_TEXT.replace('status="429"} 7','status="429"} 0'),
             self.DIAGNOSTIC_TEXT+'server2_runtime_provider_http_rejections_total{source="public_kma_web",status="401"} 2\n']
        for text in bad:
            with self.assertRaises(guard.GuardError):guard.diagnostic_values(text)

    def test_stop_decision_retains_distinguishing_diagnostics(self):
        m=host_manifest();decisions=[]
        first=guard.diagnostic_values(self.DIAGNOSTIC_TEXT)
        for key in ('auth_failures','quota_failures'):
            s=host_sample();s['metrics'][key]=1;s['metrics']['storage_auth_failures']=guard.STORAGE_AUTH_LIMIT;s['diagnostics']=first
            d=guard.evaluate(m,s,None,1001)
            self.assertEqual(d['stop'],'s3_authorization')
            self.assertEqual(d['diagnostics']['provider_http']['airkorea_arpltn'],{'429':7})
            self.assertEqual(d['diagnostics']['observed_at'],1001)
            self.assertEqual(d['diagnostics'][key],1)
            self.assertEqual(d['diagnostics']['first_rejection']['origin'],'local_paid_allowance')
            self.assertEqual(d['diagnostics']['paid_units']['visual_crossing'],dict(initial=25000,remaining=24990))
            decisions.append(d)
        self.assertNotEqual(decisions[0],decisions[1])
        latched=guard.evaluate(m,host_sample(),decisions[1],1002)
        self.assertEqual(latched['diagnostics'],decisions[1]['diagnostics'])
        healthy=guard.evaluate(m,host_sample(),None,1001)
        self.assertIsNone(healthy['stop'])
        self.assertEqual(healthy['diagnostics']['paid_units'],None)
        self.assertEqual(guard.evaluate(m,None,healthy,1002)['diagnostics'],healthy['diagnostics'])
        s=host_sample();del s['diagnostics']
        self.assertEqual(guard.evaluate(m,s,None,1001)['misses'],1)

    def test_diagnostic_vocabulary_equals_rust_serialization(self):
        import re
        src=SOURCE.parents[2]/'src'
        obs=(src/'observability.rs').read_text();model=(src/'budget/model.rs').read_text()
        def snake(name):return re.sub(r'(?<!^)([A-Z])',r'_\1',name).lower()
        def variants(enum):
            body=re.search(r'vocabulary!\('+enum+r' \{(.*?)\}\);',obs,re.S).group(1)
            return {snake(v.strip()) for v in body.split(',') if v.strip()}
        self.assertEqual(guard.VOCABULARY['component'],variants('Component'))
        self.assertEqual(guard.VOCABULARY['stage'],variants('Stage'))
        self.assertLessEqual(guard.VOCABULARY['cause'],variants('Cause'))
        paths=set(re.findall(r'Self::[A-Za-z]+ => "([a-z0-9_]+)"',model))
        self.assertEqual(guard.VOCABULARY['provider'],paths|{'none'})
        # Provider rejection sources: the labels of allowance.rs source_label, all reachable.
        allowance=(src/'storage/allowance.rs').read_text()
        body=re.search(r'fn source_label\(index: usize\) -> &\'static str \{(.*?)\n\}',allowance,re.S).group(1)
        labels=re.findall(r'(?:\d+|_) => "([a-z0-9_]+)"',body)
        count=int(re.search(r'const COUNT: usize = (\d+);',allowance).group(1))
        self.assertEqual(len(labels),count);self.assertEqual(len(set(labels)),count)
        self.assertEqual(guard.PROVIDER_SOURCES,set(labels))

    def test_provider_http_and_s3_origins_parse(self):
        for component,stage in (('provider','provider_http'),('s3','restore'),('quota','reserve'),('gateway','publish')):
            text=('server2_runtime_local_paid_exhaustions_total 0\n'
                  'server2_runtime_first_rejection_info{cause="auth",origin="event",component="%s",stage="%s",provider="data_go_kr",status="403"} 1\n'%(component,stage))
            first=guard.diagnostic_values(text)['first_rejection']
            self.assertEqual((first['component'],first['stage'],first['status']),(component,stage,403))

    def test_stored_diagnostics_are_fully_validated(self):
        m=host_manifest();prior=guard.evaluate(m,host_sample(),None,1001)
        self.assertIsNotNone(prior['diagnostics'])
        bad=[{'message':'free text'},dict(prior['diagnostics'],extra=1),dict(prior['diagnostics'],auth_failures=-1),
             dict(prior['diagnostics'],first_rejection=dict(cause='quota',origin='event',component='provider',stage='acquire',provider='https://x',status=None))]
        for diagnostics in bad:
            for stop in (None,'observation_lost'):
                tampered=dict(prior,diagnostics=diagnostics,stop=stop)
                with self.assertRaises(guard.GuardError):guard.evaluate(m,host_sample(),tampered,1002)
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);mf=root/'manifest.json';sample=root/'sample.json';st=root/'guard.json'
            mf.write_text(json.dumps(m));sample.write_text(json.dumps(host_sample()))
            st.write_text(json.dumps(dict(prior,diagnostics={'message':'free text'})))
            p=subprocess.run([sys.executable,str(GUARD_SOURCE),'check','--manifest',str(mf),'--sample',str(sample),'--state',str(st),'--now','1002'],capture_output=True,text=True,timeout=5)
            self.assertEqual(p.returncode,2,p.stdout+p.stderr)
            self.assertIn('guard_failed',p.stdout)

    def test_actual_offline_cli_persists_terminal_stop(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);m=root/'manifest.json';sample=root/'sample.json';st=root/'guard.json'
            m.write_text(json.dumps(host_manifest()));sample.write_text(json.dumps(host_sample()))
            command=[sys.executable,str(GUARD_SOURCE),'check','--manifest',str(m),'--sample',str(sample),'--state',str(st),'--now','1001']
            p=subprocess.run(command,capture_output=True,text=True,timeout=5)
            self.assertEqual(p.returncode,0,p.stdout+p.stderr)
            bad=host_sample();bad['start_ticks']=43;sample.write_text(json.dumps(bad))
            p=subprocess.run(command,capture_output=True,text=True,timeout=5)
            self.assertEqual(p.returncode,2,p.stdout+p.stderr)
            self.assertEqual(json.loads(p.stdout)['stop'],'binding_start_ticks')
            sample.write_text(json.dumps(host_sample()))
            p=subprocess.run(command,capture_output=True,text=True,timeout=5)
            self.assertEqual(p.returncode,2)
            self.assertEqual(json.loads(st.read_text())['stop'],'binding_start_ticks')



# The cloud connector is exercised entirely through exact offline responses.
sys.path.insert(0,str(SOURCE.parent))
sys.modules['state']=state
spec_operator=importlib.util.spec_from_file_location('shadow_operator',SOURCE.with_name('coordinator.py'))
operator=importlib.util.module_from_spec(spec_operator);spec_operator.loader.exec_module(operator)


def owned_resources():
    prefix='server2-shadow-test1'
    return dict(schema=1,account='123456789012',region='ap-northeast-2',run_id='test1',
                instance='i-1234567890abcdef0',security_group='sg-1234567890abcdef0',
                volumes=['vol-1234567890abcdef0'],buckets=[prefix+'-raw',prefix+'-state'],
                role=prefix,profile=prefix,policy=prefix)


class FixtureCloud:
    def __init__(self, replies):self.replies=list(replies);self.calls=[]
    def call(self,operation,params,**kwargs):
        self.calls.append((operation,params))
        expected,result=self.replies.pop(0)
        assert expected==operation,(expected,operation)
        if callable(result):return result(params,kwargs)
        return result


def cloud_json(operation,payload):return operator.CloudResult('json',operation,payload)


class OperatorTests(unittest.TestCase):
    def test_export_cannot_spend_reserved_cleanup_attempts(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'journal'
            with J(root,create=True,run_id='test1',manifest_sha=DIGEST,epoch=1000) as j:
                j.reserve_control(reads=9000,writes=9000,export_bytes=2*1024**3)
                with self.assertRaises(E):j.reserve_control(reads=1)
                with self.assertRaises(E):j.reserve_control(writes=1)
            with J(root) as j:
                j.observe(1000+171*3600)
                spent=j.reserve_control(reads=1000,writes=1000,cleanup=True)
                self.assertEqual(spent,dict(reads=10000,writes=10000,export_bytes=2*1024**3))
                with self.assertRaises(E):j.reserve_control(reads=1,cleanup=True)
                with self.assertRaises(E):j.reserve_control(export_bytes=1,cleanup=True)
                self.assertEqual(j.reserve_control(),spent)

    def test_response_envelopes_are_precharged_and_cleanup_is_separate(self):
        with tempfile.TemporaryDirectory() as temp:
            directory=Path(temp)/'run'
            with J(directory,create=True,run_id='test1',manifest_sha=DIGEST,epoch=1000) as j:
                j.reserve_control(reads=1,response_bytes=4*1024**3)
                before=j.reserve_control()
                with self.assertRaises(E):j.reserve_control(reads=1,response_bytes=1)
                self.assertEqual(j.reserve_control(),before)
                j.reserve_control(reads=1,response_bytes=4*1024**3,cleanup=True)
            with J(directory) as j:
                for cleanup in (False,True):
                    with self.assertRaises(E):j.reserve_control(response_bytes=1,cleanup=cleanup)
                self.assertEqual(j.reserve_control()['reads'],2)

    def test_actual_aws_process_uses_private_json_file_and_removes_it(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);executable=root/'fixture-aws';record=root/'input-path'
            script="#!"+sys.executable+"\nimport json,os,sys\nfrom pathlib import Path\narg=sys.argv[sys.argv.index('--cli-input-json')+1]\nif arg=='file:///dev/stdin':sys.exit(252)\np=Path(arg.removeprefix('file://'))\nassert p.is_file() and p.stat().st_mode&0o077==0\nparams=json.loads(p.read_text())\nPath("+repr(str(record))+").write_text(str(p))\nprint(json.dumps({'Account':'123456789012'}))\n"
            executable.write_text(script);executable.chmod(0o700)
            with J(root/'state',create=True,run_id='test1',manifest_sha=DIGEST,epoch=1000) as j:
                adapter=operator.Aws(j,owned_resources(),executable=str(executable))
                self.assertTrue(adapter.verified)
                self.assertEqual(j.db.execute('SELECT work,cleanup FROM transfer').fetchone(),(65536,0))
                self.assertEqual(Path(record.read_text()).parent,j.directory)
                self.assertFalse(Path(record.read_text()).exists())
                spent=j.reserve_control()
                with self.assertRaises(E):adapter.call('GetObject',{})
                self.assertEqual(j.reserve_control(),spent)
                self.assertEqual(list(j.directory.glob('.aws-input-*')),[])

    def test_get_object_passes_cli_flags_with_pinned_version_and_range(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);executable=root/'fixture-aws'
            executable.write_text('#!'+sys.executable+'\n'+"""
import json,sys
from pathlib import Path
if 'get-caller-identity' in sys.argv:
    print(json.dumps({'Account':'123456789012'}))
else:
    assert '--cli-input-json' not in sys.argv
    assert sys.argv[sys.argv.index('--bucket')+1]=='server2-shadow-test1-raw'
    assert sys.argv[sys.argv.index('--key')+1]=='key with spaces'
    assert sys.argv[sys.argv.index('--version-id')+1]=='v1'
    assert sys.argv[sys.argv.index('--range')+1]=='bytes=0-2'
    Path(sys.argv[-1]).write_bytes(b'raw')
    print(json.dumps({'VersionId':'v1','ContentLength':3,'ContentRange':'bytes 0-2/3'}))
""")
            executable.chmod(0o700)
            with J(root/'state',create=True,run_id='test1',manifest_sha=DIGEST,epoch=1000) as j:
                adapter=operator.Aws(j,owned_resources(),executable=str(executable))
                answer=adapter.call('GetObject',dict(Bucket=owned_resources()['buckets'][0],
                    Key='key with spaces',VersionId='v1',Range='bytes=0-2'),output=root/'body')
                self.assertEqual(answer.kind,'json')
                self.assertEqual((root/'body').read_bytes(),b'raw')
                self.assertEqual(j.reserve_control()['reads'],2)
                self.assertEqual(list(j.directory.glob('.aws-input-*')),[])

    def test_reserved_operator_budget_is_durable_and_atomic(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'journal'
            with J(root,create=True,run_id='test1',manifest_sha=DIGEST,epoch=1000) as j:
                used=j.reserve_control(reads=9000,writes=10,export_bytes=4)
                with self.assertRaises(E):j.reserve_control(reads=1,writes=2)
                self.assertEqual(j.reserve_control(),used)
            with J(root) as j:
                self.assertEqual(j.reserve_control(),used)
                j.observe(1000+171*3600)
                self.assertEqual(j.reserve_control(writes=1)['writes'],11)

    def test_owned_resource_names_cannot_target_other_run(self):
        for field,value in [('account','123'),('role','production-role'),('buckets',['production']),
                            ('instance','*'),('region','us-east-1'),('volumes',[])]:
            with self.subTest(field=field),self.assertRaises(E):
                operator.frozen_resources(owned_resources()|{field:value})

    def gone_replies(self):
        r=owned_resources()
        return [('DescribeInstances',cloud_json('DescribeInstances',{'Reservations':[{'Instances':[{'InstanceId':r['instance'],'State':{'Code':48,'Name':'terminated'}}]}]})),
                ('DescribeSecurityGroups',cloud_json('DescribeSecurityGroups',{'SecurityGroups':[]})),
                ('DescribeVolumes',cloud_json('DescribeVolumes',{'Volumes':[]})),
                ('GetRole',operator.CloudResult('service_error','GetRole',code='NoSuchEntity')),
                ('GetInstanceProfile',operator.CloudResult('service_error','GetInstanceProfile',code='NoSuchEntity')),
                ('ListBuckets',cloud_json('ListBuckets',{'Buckets':[]}))]

    def test_independent_absence_requires_every_exact_observation(self):
        replies=self.gone_replies()
        self.assertTrue(operator.inventory(FixtureCloud(replies),owned_resources())['complete'])
        for index in range(len(replies)):
            changed=list(replies);op=changed[index][0]
            for kind in ('empty_success','timeout','malformed','command_error','service_error'):
                changed[index]=(op,operator.CloudResult(kind,op,code='AccessDenied'))
                with self.subTest(index=index,kind=kind):
                    self.assertFalse(operator.inventory(FixtureCloud(changed),owned_resources())['complete'])

    def test_bucket_absence_needs_last_successful_page(self):
        replies=self.gone_replies();replies[-1]=('ListBuckets',cloud_json('ListBuckets',{'Buckets':[],'ContinuationToken':'next'}))
        replies.append(('ListBuckets',cloud_json('ListBuckets',{'Buckets':[{'Name':owned_resources()['buckets'][0]}]})))
        cloud=FixtureCloud(replies)
        self.assertFalse(operator.inventory(cloud,owned_resources())['complete'])
        self.assertEqual(cloud.calls[-1][1]['ContinuationToken'],'next')

    def test_export_retains_original_headers_after_source_removed(self):
        raw=b'original provider bytes'; headers={'VersionId':'v1','ContentLength':len(raw),
            'ContentRange':f'bytes 0-{len(raw)-1}/{len(raw)}',
            'LastModified':'2026-11-13T07:00:00+00:00','ContentType':'application/gzip',
            'Metadata':{'original':'retained verbatim'}}
        def body(params,kwargs):
            kwargs['output'].write_bytes(raw)
            return cloud_json('GetObject',headers)
        cloud=FixtureCloud([('ListObjectVersions',cloud_json('ListObjectVersions',
            {'IsTruncated':False,'Versions':[{'Key':'raw/a','VersionId':'v1','Size':len(raw)}]})),
            ('GetObject',body),('ListObjectVersions',cloud_json('ListObjectVersions',{'IsTruncated':False}))])
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            with J(root/'journal',create=True,run_id='test1',manifest_sha=DIGEST,epoch=1000) as j:
                operator.export_sources(cloud,j,owned_resources(),root/'evidence')
            cloud.replies.clear()
            manifest=json.loads((root/'evidence/manifest.json').read_text())
            self.assertTrue(manifest['complete'])
            self.assertEqual(manifest['objects'][0]['headers'],headers)
            self.assertEqual((root/'evidence'/manifest['objects'][0]['file']).read_bytes(),raw)

    def test_export_keeps_original_bytes_and_exact_versions(self):
        raw=b'\x00original\xffprovider body\n';r=owned_resources()
        item={'Key':'raw/a','VersionId':'original-v1','Size':len(raw)}
        def body(params,kwargs):
            self.assertEqual(params,{'Bucket':r['buckets'][0],'Key':'raw/a','VersionId':'original-v1','Range':f'bytes=0-{len(raw)-1}'})
            kwargs['output'].write_bytes(raw)
            return cloud_json('GetObject',{'Metadata':{},'LastModified':'2026-11-13T07:00:00Z','VersionId':'original-v1','ContentLength':len(raw),'ContentRange':f'bytes 0-{len(raw)-1}/{len(raw)}'})
        # The state bucket (log objects) is exported first (CX-LP6-002).
        cloud=FixtureCloud([('ListObjectVersions',cloud_json('ListObjectVersions',{'IsTruncated':False})),
                            ('ListObjectVersions',cloud_json('ListObjectVersions',{'IsTruncated':False,'Versions':[item]})),
                            ('GetObject',body)])
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            with J(root/'journal',create=True,run_id='test1',manifest_sha=DIGEST,epoch=1000) as j:
                result=operator.export_sources(cloud,j,r,root/'evidence')
                self.assertTrue(result['complete']);self.assertEqual(result['dependency_closure'],'unproven')
                entry=result['objects'][0]
                self.assertEqual((root/'evidence'/entry['file']).read_bytes(),raw)
                self.assertEqual(entry['sha256'],operator.hashlib.sha256(raw).hexdigest())
                self.assertEqual(j.reserve_control()['export_bytes'],len(raw))
                with self.assertRaises(FileExistsError):operator.export_sources(cloud,j,r,root/'evidence')

    def test_log_objects_export_first_without_raw_metadata(self):
        # LP-6: log objects in the state bucket carry no raw-v2 metadata and are exported
        # before the candidate's objects, so an exhausted allowance still keeps them.
        log=b'{"stop":"s3_authorization"}\n';r=owned_resources()
        key='logs/server2/guard/dt=2026-11-15/hour=01/i-0c0ffee0000002983/'+'b'*32+'-20261115T010000Z-u.ndjson.gz'
        item={'Key':key,'VersionId':'log-v1','Size':len(log)}
        def body(params,kwargs):
            self.assertEqual(params['Bucket'],r['buckets'][1])
            kwargs['output'].write_bytes(log)
            return cloud_json('GetObject',{'Metadata':{},'LastModified':'2026-11-15T01:00:50Z','VersionId':'log-v1','ContentLength':len(log),'ContentRange':f'bytes 0-{len(log)-1}/{len(log)}'})
        cloud=FixtureCloud([('ListObjectVersions',cloud_json('ListObjectVersions',{'IsTruncated':False,'Versions':[item]})),('GetObject',body),
                            ('ListObjectVersions',cloud_json('ListObjectVersions',{'IsTruncated':False}))])
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            with J(root/'journal',create=True,run_id='test1',manifest_sha=DIGEST,epoch=1000) as j:
                result=operator.export_sources(cloud,j,r,root/'evidence')
                self.assertTrue(result['complete'])
                self.assertEqual(result['objects'][0]['key'],key)
                self.assertEqual((root/'evidence'/result['objects'][0]['file']).read_bytes(),log)

    def test_export_exhaustion_and_wrong_version_are_incomplete(self):
        for exhausted in (True,False):
            with self.subTest(exhausted=exhausted),tempfile.TemporaryDirectory() as temp:
                root=Path(temp)
                def body(params,kwargs):
                    kwargs['output'].write_bytes(b'abc')
                    return cloud_json('GetObject',{'VersionId':'newer-version','ContentLength':3,'ContentRange':'bytes 0-2/3'})
                cloud=FixtureCloud([('ListObjectVersions',cloud_json('ListObjectVersions',{'IsTruncated':False,'Versions':[{'Key':'raw/a','VersionId':'v1','Size':3}]})),('GetObject',body)])
                with J(root/'journal',create=True,run_id='test1',manifest_sha=DIGEST,epoch=1000) as j:
                    if exhausted:j.reserve_control(export_bytes=2*1024**3)
                    with self.assertRaises(E):operator.export_sources(cloud,j,owned_resources(),root/'evidence')
                    self.assertFalse(json.loads((root/'evidence/manifest.json').read_text())['complete'])
                    self.assertEqual(len(cloud.calls),1 if exhausted else 2)

    def test_zero_length_original_uses_head_without_body_dispatch(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            cloud=FixtureCloud([('ListObjectVersions',cloud_json('ListObjectVersions',{'IsTruncated':False,'Versions':[{'Key':'raw/empty','VersionId':'empty-v1','Size':0}]})),
                ('HeadObject',cloud_json('HeadObject',{'Metadata':{},'LastModified':'2026-11-13T07:00:00Z','VersionId':'empty-v1','ContentLength':0})),
                ('ListObjectVersions',cloud_json('ListObjectVersions',{'IsTruncated':False}))])
            with J(root/'journal',create=True,run_id='test1',manifest_sha=DIGEST,epoch=1000) as j:
                result=operator.export_sources(cloud,j,owned_resources(),root/'evidence')
                self.assertTrue(result['complete']);self.assertEqual(result['objects'][0]['size'],0)
                self.assertEqual((root/'evidence'/result['objects'][0]['file']).read_bytes(),b'')
                self.assertEqual([call[0] for call in cloud.calls],['ListObjectVersions','HeadObject','ListObjectVersions'])

    def test_missing_or_corrupt_original_metadata_cannot_be_complete(self):
        import base64,copy
        identity=dict(source='kma',kind='current',key_sha256='a'*64,
            period=dict(local_date=20260131,slot='2300'),fetched_at_ms=1000,raw_sha256='b'*64)
        key='raw/v2/kma/current/2026/01/31/2300/'+'a'*64+'/1000-'+'b'*64+'.raw.gz'
        metadata={'s2-record':base64.b64encode(json.dumps(dict(schema=2,identity=identity)).encode()).decode(),
                  's2-gzip-sha256':operator.hashlib.sha256(b'raw').hexdigest()}
        valid=dict(VersionId='v1',ContentLength=3,ContentRange='bytes 0-2/3',
                   LastModified='2026-11-13T07:00:00Z',Metadata=metadata)
        for mode in ('missing','timestamp','timezone','hash','base64','key','oversized'):
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as temp:
                answer=copy.deepcopy(valid)
                if mode=='missing':answer.pop('Metadata')
                elif mode=='timestamp':answer.pop('LastModified')
                elif mode=='timezone':answer['LastModified']='2026-11-13T07:00:00'
                elif mode=='hash':answer['Metadata']['s2-gzip-sha256']='0'*64
                elif mode=='base64':answer['Metadata']['s2-record']='%'
                elif mode=='key':
                    changed=copy.deepcopy(identity);changed['fetched_at_ms']=1001
                    answer['Metadata']['s2-record']=base64.b64encode(json.dumps(dict(schema=2,identity=changed)).encode()).decode()
                else:answer['Metadata']['s2-record']='a'*2049
                def body(params,kwargs):
                    kwargs['output'].write_bytes(b'raw');return cloud_json('GetObject',answer)
                cloud=FixtureCloud([('ListObjectVersions',cloud_json('ListObjectVersions',
                    dict(IsTruncated=False,Versions=[dict(Key=key,VersionId='v1',Size=3)]))),('GetObject',body)])
                root=Path(temp)
                with J(root/'journal',create=True,run_id='test1',manifest_sha=DIGEST,epoch=1000) as j:
                    with self.assertRaises(E):operator.export_sources(cloud,j,owned_resources(),root/'export')
                    self.assertEqual(j.reserve_control()['export_bytes'],3)
                self.assertFalse(json.loads((root/'export/manifest.json').read_text())['complete'])

    def test_export_cannot_accept_a_prefix_as_the_complete_source(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            def body(params,kwargs):
                kwargs['output'].write_bytes(b'abc')
                return cloud_json('GetObject',{'VersionId':'v1','ContentLength':3,'ContentRange':'bytes 0-2/6'})
            cloud=FixtureCloud([('ListObjectVersions',cloud_json('ListObjectVersions',{'IsTruncated':False,'Versions':[{'Key':'raw/a','VersionId':'v1','Size':3}]})),
                ('GetObject',body),('ListObjectVersions',cloud_json('ListObjectVersions',{'IsTruncated':False}))])
            with J(root/'journal',create=True,run_id='test1',manifest_sha=DIGEST,epoch=1000) as j:
                with self.assertRaises(E):operator.export_sources(cloud,j,owned_resources(),root/'evidence')
                self.assertFalse(json.loads((root/'evidence/manifest.json').read_text())['complete'])

    def test_delete_versions_includes_markers_and_inspects_inner_errors(self):
        items={'IsTruncated':False,'Versions':[{'Key':'raw/a','VersionId':'v1','Size':3}],
               'DeleteMarkers':[{'Key':'raw/a','VersionId':'v2'}]}
        deleted=[{'Key':'raw/a','VersionId':'v1'},{'Key':'raw/a','VersionId':'v2'}]
        cloud=FixtureCloud([('ListObjectVersions',cloud_json('ListObjectVersions',items)),
                            ('DeleteObjects',cloud_json('DeleteObjects',{'Deleted':deleted})),
                            ('ListObjectVersions',cloud_json('ListObjectVersions',{'IsTruncated':False}))])
        self.assertEqual(operator.delete_versions(cloud,owned_resources()['buckets'][0]),2)
        self.assertEqual(cloud.calls[1][1]['Delete']['Objects'],deleted)
        cloud=FixtureCloud([('ListObjectVersions',cloud_json('ListObjectVersions',items)),
                            ('DeleteObjects',cloud_json('DeleteObjects',{'Deleted':deleted,'Errors':[{'Code':'AccessDenied'}]}))])
        with self.assertRaises(E):operator.delete_versions(cloud,owned_resources()['buckets'][0])

    def test_version_listing_cannot_silently_truncate(self):
        cloud=FixtureCloud([('ListObjectVersions',cloud_json('ListObjectVersions',{'IsTruncated':True,'Versions':[]}))])
        with self.assertRaises(E):list(operator.versions(cloud,owned_resources()['buckets'][0]))

    def test_actual_offline_absence_cli(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);resources=root/'resources.json';evidence=root/'responses.json'
            resources.write_text(json.dumps(owned_resources()))
            cloud=FixtureCloud(self.gone_replies());operator.inventory(cloud,owned_resources())
            entries=[]
            for (op,params),(_,reply) in zip(cloud.calls,self.gone_replies()):
                entries.append(dict(operation=op,params=params,returncode=0 if reply.kind=='json' else 254,
                    stdout=json.dumps(reply.payload) if reply.kind=='json' else '',
                    stderr='' if reply.kind=='json' else f'An error occurred (NoSuchEntity) when calling the {op} operation: absent'))
            evidence.write_text(json.dumps(entries))
            command=[sys.executable,str(SOURCE.with_name('coordinator.py')),'audit-absence','--resources',str(resources),'--evidence',str(evidence)]
            result=subprocess.run(command,capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            self.assertTrue(json.loads(result.stdout)['complete'])
            entries[-1]['returncode']=254;entries[-1]['stderr']='An error occurred (AccessDenied) when calling the ListBuckets operation: secret value'
            evidence.write_text(json.dumps(entries))
            result=subprocess.run(command,capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,1,result.stdout+result.stderr)
            self.assertNotIn('secret value',result.stdout)


class RecordedDispatchTests(unittest.TestCase):
    def test_request_is_durable_before_send_and_lost_ack_cannot_resend(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'state';params={'Bucket':'server2-shadow-test-raw'}
            with J(root,create=True,run_id='test1',manifest_sha=DIGEST,epoch=1000) as j:
                class Lost:
                    calls=0
                    def call(inner,op,actual):
                        inner.calls+=1
                        self.assertEqual(j.request('bucket')['params'],params)
                        self.assertIsNone(j.request('bucket')['receipt'])
                        raise TimeoutError('acknowledgement lost')
                cloud=Lost()
                with self.assertRaises(TimeoutError):
                    operator.dispatch_recorded(cloud,j,'bucket','CreateBucket',params,'bucket-token',now=1001)
            with J(root) as j:
                with self.assertRaises(E):
                    operator.dispatch_recorded(cloud,j,'bucket','CreateBucket',params,'bucket-token',now=1002)
                self.assertEqual(cloud.calls,1)
                self.assertIsNone(j.request('bucket')['receipt'])

    def test_actual_typed_creation_failure_is_retained_without_success_relabel(self):
        with tempfile.TemporaryDirectory() as temp:
            with J(Path(temp)/'state',create=True,run_id='test1',manifest_sha=DIGEST,epoch=1000) as j:
                cloud=FixtureCloud([('CreateBucket',state.CloudResult('service_error','CreateBucket',code='BucketAlreadyOwnedByYou'))])
                result=operator.dispatch_recorded(cloud,j,'bucket','CreateBucket',{'Bucket':'server2-shadow-test-raw'},'bucket-token',now=1001)
                self.assertEqual(result.kind,'service_error')
                self.assertEqual(j.request('bucket')['receipt']['code'],'BucketAlreadyOwnedByYou')
                with self.assertRaises(E):operator.dispatch_recorded(cloud,j,'bucket','CreateBucket',{},'new-token',now=1002)
                self.assertEqual(len(cloud.calls),1)


def paid_policy():
    return dict(schema=1,observed_at=1000,prices_sha256='d'*64,
        usd_per_unit=dict(visual_crossing=None,google_geocode='0.005',google_air='0.005',openweather=None),
        grants={g:dict(zip(state.PAID_PROVIDERS,u)) for g,u in
                zip(state.GENERATIONS,[(0,400,400,0),(0,50,50,0),(0,50,50,0)])})


class PaidPolicyTests(unittest.TestCase):
    def test_paid_grants_fit_inside_the_ceiling(self):
        # SR-4: the priced grants of all generations must fit inside the ceiling minus the
        # prior spend and the finish reserve (was a separate USD 5 budget).
        from decimal import Decimal as D
        policy=paid_policy()
        self.assertEqual(state.validate_paid_policy(policy,1000),'5.000')
        self.assertEqual(state.validate_paid_policy(policy,1000,budget=D(5)),'5.000')
        with self.assertRaisesRegex(E,'budget'):state.validate_paid_policy(policy,1000,budget=D('4.999'))
        policy['grants']['restart-2']['google_air']+=1000
        self.assertEqual(state.validate_paid_policy(policy,1000),'10.000')

    def test_unknown_or_zero_tariff_cannot_enable_provider(self):
        for name in ('visual_crossing','openweather'):
            policy=paid_policy();policy['grants']['initial'][name]=1
            with self.assertRaisesRegex(E,'unpriced'):state.validate_paid_policy(policy,1000)
        for bad in ('0','NaN','-1','1e-5',True):
            policy=paid_policy();policy['usd_per_unit']['google_air']=bad
            with self.assertRaises(E):state.validate_paid_policy(policy,1000)
        policy=paid_policy();policy['grants']['initial']['google_air']=True
        with self.assertRaises(E):state.validate_paid_policy(policy,1000)
        with self.assertRaisesRegex(E,'freshness'):state.validate_paid_policy(paid_policy(),1000+8*86400)

COLLECTOR_MEMBER='./vector-x86_64-unknown-linux-musl/bin/vector'


def collector_fixture(source,binary=b'#!/bin/sh\nexit 0\n'):
    """A collector archive with the release layout, and a pin naming it (LP-6)."""
    import io,tarfile
    with tarfile.open(source/'collector.tar.gz','w:gz') as archive:
        item=tarfile.TarInfo(COLLECTOR_MEMBER);item.size=len(binary);item.mode=0o755
        archive.addfile(item,io.BytesIO(binary))
    pin=dict(collector='vector',version='0.61.0',artifacts=dict(x86_64=dict(
        url='https://github.com/vectordotdev/vector/releases/download/v0.61.0/fixture.tar.gz',
        sha256=operator.artifact_hash(source/'collector.tar.gz'),binary=COLLECTOR_MEMBER)))
    (source/'collector.json').write_text(json.dumps(pin))


class HostBundleTests(unittest.TestCase):
    def files(self,root):
        source=root/'source';source.mkdir()
        for name in operator.HOST_ARTIFACTS-{'collector.tar.gz','collector.json'}:
            (source/name).write_bytes(('fixture '+name).encode())
        collector_fixture(source)
        for name in operator.HOST_ARTIFACTS:(source/name).chmod(0o600)
        plan=dict(schema=4,native_families=['kma'],run_id='test1',source_commit='c'*40,port=3000,interface='ens5',cost_policy=cost_policy(),paid_policy=paid_policy(),
                  artifacts={n:operator.artifact_hash(source/n) for n in operator.HOST_ARTIFACTS})
        return source,plan

    def test_missing_paid_policy_cannot_launch(self):
        with tempfile.TemporaryDirectory() as temp:
            _,plan=self.files(Path(temp))
            plan.pop('paid_policy',None)
            launch=dict(plan=plan,epoch=1000,generation='initial',allowance=dict(reads=10,writes=20,put_bytes=30))
            with self.assertRaises(E):operator.launch_plan(launch)

    def test_paid_grants_above_the_ceiling_budget_cannot_launch(self):
        with tempfile.TemporaryDirectory() as temp:
            _,plan=self.files(Path(temp))
            plan['cost_policy']['prior_spend_usd']='290'   # 300 - 290 - 5 reserve = 5 left
            launch=dict(plan=plan,epoch=1000,generation='initial',allowance=dict(reads=10,writes=20,put_bytes=30))
            operator.launch_plan(launch)
            plan['cost_policy']['prior_spend_usd']='290.01'
            with self.assertRaisesRegex(E,'budget'):operator.launch_plan(launch)

    def test_candidate_environment_uses_only_owned_storage_and_no_push(self):
        with tempfile.TemporaryDirectory() as temp:
            _,plan=self.files(Path(temp))
            launch=dict(plan=plan,epoch=1000,generation='initial',allowance=dict(reads=10,writes=20,put_bytes=30))
            env=operator.candidate_environment(launch)
            self.assertEqual(env.get('AWS_ACCESS_KEY'),'')
            self.assertEqual(env.get('AWS_SECRET_KEY'),'')
            self.assertEqual(env.get('SERVER2_S3_BUCKET'),'server2-shadow-test1-raw')
            self.assertEqual(env.get('SERVER2_S3_REGION'),'ap-northeast-2')
            self.assertEqual(env.get('SERVER2_GATEWAY_LEGACY_URL'),'http://127.0.0.1:9')
            self.assertNotIn('push',env.get('SERVER2_NATIVE_FAMILIES','').split(','))

    def test_delivery_or_duplicate_native_family_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            _,plan=self.files(Path(temp))
            for families in (['push'],['kma','push'],['kma','kma'],[None]):
                plan['native_families']=families
                with self.assertRaises(E):operator.host_plan(plan)

    def test_bundle_precharges_before_copy_and_never_reuses_grant(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source,plan=self.files(root)
            sha=operator.hashlib.sha256(state.canonical(plan).encode()).hexdigest()
            with J(root/'journal',create=True,run_id='test1',manifest_sha=sha,epoch=1000) as j:
                allocation=dict(reads=10,writes=20,put_bytes=30)
                launch=operator.prepare_generation(j,plan,source,root/'bundle','initial',allocation,now=1001)
                self.assertEqual(launch['epoch'],1000)
                self.assertEqual(j.snapshot()['allocated'],allocation)
                self.assertEqual((root/'bundle/config.env').stat().st_mode&0o777,0o600)
                with self.assertRaises(E):operator.prepare_generation(j,plan,source,root/'second','initial',allocation,now=1002)
                self.assertFalse((root/'second').exists())
                (source/'server2').write_bytes(b'changed')
                with self.assertRaises(E):operator.prepare_generation(j,plan,source,root/'second','restart-1',allocation,now=1002)
                self.assertEqual(j.snapshot()['generations'],1)

    def test_unpinned_collector_archive_is_refused_before_the_grant(self):
        for defect in ('archive','pin'):
            with self.subTest(defect=defect),tempfile.TemporaryDirectory() as temp:
                root=Path(temp);source,plan=self.files(root)
                if defect=='archive':collector_fixture(source,binary=b'changed collector');(source/'collector.json').write_text(json.dumps(json.loads((source/'collector.json').read_text())|{'artifacts':{}}))
                else:(source/'collector.json').write_text(json.dumps(dict(artifacts=dict(x86_64=dict(sha256='f'*64,binary=COLLECTOR_MEMBER)))))
                for name in ('collector.tar.gz','collector.json'):plan['artifacts'][name]=operator.artifact_hash(source/name)
                sha=operator.hashlib.sha256(state.canonical(plan).encode()).hexdigest()
                with J(root/'journal',create=True,run_id='test1',manifest_sha=sha,epoch=1000) as j:
                    with self.assertRaisesRegex(E,'collector'):
                        operator.prepare_generation(j,plan,source,root/'bundle','initial',dict(reads=10,writes=20,put_bytes=30),now=1001)
                    self.assertEqual(j.snapshot()['generations'],0)
                    self.assertFalse((root/'bundle').exists())

    def test_changed_plan_cannot_consume_an_existing_journal(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source,plan=self.files(root)
            with J(root/'journal',create=True,run_id='test1',manifest_sha=DIGEST,epoch=1000) as j:
                with self.assertRaises(E):operator.prepare_generation(j,plan,source,root/'bundle','initial',dict(reads=10,writes=20,put_bytes=30),now=1001)
                self.assertEqual(j.snapshot()['generations'],0)

    def test_units_keep_original_deadlines_no_autorestart_and_guard_coupling(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source,plan=self.files(root)
            first=dict(plan=plan,epoch=1000,generation='initial',allowance=dict(reads=10,writes=20,put_bytes=30))
            restart=dict(first,generation='restart-1')
            units=operator.host_units(first);second=operator.host_units(restart)
            self.assertEqual(units['server2-shadow-test1-stop.timer'],second['server2-shadow-test1-stop.timer'])
            self.assertIn('1970-01-08 00:16:40 UTC',units['server2-shadow-test1-stop.timer'])
            self.assertIn('1970-01-08 02:16:40 UTC',units['server2-shadow-test1-poweroff.timer'])
            for suffix in ('candidate','guard','reader'):
                self.assertIn('Restart=no',units['server2-shadow-test1-'+suffix+'.service'])
            self.assertIn('BindsTo=server2-shadow-test1-guard.service',units['server2-shadow-test1-reader.service'])
            self.assertIn('WatchdogSec=30',units['server2-shadow-test1-guard.service'])
            self.assertEqual(guard.INTERVAL,10)
            self.assertIn('TimeoutStopSec=10',units['server2-shadow-test1-candidate.service'])
            self.assertNotIn('AWS_SECRET',state.canonical(units))
            self.assertEqual(len(units),11)
            env=operator.candidate_environment(first)
            self.assertEqual(env['SERVER2_SHADOW_S3_LIMITS'],'10,20,30')
            self.assertEqual(env['SERVER2_SHADOW_PROVIDER_UNITS'],'0,400,400,0')
            self.assertEqual(operator.candidate_environment(restart)['SERVER2_SHADOW_PROVIDER_UNITS'],'0,50,50,0')
            self.assertEqual(set(env),{'PATH','PORT','OPENSHIFT_NODEJS_IP','SERVER2_SHADOW_S3_LIMITS','SERVER2_SHADOW_PROVIDER_UNITS','AWS_ACCESS_KEY','AWS_SECRET_KEY','SERVER2_S3_BUCKET','SERVER2_S3_REGION','SERVER2_NATIVE_FAMILIES','SERVER2_GATEWAY_LEGACY_URL'})
            launch=source/'launch.json';launch.write_text(json.dumps(first))
            command=[sys.executable,str(SOURCE.with_name('coordinator.py')),'render-host','--launch',str(launch),'--output',str(root/'units')]
            result=subprocess.run(command,capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            self.assertFalse(json.loads(result.stdout)['executed'])
            self.assertEqual(len(list((root/'units').iterdir())),11)
            (source/'server2').write_bytes(b'wrong executable')
            command[-1]=str(root/'rejected-units')
            result=subprocess.run(command,capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,2)
            self.assertFalse((root/'rejected-units').exists())



class HostLoggingTests(unittest.TestCase):
    """LP-6 (#2983): the host's candidate, guard and reader output is shipped."""
    def launch(self,root):
        _,plan=HostBundleTests.files(self,root)
        return dict(plan=plan,epoch=1000,generation='initial',allowance=dict(reads=10,writes=20,put_bytes=30))

    def test_acquisition_units_log_to_the_namespace_without_depending_on_the_collector(self):
        with tempfile.TemporaryDirectory() as temp:
            units=operator.host_units(self.launch(Path(temp)));name='server2-shadow-test1-'
            for suffix in ('candidate','guard','reader'):
                unit=units[name+suffix+'.service']
                self.assertIn('\nLogNamespace=server2\n',unit)
                self.assertIn('\nAfter=systemd-journald@server2.service\n',unit)
                # No relation to the collector at all, not even ordering (CX-LP6-001).
                self.assertNotIn('logs.service',unit)
                self.assertIn('Restart=no\nTimeoutStopSec=10\n',unit)
            self.assertIn('WatchdogSec=30\nWatchdogSignal=SIGKILL\n',units[name+'guard.service'])
            self.assertNotIn('LogNamespace',units[name+'stop.service']+units[name+'poweroff.service'])

    def test_collector_units_read_the_owned_units_with_their_sources(self):
        with tempfile.TemporaryDirectory() as temp:
            units=operator.host_units(self.launch(Path(temp)));name='server2-shadow-test1-'
            collector=units[name+'logs.service'];root='/opt/server2-shadow/test1'
            mapping=' '.join(['--unit '+name+'candidate.service=server','--unit '+name+'copy.service=copy',
                              '--unit '+name+'finalize.service=copy','--unit '+name+'guard.service=guard',
                              '--unit '+name+'logs.service=collector','--unit '+name+'reader.service=reader'])
            for command in ('ExecCondition=/usr/bin/python3 -I '+root+'/bin/render.py --env-file '+root+'/config/logging.env',
                            'ExecStartPre=/usr/bin/python3 -I '+root+'/bin/status.py start',
                            'ExecStop=/usr/bin/python3 -I '+root+'/bin/status.py drain'):
                line=[l for l in collector.splitlines() if l.startswith(command)]
                self.assertEqual(len(line),1,command);self.assertTrue(line[0].endswith(mapping),line[0])
            self.assertIn('ExecStart='+root+'/bin/vector --config /run/server2-logs/vector.json',collector)
            self.assertIn('--timeout 75 --main-pid=${MAINPID}',collector)
            self.assertIn('TimeoutStopSec=100\n',collector);self.assertIn('RestartForceExitStatus=0\n',collector)
            self.assertIn('--version-file '+root+'/bin/collector.json',collector)
            # No periodic status records: they would add an object every 50 s (CX-LP6-002).
            self.assertFalse(any('status' in unit for unit in units if unit.startswith(name+'logs')))

    def test_settings_select_the_run_state_bucket_under_the_collector_rules(self):
        import importlib
        logging_dir=SOURCE.parents[1]/'logging'
        sys.path.insert(0,str(logging_dir))
        try:render=importlib.import_module('render')
        finally:sys.path.remove(str(logging_dir))
        with tempfile.TemporaryDirectory() as temp:
            text=operator.logging_settings(self.launch(Path(temp)))
        values=render.parse_dotenv(text)
        config=render.settings({name:values.get(name) for name in render.ALLOWED})
        self.assertEqual(config['sinks'],['s3'])
        self.assertEqual(values['SERVER2_S3_BUCKET'],'server2-shadow-test1-state')
        self.assertEqual(values['SERVER2_LOG_S3_PREFIX'],'logs/server2')
        self.assertEqual(config['s3_level'],'warn')
        self.assertNotIn('KEY',text)
        reviewed=(logging_dir/'units/journald@server2.conf').read_text()
        self.assertEqual(operator.LOG_JOURNAL,''.join(line+'\n' for line in reviewed.splitlines() if line and not line.startswith('#')))


class CleanupTests(unittest.TestCase):
    gone_replies = OperatorTests.gone_replies
    def make_journal(self,root):
        j=J(root,create=True,run_id='test1',manifest_sha=DIGEST,epoch=1000)
        r=owned_resources()
        j.prepare_request('launch','RunInstances',{'ClientToken':'fixed-launch','MinCount':1,'MaxCount':1,
            'InstanceType':'t3.small','ImageId':'ami-12345678','SubnetId':'subnet-12345678'},'fixed-launch',now=1000)
        # A lost launch acknowledgement is recoverable from the same token;
        # creation of the non-idempotent named resources needs successful receipts.
        j.record_receipt('launch',state.CloudResult('timeout','RunInstances'))
        for key,bucket in zip(('bucket-raw','bucket-state'),r['buckets']):
            j.prepare_request(key,'CreateBucket',{'Bucket':bucket,'CreateBucketConfiguration':{'LocationConstraint':'ap-northeast-2'}},key,now=1000)
            j.record_receipt(key,cloud_json('CreateBucket',{'Location':'/'+bucket}))
        for key,op,name_field,response_field in [('role','CreateRole','RoleName','Role'),
                ('profile','CreateInstanceProfile','InstanceProfileName','InstanceProfile')]:
            j.prepare_request(key,op,{name_field:r[key]},key,now=1000)
            j.record_receipt(key,cloud_json(op,{response_field:{name_field:r[key]}}))
        j.prepare_request('security-group','CreateSecurityGroup',{'GroupName':'server2-shadow-test1'},'security-group',now=1000)
        j.record_receipt('security-group',cloud_json('CreateSecurityGroup',{'GroupId':r['security_group']}))
        return j

    def binding_replies(self):
        r=owned_resources();tags=[{'Key':'ShadowRunId','Value':r['run_id']}]
        instance=dict(InstanceId=r['instance'],ClientToken='fixed-launch',Tags=tags,InstanceType='t3.small',
                      ImageId='ami-12345678',SubnetId='subnet-12345678',
                      SecurityGroups=[{'GroupId':r['security_group'],'GroupName':'server2-shadow-test1'}],
                      BlockDeviceMappings=[{'Ebs':{'VolumeId':r['volumes'][0],'DeleteOnTermination':True}}])
        replies=[('DescribeInstances',cloud_json('DescribeInstances',{'Reservations':[{'Instances':[instance]}]}))]
        for bucket in r['buckets']:
            replies.extend([('GetBucketTagging',cloud_json('GetBucketTagging',{'TagSet':tags})),
                            ('GetBucketVersioning',cloud_json('GetBucketVersioning',{'Status':'Enabled'}))])
        replies.extend([('GetRole',cloud_json('GetRole',{'Role':{'Tags':tags,'Arn':'arn:aws:iam::123456789012:role/server2-shadow-test1'}})),
                        ('GetInstanceProfile',cloud_json('GetInstanceProfile',{'InstanceProfile':{'Tags':tags,'Arn':'arn:aws:iam::123456789012:instance-profile/server2-shadow-test1'}})),
                        ('DescribeSecurityGroups',cloud_json('DescribeSecurityGroups',{'SecurityGroups':[{'GroupId':r['security_group'],'Tags':tags}]})),
                        ('DescribeVolumes',cloud_json('DescribeVolumes',{'Volumes':[{'VolumeId':r['volumes'][0],'Tags':tags,'Size':32,'VolumeType':'gp3','Encrypted':True}]}))])
        return replies

    def test_binding_requires_original_token_tags_and_versioning(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.make_journal(Path(temp)/'state') as j:
                bad=self.binding_replies();bad[0][1].payload['Reservations'][0]['Instances'][0]['ClientToken']='foreign'
                with self.assertRaises(E):operator.bind_resources(FixtureCloud(bad),j,owned_resources(),now=1001)
                self.assertIsNone(j.mutation('owned-resources'))
                bad=self.binding_replies();bad[2]=('GetBucketVersioning',cloud_json('GetBucketVersioning',{'Status':'Suspended'}))
                with self.assertRaises(E):operator.bind_resources(FixtureCloud(bad),j,owned_resources(),now=1001)
                self.assertIsNone(j.mutation('owned-resources'))
                operator.bind_resources(FixtureCloud(self.binding_replies()),j,owned_resources(),now=1001)
                self.assertEqual(j.mutation('owned-resources')['params_sha'],operator.resource_digest(owned_resources()))
                with self.assertRaises(E):operator.bind_resources(FixtureCloud([]),j,owned_resources()|{'instance':'i-aaaaaaaaaaaaaaaaa'},now=1002)

    def test_cleanup_cannot_act_on_unbound_or_different_resources(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.make_journal(Path(temp)/'state') as j:
                cloud=FixtureCloud([])
                with self.assertRaises(E):operator.cleanup(cloud,j,owned_resources())
                self.assertEqual(cloud.calls,[])

    def test_intents_and_tags_without_creation_receipts_cannot_bind(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.make_journal(Path(temp)/'state') as j:
                # Keep the original request identity but remove its acknowledgement.
                j.db.execute("UPDATE requests SET receipt=NULL WHERE id='bucket-raw'")
                with self.assertRaises(E):
                    operator.bind_resources(FixtureCloud(self.binding_replies()),j,owned_resources(),now=1001)
                self.assertIsNone(j.mutation('owned-resources'))

    def test_unknown_termination_prevents_source_deletion(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.make_journal(Path(temp)/'state') as j:
                operator.bind_resources(FixtureCloud(self.binding_replies()),j,owned_resources(),now=1001)
                cloud=FixtureCloud([('TerminateInstances',operator.CloudResult('timeout','TerminateInstances')),
                                    ('DescribeInstances',operator.CloudResult('command_error','DescribeInstances'))])
                result=operator.cleanup(cloud,j,owned_resources())
                self.assertFalse(result['resources_gone']);self.assertEqual(result['pending'],'termination_unconfirmed')
                self.assertEqual(len(cloud.calls),2)

    def test_lost_termination_ack_is_reconciled_and_deletions_read_back(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.make_journal(Path(temp)/'state') as j:
                operator.bind_resources(FixtureCloud(self.binding_replies()),j,owned_resources(),now=1001)
                terminated=self.gone_replies()[0]
                replies=[('TerminateInstances',operator.CloudResult('timeout','TerminateInstances')),terminated]
                for bucket in owned_resources()['buckets']:
                    replies.extend([('ListObjectVersions',cloud_json('ListObjectVersions',{'IsTruncated':False})),
                                    ('DeleteBucket',operator.CloudResult('empty_success','DeleteBucket'))])
                for op in ('RemoveRoleFromInstanceProfile','DeleteInstanceProfile','DeleteRolePolicy','DeleteRole','DeleteSecurityGroup'):
                    replies.append((op,operator.CloudResult('empty_success',op)))
                replies.append(('DescribeVolumes',cloud_json('DescribeVolumes',{'Volumes':[]})))
                replies.extend(self.gone_replies())
                cloud=FixtureCloud(replies);result=operator.cleanup(cloud,j,owned_resources())
                self.assertTrue(result['resources_gone']);self.assertEqual(result['qualification'],'not_assessed')
                self.assertIsNone(result['sources_complete']);self.assertFalse(cloud.replies)
                bad=list(replies);bad[-1]=('ListBuckets',operator.CloudResult('service_error','ListBuckets',code='AccessDenied'))
                self.assertFalse(operator.cleanup(FixtureCloud(bad),j,owned_resources())['resources_gone'])


class HostInstallTests(unittest.TestCase):
    def bundle(self, root):
        source, plan = HostBundleTests.files(self, root)
        reader = dict(schema=1, duration_seconds=168*3600, max_attempts=6000,
            min_spacing_seconds=120, candidate_sha256=plan['artifacts']['server2'],
            cases=[dict(id='seoul', method='GET', path='/weather/coord/37.566,126.978',
                        interval_seconds=3600, conditional=False)])
        (source/'reader.json').write_text(json.dumps(reader))
        plan['artifacts']['reader.json']=operator.artifact_hash(source/'reader.json')
        launch=dict(plan=plan,epoch=1000,generation='initial',allowance=dict(reads=10,writes=20,put_bytes=30))
        (source/'launch.json').write_text(json.dumps(launch));(source/'launch.json').chmod(0o600)
        return source,launch

    class System:
        def __init__(self, fail=None):self.calls=[];self.fail=fail
        def run(self,*args):
            self.calls.append(args)
            if args==self.fail:raise E('injected service failure')
            if args[0]=='is-enabled':return 'enabled'
            if args[:2]==('show','--property=LoadState'):return 'not-found'
            if args[:2]==('show','--property=ActiveState'):return 'active'
            return ''

    def install(self, source, root, system, now=1001):
        launch=operator.verify_bundle(source)
        (root/'units').mkdir(exist_ok=True)
        for unit,content in operator.launch_expiry_units(launch['plan']['run_id'],launch['epoch']).items():
            (root/'units'/unit).write_text(content)
        return operator.install_host_tree(source,root/'host',root/'units',system,now=now,machine='x86_64')

    def test_install_starts_timers_before_candidate_and_reader_last(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source,launch=self.bundle(root);system=self.System()
            result=self.install(source,root,system)
            self.assertEqual(result['status'],'started')
            self.assertEqual(result['collection_until'],1000+168*3600)
            self.assertEqual((root/'host/config/.env').read_bytes(),(source/'config.env').read_bytes())
            self.assertEqual((root/'host/config/.env').stat().st_mode&0o777,0o600)
            starts=[call for call in system.calls if call[0]=='start']
            self.assertEqual(starts,[('start','server2-shadow-test1-stop.timer','server2-shadow-test1-poweroff.timer'),
                ('start','server2-shadow-test1-copy.timer'),
                ('start','--no-block','server2-shadow-test1-logs.service'),
                ('start','server2-shadow-test1-candidate.service'),('start','server2-shadow-test1-reader.service'),
                ('start','--no-block','server2-shadow-test1-copy.service')])
            self.assertIn(('enable','server2-shadow-test1-logs.service'),system.calls)
            # The collector's state is never awaited or checked before acquisition starts.
            self.assertNotIn(('show','--property=ActiveState','--value','server2-shadow-test1-logs.service'),system.calls)
            self.assertEqual((root/'host/bin/vector').read_bytes(),b'#!/bin/sh\nexit 0\n')
            self.assertEqual((root/'host/bin/vector').stat().st_mode&0o777,0o700)
            self.assertEqual((root/'host/config/logging.env').read_text(),operator.logging_settings(launch))
            self.assertEqual((root/'host/config/logging.env').stat().st_mode&0o777,0o600)
            self.assertEqual((root/'journald@server2.conf').read_text(),operator.LOG_JOURNAL)
            for name in ('collector.tar.gz','collector.json','render.py','status.py'):
                self.assertEqual(operator.artifact_hash(root/'host/bin'/name),launch['plan']['artifacts'][name])
            self.assertTrue((root/'host/state/install.json').is_file())
            before=list(system.calls)
            with self.assertRaises(E):self.install(source,root,system)
            self.assertEqual(system.calls,before)

    def test_install_refuses_missing_changed_or_inactive_launch_expiry(self):
        for mode in ('missing','changed','inactive','disabled'):
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as temp:
                root=Path(temp);source,launch=self.bundle(root);units=root/'units';units.mkdir()
                if mode!='missing':
                    for unit,content in operator.launch_expiry_units('test1',1000).items():
                        (units/unit).write_text(content+('# changed' if mode=='changed' else ''))
                class System(self.System):
                    def run(inner,*args):
                        if args[-1]=='server2-shadow-test1-launch-expiry.timer':
                            if mode=='inactive' and args[0]=='show':return 'inactive'
                            if mode=='disabled' and args[0]=='is-enabled':return 'disabled'
                        return super().run(*args)
                system=System()
                with self.assertRaises(E):
                    operator.install_host_tree(source,root/'host',units,system,now=1001,machine='x86_64')
                self.assertFalse((root/'host').exists())
                self.assertFalse(any(call[0]=='start' for call in system.calls))

    def test_failure_retains_exclusive_install_and_stops_all_acquisition(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source,_=self.bundle(root)
            system=self.System(('start','server2-shadow-test1-candidate.service'))
            with self.assertRaises(E):self.install(source,root,system)
            self.assertEqual(system.calls[-1],('stop','server2-shadow-test1-reader.service',
                'server2-shadow-test1-candidate.service','server2-shadow-test1-guard.service'))
            self.assertEqual(json.loads((root/'host/state/install.json').read_text())['status'],'failed')
            self.assertFalse(any(c==('start','server2-shadow-test1-reader.service') for c in system.calls))
            with self.assertRaises(E):self.install(source,root,self.System())

    def test_collector_architecture_settings_or_start_failure_refuse_the_candidate(self):
        for defect in ('architecture','journal-settings','collector-changed'):
            with self.subTest(defect=defect),tempfile.TemporaryDirectory() as temp:
                root=Path(temp);source,launch=self.bundle(root)
                class System(self.System):
                    def run(inner,*args):
                        if defect=='collector-inactive' and args[-1]=='server2-shadow-test1-logs.service' and args[0]=='show' and 'ActiveState' in args[1]:
                            inner.calls.append(args);return 'failed'
                        return super().run(*args)
                system=System()
                if defect=='journal-settings':(root/'journald@server2.conf').write_text('[Journal]\n')
                if defect=='collector-changed':(source/'render.py').write_text('changed renderer')
                launch_units=root/'units';launch_units.mkdir()
                for unit,content in operator.launch_expiry_units('test1',1000).items():(launch_units/unit).write_text(content)
                with self.assertRaises(E):
                    operator.install_host_tree(source,root/'host',launch_units,system,now=1001,
                                               machine='aarch64' if defect=='architecture' else 'x86_64')
                self.assertFalse(any(c==('start','server2-shadow-test1-candidate.service') for c in system.calls))
                self.assertFalse((root/'host').exists())

    def test_a_failing_collector_start_never_blocks_acquisition(self):
        # CX-LP6-001: acquisition starts whatever the collector does.
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source,_=self.bundle(root)
            system=self.System(('start','--no-block','server2-shadow-test1-logs.service'))
            result=self.install(source,root,system)
            self.assertEqual(result['status'],'started');self.assertTrue(result['collector_start_failed'])
            self.assertIn(('start','server2-shadow-test1-candidate.service'),system.calls)
            self.assertEqual(system.calls[-2:],[('show','--property=ActiveState','--value','server2-shadow-test1-reader.service'),
                                                ('start','--no-block','server2-shadow-test1-copy.service')])

    def test_changed_bundle_expiry_and_existing_unit_fail_before_install(self):
        for defect in ('changed','expired','unit','reader-hash'):
            with self.subTest(defect=defect),tempfile.TemporaryDirectory() as temp:
                root=Path(temp);source,launch=self.bundle(root);system=self.System()
                if defect=='changed':(source/'server2').write_bytes(b'changed')
                if defect=='unit':
                    (root/'units').mkdir();(root/'units/server2-shadow-test1-candidate.service').write_text('unrelated')
                if defect=='reader-hash':
                    reader=json.loads((source/'reader.json').read_text());reader['candidate_sha256']='e'*64
                    (source/'reader.json').write_text(json.dumps(reader))
                    launch['plan']['artifacts']['reader.json']=operator.artifact_hash(source/'reader.json')
                    (source/'launch.json').write_text(json.dumps(launch))
                with self.assertRaises(E):self.install(source,root,system,now=1000+168*3600 if defect=='expired' else 1001)
                self.assertFalse((root/'host').exists())
                self.assertFalse(any(c[0]=='start' for c in system.calls))

sys.modules['coordinator']=operator
provision_spec=importlib.util.spec_from_file_location('shadow_provision',SOURCE.with_name('provision.py'))
provision=importlib.util.module_from_spec(provision_spec);provision_spec.loader.exec_module(provision)
remote_spec=importlib.util.spec_from_file_location('shadow_remote',SOURCE.with_name('remote.py'))
remote=importlib.util.module_from_spec(remote_spec);remote_spec.loader.exec_module(remote)
sys.modules['remote']=remote


class RemoteTests(unittest.TestCase):
    def binding(self):
        wire=b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20'+b'x'*32
        return dict(schema=1,run_id='test1',instance=owned_resources()['instance'],ipv4='8.8.8.8',
                    host_key='ssh-ed25519 '+remote.base64.b64encode(wire).decode())

    def test_untrusted_key_scan_needs_matching_owned_console_fingerprint(self):
        b=self.binding();blob=remote.base64.b64decode(b['host_key'].split()[1])
        fingerprint='SHA256:'+remote.base64.b64encode(operator.hashlib.sha256(blob).digest()).decode().rstrip('=')
        with tempfile.TemporaryDirectory() as temp:
            with J(Path(temp)/'state',create=True,run_id='test1',manifest_sha=DIGEST,epoch=1000) as j:
                j.record_cleanup_ownership(operator.resource_digest(owned_resources()),b['instance'])
                def responses(value):
                    return FixtureCloud([('DescribeInstances',cloud_json('DescribeInstances',{'Reservations':[{'Instances':[
                        {'InstanceId':b['instance'],'PublicIpAddress':b['ipv4'],'State':{'Name':'running'}}]}]})),
                        ('GetConsoleOutput',cloud_json('GetConsoleOutput',{'InstanceId':b['instance'],
                            'Output':remote.base64.b64encode(value.encode()).decode()}))])
                scan=lambda address:address+' '+b['host_key']+'\n'
                with self.assertRaises(E):remote.bind_target(responses('SHA256:'+'a'*43),j,owned_resources(),scan,now=1001)
                self.assertIsNone(j.request('ssh-target'))
                self.assertEqual(remote.bind_target(responses(fingerprint),j,owned_resources(),scan,now=1002),b)
                self.assertEqual(j.request('ssh-target')['params'],b)

    def test_lost_install_ack_observes_original_tree_without_second_upload(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source,plan=HostBundleTests.files(self,root)
            sha=operator.hashlib.sha256(state.canonical(plan).encode()).hexdigest()
            with J(root/'state',create=True,run_id='test1',manifest_sha=sha,epoch=1000) as j:
                launch=operator.prepare_generation(j,plan,source,root/'bundle','initial',dict(reads=10,writes=20,put_bytes=30),now=1001)
                b=self.binding();j.prepare_request('ssh-target','BindSshTarget',b,b['instance'],now=1001)
                j.record_receipt('ssh-target',cloud_json('BindSshTarget',{'bound':True}))
                class Transport:
                    binding=b
                    uploads=0
                    unavailable=True
                    active=True
                    def invoke(inner,action,**kwargs):
                        if action=='install':
                            inner.uploads+=1
                            self.assertIsNotNone(j.request('host-install'))
                            with remote.tarfile.open(fileobj=kwargs['archive'],mode='r') as archive:
                                self.assertEqual(set(archive.getnames()),operator.HOST_ARTIFACTS|{'launch.json'})
                                self.assertEqual(archive.extractfile('config.env').read(),(source/'config.env').read_bytes())
                            return state.CloudResult('timeout','HostInstall')
                        if inner.unavailable:return state.CloudResult('timeout','HostObserve')
                        return cloud_json('HostObserve',dict(status='started',epoch=1000,
                            unit_states=dict(candidate='active' if inner.active else 'inactive',reader='active',guard='active',logs='failed'),
                            collection_until=1000+168*3600,cleanup_until=1000+170*3600,
                            launch_sha256=operator.hashlib.sha256((state.canonical(launch)+'\n').encode()).hexdigest()))
                transport=Transport()
                self.assertEqual(remote.install_remote(transport,j,root/'bundle',now=1002)['status'],'pending')
                transport.unavailable=False
                self.assertEqual(remote.install_remote(transport,j,root/'bundle',now=1003)['status'],'started')
                self.assertEqual(transport.uploads,1)
                self.assertEqual(j.request('host-install')['receipt']['kind'],'timeout')
                transport.active=False
                self.assertEqual(remote.install_remote(transport,j,root/'bundle',now=1003)['status'],'stopped')
                (root/'bundle/config.env').write_text('changed')
                with self.assertRaises(E):remote.install_remote(transport,j,root/'bundle',now=1004)
                self.assertEqual(transport.uploads,1)

    def test_running_collector_blocks_the_evidence_export(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            with J(root/'journal',create=True,run_id='test1',manifest_sha=DIGEST,epoch=1000) as j:
                b=self.binding();j.prepare_request('ssh-target','BindSshTarget',b,b['instance'],now=1001)
                j.prepare_request('host-install','HostInstall',{'launch_sha256':'a'*64},'host-install',now=1001)
                class Transport:
                    binding=b
                    calls=[]
                    def invoke(inner,action,**kwargs):
                        inner.calls.append(action)
                        if action=='stop':return state.CloudResult('empty_success','HostObserve')
                        return cloud_json('HostObserve',dict(launch_sha256='a'*64,unit_states=dict(
                            candidate='inactive',reader='inactive',guard='failed',logs='active')))
                transport=Transport();report=remote.retain_host_evidence(transport,j,root/'retained')
                self.assertFalse(report['complete']);self.assertEqual(transport.calls,['stop','inspect'])

    def test_actual_ssh_subprocess_pins_key_and_disables_ambient_config(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);identity=root/'identity';identity.write_text('fixture only');identity.chmod(0o600)
            record=root/'argv.json';executable=root/'fixture-ssh'
            executable.write_text('#!'+sys.executable+'\nimport sys,json\nfrom pathlib import Path\nPath('+repr(str(record))+').write_text(json.dumps(sys.argv[1:]))\nprint(json.dumps({"status":"fixture"}))\n')
            executable.chmod(0o700)
            transport=remote.Remote(self.binding(),identity,root/'known_hosts',ssh=str(executable))
            self.assertEqual(transport.invoke('inspect').kind,'json')
            args=json.loads(record.read_text());self.assertEqual(args[:3],['-F','/dev/null','-T'])
            self.assertIn('StrictHostKeyChecking=yes',args);self.assertIn('IdentitiesOnly=yes',args)
            self.assertIn('GlobalKnownHostsFile=/dev/null',args);self.assertIn('ForwardAgent=no',args)
            self.assertEqual((root/'known_hosts').stat().st_mode&0o077,0)
            self.assertEqual(transport.invoke('stop').kind,'empty_success')
            # Acquisition first, then the collector (its drain ships their final records).
            self.assertEqual(json.loads(record.read_text())[-1],'sudo -n /usr/bin/systemctl stop '+' '.join(
                'server2-shadow-test1-'+s+'.service' for s in ('reader','candidate','guard'))
                +' && sudo -n /usr/bin/systemctl stop server2-shadow-test1-logs.service')
            with self.assertRaises(E):transport.invoke('arbitrary shell')
            (root/'known_hosts').write_text('changed')
            with self.assertRaises(E):remote.Remote(self.binding(),identity,root/'known_hosts',ssh=str(executable))

    def test_actual_receiver_rejects_archive_traversal_and_retains_partial_stage(self):
        import io
        for member_name,link in [('../outside',False),('config.env',True)]:
            with self.subTest(member=member_name,link=link),tempfile.TemporaryDirectory() as temp:
                parent=Path(temp)/'stage'
                # Exercise the exact receiver in a private filesystem under our
                # actual UID; this is not the Linux/root installation check.
                script=remote.RECEIVER.replace("Path('/opt/server2-shadow-stage')",'Path('+repr(str(parent))+')')
                script=script.replace('st.st_uid==0','st.st_uid==os.geteuid()')
                archive=io.BytesIO()
                with remote.tarfile.open(fileobj=archive,mode='w') as tar:
                    item=remote.tarfile.TarInfo(member_name)
                    if link:item.type=remote.tarfile.SYMTYPE;item.linkname='../outside'
                    tar.addfile(item)
                result=subprocess.run([sys.executable,'-c',script,'test1'],input=archive.getvalue(),capture_output=True,timeout=5)
                self.assertNotEqual(result.returncode,0)
                self.assertTrue((parent/'test1').is_dir())
                self.assertFalse((parent/'outside').exists())
                again=subprocess.run([sys.executable,'-c',script,'test1'],input=archive.getvalue(),capture_output=True,timeout=5)
                self.assertNotEqual(again.returncode,0)
                self.assertIn(b'FileExistsError',again.stderr)

    def test_actual_receiver_child_import_preserves_private_bundle(self):
        import io
        with tempfile.TemporaryDirectory() as temp:
            parent=Path(temp)/'stage'
            script=remote.RECEIVER.replace("Path('/opt/server2-shadow-stage')",'Path('+repr(str(parent))+')')
            script=script.replace('st.st_uid==0','st.st_uid==os.geteuid()')
            script=script.replace("'/usr/bin/python3'",repr(sys.executable))
            files={name:b'fixture' for name in operator.HOST_ARTIFACTS|{'launch.json'}}
            files['state.py']=SOURCE.read_bytes()
            files['coordinator.py']=b"import state,sys\nassert sys.argv[1]=='install-host'\nprint('child imported state')\n"
            archive=io.BytesIO()
            with remote.tarfile.open(fileobj=archive,mode='w') as tar:
                for name,data in files.items():
                    item=remote.tarfile.TarInfo(name);item.size=len(data)
                    tar.addfile(item,io.BytesIO(data))
            env={k:v for k,v in os.environ.items() if not k.startswith('PYTHON')}
            result=subprocess.run([sys.executable,'-c',script,'test1'],input=archive.getvalue(),
                                  capture_output=True,env=env,umask=0o022,timeout=5)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertIn(b'child imported state',result.stdout)
            stage=parent/'test1'
            self.assertEqual({p.name for p in stage.iterdir()},set(files))
            self.assertTrue(all(p.stat().st_mode&0o077==0 for p in stage.iterdir()))

    def test_stop_download_ledger_body_binding_and_no_duplicate_export(self):
        import shutil
        for missing,drift in ((False,None),(True,None),(False,'header'),(False,'elapsed'),
                              (False,'array'),(False,'null'),(False,'scalar'),(False,'string')):
            with self.subTest(missing_body=missing,drift=drift),tempfile.TemporaryDirectory() as temp:
                root=Path(temp);host=root/'host';(host/'state').mkdir(parents=True);(host/'data/paired').mkdir(parents=True)
                launch=dict(plan=dict(port=3000,artifacts={'server2':'a'*64,'paired_read.py':'b'*64}))
                reader={'candidate_sha256':'a'*64}
                (host/'launch.json').write_text(state.canonical(launch)+'\n');(host/'reader.json').write_text(json.dumps(reader))
                expected=operator.artifact_hash(host/'launch.json')
                receipt=dict(status='started',launch_sha256=expected,unit_states=dict(candidate='inactive',reader='inactive',guard='inactive',logs='inactive'))
                for name in ('install','guard','decision'):(host/'state'/f'{name}.json').write_text(json.dumps(receipt))
                body=b'original response bytes\x00\xff';result=dict(status=200,body_bytes=len(body),body_sha256=operator.hashlib.sha256(body).hexdigest())
                paired=host/'data/paired';(paired/'1.json').write_text(json.dumps(result))
                if not missing:(paired/'1.body').write_bytes(body)
                db=remote.sqlite3.connect(paired/'ledger.sqlite3')
                db.execute('CREATE TABLE meta(key TEXT,value TEXT)');db.execute('CREATE TABLE attempts(id INTEGER,result TEXT)')
                identity=dict(manifest=reader,candidate='http://127.0.0.1:3000',production='https://todayweather.wizardfactory.net',loopback_test=False,sampler_sha256='b'*64)
                db.execute('INSERT INTO meta VALUES (?,?)',('identity',json.dumps(identity)))
                recorded=dict(result,elapsed_ms=123)
                if drift=='header':recorded['headers']={'content-type':'changed'}
                if drift=='elapsed':recorded['elapsed_ms']=True
                if drift=='array':recorded=[]
                if drift=='null':recorded=None
                if drift=='scalar':recorded=1
                if drift=='string':recorded='invalid'
                db.execute('INSERT INTO attempts VALUES (?,?)',(1,json.dumps(recorded)));db.commit();db.close()
                archive=root/'fixture.tar'
                with remote.tarfile.open(archive,'w') as tar:
                    for path in host.rglob('*'):
                        if path.is_file():tar.add(path,arcname=str(path.relative_to(host)))
                with J(root/'journal',create=True,run_id='test1',manifest_sha=DIGEST,epoch=1000) as j:
                    b=self.binding();j.prepare_request('ssh-target','BindSshTarget',b,b['instance'],now=1001)
                    j.prepare_request('host-install','HostInstall',{'launch_sha256':expected},'host-install',now=1001)
                    class Transport:
                        binding=b
                        calls=[]
                        def invoke(inner,action,**kwargs):
                            inner.calls.append(action)
                            if action=='stop':return state.CloudResult('empty_success','HostObserve')
                            if action=='inspect':return cloud_json('HostObserve',receipt)
                            self.assertIsNotNone(j.request('host-evidence'))
                            shutil.copyfile(archive,kwargs['destination'])
                            return cloud_json('HostEvidence',{'archive_bytes':archive.stat().st_size})
                    transport=Transport();report=remote.retain_host_evidence(transport,j,root/'retained')
                    self.assertEqual(report['complete'],not missing and drift is None)
                    self.assertEqual(report['qualification'],'not_assessed')
                    self.assertEqual(transport.calls,['stop','inspect','export'])
                    if not missing:self.assertEqual((root/'retained/files/data/paired/1.body').read_bytes(),body)
                    again=remote.retain_host_evidence(transport,j,root/'again')
                    self.assertFalse(again['complete']);self.assertEqual(transport.calls.count('export'),1)
                    self.assertIsNotNone(j.snapshot()['stop'])


def provisioning_plan():
    return dict(schema=1,run_id='test1',account='123456789012',region='ap-northeast-2',
                image='ami-12345678',vpc='vpc-12345678',subnet='subnet-12345678',
                key_name='existing-key',operator_cidr='8.8.8.8/32',root_device='/dev/xvda')


class RunCliTests(unittest.TestCase):
    def test_prepare_inspect_and_conflicting_resume_are_offline(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source,host=HostBundleTests.files(self,root)
            import time
            now=int(time.time())
            host['cost_policy']['observed_at']=now;host['paid_policy']['observed_at']=now
            plan=dict(host=host,cloud=provisioning_plan(),allowance=dict(reads=10,writes=20,put_bytes=30))
            plan_path=root/'plan.json';plan_path.write_text(json.dumps(plan))
            cli=[sys.executable,str(SOURCE.with_name('provision.py'))]
            args=['--state',str(root/'run'),'--bundle',str(root/'bundle')]
            result=subprocess.run(cli+['prepare']+args+['--plan',str(plan_path),'--source',str(source)],capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            self.assertTrue(result.stdout.strip(),'prepare did not return a journal receipt')
            first=json.loads(result.stdout);self.assertFalse(first['cloud_called'])
            self.assertEqual(first['state']['generations'],1)
            inspected=subprocess.run(cli+['inspect']+args,capture_output=True,text=True,timeout=5)
            self.assertEqual(inspected.returncode,0,inspected.stdout+inspected.stderr)
            self.assertEqual(json.loads(inspected.stdout)['state']['epoch'],first['state']['epoch'])
            again=subprocess.run(cli+['prepare']+args+['--plan',str(plan_path),'--source',str(source)],capture_output=True,text=True,timeout=5)
            self.assertEqual(again.returncode,2)
            (root/'bundle/config.env').write_bytes(b'changed')
            rejected=subprocess.run(cli+['inspect']+args,capture_output=True,text=True,timeout=5)
            self.assertEqual(rejected.returncode,2)
            with J(root/'run') as journal:self.assertEqual(journal.snapshot()['generations'],1)


class ProvisionCloud:
    """Stateful AWS fixture; no network. Models effects independently of receipts."""
    def __init__(self,journal,failure=None):
        self.journal=journal;self.failure=failure;self.calls=[];self.buckets={}
        self.role=None;self.profile=None;self.group=None;self.instance=None;self.volume=None
        self.hidden_instance=False;self.profile_ready=True;self.denied_inventory=False
    def call(self,op,p,**kwargs):
        import copy
        self.calls.append((op,copy.deepcopy(p)))
        if self.failure==(op,'before'):
            self.failure=None;return state.CloudResult('service_error',op,code='AccessDenied')
        after=self.failure==(op,'after')
        if after:self.failure=None
        if op in ('CreateBucket','CreateRole','CreateInstanceProfile','CreateSecurityGroup','RunInstances'):
            requests=self.journal.db.execute('SELECT params FROM requests JOIN intents USING(id) WHERE operation=?',(op,)).fetchall()
            assert any(json.loads(r[0])==p for r in requests),'effect without durable exact intent'
        prefix='server2-shadow-test1'
        def ok(payload=None):return cloud_json(op,payload or {})
        def missing():return state.CloudResult('service_error',op,code='NoSuchEntity')
        if op=='GetCallerIdentity':result=ok({'Account':'123456789012'})
        elif op=='DescribeSubnets':result=ok({'Subnets':[{'SubnetId':p['SubnetIds'][0],'VpcId':'vpc-12345678','State':'available'}]})
        elif op=='DescribeImages':result=ok({'Images':[{'ImageId':p['ImageIds'][0],'Architecture':'x86_64','State':'available','RootDeviceType':'ebs','RootDeviceName':'/dev/xvda'}]})
        elif op=='DescribeKeyPairs':result=ok({'KeyPairs':[{'KeyName':p['KeyNames'][0]}]})
        elif op=='GetRole':result=ok({'Role':self.role}) if self.role else missing()
        elif op=='GetInstanceProfile':
            obj=copy.deepcopy(self.profile)
            if obj and not self.profile_ready:obj['Roles']=[]
            result=ok({'InstanceProfile':obj}) if obj else missing()
        elif op=='DescribeSecurityGroups':result=ok({'SecurityGroups':[self.group] if self.group else []})
        elif op=='ListBuckets':
            result=state.CloudResult('service_error',op,code='AccessDenied') if self.denied_inventory else ok({'Buckets':[{'Name':b} for b in self.buckets]})
        elif op=='CreateBucket':
            if p['Bucket'] in self.buckets:return state.CloudResult('service_error',op,code='BucketAlreadyOwnedByYou')
            self.buckets[p['Bucket']]={};result=ok({'Location':'/'+p['Bucket']})
        elif op=='PutPublicAccessBlock':self.buckets[p['Bucket']]['public']=p['PublicAccessBlockConfiguration'];result=state.CloudResult('empty_success',op)
        elif op=='PutBucketVersioning':self.buckets[p['Bucket']]['version']=p['VersioningConfiguration'];result=state.CloudResult('empty_success',op)
        elif op=='PutBucketTagging':self.buckets[p['Bucket']]['tags']=p['Tagging']['TagSet'];result=state.CloudResult('empty_success',op)
        elif op=='GetBucketVersioning':result=ok(self.buckets[p['Bucket']]['version'])
        elif op=='GetBucketTagging':result=ok({'TagSet':self.buckets[p['Bucket']]['tags']})
        elif op=='CreateRole':
            self.role={'RoleName':p['RoleName'],'Tags':p['Tags'],'Arn':'arn:aws:iam::123456789012:role/'+prefix};result=ok({'Role':self.role})
        elif op=='PutRolePolicy':result=state.CloudResult('empty_success',op)
        elif op=='CreateInstanceProfile':
            self.profile={'InstanceProfileName':p['InstanceProfileName'],'Tags':p['Tags'],'Arn':'arn:aws:iam::123456789012:instance-profile/'+prefix,'Roles':[]};result=ok({'InstanceProfile':copy.deepcopy(self.profile)})
        elif op=='AddRoleToInstanceProfile':self.profile['Roles']=[{'RoleName':p['RoleName']}];result=state.CloudResult('empty_success',op)
        elif op=='CreateSecurityGroup':
            self.group={'GroupId':'sg-1234567890abcdef0','GroupName':p['GroupName'],'Tags':p['TagSpecifications'][0]['Tags']};result=ok({'GroupId':self.group['GroupId']})
        elif op=='AuthorizeSecurityGroupIngress':result=ok({'Return':True})
        elif op=='RunInstances':
            assert self.instance is None,'replacement instance attempted'
            self.instance={'InstanceId':'i-1234567890abcdef0','ClientToken':p['ClientToken'],'ImageId':p['ImageId'],
                'SubnetId':p['NetworkInterfaces'][0]['SubnetId'],'InstanceType':p['InstanceType'],
                'Tags':p['TagSpecifications'][0]['Tags'],'SecurityGroups':[{'GroupId':self.group['GroupId'],'GroupName':prefix}],
                'BlockDeviceMappings':[{'Ebs':{'VolumeId':'vol-1234567890abcdef0','DeleteOnTermination':True}}],
                'State':{'Name':'running','Code':16}}
            self.volume={'VolumeId':'vol-1234567890abcdef0','Size':32,'VolumeType':'gp3','Encrypted':True,'Tags':p['TagSpecifications'][1]['Tags']}
            result=ok({'Instances':[copy.deepcopy(self.instance)]})
        elif op=='DescribeInstances':result=ok({'Reservations':[{'Instances':[self.instance]}] if self.instance and not self.hidden_instance else []})
        elif op=='DescribeVolumes':result=ok({'Volumes':[self.volume] if self.volume else []})
        elif op=='TerminateInstances':self.instance['State']={'Name':'terminated','Code':48};self.volume=None;result=ok({'TerminatingInstances':[]})
        elif op=='ListObjectVersions':result=ok({'IsTruncated':False,'Versions':[],'DeleteMarkers':[]})
        elif op=='DeleteBucket':self.buckets.pop(p['Bucket'],None);result=state.CloudResult('empty_success',op)
        elif op=='RemoveRoleFromInstanceProfile':
            if self.profile:self.profile['Roles']=[]
            result=state.CloudResult('empty_success',op)
        elif op=='DeleteInstanceProfile':self.profile=None;result=state.CloudResult('empty_success',op)
        elif op=='DeleteRolePolicy':result=state.CloudResult('empty_success',op)
        elif op=='DeleteRole':self.role=None;result=state.CloudResult('empty_success',op)
        elif op=='DeleteSecurityGroup':self.group=None;result=state.CloudResult('empty_success',op)
        else:raise AssertionError('unexpected operation '+op)
        return state.CloudResult('timeout',op) if after else result


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        # Existing ownership/cleanup scenarios isolate their behavior from the
        # settling delay. ProfileDelayTests exercises the production delay.
        from unittest.mock import patch
        delay=patch.object(provision,'IAM_PROPAGATION_SECONDS',0)
        delay.start();self.addCleanup(delay.stop)

    def collecting(self,root,behaviour):
        """Start a prepared run whose inspections follow behaviour(poll_number, clock)."""
        source,host=HostBundleTests.files(self,root)
        plan=dict(host=host,cloud=provisioning_plan(),allowance=dict(reads=10,writes=20,put_bytes=30))
        provision.prepare_run(plan,source,root/'run',root/'bundle',now=1000)
        j=J(root/'run');self.addCleanup(j.close);j.__enter__()
        cloud=ProvisionCloud(j);moment=[1001];calls=[];events=[]
        launch=operator.verify_bundle(root/'bundle')
        expected=operator.hashlib.sha256((state.canonical(launch)+'\n').encode()).hexdigest()
        binding=RemoteTests.binding(self)
        class Transport:
            polls=0;stopped=False
            def __init__(inner):inner.binding=binding
            def invoke(inner,action,**kwargs):
                calls.append((action,moment[0]))
                if action=='inspect':fault('poll')
                if action=='install':fault('install')
                if action=='install':return state.CloudResult('empty_success','HostInstall')
                if action=='stop':inner.stopped=True;return state.CloudResult('empty_success','HostObserve')
                if action=='export':return state.CloudResult('timeout','HostEvidence')
                inner.polls+=1
                # After the operator's stop the host reports every unit inactive.
                answer='inactive' if inner.stopped else behaviour(inner.polls,moment[0])
                if answer=='raise':raise OSError('network unreachable')
                if answer=='timeout':return state.CloudResult('timeout','HostObserve')
                if isinstance(answer,str):units={s:answer for s in ('candidate','reader','guard')};units['logs']='inactive' if inner.stopped else 'active'
                else:units=answer
                return cloud_json('HostObserve',dict(status='started',launch_sha256=expected,epoch=1000,
                    collection_until=1000+168*3600,cleanup_until=1000+170*3600,unit_states=units))
        transport=Transport();failures=[];faults={}
        def fault(point):
            # faults[point]=(n, error): raise error at the n-th call of that site from now on.
            if point in faults:
                n,error=faults[point];faults[point]=(n-1,error)
                if n<=1:del faults[point];raise error
        def connect(c,journal,r,*,now):
            fault('connect')
            if failures:raise failures.pop(0)
            if journal.request('ssh-target') is None:
                journal.prepare_request('ssh-target','BindSshTarget',binding,binding['instance'],now=now)
                journal.record_receipt('ssh-target',cloud_json('BindSshTarget',{'bound':True}))
            return provision.BudgetedRemote(transport,journal)
        def pause(seconds):fault('sleep');moment[0]+=seconds
        def report(event):fault('progress');events.append(event)
        class Observed:
            # The real journal; observe() can be faulted like the other call sites.
            def __getattr__(inner,name):return getattr(j,name)
            def observe(inner,now):fault('observe');return j.observe(now)
        run=lambda:provision.lifecycle(cloud,Observed(),plan['cloud'],root/'bundle',root/'result',connect,
                                       clock=lambda:moment[0],sleep=pause,progress=report)
        run.connect_failures=failures  # errors raised by the next connector calls, in order
        run.faults=faults
        return run,cloud,calls,events,moment,j

    def test_failed_polls_never_end_collection(self):
        # SR-2: eight hours of unreachable polls (errors and timeouts), then recovery.
        with tempfile.TemporaryDirectory() as temp:
            def behaviour(poll,now):
                if 10<=poll<490:return 'raise' if poll%2 else 'timeout'
                return 'active'
            run,cloud,calls,events,moment,j=self.collecting(Path(temp),behaviour)
            result=run()
            self.assertEqual(result['stop_reason'],'collection_deadline')
            stops=[at for action,at in calls if action=='stop']
            self.assertTrue(stops and min(stops)>=1000+168*3600,stops[:1])
            self.assertEqual(sum(op=='RunInstances' for op,_ in cloud.calls),1)
            self.assertEqual(sum(action=='install' for action,_ in calls),1)
            self.assertGreater(sum(action=='inspect' for action,_ in calls),10000)
            unreachable=[e for e in events if e.get('poll')=='unreachable']
            self.assertEqual(max(e['consecutive'] for e in unreachable),480)
            self.assertTrue(any(e.get('poll')=='recovered' for e in events))

    def test_host_stop_is_reported_and_finished(self):
        with tempfile.TemporaryDirectory() as temp:
            run,cloud,calls,events,moment,j=self.collecting(Path(temp),lambda poll,now:'active' if poll<5 else 'inactive')
            result=run()
            self.assertEqual(result['stop_reason'],'host_stopped')
            self.assertEqual(cloud.instance['State']['Name'],'terminated')

    def test_operator_interrupt_detaches_without_teardown_and_resumes(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);pending={'interrupt':True}
            def behaviour(poll,now):
                if poll==5 and pending['interrupt']:
                    pending['interrupt']=False;raise KeyboardInterrupt
                return 'active'
            run,cloud,calls,events,moment,j=self.collecting(root,behaviour)
            result=run()
            self.assertEqual(result,{'schema':1,'detached':True,'stop_reason':'operator_detached'})
            self.assertEqual(cloud.instance['State']['Name'],'running')
            self.assertFalse((root/'result').exists())
            self.assertNotIn('stop',[action for action,_ in calls])
            self.assertFalse(any(op=='TerminateInstances' for op,_ in cloud.calls))
            resumed=run()
            self.assertEqual(resumed['stop_reason'],'collection_deadline')
            self.assertEqual(sum(action=='install' for action,_ in calls),1)
            self.assertEqual(sum(op=='RunInstances' for op,_ in cloud.calls),1)

    def interrupted_run(self,root,after_interrupt):
        """Collect, interrupt at poll 5, then serve later polls with after_interrupt(poll, clock)."""
        state_={'interrupted':False}
        def behaviour(poll,now):
            if not state_['interrupted']:
                if poll==5:
                    state_['interrupted']=True;raise KeyboardInterrupt
                return 'active'
            return after_interrupt(poll,now)
        run,cloud,calls,events,moment,j=self.collecting(root,behaviour)
        self.assertEqual(run()['stop_reason'],'operator_detached')
        self.assertIsNotNone(j.request('collection-started'))
        return run,cloud,calls,events,moment,j

    def test_resume_with_failing_polls_never_tears_down(self):
        # CX-SR2-001: a resumed run is in the collecting phase from its first poll.
        for failure in ('timeout','raise'):
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as temp:
                run,cloud,calls,events,moment,j=self.interrupted_run(Path(temp),lambda poll,now:failure)
                before=len(cloud.calls)
                result=run()
                self.assertEqual(result['stop_reason'],'collection_deadline')
                stops=[at for action,at in calls if action=='stop']
                self.assertTrue(stops and min(stops)>=1000+168*3600,stops[:1])
                self.assertEqual(sum(op=='RunInstances' for op,_ in cloud.calls),1)
                self.assertEqual(sum(action=='install' for action,_ in calls),1)
                resumed_ops=[op for op,_ in cloud.calls[before:]]
                self.assertNotIn('CreateBucket',resumed_ops);self.assertNotIn('DescribeSubnets',resumed_ops)

    def test_resume_survives_failing_reconnects(self):
        # CX-SR2-008: the first reconnect of a resumed run is a poll like any other.
        for error in (OSError('no route'),state.StateError('ssh target'),subprocess.TimeoutExpired('ssh',30)):
            with self.subTest(error=type(error).__name__),tempfile.TemporaryDirectory() as temp:
                run,cloud,calls,events,moment,j=self.interrupted_run(Path(temp),lambda poll,now:'active')
                run.connect_failures.extend([error]*3)
                result=run()
                self.assertEqual(result['stop_reason'],'collection_deadline')
                self.assertIsNone(result['failure_class'])
                terminations=[op for op,_ in cloud.calls if op=='TerminateInstances']
                stops=[at for action,at in calls if action=='stop']
                self.assertTrue(stops and min(stops)>=1000+168*3600,stops[:1])
                self.assertTrue(terminations)
                self.assertIn('export',[action for action,_ in calls])
                self.assertIn({'phase':'collecting','poll':'recovered','after':3},events)

    def test_every_interrupt_and_fault_follows_the_phase_table(self):
        # Circuit breaker after CX-SR2-011 (design-round3.md): per phase and call site, an
        # interrupt or error either detaches with the host untouched, retries as an
        # unreachable poll, or finishes with retention and cleanup.
        import contextlib
        until=1000+168*3600
        kinds=[KeyboardInterrupt(),OSError('io'),state.StateError('state'),subprocess.TimeoutExpired('ssh',30),RuntimeError('bug')]
        def untouched(cloud,calls):
            return (cloud.instance['State']['Name']=='running' and not any(a in ('stop','export') for a,_ in calls)
                    and not any(op=='TerminateInstances' for op,_ in cloud.calls))
        cases=[]
        # Collecting (resumed before the deadline): first call of each site after the resume.
        for point in ('connect','poll','sleep','progress','observe'):
            for error in kinds:
                interrupt=isinstance(error,KeyboardInterrupt)
                if point in ('connect','poll') and not interrupt:expect='retry'
                else:expect='detached' if interrupt else 'failed'
                cases.append(('collecting',point,error,expect))
        # Finishing (resumed after the deadline): every step before the finish itself, i.e.
        # the target check, the reconnect and the finishing progress record (CX-SR2-012).
        for point in ('target','connect','progress'):
            for error in kinds:cases.append(('finishing',point,error,'finish'))
        for phase,point,error,expect in cases:
            with self.subTest(phase=phase,point=point,error=type(error).__name__),tempfile.TemporaryDirectory() as temp:
                root=Path(temp)
                run,cloud,calls,events,moment,j=self.interrupted_run(root,lambda poll,now:'active')
                before=len(calls)
                if phase=='finishing':moment[0]=until+5
                from unittest.mock import patch
                def target(journal,error=error):raise error
                with patch.object(provision,'bound_target',target) if point=='target' else contextlib.nullcontext():
                    if point!='target':run.faults[point]=(1,error)
                    result=run()
                if expect=='detached':
                    self.assertEqual(result,{'schema':1,'detached':True,'stop_reason':'operator_detached'})
                    self.assertTrue(untouched(cloud,calls))
                elif expect=='failed':
                    self.assertEqual((result['detached'],result['stop_reason'],result['failure_class']),
                                     (True,'operator_failed',type(error).__name__))
                    self.assertTrue(untouched(cloud,calls))
                    self.assertFalse((root/'result').exists())
                else:
                    self.assertEqual(result['stop_reason'],'collection_deadline',result)
                    self.assertEqual(cloud.instance['State']['Name'],'terminated')
                    self.assertTrue((root/'result/lifecycle.json').is_file())
                    # Nothing reaches the host before the deadline; without a reconnect the
                    # finish cannot stop it over SSH and only terminates the instance.
                    stops=[at for action,at in calls[before:] if action=='stop']
                    self.assertTrue(all(at>=until for at in stops),stops[:1])
                    if expect=='retry':
                        self.assertTrue(stops)
                        self.assertIn('export',[a for a,_ in calls[before:]])
        # Startup (before the marker): unchanged, every event finishes with cleanup.
        for point in ('connect','install'):
            for error in kinds:
                with self.subTest(phase='startup',point=point,error=type(error).__name__),tempfile.TemporaryDirectory() as temp:
                    run,cloud,calls,events,moment,j=self.collecting(Path(temp),lambda poll,now:'active')
                    run.faults[point]=(1,error)
                    if isinstance(error,RuntimeError):
                        with self.assertRaises(RuntimeError):run()
                    else:
                        expected='operator_interrupted' if isinstance(error,KeyboardInterrupt) else 'acquisition_failed'
                        self.assertEqual(run()['stop_reason'],expected)
                    self.assertEqual(cloud.instance['State']['Name'],'terminated')
                    self.assertIsNone(j.request('collection-started'))
        # Marker boundary (CX-SR2-013): a failure right after collection-started is stored
        # is a collecting event, read from the journal when it happens.
        from unittest.mock import patch
        real=provision.mark_collection_started
        for error in kinds:
            with self.subTest(phase='marker',error=type(error).__name__),tempfile.TemporaryDirectory() as temp:
                run,cloud,calls,events,moment,j=self.collecting(Path(temp),lambda poll,now:'active')
                def marked(journal,*,now,error=error):
                    real(journal,now=now);raise error
                with patch.object(provision,'mark_collection_started',marked):result=run()
                self.assertIsNotNone(j.request('collection-started'))
                self.assertTrue(result['detached'],result)
                self.assertEqual(result['stop_reason'],'operator_detached' if isinstance(error,KeyboardInterrupt) else 'operator_failed')
                self.assertTrue(untouched(cloud,calls))
        # Marker-less resume after the deadline (CX-SR2-013): the install ran but the process
        # died before storing the marker; the finish reconnects and retains host evidence.
        class Crash(BaseException):pass
        def crash(*args,**kwargs):raise Crash()
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            run,cloud,calls,events,moment,j=self.collecting(root,lambda poll,now:'active')
            with patch.object(provision,'mark_collection_started',crash),patch.object(provision,'finish_run',crash):
                with self.assertRaises(Crash):run()
            self.assertIsNone(j.request('collection-started'))
            self.assertEqual(cloud.instance['State']['Name'],'running')
            moment[0]=until+5;before=len(calls)
            result=run()
            self.assertEqual(result['stop_reason'],'collection_deadline',result)
            self.assertIn('export',[a for a,_ in calls[before:]])
            self.assertEqual(cloud.instance['State']['Name'],'terminated')
        # The CLI reports a detach as success and an operator failure as an error.
        from unittest.mock import patch
        import io,contextlib
        for outcome,code in (({'schema':1,'detached':True,'stop_reason':'operator_detached'},0),
                             ({'schema':1,'detached':True,'stop_reason':'operator_failed','failure_class':'OSError'},1)):
            with patch.object(provision,'live_command',lambda args,o=outcome:o),\
                 patch.object(sys,'argv',['provision.py','run','--execute','--state','s','--bundle','b','--identity','/k','--output','o']),\
                 contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(provision.main(),code)

    def test_resume_after_the_deadline_with_a_failing_reconnect_still_finishes(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            run,cloud,calls,events,moment,j=self.interrupted_run(root,lambda poll,now:'active')
            moment[0]=1000+168*3600+5;run.connect_failures.append(OSError('no route'))
            result=run()
            self.assertEqual(result['stop_reason'],'collection_deadline')
            self.assertIsNone(result['failure_class'])
            self.assertTrue((root/'result/lifecycle.json').is_file())
            self.assertEqual(cloud.instance['State']['Name'],'terminated')

    def test_only_a_validated_stop_ends_collection(self):
        # CX-SR2-002: unvalidated unit states are unreachable, not a stop.
        for units,expected in ((None,'collection_deadline'),({'candidate':'active'},'collection_deadline'),
                               ({'candidate':'deactivating','reader':'active','guard':'active'},'collection_deadline'),
                               ({'candidate':'active','reader':'inactive','guard':'active'},'host_stopped'),
                               ({'candidate':'failed','reader':'inactive','guard':'inactive'},'host_stopped')):
            with self.subTest(units=units),tempfile.TemporaryDirectory() as temp:
                odd=lambda poll,now:units if poll>=5 and poll<10 else 'active'
                run,cloud,calls,events,moment,j=self.collecting(Path(temp),odd)
                self.assertEqual(run()['stop_reason'],expected)

    def test_resume_after_the_deadline_finishes_with_evidence_and_cleanup(self):
        # CX-SR2-003: no polling, straight to retention and cleanup.
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            run,cloud,calls,events,moment,j=self.interrupted_run(root,lambda poll,now:'active')
            moment[0]=1000+168*3600+5
            polls=sum(action=='inspect' for action,_ in calls)
            result=run()
            self.assertEqual(result['stop_reason'],'collection_deadline')
            self.assertTrue((root/'result/lifecycle.json').is_file())
            self.assertIn('export',[action for action,_ in calls])
            self.assertEqual(cloud.instance['State']['Name'],'terminated')
            self.assertEqual(sum(action=='inspect' for action,_ in calls)-polls,1)  # the stopped-state check only

    def test_live_run_after_the_deadline_reaches_the_lifecycle(self):
        # CX-SR2-003: live_command observes the journal instead of requiring it active.
        from unittest.mock import patch
        import argparse,time as _time
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source,host=HostBundleTests.files(self,root)
            plan=dict(host=host,cloud=provisioning_plan(),allowance=dict(reads=10,writes=20,put_bytes=30))
            provision.prepare_run(plan,source,root/'run',root/'bundle',now=1000)
            identity=root/'key';identity.write_text('fixture');identity.chmod(0o600)
            args=argparse.Namespace(command='run',execute=True,state=root/'run',bundle=root/'bundle',identity=identity,
                                    output=root/'out',aws_executable='/usr/bin/false',profile=None)
            seen=[]
            # The AWS client is out of scope here: only the journal check before the lifecycle.
            with patch.object(provision,'lifecycle',lambda *a,**k:seen.append(1) or {'stop_reason':'collection_deadline'}),\
                 patch.object(sys.modules['coordinator'],'Aws',lambda *a,**k:object()),\
                 patch.object(provision.time,'time',return_value=1000+168*3600+60):
                provision.live_command(args)
            self.assertEqual(seen,[1])

    def test_cli_reports_a_detach_as_success(self):
        # CX-SR2-006.
        from unittest.mock import patch
        import io,contextlib
        detached={'schema':1,'detached':True,'stop_reason':'operator_detached'}
        out=io.StringIO()
        with patch.object(provision,'live_command',lambda args:detached),\
             patch.object(sys,'argv',['provision.py','run','--execute','--state','s','--bundle','b','--identity','/k','--output','o']),\
             contextlib.redirect_stdout(out):
            code=provision.main()
        self.assertEqual(code,0)
        self.assertEqual(json.loads(out.getvalue().splitlines()[-1]),detached)

    def test_resume_reuses_the_journaled_ssh_target(self):
        # Days later the console may no longer show the host-key fingerprints.
        with tempfile.TemporaryDirectory() as temp:
            with J(Path(temp)/'state',create=True,run_id='test1',manifest_sha=DIGEST,epoch=1000) as j:
                binding=RemoteTests.binding(self)
                j.prepare_request('ssh-target','BindSshTarget',binding,binding['instance'],now=1001)
                j.record_receipt('ssh-target',cloud_json('BindSshTarget',{'bound':True}))
                identity=Path(temp)/'key';identity.write_text('fixture');identity.chmod(0o600)
                bound=provision.connect_remote(FixtureCloud([]),j,owned_resources(),identity,now=1002)
                self.assertEqual(bound.binding,binding)

    def test_one_host_install_monitor_and_cleanup_across_failure_paths(self):
        for mode in ('deadline','lost_install_ack','ssh_timeout','guard_stop','termination_delay'):
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as temp:
                root=Path(temp);source,host=HostBundleTests.files(self,root)
                plan=dict(host=host,cloud=provisioning_plan(),allowance=dict(reads=10,writes=20,put_bytes=30))
                provision.prepare_run(plan,source,root/'run',root/'bundle',now=1000)
                with J(root/'run') as j:
                    class Cloud(ProvisionCloud):
                        terminations=0
                        def call(inner,op,params,**kwargs):
                            if op=='TerminateInstances':
                                inner.terminations+=1
                                if mode=='termination_delay' and inner.terminations==1:
                                    inner.calls.append((op,params))
                                    inner.instance['State']={'Name':'shutting-down','Code':32}
                                    return cloud_json(op,{'TerminatingInstances':[]})
                            return super().call(op,params,**kwargs)
                    cloud=Cloud(j);moment=[1001];events=[];calls=[]
                    launch=operator.verify_bundle(root/'bundle')
                    expected=operator.hashlib.sha256((state.canonical(launch)+'\n').encode()).hexdigest()
                    binding=RemoteTests.binding(self)
                    class Transport:
                        uploads=0;inspections=0;active=True
                        def __init__(inner):inner.binding=binding
                        def invoke(inner,action,**kwargs):
                            calls.append(action)
                            if action=='install':
                                inner.uploads+=1
                                self.assertIsNotNone(j.request('host-install'))
                                with remote.tarfile.open(fileobj=kwargs['archive'],mode='r') as archive:
                                    self.assertEqual(set(archive.getnames()),operator.HOST_ARTIFACTS|{'launch.json'})
                                return state.CloudResult('timeout' if mode=='lost_install_ack' else 'empty_success','HostInstall')
                            if action=='stop':inner.active=False;return state.CloudResult('empty_success','HostObserve')
                            if action=='export':return state.CloudResult('timeout','HostEvidence')
                            inner.inspections+=1
                            if mode=='lost_install_ack' and inner.inspections==1:
                                return state.CloudResult('timeout','HostObserve')
                            if mode=='guard_stop' and inner.inspections>=2:inner.active=False
                            return cloud_json('HostObserve',dict(status='started',launch_sha256=expected,epoch=1000,
                                collection_until=1000+168*3600,cleanup_until=1000+170*3600,
                                unit_states={s:'active' if inner.active else 'inactive' for s in ('candidate','reader','guard')}))
                    transport=Transport()
                    def connect(c,journal,r,*,now):
                        if mode=='ssh_timeout':return None
                        journal.prepare_request('ssh-target','BindSshTarget',binding,binding['instance'],now=now)
                        journal.record_receipt('ssh-target',cloud_json('BindSshTarget',{'bound':True}))
                        return provision.BudgetedRemote(transport,journal)
                    def pause(seconds):
                        if seconds==60:moment[0]=j.snapshot()['collection_until']
                        else:moment[0]+=seconds
                    result=provision.lifecycle(cloud,j,plan['cloud'],root/'bundle',root/'result',connect,
                        clock=lambda:moment[0],sleep=pause,progress=events.append)
                    self.assertTrue(result['cleanup']['complete'],result)
                    self.assertFalse(result['host_evidence']['complete'])
                    self.assertEqual(result['qualification'],'not_assessed')
                    self.assertEqual(sum(op=='RunInstances' for op,_ in cloud.calls),1)
                    self.assertEqual(transport.uploads,0 if mode=='ssh_timeout' else 1)
                    self.assertEqual(j.snapshot()['generations'],1)
                    self.assertFalse(cloud.buckets)
                    self.assertEqual(cloud.instance['State']['Name'],'terminated')
                    self.assertEqual(result['stop_reason'],{'ssh_timeout':'acquisition_failed','guard_stop':'host_stopped'}.get(mode,'collection_deadline'))
                    self.assertEqual(events[-1]['phase'],'finishing')
                    self.assertTrue((root/'result/lifecycle.json').is_file())
                    if mode=='termination_delay':
                        self.assertTrue((root/'result/sources/manifest.json').is_file())
                        self.assertTrue(result['cleanup']['sources_complete'])

    def test_public_live_commands_require_explicit_execute_without_any_effect(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            for command in ('run','finish'):
                result=subprocess.run([sys.executable,str(SOURCE.with_name('provision.py')),command,
                    '--state',str(root/'not-created'),'--output',str(root/'not-created-output')],
                    capture_output=True,text=True,timeout=5)
                self.assertEqual(result.returncode,2,result.stdout+result.stderr)
            self.assertEqual(list(root.iterdir()),[])


class ProfileDelayTests(unittest.TestCase):
    def test_profile_never_visible_times_out_and_cleans_without_launch(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source,host=HostBundleTests.files(self,root)
            plan=dict(host=host,cloud=provisioning_plan(),allowance=dict(reads=10,writes=20,put_bytes=30))
            provision.prepare_run(plan,source,root/'run',root/'bundle',now=1000)
            with J(root/'run') as j:
                cloud=ProvisionCloud(j);cloud.profile_ready=False;moment=[1001]
                def pause(seconds):moment[0]+=seconds
                result=provision.lifecycle(cloud,j,plan['cloud'],root/'bundle',root/'result',
                    lambda *a,**k: self.fail('SSH before launch'),clock=lambda:moment[0],sleep=pause)
                self.assertEqual(moment[0],1601)
                self.assertEqual(result['stop_reason'],'acquisition_failed')
                self.assertTrue(result['cleanup']['complete'])
                self.assertFalse(any(op=='RunInstances' for op,_ in cloud.calls))
                self.assertEqual(j.snapshot()['epoch'],1000)

    def test_attached_profile_wait_survives_reopen_and_does_not_relaunch(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'journal'
            with J(path,create=True,run_id='test1',manifest_sha=DIGEST,epoch=1000) as j:
                cloud=ProvisionCloud(j)
                first=provision.provision_resources(cloud,j,provisioning_plan(),now=1001)
                self.assertEqual(first['status'],'pending')
                self.assertFalse(any(op=='RunInstances' for op,_ in cloud.calls))
            with J(path) as j:
                cloud.journal=j
                early=provision.provision_resources(cloud,j,provisioning_plan(),now=1300)
                self.assertEqual(early['status'],'pending')
                self.assertFalse(any(op=='RunInstances' for op,_ in cloud.calls))
                self.assertEqual(provision.provision_resources(cloud,j,provisioning_plan(),now=1301)['status'],'bound')
                self.assertEqual(provision.provision_resources(cloud,j,provisioning_plan(),now=1302)['status'],'bound')
                self.assertEqual(sum(op=='RunInstances' for op,_ in cloud.calls),1)
                self.assertEqual(sum(op=='CreateRole' for op,_ in cloud.calls),1)
                self.assertEqual(j.snapshot()['epoch'],1000)


class ProvisionTests(unittest.TestCase):
    def setUp(self):
        # Existing ownership/cleanup scenarios isolate their behavior from the
        # settling delay. ProfileDelayTests exercises the production delay.
        from unittest.mock import patch
        delay=patch.object(provision,'IAM_PROPAGATION_SECONDS',0)
        delay.start();self.addCleanup(delay.stop)

    def journal(self,root):return J(root,create=True,run_id='test1',manifest_sha=DIGEST,epoch=1000)
    def test_finish_still_cleans_when_host_evidence_cannot_be_retrieved(self):
        with tempfile.TemporaryDirectory() as temp,self.journal(Path(temp)/'journal') as j:
            cloud=ProvisionCloud(j)
            provision.provision_resources(cloud,j,provisioning_plan(),now=1001)
            class Unavailable:
                binding={}
                def invoke(self,*args,**kwargs):raise OSError('offline SSH fixture')
            report=provision.finish_run(cloud,Unavailable(),j,Path(temp)/'finish',now=1002)
            self.assertFalse(report['host_evidence']['complete'])
            self.assertTrue(report['cleanup']['complete'])
            self.assertEqual(report['qualification'],'not_assessed')
            self.assertFalse(cloud.buckets)

    def test_cleanup_resume_uses_proven_ids_after_named_resources_are_gone(self):
        with tempfile.TemporaryDirectory() as temp,self.journal(Path(temp)/'journal') as j:
            cloud=ProvisionCloud(j)
            provision.provision_resources(cloud,j,provisioning_plan(),now=1001)
            self.assertTrue(provision.cleanup_partial(cloud,j,now=1002)['complete'])
            cloud.instance['BlockDeviceMappings']=[]
            self.assertTrue(provision.cleanup_partial(cloud,j,now=1003)['complete'])
            self.assertEqual(sum(op=='RunInstances' for op,_ in cloud.calls),1)

    def test_exhausted_export_preserves_full_cleanup_and_independent_inventory(self):
        with tempfile.TemporaryDirectory() as temp,self.journal(Path(temp)/'journal') as j:
            fixture=ProvisionCloud(j)
            provision.provision_resources(fixture,j,provisioning_plan(),now=1001)
            j.reserve_control(reads=9000,writes=9000,export_bytes=2*1024**3)
            class Charged:
                def call(inner,op,p,**kwargs):
                    cleanup=kwargs.pop('cleanup',False)
                    kind=operator.OPERATIONS[op][2]
                    j.reserve_control(cleanup=cleanup,**({'reads':1} if kind=='read' else {'writes':1}))
                    return fixture.call(op,p,**kwargs)
            result=provision.cleanup_partial(Charged(),j,now=1000+170*3600,
                                            source_destination=Path(temp)/'sources')
            self.assertTrue(result['complete'])
            self.assertFalse(result['sources_complete'])
            self.assertTrue(result['independent_inventory']['complete'])
            self.assertGreater(j.reserve_control()['writes'],9000)
            self.assertFalse(json.loads((Path(temp)/'sources/manifest.json').read_text())['complete'])
            for op in ('RunInstances','GetObject','HeadObject','CreateBucket'):
                with self.assertRaises(E):operator.CleanupCloud(Charged()).call(op,{})

    def test_single_instance_scope_and_resume_do_not_repeat_mutations(self):
        with tempfile.TemporaryDirectory() as temp,self.journal(Path(temp)/'journal') as j:
            cloud=ProvisionCloud(j);result=provision.provision_resources(cloud,j,provisioning_plan(),now=1001)
            self.assertEqual(result['status'],'bound');self.assertFalse(result['host_installed'])
            params=[p for op,p in cloud.calls if op=='RunInstances'][0]
            self.assertEqual((params['MinCount'],params['MaxCount']),(1,1))
            self.assertEqual(params['InstanceInitiatedShutdownBehavior'],'terminate')
            self.assertEqual(params['MetadataOptions']['HttpTokens'],'required')
            self.assertEqual(params['NetworkInterfaces'][0]['AssociatePublicIpAddress'],True)
            self.assertIn('UserData',params)
            policy=json.loads([p for op,p in cloud.calls if op=='PutRolePolicy'][0]['PolicyDocument'])
            self.assertTrue(all('server2-shadow-test1-' in resource for s in policy['Statement'] for resource in s['Resource']))
            self.assertEqual([p for op,p in cloud.calls if op=='AuthorizeSecurityGroupIngress'][0]['IpPermissions'][0]['IpRanges'],[{'CidrIp':'8.8.8.8/32'}])
            before=[op for op,_ in cloud.calls if op in ('CreateBucket','CreateRole','RunInstances')]
            self.assertEqual(provision.provision_resources(cloud,j,provisioning_plan(),now=1002)['status'],'bound')
            self.assertEqual([op for op,_ in cloud.calls if op in ('CreateBucket','CreateRole','RunInstances')],before)

    def test_launch_lost_before_ssh_already_carries_original_expiry(self):
        import base64
        with tempfile.TemporaryDirectory() as temp,self.journal(Path(temp)/'journal') as j:
            cloud=ProvisionCloud(j,failure=('RunInstances','after'));cloud.hidden_instance=True
            result=provision.provision_resources(cloud,j,provisioning_plan(),now=1001)
            self.assertEqual(result['reason'],'uncertain_launch')
            request=j.request('launch')['params']
            script=base64.b64decode(request['UserData']).decode()
            self.assertTrue(script.startswith('#!/bin/bash\n'))
            self.assertIn(str(1000+170*3600),script)
            self.assertIn('systemctl',script)
            self.assertIn('poweroff',script)
            self.assertEqual(subprocess.run(['bash','-n'],input=script,text=True,capture_output=True).returncode,0)
            # The complete launch request is durable even without any SSH effect.
            self.assertIsNone(j.request('host-install'))
            self.assertEqual(sum(op=='RunInstances' for op,_ in cloud.calls),1)

    def test_profile_propagation_wait_does_not_reset_plan_or_repeat_creations(self):
        with tempfile.TemporaryDirectory() as temp,self.journal(Path(temp)/'journal') as j:
            cloud=ProvisionCloud(j);cloud.profile_ready=False
            result=provision.provision_resources(cloud,j,provisioning_plan(),now=1001)
            self.assertEqual(result['reason'],'instance_profile_propagation');self.assertFalse(result['launch_dispatched'])
            cloud.profile_ready=True
            self.assertEqual(provision.provision_resources(cloud,j,provisioning_plan(),now=1002)['status'],'bound')
            self.assertEqual(sum(op=='CreateRole' for op,_ in cloud.calls),1)
            changed=provisioning_plan();changed['subnet']='subnet-abcdef12';before=len(cloud.calls)
            with self.assertRaises(E):provision.provision_resources(cloud,j,changed,now=1003)
            self.assertEqual(len(cloud.calls),before)

    def test_lost_launch_ack_reconciles_without_replacement_even_after_expiry(self):
        with tempfile.TemporaryDirectory() as temp,self.journal(Path(temp)/'journal') as j:
            cloud=ProvisionCloud(j,failure=('RunInstances','after'));cloud.hidden_instance=True
            result=provision.provision_resources(cloud,j,provisioning_plan(),now=1001)
            self.assertEqual(result['reason'],'uncertain_launch')
            before=len(cloud.calls);result=provision.cleanup_partial(cloud,j,now=1000+170*3600)
            self.assertFalse(result['complete']);self.assertEqual(result['pending'],['uncertain_launch'])
            self.assertEqual([op for op,_ in cloud.calls[before:]],['DescribeInstances'])
            cloud.hidden_instance=False
            result=provision.cleanup_partial(cloud,j,now=1000+170*3600)
            self.assertTrue(result['complete']);self.assertEqual(sum(op=='RunInstances' for op,_ in cloud.calls),1)
            self.assertIsNotNone(j.snapshot()['stop']);self.assertEqual(j.snapshot()['epoch'],1000)

    def test_known_creation_failure_cleans_prior_resources_and_reads_absence(self):
        with tempfile.TemporaryDirectory() as temp,self.journal(Path(temp)/'journal') as j:
            cloud=ProvisionCloud(j,failure=('CreateRole','before'))
            with self.assertRaises(E):provision.provision_resources(cloud,j,provisioning_plan(),now=1001)
            self.assertEqual(len(cloud.buckets),2)
            result=provision.cleanup_partial(cloud,j,now=1002)
            self.assertTrue(result['complete']);self.assertFalse(cloud.buckets)
            self.assertFalse(any(op=='RunInstances' for op,_ in cloud.calls))
            self.assertEqual(cloud.calls[-1][0],'ListBuckets')

    def test_lost_named_creation_ack_remains_unknown_and_is_not_adopted(self):
        with tempfile.TemporaryDirectory() as temp,self.journal(Path(temp)/'journal') as j:
            cloud=ProvisionCloud(j,failure=('CreateRole','after'))
            with self.assertRaises(E):provision.provision_resources(cloud,j,provisioning_plan(),now=1001)
            result=provision.cleanup_partial(cloud,j,now=1002)
            self.assertFalse(result['complete']);self.assertEqual(result['pending'],['role'])
            self.assertFalse(cloud.buckets);self.assertIsNotNone(cloud.role)
            before=len(cloud.calls)
            with self.assertRaises(E):provision.provision_resources(cloud,j,provisioning_plan(),now=1003)
            self.assertEqual(len(cloud.calls),before)

    def test_existing_resource_or_invalid_scope_prevents_every_creation(self):
        with tempfile.TemporaryDirectory() as temp,self.journal(Path(temp)/'journal') as j:
            cloud=ProvisionCloud(j);cloud.buckets['server2-shadow-test1-raw']={}
            with self.assertRaises(E):provision.provision_resources(cloud,j,provisioning_plan(),now=1001)
            self.assertFalse(any(op.startswith('Create') for op,_ in cloud.calls))
        for key,value in [('operator_cidr','0.0.0.0/0'),('region','us-east-1'),('root_device','/dev/arbitrary')]:
            invalid=provisioning_plan();invalid[key]=value
            with self.assertRaises((E,ValueError)):provision.cloud_plan(invalid)



# SR-5a (#3003): paired evidence in the run's state bucket. The host copy program and the
# operator's bucket-only audit are exercised with a real paired ledger and a fake S3.
reader_spec=importlib.util.spec_from_file_location('shadow_paired_read',SOURCE.parents[2]/'tools/shadow/paired_read.py')
paired_tool=importlib.util.module_from_spec(reader_spec);reader_spec.loader.exec_module(paired_tool)


def load_evidence_modules():
    modules=[]
    for name in ('evidence_copy','evidence_audit'):
        module_spec=importlib.util.spec_from_file_location('shadow_'+name,SOURCE.with_name(name+'.py'))
        module=importlib.util.module_from_spec(module_spec);module_spec.loader.exec_module(module)
        modules.append(module)
    return modules


STOPPED_AT='Mon 2026-11-16 00:00:00 UTC'


class FakeS3:
    """Versioned object store: every PUT appends a version; faults by stage or key."""
    def __init__(self,copy):
        self.copy=copy;self.objects={};self.keys=[];self.fail=None;self.lost=None;self.during=None
    def put(self,key,body,sha256,size,until):
        data=body if isinstance(body,bytes) else Path(body).read_bytes()
        assert len(data)==size and operator.hashlib.sha256(data).hexdigest()==sha256,key
        stage=key.rsplit('/',1)[1].split('-',1)[0].split('.',1)[0]
        if self.during is not None:self.during(stage)
        if self.fail is not None and self.fail(stage,key):raise self.copy.CopyError('put',stage=stage,status=503)
        self.keys.append(key);self.objects.setdefault(key,[]).append(data)
        if self.lost is not None and self.lost(stage,key):raise self.copy.CopyError('put',stage=stage,status=None)
    def download(self,directory):
        directory=Path(directory);directory.mkdir(exist_ok=True);listing=[]
        for index,(key,versions) in enumerate(sorted(self.objects.items())):
            for version,data in enumerate(versions):
                path=directory/f'{index}-{version}.object';path.write_bytes(data);listing.append((key,path))
        return listing


class EvidenceHost:
    """An installed run as install_host_tree leaves it, with a real paired_read ledger."""
    def __init__(self,root):
        source,launch=HostInstallTests.bundle(self,root)
        self.launch=launch;self.root=root/'host'
        for directory in ('state','data/paired','bin','config'):(self.root/directory).mkdir(parents=True,mode=0o700)
        self.launch_bytes=(state.canonical(launch)+'\n').encode()
        (self.root/'launch.json').write_bytes(self.launch_bytes)
        (self.root/'reader.json').write_bytes((source/'reader.json').read_bytes())
        self.launch_sha256=operator.hashlib.sha256(self.launch_bytes).hexdigest()
        self.reader=json.loads((source/'reader.json').read_text())
        self.paired=self.root/'data/paired'
        identity=dict(manifest=self.reader,candidate='http://127.0.0.1:3000',production=paired_tool.PRODUCTION,
                      loopback_test=False,sampler_sha256=launch['plan']['artifacts']['paired_read.py'])
        self.ledger=paired_tool.Ledger(self.paired,identity,False)
        self.unit=('active','')

    def attempt(self,ident,kind='captured',files=True,body=None):
        """kind: captured (child wrote files), child-timeout, capture-failure, pending."""
        result=None
        if kind in ('captured','child-timeout'):
            body=body if body is not None else f'body {ident}'.encode()
            meta={'status':200,'headers':{'etag':f'"{ident}"'}} if kind=='captured' else {'error':'deadline'}
            meta.update(body_bytes=len(body),body_sha256=operator.hashlib.sha256(body).hexdigest())
            if files:
                (self.paired/f'{ident}.body').write_bytes(body)
                (self.paired/f'{ident}.json').write_text(paired_tool.canonical(meta))
            result=dict(meta,elapsed_ms=40)
        elif kind=='capture-failure':result={'error':'deadline','captured':False,'elapsed_ms':20000}
        with self.ledger.db:
            self.ledger.db.execute('INSERT INTO attempts(id,case_id,slot,origin,path,method,started,result) VALUES (?,?,?,?,?,?,?,?)',
                                   (ident,'seoul',ident,'candidate' if ident%2 else 'production','/weather/coord/37.566,126.978','GET',
                                    1000.0+ident,None if result is None else paired_tool.canonical(result)))

    def complete(self,ident):
        """A pending attempt completes later (its files and result arrive)."""
        body=f'body {ident}'.encode()
        meta={'status':200,'headers':{'etag':f'"{ident}"'},'body_bytes':len(body),'body_sha256':operator.hashlib.sha256(body).hexdigest()}
        (self.paired/f'{ident}.body').write_bytes(body);(self.paired/f'{ident}.json').write_text(paired_tool.canonical(meta))
        with self.ledger.db:
            self.ledger.db.execute('UPDATE attempts SET result=? WHERE id=?',(paired_tool.canonical(dict(meta,elapsed_ms=40)),ident))


class EvidenceCase(unittest.TestCase):
    NOW=1000+3*3600

    @classmethod
    def setUpClass(cls):
        cls.copy,cls.audit_module=load_evidence_modules()

    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        self.temp=Path(temp.name);self.host=EvidenceHost(self.temp)
        self.addCleanup(self.host.ledger.close)
        self.tree=self.copy.HostTree(self.host.root/'launch.json')
        self.s3=FakeS3(self.copy);self.lines=[];self.now=self.NOW

    def run_copy(self,final=False,unit=None,clock=None,sleep=None):
        return self.copy.run(self.tree,final=final,put=self.s3.put,clock=clock or (lambda:self.now),
                             unit_state=lambda:unit or self.host.unit,sleep=sleep or self.advance,
                             log=self.lines.append)

    def advance(self,seconds):
        self.now+=seconds

    def audited(self,s3=None,name='audit'):
        s3=s3 or self.s3
        objects=s3.download(self.temp/(name+'-objects'))
        return self.audit_module.audit(objects,run_id='test1',launch_sha256=self.host.launch_sha256,workdir=self.temp/name)

    def copy_state(self):
        return json.loads((self.host.root/'state/copy.json').read_text())

    def index(self,generation):
        return json.loads(self.s3.objects[f'evidence/test1/index-{generation}.json'][-1])


class EvidenceCopyTests(EvidenceCase):
    def test_reader_stopped_is_its_lock_released_not_a_systemd_timestamp(self):
        # Linux check finding: systemd 255 unloads a cleanly stopped unit without references,
        # after which `systemctl show` reports zero timestamps (ExecMainExitTimestamp empty), as
        # for a unit never started. The reader holds data/paired/owner.lock (flock, shared with
        # its children) for its whole life, so a free lock is the stop.
        import fcntl
        lock=self.tree.paired/'owner.lock'
        self.assertFalse(self.copy.reader_gone(lock))            # never started: no lock file
        lock.write_text('');held=os.open(lock,os.O_RDWR)
        try:
            fcntl.flock(held,fcntl.LOCK_EX|fcntl.LOCK_NB)
            self.assertFalse(self.copy.reader_gone(lock))        # running
        finally:
            os.close(held)
        self.assertTrue(self.copy.reader_gone(lock))             # stopped (lock released)
        self.assertTrue(lock.exists())                           # probing never deletes or creates
        calls=[]
        def show(argv,**k):
            calls.append(argv);return subprocess.CompletedProcess(argv,0,'ActiveState=inactive\nExecMainExitTimestamp=\n','')
        from unittest import mock
        with mock.patch.object(self.copy.subprocess,'run',show):
            self.assertTrue(self.copy.reader_stopped(self.copy.systemd_unit_state('r.service',lock)))
            fd=os.open(lock,os.O_RDWR);fcntl.flock(fd,fcntl.LOCK_EX)
            try:self.assertFalse(self.copy.reader_stopped(self.copy.systemd_unit_state('r.service',lock)))
            finally:os.close(fd)
        with mock.patch.object(self.copy.subprocess,'run',lambda argv,**k:subprocess.CompletedProcess(argv,0,'ActiveState=deactivating\n','')):
            self.assertFalse(self.copy.reader_stopped(self.copy.systemd_unit_state('r.service',lock)))

    def test_a_generation_puts_batch_then_ledger_then_index_last(self):
        self.host.attempt(1);self.host.attempt(2);self.host.attempt(3,'pending');self.host.attempt(4,'capture-failure')
        result=self.run_copy()
        self.assertEqual(result['status'],'committed',result)
        self.assertEqual(self.s3.keys,['evidence/test1/contract.json','evidence/test1/batch-1.tar',
                                       'evidence/test1/ledger-1.sqlite3','evidence/test1/index-1.json'])
        self.assertEqual(self.copy_state()|{'shipped':None},dict(schema=1,reserved=1,committed=1,contract=True,shipped=None))
        self.assertEqual(self.copy_state()['shipped'],[1,2])
        index=self.index(1)
        self.assertEqual((index['generation'],index['kind'],index['run_id']),(1,'ordinary','test1'))
        self.assertEqual(index['attempts'],dict(total=4,completed=3,pending=1,capture_failures=1))
        self.assertEqual(index['pending_ids'],[3])
        self.assertEqual([f['id'] for f in index['files']],[1,2])
        batch=self.s3.objects['evidence/test1/batch-1.tar'][0]
        self.assertEqual(index['batch'],dict(key='evidence/test1/batch-1.tar',size=len(batch),
                                             sha256=operator.hashlib.sha256(batch).hexdigest()))
        import io,tarfile
        with tarfile.open(fileobj=io.BytesIO(batch)) as archive:
            self.assertEqual(sorted(archive.getnames()),['1.body','1.json','2.body','2.json'])
            self.assertEqual(archive.extractfile('2.body').read(),b'body 2')
        ledger=self.temp/'ledger.sqlite3';ledger.write_bytes(self.s3.objects['evidence/test1/ledger-1.sqlite3'][0])
        db=remote.sqlite3.connect(ledger)
        self.assertEqual(db.execute('PRAGMA integrity_check').fetchall(),[('ok',)])
        self.assertEqual(db.execute('SELECT count(*) FROM attempts').fetchone()[0],4);db.close()
        contract=json.loads(self.s3.objects['evidence/test1/contract.json'][0])
        self.assertEqual(contract['launch_json'].encode(),self.host.launch_bytes)
        self.assertEqual(contract['launch_sha256'],self.host.launch_sha256)
        self.assertEqual(contract['reader_sha256'],self.host.launch['plan']['artifacts']['reader.json'])
        # Fixed-vocabulary JSON lines; never a key, URL, credential or body.
        self.assertTrue(self.lines)
        for line in self.lines:
            record=json.loads(line)
            self.assertEqual(record['copy_schema'],1)
            self.assertLessEqual(set(record),self.copy.LOG_FIELDS)
            for text in ('evidence/','http','body 1','server2-shadow','ASIA'):self.assertNotIn(text,line)

    def test_the_bucket_and_region_are_the_collector_destination(self):
        settings=operator.logging_settings(self.host.launch)
        self.assertIn(f'SERVER2_S3_BUCKET={self.tree.bucket}\n',settings)
        self.assertIn(f'SERVER2_S3_REGION={self.copy.REGION}\n',settings)
        self.assertEqual(self.tree.prefix,'evidence/test1/')
        self.assertEqual(self.tree.limit,1000+170*3600-600)

    def test_later_generations_ship_only_new_complete_files(self):
        self.host.attempt(1);self.host.attempt(2,'pending')
        self.assertEqual(self.run_copy()['generation'],1)
        self.host.complete(2);self.host.attempt(3,files=False)
        self.run_copy()
        self.assertEqual([f['id'] for f in self.index(2)['files']],[2])
        # A completed attempt whose files are absent or partial is never shipped half.
        (self.host.paired/'3.json').write_text('{"status":')
        self.run_copy()
        self.assertIsNone(self.index(3)['batch'])
        self.assertNotIn('evidence/test1/batch-3.tar',self.s3.objects)
        self.host.complete(3)
        self.run_copy()
        self.assertEqual([f['id'] for f in self.index(4)['files']],[3])
        self.assertEqual(self.copy_state()['shipped'],[1,2,3])

    def test_mismatched_body_can_be_recovered_in_a_later_final_generation(self):
        self.host.attempt(1)
        body=self.host.paired/'1.body'; original=body.read_bytes()
        body.write_bytes(b'other!')
        self.assertEqual(self.run_copy()['status'],'committed')
        self.assertEqual(self.copy_state()['shipped'],[])
        self.host.unit=('inactive',STOPPED_AT)
        result=self.run_copy(final=True)
        self.assertEqual((result['status'],result['reason']),('incomplete','unshipped'))
        self.assertTrue(self.tree.latch.exists())
        self.assertEqual(self.audited(name='incomplete')['missing_or_mismatched'],[1])
        body.write_bytes(original)
        self.assertEqual(self.run_copy()['status'],'committed')
        self.assertFalse(self.tree.latch.exists())
        self.assertTrue(self.audited()['complete'])

    def test_one_finalizer_drains_multiple_capped_batches_and_holds_its_latch(self):
        for attempt in (1,2,3):
            self.host.attempt(attempt,body=b'x'*6000)
        self.now=self.host.launch['epoch']+168*3600
        self.host.unit=('inactive',STOPPED_AT)
        pending=[]
        def observe(stage):
            if stage=='index':
                pending.append(self.tree.latch.exists())
        self.s3.during=observe
        import tarfile
        with unittest.mock.patch.object(self.copy,'MAX_BATCH_BYTES',tarfile.RECORDSIZE):
            result=self.run_copy(final=True)
        self.assertEqual((result['status'],result['kind'],result['shipped']),('committed','final',3))
        self.assertEqual(pending,[True,True,True])
        self.assertFalse(self.tree.latch.exists())
        self.assertEqual([self.index(i)['kind'] for i in range(1,4)],['ordinary','ordinary','final'])
        self.assertTrue(all(self.index(i)['batch']['size']<=tarfile.RECORDSIZE for i in range(1,4)))
        self.assertTrue(self.audited()['complete'])

    def test_a_finalizer_with_more_than_four_batches_leaves_a_retryable_tail(self):
        for attempt in range(1, 6):
            self.host.attempt(attempt, body=b'x' * 6000)
        self.host.unit = ('inactive', STOPPED_AT)
        import tarfile
        with unittest.mock.patch.object(self.copy, 'MAX_BATCH_BYTES', tarfile.RECORDSIZE):
            result = self.run_copy(final=True)
            self.assertEqual((result['status'], result['reason'], result['shipped']), ('incomplete', 'unshipped', 4))
            self.assertTrue(self.tree.latch.exists())
            self.assertEqual(self.audited(name='partial')['missing_or_mismatched'], [5])
            result = self.run_copy()
        self.assertEqual((result['status'], result['kind'], result['shipped']), ('committed', 'final', 1))
        self.assertFalse(self.tree.latch.exists())
        self.assertTrue(self.audited()['complete'])

    def test_monotonic_deadline_prevents_extension_on_wall_clock_rollback(self):
        wall, elapsed = [self.tree.limit - 0.5], [0.0]
        deadline = self.copy.Deadline(self.tree.limit, lambda:wall[0], lambda:elapsed[0])
        self.assertEqual(deadline(), 0.5)
        wall[0] -= 90
        elapsed[0] += 0.5
        self.assertEqual(deadline(), 0)

    def test_expired_put_cannot_report_success(self):
        elapsed=[0.0]
        class Connection:
            def __init__(self, host, timeout):
                self.timeout=timeout
                self.status=200
            def putrequest(self,*args,**kwargs): pass
            def putheader(self,*args): pass
            def endheaders(self): pass
            def send(self,data): elapsed[0]+=0.3
            def getresponse(self):
                elapsed[0]+=0.3
                return self
            def read(self,size): return b''
            def close(self): pass
        client=self.copy.S3Client(self.tree.bucket,self.copy.REGION,
                                  lambda:dict(AccessKeyId='fixture',SecretAccessKey='fixture',Token='fixture'),
                                  connect=Connection,clock=lambda:self.now)
        with self.assertRaises(self.copy.CopyError) as deadline:
            client.put(self.tree.prefix+'contract.json',b'x','0'*64,1,time_left=lambda:0.5-elapsed[0])
        self.assertEqual(deadline.exception.reason,'deadline')

    def test_reader_probe_timeout_preserves_latch_and_emits_structured_failure(self):
        self.host.attempt(1)
        with unittest.mock.patch.object(self.copy.subprocess,'run',side_effect=subprocess.TimeoutExpired('probe',5)):
            result=self.copy.run(self.tree,final=True,put=self.s3.put,clock=lambda:self.now,
                                 unit_state=lambda:self.copy.systemd_unit_state('reader',self.tree.paired/'owner.lock'),
                                 log=self.lines.append)
        self.assertEqual((result['status'],result['reason']),('failed','reader'))
        self.assertTrue(self.tree.latch.exists())
        self.assertEqual(self.s3.keys,[])
        self.assertEqual([(line['event'],line['reason']) for line in map(json.loads,self.lines)],
                         [('copy.failed','reader')])

    def test_a_failed_put_never_commits_and_the_next_run_uses_a_new_generation(self):
        for stage in ('batch','ledger','index'):
            with self.subTest(stage=stage):
                self.setUp();self.host.attempt(1)
                self.s3.fail=lambda s,k,stage=stage:s==stage
                result=self.run_copy()
                self.assertEqual((result['status'],result['stage']),('failed',stage))
                self.assertEqual((self.copy_state()['reserved'],self.copy_state()['committed'],self.copy_state()['shipped']),(1,0,[]))
                self.s3.fail=None
                self.assertEqual(self.run_copy()['generation'],2)
                self.assertEqual([f['id'] for f in self.index(2)['files']],[1])
                self.assertEqual(len(self.s3.keys),len(set(self.s3.keys)),'a key is never reused')
                self.assertTrue(any(json.loads(l).get('event')=='copy.failed' and json.loads(l).get('status')==503 for l in self.lines))

    def test_a_lost_index_response_or_state_save_reships_and_the_audit_deduplicates(self):
        for fault in ('lost-index','save'):
            with self.subTest(fault=fault):
                self.setUp();self.host.attempt(1);self.host.attempt(2)
                if fault=='lost-index':self.s3.lost=lambda s,k:s=='index'
                original=self.copy.save_state
                calls=[]
                def failing(tree,value):
                    calls.append(value['committed'])
                    if fault=='save' and value['committed']==1:raise OSError('injected save failure')
                    return original(tree,value)
                with unittest.mock.patch.object(self.copy,'save_state',failing):
                    self.assertEqual(self.run_copy()['status'],'failed')
                self.s3.lost=None
                self.assertEqual(self.copy_state()['committed'],0)
                self.host.unit=('inactive',STOPPED_AT);self.host.attempt(3)
                self.assertEqual(self.run_copy(final=True)['kind'],'final')
                self.assertEqual([f['id'] for f in self.index(2)['files']],[1,2,3])
                report=self.audited()
                self.assertTrue(report['complete'],report)
                self.assertEqual(report['generations']['valid'],2)

    def test_the_contract_is_published_until_committed(self):
        self.host.attempt(1)
        self.s3.fail=lambda s,k:s=='contract'
        result=self.run_copy()
        # The generation is still taken: the contract is retried by every later run.
        self.assertEqual(result['status'],'committed')
        self.assertFalse(self.copy_state()['contract'])
        self.s3.fail=None;self.s3.lost=lambda s,k:s=='contract'
        self.run_copy();self.assertFalse(self.copy_state()['contract'])
        self.s3.lost=None;self.run_copy()
        self.assertTrue(self.copy_state()['contract'])
        self.run_copy()
        versions=self.s3.objects['evidence/test1/contract.json']
        self.assertEqual(len(versions),2);self.assertEqual(versions[0],versions[1])

    def test_a_final_generation_needs_the_request_and_a_stopped_reader(self):
        self.host.attempt(1)
        cases=[(False,('inactive',STOPPED_AT),'ordinary'),(True,('active',''),'ordinary'),
               (True,('deactivating',''),'ordinary'),(True,('inactive',''),'ordinary'),
               (True,('inactive',STOPPED_AT),'final'),(True,('failed',STOPPED_AT),'final')]
        for requested,unit,kind in cases:
            with self.subTest(requested=requested,unit=unit):
                latch=self.host.root/'state/final.requested'
                if requested:latch.write_text('{}')
                else:latch.unlink(missing_ok=True)
                result=self.run_copy(unit=unit)
                self.assertEqual(result['kind'],kind)
                index=self.index(result['generation'])
                self.assertEqual(index['reader']['state'],unit[0])
                self.assertEqual(index['reader']['stopped'],unit[0] in ('inactive','failed') and bool(unit[1]))
                self.assertEqual(latch.exists(),requested and kind!='final')

    def test_the_finalizer_waits_for_the_reader_within_its_bound(self):
        self.host.attempt(1)
        states=iter([('active','')]*3+[('deactivating','')]+[('failed',STOPPED_AT)]*5)
        slept=[]
        result=self.copy.run(self.tree,final=True,put=self.s3.put,clock=lambda:self.NOW+len(slept),
                             unit_state=lambda:next(states),sleep=slept.append,log=self.lines.append)
        self.assertEqual(result['kind'],'final');self.assertEqual(len(slept),4)
        self.assertEqual(self.index(1)['reader']['state'],'failed')
        self.assertEqual(self.index(1)['terminal'],None)
        # A reader that never stops within the bound gets an ordinary generation; the
        # durable request stays for a later run.
        slept.clear()
        result=self.copy.run(self.tree,final=True,put=self.s3.put,clock=lambda:self.NOW+2*len(slept),
                             unit_state=lambda:('active',''),sleep=slept.append,log=self.lines.append)
        self.assertEqual(result['kind'],'ordinary')
        self.assertLessEqual(2*len(slept),self.copy.FINAL_WAIT_SECONDS+2)
        self.assertTrue((self.host.root/'state/final.requested').exists())

    def test_a_failed_final_is_recovered_by_the_next_hourly_run(self):
        self.host.attempt(1);self.host.unit=('failed',STOPPED_AT)
        self.s3.fail=lambda s,k:s=='index'
        self.assertEqual(self.run_copy(final=True)['status'],'failed')
        self.assertTrue((self.host.root/'state/final.requested').exists())
        self.assertEqual(self.audited(name='before')['status'],'tail_unverified')
        self.s3.fail=None;self.now+=3600
        result=self.run_copy()
        self.assertEqual((result['status'],result['kind']),('committed','final'))
        self.assertFalse((self.host.root/'state/final.requested').exists())
        report=self.audited()
        self.assertTrue(report['complete'],report)
        self.assertEqual(report['reader']['state'],'failed')

    def test_a_final_request_during_an_ordinary_run_is_served_by_the_next_locked_run(self):
        self.host.attempt(1)
        def request(stage):
            if stage=='batch':
                # The finalizer creates its durable request while the hourly run holds the lock.
                self.copy.request_final(self.tree,self.now)
                self.host.unit=('inactive',STOPPED_AT)
        self.s3.during=request
        self.assertEqual(self.run_copy()['kind'],'ordinary')
        self.s3.during=None
        self.assertTrue((self.host.root/'state/final.requested').exists())
        self.assertEqual(self.run_copy()['kind'],'final')

    def test_runs_are_serialized_by_the_lock_and_bounded_in_time(self):
        import fcntl
        self.host.attempt(1)
        holder=os.open(self.host.root/'state/copy.lock',os.O_RDWR|os.O_CREAT,0o600)
        self.addCleanup(os.close,holder)
        fcntl.flock(holder,fcntl.LOCK_EX)
        clock=[self.NOW]
        result=self.copy.run(self.tree,final=False,put=self.s3.put,clock=lambda:clock[0],unit_state=lambda:('active',''),
                             sleep=lambda s:clock.__setitem__(0,clock[0]+s),log=self.lines.append)
        self.assertEqual((result['status'],result['reason']),('failed','lock'))
        self.assertLessEqual(clock[0]-self.NOW,self.copy.RUN_SECONDS)
        self.assertEqual(self.s3.keys,[])
        # Near the absolute bound the wait stops at the bound itself.
        clock[0]=self.tree.limit-5
        result=self.copy.run(self.tree,final=False,put=self.s3.put,clock=lambda:clock[0],unit_state=lambda:('active',''),
                             sleep=lambda s:clock.__setitem__(0,clock[0]+s),log=self.lines.append)
        self.assertEqual(result['reason'],'lock');self.assertLessEqual(clock[0],self.tree.limit+1)
        fcntl.flock(holder,fcntl.LOCK_UN)
        # At or after epoch + 170 h - 10 min nothing starts.
        self.now=self.tree.limit
        result=self.run_copy(final=True)
        self.assertEqual((result['status'],result['reason']),('failed','deadline'))
        self.assertEqual(self.s3.keys,[]);self.assertFalse((self.host.root/'state/copy.json').exists())
        self.assertFalse((self.host.root/'state/final.requested').exists())

    def test_a_hot_journal_of_a_stopped_reader_is_rolled_back_on_a_private_copy(self):
        for ident in range(1,4):self.host.attempt(ident)
        self.host.ledger.close()
        script=('import os,sqlite3,sys\ndb=sqlite3.connect(sys.argv[1],isolation_level=None)\n'
                "db.execute('PRAGMA cache_size=1');db.execute('BEGIN')\n"
                "db.execute('UPDATE attempts SET result=NULL');db.execute(\"INSERT INTO meta VALUES ('pad',?)\",('x'*200000,))\n"
                'os._exit(0)\n')
        subprocess.run([sys.executable,'-c',script,str(self.host.paired/'ledger.sqlite3')],check=True,timeout=20)
        journal=self.host.paired/'ledger.sqlite3-journal'
        self.assertTrue(journal.exists())
        before=(self.host.paired/'ledger.sqlite3').read_bytes(),journal.read_bytes()
        result=self.run_copy(final=True,unit=('failed',STOPPED_AT))
        self.assertEqual((result['status'],result['kind']),('committed','final'),self.lines)
        self.assertEqual(self.index(1)['attempts']['completed'],3)
        self.assertEqual(((self.host.paired/'ledger.sqlite3').read_bytes(),journal.read_bytes()),before,
                         'the live ledger and its journal are never modified')
        self.host.ledger=paired_tool.Ledger.__new__(paired_tool.Ledger);self.host.ledger.db=remote.sqlite3.connect(':memory:')
        self.assertTrue(self.audited()['complete'])

    def test_an_install_without_a_ledger_publishes_only_the_contract(self):
        self.host.ledger.close();(self.host.paired/'ledger.sqlite3').unlink()
        self.host.ledger.db=remote.sqlite3.connect(':memory:')
        result=self.run_copy(final=True,unit=('inactive',''))
        self.assertEqual((result['status'],result['reason']),('skipped','no_ledger'))
        self.assertEqual(self.s3.keys,['evidence/test1/contract.json'])
        self.assertEqual(self.copy_state()['reserved'],0)
        self.assertEqual(self.audited()['status'],'no_paired_evidence')

    def test_sigv4_matches_the_published_s3_example(self):
        # AWS S3 API reference, "Signature Calculations for the Authorization Header",
        # GET Object example (example credentials, us-east-1, 2013-05-24).
        headers={'host':'examplebucket.s3.amazonaws.com','range':'bytes=0-9',
                 'x-amz-content-sha256':'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                 'x-amz-date':'20130524T000000Z'}
        signature,signed,scope=self.copy.sign('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY','us-east-1','GET','/test.txt',headers,
                                              headers['x-amz-content-sha256'])
        self.assertEqual(signed,'host;range;x-amz-content-sha256;x-amz-date')
        self.assertEqual(scope,'20130524/us-east-1/s3/aws4_request')
        self.assertEqual(signature,'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')

    def test_imds_credentials_and_the_signed_put_on_the_wire(self):
        from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
        import threading
        seen=[]
        class Handler(BaseHTTPRequestHandler):
            protocol_version='HTTP/1.1'
            def log_message(self,*args):pass
            def reply(self,status,body=b''):
                self.send_response(status);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
            def do_PUT(self):
                if self.path=='/latest/api/token':
                    seen.append(('token',self.headers.get('X-aws-ec2-metadata-token-ttl-seconds')));return self.reply(200,b'tok')
                body=self.rfile.read(int(self.headers['Content-Length']))
                seen.append(('put',self.path,dict(self.headers),body))
                return self.reply(int(self.server.status),b'<Error><Code>Fixture</Code></Error>')
            def do_GET(self):
                if self.headers.get('X-aws-ec2-metadata-token')!='tok':return self.reply(401)
                if self.path=='/latest/meta-data/iam/security-credentials/':return self.reply(200,b'role-1')
                if self.path=='/latest/meta-data/iam/security-credentials/role-1':
                    return self.reply(200,json.dumps({'Code':'Success','AccessKeyId':'ASIAFIXTURE','SecretAccessKey':'secret',
                                                      'Token':'session'}).encode())
                return self.reply(404)
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.status=200;server.daemon_threads=True
        threading.Thread(target=server.serve_forever,daemon=True).start()
        self.addCleanup(server.server_close);self.addCleanup(server.shutdown)
        import http.client
        connect=lambda host,timeout:http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=timeout)
        credentials=self.copy.imds_credentials(connect=connect)
        self.assertEqual(credentials['AccessKeyId'],'ASIAFIXTURE')
        client=self.copy.S3Client(self.tree.bucket,self.copy.REGION,lambda:credentials,connect=connect,clock=lambda:1.8e9)
        body=b'fixture object';digest=operator.hashlib.sha256(body).hexdigest()
        client.put('evidence/test1/index-1.json',body,digest,len(body),time_left=lambda:30)
        _,path,headers,received=seen[-1]
        self.assertEqual((path,received),('/evidence/test1/index-1.json',body))
        self.assertEqual(headers['Host'],'server2-shadow-test1-state.s3.ap-northeast-2.amazonaws.com')
        self.assertEqual(headers['x-amz-content-sha256'],digest);self.assertEqual(headers['x-amz-security-token'],'session')
        self.assertTrue(headers['Authorization'].startswith('AWS4-HMAC-SHA256 Credential=ASIAFIXTURE/20270115/ap-northeast-2/s3/aws4_request, '
                                                            'SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token, Signature='))
        server.status=503
        with self.assertRaises(self.copy.CopyError) as failure:client.put('evidence/test1/index-2.json',body,digest,len(body),time_left=lambda:30)
        self.assertEqual((failure.exception.reason,failure.exception.status),('put',503))
        self.assertNotIn('evidence',str(failure.exception))

    def test_the_host_command_refuses_outside_its_installed_tree(self):
        result=subprocess.run([sys.executable,'-I',str(SOURCE.with_name('evidence_copy.py')),'--launch',str(self.host.root/'launch.json')],
                              capture_output=True,text=True,timeout=20)
        self.assertEqual(result.returncode,2)
        record=json.loads(result.stdout.strip())
        self.assertEqual((record['event'],record['reason']),('copy.failed','host'))
        self.assertEqual(result.stderr,'')


class EvidenceAuditTests(EvidenceCase):
    def final_run(self):
        self.host.attempt(1);self.host.attempt(2,'child-timeout');self.host.attempt(3,'capture-failure')
        self.run_copy()
        self.host.attempt(4);self.host.attempt(5,'pending')
        self.host.unit=('inactive',STOPPED_AT)
        return self.run_copy(final=True)

    def test_a_final_generation_with_every_attempt_accounted_for_is_complete(self):
        self.assertEqual(self.final_run()['kind'],'final')
        report=self.audited()
        self.assertTrue(report['complete'],report)
        self.assertEqual(report['status'],'complete')
        self.assertEqual((report['generation'],report['kind'],report['attempts']),(2,'final',5))
        self.assertEqual((report['pending'],report['capture_failures'],report['missing_or_mismatched']),([5],[3],[]))
        self.assertEqual(report['reader'],{'state':'inactive','stopped':True})
        self.assertEqual(report['qualification'],'not_assessed')
        # The assembly is the files of the final ledger, from the bucket only.
        self.assertEqual((self.temp/'audit/files/4.body').read_bytes(),b'body 4')
        self.assertEqual((self.temp/'audit/files/2.json').read_bytes(),(self.host.paired/'2.json').read_bytes())

    def test_ordinary_generations_only_leave_the_tail_unverified(self):
        self.host.attempt(1);self.run_copy();self.now+=3600;self.run_copy()
        report=self.audited()
        self.assertFalse(report['complete'])
        self.assertEqual((report['status'],report['newest_snapshot_at']),('tail_unverified',self.now))

    def test_malformed_newer_object_descriptor_preserves_previous_valid_final(self):
        final=self.final_run()['generation']
        original=self.index(final); generation=final+1
        malformed=dict(original,generation=generation,
                       ledger=dict(original['ledger'],key=f'evidence/test1/ledger-{generation}.sqlite3'),
                       batch=dict(original['batch'],key=f'evidence/test1/batch-{generation}.tar'),
                       files=[dict(original['files'][0],json_size=None)])
        for name,suffix in (('ledger','sqlite3'),('batch','tar')):
            self.s3.objects[f'evidence/test1/{name}-{generation}.{suffix}']=self.s3.objects[f'evidence/test1/{name}-{final}.{suffix}']
        self.s3.objects[f'evidence/test1/index-{generation}.json']=[json.dumps(malformed).encode()]
        report=self.audited()
        self.assertTrue(report['complete'],report)
        self.assertEqual((report['generation'],report['generations']['ignored']),(final,1))

    def test_a_missing_or_unbound_contract_is_incomplete(self):
        self.final_run()
        for defect in ('missing','launch','reader','journal'):
            with self.subTest(defect=defect):
                s3=FakeS3(self.copy);s3.objects={k:list(v) for k,v in self.s3.objects.items()}
                contract=json.loads(s3.objects['evidence/test1/contract.json'][0])
                if defect=='missing':del s3.objects['evidence/test1/contract.json']
                if defect=='launch':contract['launch_json']=contract['launch_json'].replace('"port":3000','"port":3001')
                if defect=='reader':contract['reader_json']=contract['reader_json'].replace('3600','1800')
                if defect in ('launch','reader'):s3.objects['evidence/test1/contract.json']=[json.dumps(contract).encode()]
                objects=s3.download(self.temp/(defect+'-objects'))
                expected=self.host.launch_sha256 if defect!='journal' else 'f'*64
                report=self.audit_module.audit(objects,run_id='test1',launch_sha256=expected,workdir=self.temp/defect)
                self.assertFalse(report['complete'])
                self.assertEqual(report['status'],'contract_missing' if defect=='missing' else 'contract_mismatch')

    def test_same_bytes_deduplicate_and_different_bytes_conflict(self):
        self.final_run()
        import io,tarfile
        def rebatch(generation,members):
            data=io.BytesIO()
            with tarfile.open(fileobj=data,mode='w',format=tarfile.USTAR_FORMAT) as archive:
                for name,content in members.items():
                    item=tarfile.TarInfo(name);item.size=len(content);archive.addfile(item,io.BytesIO(content))
            return data.getvalue()
        for same in (True,False):
            with self.subTest(same=same):
                s3=FakeS3(self.copy);s3.objects={k:list(v) for k,v in self.s3.objects.items()}
                body=b'body 1' if same else b'changed 1'
                meta=(self.host.paired/'1.json').read_bytes()
                if not same:
                    m=json.loads(meta);m['body_bytes']=len(body);m['body_sha256']=operator.hashlib.sha256(body).hexdigest()
                    meta=paired_tool.canonical(m).encode()
                batch=rebatch(9,{'1.body':body,'1.json':meta})
                index=json.loads(s3.objects['evidence/test1/index-1.json'][0])
                index.update(generation=9,kind='ordinary',batch=dict(key='evidence/test1/batch-9.tar',size=len(batch),
                             sha256=operator.hashlib.sha256(batch).hexdigest()),
                             ledger=dict(index['ledger'],key='evidence/test1/ledger-9.sqlite3'),
                             files=[dict(id=1,json_size=len(meta),json_sha256=operator.hashlib.sha256(meta).hexdigest(),
                                         body_size=len(body),body_sha256=operator.hashlib.sha256(body).hexdigest())])
                s3.objects['evidence/test1/batch-9.tar']=[batch]
                s3.objects['evidence/test1/ledger-9.sqlite3']=list(s3.objects['evidence/test1/ledger-1.sqlite3'])
                s3.objects['evidence/test1/index-9.json']=[json.dumps(index).encode()]
                report=self.audited(s3,name='same' if same else 'conflict')
                self.assertEqual(report['complete'],same,report)
                self.assertEqual(report['conflicts'],[] if same else [1])

    def test_failed_generations_and_tampered_objects_are_ignored_or_mismatched(self):
        self.host.attempt(1)
        self.s3.fail=lambda s,k:s=='index'
        self.run_copy()          # batch-1 and ledger-1 without an index: ignored
        self.s3.fail=None;self.host.unit=('inactive',STOPPED_AT);self.host.attempt(2)
        self.run_copy(final=True)
        report=self.audited()
        self.assertTrue(report['complete'],report)
        self.assertEqual(report['generations'],{'valid':1,'ignored':0,'incomplete':1})
        # A batch whose bytes do not match its index invalidates that generation: its
        # attempts are then missing, never pending.
        s3=FakeS3(self.copy);s3.objects={k:list(v) for k,v in self.s3.objects.items()}
        s3.objects['evidence/test1/batch-2.tar']=[s3.objects['evidence/test1/batch-2.tar'][0].replace(b'body 2',b'body X')]
        report=self.audited(s3,name='tampered')
        self.assertFalse(report['complete'])
        self.assertEqual(report['status'],'tail_unverified')

    def test_audit_order_pending_then_capture_failure_then_both_files(self):
        self.host.attempt(1)
        # A capture failure written with body fields is not a capture failure: files required.
        self.host.attempt(2,'capture-failure')
        with self.host.ledger.db:
            self.host.ledger.db.execute('UPDATE attempts SET result=? WHERE id=2',
                (paired_tool.canonical({'error':'deadline','captured':False,'body_bytes':0,'body_sha256':'0'*64,'elapsed_ms':1}),))
        self.host.attempt(3,'child-timeout',files=False)   # the child's own timeout: files required
        self.host.attempt(4,'pending')
        (self.host.paired/'4.body').write_bytes(b'partial')  # files of a pending attempt are not checked
        self.host.attempt(5)
        meta=json.loads((self.host.paired/'5.json').read_text());meta['status']=201
        (self.host.paired/'5.json').write_text(paired_tool.canonical(meta))   # metadata differs from the ledger result
        self.host.unit=('failed',STOPPED_AT)
        self.run_copy(final=True)
        report=self.audited()
        self.assertFalse(report['complete'])
        self.assertEqual((report['pending'],report['capture_failures'],report['missing_or_mismatched']),([4],[],[2,3,5]))

    def test_the_shared_attempt_check_is_the_ssh_evidence_check(self):
        identity=remote.ledger_identity({'candidate_sha256':'a'*64},dict(plan=dict(port=3000,artifacts={'paired_read.py':'b'*64})))
        self.assertEqual(identity,dict(manifest={'candidate_sha256':'a'*64},candidate='http://127.0.0.1:3000',
                                       production='https://todayweather.wizardfactory.net',loopback_test=False,sampler_sha256='b'*64))
        result={'status':200,'body_bytes':3,'body_sha256':'c'*64,'elapsed_ms':5}
        self.assertTrue(remote.attempt_matches(result,{'status':200,'body_bytes':3,'body_sha256':'c'*64},3,'c'*64))
        self.assertFalse(remote.attempt_matches(result,{'status':200,'body_bytes':3,'body_sha256':'c'*64},4,'c'*64))
        # An invalid timing field invalidates the evidence, as before (paired_evidence).
        with self.assertRaises(E):remote.attempt_matches(dict(result,elapsed_ms=True),{'status':200,'body_bytes':3,'body_sha256':'c'*64},3,'c'*64)


class EvidenceUnitTests(unittest.TestCase):
    """SR-5a: copy, timer and finalizer units; nothing on the shutdown path waits on them."""
    def units(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        launch=HostLoggingTests.launch(self,Path(temp.name))
        return launch,operator.host_units(launch)

    def test_copy_and_finalize_units_are_independent_oneshots(self):
        launch,units=self.units();name='server2-shadow-test1-';root='/opt/server2-shadow/test1'
        self.assertEqual(len(units),11)
        for unit,flag in (('copy.service',''),('finalize.service',' --final')):
            text=units[name+unit]
            for line in ('Type=oneshot','Restart=no','TimeoutStartSec=600','TimeoutStopSec=10','LogNamespace=server2',
                         'NoNewPrivileges=yes',f'ExecStart=/usr/bin/python3 -I {root}/bin/evidence_copy.py --launch {root}/launch.json{flag}'):
                self.assertIn('\n'+line+'\n',text,(unit,line))
            for other in ('candidate','guard','reader','logs','stop','poweroff'):
                self.assertNotIn(name+other+'.',text,(unit,other))
            self.assertNotIn('[Install]',text)
        timer=units[name+'copy.timer']
        for line in ('OnCalendar=hourly','Persistent=true','Unit='+name+'copy.service','WantedBy=timers.target'):
            self.assertIn('\n'+line+'\n',timer)

    def test_reader_stop_and_the_168_hour_stop_start_the_finalizer_without_waiting(self):
        _,units=self.units();name='server2-shadow-test1-'
        start='/usr/bin/systemctl start --no-block '+name+'finalize.service'
        self.assertIn('\nExecStopPost=-'+start+'\n',units[name+'reader.service'])
        stop=[l for l in units[name+'stop.service'].splitlines() if l.startswith('ExecStart=')]
        self.assertEqual(stop,['ExecStart=/usr/bin/systemctl --no-block stop '+name+'reader.service '+name+'candidate.service '+name+'guard.service',
                               'ExecStart=-'+start])
        # The poweroff and launch-expiry paths neither wait for nor depend on the copy units.
        for text in (units[name+'poweroff.service'],units[name+'poweroff.timer'],
                     *state.launch_expiry_units('test1',1000).values()):
            self.assertNotIn('copy',text);self.assertNotIn('finalize',text)
        for unit in ('candidate.service','guard.service'):self.assertNotIn('finalize',units[name+unit])

    def test_copy_units_are_shipped_as_the_copy_source(self):
        sources=operator.log_sources('test1')
        self.assertEqual(sources['server2-shadow-test1-copy.service'],'copy')
        self.assertEqual(sources['server2-shadow-test1-finalize.service'],'copy')
        _,units=self.units()
        self.assertIn('--unit server2-shadow-test1-copy.service=copy',units['server2-shadow-test1-logs.service'])

    def test_the_copy_program_is_a_pinned_host_artifact_everywhere(self):
        self.assertIn('evidence_copy.py',operator.HOST_ARTIFACTS)
        import ast,re as regex
        expected=ast.literal_eval(regex.search(r"expected=(\{[^}]*\})",remote.RECEIVER).group(1))
        self.assertEqual(expected,operator.HOST_ARTIFACTS|{'launch.json'})

    def test_install_arms_the_copy_timer_before_acquisition_and_publishes_the_contract_last(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source,launch=HostInstallTests.bundle(self,root);system=HostInstallTests.System()
            result=HostInstallTests.install(self,source,root,system)
            self.assertEqual(result['status'],'started')
            name='server2-shadow-test1-'
            starts=[c for c in system.calls if c[0]=='start']
            self.assertEqual(starts,[('start',name+'stop.timer',name+'poweroff.timer'),('start',name+'copy.timer'),
                ('start','--no-block',name+'logs.service'),('start',name+'candidate.service'),('start',name+'reader.service'),
                ('start','--no-block',name+'copy.service')])
            self.assertIn(('enable',name+'copy.timer'),system.calls)
            self.assertIn(('show','--property=ActiveState','--value',name+'copy.timer'),system.calls)
            self.assertEqual(operator.artifact_hash(root/'host/bin/evidence_copy.py'),launch['plan']['artifacts']['evidence_copy.py'])
        with tempfile.TemporaryDirectory() as temp:
            # The contract run is queued without waiting; its failure never stops acquisition.
            root=Path(temp);source,_=HostInstallTests.bundle(self,root)
            system=HostInstallTests.System(('start','--no-block','server2-shadow-test1-copy.service'))
            result=HostInstallTests.install(self,source,root,system)
            self.assertEqual(result['status'],'started');self.assertTrue(result['copy_start_failed'])


class EvidenceCostTests(unittest.TestCase):
    def test_copy_puts_and_five_log_sources_are_bounded_from_the_epoch(self):
        from decimal import Decimal as D
        policy=cost_policy();w=D(policy['rates']['s3_write'])
        base=lambda now:D(state.estimate_cost(dict(policy,rates=dict(policy['rates'],s3_write='0.000000001')),1000,now,cpu_seconds=0)['accrued_usd'])
        for hours in (1,24,168):
            now=1000+hours*3600
            puts=5*((hours*3600+49)//50)+4*hours+4*3
            accrued=D(state.estimate_cost(policy,1000,now,cpu_seconds=0)['accrued_usd'])
            self.assertAlmostEqual(accrued-base(now),puts*(w-D('0.000000001')),places=5)
        self.assertEqual(D(state.estimate_cost(policy,1000,1000,cpu_seconds=0)['accrued_usd']),D(0))


if __name__ == '__main__':
    unittest.main()
