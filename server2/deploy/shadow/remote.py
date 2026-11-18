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
import select
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
expected={'server2','paired_read.py','guard.py','coordinator.py','state.py','bootstrap.sh','reader.json','config.env','collector.tar.gz','collector.json','render.py','status.py','evidence_copy.py','launch.json'}
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


# The selected export accepts typed attempt numbers on stdin. The command and
# installed paths are fixed. The installed copier supplies the stopped-reader
# check and reconciles a hot rollback journal into the private SQLite snapshot.
FINISH_EXPORTER=r'''import json,os,re,stat,sys,tarfile,tempfile
from pathlib import Path
run_id,mode=sys.argv[1:]
assert re.fullmatch('[a-z0-9-]{1,30}',run_id)
root=Path('/opt/server2-shadow')/run_id
assert root.resolve()==root
sys.path.insert(0,str(root/'bin'))
from evidence_copy import HostTree,reader_stopped,snapshot,systemd_unit_state
raw=sys.stdin.buffer.read(512*1024+1)
assert len(raw)<=512*1024
request=json.loads(raw)
assert type(request) is dict and set(request)=={'attempts','limit'}
attempts,limit=request['attempts'],request['limit']
assert type(attempts) is list and len(attempts)<=12000
assert all(type(i) is int and 1<=i<=2**63-1 for i in attempts)
assert attempts==sorted(set(attempts))
assert (mode=='ledger' and not attempts) or (mode=='pairs' and attempts)
assert type(limit) is int and 0<limit<=2*1024**3
tree=HostTree(root/'launch.json')
assert tree.run_id==run_id and tree.paired.resolve()==tree.paired
assert reader_stopped(systemd_unit_state(tree.reader_unit,tree.paired/'owner.lock'))
with tempfile.TemporaryDirectory(dir=tree.state_dir) as work:
 if mode=='ledger':
  ledger=Path(work)/'ledger.sqlite3'
  snapshot(tree,ledger,True)
  files={'launch.json':root/'launch.json','reader.json':root/'reader.json',
         'data/paired/ledger.sqlite3':ledger}
 else:
  files={'data/paired/'+str(i)+suffix:tree.paired/(str(i)+suffix)
         for i in attempts for suffix in ('.body','.json')}
 total=1024
 for path in files.values():
  info=path.lstat()
  assert stat.S_ISREG(info.st_mode)
  total+=512+(info.st_size+511)//512*512
 assert (total+10239)//10240*10240<=limit
 with tarfile.open(fileobj=sys.stdout.buffer,mode='w|',format=tarfile.USTAR_FORMAT) as archive:
  for name,path in sorted(files.items()):archive.add(path,arcname=name,recursive=False)
'''

RECOVERY_LEDGER_NAMES = {'launch.json', 'reader.json', 'data/paired/ledger.sqlite3'}
RECOVERY_CONTROL_TIMEOUTS = {'finish-finalize': 620, 'finish-drain': 120}


def _selected_attempts(attempts):
    require(type(attempts) in (tuple, list) and 0 < len(attempts) <= 12000
            and all(type(i) is int and 1 <= i <= 2**63 - 1 for i in attempts)
            and list(attempts) == sorted(set(attempts)), 'invalid recovery attempts')
    return attempts


