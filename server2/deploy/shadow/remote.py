#!/usr/bin/env python3
"""Pinned SSH installation primitives; no public acquisition command.

The AWS-authenticated console fingerprint must match the scanned host key before
any configuration is sent. An installation intent is one-use even if SSH loses
the acknowledgement. Resume observes the original installation, never retries.
"""
from __future__ import annotations
import base64
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sqlite3
import tarfile
import tempfile
import time
from coordinator import (require, frozen_resources, resource_digest, verify_bundle,
                         artifact_hash, HOST_ARTIFACTS)
from state import CloudResult, StateError, canonical, sync_directory


def target(value):
    require(type(value) is dict and set(value)=={'schema','run_id','instance','ipv4','host_key'},'SSH target fields')
    require(value['schema']==1 and type(value['schema']) is int,'SSH target schema')
    require(isinstance(value['run_id'],str) and re.fullmatch('[a-z0-9-]{1,30}',value['run_id']),'SSH run ID')
    require(isinstance(value['instance'],str) and re.fullmatch('i-[0-9a-f]{8,17}',value['instance']),'SSH instance')
    address=ipaddress.ip_address(value['ipv4'])
    require(address.version==4 and address.is_global,'SSH public IPv4')
    key=value['host_key']
    require(isinstance(key,str) and re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/]+={0,2}',key),'SSH host key')
    blob=base64.b64decode(key.split()[1],validate=True)
    require(len(blob)==51 and blob[:19]==b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20','SSH ed25519 wire key')
    return value


def bind_target(cloud,journal,resources,scan,*,now):
    """Bind a public endpoint from EC2 to its authenticated console fingerprint.

    scan(address) supplies untrusted ssh-keyscan output; matching that alone is
    never authentication. Console output must identify this exact owned instance.
    """
    r=frozen_resources(resources)
    require(journal.mutation('owned-resources')=={'operation':'BindResources',
            'params_sha':resource_digest(r),'token':r['instance']},'owned SSH instance')
    journal.active(now)
    answer=cloud.call('DescribeInstances',{'InstanceIds':[r['instance']]})
    require(answer.kind=='json','SSH instance unavailable')
    reservations=answer.payload.get('Reservations',[])
    instances=[i for reservation in reservations for i in reservation.get('Instances',[])]
    require(len(instances)==1 and instances[0].get('InstanceId')==r['instance']
            and instances[0].get('State',{}).get('Name')=='running','SSH instance state')
    address=instances[0].get('PublicIpAddress')
    require(isinstance(address,str) and ipaddress.ip_address(address).version==4
            and ipaddress.ip_address(address).is_global,'SSH endpoint')
    console=cloud.call('GetConsoleOutput',{'InstanceId':r['instance'],'Latest':True})
    require(console.kind=='json' and console.payload.get('InstanceId')==r['instance'],'console instance binding')
    raw=console.payload.get('Output')
    require(isinstance(raw,str) and len(raw)<=1024**2,'console output')
    # AWS API returns Base64; some SDK/CLI versions decode the blob already.
    texts=[raw]
    try:texts.append(base64.b64decode(raw,validate=True).decode('utf-8'))
    except (ValueError,UnicodeError):pass
    fingerprints=set(re.findall(r'SHA256:[A-Za-z0-9+/]{43}(?![A-Za-z0-9+/])','\n'.join(texts)))
    require(fingerprints,'console has no SHA256 host fingerprints')
    scanned=scan(address)
    require(isinstance(scanned,str) and len(scanned)<=16384,'key scan output')
    keys=set()
    for line in scanned.splitlines():
        fields=line.split()
        if len(fields)!=3 or fields[0]!=address or fields[1]!='ssh-ed25519':continue
        key=' '.join(fields[1:])
        candidate=target(dict(schema=1,run_id=r['run_id'],instance=r['instance'],ipv4=address,host_key=key))
        fingerprint='SHA256:'+base64.b64encode(hashlib.sha256(base64.b64decode(fields[2],validate=True)).digest()).decode().rstrip('=')
        if fingerprint in fingerprints:keys.add(candidate['host_key'])
    require(len(keys)==1,'scanned key not authenticated by EC2 console')
    result=target(dict(schema=1,run_id=r['run_id'],instance=r['instance'],ipv4=address,host_key=keys.pop()))
    existing=journal.request('ssh-target')
    if existing is None:
        journal.prepare_request('ssh-target','BindSshTarget',result,r['instance'],now=now)
        journal.record_receipt('ssh-target',CloudResult('json','BindSshTarget',{'bound':True}))
    else:require(existing['params']==result,'SSH target changed')
    return result


def scan_host(address):
    require(ipaddress.ip_address(address).version==4 and ipaddress.ip_address(address).is_global,'scan endpoint')
    result=subprocess.run(['/usr/bin/ssh-keyscan','-T','5','-t','ed25519',address],
                          capture_output=True,text=True,timeout=10,check=False)
    require(result.returncode==0 and len(result.stdout)<=16384,'host key scan unavailable')
    return result.stdout


# The stream is an internally constructed archive of fixed names and hashes.
# The receiver still rejects links/traversal/extra files and retains a failed
# stage directory so an uncertain transfer cannot be retried into the same tree.
RECEIVER='''import os,sys,tarfile,json,subprocess
from pathlib import Path
run_id=sys.argv[1]
parent=Path('/opt/server2-shadow-stage')
if not parent.exists():parent.mkdir(mode=0o700)
st=parent.lstat()
assert not parent.is_symlink() and st.st_uid==0 and st.st_mode&0o077==0
stage=parent/run_id
stage.mkdir(mode=0o700)
expected={'server2','paired_read.py','guard.py','coordinator.py','state.py','bootstrap.sh','reader.json','config.env','launch.json'}
seen=set();total=0
with tarfile.open(fileobj=sys.stdin.buffer,mode='r|') as archive:
 for item in archive:
  assert item.name in expected and item.name not in seen and item.isfile() and 0<=item.size<=256*1024**2
  total+=item.size
  assert total<=512*1024**2
  seen.add(item.name)
  with archive.extractfile(item) as source,(stage/item.name).open('xb') as output:
   os.chmod(stage/item.name,0o700 if item.name=='server2' else 0o600)
   while block:=source.read(1024**2):output.write(block)
   output.flush();os.fsync(output.fileno())
assert seen==expected
os.execv('/usr/bin/python3',['/usr/bin/python3','-B',str(stage/'coordinator.py'),'install-host','--bundle',str(stage)])
'''

EVIDENCE_BYTES=2*1024**3
EVIDENCE_FILES=25016
# No .env, identity file, process environment or server log is exported. Paired
# response bodies and their original ledger remain private local evidence.
EXPORTER=r'''import sys,re,tarfile,os
from pathlib import Path
root=Path('/opt/server2-shadow')/sys.argv[1]
files=[root/'launch.json',root/'reader.json',root/'state/install.json',root/'state/guard.json',root/'state/decision.json']
paired=root/'data/paired'
assert paired.is_dir() and not paired.is_symlink()
for path in paired.iterdir():
 assert not path.is_symlink()
 if re.fullmatch(r'[1-9][0-9]*\.(?:body|json)',path.name) or path.name in ('ledger.sqlite3','ledger.sqlite3-journal'):
  files.append(path)
assert len(files)<=25016
assert all(p.is_file() and not p.is_symlink() for p in files)
assert sum(p.stat().st_size for p in files)<=2*1024**3
with tarfile.open(fileobj=sys.stdout.buffer,mode='w|',format=tarfile.USTAR_FORMAT) as archive:
 for path in sorted(files):archive.add(path,arcname=str(path.relative_to(root)),recursive=False)
'''


def evidence_name(name):
    return name in {'launch.json','reader.json','state/install.json','state/guard.json','state/decision.json',
                    'data/paired/ledger.sqlite3','data/paired/ledger.sqlite3-journal'} or bool(
                        re.fullmatch(r'data/paired/[1-9][0-9]*\.(?:body|json)',name))


def unpack_evidence(archive,destination):
    """Extract only the fixed evidence inventory into an exclusive private tree."""
    destination=Path(destination);destination.mkdir(mode=0o700)
    files={};total=0
    with tarfile.open(archive,mode='r:') as bundle:
        for member in bundle:
            require(member.isfile() and evidence_name(member.name) and member.name not in files,'evidence archive member')
            total+=member.size
            require(0<=member.size<=EVIDENCE_BYTES and total<=EVIDENCE_BYTES and len(files)<EVIDENCE_FILES,'evidence allowance')
            path=destination/member.name;path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            h=hashlib.sha256();size=0
            fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,'wb') as output,bundle.extractfile(member) as source:
                while block:=source.read(1024**2):output.write(block);h.update(block);size+=len(block)
                output.flush();os.fsync(output.fileno())
            require(size==member.size,'evidence truncated')
            files[member.name]={'size':size,'sha256':h.hexdigest()}
    require({'launch.json','reader.json','state/install.json','state/guard.json','state/decision.json',
             'data/paired/ledger.sqlite3'}<=set(files),'required evidence absent')
    sync_directory(destination)
    return {'files':files,'bytes':total,'qualification':'not_assessed'}


