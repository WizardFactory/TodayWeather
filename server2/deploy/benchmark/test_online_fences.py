"""Admission proof/clock negatives; OS sandbox mandatory even for parser tests."""
import os
from pathlib import Path
assert os.environ.get('S09_ISOLATED') == '1' and not Path('/sys').exists(), 'use run_isolated.py; no host execution'
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import aws_operator as op
import ssm_startup_recovery as host
from test_online_window import BASE, KEY, NONCE, envelope, console
import test_online_window as fixtures

class ConsoleFences(unittest.TestCase):
    def rejected(self, text, pattern='readiness', host_id='i-ab', at=150000):
        c,now,calls,sleep=fixtures.ControllerWindowTests().make()
        now[0]=BASE+at
        c.call=lambda *args,**kwargs:{'InstanceId':host_id,'Output':text}
        c.capture_admission_diagnostics=lambda:None
        with self.assertRaisesRegex(op.OperatorError,pattern): c.wait_online('i-ab',BASE,sleep=sleep)
        self.assertNotIn('ssm_online_deadline_ms',c.state.data)

    def test_missing_marker_is_bounded_and_does_not_poll_online(self):
        c,now,calls,sleep=fixtures.ControllerWindowTests().make(delivered_at=999999)
        with self.assertRaisesRegex(op.OperatorError,'readiness unavailable'): c.wait_online('i-ab',BASE,sleep=sleep)
        self.assertEqual(now[0],BASE+480000)
        self.assertEqual(len(calls),96)
        self.assertTrue(all(action=='get-console-output' for action,at in calls))

    def test_duplicates_out_of_order_and_wrong_console_host_deny(self):
        text=console(envelope())
        self.rejected(text+text.splitlines()[1]+'\n','duplicate')
        self.rejected('\n'.join(reversed(text.splitlines())),'out-of-order')
        self.rejected(text,'host mismatch',host_id='i-dead')

    def test_stale_forged_malformed_and_wrong_role_records_deny(self):
        for record in (envelope(nonce='f'*64),envelope(run_id='old'),envelope(role='other'),
                       dict(envelope(),mac='0'*64),dict(envelope(),extra=True)):
            with self.subTest(record=record): self.rejected(console(record))
        self.rejected(console(envelope()).split('S09_SSM_READY_V1 ')[0]+'S09_SSM_READY_V1 {bad')

    def test_future_readiness_over_cap_wall_jump_and_bad_types_deny(self):
        for record in (envelope(BASE+150001),envelope(BASE+180000),
                       envelope(started_at_ms=BASE-2000),envelope(readiness_elapsed_ms=True),
                       envelope(ready_monotonic_ms=-1),envelope(BASE-1)):
            with self.subTest(record=record): self.rejected(console(record))

    def test_online_at_boundary_or_late_never_admitted(self):
        for online in (450000,455000):
            c,now,calls,sleep=fixtures.ControllerWindowTests().make(online_at=online)
            c.capture_admission_diagnostics=lambda:None
            with self.assertRaisesRegex(op.OperatorError,'Online unavailable'): c.wait_online('i-ab',BASE,sleep=sleep)
            self.assertEqual(now[0],BASE+450000)
            self.assertNotIn('stock_SSM_agent_version',c.state.data)

    def test_late_console_delivery_does_not_grant_new_time(self):
        c,now,calls,sleep=fixtures.ControllerWindowTests().make(delivered_at=450000)
        c.capture_admission_diagnostics=lambda:None
        with self.assertRaisesRegex(op.OperatorError,'Online unavailable'): c.wait_online('i-ab',BASE,sleep=sleep)
        self.assertFalse(any(action=='describe-instance-information' for action,at in calls))

    def test_late_online_response_and_backward_controller_clock_deny(self):
        for late in (True,False):
            c,now,calls,sleep=fixtures.ControllerWindowTests().make(online_at=150000)
            original=c.call
            def call(service,action,args):
                result=original(service,action,args)
                if action=='describe-instance-information': now[0]=BASE+450000 if late else BASE-1
                return result
            c.call=call;c.capture_admission_diagnostics=lambda:None
            with self.assertRaises(op.OperatorError): c.wait_online('i-ab',BASE,sleep=sleep)
            self.assertNotIn('stock_SSM_agent_version',c.state.data)

    def test_hard_expiry_clips_window(self):
        c,now,calls,sleep=fixtures.ControllerWindowTests().make(online_at=445000)
        c.state.data['deadline_ms']=BASE+200000
        original=c.call
        def call(service,action,args):
            result=original(service,action,args)
            if action=='get-console-output' and result['Output']:
                from test_online_window import install_ready_fixture
                result=install_ready_fixture(c,BASE+150000,150000)
            return result
        c.call=call;c.capture_admission_diagnostics=lambda:None
        with self.assertRaisesRegex(op.OperatorError,'Online unavailable'): c.wait_online('i-ab',BASE,sleep=sleep)
        self.assertEqual(now[0],BASE+200000)
        self.assertEqual(c.state.data['ssm_online_deadline_ms'],BASE+200000)

