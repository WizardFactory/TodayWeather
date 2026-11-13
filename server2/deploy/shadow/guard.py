#!/usr/bin/env python3
"""Host-local qualification guard. Offline `check` never stops units or calls AWS.

`run` is Linux/root-only and stops only the two manifest-derived task units.
Absolute host termination is a separate systemd timer, installed by bootstrap.
Unknown observations stop acquisition; successful samples are not product PASS.
"""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile
import time
from state import validate_cost_policy, estimate_cost

GiB = 1024**3
INTERVAL = 10


class GuardError(ValueError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def require(value, reason):
    if not value:
        raise GuardError(reason)


def integer(value, lo=0, hi=2**63-1):
    return type(value) is int and lo <= value <= hi


def digest(path, cap=256*1024**2):
    h = hashlib.sha256()
    size = 0
    with Path(path).open('rb') as f:
        while block := f.read(1024**2):
            size += len(block)
            require(size <= cap, 'file_size')
            h.update(block)
    return h.hexdigest()


def read_json(path):
    with Path(path).open('rb') as stream:
        raw = stream.read(65537)
    require(len(raw) <= 65536, 'json_size')
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'duplicate_field')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(GuardError('nonfinite_json')))


def validate(manifest):
    fields = {'schema','run_id','generation','epoch','pid','start_ticks','boot_id',
              'binary_sha256','environment_sha256','config_sha256','config_directory','port','metrics_port','tx_origin',
              'interface','data_directory','cgroup','allowance','cost_policy'}
    require(type(manifest) is dict and set(manifest) == fields, 'manifest_fields')
    require(type(manifest['schema']) is int and manifest['schema'] == 2, 'schema')
    require(isinstance(manifest['run_id'], str) and re.fullmatch('[a-z0-9-]{1,40}',manifest['run_id']), 'run_id')
    require(manifest['generation'] in ('initial','restart-1','restart-2'), 'generation')
    for field in ('epoch','start_ticks','tx_origin'):
        require(integer(manifest[field]),field)
    require(integer(manifest['pid'],2,2**31-1),'pid')
    for field in ('binary_sha256','environment_sha256','config_sha256'):
        require(isinstance(manifest[field],str) and re.fullmatch('[0-9a-f]{64}',manifest[field]),field)
    require(isinstance(manifest['boot_id'],str) and re.fullmatch('[0-9a-f-]{36}',manifest['boot_id']),'boot_id')
    require(integer(manifest['port'],1024,65534) and manifest['metrics_port']==manifest['port']+1,'ports')
    require(isinstance(manifest['interface'],str) and re.fullmatch('[a-zA-Z0-9_-]{1,15}',manifest['interface']),'interface')
    root = '/opt/server2-shadow/' + manifest['run_id']
    require(manifest['data_directory']==root+'/data','data_directory')
    require(manifest['config_directory']==root+'/config','config_directory')
    unit = 'server2-shadow-'+manifest['run_id']+'-candidate.service'
    require(manifest['cgroup']=='/system.slice/'+unit,'cgroup')
    allowance = manifest['allowance']
    require(type(allowance) is dict and set(allowance)=={'reads','writes','put_bytes'},'allowance')
    for field,cap in [('reads',900000),('writes',900000),('put_bytes',2*GiB)]:
        require(integer(allowance[field],1,cap),'allowance_'+field)
    validate_cost_policy(manifest['cost_policy'],manifest['epoch'])
    return manifest