def paired_evidence(directory,files):
    """Check retained ledger/body correspondence; never judge weather parity."""
    from urllib.parse import quote
    directory=Path(directory);paired=directory/'data/paired'
    try:
        require(not (paired/'ledger.sqlite3-journal').exists(),'unreconciled SQLite journal')
        reader=json.loads((directory/'reader.json').read_text())
        launch=json.loads((directory/'launch.json').read_text())
        require(reader.get('candidate_sha256')==launch['plan']['artifacts']['server2'],'reader candidate mismatch')
        db=sqlite3.connect('file:'+quote(str((paired/'ledger.sqlite3').resolve()))+'?mode=ro&immutable=1',uri=True)
        try:
            require(db.execute('PRAGMA quick_check').fetchall()==[('ok',)],'ledger integrity')
            identity=json.loads(db.execute('SELECT value FROM meta WHERE key=?',('identity',)).fetchone()[0])
            require(identity==dict(manifest=reader,candidate='http://127.0.0.1:'+str(launch['plan']['port']),
                    production='https://todayweather.wizardfactory.net',loopback_test=False,
                    sampler_sha256=launch['plan']['artifacts']['paired_read.py']),'ledger identity mismatch')
            rows=db.execute('SELECT id,substr(result,1,65537) FROM attempts ORDER BY id').fetchmany(12001)
            require(0<len(rows)<=12000,'paired attempts absent or excessive')
        finally:db.close()
        missing=[]
        for attempt,raw in rows:
            require(type(attempt) is int and attempt>0,'attempt ID')
            if raw is None:missing.append(attempt);continue
            require(len(raw)<=65536,'oversized result')
            result=json.loads(raw)
            meta_name=f'data/paired/{attempt}.json';body_name=f'data/paired/{attempt}.body'
            if meta_name not in files or body_name not in files:missing.append(attempt);continue
            require(files[meta_name]['size']<=65536,'oversized metadata')
            metadata=json.loads((directory/meta_name).read_text())
            body=files[body_name]
            if (metadata!=result or body['size']!=result.get('body_bytes')
                    or body['sha256']!=result.get('body_sha256')):missing.append(attempt)
        return {'complete':not missing,'attempts':len(rows),'missing_or_mismatched':missing,'qualification':'not_assessed'}
    except (StateError,OSError,ValueError,KeyError,TypeError,sqlite3.Error):
        return {'complete':False,'reason':'paired_evidence_invalid','qualification':'not_assessed'}


