#!/usr/bin/env python3
"""One full towns recorder launcher. Actual replay requires separate root authority."""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import time

DRIVER_SHA = '153be6de9cd56676fd4ddc8c0312894353af3d5557a59d6e7868020cd6516913'
SOURCES = ('server/controllers/geo.controller.js', 'server/controllers/controllerTown.js',
           'server/models/town.js', 'server/controllers/controllerTown24h.js', 'server/lib/unitConverter.js')
DRIVER_PARTS = ('server','test','offline','record-towns.js')
GUARD_PARTS = ('server','test','offline','towns-oracle-guard.js')
DEADLINE = 10
STREAM_LIMIT = 2*1024*1024
RECORD_LIMIT = 2*1024*1024


def require(value, message):
    if not value: raise ValueError(message)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def regular(path):
    path=Path(path).absolute()
    require(path==path.resolve() and path.is_file(),'regular non-symlink input required')
    return path


def load(path):
    path=regular(path);require(path.stat().st_size<=2*1024*1024,'metadata size limit')
    def unique(items):
        out={}
        for key,value in items:
            require(key not in out,'duplicate JSON key');out[key]=value
        return out
    return json.loads(path.read_bytes(),object_pairs_hook=unique)


def dependencies(root,deps,manifest):
    deps=Path(deps).resolve();manifest=load(manifest)
    require(set(manifest)=={'regular_files','symlinks'},'verified dependency file map required')
    for name in ('package.json','package-lock.json'):
        require(sha(regular(deps/name))==sha(root/'server2/tools/golden/towns'/name),'dependency manifest identity')
    lock=load(deps/'package-lock.json')
    require(lock['packages']['']['dependencies']=={'mongoose':'5.1.2'},'mongoose-only dependency lock')
    require(load(deps/'node_modules/mongoose/package.json')['version']=='5.1.2','mongoose version')
    expected=manifest['regular_files']
    actual={str(p.relative_to(deps)) for p in (deps/'node_modules').rglob('*') if p.is_file() or p.is_symlink()}
    require(actual==set(expected)|set(manifest['symlinks']),'dependency file inventory')
    for name,target in manifest['symlinks'].items():
        link=deps/name
        require(name.startswith('node_modules/.bin/') and link.is_symlink() and str(link.readlink())==target and link.resolve().is_relative_to(deps/'node_modules'),'verified internal dependency link required')
    for name,digest in expected.items():
        require(name.startswith('node_modules/') and '..' not in Path(name).parts and not Path(name).is_absolute(),'dependency path')
        require(sha(regular(deps/name))==digest,'dependency file identity')
    return deps,expected


def prepare(root,node,deps,manifest,sources,out):
    root=Path(root).resolve();node=regular(node);out=Path(out).absolute()
    require(out==out.resolve() and out.parent==root/'reports' and not out.exists(),'new direct reports output required')
    require(subprocess.run(['git','-C',str(root),'check-ignore','-q',str(out)]).returncode==0,'ignored output required')
    version=subprocess.run([str(node),'--version'],env={'PATH':os.defpath,'LANG':'C'},capture_output=True,text=True,timeout=5)
    require(version.returncode==0 and version.stdout.strip()=='v16.20.2','Node16.20.2 required')
    driver=regular(root.joinpath(*DRIVER_PARTS));guard=regular(root.joinpath(*GUARD_PARTS))
    require(sha(driver)==DRIVER_SHA,'full original driver identity')
    deps,files=dependencies(root,deps,manifest)
    source_report=load(sources)
    require(type(source_report['schema']) is int and source_report['schema']==1 and set(SOURCES)<=set(source_report['legacy_sources']),'fixed source report required')
    selected={name:source_report['legacy_sources'][name] for name in SOURCES}
    require(all(isinstance(v,str) and len(v)==64 and all(c in '0123456789abcdef' for c in v) for v in selected.values()),'source digest required')
    policy={'schema':1,'root':str(root),'dependencies':str(deps),'dependency_files':files,
            'sources':selected,'driver_sha256':sha(driver),'guard_sha256':sha(guard),
            'output':str(out/'record.json.gz')}
    return root,node,out,policy


