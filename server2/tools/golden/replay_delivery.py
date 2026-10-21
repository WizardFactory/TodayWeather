#!/usr/bin/env python3
"""Four fixed full delivery recorders; actual replay needs separate root authorization."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import time
from urllib.parse import urlsplit
from replay_towns import require, regular, load, sha

PROFILE='delivery'
DEADLINE=90
STREAM_LIMIT=2*1024*1024


def dependencies(root,roots,manifests,spec):
    require(set(roots)==set(manifests)=={'common','firebase','models'},'exact three dependency roots')
    result={}
    for group,base in roots.items():
        deps=regular(Path(base)/'package.json').parent
        configured=spec['dependency_roots'][group]
        for name in ('package.json','package-lock.json'):
            require(sha(regular(deps/name))==sha(regular(root/configured['manifest_dir']/name)),'dependency manifest identity '+group)
        lock=load(deps/'package-lock.json')
        require(lock['packages']['']['dependencies']==configured['direct_dependencies'],'direct dependency lock '+group)
        require(len(lock['packages'])-1==configured['packages'],'exact package count '+group)
        manifest_path=regular(manifests[group]);manifest=load(manifest_path)
        require(set(manifest)=={'regular_files','symlinks'},'verified installed file map')
        actual={str(p.relative_to(deps)) for p in (deps/'node_modules').rglob('*') if p.is_file() or p.is_symlink()}
        require(actual==set(manifest['regular_files'])|set(manifest['symlinks']),'dependency file inventory')
        for name,target in manifest['symlinks'].items():
            p=deps/name
            require(name.startswith('node_modules/') and Path(name).parent.name=='.bin' and '..' not in Path(name).parts,'internal bin path')
            require(p.is_symlink() and str(p.readlink())==target and p.resolve().is_file() and p.resolve().is_relative_to(deps/'node_modules'),'internal bin link')
        for name,digest in manifest['regular_files'].items():
            require(name.startswith('node_modules/') and not Path(name).is_absolute() and '..' not in Path(name).parts,'dependency file path')
            require(sha(regular(deps/name))==digest,'dependency file identity')
        for relative,pkg in lock['packages'].items():
            if not relative:continue
            require(pkg['resolved'].startswith('https://registry.npmjs.org/') and pkg.get('integrity'),'official registry locked package')
            filename=relative+'/package.json';raw=regular(deps/filename).read_bytes()
            require(filename in manifest['regular_files'] and hashlib.sha256(raw).hexdigest()==manifest['regular_files'][filename],'vendor metadata identity')
            # Published vendor metadata follows Node JSON.parse after exact byte/containment checks.
            # Policy, lock, source, installed-map and recorded-output decoders remain strict.
            require(json.loads(raw)['version']==pkg['version'],'locked transitive version')
        result[group]={'path':str(deps),'files':manifest['regular_files'],'installed_manifest':str(manifest_path),'installed_manifest_sha256':sha(manifest_path)}
    return result


def prepare(root,node,roots,manifests,sources,out,variant):
    root=Path(root).resolve();node=regular(node);out=Path(out).absolute()
    evidence=root/'reports/sdlc/issue-2819-oracle-provenance/phase4-b2'
    require(out==out.resolve() and out.parent==evidence and not out.exists(),'new owned B2 output required')
    sp=regular(root/'server2/tools/golden/policies/delivery.json');spec=load(sp)
    require(spec['schema']==1 and spec['profile']==PROFILE and spec['stream_limit_bytes']==STREAM_LIMIT and variant in spec['variants'],'fixed delivery profile')
    entry=spec['variants'][variant]
    v=subprocess.run([str(node),'--version'],env={'PATH':os.defpath,'LANG':'C'},capture_output=True,text=True,timeout=5)
    require(v.returncode==0 and v.stdout.strip()=='v16.20.2','Node16.20.2 required')
    for p,digest in {**spec['exports'],**spec['static_inputs']}.items():require(sha(regular(root/p))==digest,'fixed export/static input identity')
    deps=dependencies(root,roots,manifests,spec)
    report=load(sources)
    require(type(report['schema']) is int and report['schema']==1 and set(entry['source_paths'])<=set(report['legacy_sources']),'fixed source report')
    selected={p:report['legacy_sources'][p] for p in entry['source_paths']}
    require(all(isinstance(v,str) and len(v)==64 and all(c in '0123456789abcdef' for c in v) for v in selected.values()),'source digest')
    revision=subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD']).decode().strip()
    guard=regular(root/'server2/tools/golden/guards/delivery.cjs')
    policy={'schema':1,'profile':PROFILE,'variant':variant,'root':str(root),'revision':revision,'dependency_roots':deps,'sources':selected,'exports':spec['exports'],'output':str(out/entry['record_name']),'guard_sha256':sha(guard),'spec_sha256':sha(sp),'node_sha256':sha(node)}
    return root,node,out,policy,spec


def child(command,env,output,deadline=None):
    process=subprocess.Popen(command,env=env,cwd=output,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
    selector=selectors.DefaultSelector();buffers={process.stdout:bytearray(),process.stderr:bytearray()}
    for stream in buffers:selector.register(stream,selectors.EVENT_READ)
    failure=None;end=time.monotonic()+(DEADLINE if deadline is None else deadline)
    try:
        while selector.get_map():
            left=end-time.monotonic();require(left>0,'child deadline')
            events=selector.select(left);require(events,'child deadline')
            for key,_ in events:
                block=os.read(key.fileobj.fileno(),65536)
                if not block:selector.unregister(key.fileobj)
                else:
                    remaining=STREAM_LIMIT-sum(map(len,buffers.values()))
                    buffers[key.fileobj].extend(block[:remaining])
                    require(len(block)<=remaining,'child output limit')
        process.wait(timeout=max(0.001,end-time.monotonic()))
    except BaseException as error:
        failure=str(error)
        try:os.killpg(process.pid,signal.SIGKILL)
        except ProcessLookupError:pass
        process.wait()
    finally:
        selector.close()
        for stream in buffers:stream.close()
    stdout=bytes(buffers[process.stdout]);stderr=bytes(buffers[process.stderr])
    (output/'stdout.log').write_bytes(stdout);(output/'stderr.log').write_bytes(stderr)
    return {'command':command,'exit_code':process.returncode,'failure':failure,'process_reaped':process.poll() is not None,'pid':process.pid},stdout

def unique(items):
    result={}
    for k,v in items:
        require(k not in result,'duplicate JSON key');result[k]=v
    return result


def validate_record(path,sources,spec,variant,revision):
    entry=spec['variants'][variant];path=regular(path)
    require(path.stat().st_size<=entry['record_limit_bytes'],'record output size')
    raw=path.read_bytes();require(len(raw)<=entry['inflated_limit_bytes'],'inflated record size')
    doc=json.loads(raw,object_pairs_hook=unique)
    require(set(doc)==set(entry['record_top_keys']) and type(doc['schema']) is int and doc['schema']==1,'complete record top keys/schema')
    recorded_sources={**sources,**spec['exports']}
    require(doc['source']=={'revision':revision,'files':{p:recorded_sources[p] for p in entry['record_source_paths']}},'complete recorded source identity')
    require([c['id'] for c in doc['cases']]==entry['case_ids'],'complete ordered scenario ids')
    require([sorted(c) for c in doc['cases']]==entry['case_keys'],'complete scenario fields')
    if variant=='alarm':
        require(doc['oracle']=={'node':'v16.20.2','tz':'UTC','firebase-admin':'5.13.1','mongoose':'5.1.2'},'alarm runtime')
        require([c['at'] for c in doc['cases']]==entry['case_times'],'fixed alarm case clock')
        schedule=entry['schedule'];require(sorted(doc['schedule'])==schedule['keys'] and len(doc['schedule']['records'])==schedule['registrations'] and doc['schedule']['at']==schedule['at'] and doc['schedule']['time']==schedule['time'],'full scheduled minute')
        require(sorted(doc['defaults'])==schedule['defaults_keys'],'complete defaults')
        for row in [*doc['cases'],doc['schedule']]:
            require(isinstance(row['calls'],list),'complete recorded calls')
            for call in row['calls']:
                require(call.get('kind') in ('http','https','store','gcm'),'known recording callback')
                if call['kind']=='https':require([call['host'],call['path'],call['method']] in spec['synthetic_https_routes'],'synthetic HTTPS host/path/method')
                elif call['kind']=='http':
                    url=urlsplit(call['url'])
                    require(url.scheme=='http' and not url.fragment and any(url.netloc==host and url.path.startswith(prefix) for host,prefix in spec['synthetic_http_routes']),'synthetic HTTP host/path')

    else:
        require(doc['node']=='v16.20.2' and doc['tz']=='UTC' and doc['at']==entry['record_clock'],'alert runtime/clock')
        if variant=='alerts':require([sorted(c) for c in doc['urls']]==entry['url_keys'],'complete URL cases')
    return doc


def input_checks(root,node,policy,spec):
    expected={str(root/p):digest for p,digest in {**policy['sources'],**policy['exports'],**spec['static_inputs']}.items()}
    expected.update({str(node):policy['node_sha256'],str(root/'server2/tools/golden/guards/delivery.cjs'):policy['guard_sha256'],str(root/'server2/tools/golden/policies/delivery.json'):policy['spec_sha256']})
    actual={};errors={}
    for name in expected:
        try:actual[name]=sha(regular(name))
        except (ValueError,OSError) as error:actual[name]=None;errors[name]=str(error)
    mismatches=[name for name,digest in expected.items() if actual[name]!=digest]
    return {'expected':expected,'actual':actual,'mismatches':mismatches,'errors':errors,'verified':not mismatches}


def execute(prepared):
    root,node,out,policy,spec=prepared;entry=spec['variants'][policy['variant']];out.mkdir(mode=0o700)
    pp=out/'policy.json';pp.write_text(json.dumps(policy,sort_keys=True)+'\n')
    command=[str(node),'--require',str(root/'server2/tools/golden/guards/delivery.cjs'),str(root/entry['driver']),policy['output']]
    env={'PATH':os.defpath,'LANG':'C','TZ':'UTC','NODE_ENV':'production','TW_REPO':str(root),'TW_REVISION':policy['revision'],'NODE_PATH':policy['dependency_roots']['common']['path']+'/node_modules','TW_ORACLE_POLICY':str(pp)}
    result={'command':command,'exit_code':None,'failure':None,'process_reaped':None,'child_started':False}
    output=Path(policy['output']);stdout=b''
    before=input_checks(root,node,policy,spec)
    result.update(input_checks_before=before,inputs_verified_before=before['verified'],node_expected_sha256=policy['node_sha256'],node_before_sha256=before['actual'][str(node)])
    try:
        require(result['inputs_verified_before'],'parent pre-run input identity')
        result['child_started']=True
        child_result,stdout=child(command,env,out,entry['deadline_seconds']);result.update(child_result)
        require(not result['failure'] and result['exit_code']==0,'guarded child failed')
        receipts=[]
        for line in stdout.decode().splitlines():
            try:row=json.loads(line,object_pairs_hook=unique)
            except json.JSONDecodeError:continue
            if isinstance(row,dict) and row.get('oracle_guard')==1:receipts.append(row)
        require(len(receipts)==1 and receipts[0]['profile']==PROFILE and receipts[0]['variant']==policy['variant'] and receipts[0]['status']=='RECORDED' and not receipts[0]['violations'],'clean guard receipt')
        validate_record(output,policy['sources'],spec,policy['variant'],policy['revision'])
        require(sha(output)==receipts[0]['output_sha256'],'output receipt identity')
        compressed=gzip.compress(output.read_bytes(),compresslevel=9,mtime=0)
        require(len(compressed)<=entry['gzip_limit_bytes'],'gzip record size')
        gz=out/'record.json.gz';gz.write_bytes(compressed)
        result.update(status='RECORDED_NOT_COMPARED',semantics='NOT_COMPARED',record_sha256=sha(output),gzip_sha256=sha(gz),guard=receipts[0])
    except (ValueError,OSError,KeyError,TypeError,EOFError) as error:
        result.update(status='BLOCKED',reason=str(error))
    finally:
        after=input_checks(root,node,policy,spec)
        result.update(input_checks_after=after,inputs_verified_after=after['verified'],node_after_sha256=after['actual'][str(node)])
        if not after['verified']:result.update(status='BLOCKED',reason=result.get('reason','')+'; parent post-run input identity')
        try:
            after_deps=dependencies(root,{k:r['path'] for k,r in policy['dependency_roots'].items()},{k:r['installed_manifest'] for k,r in policy['dependency_roots'].items()},spec)
            require(after_deps==policy['dependency_roots'],'dependency map changed');result['dependencies_verified_after']=True
        except (ValueError,OSError,KeyError,TypeError) as error:
            result.update(status='BLOCKED',reason=result.get('reason','')+'; '+str(error),dependencies_verified_after=False)
    if result['status']=='BLOCKED' and output.exists():
        failed=out/'failed-record.raw';output.rename(failed);result['retained_failed_output']=str(failed)
    result.update(variant=policy['variant'],policy_sha256=sha(pp),node_sha256=result['node_after_sha256'],exports=policy['exports'],guard_sha256=policy['guard_sha256'],spec_sha256=policy['spec_sha256'])
    (out/'report.json').write_text(json.dumps(result,indent=2)+'\n');return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[3])
    for name in ('node','source-report','out'):parser.add_argument('--'+name,type=Path,required=True)
    for group in ('common','firebase','models'):
        parser.add_argument('--'+group+'-deps',type=Path,required=True);parser.add_argument('--'+group+'-manifest',type=Path,required=True)
    parser.add_argument('--variant',choices=('alarm','alerts','malformed','air-filter'),required=True)
    parser.add_argument('--record',action='store_true',required=True,help='Only after separate root actual full-replay authorization')
    a=parser.parse_args();result=execute(prepare(a.root,a.node,{g:getattr(a,g+'_deps') for g in ('common','firebase','models')},{g:getattr(a,g+'_manifest') for g in ('common','firebase','models')},a.source_report,a.out,a.variant))
    print(json.dumps(result,sort_keys=True));return 0 if result['status']=='RECORDED_NOT_COMPARED' else 2


if __name__=='__main__':
    try:raise SystemExit(main())
    except (ValueError,OSError,KeyError,TypeError,subprocess.SubprocessError) as error:
        print('BLOCKED delivery input: '+str(error),file=sys.stderr);raise SystemExit(2)