def evaluate(manifest, sample, previous, now):
    """Return a latched decision; caller durably stores it before continuing."""
    validate(manifest)
    require(integer(now),'now')
    fingerprint = hashlib.sha256(canonical(manifest).encode()).hexdigest()
    result = {'schema':3,'manifest_sha256':fingerprint,'last_seen':now,
              'last_tx':manifest['tx_origin'],'last_cpu':0,'stop':None,'diagnostics':None}
    if previous is not None:
        require(type(previous) is dict and set(previous)==set(result),'state_fields')
        require(previous['manifest_sha256']==fingerprint,'state_identity')
        require(previous['schema']==3 and integer(previous['last_seen']) and integer(previous['last_tx']) and integer(previous['last_cpu']),'state_values')
        require(previous['stop'] is None or isinstance(previous['stop'],str),'state_stop')
        if previous['diagnostics'] is not None:checked_stored_diagnostics(previous['diagnostics'])
        result.update(previous)
        result['last_seen']=max(now,previous['last_seen'])
        if previous['stop'] is not None:
            return result
    def stop(reason):
        result['stop']=reason
        return result
    if now < (previous['last_seen'] if previous else manifest['epoch']):
        return stop('clock_rollback')
    if now >= manifest['epoch']+168*3600:
        return stop('collection_deadline')
    if not isinstance(sample,dict):
        return stop('observation_unavailable')
    if not integer(sample.get('observed_at')) or not 0 <= now-sample['observed_at'] <= 30:
        return stop('stale_observation')
    for key in ('pid','start_ticks','boot_id','binary_sha256','environment_sha256','config_sha256','config_directory','cgroup'):
        if type(sample.get(key)) is not type(manifest[key]) or sample[key]!=manifest[key]:
            return stop('binding_'+key)
    expected = sorted([['127.0.0.1',manifest['port']],['127.0.0.1',manifest['metrics_port']]])
    if sample.get('listeners')!=expected:
        return stop('listener_binding')
    tx=sample.get('tx_bytes')
    if not integer(tx) or tx < result['last_tx']:
        return stop('network_counter_reset')
    result['last_tx']=tx
    # Stop threshold; the cost model separately reserves termination/export bytes.
    if tx-manifest['tx_origin'] >= 4*GiB-128*1024**2:
        return stop('network_ceiling')
    if not integer(sample.get('free_bytes')) or sample['free_bytes'] < 6*GiB:
        return stop('disk_reserve')
    if sample.get('accounting_valid') is not True:
        return stop('accounting_unavailable')
    metrics=sample.get('metrics')
    required = {'s3_reads','s3_writes','s3_put_bytes','auth_failures','quota_failures'}
    if type(metrics) is not dict or set(metrics)!=required or not all(integer(v) for v in metrics.values()):
        return stop('metrics_unavailable')
    try:diagnostics=checked_diagnostics(sample.get('diagnostics'))
    except GuardError:return stop('metrics_unavailable')
    # Latest validated snapshot; latched with any stop so evidence distinguishes
    # auth from quota, the first origin and conservative paid admissions.
    result['diagnostics']=dict(diagnostics,observed_at=sample['observed_at'],
                               auth_failures=metrics['auth_failures'],quota_failures=metrics['quota_failures'])
    if metrics['auth_failures'] or metrics['quota_failures']:
        return stop('provider_auth_or_quota')
    for metric,allocation in [('s3_reads','reads'),('s3_writes','writes'),('s3_put_bytes','put_bytes')]:
        if not 0 < metrics[metric] <= manifest['allowance'][allocation]:
            return stop('s3_allowance')
    cpu=sample.get('cpu_seconds')
    if not integer(cpu) or cpu<result['last_cpu']:
        return stop('cpu_accounting_unavailable')
    result['last_cpu']=cpu
    cost=estimate_cost(manifest['cost_policy'],manifest['epoch'],now,cpu_seconds=cpu)
    if cost['stop']:
        return stop(cost['stop'])
    return result


PAID_PROVIDERS=('visual_crossing','google','google_air_quality','openweather')
VOCABULARY=dict(cause={'auth','quota'},origin={'event','local_paid_allowance'},
    component={'http','gateway','geocode','world','domestic','provider','quota','s3','resolver','cache','history',
               'summary','warnings','push_state','delivery','notice','process','listener','logging'},
    stage={'request','lifecycle','startup','bind','shutdown','runtime_teardown','admission','lookup','restore',
           'acquire','provider_http','reserve','publish','reconcile','void','writer','queue','worker','claim','send',
           'oauth','record_result','submission','translate','snapshot','shared_work','maintenance'},
    provider={'none','data_go_kr','visual_crossing','kakao','google','google_air_quality','openweather','waqi'})