def child(command,env,output):
    process=subprocess.Popen(command,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE,start_new_session=True)
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
                    buffers[key.fileobj].extend(block)
                    require(sum(map(len,buffers.values()))<=STREAM_LIMIT,'child output limit')
        process.wait(timeout=max(0.001,end-time.monotonic()))
    except BaseException as error:
        failure=str(error)
        try: os.killpg(process.pid,signal.SIGKILL)
        except ProcessLookupError: pass
        process.wait()
    finally:
        selector.close()
        for stream in buffers:stream.close()
    stdout=bytes(buffers[process.stdout]);stderr=bytes(buffers[process.stderr])
    (output/'stdout.log').write_bytes(stdout);(output/'stderr.log').write_bytes(stderr)
    return {'command':command,'exit_code':process.returncode,'failure':failure,'process_reaped':process.poll() is not None},stdout


def validate_record(path,sources):
    require(path.is_file() and path.stat().st_size<=RECORD_LIMIT,'record output size/type')
    with gzip.GzipFile(fileobj=io.BytesIO(path.read_bytes())) as file:raw=file.read(8*1024*1024+1)
    require(len(raw)<=8*1024*1024,'inflated record size')
    doc=json.loads(raw)
    require(set(doc)=={'oracle','remaps','towns','lifecycle'} and len(doc['remaps'])==6 and len(doc['towns'])==5,'complete towns contract shape')
    require(doc['oracle']['files']==sources and doc['oracle']['runtime']=='v16.20.2','record source/runtime identity')
    require(doc['lifecycle']['mongoose']=='5.1.2' and doc['lifecycle']['connectionState']==0 and doc['lifecycle']['networkWrites']==0,'offline mongoose lifecycle')
    require(set(doc['lifecycle'])=={'makeResult','mongoose','connectionState','collectionWrites','networkWrites','first','sameProcess','coldLean'},'complete lifecycle contract')
    return doc


def execute(prepared):
    root,node,out,policy=prepared;out.mkdir(mode=0o700)
    policy_path=out/'policy.json';policy_path.write_text(json.dumps(policy,sort_keys=True)+'\n')
    command=[str(node),'--require',str(root.joinpath(*GUARD_PARTS)),str(root.joinpath(*DRIVER_PARTS)),policy['output']]
    env={'PATH':os.defpath,'LANG':'C','TZ':'UTC','NODE_ENV':'production','TW_REPO':str(root),
         'TW_MONGOOSE_MODULE':str(Path(policy['dependencies'])/'node_modules/mongoose'),
         'TW_TOWNS_POLICY':str(policy_path)}
    result,stdout=child(command,env,out);output=Path(policy['output'])
    try:
        require(not result['failure'] and result['exit_code']==0,'guarded child failed')
        receipts=[json.loads(line) for line in stdout.decode().splitlines() if line.strip()]
        require(len(receipts)==1 and receipts[0].get('towns_guard')==1 and receipts[0]['status']=='RECORDED' and not receipts[0]['violations'],'guard receipt missing/denied')
        validate_record(output,policy['sources'])
        result.update(status='RECORDED_NOT_COMPARED',semantics='NOT_COMPARED',record_sha256=sha(output),guard=receipts[0])
    except (ValueError,OSError,KeyError,TypeError) as error:
        result.update(status='BLOCKED',reason=str(error))
        if output.exists():
            failed=out/'failed-record.raw';output.rename(failed);result['retained_failed_output']=str(failed)
    result.update(policy_sha256=sha(policy_path),node_sha256=sha(node),driver_sha256=policy['driver_sha256'],guard_sha256=policy['guard_sha256'])
    (out/'report.json').write_text(json.dumps(result,indent=2)+'\n')
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[3])
    for name in ('node','deps','installed-manifest','source-report','out'):parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--record',action='store_true',required=True,help='Execute only within separately granted root scope; no fixture mutation')
    args=parser.parse_args()
    report=execute(prepare(args.root,args.node,args.deps,args.installed_manifest,args.source_report,args.out))
    print(json.dumps(report,sort_keys=True));return 0 if report['status']=='RECORDED_NOT_COMPARED' else 2


if __name__=='__main__':
    try:raise SystemExit(main())
    except (ValueError,OSError,KeyError,TypeError,subprocess.SubprocessError) as error:
        print('BLOCKED towns input: '+str(error),file=sys.stderr);raise SystemExit(2)