class HostFences(unittest.TestCase):
    def test_delayed_publication_cannot_restart_after_readiness_cap(self):
        now=[0]; events=[]
        def on_ready(elapsed): now[0]=181
        result=host.recover(lambda:None,lambda:True,lambda:events.append('restart'),
            lambda:True,events.append,clock=lambda:now[0],sleep=lambda _:None,on_ready=on_ready)
        self.assertEqual(result,1)
        self.assertNotIn('restart',events)

    def test_private_marker_rejects_wall_skew_and_monotonic_expiry(self):
        for age,skew in ((300,0),(301,0),(10,-2),(10,2),(-1,0)):
            with self.subTest(age=age,skew=skew),tempfile.TemporaryDirectory() as directory:
                private=Path(directory); now=[BASE/1000]; mono=[0]
                session=host.ReadinessSession(dict(run_id='r',nonce=NONCE,source_revision='a'*40,key=KEY),
                    BASE+1000000,private,lambda:now[0],lambda:mono[0],lambda _:None)
                session.ready(0)
                (private/'controller-start').write_text(session.record['mac'])
                mono[0]=age;now[0]+=age+skew
                self.assertFalse(session.admitted(),'host marker accepted outside clock/window contract')

    def test_main_stamps_readiness_before_local_publication_io(self):
        import subprocess
        now=[0]; output=io.StringIO()
        quotas={'nftables':[{'quota':{'name':name,'bytes':cap,'used':1}} for name,cap in [('global_rx',30064771072),('bootstrap_rx',2147483648)]]}
        def run(argv,**kwargs):
            if argv[0]=='nft': return subprocess.CompletedProcess(argv,0,stdout=json.dumps(quotas).encode())
            if argv[0]=='systemctl': return subprocess.CompletedProcess(argv,0)
            if argv[0]=='/usr/bin/python3':
                now[0]=max(now[0],150)
                return subprocess.CompletedProcess(argv,0,stdout=json.dumps({'info':{'Code':'Success'},'roles':[host.ROLE]}).encode())
            self.fail('unexpected command')
        with tempfile.TemporaryDirectory() as directory:
            private=Path(directory)
            (private/'readiness-context.json').write_text(json.dumps(dict(run_id='r',nonce=NONCE,source_revision='a'*40,key=KEY)))
            original=Path.read_text
            def read(path,*args,**kwargs):
                if path.name=='readiness-context.json': now[0]+=20
                return original(path,*args,**kwargs)
            def sleep(seconds):
                now[0]+=seconds
                if now[0]>=445 and (private/'readiness.json').exists():
                    record=json.loads(original(private/'readiness.json'))
                    (private/'controller-start').write_text(record['mac'])
            with patch.object(Path,'read_text',read),patch.object(host.time,'monotonic',lambda:now[0]),patch.object(host.time,'sleep',sleep),contextlib.redirect_stdout(output):
                result=host.main(['--unit',host.UNITS[0],'--role',host.ROLE,'--deadline-ms',str(BASE+1000000)],run=run,wall=lambda:BASE/1000+now[0],private=private)
            self.assertEqual(result,0,'local marker publication moved the readiness instant')
            record=json.loads((private/'readiness.json').read_text())
            self.assertEqual(record['proof']['ready_at_ms'],BASE+150000)
            self.assertEqual(record['proof']['ready_monotonic_ms'],150000)
            self.assertEqual((private/'controller-admitted').read_text(),record['mac'])

