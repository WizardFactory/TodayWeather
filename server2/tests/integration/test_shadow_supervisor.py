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

    def test_run_request_budget_rejects_a_second_grant_above_ninety_thousand(self):
        with self.create() as j:
            j.reserve_generation('initial', self.allocation(reads=90000,writes=90000), now=1000)
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
    return dict(schema=1,observed_at=900,prices_sha256='d'*64,rates={
        'ec2_hour':'0.026','ipv4_hour':'0.005','gp3_gb_month':'0.0912',
        's3_gb_month':'0.025','s3_read':'0.00000035','s3_write':'0.0000045',
        'cpu_vcpu_hour':'0.05','outbound_gb':'0.126'})


class CostTests(unittest.TestCase):
    def test_idle_seven_days_fit_but_busy_cpu_hits_accrued_stop(self):
        result=state.estimate_cost(cost_policy(),1000,1000+168*3600,cpu_seconds=60)
        self.assertFalse(result['stop'])
        self.assertLess(float(result['accrued_upper_usd']),28)
        self.assertLess(float(result['projected_upper_usd']),35)
        busy=state.estimate_cost(cost_policy(),1000,1000+168*3600,cpu_seconds=2*168*3600)
        self.assertEqual(busy['stop'],'aws_accrued_cost')

    def test_log_object_puts_are_priced(self):
        from decimal import Decimal
        free=cost_policy();free['rates']['s3_write']='0.000000001'
        with_puts=Decimal(state.estimate_cost(cost_policy(),1000,1000,cpu_seconds=0)['accrued_upper_usd'])
        without=Decimal(state.estimate_cost(free,1000,1000,cpu_seconds=0)['accrued_upper_usd'])
        self.assertEqual(state.LOG_WRITES,50_000)
        self.assertGreaterEqual(state.LOG_WRITES,4*72*170)
        self.assertAlmostEqual(float(with_puts-without),150_000*(0.0000045-0.000000001),places=6)

    def test_unknown_price_or_high_projected_cost_cannot_continue(self):
        missing=cost_policy();del missing['rates']['outbound_gb']
        with self.assertRaises(E):state.estimate_cost(missing,1000,1001,cpu_seconds=0)
        high=cost_policy();high['rates']['ec2_hour']='1'
        self.assertEqual(state.estimate_cost(high,1000,1001,cpu_seconds=0)['stop'],'aws_projected_cost')
        for bad in ('NaN','Infinity','-1','',True,0.1):
            invalid=cost_policy();invalid['rates']['ec2_hour']=bad
            with self.assertRaises(E):state.estimate_cost(invalid,1000,1001,cpu_seconds=0)


def host_manifest():
    return dict(schema=2,run_id='fixture',generation='initial',epoch=1000,pid=123,
                start_ticks=42,boot_id='11111111-1111-1111-1111-111111111111',
                binary_sha256='a'*64,environment_sha256='b'*64,config_sha256='c'*64,
                config_directory='/opt/server2-shadow/fixture/config',port=3000,metrics_port=3001,
                tx_origin=500,interface='ens5',data_directory='/opt/server2-shadow/fixture/data',
                cgroup='/system.slice/server2-shadow-fixture-candidate.service',
                allowance=dict(reads=100,writes=100,put_bytes=1000),cost_policy=cost_policy())


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
                ('tx_bytes',500+4*guard.GiB-128*1024**2,'network_ceiling'),
                ('free_bytes',6*guard.GiB-1,'disk_reserve')]:
            s=host_sample();s[field]=value
            self.assertEqual(guard.evaluate(m,s,None,1001)['stop'],reason)
        s=host_sample();s['free_bytes']=6*guard.GiB
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
        for key in ('s3_reads','s3_writes','s3_put_bytes'):
            s=host_sample();s['metrics'][key]=0
            self.assertEqual(guard.evaluate(m,s,None,1001)['stop'],'s3_allowance')
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
               ('tx_bytes',500+4*guard.GiB,'network_ceiling'),('tx_bytes',499,'network_counter_reset'),
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

    def test_actual_cpu_sample_cost_and_rollback_stop_the_guard(self):
        self.assertEqual(guard.host_cpu_seconds('cpu 100 10 30 500 40 2 3 5 80 5\n',100),2)
        m=host_manifest();sample=host_sample(m);now=m['epoch']+167*3600
        sample['observed_at']=now;sample['cpu_seconds']=2*167*3600
        self.assertEqual(guard.evaluate(m,sample,None,now)['stop'],'aws_accrued_cost')
        m['cost_policy']['rates']['ec2_hour']='1'
        self.assertEqual(guard.evaluate(m,host_sample(m),None,1001)['stop'],'aws_projected_cost')
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
    def test_whole_run_including_restarts_costs_at_most_five_dollars(self):
        policy=paid_policy()
        self.assertEqual(state.validate_paid_policy(policy,1000),'5.000')
        policy['grants']['restart-2']['google_air']+=1
        with self.assertRaisesRegex(E,'budget'):state.validate_paid_policy(policy,1000)

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
            self.assertEqual(len(units),8)
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
            self.assertEqual(len(list((root/'units').iterdir())),8)
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
            mapping=' '.join(['--unit '+name+'candidate.service=server','--unit '+name+'guard.service=guard',
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
                ('start','--no-block','server2-shadow-test1-logs.service'),
                ('start','server2-shadow-test1-candidate.service'),('start','server2-shadow-test1-reader.service')])
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
            self.assertEqual(system.calls[-1],('show','--property=ActiveState','--value','server2-shadow-test1-reader.service'))

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


if __name__ == '__main__':
    unittest.main()
