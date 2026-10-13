"""Fake-process smoke, allowed only by the outer bubblewrap/audit harness."""
import contextlib, io, json, pathlib, subprocess, sys, tempfile
from unittest.mock import patch
import ssm_startup_recovery as recovery

FAKE = '''#!/usr/bin/python3
import http.client, json, socket, ssl, sys, subprocess
def deny_process(event,args):
    if event in ('subprocess.Popen','os.system','os.exec','os.posix_spawn','socket.connect'):
        raise PermissionError('fake child escape denied')
sys.addaudithook(deny_process)
try: subprocess.run(['/usr/bin/true'],check=True)
except PermissionError: pass
else: raise AssertionError('child command escape')
mode, elapsed, script = sys.argv[1:4]
elapsed=int(elapsed)
role='server2-s09-benchmark-20261008'
requests=[]
class Connection:
    def __init__(self,host,port,timeout):
        assert (host,port,timeout)==('169.254.169.254',80,2)
    def request(self,method,path,headers):
        assert (method,path) in [('PUT','/latest/api/token'),('GET','/latest/meta-data/iam/info'),('GET','/latest/meta-data/iam/security-credentials/')]
        requests.append(path)
        if method=='GET': assert headers=={'X-aws-ec2-metadata-token':'FAKE_PRIVATE_TOKEN'}
    def getresponse(self):
        path=requests[-1]
        body=(b'FAKE_PRIVATE_TOKEN' if path.endswith('token') else
              json.dumps({'Code':'Failure' if mode=='info-failure' else 'Success'}).encode() if path.endswith('info') else
              role.encode() if elapsed>=160 and mode!='role-missing' else b'')
        class Response:
            status=200
            def read(self,maximum): return body[:maximum]
        return Response()
    def close(self): pass
class Socket:
    def __enter__(self): return self
    def __exit__(self,*args): pass
class Context:
    def wrap_socket(self,raw,server_hostname):
        assert server_hostname in ('ssm.ap-northeast-2.amazonaws.com','ssmmessages.ap-northeast-2.amazonaws.com')
        return Socket()
def connect(address,timeout):
    assert address[1]==443 and timeout==3
    if mode=='tls-failure': raise OSError('fake TLS unavailable')
    return Socket()
http.client.HTTPConnection=Connection
socket.create_connection=connect
ssl.create_default_context=Context
sys.argv=['-c',role]
exec(compile(script,'<fake-network-real-child>','exec'),{})
'''

def smoke():
    outcomes=[]
    with tempfile.TemporaryDirectory(prefix='imds-functional-') as directory:
        fake=pathlib.Path(directory)/'fake-aws';fake.write_text(FAKE);fake.chmod(0o700)
        for mode in ('late-success','role-missing','info-failure','tls-failure','restart-failure','guard-failure','deadline'):
            current=[0];commands=[];restarts=[];output=io.StringIO()
            private=pathlib.Path(directory)/mode;private.mkdir()
            (private/'readiness-context.json').write_text(json.dumps(dict(run_id='fixture',nonce='d'*64,source_revision='a'*40,key='e'*64)))
            def run(argv,**kwargs):
                commands.append(argv[0:2])
                if argv[0]=='/usr/bin/python3':
                    script=argv[argv.index('-c')+1]
                    result=subprocess.run([str(fake),mode,str(current[0]),script],**kwargs)
                    if result.stdout: assert b'FAKE_PRIVATE_TOKEN' not in result.stdout
                    return result
                if argv[0]=='systemctl':
                    if argv[1]=='restart': restarts.append(current[0])
                    code=int((mode=='guard-failure' and current[0]>=25) or (mode=='restart-failure' and argv[1]=='restart'))
                    return subprocess.CompletedProcess(argv,code)
                if argv[0]=='nft':
                    quotas={'nftables':[{'quota':{'name':name,'bytes':cap,'used':1}} for name,cap in [('global_rx',30064771072),('bootstrap_rx',2147483648)]]}
                    return subprocess.CompletedProcess(argv,0,stdout=json.dumps(quotas).encode())
                raise AssertionError('unrecognized fake command')
            def sleep(seconds):
                current[0]+=int(seconds)
                if mode=='late-success' and current[0]>=200:
                    record=json.loads((private/'readiness.json').read_text())
                    (private/'controller-start').write_text(record['mac'])
            with patch.object(recovery.time,'monotonic',lambda:current[0]),patch.object(recovery.time,'sleep',sleep),contextlib.redirect_stdout(output):
                result=recovery.main(['--unit',recovery.UNITS[0],'--role',recovery.ROLE,'--deadline-ms','25000' if mode=='deadline' else '10000000'],run=run,wall=lambda:current[0],private=private)
            assert result==(0 if mode=='late-success' else 1)
            assert len(restarts)==(1 if mode in ('late-success','restart-failure') else 0)
            assert current[0]<=recovery.ADMISSION_SECONDS
            assert 'FAKE_PRIVATE_TOKEN' not in output.getvalue()
            assert all(command[1] not in ('poweroff','reboot') for command in commands)
            outcomes.append({'scenario':mode,'status':'PASS_fake_only','elapsed_virtual_seconds':current[0], 'restart_attempts':len(restarts),'actual_AWS_IMDS_calls':0,'real_host_operations':0,'records':output.getvalue().splitlines()})
    return outcomes
