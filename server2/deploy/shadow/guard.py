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
from state import Journal, validate_cost_policy, estimate_cost

GiB = 1024**3
INTERVAL = 10
# A single failed observation never ends a run: stop after this many in a row (60 s).
MISS_LIMIT = 6
# Authorization-failure records of the run's own storage or instance credentials (SR-3);
# one failed call can produce more than one record. A broken role fails every S3 call and
# passes this quickly; an isolated clock-skew rejection does not. Provider rejections never
# stop the run.
STORAGE_AUTH_LIMIT = 20
# ... within one fixed hourly window (CX-SR3-002): isolated rejections spread over the week,
# each perhaps recorded by more than one operation, never add up to a stop.
STORAGE_AUTH_WINDOW = 3600


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
              'interface','data_directory','cgroup','allowance','cost_policy','paid_usd_per_unit'}
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
    require(type(allowance) is dict and set(allowance)==Journal.CAPS.keys(),'allowance')
    for field,cap in Journal.CAPS.items():
        require(integer(allowance[field],1,cap),'allowance_'+field)
    validate_cost_policy(manifest['cost_policy'],manifest['epoch'])
    # Paid provider prices (USD per runtime unit) of the frozen paid policy, by the server's
    # metric names; None disables a provider.
    paid=manifest['paid_usd_per_unit']
    require(type(paid) is dict and set(paid)==set(PAID_PROVIDERS),'paid_prices')
    for price in paid.values():
        require(price is None or (type(price) is str and len(price)<=24 and re.fullmatch('[0-9]+(?:\\.[0-9]+)?',price) is not None),'paid_prices')
    return manifest