def _receive_recovery(argv, destination, request, limit, timeout):
    # Store the small request in a private file so writing it cannot prevent
    # sibling stdout reads or exceed the same wall-clock transfer timeout.
    until = time.monotonic() + timeout
    try:
        with tempfile.TemporaryFile() as incoming, open(destination, 'xb', opener=_open_private) as output:
            incoming.write(canonical(request).encode())
            incoming.seek(0)
            with subprocess.Popen(argv, stdin=incoming, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as proc:
                size = 0
                try:
                    while True:
                        remaining = until - time.monotonic()
                        if remaining <= 0 or not select.select([proc.stdout], [], [], remaining)[0]:
                            return CloudResult('timeout', 'HostEvidence')
                        block = os.read(proc.stdout.fileno(), min(1024**2, limit - size + 1))
                        if not block:
                            break
                        size += len(block)
                        if size > limit:
                            return CloudResult('command_error', 'HostEvidence')
                        output.write(block)
                    if proc.wait(timeout=max(0, until - time.monotonic())) != 0 or not size:
                        return CloudResult('command_error', 'HostEvidence')
                    output.flush()
                    os.fsync(output.fileno())
                    return CloudResult('json', 'HostEvidence', {'archive_bytes': size})
                finally:
                    if proc.poll() is None:
                        proc.kill()
    except subprocess.TimeoutExpired:
        return CloudResult('timeout', 'HostEvidence')
    except OSError:
        return CloudResult('command_error', 'HostEvidence')


def _open_private(path, flags):
    return os.open(path, flags | os.O_NOFOLLOW, 0o600)


def evidence_name(name):
    return name in {'launch.json','reader.json','state/install.json','state/guard.json','state/decision.json',
                    'data/paired/ledger.sqlite3','data/paired/ledger.sqlite3-journal'} or bool(
                        re.fullmatch(r'data/paired/[1-9][0-9]*\.(?:body|json)',name))


def unpack_evidence(archive,destination):
    """Extract only the fixed evidence inventory into an exclusive private tree."""
    required = RECOVERY_LEDGER_NAMES | {'state/install.json', 'state/guard.json', 'state/decision.json'}
    return _unpack_archive(archive, destination, evidence_name, required)


def unpack_recovery(archive, destination, *, attempts=None):
    """Accept exactly the stopped-ledger files, or exactly the requested pairs."""
    names = RECOVERY_LEDGER_NAMES if attempts is None else {
        f'data/paired/{i}.{suffix}' for i in _selected_attempts(attempts) for suffix in ('json', 'body')
    }
    return _unpack_archive(archive, destination, names.__contains__, names)


def _unpack_archive(archive, destination, allowed, required):
    destination=Path(destination);destination.mkdir(mode=0o700)
    files={};total=0
    with tarfile.open(archive,mode='r:') as bundle:
        for member in bundle:
            require(member.isfile() and allowed(member.name) and member.name not in files,'evidence archive member')
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
    require(required <= set(files), 'required evidence absent')
    sync_directory(destination)
    return {'files':files,'bytes':total,'qualification':'not_assessed'}


def ledger_identity(reader,launch):
    """The identity a paired ledger of this launch must record (paired_read.execute)."""
    return dict(manifest=reader,candidate='http://127.0.0.1:'+str(launch['plan']['port']),
                production='https://todayweather.wizardfactory.net',loopback_test=False,
                sampler_sha256=launch['plan']['artifacts']['paired_read.py'])


def attempt_matches(result,metadata,body_size,body_sha256):
    """A completed attempt's retained files against its ledger result.

    The sampler adds timing to its ledger after the worker has durably written
    response metadata. Only that field may differ. Shared by the SSH export and the
    bucket audit (evidence_audit.py, SR-5a).
    """
    elapsed=result.get('elapsed_ms')
    require(type(elapsed) is int and elapsed>=0,'invalid elapsed time')
    response={key:value for key,value in result.items() if key!='elapsed_ms'}
    return (metadata==response and body_size==result.get('body_bytes')
            and body_sha256==result.get('body_sha256'))


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
            require(identity==ledger_identity(reader,launch),'ledger identity mismatch')
            rows=db.execute('SELECT id,substr(result,1,65537) FROM attempts ORDER BY id').fetchmany(12001)
            require(0<len(rows)<=12000,'paired attempts absent or excessive')
        finally:db.close()
        missing=[]
        for attempt,raw in rows:
            require(type(attempt) is int and attempt>0,'attempt ID')
            if raw is None:missing.append(attempt);continue
            require(len(raw)<=65536,'oversized result')
            result=json.loads(raw)
            require(type(result) is dict,'invalid result shape')
            meta_name=f'data/paired/{attempt}.json';body_name=f'data/paired/{attempt}.body'
            if meta_name not in files or body_name not in files:missing.append(attempt);continue
            require(files[meta_name]['size']<=65536,'oversized metadata')
            metadata=json.loads((directory/meta_name).read_text())
            body=files[body_name]
            if not attempt_matches(result,metadata,body['size'],body['sha256']):missing.append(attempt)
        return {'complete':not missing,'attempts':len(rows),'missing_or_mismatched':missing,'qualification':'not_assessed'}
    except (StateError,OSError,ValueError,KeyError,TypeError,sqlite3.Error):
        return {'complete':False,'reason':'paired_evidence_invalid','qualification':'not_assessed'}


def recovery_archive_limit(member_bytes):
    """Total USTAR payload for planned members, including end blocks and padding."""
    total = sum(member_bytes) + 1024
    return (total + 10239) // 10240 * 10240


def _stopped_rows(directory, launch_sha256):
    from urllib.parse import quote

    launch_path = directory / 'launch.json'
    reader_path = directory / 'reader.json'
    paired = directory / 'data/paired'
    ledger = paired / 'ledger.sqlite3'
    for path, cap in ((launch_path, 65536), (reader_path, 65536), (ledger, EVIDENCE_BYTES)):
        require(not path.is_symlink() and path.is_file() and path.stat().st_size <= cap, 'invalid recovery contract file')
    require(not os.path.lexists(paired / 'ledger.sqlite3-journal'), 'unreconciled SQLite journal')
    launch_bytes = launch_path.read_bytes()
    reader_bytes = reader_path.read_bytes()
    require(hashlib.sha256(launch_bytes).hexdigest() == launch_sha256, 'recovery launch mismatch')
    launch = json.loads(launch_bytes)
    reader = json.loads(reader_bytes)
    artifacts = launch['plan']['artifacts']
    require(hashlib.sha256(reader_bytes).hexdigest() == artifacts['reader.json']
            and reader['candidate_sha256'] == artifacts['server2'], 'recovery reader mismatch')

    db = sqlite3.connect('file:' + quote(str(ledger.resolve())) + '?mode=ro&immutable=1', uri=True)
    try:
        require(db.execute('PRAGMA quick_check').fetchall() == [('ok',)], 'ledger integrity')
        row = db.execute('SELECT value FROM meta WHERE key=?', ('identity',)).fetchone()
        require(row is not None and json.loads(row[0]) == ledger_identity(reader, launch), 'ledger identity mismatch')
        rows = db.execute('SELECT id,substr(result,1,65537) FROM attempts ORDER BY id').fetchmany(12001)
        require(0 < len(rows) <= 12000, 'paired attempts absent or excessive')
        return rows
    finally:
        db.close()


def _matches_local_pair(directory, attempt, result):
    if directory is None:
        return False
    directory = Path(directory)
    metadata_path, body = directory / f'{attempt}.json', directory / f'{attempt}.body'
    try:
        if any(path.is_symlink() or not path.is_file() for path in (metadata_path, body)):
            return False
        size = body.stat().st_size
        if size != result['body_bytes'] or metadata_path.stat().st_size > 65536:
            return False
        metadata = json.loads(metadata_path.read_bytes())
        return attempt_matches(result, metadata, size, artifact_hash_large(body))
    except (StateError, OSError, ValueError, TypeError):
        return False


def assess_recovery(directory, launch_sha256, *, cached=None, recovered=None):
    """Validate the stopped ledger and plan or verify just its missing pairs.

    cached and recovered are flat directories of attempt bodies and metadata.
    The files map selects the verified directory for each required attempt.
    archive_members_bytes contains padded member totals per missing attempt.
    The caller must reserve archive_limit before requesting every missing pair.
    """
    report = {'complete': False, 'status': 'ledger_invalid', 'qualification': 'not_assessed'}
    pending, failures = [], []
    files, missing_bytes = {}, {}
    try:
        rows = _stopped_rows(Path(directory), launch_sha256)
        for attempt, raw in rows:
            require(type(attempt) is int and 1 <= attempt <= 2**63-1, 'attempt ID')
            if raw is None:
                pending.append(attempt)
                continue
            require(len(raw) <= 65536, 'oversized result')
            result = json.loads(raw)
            require(type(result) is dict, 'invalid result shape')
            if result.get('captured') is False and 'body_bytes' not in result and 'body_sha256' not in result:
                failures.append(attempt)
                continue
            size = result.get('body_bytes')
            digest = result.get('body_sha256')
            require(type(size) is int and 0 <= size <= 2 * 1024**2
                    and isinstance(digest, str) and re.fullmatch('[0-9a-f]{64}', digest), 'invalid recovery body')
            if _matches_local_pair(cached, attempt, result):
                files[str(attempt)] = 'cached'
            elif _matches_local_pair(recovered, attempt, result):
                files[str(attempt)] = 'recovered'
            else:
                metadata = {key: value for key, value in result.items() if key != 'elapsed_ms'}
                meta_size = len(canonical(metadata).encode())
                missing_bytes[str(attempt)] = sum(512 + (n + 511)//512*512 for n in (meta_size, size))
    except (StateError, OSError, ValueError, KeyError, TypeError, sqlite3.Error):
        return report
    return dict(
        report, complete=not missing_bytes, status='missing_pairs' if missing_bytes else 'complete',
        attempts=len(rows), pending=pending, capture_failures=failures,
        missing_or_mismatched=[int(attempt) for attempt in missing_bytes], files=files,
        archive_members_bytes=missing_bytes,
        archive_limit=recovery_archive_limit(missing_bytes.values()) if missing_bytes else 0,
    )


class Remote:
    """Pinned SSH transport for the fixed install, observe and recovery actions."""
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

    def invoke(self, action, *, archive=None, destination=None, attempts=None, limit=None, timeout=None):
        require(type(action) is str, 'SSH action')
        recovery = action in ('finish-ledger', 'finish-pairs')
        control = action in RECOVERY_CONTROL_TIMEOUTS
        transfer = recovery or action == 'export'
        require((action in ('install', 'inspect', 'stop', 'export') or recovery or control)
                and (action == 'install') == (archive is not None)
                and transfer == (destination is not None)
                and (action == 'finish-pairs') == (attempts is not None)
                and recovery == (limit is not None), 'SSH action')
        if recovery:
            require(type(limit) is int and 0 < limit <= EVIDENCE_BYTES, 'recovery archive limit')
            selected = [] if attempts is None else _selected_attempts(attempts)
        upper = RECOVERY_CONTROL_TIMEOUTS.get(action, 600 if transfer else 150 if action == 'stop' else 120)
        if timeout is None:
            timeout = upper
        require(type(timeout) in (int, float) and 0 < timeout <= upper, 'SSH timeout')
        b=self.binding;root='/opt/server2-shadow/'+b['run_id'];name='server2-shadow-'+b['run_id']
        require(not self.known_hosts.is_symlink() and self.known_hosts.read_text()==
                b['instance']+' '+b['host_key']+'\n','known host changed')
        if action=='install':command='sudo -n /usr/bin/python3 -c '+shlex.quote(RECEIVER)+' '+shlex.quote(b['run_id'])
        elif action=='export':command='sudo -n /usr/bin/python3 -c '+shlex.quote(EXPORTER)+' '+shlex.quote(b['run_id'])
        elif recovery:
            mode = 'ledger' if action == 'finish-ledger' else 'pairs'
            command = 'sudo -n /usr/bin/python3 -I -c ' + shlex.quote(FINISH_EXPORTER) + ' ' + shlex.quote(b['run_id']) + ' ' + mode
        elif action == 'finish-finalize':
            command = ('sudo -n /usr/bin/systemctl stop ' + ' '.join(
                name + '-' + suffix + '.service' for suffix in ('reader', 'candidate', 'guard'))
                + ' && sudo -n /usr/bin/timeout 600 /usr/bin/systemctl start ' + name + '-finalize.service')
        elif action == 'finish-drain':
            command = 'sudo -n /usr/bin/systemctl stop ' + name + '-logs.service'
        elif action=='inspect':
            script=('import json,subprocess;from pathlib import Path;'
                    'receipt=json.loads(Path('+repr(root+'/state/install.json')+').read_text());'
                    'receipt["unit_states"]={s:subprocess.run(["/usr/bin/systemctl","show",'
                    '"--property=ActiveState","--value",'+repr(name)+'+"-"+s+".service"],'
                    'capture_output=True,text=True,timeout=5,check=True).stdout.strip() '
                    'for s in ("candidate","reader","guard","logs")};print(json.dumps(receipt))')
            command='sudo -n /usr/bin/python3 -c '+shlex.quote(script)
        # Acquisition first; only then the collector, whose stop drain ships their final
        # records. Two commands: the units have no ordering relation to the collector.
        else:command=('sudo -n /usr/bin/systemctl stop '+' '.join(name+'-'+suffix+'.service' for suffix in ('reader','candidate','guard'))
                      +' && sudo -n /usr/bin/systemctl stop '+name+'-logs.service')
        argv=[self.ssh,'-F','/dev/null','-T','-i',str(self.identity),
              '-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes',
              '-o','UserKnownHostsFile='+str(self.known_hosts.absolute()),'-o','GlobalKnownHostsFile=/dev/null',
              '-o','HostKeyAlias='+b['instance'],'-o','HostKeyAlgorithms=ssh-ed25519',
              '-o','ForwardAgent=no','-o','ClearAllForwardings=yes','-o','ConnectTimeout=10',
              '-o','ConnectionAttempts=1','-o','ServerAliveInterval=10','-o','ServerAliveCountMax=2',
              'ec2-user@'+b['ipv4'],command]
        if recovery:
            return _receive_recovery(argv, destination, {'attempts': selected, 'limit': limit}, limit, timeout)
        if action=='export':
            fd=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            try:
                with os.fdopen(fd,'wb') as output:
                    completed=subprocess.run(argv,stdin=subprocess.DEVNULL,stdout=output,stderr=subprocess.DEVNULL,
                                             timeout=timeout,check=False)
                    output.flush();os.fsync(output.fileno())
                size=Path(destination).stat().st_size
                require(completed.returncode==0 and 0<size<=EVIDENCE_BYTES+EVIDENCE_FILES*1024+20480,'evidence transfer incomplete')
                return CloudResult('json','HostEvidence',{'archive_bytes':size})
            except subprocess.TimeoutExpired:return CloudResult('timeout','HostEvidence')
            except (OSError,StateError):return CloudResult('command_error','HostEvidence')
        try:
            # A stop waits for the collector's drain: units 10 s, then drain 75 s and
            # collector shutdown 20 s (TimeoutStopSec=100), inside 150 s.
            result=subprocess.run(argv,stdin=archive if archive is not None else subprocess.DEVNULL,
                                  capture_output=True,text=True,timeout=timeout,check=False)
        except subprocess.TimeoutExpired:return CloudResult('timeout','HostInstall' if action=='install' else 'HostObserve')
        except OSError:return CloudResult('command_error','HostInstall' if action=='install' else 'HostObserve')
        operation='HostInstall' if action=='install' else 'HostObserve'
        if result.returncode!=0 or len(result.stdout)>65536:return CloudResult('command_error',operation)
        if action=='stop' or control:return CloudResult('empty_success',operation)
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


# systemd ActiveState values.
UNIT_STATES={'active','reloading','inactive','failed','activating','deactivating','maintenance','refreshing'}


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
    units=receipt.get('unit_states')
    # The collector's state is reported, but acquisition is the three owned units.
    owned=[units.get(k) for k in ('candidate','reader','guard')] if type(units) is dict else []
    if receipt['status']!='started':return {'status':receipt['status'],'receipt':receipt}
    if owned==['active']*3:return {'status':'started','receipt':receipt}
    # Only a validated stop counts as stopped: all three states known, at least one ended.
    if (len(owned)==3 and all(isinstance(v,str) and v in UNIT_STATES for v in owned)
            and any(v in ('inactive','failed') for v in owned)):
        return {'status':'stopped','receipt':receipt}
    return {'status':'pending','reason':'unit_states_unvalidated','receipt':receipt}


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
        require(type(units) is dict and set(units)=={'candidate','reader','guard','logs'}
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
