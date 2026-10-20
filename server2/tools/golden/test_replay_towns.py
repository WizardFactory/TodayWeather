"""Synthetic-only towns boundary controls; never load actual legacy handler bytes."""
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

import replay_towns as t

ROOT=Path(__file__).resolve().parents[3]
RECOVERY=ROOT/'reports/sdlc/issue-2819-oracle-provenance/phase2-toolchain'
NODE=RECOVERY/'runtime/node-v16.20.2-darwin-arm64/bin/node'
DEPS=RECOVERY/'mongoose-deps'
MANIFEST=RECOVERY/'installed-files.json'

# A transport failsafe loaded BEFORE the guard makes a regressed guard test fail
# without ever performing real transport or launching an actual child.
FAILSAFE="""for(const [module,names] of [['net',['connect','createConnection','createServer']],['tls',['connect','createServer']],['http',['request','get','createServer']],['https',['request','get','createServer']],['dns',['lookup','resolve','resolve4']],['dgram',['createSocket']],['child_process',['exec','execSync','spawn','spawnSync','fork']]]) {const target=require(module);for(const name of names)target[name]=()=>{throw Error('CANARY_UNGUARDED '+module+'.'+name);};}require('net').Socket.prototype.connect=()=>{throw Error('CANARY_UNGUARDED socket');};require('worker_threads').Worker=function(){throw Error('CANARY_UNGUARDED worker');};"""


def synthetic(root):
    def write(name,body):
        path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(body)
    for parts in (t.DRIVER_PARTS,t.GUARD_PARTS):
        path=root.joinpath(*parts);path.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT.joinpath(*parts),path)
    for name in ('package.json','package-lock.json'):
        path=root/'server2/tools/golden/towns'/name;path.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/'server2/tools/golden/towns'/name,path)
    inputs={
      t.SOURCES[0]:"GeoController.prototype.name2address = function(req, done) { done();\n};\n",
      t.SOURCES[1]:"""ControllerTown.prototype._findTown = function(list,first,second,third,done) {
 const existing=list.find(t=>t.town&&t.town.third===third);if(existing)return done(null,existing);
 convertGeocode(first,second,third,(err,geo)=>{if(err)return done(err);const town=new dbTown({town:{first,second,third},gCoord:{lat:geo.lat,lon:geo.lon},mCoord:{mx:geo.mx,my:geo.my},areaNo:'synthetic'});town.save(err=>{if(!err)list.push(town);done(err,town);});});
};
""",
      t.SOURCES[2]:"const m=require('mongoose');module.exports=m.model('Town',new m.Schema({town:{first:String,second:String,third:String},gCoord:{lat:Number,lon:Number},mCoord:{mx:Number,my:Number},areaNo:String}));\n",
      t.SOURCES[3]:"this.makeResult = function(req,res,next) {req.result={location:req.params};next();\n    };\n",
      t.SOURCES[4]:"module.exports=function UnitConverter(){};\n"}
    for name,body in inputs.items():write(name,body)
    write('.gitignore','reports/\n');(root/'reports').mkdir(exist_ok=True)
    hashes={name:hashlib.sha256(body.encode()).hexdigest() for name,body in inputs.items()}
    source=root/'reports/source.json';source.write_text(json.dumps({'schema':1,'legacy_sources':hashes}))
    subprocess.run(['git','-C',str(root),'init','-q','--template='],check=True)
    return source