def evaluate(manifest, sample, previous, now):
    """Return a latched decision; caller durably stores it before continuing."""
    validate(manifest)
    require(integer(now),'now')
    fingerprint = hashlib.sha256(canonical(manifest).encode()).hexdigest()
    result = {'schema':6,'manifest_sha256':fingerprint,'last_seen':now,
              'last_tx':manifest['tx_origin'],'last_cpu':0,'stop':None,'diagnostics':None,'misses':0,
              'storage_auth_window':None,'cost':None}
    if previous is not None:
        require(type(previous) is dict and set(previous)==set(result),'state_fields')
        require(previous['manifest_sha256']==fingerprint,'state_identity')
        require(previous['schema']==6 and integer(previous['last_seen']) and integer(previous['last_tx']) and integer(previous['last_cpu'])
                and integer(previous['misses'],0,MISS_LIMIT),'state_values')
        require(previous['stop'] is None or isinstance(previous['stop'],str),'state_stop')
        window=previous['storage_auth_window']
        require(window is None or (type(window) is list and len(window)==3 and all(integer(v) for v in window)),'state_window')
        if previous['diagnostics'] is not None:checked_stored_diagnostics(previous['diagnostics'])
        cost=previous['cost']
        require(cost is None or (type(cost) is dict and set(cost)=={'accrued_usd','limit_usd'}
                and all(type(v) is str and re.fullmatch('[0-9]+(?:\\.[0-9]+)?',v) for v in cost.values())),'state_cost')
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
    def missed():
        # Unavailable, stale or malformed observations are tolerated while isolated.
        result['misses']=min(MISS_LIMIT,result['misses']+1)
        return stop('observation_lost') if result['misses']>=MISS_LIMIT else result
    if not isinstance(sample,dict) or not integer(sample.get('observed_at')) or not 0 <= now-sample['observed_at'] <= 30:
        return missed()
    # Stops decided from the sample's own fields come before the miss decision, so invalid
    # accounting, metrics or diagnostics never delay or rename them (CX-SR2-009).
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
    if not integer(sample.get('free_bytes')) or sample['free_bytes'] < 6*GiB:
        return stop('disk_reserve')
    metrics=sample.get('metrics')
    required = {'s3_reads','s3_writes','s3_put_bytes','auth_failures','quota_failures','storage_auth_failures'}
    if (sample.get('accounting_valid') is not True
            or type(metrics) is not dict or set(metrics)!=required or not all(integer(v) for v in metrics.values())
            or any(metrics[m]>manifest['allowance'][a] for m,a in S3_ALLOCATIONS)):
        return missed()
    try:diagnostics=checked_diagnostics(sample.get('diagnostics'))
    except (GuardError,TypeError,ValueError,KeyError,AttributeError):return missed()
    result['misses']=0
    # Latest validated snapshot; latched with any later stop so evidence keeps the auth,
    # quota and storage-authorization counts, per-source provider rejections, the first
    # origin and conservative paid admissions.
    result['diagnostics']=dict(diagnostics,observed_at=sample['observed_at'],
                               auth_failures=metrics['auth_failures'],quota_failures=metrics['quota_failures'],
                               storage_auth_failures=metrics['storage_auth_failures'])
    # Provider rejections and local budget exhaustion are handled by the runtime and are
    # evidence, not stop reasons (SR-3). Only storage/credential authorization stops: 20
    # within one hour. The window is [start, count at start, count at the last sample]; a new
    # hour starts from the last sample's count, so failures since then belong to it (the
    # process starts at 0).
    count=metrics['storage_auth_failures']
    start,base,last=result['storage_auth_window'] or [manifest['epoch'],0,0]
    if count<last:start,base=now,count            # counter reset: a new process
    elif now-start>=STORAGE_AUTH_WINDOW:start,base=now,last
    result['storage_auth_window']=[start,base,count]
    if count-base >= STORAGE_AUTH_LIMIT:
        return stop('s3_authorization')
    # SR-4 (#3002): an exhausted S3 allocation or paid grant is refused by the server and
    # recorded; it is not a stop. One cumulative ceiling prices what was actually used.
    cpu=sample.get('cpu_seconds')
    if not integer(cpu) or cpu<result['last_cpu']:
        return stop('cpu_accounting_unavailable')
    result['last_cpu']=cpu
    allowance=manifest['allowance']
    cost=estimate_cost(manifest['cost_policy'],manifest['epoch'],now,cpu_seconds=cpu,
                       s3_reads=allowance['reads']-metrics['s3_reads'],s3_writes=allowance['writes']-metrics['s3_writes'],
                       tx_bytes=tx-manifest['tx_origin'],paid_usd=paid_spend(manifest['paid_usd_per_unit'],diagnostics['paid_units']))
    result['cost']={'accrued_usd':cost['accrued_usd'],'limit_usd':cost['limit_usd']}
    if cost['stop']:
        return stop(cost['stop'])
    return result


S3_ALLOCATIONS=(('s3_reads','reads'),('s3_writes','writes'),('s3_put_bytes','put_bytes'))


def paid_spend(prices,paid_units):
    """USD of paid units admitted so far (initial - remaining) at the frozen prices."""
    from decimal import Decimal
    total=Decimal(0)
    for provider,units in (paid_units or {}).items():
        if prices.get(provider) is not None:
            total+=(units['initial']-units['remaining'])*Decimal(prices[provider])
    return str(total)


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
# Provider rejection sources: the labels of allowance.rs source_label (a test reads it).
PROVIDER_SOURCES={'vilage_fcst','vilage_fcst_msg','mid_fcst','fcst_zone','wthr_wrn','asos_hourly','asos_daily',
    'living_wthr_idx','health_wthr_idx','rise_set','airkorea_arpltn','airkorea_msrstn','airkorea_stats',
    'data_go_kr_other','visual_crossing','public_kma_web','public_airkorea_web','public_mfds','public_other'}
PROVIDER_HTTP=re.compile(r'server2_runtime_provider_http_rejections_total\{source="([a-z0-9_]{1,32})",'
                         r'status="([0-9]{3})"\} ([0-9]{1,15})')
PAID=re.compile(r'server2_shadow_paid_units_(initial|remaining)\{provider="([a-z0-9_]{1,32})"\} ([0-9]{1,7})')


DIAGNOSTIC_FIELDS={'local_paid_exhaustions','first_rejection','paid_units','provider_http'}