# Label values are Rust enum names (snake_case, may contain digits such as s3);
# membership is then checked against VOCABULARY, which a test derives from the Rust source.
FIRST=re.compile(r'server2_runtime_first_rejection_info\{cause="([a-z0-9_]{1,32})",origin="([a-z0-9_]{1,32})",'
                 r'component="([a-z0-9_]{1,32})",stage="([a-z0-9_]{1,32})",provider="([a-z0-9_]{1,32})",'
                 r'status="(none|[1-5][0-9][0-9])"\} 1')
PAID=re.compile(r'server2_shadow_paid_units_(initial|remaining)\{provider="([a-z0-9_]{1,32})"\} ([0-9]{1,7})')


def checked_diagnostics(value):
    """Fixed-vocabulary diagnostic snapshot; never URLs, keys or free text."""
    require(type(value) is dict and set(value)=={'local_paid_exhaustions','first_rejection','paid_units'},'diagnostic_fields')
    require(integer(value['local_paid_exhaustions']),'diagnostic_local')
    first=value['first_rejection']
    if first is not None:
        require(type(first) is dict and set(first)==set(VOCABULARY)|{'status'},'diagnostic_first')
        require(all(first[k] in v for k,v in VOCABULARY.items()),'diagnostic_vocabulary')
        require(first['status'] is None or integer(first['status'],100,599),'diagnostic_status')
    paid=value['paid_units']
    if paid is not None:
        require(type(paid) is dict and set(paid)==set(PAID_PROVIDERS),'diagnostic_paid')
        for units in paid.values():
            require(type(units) is dict and set(units)=={'initial','remaining'} and integer(units['initial'],0,1000000)
                    and integer(units['remaining'],0,units['initial']),'diagnostic_units')
    return value


def checked_stored_diagnostics(value):
    """A persisted snapshot: the fixed diagnostics plus the sample time and guard counts."""
    extra={'observed_at','auth_failures','quota_failures'}
    require(type(value) is dict and set(value)=={'local_paid_exhaustions','first_rejection','paid_units'}|extra,'state_diagnostics')
    require(all(integer(value[k]) for k in extra),'state_diagnostics')
    checked_diagnostics({k:v for k,v in value.items() if k not in extra})
    return value


def diagnostic_values(text):
    local=None;first=None;paid={}
    for line in text.splitlines():
        if line.startswith('server2_runtime_local_paid_exhaustions_total'):
            fields=line.split()
            require(local is None and len(fields)==2 and fields[0]=='server2_runtime_local_paid_exhaustions_total'
                    and fields[1].isascii() and fields[1].isdigit(),'diagnostic_shape')
            local=int(fields[1])
        elif line.startswith('server2_runtime_first_rejection_info'):
            match=FIRST.fullmatch(line)
            require(first is None and match is not None,'diagnostic_shape')
            cause,origin,component,stage,provider,status=match.groups()
            first=dict(cause=cause,origin=origin,component=component,stage=stage,provider=provider,
                       status=None if status=='none' else int(status))
        elif line.startswith('server2_shadow_paid_units_'):
            match=PAID.fullmatch(line)
            require(match is not None,'diagnostic_shape')
            kind,provider,units=match.groups()
            require(provider in PAID_PROVIDERS and kind not in paid.setdefault(provider,{}),'diagnostic_shape')
            paid[provider][kind]=int(units)
    require(local is not None,'missing_metrics')
    return checked_diagnostics(dict(local_paid_exhaustions=local,first_rejection=first,paid_units=paid or None))


def process_stat(raw):
    # comm may contain spaces and parentheses; starttime is field 22, after the last ')'.
    end=raw.rfind(')')
    require(end>0,'process_stat')
    rest=raw[end+2:].split()
    require(len(rest)>19 and rest[0] not in ('Z','X'),'process_dead')
    return int(rest[19])


