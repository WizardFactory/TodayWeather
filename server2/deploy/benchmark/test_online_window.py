"""Virtual-clock tests: run only through the namespace/audit sandbox."""
import os
from pathlib import Path
assert os.environ.get('S09_ISOLATED') == '1' and not Path('/sys').exists(), 'use run_isolated.py; no host execution'
import unittest
import ssm_startup_recovery as host

class HostWindowTests(unittest.TestCase):
    def test_readiness_at_150_gets_full_300_not_entry_360(self):
        now=[0]; events=[]
        def sleep(seconds): now[0]+=seconds
        result=host.recover(lambda:None,lambda:now[0]>=150,lambda:None,
            lambda:now[0]>=445,events.append,clock=lambda:now[0],sleep=sleep)
        self.assertEqual(result,0,'host cut off admission before readiness+300')
        self.assertEqual(now[0],445)
        self.assertEqual(events[-1]['status'],'admitted')

class HostBoundaryTests(unittest.TestCase):
    def test_slow_marker_read_cannot_admit_at_or_after_300(self):
        for late in (300,301):
            now=[0]; events=[]
            def admitted(): now[0]=late; return True
            result=host.recover(lambda:None,lambda:True,lambda:None,admitted,
                events.append,clock=lambda:now[0],sleep=lambda _:None)
            self.assertEqual(result,1,'late marker read admitted')

    def test_ready_event_precedes_restart_and_binds_actual_completion(self):
        now=[0]; observed=[]
        def probe(): now[0]=150; return True
        def restart(): observed.append(('restart',now[0])); now[0]+=15
        try:
            result=host.recover(lambda:None,probe,restart,lambda:True,
                lambda _:None,clock=lambda:now[0],sleep=lambda _:None,
                on_ready=lambda elapsed:observed.append(('ready',elapsed)))
        except TypeError:
            self.fail('no host readiness publication hook')
        self.assertEqual(result,0)
        self.assertEqual(observed,[('ready',150),('restart',150)])

import hashlib, hmac, json
from unittest.mock import Mock, patch
import aws_operator as op

KEY='e'*64
NONCE='d'*64
BASE=op.EXPIRY-3000000

def envelope(ready_ms=BASE+150000, **changes):
    proof=dict(schema=1,run_id=op.FIXED['run_id'],nonce=NONCE,
        source_revision='a'*40,deadline_ms=BASE+1000000,role=host.ROLE,
        started_at_ms=BASE,ready_at_ms=ready_ms,readiness_elapsed_ms=ready_ms-BASE,
        ready_monotonic_ms=ready_ms-BASE,status='transport_and_role_ready')
    proof.update(changes)
    return dict(proof=proof,mac=hmac.new(bytes.fromhex(KEY),op.canonical(proof),hashlib.sha256).hexdigest())

def console(record):
    guard=dict(status='guarded',run_id=op.FIXED['run_id'],nonce=NONCE,
        source_revision='a'*40,deadline_ms=BASE+1000000,timer_active=True,
        nft_active=True,ssm_present=True,observed_before_guard_bytes=0)
    return 'S09_GUARD_V1 '+json.dumps(guard)+'\nS09_SSM_READY_V1 '+json.dumps(record)+'\n'

def install_ready_fixture(controller, ready_ms=None, elapsed_ms=0):
    """Supply real signed console input; do not bypass production admission."""
    s,c=controller.state.data,controller.config
    s.setdefault('nonce',NONCE); s.setdefault('readiness_key',KEY)
    c.setdefault('source_revision','a'*40)
    ready_ms=controller.clock() if ready_ms is None else ready_ms
    proof=envelope(ready_ms,run_id=c['run_id'],nonce=s['nonce'],source_revision=c['source_revision'],
        deadline_ms=s['deadline_ms'],started_at_ms=ready_ms-elapsed_ms,
        readiness_elapsed_ms=elapsed_ms,ready_monotonic_ms=elapsed_ms)['proof']
    record={'proof':proof,'mac':hmac.new(bytes.fromhex(s['readiness_key']),op.canonical(proof),hashlib.sha256).hexdigest()}
    guard=dict(status='guarded',run_id=c['run_id'],nonce=s['nonce'],source_revision=c['source_revision'],
        deadline_ms=s['deadline_ms'],timer_active=True,nft_active=True,ssm_present=True,observed_before_guard_bytes=0)
    return {'InstanceId':s['resources']['instance'],'Output':'S09_GUARD_V1 '+json.dumps(guard)+'\nS09_SSM_READY_V1 '+json.dumps(record)+'\n'}