class Remote:
    """No caller-provided remote command; only fixed install/inspect/stop actions."""
    def __init__(self,binding,identity,known_hosts,*,ssh='/usr/bin/ssh'):
        self.binding=target(binding);self.identity=Path(identity);self.known_hosts=Path(known_hosts)
        require(self.identity.is_absolute() and self.identity.is_file() and not self.identity.is_symlink()
                and self.identity.stat().st_mode&0o077==0,'private SSH identity')
        require(Path(ssh).is_absolute() and Path(ssh).is_file(),'SSH executable')
        self.ssh=ssh
        expected=self.binding['instance']+' '+self.binding['host_key']+'\n'
        if not self.known_hosts.exists():
            fd=os.open(self.known_hosts,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,'w') as stream:stream.write(expected);stream.flush();os.fsync(stream.fileno())
            sync_directory(self.known_hosts.parent)
        require(not self.known_hosts.is_symlink() and self.known_hosts.is_file()
                and self.known_hosts.stat().st_mode&0o077==0 and self.known_hosts.read_text()==expected,'known host binding')

    def invoke(self,action,*,archive=None,destination=None):
        require(action in ('install','inspect','stop','export') and (action=='install')==(archive is not None)
                and (action=='export')==(destination is not None),'SSH action')
        b=self.binding;root='/opt/server2-shadow/'+b['run_id'];name='server2-shadow-'+b['run_id']
        require(not self.known_hosts.is_symlink() and self.known_hosts.read_text()==
                b['instance']+' '+b['host_key']+'\n','known host changed')
        if action=='install':command='sudo -n /usr/bin/python3 -c '+shlex.quote(RECEIVER)+' '+shlex.quote(b['run_id'])
        elif action=='export':command='sudo -n /usr/bin/python3 -c '+shlex.quote(EXPORTER)+' '+shlex.quote(b['run_id'])
        elif action=='inspect':
            script=('import json,subprocess;from pathlib import Path;'
                    'receipt=json.loads(Path('+repr(root+'/state/install.json')+').read_text());'
                    'receipt["unit_states"]={s:subprocess.run(["/usr/bin/systemctl","show",'
                    '"--property=ActiveState","--value",'+repr(name)+'+"-"+s+".service"],'
                    'capture_output=True,text=True,timeout=5,check=True).stdout.strip() '
                    'for s in ("candidate","reader","guard")};print(json.dumps(receipt))')
            command='sudo -n /usr/bin/python3 -c '+shlex.quote(script)
        else:command='sudo -n /usr/bin/systemctl stop '+' '.join(name+'-'+suffix+'.service' for suffix in ('reader','candidate','guard'))
        argv=[self.ssh,'-F','/dev/null','-T','-i',str(self.identity),
              '-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes',
              '-o','UserKnownHostsFile='+str(self.known_hosts.absolute()),'-o','GlobalKnownHostsFile=/dev/null',
              '-o','HostKeyAlias='+b['instance'],'-o','HostKeyAlgorithms=ssh-ed25519',
              '-o','ForwardAgent=no','-o','ClearAllForwardings=yes','-o','ConnectTimeout=10',
              '-o','ConnectionAttempts=1','-o','ServerAliveInterval=10','-o','ServerAliveCountMax=2',
              'ec2-user@'+b['ipv4'],command]
        if action=='export':
            fd=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            try:
                with os.fdopen(fd,'wb') as output:
                    completed=subprocess.run(argv,stdin=subprocess.DEVNULL,stdout=output,stderr=subprocess.DEVNULL,
                                             timeout=600,check=False)
                    output.flush();os.fsync(output.fileno())
                size=Path(destination).stat().st_size
                require(completed.returncode==0 and 0<size<=EVIDENCE_BYTES+EVIDENCE_FILES*1024+20480,'evidence transfer incomplete')
                return CloudResult('json','HostEvidence',{'archive_bytes':size})
            except subprocess.TimeoutExpired:return CloudResult('timeout','HostEvidence')
            except (OSError,StateError):return CloudResult('command_error','HostEvidence')
        try:
            result=subprocess.run(argv,stdin=archive if archive is not None else subprocess.DEVNULL,
                                  capture_output=True,text=True,timeout=120,check=False)
        except subprocess.TimeoutExpired:return CloudResult('timeout','HostInstall' if action=='install' else 'HostObserve')
        except OSError:return CloudResult('command_error','HostInstall' if action=='install' else 'HostObserve')
        operation='HostInstall' if action=='install' else 'HostObserve'
        if result.returncode!=0 or len(result.stdout)>65536:return CloudResult('command_error',operation)
        if action=='stop':return CloudResult('empty_success',operation)
        try:payload=json.loads(result.stdout)
        except ValueError:return CloudResult('malformed',operation)
        return CloudResult('json',operation,payload) if type(payload) is dict else CloudResult('malformed',operation)