def checked_diagnostics(value):
    """Fixed-vocabulary diagnostic snapshot; never URLs, keys or free text."""
    require(type(value) is dict and set(value)==DIAGNOSTIC_FIELDS,'diagnostic_fields')
    require(integer(value['local_paid_exhaustions']),'diagnostic_local')
    first=value['first_rejection']
    if first is not None:
        require(type(first) is dict and set(first)==set(VOCABULARY)|{'status'},'diagnostic_first')
        require(all(isinstance(first[k],str) and first[k] in v for k,v in VOCABULARY.items()),'diagnostic_vocabulary')
        require(first['status'] is None or integer(first['status'],100,599),'diagnostic_status')
    paid=value['paid_units']
    if paid is not None:
        require(type(paid) is dict and set(paid)==set(PAID_PROVIDERS),'diagnostic_paid')
        for units in paid.values():
            require(type(units) is dict and set(units)=={'initial','remaining'} and integer(units['initial'],0,1000000)
                    and integer(units['remaining'],0,units['initial']),'diagnostic_units')
    http=value['provider_http']
    require(type(http) is dict and all(isinstance(k,str) and k in PROVIDER_SOURCES for k in http),'diagnostic_sources')
    for counts in http.values():
        require(type(counts) is dict and counts and all(isinstance(k,str) and k in ('401','403','429') for k in counts)
                and all(integer(n,1) for n in counts.values()),'diagnostic_rejections')
    return value


def checked_stored_diagnostics(value):
    """A persisted snapshot: the fixed diagnostics plus the sample time and guard counts."""
    extra={'observed_at','auth_failures','quota_failures','storage_auth_failures'}
    require(type(value) is dict and set(value)==DIAGNOSTIC_FIELDS|extra,'state_diagnostics')
    require(all(integer(value[k]) for k in extra),'state_diagnostics')
    checked_diagnostics({k:v for k,v in value.items() if k not in extra})
    return value


def diagnostic_values(text):
    local=None;first=None;paid={};http={}
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
        elif line.startswith('server2_runtime_provider_http_rejections_total'):
            match=PROVIDER_HTTP.fullmatch(line)
            require(match is not None,'diagnostic_shape')
            source,status,count=match.groups()
            require(source in PROVIDER_SOURCES and status in ('401','403','429')
                    and status not in http.setdefault(source,{}) and int(count)>0,'diagnostic_shape')
            http[source][status]=int(count)
        elif line.startswith('server2_shadow_paid_units_'):
            match=PAID.fullmatch(line)
            require(match is not None,'diagnostic_shape')
            kind,provider,units=match.groups()
            require(provider in PAID_PROVIDERS and kind not in paid.setdefault(provider,{}),'diagnostic_shape')
            paid[provider][kind]=int(units)
    require(local is not None,'missing_metrics')
    return checked_diagnostics(dict(local_paid_exhaustions=local,first_rejection=first,paid_units=paid or None,provider_http=http))


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
         'server2_runtime_quota_failures_total':'quota_failures',
         'server2_runtime_storage_auth_failures_total':'storage_auth_failures'}


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


def report_stop(decision,manifest,stop):
    """Write the stop record, then stop the units (LP-6, #2983).

    Stopping the candidate also stops this unit (the candidate's ExecStopPost), which
    can end this process before a later write; the record is flushed first, so the
    host's collector ships it.
    """
    print(canonical(decision),flush=True)
    if stop:stop_units(manifest)


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
                    report_stop(decision,manifest,args.action=='run');return 2
                if args.action=='check':print(canonical(decision));return 0
                watchdog()
                time.sleep(max(0,INTERVAL-(time.monotonic()-cycle_start)))
        finally:os.close(lock)
    except (GuardError,ValueError,OSError,subprocess.SubprocessError):
        failed={'stop':'guard_failed','detail':'observation or state unavailable'}
        try:report_stop(failed,manifest,args.action=='run' and manifest is not None
                        and sys.platform=='linux' and os.geteuid()==0)
        except (GuardError,OSError,subprocess.SubprocessError):pass
        return 2


if __name__=='__main__':
    raise SystemExit(main())
