"""Synthetic B1 controls. Never execute original recorder or legacy source code."""
from copy import deepcopy
import gzip
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import replay_nation as n

ROOT=Path(__file__).resolve().parents[3]
EVIDENCE=ROOT/'reports/sdlc/issue-2819-oracle-provenance/phase4-b1'
NODE=EVIDENCE.parent/'phase2-toolchain/runtime/node-v16.20.2-darwin-arm64/bin/node'
FAILSAFE="""for(const [m,ns] of [['net',['connect','createConnection','createServer']],['tls',['connect','createServer']],['http',['get','request','createServer']],['https',['get','request','createServer']],['dgram',['createSocket']],['child_process',['spawn','spawnSync','exec','execFile','fork']]])for(const n of ns)require(m)[n]=()=>{throw Error('CANARY_UNGUARDED '+m+'.'+n)};require('net').Socket.prototype.connect=()=>{throw Error('CANARY_UNGUARDED socket')};require('worker_threads').Worker=function(){throw Error('CANARY_UNGUARDED worker')};for(const ns of [require('dns'),require('dns').promises])for(const n of ['lookup','resolve','resolve4'])ns[n]=()=>{throw Error('CANARY_UNGUARDED dns')};"""


def synthetic(root,api):
    spec=json.loads((ROOT/'server2/tools/golden/policies'/(api.PROFILE+'.json')).read_text())
    for name in [*spec['exports'],'server2/tools/golden/guards/'+api.PROFILE+'.cjs','server2/tools/golden/policies/'+api.PROFILE+'.json','server2/tools/golden/'+api.PROFILE+'/package.json','server2/tools/golden/'+api.PROFILE+'/package-lock.json']:
        dest=root/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/name,dest)
    for name in spec['source_paths']:
        file=root/name;file.parent.mkdir(parents=True,exist_ok=True)
        if name.endswith('.json'):text='{"hello":"Hello"}\n'
        elif name.endswith('error.jade'):text='extends layout\nblock content\n  p= message\n'
        elif name.endswith('layout.jade'):text='doctype html\nhtml\n  body\n    block content\n'
        elif name.endswith('.csv'):text='first,second,region,point,city\n'
        else:
            text='// Synthetic source bytes; never evaluated.\n'
            for source,start,end in spec['markers']:
                if source==name:text+=start+'\nSYNTHETIC\n'+end+'\n'
        file.write_text(text)
    e=root/'reports/sdlc/issue-2819-oracle-provenance/phase4-b1';e.mkdir(parents=True)
    source=e/'source-report.json';source.write_text(json.dumps({'schema':1,'legacy_sources':{p:api.sha(root/p) for p in spec['source_paths']}}))
    return source,spec


