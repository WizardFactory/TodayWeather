"""Remaining-three boundary controls: inert source replicas, never original handlers.

Original fixtures are read only as data to check complete validators. The shared
synthetic builder produces fake SDKs and source files; it does not run applications.
"""
from copy import deepcopy
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import unittest
from unittest.mock import patch
import test_replay_domestic_http as base
import replay_rest_http as d

ROOT = Path(__file__).resolve().parents[3]
NODE = base.NODE


class RestControls(unittest.TestCase):
    def setUp(self):
        self.helper = base.DomesticControls('test_positive_owned_ephemeral_get_head_close')
        self.helper.setUp(); self.addCleanup(self.helper.doCleanups)
        self.root = self.helper.root; self.counter = 0
        self.spec = d.load(ROOT / d.TOOLS / 'policies/rest_http.json')
        self.spec['dependency_roots'] = {'s02': self.helper.spec['dependency_roots']['s02']}
        self.roots = {'s02': self.helper.roots['s02']}; self.maps = {'s02': self.helper.maps['s02']}
        for entry in self.spec['variants'].values():
            for section in ('sources', 'exports'):
                for relative in entry[section]:
                    p = self.root / relative; p.parent.mkdir(parents=True, exist_ok=True)
                    p.write_text('{}' if p.suffix == '.json' else 'throw Error("ORIGINAL_SOURCE_MUST_NOT_EXECUTE");')
            for relative in entry['static_inputs']:
                if relative == 'server2/tools/golden/package-lock.json': continue
                p = self.root / relative; p.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(ROOT / relative, p)
        for name in d.TOOL_PATHS:
            if name == 'policies/rest_http.json': continue
            p = self.root / d.TOOLS / name; p.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(ROOT / d.TOOLS / name, p)

    def prepared(self, code, variant='s02', customize=None):
        self.counter += 1; spec = deepcopy(self.spec); entry = spec['variants'][variant]
        (self.root / entry['driver']).write_text(code)
        for e in spec['variants'].values():
            for section in ('sources', 'exports', 'static_inputs'):
                e[section] = {p: d.sha(self.root / p) for p in e[section]}
        if customize: customize(entry)
        sp = self.root / d.TOOLS / 'policies/rest_http.json'; sp.parent.mkdir(parents=True, exist_ok=True); sp.write_text(json.dumps(spec))
        deps = d.dependencies(self.root, self.roots, self.maps, spec, variant)
        out = self.root / d.EVIDENCE / ('run' + str(self.counter))
        tools = {d.TOOLS + name: d.sha(self.root / d.TOOLS / name) for name in d.TOOL_PATHS}
        policy = dict(schema=1, profile=d.PROFILE, variant=variant, root=str(self.root), revision='c'*40,
                      dependency_roots=deps, sources=entry['sources'], exports=entry['exports'],
                      output=str(out / entry['record_name']), tools=tools,
                      guard_sha256=tools[d.TOOLS + 'guards/rest_http.cjs'], spec_sha256=d.sha(sp), node_sha256=d.sha(NODE))
        return self.root, NODE, out, policy, spec

    @staticmethod
    def emit(variant='s02'):
        output = 'process.argv[3]' if variant == 'world' else 'require("path").join(process.argv[3],"records.json")'
        return 'require("fs").writeFileSync('+output+',"{}");'

    def run_code(self, code, variant='s02', expected=None, customize=None, envextra=None, deadline=3):
        prepared = self.prepared(code, variant, customize); root, node, out, policy, spec = prepared
        out.mkdir(); (out/'harness-scratch').mkdir(); (out/'policy.json').write_text(json.dumps(policy))
        failsafe = out/'failsafe.cjs'; failsafe.write_text(base.FAILSAFE)
        argv, env = d.command_env(*prepared)
        argv[1:1] = ['--require', str(failsafe)]
        if envextra: env.update(envextra)
        info, stdout = d.child(argv, env, out, deadline)
        text = stdout.decode(errors='replace') + (out/'stderr.log').read_text()
        self.assertTrue(info['process_reaped']); self.assertNotIn('CANARY_UNGUARDED', text)
        self.assertNotIn('ORIGINAL_SOURCE_MUST_NOT_EXECUTE', text)
        with self.assertRaises(ProcessLookupError): os.kill(info['pid'], 0)
        if expected:
            self.assertNotEqual(info['exit_code'], 0, text); self.assertIn(expected, info['failure'] or text)
        else: self.assertEqual(info['exit_code'], 0, text)
        (out/'control-result.json').write_text(json.dumps(dict(info=info,expected=expected,original_handlers_executed=False)))
        return prepared, info, stdout

    def test_original_s02_argv_and_owned_mkdir_without_smoke_override(self):
        code='const f=require("fs"),p=require("path");if(Object.keys(process.env).some(k=>k.startsWith("TW_SMOKE_")))throw Error("host override");f.mkdirSync(process.argv[3],{recursive:true});f.mkdirSync(p.join(process.argv[3],"harness-scratch"),{recursive:true});'+self.emit()
        self.run_code(code)

    def test_world_and_widget_exact_argv(self):
        self.run_code(self.emit('world'), 'world')
        self.run_code('if(!process.argv.includes("--widget-only"))throw Error("widget argv");'+self.emit('widget'), 'widget')

    def test_initial_smoke_or_unlisted_environment_is_denied(self):
        for key in ('TW_SMOKE_NOW','HOME'):
            with self.subTest(key=key): self.run_code(self.emit(), expected='fixed environment', envextra={key:'synthetic'})

    def test_only_owned_output_and_exact_mkdir_are_allowed(self):
        codes=[('require("fs").writeFileSync(process.argv[3]+"/other.json","x");','output write'),
               ('require("fs").mkdirSync(process.argv[3]+"/other",{recursive:true});','mkdir'),
               ('require("fs").mkdirSync(process.argv[3],{recursive:false});','mkdir'),
               ('require("fs").writeFileSync(process.argv[3]+"/records.json","a");'+self.emit(),'output write')]
        for code,reason in codes:
            with self.subTest(reason=reason): self.run_code(code, expected=reason)

    def test_private_unlisted_and_symlink_reads_are_denied(self):
        for expression in ['"/etc/hosts"','process.argv[3]+"/policy.json"']:
            self.run_code('try{require("fs").readFileSync('+expression+')}catch(_){}'+self.emit(), expected='private read')
        prepared=self.prepared(self.emit()); root,node,out,policy,spec=prepared
        p=root/next(iter(policy['sources'])); original=p.read_bytes(); p.unlink(); target=root/'unlisted';target.write_bytes(original);p.symlink_to(target)
        with self.assertRaisesRegex(ValueError,'symlink|canonical|regular'):
            d.prepare(root,node,self.roots['s02'],self.maps['s02'],out,'s02')

    def test_source_dependency_and_node_preflight_fail_before_invocation(self):
        prepared=self.prepared(self.emit());root,node,out,policy,spec=prepared
        p=root/next(iter(policy['sources']));p.write_text('changed')
        with patch.object(d,'child') as run:
            with self.assertRaisesRegex(ValueError,'source/export/static identity'): d.prepare(root,node,self.roots['s02'],self.maps['s02'],out,'s02')
            run.assert_not_called()
        fake=root/'wrong-node';fake.write_text('not node')
        with self.assertRaisesRegex(ValueError,'Node identity'):d.prepare(root,fake,self.roots['s02'],self.maps['s02'],out,'s02')

    def test_network_dns_tls_udp_child_worker_background_are_denied(self):
        probes=[('require("net").connect({host:"provider.invalid",port:443})','unowned socket connect'),
                ('require("dns").resolve4("provider.invalid",()=>{})','dns'),
                ('require("https").get("https://provider.invalid")','https.get'),
                ('require("tls").connect({host:"provider.invalid",port:443})','tls.connect'),
                ('require("dgram").createSocket("udp4")','dgram.createSocket'),
                ('require("child_process").spawn("sh")','child_process.spawn'),
                ('new (require("worker_threads").Worker)("x")','worker'),
                ('require("cluster").fork()','cluster.fork'),
                ('setInterval(()=>{},1)','background interval')]
        for probe,reason in probes:
            with self.subTest(probe=probe): self.run_code('try{'+probe+'}catch(_){}'+self.emit(),expected=reason)

    @staticmethod
    def flow(method='GET', use_get=False):
        issue=('h.get("http://127.0.0.1:"+s.address().port+"/",{agent:undefined,headers:{}},done)' if use_get else 'h.request({host:"127.0.0.1",port:s.address().port,method:'+json.dumps(method)+',agent:false},done)')
        return 'const h=require("http");const s=h.createServer((q,r)=>r.end("inert"));s.listen(0,"127.0.0.1",()=>{function done(r){r.resume();r.on("end",()=>s.close(()=>{OUTPUT}));}const q='+issue+';'+('' if use_get else 'q.end();')+'});'

    def test_s02_owned_methods_and_native_http_get_preserve_zero_remaining(self):
        for method in ['GET','HEAD','PUT','POST','DELETE','OPTIONS']:
            self.run_code(self.flow(method).replace('OUTPUT',self.emit()))
        _,_,stdout=self.run_code(self.flow(use_get=True).replace('OUTPUT',self.emit()))
        guard=json.loads(stdout.decode().splitlines()[-1]);self.assertEqual(guard['transport_calls'],1)
        self.assertEqual((guard['owned_ports_remaining'],guard['owned_sockets_remaining']),(0,0))

    def test_other_variants_wrong_method_get_and_unowned_http_rejected(self):
        self.run_code(self.flow('POST').replace('OUTPUT',self.emit('widget')),'widget',expected='HTTP unowned')
        self.run_code('require("http").get("http://127.0.0.1:1/",{agent:undefined},()=>{});','world',expected='http.get shape')
        self.run_code('require("http").get("http://provider.invalid:80/",{agent:undefined},()=>{});',expected='HTTP unowned')
        self.run_code('require("http").request({host:"127.0.0.1",port:1,agent:false}).end();',expected='HTTP unowned')

    def test_world_contextified_sandbox_then_exact_error_lookup(self):
        code='const v=require("vm"),s={};v.runInNewContext("41+1",s);if(typeof v.runInContext("Error",s)!=="function")throw Error("realm");'+self.emit('world')
        def vm_entries(entry):
            entry['vm_entries']=[dict(filename=None,sha256=hashlib.sha256(x.encode()).hexdigest()) for x in ['41+1','Error']]
        self.run_code(code,'world',customize=vm_entries)
        self.run_code('require("vm").runInNewContext("process.exit(0)");',expected='VM code identity')
        self.run_code('require("vm").compileFunction("return 1",[],{});',expected='VM compileFunction dynamic')

    def test_unlisted_startup_module_is_rejected_before_execution(self):
        p=self.root/'server/unlisted-startup.js';p.write_text('throw Error("ORIGINAL_SOURCE_MUST_NOT_EXECUTE")')
        self.run_code('require('+json.dumps(str(p))+');',expected='private metadata')

    def synthetic_doc(self, prepared):
        _,_,_,policy,spec=prepared;entry=spec['variants'][policy['variant']]
        data=(ROOT/entry['fixture']).read_bytes();doc=json.loads(gzip.decompress(data) if entry['fixture'].endswith('.gz') else data)
        doc['source']['files']={p:policy['sources'][p] for p in entry['record_source_paths']}
        if policy['variant']!='world':
            doc['source']['oracle_sha256']=policy['exports'][entry['driver']]
            doc['source']['dependency_lock_sha256']=entry['dependency_lock_sha256']
        return doc

    def test_complete_three_record_validators_reject_clock_body_and_inventory_drift(self):
        for variant in d.VARIANTS:
            prepared=self.prepared('',variant);root,node,out,policy,spec=prepared;out.mkdir()
            doc=self.synthetic_doc(prepared);p=out/spec['variants'][variant]['record_name']
            def save(value):
                raw=json.dumps(value,ensure_ascii=False).encode();p.write_bytes(gzip.compress(raw,mtime=0) if variant=='world' else raw)
            save(doc);d.validate_record(p,policy,spec)
            bad=deepcopy(doc)
            if variant=='world':bad['scenarios'][0]['steps'][0]['at']='2030-01-01'
            else:bad['cases'][0]['clock']='2030-01-01'
            save(bad)
            with self.assertRaisesRegex(ValueError,'clock'):d.validate_record(p,policy,spec)
            bad=deepcopy(doc)
            if variant=='world':bad['scenarios'][0]['steps'][0]['requests'][0]['body']='altered'
            else:bad['cases'][0]['body_base64']='YWx0ZXJlZA=='
            save(bad)
            with self.assertRaisesRegex(ValueError,'body identity'):d.validate_record(p,policy,spec)

    def test_deadline_stream_bound_and_natural_reap(self):
        self.run_code('while(true){}',expected='deadline',deadline=.1)
        self.run_code('process.stdout.write("x".repeat(3*1024*1024));setTimeout(()=>{},1000);',expected='child output limit')
        self.run_code(self.emit())

    def test_single_output_record_bound(self):
        self.run_code('require("fs").writeFileSync(process.argv[3]+"/records.json",Buffer.alloc(17*1024*1024));',expected='compressed output bound')

    def test_child_failure_still_performs_post_identity_and_dependency_checks(self):
        prepared=self.prepared('process.exit(1);')
        result=d.execute(prepared)
        self.assertEqual(result['status'],'BLOCKED');self.assertTrue(result['process_reaped'])
        self.assertTrue(result['input_checks_after']['verified']);self.assertTrue(result['dependencies_verified_after'])
        prepared=self.prepared(self.emit());root,node,out,policy,spec=prepared
        (root/next(iter(policy['sources']))).write_text('changed')
        with patch.object(d,'child') as run:
            result=d.execute(prepared);run.assert_not_called()
        self.assertFalse(result['child_started']);self.assertIn('input_checks_after',result)

    def test_three_complete_synthetic_records_through_real_launcher(self):
        for variant in d.VARIANTS:
            with self.subTest(variant=variant):
                entry=self.spec['variants'][variant];data=(ROOT/entry['fixture']).read_bytes()
                doc=json.loads(gzip.decompress(data) if entry['fixture'].endswith('.gz') else data)
                doc['source']['files']={p:d.sha(self.root/p) for p in entry['record_source_paths']}
                code='const f=require("fs"),h=require("crypto");const doc='+json.dumps(doc,ensure_ascii=False,separators=(',',':'))+';'
                if variant!='world':
                    code+='doc.source.oracle_sha256=h.createHash("sha256").update(f.readFileSync(__filename)).digest("hex");'
                code+='const raw=Buffer.from(JSON.stringify(doc));'
                output='process.argv[3]' if variant=='world' else 'require("path").join(process.argv[3],"records.json")'
                payload='require("zlib").gzipSync(raw,{level:9})' if variant=='world' else 'raw'
                code+='f.writeFileSync('+output+','+payload+');'
                result=d.execute(self.prepared(code,variant))
                self.assertEqual(result['status'],'RECORDED_NOT_COMPARED',result.get('reason'))
                self.assertTrue(result['process_reaped']);self.assertTrue(result['dependencies_verified_after'])
                self.assertTrue(result['input_checks_before']['verified'] and result['input_checks_after']['verified'])

    def test_incomplete_installed_inventory_is_rejected_before_child(self):
        prepared=self.prepared(self.emit());root,node,out,policy,spec=prepared
        files=d.load(self.maps['s02'])['regular_files'];p=self.roots['s02']/next(iter(files))
        p.unlink()
        with patch.object(d,'child') as run:
            with self.assertRaisesRegex(ValueError,'inventory'):
                d.prepare(root,node,self.roots['s02'],self.maps['s02'],out,'s02')
            run.assert_not_called()

    def test_exact_synthetic_database_sdk_connection_is_denied(self):
        sdk=self.roots['s02']/'node_modules/mongoose';sdk.mkdir()
        (sdk/'package.json').write_text(json.dumps({'name':'mongoose','version':'0.0.0','main':'index.js'}))
        (sdk/'index.js').write_text('function M(){};function C(){};module.exports={Mongoose:M,Connection:C,connect(){throw Error("UNGUARDED_DB")}};')
        lockpath=self.roots['s02']/'package-lock.json';lock=d.load(lockpath)
        lock['packages']['node_modules/mongoose']=dict(version='0.0.0',resolved='https://registry.npmjs.org/mongoose/-/synthetic.tgz',integrity='sha512-synthetic')
        lockpath.write_text(json.dumps(lock));self.spec['dependency_roots']['s02']['packages']+=1
        meta=self.spec['dependency_roots']['s02'];meta['lock_sha256']=d.sha(lockpath)
        shutil.copyfile(lockpath,self.root/meta['manifest_dir']/'package-lock.json')
        self.helper.reindex('s02');self.maps['s02']=self.helper.maps['s02']
        _,_,stdout=self.run_code('try{require('+json.dumps(str(sdk/'index.js'))+').connect("mongodb://provider.invalid")}catch(e){if(e.message==="UNGUARDED_DB")throw e;}'+self.emit(),expected='mongoose connect')
        self.assertNotIn('UNGUARDED_DB',stdout.decode())

    def test_three_profiles_real_pinned_vendor_http_and_post_load_fixed_cookie_clock(self):
        self.helper.bind_verified_s02_readonly()
        self.roots['s02']=self.helper.roots['s02'];self.maps['s02']=self.helper.maps['s02']
        self.spec['dependency_roots']['s02']=deepcopy(self.helper.spec['dependency_roots']['s02'])
        code=r'''const express=require('express'),session=require('express-session'),bp=require('body-parser'),cp=require('cookie-parser'),i18n=require('i18n');
const RealDate=Date,instant=RealDate.parse('2026-09-24T00:10:00Z');
class FixedDate extends RealDate{constructor(...a){super(...(a.length?a:[instant]));}static now(){return instant;}}global.Date=FixedDate;
const Cookie=require('express-session/session/cookie'),cookie=new Cookie({maxAge:60000});if(cookie.expires.toISOString()!=='2026-09-24T00:11:00.000Z')throw Error('cached real clock');
const app=express();app.use(session({secret:'synthetic',resave:false,saveUninitialized:true,genid:()=> 'fixed',cookie:{maxAge:60000}}));app.use(bp.json());app.use(cp());app.get('/',(q,r)=>r.send(Buffer.from('inert')));
const h=require('http'),s=h.createServer(app);s.listen(0,'127.0.0.1',()=>{const q=h.request({host:'127.0.0.1',port:s.address().port,agent:false,headers:{connection:'close'}},r=>{r.resume();r.on('end',()=>s.close(()=>{OUTPUT}));});q.end();});'''
        for variant in d.VARIANTS:
            with self.subTest(variant=variant):
                _,_,stdout=self.run_code(code.replace('OUTPUT',self.emit(variant)),variant,deadline=3)
                receipt=json.loads(stdout.decode().splitlines()[-1]);compiled={r['filename'] for r in receipt['cjs_compiles']}
                for package in ('raw-body','on-finished'):
                    self.assertIn(str(self.roots['s02']/'node_modules'/package/'index.js'),compiled)

    def test_s02_driver_canary_overrides_then_owned_http_remain_compatible(self):
        # Source-shaped inert replica of the producer's safety canaries, not a handler import.
        code=r'''const assert=require('assert'),allowedPorts=new Set(),network={rejected:0,accepted:0};
const net=require('net'),connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){let a=args[0];if(Array.isArray(a))a=a[0];const host=typeof a==='object'?a.host:args[1],port=typeof a==='object'?Number(a.port):Number(a);if(host!=='127.0.0.1'||!allowedPorts.has(port)){network.rejected++;throw Error('Oracle network denied');}network.accepted++;return connect.apply(this,args);};
require('dns').lookup=(host,options,callback)=>{if(typeof options==='function')callback=options;if(host!=='127.0.0.1')throw Error('Oracle DNS denied');process.nextTick(()=>callback(null,'127.0.0.1',4));};
for(const method of ['resolve','resolve4','resolve6'])require('dns')[method]=()=>{throw Error('Oracle DNS denied');};
for(const method of ['request','get'])require('https')[method]=()=>{throw Error('Oracle HTTPS denied');};
require('dgram').createSocket=()=>{throw Error('Oracle UDP denied');};
for(const method of ['exec','execFile','execFileSync','spawn','fork','execSync','spawnSync'])require('child_process')[method]=()=>{throw Error('Oracle child process denied');};
assert.throws(()=>net.connect({host:'127.0.0.1',port:1}),/Oracle network denied/);
const probes=[()=>net.connect({host:'provider.invalid',port:443}),()=>require('dns').lookup('provider.invalid',()=>{}),()=>require('dns').resolve4('provider.invalid',()=>{}),()=>require('https').get('https://provider.invalid'),()=>require('dgram').createSocket('udp4'),()=>require('child_process').execFileSync('echo',['denied'])];
for(const probe of probes)assert.throws(probe,/Oracle .* denied/);
assert.equal(network.rejected,2);process.stdout.write('DRIVER_CANARIES_7_BLOCKED\n');'''
        flow=self.flow().replace('function done(r)', 'allowedPorts.add(s.address().port);function done(r)')
        _,_,stdout=self.run_code(code+flow.replace('OUTPUT',self.emit()))
        self.assertIn(b'DRIVER_CANARIES_7_BLOCKED',stdout)
        receipt=json.loads(stdout.decode().splitlines()[-1]);self.assertEqual(receipt['violations'],[])
        self.assertEqual((receipt['owned_ports_remaining'],receipt['owned_sockets_remaining']),(0,0))

    def test_pinned_i18n_locale_selection_has_metadata_but_no_js_read_permission(self):
        self.helper.bind_verified_s02_readonly()
        self.roots['s02']=self.helper.roots['s02'];self.maps['s02']=self.helper.maps['s02']
        self.spec['dependency_roots']['s02']=deepcopy(self.helper.spec['dependency_roots']['s02'])
        # Reuse reviewed source identities only inside the inert replica tree.
        matches=[Path(relative) for relative in self.spec['variants']['world']['sources']
                 if Path(relative).name=='en.json']
        self.assertEqual(len(matches),1)
        locale_json=self.root/matches[0];locale_dir=locale_json.parent
        private=locale_json.with_suffix('.js');unknown=locale_dir/'fr.js'
        self.assertNotEqual(self.root.resolve(),ROOT.resolve())
        for path in [locale_json,locale_dir,private,unknown]:
            self.assertTrue(path.resolve().is_relative_to(self.root.resolve()))
            self.assertNotEqual(path.resolve(),(ROOT/path.relative_to(self.root)).resolve())
        code="const i=require('i18n');i.configure({locales:['en','ko','ja','zh-CN','de','zh-TW'],cookie:'twcookie',directory:"+json.dumps(str(locale_dir))+",register:global,updateFiles:false});if(i.getLocales().length!==6)throw Error('locale inventory');"
        for variant in d.VARIANTS:
            _,_,stdout=self.run_code(code+self.emit(variant),variant)
            receipt=json.loads(stdout.decode().splitlines()[-1]);self.assertEqual(receipt['violations'],[])
            self.assertTrue(all(str(locale_dir/(name+'.json')) in receipt['reads'] for name in ['en','ko','ja','zh-CN','de','zh-TW']))
        for kind in ['file','symlink']:
            if kind=='file':private.write_text('UNREADABLE_LOCALE_JS')
            else:private.symlink_to(locale_json)
            try:
                _,_,stdout=self.run_code(code+self.emit(),expected='private read')
                self.assertIn('private read',json.loads(stdout.decode().splitlines()[-1])['violations'])
            finally:private.unlink()
        self.run_code('try{require("fs").statSync('+json.dumps(str(unknown))+')}catch(_){}'+self.emit(),expected='private metadata')
        self.run_code('try{require("fs").readFileSync('+json.dumps(str(private))+')}catch(_){}'+self.emit(),expected='private read')


if __name__=='__main__':unittest.main()
