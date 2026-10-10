"""Offline-only: every process/network adapter is replaced before invocation."""
import os
from pathlib import Path
assert os.environ.get('S09_ISOLATED') == '1' and not Path('/sys').exists(), 'use run_isolated.py; no host execution'
import contextlib
import io
import json
import subprocess
import sys
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
import ssm_startup_recovery as recovery
import aws_operator as operator

ROLE = 'server2-s09-benchmark-20261008'

class StartupGatingTests(unittest.TestCase):
    def exercise(self, tls=True, role_at=0, guard_until=10000):
        current = [0]
        events = []
        quotas = {'nftables':[{'quota':{'name':name,'bytes':cap,'used':1}}
            for name,cap in [('global_rx',30064771072),('bootstrap_rx',2147483648)]]}
        def run(argv, **kw):
            self.assertLessEqual(kw['timeout'], 15)
            if argv[0] == 'systemctl':
                if argv[1] == 'restart': events.append(('restart',current[0]))
                return subprocess.CompletedProcess(argv, 0 if current[0]<guard_until else 1)
            if argv[0] == 'nft':
                events.append(('guard',current[0]))
                return subprocess.CompletedProcess(argv,0,stdout=json.dumps(quotas).encode())
            if argv[0] == '/usr/bin/python3':
                if '169.254.169.254' in ' '.join(argv):
                    events.append(('imds',current[0]))
                    ready=current[0]>=role_at
                    return subprocess.CompletedProcess(argv,0,stdout=json.dumps({'info':{'Code':'Success'},'roles':[ROLE] if ready else []}).encode())
                events.append(('tls',current[0]))
                return subprocess.CompletedProcess(argv,0 if tls else 1)
            self.fail('unexpected adapter command')
        def sleep(seconds): current[0] += seconds
        output=io.StringIO()
        with tempfile.TemporaryDirectory() as directory, patch.object(recovery.time,'monotonic',lambda:current[0]), patch.object(recovery.time,'sleep',sleep), contextlib.redirect_stdout(output):
            private=Path(directory)
            (private/'readiness-context.json').write_text(json.dumps(dict(run_id='fixture',nonce='d'*64,source_revision='a'*40,key='e'*64)))
            code=recovery.main(['--unit',recovery.UNITS[0],'--role',ROLE,'--deadline-ms','10000000'],run=run,wall=lambda:current[0],private=private)
        return code,events,current[0],output.getvalue()

    def test_late_role_visibility_then_single_restart_leaves_admission_time(self):
        self.assertTrue(hasattr(recovery,'READINESS_SECONDS'),'bounded role readiness window missing')
        code,events,elapsed,output=self.exercise(role_at=160)
        self.assertEqual(code,1)
        restarts=[t for event,t in events if event=='restart']
        self.assertEqual(restarts,[160])
        self.assertGreaterEqual(elapsed-restarts[0],120)
        self.assertEqual(elapsed-restarts[0],recovery.ADMISSION_SECONDS)
        for index,(event,t) in enumerate(events):
            if event in ('imds','tls','restart'): self.assertEqual(events[index-1][0],'guard')
        self.assertIn('transport_and_role_ready',output)
        self.assertNotIn('authenticated',output)

    def test_admission_marker_after_slow_guard_cannot_cross_final_cap(self):
        current=[0]; events=[]; guards=[0]
        def guard():
            guards[0]+=1
            if guards[0]==3: current[0]=recovery.ADMISSION_SECONDS+1
        code=recovery.recover(guard,lambda:True,lambda:None,lambda:True,events.append,
            clock=lambda:current[0],sleep=lambda _:None)
        self.assertEqual(code,1)
        self.assertEqual(events[-1]['reason'],'admission_unconfirmed')

    def test_tls_failure_never_probes_imds_or_restarts(self):
        code,events,_,_=self.exercise(tls=False)
        self.assertEqual(code,1)
        self.assertFalse(any(e in ('imds','restart') for e,_ in events))

    def test_no_role_never_restarts_and_guard_loss_stops(self):
        code,events,elapsed,_=self.exercise(role_at=1000,guard_until=25)
        self.assertEqual(code,1)
        self.assertFalse(any(e=='restart' for e,_ in events))
        self.assertLessEqual(elapsed,25)