def install_remote(remote,journal,bundle,*,now):
    bundle=Path(bundle);launch=verify_bundle(bundle);current=journal.active(now)
    require(launch['generation']=='initial' and current['generations']==1,'initial grant required')
    require(current['manifest_sha']==hashlib.sha256(canonical(launch['plan']).encode()).hexdigest()
            and launch['epoch']==current['epoch'],'installation journal binding')
    binding=journal.request('ssh-target')
    require(binding is not None and binding['params']==remote.binding
            and remote.binding['run_id']==current['run_id'],'installation SSH binding')
    expected=hashlib.sha256((canonical(launch)+'\n').encode()).hexdigest()
    request=journal.request('host-install')
    params={'target':remote.binding,'launch_sha256':expected}
    if request is None:
        # Exclusive temporary archive is private and deleted after its one use.
        with tempfile.TemporaryFile(dir=journal.directory) as stream:
            with tarfile.open(fileobj=stream,mode='w') as archive:
                for name in sorted(HOST_ARTIFACTS|{'launch.json'}):
                    path=bundle/name
                    require(not path.is_symlink() and path.is_file(),'archive input')
                    archive.add(path,arcname=name,recursive=False)
            stream.seek(0)
            with tarfile.open(fileobj=stream,mode='r') as archive:
                for member in archive:
                    require(member.isfile() and member.name in HOST_ARTIFACTS|{'launch.json'},'archive member')
                    with archive.extractfile(member) as body:
                        h=hashlib.sha256()
                        while block:=body.read(1024**2):h.update(block)
                    require(h.hexdigest()==(expected if member.name=='launch.json' else launch['plan']['artifacts'][member.name]),'archive digest')
            stream.seek(0)
            journal.prepare_request('host-install','HostInstall',params,'host-install',now=now)
            result=remote.invoke('install',archive=stream)
            journal.record_receipt('host-install',result)
    else:require(request['params']==params,'installation request changed')
    return inspect_install(remote,journal,launch)


