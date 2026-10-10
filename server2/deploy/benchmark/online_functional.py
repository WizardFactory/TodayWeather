"""Real fake-CLI subprocesses, real host/controller protocol, virtual clocks.
Run only with run_isolated.py online-functional. Never live AWS evidence.
"""
import json, pathlib, tempfile
import aws_operator as op
import ssm_startup_recovery as host
from test_online_window import BASE, KEY, NONCE

FAKE='''#!/usr/bin/python3
import contextlib,io,json,pathlib,socket,subprocess,sys,time
root=pathlib.Path(__file__).parent
RealPath=pathlib.Path

def deny(event,args):
    if event in ('subprocess.Popen','os.system','os.exec','os.posix_spawn','socket.connect'):
        raise PermissionError('fake child escape denied')
sys.addaudithook(deny)
try: subprocess.run(['/usr/bin/true'],check=True)
except PermissionError: pass
else: raise AssertionError('child escaped')
args=sys.argv[1:]
mode=(root/'mode').read_text(); now=int((root/'clock').read_text()); base=int((root/'base').read_text())
action=next(x for x in args if x in ('get-console-output','describe-instance-information','send-command','get-command-invocation'))
with (root/'actions').open('a') as f:f.write(action+'\\n')
if action=='get-console-output':
    text=(root/'console').read_text() if mode!='missing' else ''
    if mode=='forged':
        lines=text.splitlines();record=json.loads(lines[-1].split(' ',1)[1]);record['mac']='0'*64
        text=lines[0]+'\\nS09_SSM_READY_V1 '+json.dumps(record)
    if mode=='duplicate':text+=text.splitlines()[-1]+'\\n'
    print(json.dumps({'InstanceId':'i-ab','Output':text}))
elif action=='describe-instance-information':
    if mode=='late-response' and now>=445000:(root/'clock').write_text('450000')
    print(json.dumps({'InstanceInformationList':[{'InstanceId':'i-ab','PingStatus':'Online','AgentVersion':'3.3.40.0'}] if now>=445000 else []}))
elif action=='send-command':
    value=json.loads(args[args.index('--parameters')+1]);assert len(value['commands'])==1
    command=value['commands'][0];assert command.startswith("python3 - <<'PY'\\n") and 'readiness.json' in command
    assert 'bootstrap.sh' not in command and 'systemctl' not in command
    (root/'command').write_text(command)
    print(json.dumps({'Command':{'CommandId':'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'}}))
else:
    command=(root/'command').read_text();code=command.split('\\n',1)[1].rsplit('\\nPY',1)[0]
    def private_path(value):
        assert value=='/opt/server2-s09/private'
        return root/'private'
    pathlib.Path=private_path;time.time=lambda:(base+now)/1000;time.monotonic=lambda:now/1000
    out=io.StringIO()
    with contextlib.redirect_stdout(out):exec(compile(code,'<actual-generated-handshake>','exec'),{})
    print(json.dumps({'Status':'Success','StandardOutputContent':out.getvalue()}))
'''

def smoke():
    outcomes=[]
    for mode in ('success-delayed-150-445','late-response','missing','forged','duplicate'):
        with tempfile.TemporaryDirectory(prefix='online-functional-') as directory:
            root=pathlib.Path(directory);private=root/'private';private.mkdir()
            (root/'fake-aws').write_text(FAKE);(root/'fake-aws').chmod(0o700)
            (root/'clock').write_text('0');(root/'base').write_text(str(BASE));(root/'mode').write_text(mode)
            def elapsed():return int((root/'clock').read_text())
            def settime(value):(root/'clock').write_text(str(value))
            config=dict(op.FIXED,source_revision='a'*40)
            state=op.State.create(root/'state.json',dict(resources={'instance':'i-ab'},nonce=NONCE,readiness_key=KEY,deadline_ms=BASE+1000000))
            controller=op.Operator(config,state,op.Cli(config,str(root/'fake-aws')),clock=lambda:BASE+elapsed())
            guard=dict(status='guarded',run_id=config['run_id'],nonce=NONCE,source_revision='a'*40,deadline_ms=BASE+1000000,timer_active=True,nft_active=True,ssm_present=True,observed_before_guard_bytes=0)
            def publish(record): (root/'console').write_text('S09_GUARD_V1 '+json.dumps(guard)+'\nS09_SSM_READY_V1 '+json.dumps(record)+'\n')
            session=host.ReadinessSession(dict(run_id=config['run_id'],nonce=NONCE,source_revision='a'*40,key=KEY),BASE+1000000,private,lambda:(BASE+elapsed())/1000,lambda:elapsed()/1000,publish)
            controller_result=[];restarts=[];records=[]
            def controller_sleep(seconds):settime(elapsed()+int(seconds*1000))
            def sleep(seconds):
                controller_sleep(seconds)
                if elapsed()>=155000 and not controller_result:
                    settime(250000) # Console delivery delayed 100s after actual readiness.
                    try:
                        controller.wait_online('i-ab',BASE,sleep=controller_sleep)
                        controller.admit_online()
                        controller_result.append('accepted')
                    except op.OperatorError as error:controller_result.append(str(error))
            result=host.recover(lambda:None,lambda:elapsed()>=150000,lambda:restarts.append(elapsed()),
                session.admitted,records.append,clock=lambda:elapsed()/1000,sleep=sleep,on_ready=session.ready)
            assert restarts==[150000]
            assert result==(0 if mode=='success-delayed-150-445' else 1)
            actions=(root/'actions').read_text().splitlines()
            if result==0:
                assert elapsed()==445000 and controller_result==['accepted']
                assert state.data['ssm_online_deadline_ms']==BASE+450000
                assert actions[-2:]==['send-command','get-command-invocation']
            else:
                assert 'send-command' not in actions and 'get-command-invocation' not in actions
            assert state.data['operator_calls']==len(actions)
            assert state.data['ledger']['reads']==len(actions)
            assert not state.data.get('worker_allocation_issued',False)
            outcomes.append(dict(scenario=mode,status='PASS_fake_only',virtual_elapsed_ms=elapsed(),
                readiness_ms=150000,online_deadline_ms=state.data.get('ssm_online_deadline_ms'),
                host_result=result,controller_result=controller_result,real_fake_cli_processes=len(actions),
                real_AWS_calls=0,real_service_operations=0,build_dispatches=0))
    return outcomes
