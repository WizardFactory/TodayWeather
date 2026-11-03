'use strict';
// Fixed trusted delivery recorder boundary. No arbitrary-code sandbox claim.
const PROFILE='delivery';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),Module=require('module');
void process.stdin;void process.stdout;void process.stderr;
// Node16's pipe writes may be partial/nonblocking during exit; deliver the bounded audit completely.
if(process.stdout._handle)process.stdout._handle.setBlocking(true);
const raw=Object.fromEntries(['readFileSync','openSync','closeSync','readSync','writeSync','lstatSync','statSync','fstatSync','realpathSync','writeFileSync'].map(k=>[k,fs[k].bind(fs)]));
const realChdir=process.chdir.bind(process),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const violations=[],reads=new Set(),loads=new Set(),vms=[],changes=[],fds=new Set();
let receipt={oracle_guard:1,profile:PROFILE,status:'INVALID'},finalCheck=()=>{};
function deny(reason){violations.push(reason);throw Error('ORACLE_DENIED '+reason);}
function regular(file){
 const absolute=path.resolve(file);let current=path.parse(absolute).root;
 for(const part of absolute.slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);if(raw.lstatSync(current).isSymbolicLink())deny('symlink');}
 if(!raw.lstatSync(absolute).isFile())deny('regular file required');return absolute;
}
function rawBytes(file,encoding){const fd=raw.openSync(file,'r');try{const size=raw.fstatSync(fd).size,b=Buffer.alloc(size);let n=0;while(n<size){const got=raw.readSync(fd,b,n,size-n,n);if(!got)throw Error('short input read');n+=got;}return encoding?b.toString(encoding):b;}finally{raw.closeSync(fd);}}
function checked(file,expected,limit=8*1024*1024){file=regular(file);if(raw.lstatSync(file).size>limit)deny('input size');const b=rawBytes(file);if(hash(b)!==expected)deny('input identity '+file);return b;}
process.on('exit',code=>{
 try{finalCheck();}catch(error){if(!violations.length)violations.push(error.message);}
 for(const fd of fds){try{raw.closeSync(fd);}catch(_){} }
 if(!receipt.output_written&&!violations.length&&!code)violations.push('record not written');
 receipt.status=violations.length?'DENIED':code?'ERROR':'RECORDED';receipt.violations=violations;
 receipt.reads=[...reads].sort();receipt.modules=[...loads].sort();receipt.vm_calls=vms;receipt.chdir=changes;
 if(violations.length)process.exitCode=2;
 const report=Buffer.from(JSON.stringify(receipt)+'\n');let offset=0;while(offset<report.length){const n=raw.writeSync(1,report,offset,report.length-offset);if(n<=0)throw Error('receipt short write');offset+=n;}
});
try{
 if(process.version!=='v16.20.2')deny('node version');
 const policyPath=regular(process.env.TW_ORACLE_POLICY||'');if(raw.lstatSync(policyPath).size>4*1024*1024)deny('policy size');
 const policy=JSON.parse(rawBytes(policyPath,'utf8'));
 if(policy.schema!==1||policy.profile!==PROFILE)deny('profile');
 const root=raw.realpathSync(policy.root);
 const depRoots=Object.fromEntries(Object.entries(policy.dependency_roots).map(([k,r])=>{const p=raw.realpathSync(r.path);if(p!==r.path)deny('dependency root canonical');return [k,p];}));
 const deps=depRoots.common;
 const guard=path.join(root,'server2/tools/golden/guards/'+PROFILE+'.cjs'),specPath=path.join(root,'server2/tools/golden/policies/'+PROFILE+'.json');
 const spec=JSON.parse(checked(specPath,policy.spec_sha256));checked(guard,policy.guard_sha256);
 if(spec.schema!==1||spec.profile!==PROFILE||spec.transport!=='DENY_ALL')deny('fixed specification');
 const entry=spec.variants[policy.variant];if(!entry)deny('variant');
 if(Object.keys(depRoots).sort().join(',')!=='common,firebase,models')deny('dependency roots');
 if(Object.keys(policy.sources).sort().join('\n')!==entry.source_paths.slice().sort().join('\n'))deny('fixed sources');
 if(Object.keys(policy.exports).sort().map(k=>k+':'+policy.exports[k]).join('\n')!==Object.keys(spec.exports).sort().map(k=>k+':'+spec.exports[k]).join('\n'))deny('fixed exports');
 const allowed=new Map([[guard,policy.guard_sha256],[specPath,policy.spec_sha256]]);
 for(const [relative,expected] of Object.entries({...policy.sources,...policy.exports,...spec.static_inputs})){
  if(path.isAbsolute(relative)||relative.split('/').includes('..'))deny('source path');const file=path.join(root,relative);checked(file,expected);allowed.set(file,expected);
 }
 for(const [name,r] of Object.entries(policy.dependency_roots)){
  const manifest=JSON.parse(checked(r.installed_manifest,r.installed_manifest_sha256));
  const pairs=m=>Object.keys(m).sort().map(k=>[k,m[k]]);if(JSON.stringify(pairs(manifest.regular_files))!==JSON.stringify(pairs(r.files)))deny('installed map binding');
  for(const [relative,expected] of Object.entries(r.files)){
   if(!relative.startsWith('node_modules/')||path.isAbsolute(relative)||relative.split('/').includes('..'))deny('dependency path');
   const file=path.join(depRoots[name],relative);checked(file,expected);allowed.set(file,expected);
  }
  for(const [pkg,version] of Object.entries(spec.dependency_roots[name].direct_dependencies))if(JSON.parse(rawBytes(path.join(depRoots[name],'node_modules',pkg,'package.json'),'utf8')).version!==version)deny('dependency version '+pkg);
 }
 const aliases=new Map();
 const products=[['todayWeather','tw-oracle'],['todayAir','ta-oracle']];
 if(Object.keys(spec.account_aliases).length!==2)deny('exact account aliases');
 for(const [product,project] of products){
  const logical='server/test/offline/oracle-provenance/delivery/fcm-test-'+product+'.json';
  const actual='server2/tools/golden/delivery/fcm-test-'+product+'.json';
  if(spec.account_aliases[logical]!==actual||!spec.static_inputs[actual])deny('exact account aliases');
  const file=path.join(root,actual),account=JSON.parse(checked(file,spec.static_inputs[actual],1048576));
  if(Object.keys(account).sort().join(',')!=='client_email,private_key,private_key_id,project_id,type'||account.type!=='service_account'||account.project_id!==project||account.private_key_id!=='oracle'||account.client_email!=='oracle@'+project+'.iam.gserviceaccount.com')deny('synthetic account schema');
  const key=crypto.createPrivateKey(account.private_key),spki=crypto.createPublicKey(key).export({type:'spki',format:'der'});
  if(hash(spki)!==spec.public_spki_sha256)deny('public RFC key identity');
  if(policy.variant==='alarm')aliases.set(path.join(root,logical),file);
 }
 const output=path.resolve(policy.output),parent=path.dirname(output),cwd=raw.realpathSync(process.cwd());
 const evidence=path.join(root,'reports/sdlc/issue-2819-oracle-provenance/phase4-b2');
 if(!parent.startsWith(evidence+path.sep)||raw.realpathSync(parent)!==parent||cwd!==parent||path.basename(output)!==entry.record_name)deny('owned output');
 try{raw.lstatSync(output);deny('output exists');}catch(error){if(error.code!=='ENOENT')throw error;}
 const driver=path.join(root,entry.driver),argv=[driver,output];
 if(JSON.stringify(process.argv.slice(1))!==JSON.stringify(argv))deny('driver argv');
 const keys=new Set(['PATH','LANG','TZ','NODE_ENV','TW_REPO','TW_REVISION','NODE_PATH','TW_ORACLE_POLICY']);
 if(process.platform==='darwin'&&/^0x[0-9a-f]+:0x[0-9a-f]+:0x[0-9a-f]+$/i.test(process.env.__CF_USER_TEXT_ENCODING||''))keys.add('__CF_USER_TEXT_ENCODING');
 if(Object.keys(process.env).some(k=>!keys.has(k)))deny('inherited environment');
 if(process.env.TW_REPO!==root||process.env.TW_REVISION!==policy.revision||!/^[0-9a-f]{40}$/.test(policy.revision)||process.env.NODE_PATH!==path.join(deps,'node_modules')||process.env.TZ!=='UTC'||process.env.NODE_ENV!=='production')deny('fixed environment');
 const absent=new Set(spec.absent_metadata_paths.map(p=>path.join(root,p)));
 function checkAbsent(){for(const p of absent){try{raw.lstatSync(p);deny('unexpected optional locale script');}catch(e){if(e.code!=='ENOENT')throw e;}}}
 checkAbsent();
 const directories=new Set();for(const file of allowed.keys()){let d=path.dirname(file);while(true){directories.add(d);const p=path.dirname(d);if(p===d)break;d=p;}}
 function readable(file){const p=typeof file==='string'?path.resolve(file):null;if(!p||!allowed.has(p))deny('private read');checked(p,allowed.get(p));reads.add(p);return p;}
 function metadata(file){const p=path.resolve(file);if(!allowed.has(p)&&!directories.has(p)&&!absent.has(p)&&!Object.values(depRoots).some(d=>p.startsWith(path.join(d,'node_modules')+path.sep)))deny('private metadata '+p);return p;}
 fs.statSync=(file,...a)=>raw.statSync(metadata(file),...a);fs.lstatSync=(file,...a)=>raw.lstatSync(metadata(file),...a);
 fs.realpathSync=(file,...a)=>raw.realpathSync(metadata(file),...a);fs.realpathSync.native=fs.realpathSync;
 fs.existsSync=file=>{try{raw.lstatSync(metadata(file));return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
 fs.readdirSync=(file,options)=>{const dir=path.resolve(file);if(!directories.has(dir)||options&&typeof options==='object'&&options.withFileTypes)deny('directory read');const names=[...allowed.keys()].filter(p=>path.dirname(p)===dir).map(p=>path.basename(p));if(!names.length)deny('directory read');return [...new Set(names)].sort();};
 fs.openSync=(file,flags,...a)=>{if(!['r','rs',0].includes(flags))deny('open write');const fd=raw.openSync(readable(file),flags,...a);fds.add(fd);return fd;};
 fs.closeSync=fd=>{if(!fds.has(fd))deny('unowned descriptor close');fds.delete(fd);return raw.closeSync(fd);};
 fs.readSync=(fd,...a)=>{if(!fds.has(fd))deny('unowned descriptor read');return raw.readSync(fd,...a);};
 fs.fstatSync=(fd,...a)=>{if(!fds.has(fd))deny('unowned descriptor metadata');return raw.fstatSync(fd,...a);};
 const aliasReads=[];
 fs.readFileSync=(file,...a)=>{
  const logical=typeof file==='string'?path.resolve(file):null;
  if(logical&&aliases.has(logical)){if(file!==logical)deny('noncanonical account alias');const actual=aliases.get(logical);checked(actual,allowed.get(actual));reads.add(actual);aliasReads.push({logical,actual,sha256:allowed.get(actual)});return raw.readFileSync(actual,...a);}
  return raw.readFileSync(typeof file==='number'?(fds.has(file)?file:deny('unowned descriptor read')):readable(file),...a);
 };
 fs.mkdirSync=()=>deny('mkdir');
 fs.writeFileSync=(file,data)=>{if(typeof file!=='string'||path.resolve(file)!==output||receipt.output_written)deny('output write');const b=Buffer.isBuffer(data)?data:Buffer.from(data);if(b.length>entry.record_limit_bytes)deny('output size');const fd=raw.openSync(output,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{let n=0;while(n<b.length)n+=raw.writeSync(fd,b,n,b.length-n);}finally{raw.closeSync(fd);}receipt.output_written=true;receipt.output_sha256=hash(b);receipt.output_bytes=b.length;};
 const safe=new Set(['readFileSync','openSync','closeSync','readSync','writeFileSync','statSync','lstatSync','realpathSync','existsSync','fstatSync','readdirSync','mkdirSync']);
 for(const n of Object.keys(fs))if(typeof fs[n]==='function'&&!safe.has(n))fs[n]=()=>deny('filesystem '+n);
 for(const n of Object.keys(fs.promises))if(typeof fs.promises[n]==='function')fs.promises[n]=()=>deny('filesystem promises '+n);
 process.chdir=file=>{const d=path.resolve(file);if(d!==parent)deny('chdir');changes.push(d);return realChdir(d);};
 for(const [m,names] of [['net',['connect','createConnection','createServer']],['tls',['connect','createServer']],['http',['request','get','createServer']],['https',['request','get','createServer']],['dgram',['createSocket']],['child_process',['exec','execFile','execSync','execFileSync','spawn','spawnSync','fork']]]){const target=require(m);for(const n of names)target[n]=()=>deny(m+'.'+n);}
 require('net').Socket.prototype.connect=()=>deny('net.Socket.connect');require('net').Server.prototype.listen=()=>deny('net.Server.listen');
 const timers=require('timers');global.setInterval=timers.setInterval=()=>deny('background interval');
 require('worker_threads').Worker=function(){return deny('worker_threads.Worker');};require('cluster').fork=()=>deny('cluster.fork');
 const dns=require('dns');for(const r of [dns.Resolver,dns.promises.Resolver])if(r)for(const n of Object.getOwnPropertyNames(r.prototype))if(n!=='constructor'&&typeof r.prototype[n]==='function')r.prototype[n]=()=>deny('dns.Resolver.'+n);
 for(const n of Object.keys(dns))if(typeof dns[n]==='function')dns[n]=()=>deny('dns.'+n);
 for(const n of Object.keys(dns.promises))if(typeof dns.promises[n]==='function')dns.promises[n]=()=>deny('dns.promises.'+n);
 const rawLoad=Module._load,nativeResolve=Module._resolveFilename,builtins=new Set(Module.builtinModules.map(n=>n.replace(/^node:/,'')));
 const legacyParents=new Set([...Object.keys(policy.sources),...Object.keys(policy.exports)].filter(p=>p.endsWith('.js')||p.endsWith('.cjs')).map(p=>path.join(root,p)));
 const resolutions=[];
 Module._resolveFilename=function(id,parent,isMain,...rest){
  if(parent&&legacyParents.has(parent.filename)){
   const group=spec.direct_aliases[id]||(id==='firebase-admin/package.json'?'firebase':null);
   if(group){if(group==='firebase'&&policy.variant!=='alarm'&&!(id==='firebase-admin'&&parent.filename===path.join(root,'server/controllers/controllerPush.js')))deny('unused Firebase import');const resolved=nativeResolve.call(this,path.join(depRoots[group],'node_modules',id),parent,isMain,...rest);resolutions.push({request:id,parent:parent.filename,root:group,resolved});return resolved;}
  }
  return nativeResolve.call(this,id,parent,isMain,...rest);
 };
 Module._load=function(id,parent,isMain){
  const builtin=id.replace(/^node:/,'');if(builtins.has(builtin)){if(!spec.builtins.includes(builtin))deny('builtin '+builtin);return rawLoad.apply(this,arguments);}
  const resolved=Module._resolveFilename(id,parent,isMain);if(!allowed.has(resolved))deny('module path '+resolved);if(resolved.endsWith('.node'))deny('native module prohibited');
  if(parent)for(const dir of Object.values(depRoots))if(parent.filename.startsWith(path.join(dir,'node_modules')+path.sep)&&!resolved.startsWith(path.join(dir,'node_modules')+path.sep))deny('cross-root package resolution');
  loads.add(resolved);const result=rawLoad.call(this,resolved,parent,isMain);
  if(resolved===path.join(depRoots.models,'node_modules/mongoose/index.js')){
   for(const target of [result,result.Mongoose.prototype])for(const n of ['connect','createConnection'])target[n]=()=>deny('mongoose.'+n);
   for(const n of ['openUri','openSet'])result.Connection.prototype[n]=()=>deny('mongoose.Connection.'+n);
  }
  if(resolved.endsWith('/mongodb/index.js')&&result.MongoClient){result.MongoClient.connect=()=>deny('MongoClient.connect');result.MongoClient.prototype.connect=()=>deny('MongoClient.connect');}
  return result;
 };
 const vm=require('vm'),run=vm.runInNewContext;vm.runInNewContext=(code,context={},options={})=>{vms.push(options.filename||'<fixed extracted slice>');return run.call(vm,code,context,{...options,timeout:1000});};
 finalCheck=()=>{checkAbsent();for(const [file,expected] of allowed)checked(file,expected);if(raw.realpathSync(process.cwd())!==parent)deny('cwd not restored');};
 receipt={oracle_guard:1,profile:PROFILE,variant:policy.variant,alias_reads:aliasReads,direct_resolutions:resolutions,status:'READY',sources:policy.sources,exports:policy.exports,guard_sha256:policy.guard_sha256,spec_sha256:policy.spec_sha256,dependency_file_count:Object.values(policy.dependency_roots).reduce((n,r)=>n+Object.keys(r.files).length,0),absent_metadata_paths:spec.absent_metadata_paths,output_written:false,transport_calls:0};
}catch(error){if(!violations.length)violations.push(error.message);throw error;}