class HandshakeFences(unittest.TestCase):
    def test_actual_handshake_python_rejects_remote_late_and_clock_skew(self):
        # Execute the actual generated Python, never shell or systemd. All paths
        # resolve to private sandbox scratch; clocks are deterministic.
        for age,skew,accepted in ((299999,0,True),(300000,0,False),(300001,0,False),(10000,2000,False),(10000,-2000,False)):
            with self.subTest(age=age,skew=skew),tempfile.TemporaryDirectory() as directory:
                private=Path(directory); record=envelope(); (private/'readiness.json').write_text(json.dumps(record))
                c,now,calls,sleep=fixtures.ControllerWindowTests().make()
                now[0]=BASE+150000+min(age,299999)
                c.state.data.update(ssm_online_deadline_ms=BASE+450000,ssm_readiness_mac=record['mac'])
                def ssm(commands,**kwargs):
                    code=commands[0].split("\n",1)[1].rsplit('\nPY',1)[0]
                    output=io.StringIO()
                    def path(value):
                        self.assertEqual(value,'/opt/server2-s09/private');return private
                    with patch('pathlib.Path',path),patch.object(host.time,'monotonic',lambda:(150000+age)/1000),patch.object(host.time,'time',lambda:(BASE+150000+age+skew)/1000),contextlib.redirect_stdout(output):
                        exec(compile(code,'<actual-admission-script>','exec'),{})
                    return output.getvalue()
                c.ssm=ssm
                if accepted:
                    c.admit_online(); self.assertEqual((private/'controller-start').read_text(),record['mac'])
                else:
                    with self.assertRaises((AssertionError,op.OperatorError)): c.admit_online()
                    self.assertFalse((private/'controller-start').exists())

    def test_slow_handshake_response_is_not_admission(self):
        c,now,calls,sleep=fixtures.ControllerWindowTests().make()
        now[0]=BASE+445000
        c.state.data.update(ssm_online_deadline_ms=BASE+450000,ssm_readiness_mac=envelope()['mac'])
        def ssm(*args,**kwargs):
            now[0]=BASE+450000
            return json.dumps({'host_age_ms':295000,'host_wall_ms':BASE+445000})
        c.ssm=ssm
        with self.assertRaisesRegex(op.OperatorError,'admission expired'): c.admit_online()

    def test_build_requires_host_ack_separate_from_online_and_marker_request(self):
        for acknowledged in (False,True):
            with self.subTest(acknowledged=acknowledged):
                c,now,calls,sleep=fixtures.ControllerWindowTests().make()
                c.verify_host_root=lambda:None;c.open_https_after_guard=lambda _:None
                c.config['source_files'] = {'server2/deploy/benchmark/bootstrap_diagnostics.py': op.digest((op.HERE/'bootstrap_diagnostics.py').read_bytes())}
                original=c.call;first=[True];dispatch=[]
                def call(service,action,args):
                    if first[0]:
                        first[0]=False
                        return {'InstanceId':'i-ab','Output':console(envelope()).split('S09_SSM_READY')[0]}
                    return original(service,action,args)
                c.call=call
                def ssm(commands,**kwargs):
                    text='\n'.join(commands);dispatch.append(text)
                    if len(dispatch)==1:
                        self.assertIn('readiness.json',text)
                        return json.dumps({'host_age_ms':295000,'host_wall_ms':BASE+445000})
                    if len(dispatch)==2:
                        self.assertIn('controller-admitted',text)
                        self.assertIn('until test -f',text)
                        self.assertNotIn('timeout 2100',text)
                        if not acknowledged: raise op.OperatorError('fake missing host acknowledgement')
                        return ''
                    self.assertIn('timeout -k 2 2070',text)
                    self.assertEqual(kwargs, {'seconds': 2100, 'bootstrap': True})
                    self.assertNotIn(': >',text)
                    raise RuntimeError('offline stop before build execution')
                c.ssm=ssm
                with patch.object(op.time,'sleep',sleep):
                    if acknowledged:
                        with self.assertRaisesRegex(RuntimeError,'offline stop before build'): c.run_host()
                    else:
                        with self.assertRaisesRegex(op.OperatorError,'missing host acknowledgement'): c.run_host()
                self.assertEqual(len(dispatch),3 if acknowledged else 2)
                self.assertNotIn('worker_allocation_issued',c.state.data)

if __name__=='__main__': unittest.main()