class FixedBoundaryControls:
    API=None

    def setUp(self):
        self.assertTrue(NODE.is_file(),'qualified Node16 required; missing setup is not PASS')
        self.assertTrue((EVIDENCE/(self.API.PROFILE+'-installed-files.json')).is_file(),'qualified installed map required')
        self.temp=tempfile.TemporaryDirectory(prefix='synthetic-'+self.API.PROFILE+'-',dir=EVIDENCE);self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve();self.sources,self.spec=synthetic(self.root,self.API);self.index=0
        self.addCleanup(self.retain_runs)

    def retain_runs(self):
        destination=EVIDENCE/'synthetic-evidence'/self.root.name
        destination.mkdir(parents=True,exist_ok=True)
        (destination/'test.json').write_text(json.dumps({'test':self.id(),'profile':self.API.PROFILE,'original_recorder_or_legacy_executed':False}))
        for run in (self.root/'reports/sdlc/issue-2819-oracle-provenance/phase4-b1').glob('run*'):
            if run.is_dir():shutil.copytree(run,destination/run.name)

    def prepared(self,**extra):
        self.index+=1
        args={'root':self.root,'node':NODE,'deps':EVIDENCE/(self.API.PROFILE+'-deps'),'manifest':EVIDENCE/(self.API.PROFILE+'-installed-files.json'),'sources':self.sources,'out':self.root/'reports/sdlc/issue-2819-oracle-provenance/phase4-b1'/('run'+str(self.index))};args.update(extra)
        return self.API.prepare(**args)

    def canary_prepared(self,code):
        root,node,out,policy,spec=self.prepared();driver=root/spec['driver'];driver.write_text(code)
        spec['exports'][spec['driver']]=self.API.sha(driver);policy['exports']=deepcopy(spec['exports'])
        sp=root/'server2/tools/golden/policies'/(self.API.PROFILE+'.json');sp.write_text(json.dumps(spec,indent=2)+'\n');policy['spec_sha256']=self.API.sha(sp)
        return root,node,out,policy,spec

    def run_canary(self,code,expected=None,change=None,envextra=None,timeout=None):
        root,node,out,policy,spec=self.canary_prepared(code);out.mkdir()
        if change:change(policy)
        failsafe=out/'failsafe.cjs';failsafe.write_text(FAILSAFE)
        policy_path=out/'policy.json';policy_path.write_text(json.dumps(policy,sort_keys=True))
        env={'PATH':os.defpath,'LANG':'C','TZ':'UTC','NODE_ENV':'production','TW_REPO':str(root),'NODE_PATH':policy['dependencies']+'/node_modules','TW_ORACLE_POLICY':str(policy_path)}
        if envextra:env.update(envextra)
        args=[str(root),policy['output']] if self.API.PROFILE=='nation' else [policy['output']]
        command=[str(node),'--require',str(failsafe),'--require',str(root/'server2/tools/golden/guards'/(self.API.PROFILE+'.cjs')),str(root/spec['driver']),*args]
        with patch.object(self.API,'DEADLINE',timeout or self.API.DEADLINE):result,stdout=self.API.child(command,env,out)
        self.assertTrue(result['process_reaped'],result)
        stderr=(out/'stderr.log').read_text()
        self.assertNotIn('CANARY_UNGUARDED',stderr)
        if expected:
            self.assertNotEqual(result['exit_code'],0,result);self.assertIn(expected,result['failure'] or (stderr+stdout.decode(errors='replace')))
        else:self.assertEqual(result['exit_code'],0,stderr)
        (out/'control-result.json').write_text(json.dumps(result,indent=2)+'\n')
        return result,out,stdout

    def payload(self,policy,spec):
        doc={k:None for k in spec['record_top_keys']}
        if self.API.PROFILE=='nation':
            doc.update(node='v16.20.2',dependencies=spec['direct_dependencies'],now=spec['record_clock'],hash={p:policy['sources'][p] for p in spec['record_source_paths']},scenarios=[{'id':i,'body':'{}','cityCalls':[]} for i in spec['scenario_ids']])
        else:doc.update(schema=1,oracle={'node':'v16.20.2','tz':'UTC','mongoose':'5.1.2'},source={'files':deepcopy(policy['sources'])},codeTable=1)
        for pointer,length in spec['array_lengths'].items():
            parts=pointer.strip('/').split('/');v=doc
            for key in parts[:-1]:
                if isinstance(v,list):v=v[int(key)]
                else:
                    if v.get(key) is None:v[key]={}
                    v=v[key]
            v[parts[-1]]=[{} for _ in range(length)]
        if self.API.PROFILE=='nation':
            for c,i in zip(doc['scenarios'],spec['scenario_ids']):c.update(id=i,body='{}',cityCalls=[])
        if self.API.PROFILE=='air':doc['source']['files'].update({p:spec['exports'][p] for p in spec.get('record_export_paths',[])})
        return doc

    def positive_prepared(self):
        p=self.canary_prepared('')
        root,node,out,policy,spec=p;doc=self.payload(policy,spec)
        code='const fs=require("fs"),path=require("path");const root=process.env.TW_REPO;'
        code+='for(const p of '+json.dumps(spec['source_paths'])+')fs.readFileSync(path.join(root,p));'
        code+='const m=require("mongoose");const model=m.model("Synthetic",new m.Schema({n:Number}));const q=model.update({},{$set:{n:"7"}});if(q._castUpdate(q._update).$set.n!==7)throw Error("synthetic cast");require("async");'
        if self.API.PROFILE=='nation':
            code+='const i=require("i18n");i.configure({locales:["en","ko","ja","zh-CN","de","zh-TW"],directory:path.join(root,"server/locales"),updateFiles:false});if(i.__({phrase:"hello",locale:"en"})!=="Hello")throw Error("synthetic locale");if(!require("jade").renderFile(path.join(root,"server/views/error.jade"),{message:"synthetic"}).includes("synthetic"))throw Error("synthetic template");fs.mkdirSync(path.dirname(process.argv[3]),{recursive:true});'
        else:
            code+='require("xml2js").parseString("<x>synthetic</x>",(e,v)=>{if(e||v.x!=="synthetic")throw Error("synthetic xml")});const cwd=process.cwd();process.chdir(path.join(root,"server"));fs.readFileSync("./utils/data/region.csv");process.chdir(cwd);'
        raw='JSON.stringify('+json.dumps(doc,ensure_ascii=True)+')';data=raw if self.API.PROFILE=='nation' else 'require("zlib").gzipSync(Buffer.from('+raw+'),{mtime:0})'
        code+='fs.writeFileSync(process.argv['+('3' if self.API.PROFILE=='nation' else '2')+'],'+data+');'
        driver=root/spec['driver'];driver.write_text(code);spec['exports'][spec['driver']]=self.API.sha(driver);policy['exports']=deepcopy(spec['exports']);sp=root/'server2/tools/golden/policies'/(self.API.PROFILE+'.json');sp.write_text(json.dumps(spec,indent=2)+'\n');policy['spec_sha256']=self.API.sha(sp)
        return root,node,out,policy,spec

    def test_positive_synthetic_guard_and_launcher_with_actual_pinned_packages(self):
        prepared=self.positive_prepared();spec=prepared[4]
        result=self.API.execute(prepared)
        self.assertEqual(result['status'],'RECORDED_NOT_COMPARED',result)
        self.assertEqual(result['semantics'],'NOT_COMPARED')
        self.assertEqual(len(result['guard']['sources']),len(spec['source_paths']))
        self.assertTrue(result['guard']['modules'])
        self.assertEqual(result['guard']['transport_calls'],0)

    def test_launcher_rejects_node_export_source_and_output_identity(self):
        with self.assertRaisesRegex(ValueError,'Node16.20.2'):self.prepared(node=Path('/usr/bin/false'))
        d=self.root/self.spec['driver'];before=d.read_bytes();d.write_bytes(before+b'\n')
        with self.assertRaisesRegex(ValueError,'full original export'):self.prepared()
        d.write_bytes(before);source=json.loads(self.sources.read_text());source['legacy_sources'][self.spec['source_paths'][0]]='bad';self.sources.write_text(json.dumps(source))
        with self.assertRaisesRegex(ValueError,'source digest'):self.prepared()
        with self.assertRaisesRegex(ValueError,'new owned B1'):self.prepared(out=self.root/'wrong')

    def test_changed_dependency_byte_extra_file_and_wrong_version_fail_before_child(self):
        copied=self.root/'copied-deps';shutil.copytree(EVIDENCE/(self.API.PROFILE+'-deps'),copied,symlinks=True)
        package=copied/'node_modules/mongoose/package.json';before=package.read_bytes();d=json.loads(before);d['version']='5.1.3';package.write_text(json.dumps(d))
        with self.assertRaisesRegex(ValueError,'dependency version'):self.prepared(deps=copied)
        package.write_bytes(before+b'\n')
        with self.assertRaisesRegex(ValueError,'dependency file identity'):self.prepared(deps=copied)
        package.write_bytes(before);(copied/'node_modules/extra.cjs').write_text('throw Error("not allowed")')
        with self.assertRaisesRegex(ValueError,'dependency file inventory'):self.prepared(deps=copied)

    def test_source_marker_symlink_and_private_read_are_denied(self):
        self.run_canary('throw Error("must not execute")','ORACLE_DENIED input identity',lambda p:p['sources'].__setitem__(self.spec['source_paths'][0],'0'*64))
        source=self.root/self.spec['markers'][0][0];text=source.read_text();source.write_text(text.replace(self.spec['markers'][0][1],'missing-marker'))
        d=json.loads(self.sources.read_text());d['legacy_sources'][self.spec['markers'][0][0]]=self.API.sha(source);self.sources.write_text(json.dumps(d))
        self.run_canary('throw Error("must not execute")','ORACLE_DENIED extraction marker')
        source.write_text(text);d['legacy_sources'][self.spec['markers'][0][0]]=self.API.sha(source);self.sources.write_text(json.dumps(d))
        private=self.root/'private-test.txt';private.write_text('synthetic public canary')
        self.run_canary('require("fs").readFileSync('+json.dumps(str(private))+')','ORACLE_DENIED private read')
        source.unlink();source.symlink_to(private)
        self.run_canary('throw Error("must not execute")','ORACLE_DENIED symlink')

    def test_module_environment_and_caught_violation_remain_denied(self):
        self.run_canary('require("inspector")','ORACLE_DENIED builtin inspector')
        foreign=self.root/'not-declared.cjs';foreign.write_text('throw Error("CANARY_EVALUATED")')
        self.run_canary('require('+json.dumps(str(foreign))+')','ORACLE_DENIED private metadata')
        self.run_canary('throw Error("must not execute")','ORACLE_DENIED inherited environment',envextra={'UNEXPECTED_SYNTHETIC':'x'})
        self.run_canary('try{require("http").get("http://canary.invalid")}catch(e){}','http.get')

    def test_transport_dns_udp_child_worker_and_mongoose_are_denied(self):
        for code,reason in [
            ('require("net").connect(1,"127.0.0.1")','net.connect'),('require("http").get("http://canary.invalid")','http.get'),('require("https").get("https://canary.invalid")','https.get'),('require("dns").lookup("canary.invalid",()=>{})','dns.lookup'),('require("dns").promises.lookup("canary.invalid")','dns.promises.lookup'),('require("dgram").createSocket("udp4")','dgram.createSocket'),('require("child_process").spawn("false")','child_process.spawn'),('new (require("worker_threads").Worker)("",{eval:true})','worker_threads.Worker'),('require("mongoose").connect("mongodb://canary.invalid/test")','mongoose.connect'),('require("mongoose").connection.openUri("mongodb://canary.invalid/test")','mongoose.Connection.openUri')]:
            with self.subTest(reason=reason):self.run_canary(code,'ORACLE_DENIED '+reason)

    def test_sync_async_stream_fd_and_write_surfaces_are_denied(self):
        for code,reason in [
            ('require("fs").createReadStream("private")','filesystem createReadStream'),('require("fs").promises.readFile("private")','filesystem promises readFile'),('require("fs").readFile("private",()=>{})','filesystem readFile'),('require("fs").readFileSync(1000)','unowned descriptor read'),('require("fs").writeFileSync("other","x")','output write'),('require("fs").renameSync("a","b")','filesystem renameSync'),('process.chdir("/")','chdir'),('setInterval(()=>{},1000)','background interval'),('require("fs").openSync(process.argv[1],"w")','open write')]:
            with self.subTest(reason=reason):self.run_canary(code,'ORACLE_DENIED '+reason)
        arg='3' if self.API.PROFILE=='nation' else '2'
        self.run_canary('const f=require("fs"),p=process.argv['+arg+'];f.writeFileSync(p,"x");f.writeFileSync(p,"y")','ORACLE_DENIED output write')
        self.run_canary('require("fs").writeFileSync(process.argv['+arg+'],Buffer.alloc('+str(self.spec['record_limit_bytes']+1)+'))','ORACLE_DENIED output size')

    def test_existing_and_symlink_output_cannot_overwrite(self):
        _,out,_=self.run_canary('throw Error("must not execute")','ORACLE_DENIED output exists',lambda p:Path(p['output']).write_text('protected'))
        self.assertEqual((out/self.spec['record_name']).read_text(),'protected')
        target=self.root/'target-test.txt';target.write_text('protected')
        self.run_canary('throw Error("must not execute")','ORACLE_DENIED output exists',lambda p:Path(p['output']).symlink_to(target))
        self.assertEqual(target.read_text(),'protected')

    def test_timeout_and_stream_limit_reap_owned_process(self):
        _,out,stdout=self.run_canary('console.log("SYNTHETIC_WAIT");setTimeout(()=>{},1000000)','child deadline',timeout=1.5)
        self.assertIn(b'SYNTHETIC_WAIT',stdout)
        _,out,_=self.run_canary('process.stdout.write("x".repeat(3*1024*1024))','child output limit')
        self.assertLessEqual((out/'stdout.log').stat().st_size+(out/'stderr.log').stat().st_size,self.API.STREAM_LIMIT)

    def test_dependency_tree_change_after_child_is_not_accepted(self):
        prepared=self.positive_prepared();root,node,out,policy,spec=prepared
        copied=self.root/'post-change-deps';shutil.copytree(Path(policy['dependencies']),copied,symlinks=True)
        policy['dependencies']=str(copied);original=self.API.child
        def change_after_child(*args):
            result=original(*args)
            (copied/'node_modules/unexpected-after-child.cjs').write_text('synthetic new file')
            return result
        with patch.object(self.API,'child',side_effect=change_after_child):result=self.API.execute(prepared)
        self.assertEqual(result['status'],'BLOCKED')
        self.assertTrue(result['process_reaped'])
        self.assertIn('retained_failed_output',result)

    def test_invalid_partial_or_oversized_inflated_record_is_not_accepted(self):
        prepared=self.canary_prepared('require("fs").writeFileSync(process.argv['+('3' if self.API.PROFILE=='nation' else '2')+'],"partial")')
        result=self.API.execute(prepared);self.assertEqual(result['status'],'BLOCKED');self.assertIn('retained_failed_output',result)
        root,node,out,policy,spec=prepared
        path=out/'inflated.gz';path.write_bytes(gzip.compress(b' '* (spec['inflated_limit_bytes']+1)))
        altered=deepcopy(spec);altered['encoding']='gzip'
        with self.assertRaisesRegex(ValueError,'inflated record size'):self.API.validate_record(path,policy['sources'],altered)


class NationBoundary(FixedBoundaryControls,unittest.TestCase):
    API=n


if __name__=='__main__':unittest.main()