class ControllerWindowTests(unittest.TestCase):
    def make(self, ready_at=150000, delivered_at=150000, online_at=445000):
        now=[BASE]; calls=[]
        state=Mock(data=dict(resources={'instance':'i-ab'},deadline_ms=BASE+1000000,
            nonce=NONCE,readiness_key=KEY))
        c=op.Operator(dict(op.FIXED,source_revision='a'*40),state,Mock(),clock=lambda:now[0])
        def call(service,action,args):
            calls.append((action,now[0]-BASE))
            if action=='get-console-output':
                return {'InstanceId':'i-ab','Output':console(envelope(BASE+ready_at)) if now[0]-BASE>=delivered_at else ''}
            if action=='describe-instance-information':
                return {'InstanceInformationList':[{'InstanceId':'i-ab','PingStatus':'Online','AgentVersion':'3.3.40.0'}] if now[0]-BASE>=online_at else []}
            self.fail('unexpected dispatch before admission')
        c.call=call
        def sleep(seconds): now[0]+=int(seconds*1000)
        return c,now,calls,sleep

    def test_delayed_ready_record_does_not_reset_actual_300_window(self):
        c,now,calls,sleep=self.make(delivered_at=250000)
        self.assertTrue(hasattr(c,'wait_online'),'verified readiness admission protocol missing')
        proof=c.wait_online('i-ab',BASE,sleep=sleep)
        self.assertEqual(now[0],BASE+445000)
        self.assertEqual(proof['ready_at_ms'],BASE+150000)
        self.assertEqual(c.state.data['ssm_online_deadline_ms'],BASE+450000)
        self.assertTrue(all(at>=250000 for action,at in calls if action=='describe-instance-information'))