@unittest.skipUnless(NODE.is_file() and MANIFEST.is_file(),'restored pinned test prerequisites required')
class TownsBoundary(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve();self.sources=synthetic(self.root)
        self.index=0

    def prepared(self,**override):
        self.index+=1
        args={'root':self.root,'node':NODE,'deps':DEPS,'manifest':MANIFEST,'sources':self.sources,'out':self.root/'reports'/('run'+str(self.index))}
        args.update(override);return t.prepare(**args)

    def canary(self,code,reason,change=None,timeout=None,envextra=None):
        root,node,out,policy=self.prepared();out.mkdir()
        driver=root.joinpath(*t.DRIVER_PARTS);driver.write_text(code);policy['driver_sha256']=t.sha(driver)
        if change:change(policy)
        failsafe=out/'failsafe.js';failsafe.write_text(FAILSAFE)
        policy_path=out/'policy.json';policy_path.write_text(json.dumps(policy))
        env={'PATH':os.defpath,'LANG':'C','TZ':'UTC','NODE_ENV':'production','TW_REPO':str(root),'TW_MONGOOSE_MODULE':str(Path(policy['dependencies'])/'node_modules/mongoose'),'TW_TOWNS_POLICY':str(policy_path)}
        if envextra:env.update(envextra)
        command=[str(node),'--require',str(failsafe),'--require',str(root.joinpath(*t.GUARD_PARTS)),str(driver),policy['output']]
        with patch.object(t,'DEADLINE',timeout or t.DEADLINE):result,_=t.child(command,env,out)
        driver.write_bytes(ROOT.joinpath(*t.DRIVER_PARTS).read_bytes())
        stderr=(out/'stderr.log').read_text()
        self.assertTrue(result['process_reaped'])
        self.assertNotEqual(result['exit_code'],0)
        self.assertIn(reason,stderr if not result['failure'] else result['failure'])
        self.assertNotIn('CANARY_UNGUARDED',stderr)
        return result,out

    def test_positive_full_driver_uses_only_synthetic_five_sources(self):
        result=t.execute(self.prepared())
        self.assertEqual(result['status'],'RECORDED_NOT_COMPARED',result)
        self.assertEqual(result['semantics'],'NOT_COMPARED')
        self.assertEqual(len(result['guard']['sources']),5)

    def test_wrong_node_driver_dependency_and_source_metadata_fail_before_driver(self):
        with self.assertRaisesRegex(ValueError,'Node16.20.2'):
            self.prepared(node=Path(shutil.which('node')).resolve())
        driver=self.root.joinpath(*t.DRIVER_PARTS);original=driver.read_bytes();driver.write_bytes(original+b'\n')
        with self.assertRaisesRegex(ValueError,'full original driver identity'):self.prepared()
        driver.write_bytes(original)
        source=json.loads(self.sources.read_text());source['legacy_sources'][t.SOURCES[0]]='not-sha';self.sources.write_text(json.dumps(source))
        with self.assertRaisesRegex(ValueError,'source digest'):self.prepared()

    def test_changed_dependency_byte_and_wrong_package_version_fail(self):
        copied=self.root/'deps';shutil.copytree(DEPS,copied,symlinks=True)
        package=copied/'node_modules/mongoose/package.json';original=package.read_bytes();doc=json.loads(original);doc['version']='5.1.3';package.write_text(json.dumps(doc))
        with self.assertRaisesRegex(ValueError,'mongoose version'):self.prepared(deps=copied)
        package.write_bytes(original+b'\n')
        with self.assertRaisesRegex(ValueError,'dependency file identity'):self.prepared(deps=copied)

    def test_unknown_output_and_existing_or_symlink_output_fail(self):
        with self.assertRaisesRegex(ValueError,'new direct reports output'):self.prepared(out=self.root/'elsewhere')
        existing=self.root/'reports/existing';existing.mkdir()
        with self.assertRaisesRegex(ValueError,'new direct reports output'):self.prepared(out=existing)
        link=self.root/'reports/link';link.symlink_to(existing,target_is_directory=True)
        with self.assertRaisesRegex(ValueError,'new direct reports output'):self.prepared(out=link)

    def test_source_identity_private_read_and_module_path_denied(self):
        self.canary('throw Error("must not run")','TOWNS_DENIED input identity',lambda p:p['sources'].__setitem__(t.SOURCES[0],'0'*64))
        private=self.root/'reports/private.txt';private.write_text('synthetic canary, no secret')
        self.canary('require("fs").readFileSync('+json.dumps(str(private))+')','TOWNS_DENIED private read')
        forbidden=self.root/'server/test/offline/not-declared.js';forbidden.write_text('throw Error("must never execute")')
        self.canary('require("./not-declared.js")','TOWNS_DENIED private metadata')

    def test_existing_record_source_symlink_and_wrong_output_policy_are_denied(self):
        _,out=self.canary('throw Error("must not execute")','TOWNS_DENIED output exists',lambda p:Path(p['output']).write_text('protected'))
        self.assertEqual((out/'record.json.gz').read_text(),'protected')
        self.canary('throw Error("must not execute")','TOWNS_DENIED owned output',lambda p:p.update(output=str(self.root/'other-output')))
        source=self.root/t.SOURCES[0];source.unlink();source.symlink_to(self.sources)
        self.canary('throw Error("must not execute")','TOWNS_DENIED symlink')

    def test_transport_dns_udp_child_denials_with_failsafe(self):
        for code,reason in [
          ('require("net").connect(1,"127.0.0.1")','net.connect'),
          ('require("net").createServer().listen(0)','net.createServer'),
          ('require("http").get("http://canary.invalid")','http.get'),
          ('require("https").get("https://canary.invalid")','https.get'),
          ('require("dns").lookup("canary.invalid",()=>{})','dns.lookup'),
          ('require("dgram").createSocket("udp4")','dgram.createSocket'),
          ('require("child_process").spawn("/usr/bin/false")','child_process.spawn')]:
            with self.subTest(reason=reason):self.canary(code,'TOWNS_DENIED '+reason)

    def test_unknown_environment_and_worker_are_denied(self):
        self.canary('throw Error("must not execute")','TOWNS_DENIED inherited environment',envextra={'UNEXPECTED_TEST_KEY':'synthetic'})
        self.canary('new (require("worker_threads").Worker)("",{eval:true})','TOWNS_DENIED worker_threads.Worker')

    def test_mongoose_connection_denied_before_any_transport(self):
        for method in ('connect','createConnection'):
            self.canary('require(process.env.TW_MONGOOSE_MODULE).'+method+'("mongodb://canary.invalid/test")','TOWNS_DENIED mongoose.'+method)

    def test_write_outside_duplicate_write_and_large_write_denied(self):
        self.canary('require("fs").writeFileSync('+json.dumps(str(self.root/'reports/other'))+',"x")','TOWNS_DENIED output write')
        self.canary('require("fs").chmodSync(process.argv[1],0o777)','TOWNS_DENIED filesystem chmodSync')
        self.canary('const fs=require("fs");fs.writeFileSync(process.argv[2],"x");fs.writeFileSync(process.argv[2],"y")','TOWNS_DENIED output write')
        self.canary('require("fs").writeFileSync(process.argv[2],Buffer.alloc(2*1024*1024+1))','TOWNS_DENIED output size')

    def test_time_and_stream_limits_reap_process(self):
        self.canary('setInterval(()=>{},1000)','child deadline',timeout=0.1)
        result,out=self.canary('process.stdout.write("x".repeat(3*1024*1024))','child output limit')
        self.assertTrue(result['process_reaped'])

    def test_failed_partial_output_is_retained_separately(self):
        root,node,out,policy=self.prepared();driver=root.joinpath(*t.DRIVER_PARTS)
        driver.write_text('require("fs").writeFileSync(process.argv[2],"partial");setInterval(()=>{},1000)');policy['driver_sha256']=t.sha(driver)
        with patch.object(t,'DEADLINE',0.1):result=t.execute((root,node,out,policy))
        self.assertEqual(result['status'],'BLOCKED')
        self.assertTrue(result['process_reaped'])
        self.assertFalse((out/'record.json.gz').exists())
        # Timeout may fire before the deliberately bounded preload reaches driver.
        if 'retained_failed_output' in result:self.assertEqual((out/'failed-record.raw').read_text(),'partial')


if __name__=='__main__':unittest.main()
