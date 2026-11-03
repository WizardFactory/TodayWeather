#!/usr/bin/env python3
"""One complete air legacy recorder. Root must authorize actual replay separately."""
import argparse
import gzip
import io
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import time

# Only reuse the existing reviewed small byte/path/metadata helpers.
from replay_towns import require, regular, load, sha

PROFILE='air'
DEADLINE=90
STREAM_LIMIT=2*1024*1024


def dependencies(root,deps,manifest,spec):
    deps=regular(Path(deps)/'package.json').parent
    manifest=load(manifest)
    require(set(manifest)=={'regular_files','symlinks'},'verified dependency file map required')
    for name in ('package.json','package-lock.json'):
        require(sha(regular(deps/name))==sha(root/'server2/tools/golden'/PROFILE/name),'dependency manifest identity')
    lock=load(deps/'package-lock.json')
    require(lock['packages']['']['dependencies']==spec['direct_dependencies'],'direct dependency lock')
    for name,version in spec['direct_dependencies'].items():
        require(load(deps/'node_modules'/name/'package.json')['version']==version,'dependency version '+name)
    for name,pkg in lock['packages'].items():
        if name:
            require(pkg['resolved'].startswith('https://registry.npmjs.org/') and pkg.get('integrity'),'official registry locked package')
            require(load(deps/name/'package.json')['version']==pkg['version'],'locked transitive version')
    expected=manifest['regular_files'];links=manifest['symlinks']
    actual={str(p.relative_to(deps)) for p in (deps/'node_modules').rglob('*') if p.is_file() or p.is_symlink()}
    require(actual==set(expected)|set(links),'dependency file inventory')
    for name,target in links.items():
        link=deps/name
        require(name.startswith('node_modules/') and Path(name).parent.name=='.bin' and not Path(name).is_absolute() and '..' not in Path(name).parts,'dependency bin path')
        require(link.is_symlink() and str(link.readlink())==target and link.resolve().is_file() and link.resolve().is_relative_to(deps/'node_modules'),'verified internal bin link')
    for name,digest in expected.items():
        require(name.startswith('node_modules/') and '..' not in Path(name).parts and not Path(name).is_absolute(),'dependency file path')
        require(sha(regular(deps/name))==digest,'dependency file identity')
    return deps,expected


def prepare(root,node,deps,manifest,sources,out):
    root=Path(root).resolve();node=regular(node);out=Path(out).absolute()
    evidence=root/'reports/sdlc/issue-2819-oracle-provenance/phase4-b1'
    require(out==out.resolve() and out.parent==evidence and not out.exists(),'new owned B1 output required')
    spec_path=regular(root/'server2/tools/golden/policies'/(PROFILE+'.json'));spec=load(spec_path)
    require(spec['schema']==1 and spec['profile']==PROFILE and spec['deadline_seconds']==DEADLINE and spec['stream_limit_bytes']==STREAM_LIMIT,'fixed profile specification')
    version=subprocess.run([str(node),'--version'],env={'PATH':os.defpath,'LANG':'C'},capture_output=True,text=True,timeout=5)
    require(version.returncode==0 and version.stdout.strip()=='v16.20.2','Node16.20.2 required')
    for name,digest in spec['exports'].items():
        require(sha(regular(root/name))==digest,'full original export identity')
    guard=regular(root/'server2/tools/golden/guards'/(PROFILE+'.cjs'))
    deps,files=dependencies(root,deps,manifest,spec)
    source_report=load(sources)
    require(type(source_report['schema']) is int and source_report['schema']==1 and set(spec['source_paths'])<=set(source_report['legacy_sources']),'fixed source report required')
    selected={name:source_report['legacy_sources'][name] for name in spec['source_paths']}
    require(all(isinstance(v,str) and len(v)==64 and all(c in '0123456789abcdef' for c in v) for v in selected.values()),'source digest required')
    policy={'installed_manifest':str(regular(manifest)),'installed_manifest_sha256':sha(regular(manifest)),'schema':1,'profile':PROFILE,'root':str(root),'dependencies':str(deps),'dependency_files':files,'sources':selected,'exports':spec['exports'],'output':str(out/spec['record_name']),'guard_sha256':sha(guard),'spec_sha256':sha(spec_path)}
    return root,node,out,policy,spec