class ProtocolTests(unittest.TestCase):
    def cached_controller(self):
        c,now,calls,sleep=ControllerWindowTests().make(delivered_at=250000)
        proof=json.loads(console(envelope()).splitlines()[0].split(' ',1)[1])
        c.state.data.update(guard_proof=proof,guard_proof_sha256=op.digest(op.canonical(proof)),
            guard_proof_instance_id='i-ab',guard_verified_at_ms=BASE)
        original=c.call
        def call(service,action,args):
            result=original(service,action,args)
            if action=='get-console-output':
                result['Output']='\n'.join(line for line in result['Output'].splitlines()
                    if not line.startswith('S09_GUARD_V1 '))
            return result
        c.call=call
        return c,now,calls,sleep

    def test_verified_guard_scrollout_preserves_signed_readiness_window(self):
        c,now,calls,sleep=self.cached_controller()
        proof=c.wait_online('i-ab',BASE,sleep=sleep)
        self.assertEqual(proof['ready_at_ms'],BASE+150000)
        self.assertEqual(now[0],BASE+445000)
        self.assertEqual(c.state.data['ssm_online_deadline_ms'],BASE+450000)

    def test_scrollout_never_accepts_missing_foreign_or_tampered_guard_cache(self):
        for fault in ('missing','instance','hash','nonce','source','deadline','time'):
            with self.subTest(fault=fault):
                c,now,calls,sleep=self.cached_controller()
                if fault=='missing': c.state.data.pop('guard_proof')
                elif fault=='instance': c.state.data['guard_proof_instance_id']='i-foreign'
                elif fault=='hash': c.state.data['guard_proof_sha256']='0'*64
                elif fault=='time': c.state.data['guard_verified_at_ms']=BASE+500000
                else:
                    field={'source':'source_revision','deadline':'deadline_ms'}.get(fault,fault)
                    c.state.data['guard_proof'][field]='foreign'
                    c.state.data['guard_proof_sha256']=op.digest(op.canonical(c.state.data['guard_proof']))
                with self.assertRaises(op.OperatorError): c.wait_online('i-ab',BASE,sleep=sleep)
                self.assertFalse(any(action=='describe-instance-information' for action,_ in calls))

    def test_latest_failure_or_invalid_guard_cannot_use_cached_success(self):
        for marker in ('S09_GUARD_FAILED','S09_GUARD_V1 {bad json}'):
            with self.subTest(marker=marker):
                c,now,calls,sleep=self.cached_controller(); original=c.call
                def call(service,action,args):
                    result=original(service,action,args)
                    if action=='get-console-output' and result['Output']:
                        result['Output']=marker+'\n'+result['Output']
                    return result
                c.call=call
                with self.assertRaises(op.OperatorError): c.wait_online('i-ab',BASE,sleep=sleep)
                self.assertFalse(any(action=='describe-instance-information' for action,_ in calls))

    def test_host_publication_signs_exact_completion_and_private_record(self):
        import tempfile
        from pathlib import Path
        self.assertTrue(hasattr(host,'ReadinessSession'),'host verified marker publisher missing')
        with tempfile.TemporaryDirectory() as directory:
            now=[BASE/1000]; mono=[0]; records=[]
            identity=dict(run_id=op.FIXED['run_id'],nonce=NONCE,source_revision='a'*40,key=KEY)
            session=host.ReadinessSession(identity,BASE+1000000,Path(directory),
                wall=lambda:now[0],clock=lambda:mono[0],emit=records.append)
            now[0]+=150; mono[0]=150
            session.ready(150)
            self.assertEqual(records,[envelope()])
            self.assertEqual(json.loads((Path(directory)/'readiness.json').read_text()),records[0])
            self.assertNotIn(KEY,json.dumps(records))
            self.assertFalse(session.admitted())
            (Path(directory)/'controller-start').write_text(records[0]['mac'])
            self.assertTrue(session.admitted())

    def test_controller_run_requires_marker_and_never_uses_guard_fallback(self):
        c,now,calls,sleep=ControllerWindowTests().make(delivered_at=150000)
        c.verify_host_root=lambda:None
        c.open_https_after_guard=lambda _:None
        original=c.call
        first=[True]; dispatch=[]
        def call(service,action,args):
            if first[0]:
                first[0]=False
                return {'InstanceId':'i-ab','Output':console(envelope()).split('S09_SSM_READY')[0]}
            return original(service,action,args)
        c.call=call
        def ssm(commands,**kwargs):
            dispatch.append((now[0]-BASE,commands))
            raise RuntimeError('offline stop at admission handshake')
        c.ssm=ssm
        with patch.object(op.time,'sleep',sleep):
            try:
                with self.assertRaisesRegex(RuntimeError,'offline stop'): c.run_host()
            except op.OperatorError as error:
                self.fail('guard-relative cutoff instead of readiness admission: '+str(error))
        self.assertEqual(c.state.data.get('ssm_online_deadline_ms'),BASE+450000)
        self.assertIn('readiness.json',' '.join(dispatch[0][1]))
        self.assertNotIn('bootstrap.sh',' '.join(dispatch[0][1]))

class TemplateTests(unittest.TestCase):
    def test_bound_private_context_and_total_supervisor_budget(self):
        from pathlib import Path
        root=Path(op.__file__).parent
        base=(root/'cloud-init.yml').read_text()
        derived=base
        self.assertIn('readiness-context.json',derived)
        self.assertIn('@@READINESS_KEY@@',derived)
        self.assertIn('timeout -k 2 510 ',derived)
        self.assertEqual(base.split('      # Wait for controller',1)[1],derived.split('      # Wait for controller',1)[1])

if __name__=='__main__': unittest.main()
