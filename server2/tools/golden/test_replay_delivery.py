"""B2 synthetic-only qualification: never import Firebase SDK, legacy exports or models."""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import replay_delivery as d
from test_replay_nation import FAILSAFE

ROOT=Path(__file__).resolve().parents[3]
EVIDENCE=ROOT/'reports/sdlc/issue-2819-oracle-provenance/phase4-b2'
NODE=EVIDENCE.parent/'phase2-toolchain/runtime/node-v16.20.2-darwin-arm64/bin/node'


class DeliveryControls(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='synthetic-delivery-',dir=EVIDENCE)
        self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name).resolve();self.index=0
        self.spec=json.loads((ROOT/'server2/tools/golden/policies/delivery.json').read_text())
        self.roots={};self.manifests={}
        for group,meta in self.spec['dependency_roots'].items():
            deps=self.root/('deps-'+group);deps.mkdir();self.roots[group]=deps
            packages={'':{'dependencies':meta['direct_dependencies']}}
            for name,version in meta['direct_dependencies'].items():
                p=deps/'node_modules'/name;p.mkdir(parents=True)
                (p/'package.json').write_text(json.dumps({'name':name,'version':version,'main':'index.js'}))
                text='module.exports={synthetic:'+json.dumps(name)+'};'
                if name=='mongoose':text='function M(){};function C(){};module.exports={synthetic:"mongoose",Mongoose:M,Connection:C};'
                (p/'index.js').write_text(text)
                packages['node_modules/'+name]={'version':version,'resolved':'https://registry.npmjs.org/'+name+'/-/synthetic.tgz','integrity':'sha512-synthetic'}
            meta['packages']=len(packages)-1
            (deps/'package.json').write_text(json.dumps({'dependencies':meta['direct_dependencies']}))
            (deps/'package-lock.json').write_text(json.dumps({'packages':packages}))
            for name in ('package.json','package-lock.json'):
                p=self.root/meta['manifest_dir']/name;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(deps/name,p)
            self.reindex(group)
        for name in self.spec['exports']:
            p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('throw Error("ORIGINAL_EXPORT_MUST_NOT_EXECUTE");')
            self.spec['exports'][name]=d.sha(p)
        for name in self.spec['source_paths']:
            p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True)
            p.write_text('{"hello":"Hello"}' if name.endswith('.json') else 'throw Error("LEGACY_SOURCE_MUST_NOT_EXECUTE");')
        for name in self.spec['static_inputs']:
            p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/name,p);self.spec['static_inputs'][name]=d.sha(p)
        for name in ('guards/delivery.cjs',):
            p=self.root/'server2/tools/golden'/name;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/'server2/tools/golden'/name,p)
        e=self.root/'reports/sdlc/issue-2819-oracle-provenance/phase4-b2';e.mkdir(parents=True)
        self.source=e/'source.json';self.source.write_text(json.dumps({'schema':1,'legacy_sources':{p:d.sha(self.root/p) for p in self.spec['source_paths']}}))
        self.addCleanup(self.retain)

    def reindex(self,group):
        deps=self.roots[group];files={str(p.relative_to(deps)):d.sha(p) for p in sorted((deps/'node_modules').rglob('*')) if p.is_file()}
        p=self.root/(group+'-files.json');p.write_text(json.dumps({'regular_files':files,'symlinks':{}}));self.manifests[group]=p

    def retain(self):
        dest=EVIDENCE/'synthetic-evidence'/self.root.name;dest.mkdir(parents=True,exist_ok=True)
        (dest/'test.json').write_text(json.dumps({'test':self.id(),'SDK_legacy_model_loaded':False}))
        base=self.root/'reports/sdlc/issue-2819-oracle-provenance/phase4-b2'
        for p in base.glob('run*'):
            if p.is_dir():shutil.copytree(p,dest/p.name)

    def prepared(self,code='',variant='alarm'):
        self.index+=1;spec=deepcopy(self.spec);entry=spec['variants'][variant]
        p=self.root/entry['driver'];p.write_text(code)
        for name in spec['exports']:spec['exports'][name]=d.sha(self.root/name)
        sp=self.root/'server2/tools/golden/policies/delivery.json';sp.parent.mkdir(parents=True,exist_ok=True);sp.write_text(json.dumps(spec,indent=2)+'\n')
        deps=d.dependencies(self.root,self.roots,self.manifests,spec)
        sources=json.loads(self.source.read_text())['legacy_sources'];selected={p:sources[p] for p in entry['source_paths']}
        out=self.root/'reports/sdlc/issue-2819-oracle-provenance/phase4-b2'/('run'+str(self.index))
        policy={'schema':1,'profile':'delivery','variant':variant,'root':str(self.root),'revision':'c'*40,'dependency_roots':deps,'sources':selected,'exports':spec['exports'],'output':str(out/entry['record_name']),'guard_sha256':d.sha(self.root/'server2/tools/golden/guards/delivery.cjs'),'spec_sha256':d.sha(sp),'node_sha256':d.sha(NODE)}
        return self.root,NODE,out,policy,spec

    def run_code(self,code,expected=None,variant='alarm',change=None,envextra=None,deadline=None):
        root,node,out,policy,spec=self.prepared(code,variant);out.mkdir()
        if change:change(policy,spec)
        failsafe=out/'failsafe.cjs';failsafe.write_text(FAILSAFE)
        pp=out/'policy.json';pp.write_text(json.dumps(policy,sort_keys=True))
        env={'PATH':os.defpath,'LANG':'C','TZ':'UTC','NODE_ENV':'production','TW_REPO':str(root),'TW_REVISION':policy['revision'],'NODE_PATH':str(self.roots['common']/'node_modules'),'TW_ORACLE_POLICY':str(pp)}
        if envextra:env.update(envextra)
        command=[str(node),'--require',str(failsafe),'--require',str(root/'server2/tools/golden/guards/delivery.cjs'),str(root/spec['variants'][variant]['driver']),policy['output']]
        result,stdout=d.child(command,env,out,deadline)
        (out/'control-result.json').write_text(json.dumps(result,indent=2)+'\n')
        stderr=(out/'stderr.log').read_text();self.assertTrue(result['process_reaped']);self.assertNotIn('CANARY_UNGUARDED',stderr)
        self.assertNotIn('ORIGINAL_EXPORT_MUST_NOT_EXECUTE',stderr);self.assertNotIn('LEGACY_SOURCE_MUST_NOT_EXECUTE',stderr)
        if expected:self.assertNotEqual(result['exit_code'],0,stderr);self.assertIn(expected,result['failure'] or stderr+stdout.decode(errors='replace'))
        else:self.assertEqual(result['exit_code'],0,stderr)
        return result,out,stdout

    def synthetic_doc(self,variant,policy,spec):
        e=spec['variants'][variant];doc={k:None for k in e['record_top_keys']}
        recorded_sources={**policy['sources'],**spec['exports']}
        doc.update(schema=1,source={'revision':policy['revision'],'files':{p:recorded_sources[p] for p in e['record_source_paths']}},cases=[])
        for i,keys in enumerate(e['case_keys']):
            case={k:None for k in keys};case['id']=e['case_ids'][i]
            if variant=='alarm':case.update(at=e['case_times'][i],calls=[])
            doc['cases'].append(case)
        if variant=='alarm':
            s=e['schedule'];doc.update(oracle={'node':'v16.20.2','tz':'UTC','firebase-admin':'5.13.1','mongoose':'5.1.2'},defaults=dict.fromkeys(s['defaults_keys']),schedule=dict.fromkeys(s['keys']))
            doc['schedule'].update(records=[{}]*s['registrations'],at=s['at'],time=s['time'],calls=[])
        else:
            doc.update(node='v16.20.2',tz='UTC',at=e['record_clock'])
            if variant=='alerts':doc['urls']=[dict.fromkeys(k) for k in e['url_keys']]
        return doc

    def test_launcher_preflight_identity_output_node_and_sources(self):
        prepared=self.prepared();root,node,out,policy,spec=prepared
        def prepare(**changes):
            args=dict(root=root,node=node,roots=self.roots,manifests=self.manifests,sources=self.source,out=out,variant='alarm');args.update(changes)
            with patch.object(d.subprocess,'check_output',return_value=b'c'*40+b'\n'):
                return d.prepare(**args)
        actual=prepare();self.assertEqual(actual[3]['revision'],'c'*40);self.assertEqual(actual[3]['node_sha256'],d.sha(NODE))
        with self.assertRaisesRegex(ValueError,'Node16'):prepare(node=Path('/usr/bin/false'))
        with self.assertRaisesRegex(ValueError,'new owned B2'):prepare(out=root/'outside')
        driver=root/spec['variants']['alarm']['driver'];old=driver.read_bytes();driver.write_bytes(old+b'\n')
        with self.assertRaisesRegex(ValueError,'export/static'):prepare()
        driver.write_bytes(old);source=json.loads(self.source.read_text());source['legacy_sources'][spec['variants']['alarm']['source_paths'][0]]='bad';self.source.write_text(json.dumps(source))
        with self.assertRaisesRegex(ValueError,'source digest'):prepare()

    def test_native_file_rejected_before_load(self):
        base=self.roots['firebase']/'node_modules/firebase-admin'
        (base/'index.js').write_text('require("./blocked.node");')
        (base/'blocked.node').write_text('SYNTHETIC_NEVER_A_NATIVE_BINARY');self.reindex('firebase')
        self.run_code('require("firebase-admin")','native module prohibited')

    def test_positive_all_four_fixed_corpora_and_launcher(self):
        for variant in self.spec['variants']:
            root,node,out,policy,spec=self.prepared('',variant);doc=self.synthetic_doc(variant,policy,spec)
            code='const fs=require("fs"),path=require("path");'
            code+='for(const p of '+json.dumps(spec['variants'][variant]['source_paths'])+')fs.readFileSync(path.join(process.env.TW_REPO,p));'
            code+='if(require("async").synthetic!=="async"||require("mongoose").synthetic!=="mongoose")throw Error("direct mapping");'
            if variant=='alarm':
                code+='if(require("firebase-admin").synthetic!=="firebase-admin")throw Error("SDK stub");'
                code+='for(const p of '+json.dumps(list(spec['account_aliases']))+')JSON.parse(fs.readFileSync(path.join(process.env.TW_REPO,p),"utf8"));'
            code+='fs.writeFileSync(process.argv[2],JSON.stringify('+json.dumps(doc)+'));'
            prepared=self.prepared(code,variant);result=d.execute(prepared)
            self.assertEqual(result['status'],'RECORDED_NOT_COMPARED',result)
            self.assertEqual(result['guard']['transport_calls'],0)
            self.assertEqual(len(result['guard']['alias_reads']),2 if variant=='alarm' else 0)
            self.assertTrue(result['dependencies_verified_after'])

    def test_synthetic_https_override_stays_local_and_transcript_hosts_are_bounded(self):
        self.run_code('const h=require("https");h.request=(options,cb)=>{cb({statusCode:200});return {end(){}}};h.request({host:"fcm.googleapis.com"},r=>{if(r.statusCode!==200)throw Error("synthetic reply")}).end();require("fs").writeFileSync(process.argv[2],"{}");')
        root,node,out,policy,spec=self.prepared();out.mkdir();p=out/'transcript.json';doc=self.synthetic_doc('alarm',policy,spec)
        doc['cases'][0]['calls']=[{'kind':'https','host':'accounts.google.com','path':'/o/oauth2/token','method':'POST'}]
        p.write_text(json.dumps(doc));d.validate_record(p,policy['sources'],spec,'alarm',policy['revision'])
        doc['cases'][0]['calls'][0]['host']='unexpected.invalid';p.write_text(json.dumps(doc))
        with self.assertRaisesRegex(ValueError,'HTTPS host'):d.validate_record(p,policy['sources'],spec,'alarm',policy['revision'])
        doc['cases'][0]['calls']=[{'kind':'http','url':'http://unexpected.invalid/kma/'}];p.write_text(json.dumps(doc))
        with self.assertRaisesRegex(ValueError,'HTTP host'):d.validate_record(p,policy['sources'],spec,'alarm',policy['revision'])

    def test_real_installed_maps_guard_bootstrap_without_package_module_import(self):
        self.spec=json.loads((ROOT/'server2/tools/golden/policies/delivery.json').read_text())
        self.roots={'common':EVIDENCE/'common-deps','firebase':EVIDENCE/'firebase-deps','models':EVIDENCE.parent/'phase2-toolchain/mongoose-deps'}
        self.manifests={g:EVIDENCE/(g+'-installed-files.json') for g in self.roots}
        for group,meta in self.spec['dependency_roots'].items():
            for name in ('package.json','package-lock.json'):
                target=self.root/meta['manifest_dir']/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/meta['manifest_dir']/name,target)
        prepared=self.prepared();root,node,out,policy,spec=prepared;doc=self.synthetic_doc('alarm',policy,spec)
        prepared=self.prepared('require("fs").writeFileSync(process.argv[2],JSON.stringify('+json.dumps(doc)+'));')
        result=d.execute(prepared);self.assertEqual(result['status'],'RECORDED_NOT_COMPARED',result)
        self.assertEqual(result['guard']['dependency_file_count'],14481)
        self.assertFalse(any('/node_modules/' in p for p in result['guard']['modules']),result['guard']['modules'])

    def test_exact_two_read_aliases_only_and_target_symlinks(self):
        logical=list(self.spec['account_aliases'])[0];full=str(self.root/logical)
        self.run_code('require("fs").promises.readFile('+json.dumps(full)+')','filesystem promises readFile')
        self.run_code('require("fs").openSync('+json.dumps(full)+',"r")','private read')
        self.run_code('require("fs").readFileSync('+json.dumps(full)+')','private read',variant='alerts')
        self.run_code('require("fs").readFileSync('+json.dumps(full.replace('todayWeather','thirdProject'))+')','private read')
        target=self.root/self.spec['account_aliases'][logical];original=target.read_bytes();target.unlink();other=self.root/'public-account-copy.json';other.write_bytes(original);target.symlink_to(other)
        self.run_code('throw Error("unreached")','symlink')

    def test_alias_original_string_must_be_exact_canonical_absolute(self):
        canonical=str(self.root/list(self.spec['account_aliases'])[0])
        near=[canonical.replace('/fcm-test-','/./fcm-test-'),canonical.replace('/fcm-test-','/other/../fcm-test-'),os.path.relpath(canonical,self.root/'reports/sdlc/issue-2819-oracle-provenance/phase4-b2/run1')]
        for value in near:
            with self.subTest(value=value):self.run_code('require("fs").readFileSync('+json.dumps(value)+')','noncanonical account alias')

    def test_parent_node_and_input_before_after_verification_on_failed_child(self):
        prepared=self.prepared('throw Error("SYNTHETIC_CHILD_FAILURE");')
        root,node,out,policy,spec=prepared
        # Replace only this temporary Node copy; never mutate the shared official binary.
        local=self.root/'node';shutil.copyfile(node,local);local.chmod(0o700)
        policy['node_sha256']=d.sha(local);prepared=(root,local,out,policy,spec)
        local.write_bytes(local.read_bytes()+b'changed-before')
        with patch.object(d,'child') as child:result=d.execute(prepared)
        child.assert_not_called();self.assertEqual(result['status'],'BLOCKED');self.assertFalse(result['inputs_verified_before'])
        self.assertEqual(result['node_before_sha256'],d.sha(local));self.assertEqual(result['node_after_sha256'],d.sha(local))
        for kind in ['source','driver','guard','static','node']:
            with self.subTest(kind=kind):
                prepared=self.prepared('throw Error("SYNTHETIC_CHILD_FAILURE");');root,node,out,policy,spec=prepared
                if kind=='node':
                    local=self.root/'node-after';shutil.copyfile(node,local);local.chmod(0o700)
                    node=local;policy['node_sha256']=d.sha(node);prepared=(root,node,out,policy,spec);target=node
                elif kind=='source':target=root/spec['variants']['alarm']['source_paths'][0]
                elif kind=='driver':target=root/spec['variants']['alarm']['driver']
                elif kind=='guard':target=root/'server2/tools/golden/guards/delivery.cjs'
                else:target=root/next(iter(spec['static_inputs']))
                old=d.child;original=target.read_bytes()
                def change(*args):
                    result,stdout=old(*args);target.write_bytes(original+b'changed-after');return result,stdout
                try:
                    with patch.object(d,'child',side_effect=change):result=d.execute(prepared)
                    self.assertEqual(result['status'],'BLOCKED');self.assertTrue(result['inputs_verified_before']);self.assertFalse(result['inputs_verified_after'])
                    self.assertTrue(result['process_reaped']);self.assertIn(str(target),result['input_checks_after']['mismatches'])
                    self.assertEqual(result['node_before_sha256']==result['node_after_sha256'],kind!='node')
                finally:target.write_bytes(original)

    def test_account_schema_and_public_rfc_key_are_bound(self):
        p=self.root/'server2/tools/golden/delivery/fcm-test-todayWeather.json';original=p.read_bytes();p.write_bytes(original+b'\n');self.run_code('throw Error("unreached")','input identity');p.write_bytes(original);a=json.loads(p.read_text());a['project_id']='other-project';p.write_text(json.dumps(a));self.spec['static_inputs'][str(p.relative_to(self.root))]=d.sha(p)
        self.run_code('throw Error("unreached")','synthetic account schema')
        a['project_id']='tw-oracle';p.write_text(json.dumps(a));self.spec['static_inputs'][str(p.relative_to(self.root))]=d.sha(p);self.spec['public_spki_sha256']='0'*64
        self.run_code('throw Error("unreached")','public RFC key identity')

    def test_locale_reads_work_but_writes_and_caught_denials_do_not(self):
        p=str(self.root/'server/locales/en.json')
        self.run_code('const f=require("fs");if(JSON.parse(f.readFileSync('+json.dumps(p)+')).hello!=="Hello")throw Error("locale");f.writeFileSync(process.argv[2],"{}");')
        self.run_code('try{require("fs").writeFile('+json.dumps(p)+',"changed",()=>{})}catch(e){}','filesystem writeFile')
        self.run_code('require("fs").writeFileSync('+json.dumps(p)+',"changed")','output write')
        self.assertEqual(json.loads(Path(p).read_text()),{'hello':'Hello'})
        self.run_code('require("fs").readFileSync('+json.dumps(str(self.root/'server/locales/fr.json'))+')','private read')

    def test_crossroot_resolution_and_unused_sdk_import_denied(self):
        p=self.roots['firebase']/'node_modules/firebase-admin/index.js';p.write_text('module.exports=require("async");');self.reindex('firebase')
        self.run_code('require("firebase-admin")','cross-root package resolution')
        self.run_code('require("firebase-admin")','unused Firebase import',variant='alerts')

    def test_nonalarm_eager_sdk_exact_controller_parent_only(self):
        controller='server/controllers/controllerPush.js';full=str(self.root/controller)
        sdk=self.roots['firebase']/'node_modules/firebase-admin/index.js'
        sdk.write_text('module.exports={synthetic:"firebase-admin",parent:module.parent.filename};');self.reindex('firebase')
        def source(name,code):
            p=self.root/name;p.write_text(code);report=json.loads(self.source.read_text());report['legacy_sources'][name]=d.sha(p);self.source.write_text(json.dumps(report))
        source(controller,'module.exports=require("../lib/pushProviders");')
        # Same override order and unchanged parent forwarding as original legacy2:99-119.
        loader='const M=require("module"),rawLoad=M._load;M._load=function(id,parent,main){if(id==="../lib/pushProviders"){const sdk=rawLoad("firebase-admin",parent,false);return {sdk,firebase(){throw Error("FACTORY_MUST_NOT_RUN")}}}return rawLoad.apply(this,arguments)};'
        code=loader+'const value=require('+json.dumps(full)+');if(value.sdk.synthetic!=="firebase-admin"||value.sdk.parent!=='+json.dumps(full)+')throw Error("wrong SDK parent");require("fs").writeFileSync(process.argv[2],"{}");'
        for variant in ['alerts','malformed','air-filter']:
            with self.subTest(variant=variant):
                _,_,stdout=self.run_code(code,variant=variant)
                receipt=json.loads(stdout.decode().splitlines()[-1]);self.assertEqual(receipt['alias_reads'],[])
                resolutions=[x for x in receipt['direct_resolutions'] if x['request']=='firebase-admin'];self.assertEqual(len(resolutions),1)
                self.assertEqual(resolutions[0]['parent'],full);self.assertEqual(resolutions[0]['root'],'firebase')
        for other in ['server/controllers/alert.push.controller.js','server/controllers/controllerTown.js']:
            source(other,'module.exports=require("firebase-admin");')
            self.run_code('require('+json.dumps(str(self.root/other))+')','unused Firebase import',variant='alerts')
        source(controller,'module.exports=require("firebase-admin/package.json");')
        self.run_code('require('+json.dumps(full)+')','unused Firebase import',variant='alerts')

    def test_full_loader_style_resolve_then_load_uses_parent_specific_alias(self):
        self.run_code('const M=require("module"),old=M._load;M._load=function(id,parent,main){M._resolveFilename(id,parent,main);return old.apply(this,arguments)};if(require("firebase-admin/package.json").version!=="5.13.1")throw Error("version");require("fs").writeFileSync(process.argv[2],"{}");')

    def test_transport_worker_child_interval_and_mongoose_denied(self):
        for code,reason in [
            ('require("net").connect(1,"127.0.0.1")','net.connect'),('require("http").get("http://canary.invalid")','http.get'),('require("https").get("https://canary.invalid")','https.get'),('require("dns").promises.lookup("canary.invalid")','dns.promises.lookup'),('require("dgram").createSocket("udp4")','dgram.createSocket'),('require("child_process").spawn("false")','child_process.spawn'),('new(require("worker_threads").Worker)("",{eval:true})','worker_threads.Worker'),('setInterval(()=>{},1000)','background interval'),('require("mongoose").connect("mongodb://canary.invalid/test")','mongoose.connect'),('require("mongoose").Connection.prototype.openUri("mongodb://canary.invalid/test")','mongoose.Connection.openUri')]:
            with self.subTest(reason=reason):self.run_code(code,reason)

    def test_source_env_unknownmodule_and_output_denials(self):
        self.run_code('throw Error("unreached")','input identity',change=lambda p,s:p['sources'].__setitem__(next(iter(p['sources'])),'0'*64))
        self.run_code('throw Error("unreached")','inherited environment',envextra={'UNEXPECTED_AUTH_CANARY':'synthetic'})
        self.run_code('require("inspector")','builtin inspector')
        self.run_code('require("fs").readFileSync("/private-canary")','private read')
        self.run_code('require("fs").writeFileSync(process.argv[2],"x");require("fs").writeFileSync(process.argv[2],"y")','output write')
        self.run_code('throw Error("unreached")','output exists',change=lambda p,s:Path(p['output']).write_text('protected'))
        self.run_code('require("fs").writeFileSync(process.argv[2],Buffer.alloc('+str(self.spec['variants']['alarm']['record_limit_bytes']+1)+'))','output size')

    def test_deadline_and_stream_limit_reap(self):
        self.run_code('console.log("SYNTHETIC_WAIT");setTimeout(()=>{},1000000)','child deadline',deadline=0.8)
        _,out,_=self.run_code('process.stdout.write("x".repeat(3*1024*1024))','child output limit')
        self.assertLessEqual((out/'stdout.log').stat().st_size+(out/'stderr.log').stat().st_size,d.STREAM_LIMIT)

    def test_alarm_exact_bound_recorded_helper_metadata(self):
        root,node,out,policy,spec=self.prepared();out.mkdir();p=out/'helper-record.json'
        helper='server/test/offline/oracle-provenance/delivery/alarm-scenarios.js'
        doc=self.synthetic_doc('alarm',policy,spec);doc['source']['files'][helper]=spec['exports'][helper]
        p.write_text(json.dumps(doc));d.validate_record(p,policy['sources'],spec,'alarm',policy['revision'])
        for mutate in [lambda x:x['source']['files'].pop(helper),lambda x:x['source']['files'].__setitem__(helper,'0'*64),lambda x:x['source']['files'].__setitem__('server/test/offline/oracle-provenance/delivery/legacy2.js',spec['exports']['server/test/offline/oracle-provenance/delivery/legacy2.js'])]:
            bad=deepcopy(doc);mutate(bad);p.write_text(json.dumps(bad))
            with self.assertRaisesRegex(ValueError,'recorded source identity'):d.validate_record(p,policy['sources'],spec,'alarm',policy['revision'])

    def test_complete_shape_source_ids_schedule_urls_and_size_fail_closed(self):
        for variant in self.spec['variants']:
            root,node,out,policy,spec=self.prepared('',variant);out.mkdir();p=out/'payload.json';doc=self.synthetic_doc(variant,policy,spec)
            p.write_text(json.dumps(doc));d.validate_record(p,policy['sources'],spec,variant,policy['revision'])
            for mutate in [lambda x:x['cases'].pop(),lambda x:x['source']['files'].pop(next(iter(x['source']['files']))),lambda x:x['cases'][0].pop('id')]:
                bad=deepcopy(doc);mutate(bad);p.write_text(json.dumps(bad))
                with self.assertRaises((ValueError,KeyError)):d.validate_record(p,policy['sources'],spec,variant,policy['revision'])
            if variant=='alarm':doc['schedule']['records'].pop()
            elif variant=='alerts':doc['urls'].pop()
            else:doc['at']='wrong-clock'
            p.write_text(json.dumps(doc))
            with self.assertRaises(ValueError):d.validate_record(p,policy['sources'],spec,variant,policy['revision'])
        p.write_text(' '*8388609)
        with self.assertRaisesRegex(ValueError,'record output size'):d.validate_record(p,policy['sources'],spec,variant,policy['revision'])

    def test_hash_bound_vendor_duplicate_scripts_use_node_semantics_but_controls_stay_strict(self):
        p=self.roots['firebase']/'node_modules/firebase-admin/package.json'
        p.write_text('{"name":"firebase-admin","version":"5.13.1","scripts":{"test":"first"},"scripts":{"test":"last"}}');self.reindex('firebase')
        self.prepared() # Hash-bound metadata only; no SDK/model/legacy package is loaded.
        manifest=self.manifests['firebase'];original=manifest.read_bytes();manifest.write_text('{"regular_files":{},"regular_files":{},"symlinks":{}}')
        with self.assertRaisesRegex(ValueError,'duplicate JSON key'):self.prepared()
        manifest.write_bytes(original)
        with self.assertRaisesRegex(ValueError,'duplicate JSON key'):d.load(self.write_duplicate_control())
        with self.assertRaisesRegex(ValueError,'duplicate JSON key'):d.validate_record(self.write_duplicate_control(),{},self.spec,'alarm','c'*40)

    def write_duplicate_control(self):
        p=self.root/'duplicate-policy.json';p.write_text('{"schema":1,"schema":1}');return p

    def test_duplicate_guard_report_is_rejected(self):
        root,node,out,policy,spec=self.prepared();doc=self.synthetic_doc('alarm',policy,spec)
        prepared=self.prepared('require("fs").writeFileSync(process.argv[2],JSON.stringify('+json.dumps(doc)+'));')
        old=d.child
        def duplicate(*args):
            result,stdout=old(*args)
            return result,stdout.replace(b'"oracle_guard":1',b'"oracle_guard":0,"oracle_guard":1',1)
        with patch.object(d,'child',side_effect=duplicate):result=d.execute(prepared)
        self.assertEqual(result['status'],'BLOCKED')
        self.assertIn('duplicate JSON key',result['reason'])
        self.assertTrue(result['process_reaped'])

    def test_dependency_bytes_extra_file_versions_and_postchild_change_rejected(self):
        p=self.roots['firebase']/'node_modules/firebase-admin/package.json';data=p.read_bytes();bad=json.loads(data);bad['version']='5.13.2';p.write_text(json.dumps(bad))
        with self.assertRaisesRegex(ValueError,'file identity'):self.prepared()
        self.reindex('firebase')
        with self.assertRaisesRegex(ValueError,'locked transitive version'):self.prepared()
        p.write_bytes(data);self.reindex('firebase');p.write_bytes(data+b'\n')
        with self.assertRaisesRegex(ValueError,'file identity'):self.prepared()
        p.write_bytes(data);p=self.roots['common']/'node_modules/extra.cjs';p.write_text('throw Error("never load")')
        with self.assertRaisesRegex(ValueError,'file inventory'):self.prepared()
        p.unlink();prepared=self.prepared('require("fs").writeFileSync(process.argv[2],"{}");');old=d.child
        def change(*args):
            r=old(*args);(self.roots['common']/'node_modules/extra.cjs').write_text('synthetic');return r
        with patch.object(d,'child',side_effect=change):result=d.execute(prepared)
        self.assertEqual(result['status'],'BLOCKED');self.assertTrue(result['process_reaped']);self.assertIn('retained_failed_output',result)


if __name__=='__main__':unittest.main()