def child(command,env,output):
    process=subprocess.Popen(command,env=env,cwd=output,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
    selector=selectors.DefaultSelector();buffers={process.stdout:bytearray(),process.stderr:bytearray()}
    for stream in buffers:selector.register(stream,selectors.EVENT_READ)
    failure=None;end=time.monotonic()+DEADLINE
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
    out={}
    for k,v in items:
        require(k not in out,'duplicate JSON key');out[k]=v
    return out


def validate_record(path,sources,spec):
    path=regular(path);require(path.stat().st_size<=spec['record_limit_bytes'],'record output size')
    raw=path.read_bytes()
    if spec['encoding']=='gzip':
        with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:raw=stream.read(spec['inflated_limit_bytes']+1)
    require(len(raw)<=spec['inflated_limit_bytes'],'inflated record size')
    doc=json.loads(raw,object_pairs_hook=unique)
    require(set(doc)==set(spec['record_top_keys']),'complete record top keys')
    for pointer,length in spec['array_lengths'].items():
        value=doc
        for key in pointer.strip('/').split('/'):value=value[int(key)] if isinstance(value,list) else value[key]
        require(isinstance(value,list) and len(value)==length,'complete array '+pointer)
    recorded={p:sources[p] for p in spec['record_source_paths']}
    # Relocated immutable helpers are actual recorder reads, separate from product source.
    recorded.update({p:spec['exports'][p] for p in spec.get('record_export_paths',[])})
    if PROFILE=='nation':
        require(doc['node']=='v16.20.2' and doc['dependencies']==spec['direct_dependencies'] and doc['now']==spec['record_clock'],'nation runtime/dependency/clock identity')
        require(doc['hash']==recorded,'complete recorded source identity')
        require([c['id'] for c in doc['scenarios']]==spec['scenario_ids'],'complete ordered nation scenario ids')
        require(all('body' in c or 'error' in c for c in doc['scenarios']),'complete nation answers')
    else:
        require(doc['schema']==1 and doc['oracle']=={'node':'v16.20.2','tz':'UTC','mongoose':'5.1.2'},'air runtime identity')
        require(doc['source']=={'files':recorded} and type(doc['codeTable']) is int,'complete air source/code table')
    return doc


def execute(prepared):
    root,node,out,policy,spec=prepared;out.mkdir(mode=0o700)
    policy_path=out/'policy.json';policy_path.write_text(json.dumps(policy,sort_keys=True)+'\n')
    driver=root/spec['driver'];guard=root/'server2/tools/golden/guards'/(PROFILE+'.cjs')
    args=[str(root),policy['output']] if PROFILE=='nation' else [policy['output']]
    command=[str(node),'--require',str(guard),str(driver),*args]
    env={'PATH':os.defpath,'LANG':'C','TZ':'UTC','NODE_ENV':'production','TW_REPO':str(root),'NODE_PATH':str(policy['dependencies']+'/node_modules'),'TW_ORACLE_POLICY':str(policy_path)}
    result,stdout=child(command,env,out);output=Path(policy['output'])
    try:
        require(not result['failure'] and result['exit_code']==0,'guarded child failed')
        require(sha(regular(policy['installed_manifest']))==policy['installed_manifest_sha256'],'installed manifest changed')
        _,after=dependencies(root,policy['dependencies'],policy['installed_manifest'],spec)
        require(after==policy['dependency_files'],'dependency map changed')
        result['dependencies_verified_after']=True
        receipts=[]
        for line in stdout.decode().splitlines():
            try:row=json.loads(line)
            except json.JSONDecodeError:continue
            if isinstance(row,dict) and row.get('oracle_guard')==1:receipts.append(row)
        require(len(receipts)==1 and receipts[0]['profile']==PROFILE and receipts[0]['status']=='RECORDED' and not receipts[0]['violations'],'clean guard receipt required')
        validate_record(output,policy['sources'],spec)
        require(sha(output)==receipts[0]['output_sha256'],'output receipt identity')
        result.update(status='RECORDED_NOT_COMPARED',semantics='NOT_COMPARED',record_sha256=sha(output),guard=receipts[0])
    except (ValueError,OSError,KeyError,TypeError,EOFError,gzip.BadGzipFile) as error:
        result.update(status='BLOCKED',reason=str(error))
        if output.exists():
            failed=out/'failed-record.raw';output.rename(failed);result['retained_failed_output']=str(failed)
    result.update(policy_sha256=sha(policy_path),node_sha256=sha(node),exports=policy['exports'],guard_sha256=policy['guard_sha256'],spec_sha256=policy['spec_sha256'])
    (out/'report.json').write_text(json.dumps(result,indent=2)+'\n');return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[3])
    for name in ('node','deps','installed-manifest','source-report','out'):parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--record',action='store_true',required=True,help='Use only after separate root authorization of actual full replay')
    a=parser.parse_args();r=execute(prepare(a.root,a.node,a.deps,a.installed_manifest,a.source_report,a.out))
    print(json.dumps(r,sort_keys=True));return 0 if r['status']=='RECORDED_NOT_COMPARED' else 2


if __name__=='__main__':
    try:raise SystemExit(main())
    except (ValueError,OSError,KeyError,TypeError,subprocess.SubprocessError) as error:
        print('BLOCKED '+PROFILE+' input: '+str(error),file=sys.stderr);raise SystemExit(2)