def environment_hash(raw):
    require(len(raw)<=128*1024 and raw.endswith(b'\0'),'environment_size')
    entries=raw[:-1].split(b'\0')
    keys=[entry.split(b'=',1)[0] for entry in entries]
    require(all(b'=' in entry for entry in entries) and len(keys)==len(set(keys)),'environment_fields')
    return hashlib.sha256(b'\0'.join(sorted(entries))+b'\0').hexdigest()


def listeners(tcp, tcp6, inodes, ports):
    owned=[]
    for text,ipv6 in [(tcp,False),(tcp6,True)]:
        for row in text.splitlines()[1:]:
            fields=row.split()
            require(len(fields)>=10,'socket_table')
            address,port=fields[1].split(':')
            port=int(port,16)
            if fields[3]!='0A' or port not in ports:
                continue
            require(fields[9] in inodes,'foreign_listener')
            require(not ipv6 and address=='0100007F','nonloopback_listener')
            owned.append(['127.0.0.1',port])
    return sorted(owned)


METRICS={'server2_shadow_s3_reads_remaining':'s3_reads',
         'server2_shadow_s3_writes_remaining':'s3_writes',
         'server2_shadow_s3_put_bytes_remaining':'s3_put_bytes',
         'server2_runtime_auth_failures_total':'auth_failures',
         'server2_runtime_quota_failures_total':'quota_failures'}


def metric_values(text):
    found={}
    for line in text.splitlines():
        fields=line.split()
        if fields and fields[0] in METRICS:
            key=METRICS[fields[0]]
            require(len(fields)==2 and fields[1].isascii() and fields[1].isdigit() and key not in found,'metric_shape')
            found[key]=int(fields[1])
    require(set(found)==set(METRICS.values()),'missing_metrics')
    return found


def host_cpu_seconds(raw,ticks_per_second):
    # Linux user/nice already include guest/guest_nice; do not add them again.
    # Steal is conservatively charged, iowait/idle are not busy CPU time.
    fields=raw.splitlines()[0].split()
    require(fields[0]=='cpu' and len(fields)>=9 and integer(ticks_per_second,1),'cpu_stat')
    values=[int(v) for v in fields[1:9]]
    require(all(integer(v) for v in values),'cpu_stat_values')
    busy=sum(values[i] for i in (0,1,2,5,6,7))
    return (busy+ticks_per_second-1)//ticks_per_second


def collect(manifest):
    """Read the live Linux host. No fixture root/endpoint can be selected in run mode."""
    validate(manifest)
    require(sys.platform=='linux' and os.geteuid()==0,'linux_root_required')
    began=int(time.time())
    proc=Path('/proc')/str(manifest['pid'])
    start=process_stat((proc/'stat').read_text())
    exe=digest(proc/'exe')
    env=environment_hash((proc/'environ').read_bytes())
    config_directory=os.readlink(proc/'cwd')
    config_sha256=digest(Path(manifest['config_directory'])/'.env',cap=128*1024)
    groups=(proc/'cgroup').read_text().splitlines()
    require(len(groups)==1 and groups[0].startswith('0::'),'cgroup_v2_required')
    inodes=set()
    for fd in (proc/'fd').iterdir():
        try: target=os.readlink(fd)
        except FileNotFoundError: continue
        if target.startswith('socket:[') and target.endswith(']'):
            inodes.add(target[8:-1])
    sockets=listeners((proc/'net/tcp').read_text(),(proc/'net/tcp6').read_text(),inodes,{manifest['port'],manifest['metrics_port']})
    stat=os.statvfs(manifest['data_directory'])
    tx=int((Path('/sys/class/net')/manifest['interface']/'statistics/tx_bytes').read_text())
    conn=http.client.HTTPConnection('127.0.0.1',manifest['metrics_port'],timeout=2)
    try:
        conn.request('GET','/internal/metrics',headers={'Connection':'close'})
        response=conn.getresponse()
        require(response.status==200,'metrics_status')
        body=response.read(65537)
        require(len(body)<=65536,'metrics_size')
        text=body.decode('ascii')
        metrics=metric_values(text)
        diagnostics=diagnostic_values(text)
    finally:
        conn.close()
    require(start==process_stat((proc/'stat').read_text()),'process_reused')
    return dict(observed_at=began,pid=manifest['pid'],start_ticks=start,
                boot_id=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                binary_sha256=exe,environment_sha256=env,config_sha256=config_sha256,
                config_directory=config_directory,cgroup=groups[0][3:],
                listeners=sockets,free_bytes=stat.f_bavail*stat.f_frsize,tx_bytes=tx,
                accounting_valid=True,metrics=metrics,diagnostics=diagnostics,
                cpu_seconds=host_cpu_seconds(Path('/proc/stat').read_text(),os.sysconf('SC_CLK_TCK')))