def inspect_install(remote,journal,launch):
    """Observe the one recorded install, including after acquisition expires."""
    current=journal.snapshot()
    expected=hashlib.sha256((canonical(launch)+'\n').encode()).hexdigest()
    request=journal.request('host-install')
    require(request is not None and request['params']=={'target':remote.binding,'launch_sha256':expected}
            and launch['epoch']==current['epoch']
            and current['manifest_sha']==hashlib.sha256(canonical(launch['plan']).encode()).hexdigest(),
            'observed installation binding')
    observed=remote.invoke('inspect')
    if observed.kind!='json':return {'status':'pending','reason':'installation_unconfirmed'}
    receipt=observed.payload
    require(receipt.get('launch_sha256')==expected and receipt.get('epoch')==current['epoch']
            and receipt.get('collection_until')==current['collection_until']
            and receipt.get('cleanup_until')==current['cleanup_until'],'remote installation receipt binding')
    require(receipt.get('status') in ('started','failed','installing'),'installation status')
    active=receipt.get('unit_states')==dict(candidate='active',reader='active',guard='active')
    return {'status':receipt['status'] if receipt['status']!='started' or active else 'stopped','receipt':receipt}


def retain_host_evidence(remote,journal,destination):
    """Stop and retain paired evidence before termination. Failure stays incomplete.

    No archive attempt is repeated automatically after an uncertain transfer.
    Cloud cleanup must continue independently even if this component fails.
    Aggregate SSH transfer allocation is still a prelaunch coordinator gate.
    """
    directory=Path(destination);directory.mkdir(mode=0o700)
    report={'complete':False,'qualification':'not_assessed'}
    def save_report():
        temporary=directory/'.result.tmp'
        with temporary.open('w') as stream:
            os.chmod(temporary,0o600);stream.write(canonical(report)+'\n');stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,directory/'result.json');sync_directory(directory)
    save_report()
    try:
        binding=journal.request('ssh-target');install=journal.request('host-install')
        require(binding is not None and binding['params']==remote.binding and install is not None,'evidence host binding')
        require(remote.invoke('stop').kind=='empty_success','acquisition stop unavailable')
        observed=remote.invoke('inspect')
        require(observed.kind=='json' and observed.payload.get('launch_sha256')==install['params']['launch_sha256'],
                'stopped receipt binding')
        units=observed.payload.get('unit_states')
        require(type(units) is dict and set(units)=={'candidate','reader','guard'}
                and all(v in ('inactive','failed') for v in units.values()),'acquisition not stopped')
        journal.prepare_request('host-evidence','HostEvidence',{'target':remote.binding},'host-evidence',
                                now=int(time.time()),cleanup=True)
        result=remote.invoke('export',destination=directory/'host.tar')
        journal.record_receipt('host-evidence',result)
        require(result.kind=='json','host evidence transfer unconfirmed')
        contents=unpack_evidence(directory/'host.tar',directory/'files')
        require(contents['files']['launch.json']['sha256']==install['params']['launch_sha256'],'downloaded launch mismatch')
        audit=paired_evidence(directory/'files',contents['files'])
        report.update(contents,complete=audit['complete'],paired=audit,archive_sha256=artifact_hash_large(directory/'host.tar'))
    except (StateError,OSError,ValueError,tarfile.TarError):report['reason']='host_evidence_incomplete'
    finally:save_report()
    return report


def artifact_hash_large(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as stream:
        while block:=stream.read(1024**2):h.update(block)
    return h.hexdigest()