class ControllerWaitTests(unittest.TestCase):
    def make(self, roles_at=0, bad=False, remaining=2000000):
        from unittest.mock import Mock
        current=[operator.EXPIRY-3000000]
        start=current[0]
        state=Mock(data={'deadline_ms':start+remaining,'resources':{}})
        calls=[]
        role='arn:aws:iam::'+operator.FIXED['account']+':role/'+ROLE
        class Runner:
            def call(self,service,action,args):
                assert (service,action)==('iam','get-instance-profile')
                calls.append(current[0]-start)
                return {'InstanceProfile':{'Arn':'arn:aws:iam::'+operator.FIXED['account']+':instance-profile/'+ROLE,
                    'Tags':[{'Key':'RunId','Value':operator.FIXED['run_id']},{'Key':'Purpose','Value':'synthetic-benchmark-only'}],
                    'Roles':[{'RoleName':ROLE,'Arn':'wrong' if bad else role}] if current[0]-start>=roles_at else []}}
        controller=operator.Operator(dict(operator.FIXED),state,Runner(),clock=lambda:current[0])
        def sleep(seconds): current[0]+=int(seconds*1000)
        return controller,role,current,calls,sleep

    def test_profile_visible_early_still_waits_and_reads_back(self):
        self.assertTrue(hasattr(operator.Operator,'wait_profile_ready'),'bounded propagation wait missing')
        controller,role,current,calls,sleep=self.make()
        controller.wait_profile_ready(role,sleep=sleep)
        self.assertEqual(calls[0],0)
        self.assertGreaterEqual(calls[-1],60000)
        self.assertLessEqual(calls[-1],120000)
        self.assertEqual(controller.calls,len(calls))
        self.assertEqual(controller.ledger.used['reads'],len(calls))

    def test_late_profile_is_bounded_wrong_role_or_budget_denies(self):
        self.assertTrue(hasattr(operator.Operator,'wait_profile_ready'),'bounded propagation wait missing')
        for kwargs in ({'roles_at':70000},{'roles_at':200000},{'bad':True},{'remaining':1200000}):
            with self.subTest(kwargs=kwargs):
                controller,role,current,calls,sleep=self.make(**kwargs)
                if kwargs=={'roles_at':70000}: controller.wait_profile_ready(role,sleep=sleep)
                else:
                    with self.assertRaises(operator.OperatorError): controller.wait_profile_ready(role,sleep=sleep)
                self.assertLessEqual(len(calls),25)
                self.assertFalse(controller.state.data.get('launch_attempted',False))
        controller,role,current,calls,sleep=self.make()
        controller.calls=3500
        with self.assertRaises(operator.OperatorError): controller.wait_profile_ready(role,sleep=sleep)
        self.assertEqual(calls,[])

    def test_late_online_response_is_rejected_after_cap(self):
        from unittest.mock import Mock
        current=[operator.EXPIRY-3000000]
        state=Mock(data={'deadline_ms':operator.EXPIRY,'resources':{'instance':'i-ab'}})
        controller=operator.Operator(dict(operator.FIXED),state,Mock(),clock=lambda:current[0])
        controller.verify_host_root=lambda:None
        controller.open_https_after_guard=lambda _:None
        controller.capture_admission_diagnostics=lambda:None
        controller.verify_ssm_agent=lambda _:self.fail('late response admitted')
        from test_online_window import install_ready_fixture
        ready=install_ready_fixture(controller)
        def call(service,action,args):
            if action=='get-console-output': return ready
            current[0]+=operator.SSM_ONLINE_SECONDS*1000+1
            return {'InstanceInformationList':[{'PingStatus':'Online'}]}
        controller.call=call
        with patch.object(operator.time,'sleep',lambda _:None):
            with self.assertRaisesRegex(operator.OperatorError,'SSM Online unavailable'): controller.run_host()

    def test_online_window_allows_late_readiness_without_widening_expiry(self):
        from unittest.mock import Mock
        current=[operator.EXPIRY-3000000];start=current[0]
        state=Mock(data={'deadline_ms':start+2000000,'resources':{'instance':'i-ab'}})
        controller=operator.Operator(dict(operator.FIXED),state,Mock(),clock=lambda:current[0])
        controller.verify_host_root=lambda:None
        controller.open_https_after_guard=lambda _:None
        admitted=[]
        controller.verify_ssm_agent=lambda _:admitted.append(current[0]-start)
        from test_online_window import install_ready_fixture
        ready=install_ready_fixture(controller,ready_ms=start+150000,elapsed_ms=150000)
        console_calls=[0]
        def call(service,action,args):
            if action=='get-console-output':
                console_calls[0]+=1
                if console_calls[0]>1: current[0]=max(current[0],start+150000)
                return ready
            if action=='describe-instance-information':
                return {'InstanceInformationList':[{'InstanceId':'i-ab','PingStatus':'Online'}] if current[0]-start>=320000 else []}
            self.fail('unexpected control operation')
        controller.call=call
        controller.ssm=lambda *a,**k:(_ for _ in ()).throw(RuntimeError('stop before workload'))
        with patch.object(operator.time,'sleep',lambda seconds:current.__setitem__(0,current[0]+int(seconds*1000))):
            with self.assertRaisesRegex(RuntimeError,'stop before workload'): controller.run_host()
        self.assertEqual(admitted,[320000])