def save(path,value):
    fd,temp=tempfile.mkstemp(prefix='.guard-',dir=path.parent)
    try:
        with os.fdopen(fd,'w') as f:
            f.write(canonical(value)+'\n');f.flush();os.fsync(f.fileno())
        os.replace(temp,path)
        fd=os.open(path.parent,os.O_RDONLY)
        try:os.fsync(fd)
        finally:os.close(fd)
    finally:
        if os.path.exists(temp):os.unlink(temp)


def watchdog():
    """Notify the owning systemd unit only after a successful bounded observation."""
    address=os.environ.get('NOTIFY_SOCKET')
    require(address is not None and (address.startswith('/') or address.startswith('@')),'watchdog_socket')
    if address.startswith('@'):address='\0'+address[1:]
    with socket.socket(socket.AF_UNIX,socket.SOCK_DGRAM) as connection:
        connection.settimeout(1)
        connection.sendto(b'WATCHDOG=1',address)


def stop_units(manifest):
    # Never kill a PID obtained from a failed binding check or stop an arbitrary service.
    units=['server2-shadow-'+manifest['run_id']+'-'+suffix+'.service' for suffix in ('reader','candidate')]
    result=subprocess.run(['/usr/bin/systemctl','stop',*units],stdin=subprocess.DEVNULL,
                          stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=20,check=False)
    require(result.returncode==0,'stop_units_failed')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['check','run'])
    parser.add_argument('--manifest',type=Path,required=True)
    parser.add_argument('--state',type=Path,required=True)
    parser.add_argument('--sample',type=Path)
    parser.add_argument('--now',type=int)
    args=parser.parse_args()
    manifest=None
    try:
        manifest=validate(read_json(args.manifest))
        require((args.action=='check')==(args.sample is not None),'sample_mode')
        require(args.action=='check' or args.now is None,'clock_mode')
        if args.action=='run':
            require(sys.platform=='linux' and os.geteuid()==0,'linux_root_required')
            st=args.manifest.stat()
            require(not args.manifest.is_symlink() and st.st_uid==0 and st.st_mode & 0o022==0,'manifest_permissions')
        require(args.state.parent.is_dir() and not args.state.is_symlink(),'state_path')
        lock=os.open(str(args.state)+'.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
        try:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            while True:
                cycle_start=time.monotonic()
                if args.action=='run':
                    require(args.state.is_file(),'missing_initialized_state')
                prior=read_json(args.state) if args.state.exists() else None
                try:sample=read_json(args.sample) if args.action=='check' else collect(manifest)
                except (OSError,ValueError,http.client.HTTPException):sample=None
                now=args.now if args.now is not None else int(time.time())
                decision=evaluate(manifest,sample,prior,now)
                save(args.state,decision)
                if decision['stop']:
                    if args.action=='run':stop_units(manifest)
                    print(canonical(decision));return 2
                if args.action=='check':print(canonical(decision));return 0
                watchdog()
                time.sleep(max(0,INTERVAL-(time.monotonic()-cycle_start)))
        finally:os.close(lock)
    except (GuardError,ValueError,OSError,subprocess.SubprocessError):
        if args.action=='run' and manifest is not None and sys.platform=='linux' and os.geteuid()==0:
            try:stop_units(manifest)
            except (GuardError,OSError,subprocess.SubprocessError):pass
        print(canonical({'stop':'guard_failed','detail':'observation or state unavailable'}));return 2


if __name__=='__main__':
    raise SystemExit(main())