class ImdsChildTests(unittest.TestCase):
    def child(self, bodies=None, statuses=None):
        bodies = bodies or [b'TOKEN_SENTINEL', b'{"Code":"Success","Message":"PRIVATE_INFO"}', ROLE.encode()]
        statuses = statuses or [200,200,200]
        requests=[]
        class Connection:
            def __init__(self,host,port,timeout):
                assert (host,port,timeout)==('169.254.169.254',80,2)
            def request(self,method,path,headers):
                requests.append((method,path,dict(headers)))
            def getresponse(self):
                index=len(requests)-1
                class Response:
                    status=statuses[index]
                    def read(self,maximum):
                        assert maximum in (1025,4097)
                        return bodies[index][:maximum]
                return Response()
            def close(self): pass
        def run(argv, **kw):
            self.assertEqual(argv[:3],['/usr/bin/python3','-I','-c'])
            self.assertEqual(kw['timeout'],8)
            self.assertEqual(kw['stderr'],subprocess.DEVNULL)
            self.assertNotIn('TOKEN_SENTINEL',' '.join(argv))
            output=io.StringIO(); code=0
            with patch('http.client.HTTPConnection',Connection),patch.object(sys,'argv',['-c',ROLE]),contextlib.redirect_stdout(output):
                try: exec(compile(argv[3],'<isolated-imds-child>','exec'),{})
                except SystemExit as exc: code=exc.code
            text=output.getvalue()
            self.assertNotIn('TOKEN_SENTINEL',text)
            self.assertNotIn('PRIVATE_INFO',text)
            return subprocess.CompletedProcess(argv,code,stdout=text.encode())
        result=recovery.imds_ready(ROLE,run=run)
        return result,requests

    def test_actual_child_only_token_info_and_role_listing(self):
        result,requests=self.child()
        self.assertTrue(result)
        self.assertEqual([(m,p) for m,p,h in requests],[('PUT','/latest/api/token'),('GET','/latest/meta-data/iam/info'),('GET','/latest/meta-data/iam/security-credentials/')])
        for m,p,h in requests[1:]: self.assertEqual(h,{'X-aws-ec2-metadata-token':'TOKEN_SENTINEL'})

    def test_child_rejects_redirect_bad_json_and_overlarge_body(self):
        for bodies,statuses in [(None,[302]),([b'TOKEN_SENTINEL',b'bad'],[200,200]),([b'X'*1025],[200]),([b'TOKEN_SENTINEL',b'{"Code":"Success"}',b'other-role'],[200,200,200])]:
            with self.subTest(bodies=bodies,statuses=statuses): self.assertFalse(self.child(bodies,statuses)[0])

    def test_invalid_parent_output_timeout_and_role_fail_closed(self):
        for body in (b'[]',b'null',b'{}',b'bad',b'x'*1025,b'{"info":[],"roles":[]}'):
            self.assertFalse(recovery.imds_ready(ROLE,run=lambda *a,**k:subprocess.CompletedProcess([],0,stdout=body)))
        def timeout(*a,**k): raise subprocess.TimeoutExpired('private',8)
        self.assertFalse(recovery.imds_ready(ROLE,run=timeout))
        def forbidden(*a,**k): self.fail('wrong role dispatched')
        self.assertFalse(recovery.imds_ready('http://other',run=forbidden))
