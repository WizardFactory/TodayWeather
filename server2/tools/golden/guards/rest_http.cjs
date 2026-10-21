'use strict';
// Three immutable, trusted remaining offline drivers. This is a bounded API boundary, not a hostile-code sandbox.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),Module=require('module');
const http=require('http'),net=require('net'),vm=require('vm');
void process.stdin;void process.stdout;void process.stderr;
if(process.stdout._handle)process.stdout._handle.setBlocking(true);
const raw=Object.fromEntries(['readFileSync','openSync','closeSync','readSync','writeSync','lstatSync','statSync','fstatSync','realpathSync'].map(k=>[k,fs[k].bind(fs)]));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),chdir=process.chdir.bind(process);
const violations=[],reads=new Set(),loads=new Set(),vms=[],cjsCompiles=[],changes=[],fds=new Set(),servers=new Set(),ports=new Set(),sockets=new Set();
const nativeCompileFunction=vm.compileFunction,CJS_PARAMS=['exports','require','module','__filename','__dirname'];
let pendingCjs=null,cjsAuditBytes=2;
let receipt={oracle_guard:1,profile:'rest_http'},finalCheck=()=>{},httpDepth=0,transportCalls=0;
function deny(reason){violations.push(reason);throw Error('ORACLE_DENIED '+reason);}
// Passive bounded refusal context; this never authorizes an operation or changes deny reasons.
const RefusalError=Error;let refusalRows=0,refusalBytes=0,refusalBound=false;
function refusal(reason,context){
 try{
  const row={schema:1,reason,context,transport_calls:transportCalls,vm_calls:vms.length,last_vm:vms.length?vms[vms.length-1]:null,cjs_parent:pendingCjs?pendingCjs.filename:null};
  const b=Buffer.from('ORACLE_REFUSAL_V1 '+JSON.stringify(row)+'\n');
  if(refusalRows>=16||refusalBytes+b.length>65536){if(!refusalBound){violations.push('refusal audit bound');refusalBound=true;}return;}
  refusalRows++;refusalBytes+=b.length;let i=0;while(i<b.length){const n=raw.writeSync(2,b,i,b.length-i);if(!n)throw new RefusalError('refusal audit short write');i+=n;}
 }catch(_){violations.push('refusal audit unavailable');}
}
function regular(file){const p=path.resolve(file);let cursor=path.parse(p).root;for(const bit of p.slice(cursor.length).split(path.sep).filter(Boolean)){cursor=path.join(cursor,bit);if(raw.lstatSync(cursor).isSymbolicLink())deny('symlink');}if(!raw.lstatSync(p).isFile())deny('regular file');return p;}
function bytes(file,encoding){const fd=raw.openSync(file,'r');try{const size=raw.fstatSync(fd).size,b=Buffer.alloc(size);let i=0;while(i<size){const n=raw.readSync(fd,b,i,size-i,i);if(!n)throw Error('short read');i+=n;}return encoding?b.toString(encoding):b;}finally{raw.closeSync(fd);}}
function checked(file,digest,limit=64*1024*1024){file=regular(file);if(raw.lstatSync(file).size>limit)deny('input size');const b=bytes(file);if(hash(b)!==digest)deny('input identity '+file);return b;}
// Reject duplicates in control JSON. Vendor package.json is parsed only after its exact map hash.
function strictJSON(text){text=String(text);let i=0;const ws=()=>{while(/\s/.test(text[i]||'')&&i<text.length)i++;};function str(){const start=i++;while(i<text.length){if(text[i]==='\\'){i+=2;continue;}if(text[i++]==='"')return JSON.parse(text.slice(start,i));}deny('JSON string');}function value(){ws();if(text[i]==='{'){i++;ws();const keys=new Set();if(text[i]==='}'){i++;return;}while(true){ws();if(text[i]!=='"')deny('JSON key');const key=str();if(keys.has(key))deny('duplicate JSON key');keys.add(key);ws();if(text[i++]!==':')deny('JSON colon');value();ws();const c=text[i++];if(c==='}')break;if(c!==',')deny('JSON object');}}else if(text[i]==='['){i++;ws();if(text[i]===']'){i++;return;}while(true){value();ws();const c=text[i++];if(c===']')break;if(c!==',')deny('JSON array');}}else if(text[i]==='"')str();else{const m=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));if(!m)deny('JSON value');i+=m[0].length;}}value();ws();if(i!==text.length)deny('JSON trailing');return JSON.parse(text);}
process.on('exit',code=>{
 try{finalCheck();}catch(e){if(!violations.length)violations.push(e.message);}
 const remainingPorts=ports.size,remainingSockets=sockets.size;
 for(const socket of sockets)socket.destroy();for(const server of servers)try{server.close();}catch(_){}
 for(const fd of fds)try{raw.closeSync(fd);}catch(_){}
 if(remainingPorts||remainingSockets)violations.push('owned HTTP not retired');
 if(!receipt.output_written&&!violations.length&&!code)violations.push('record not written');
 Object.assign(receipt,{status:violations.length?'DENIED':code?'ERROR':'RECORDED',violations,reads:[...reads].sort(),modules:[...loads].sort(),vm_calls:vms,cjs_compiles:cjsCompiles,chdir:changes,transport_calls:transportCalls,owned_ports_remaining:remainingPorts,owned_sockets_remaining:remainingSockets});
 if(violations.length)process.exitCode=2;const b=Buffer.from(JSON.stringify(receipt)+'\n');let i=0;while(i<b.length){const n=raw.writeSync(1,b,i,b.length-i);if(!n)throw Error('audit short write');i+=n;}
});
try{
 if(process.version!=='v16.20.2')deny('node version');
 const pp=regular(process.env.TW_ORACLE_POLICY||'');if(raw.lstatSync(pp).size>4*1024*1024)deny('policy size');const policy=strictJSON(bytes(pp,'utf8'));
 if(policy.schema!==1||policy.profile!=='rest_http')deny('profile');const root=raw.realpathSync(policy.root);
 const specPath=path.join(root,'server2/tools/golden/policies/rest_http.json'),guard=path.join(root,'server2/tools/golden/guards/rest_http.cjs');
 const spec=strictJSON(checked(specPath,policy.spec_sha256));checked(guard,policy.guard_sha256);
 const entry=spec.variants[policy.variant];if(!entry||spec.transport!=='OWNED_LOOPBACK_HTTP_ONLY')deny('fixed profile');
 const pairs=o=>Object.keys(o).sort().map(k=>[k,o[k]]);
 if(JSON.stringify(pairs(policy.sources))!==JSON.stringify(pairs(entry.sources))||JSON.stringify(pairs(policy.exports))!==JSON.stringify(pairs(entry.exports)))deny('fixed source/export map');
 const allowed=new Map([[guard,policy.guard_sha256],[specPath,policy.spec_sha256]]),depRoots={},dependencySymlinks=new Set();
 for(const [name,digest] of Object.entries({...policy.sources,...policy.exports,...entry.static_inputs})){if(path.isAbsolute(name)||name.split('/').includes('..'))deny('input path');const file=path.join(root,name);checked(file,digest);allowed.set(file,digest);}
 if(Object.keys(policy.dependency_roots).sort().join(',')!==entry.dependency_groups.slice().sort().join(','))deny('fixed dependency roots');
 for(const [group,r] of Object.entries(policy.dependency_roots)){
  const base=raw.realpathSync(r.path);if(base!==r.path)deny('canonical dependency root');depRoots[group]=base;
  const manifest=strictJSON(checked(r.installed_manifest,r.installed_manifest_sha256));if(JSON.stringify(pairs(manifest.regular_files))!==JSON.stringify(pairs(r.files)))deny('installed map binding');
  for(const name of Object.keys(manifest.symlinks))dependencySymlinks.add(path.join(base,name));
  for(const [name,digest] of Object.entries(r.files)){if(!name.startsWith('node_modules/')||path.isAbsolute(name)||name.split('/').includes('..'))deny('dependency path');const file=path.join(base,name);checked(file,digest);allowed.set(file,digest);}
  for(const [pkg,version] of Object.entries(spec.dependency_roots[group].direct_dependencies)){const file=path.join(base,'node_modules',pkg,'package.json');if(!allowed.has(file)||JSON.parse(checked(file,allowed.get(file))).version!==version)deny('dependency version');}
 }
 const output=path.resolve(policy.output),parent=path.dirname(output),harness=path.join(parent,'harness-scratch'),evidence=path.join(root,'reports/sdlc/issue-2819-oracle-provenance/phase4-b3');
 if(path.dirname(parent)!==evidence||raw.realpathSync(parent)!==parent||raw.realpathSync(harness)!==harness||!raw.statSync(harness).isDirectory()||raw.realpathSync(process.cwd())!==parent||path.basename(output)!==entry.record_name)deny('owned output');
 try{raw.lstatSync(output);deny('output exists');}catch(e){if(e.code!=='ENOENT')throw e;}
 const expectedArgv=policy.variant==='world'?[path.join(root,entry.driver),root,output]:[path.join(root,entry.driver),'--output',parent,...(policy.variant==='widget'?['--widget-only']:[])];if(JSON.stringify(process.argv.slice(1))!==JSON.stringify(expectedArgv))deny('driver argv');
 const oneCaseDiagnostic=false;
 const envKeys=new Set(['PATH','LANG','TZ','NODE_ENV','TW_REPO','TW_REVISION','NODE_PATH','TW_ORACLE_POLICY']);
 if(process.platform==='darwin'&&/^0x[0-9a-f]+:0x[0-9a-f]+:0x[0-9a-f]+$/i.test(process.env.__CF_USER_TEXT_ENCODING||''))envKeys.add('__CF_USER_TEXT_ENCODING');
 const primary='s02';
 if(Object.keys(process.env).some(k=>!envKeys.has(k))||process.env.TW_REPO!==root||process.env.TW_REVISION!==policy.revision||!/^[0-9a-f]{40}$/.test(policy.revision)||process.env.NODE_PATH!==path.join(depRoots[primary],'node_modules')||process.env.TZ!=='UTC'||process.env.NODE_ENV!=='production')deny('fixed environment');
 const nativeExit=process.exit.bind(process),clientResponses=new WeakMap(),socketRoles=new WeakMap();
 const terminalAudit={deferred:false,sockets_at_request:0,observed_closes:0,completed_clients_at_request:0};
 let terminalRequested=false;
 function terminalQuiet(operation){if(terminalRequested)deny('terminal work '+operation);}
 function completedClient(socket){const state=clientResponses.get(socket);return !!(state&&state.endSeen&&state.response.complete===true&&state.request.writableEnded===true&&socket.writableEnded===true&&(socket.readyState==='readOnly'||socket.readyState==='closed'&&socket.readableEnded===true));}
 // Bounded passive terminal diagnostics; no IO and no ownership/eligibility changes.
 function auditTerminalCandidates(code){
  const pending=[...sockets];terminalAudit.candidate_exit_code=code===undefined?null:code;terminalAudit.candidate_count=pending.length;terminalAudit.candidate_audit_truncated=pending.length>32;
  terminalAudit.candidate_sockets=pending.slice(0,32).map(socket=>{const state=clientResponses.get(socket),meta=socketRoles.get(socket)||{role:'unknown'};return {...meta,destroyed:socket.destroyed,handle_null:socket._handle===null,ready_state:socket.readyState,readable_ended:socket.readableEnded,writable_ended:socket.writableEnded,writable_finished:socket.writableFinished,request_writable_ended:state?state.request.writableEnded:null,response_complete:state?state.response.complete:null,response_end_seen:state?state.endSeen:null,eligible:socket.destroyed||completedClient(socket)};});
 }
 function retireSocket(socket){const removed=sockets.delete(socket);if(terminalRequested&&removed)terminalAudit.observed_closes++;if(terminalRequested&&sockets.size===0&&ports.size===0)nativeExit(0);}
 if(policy.variant==='core'||policy.variant==='rich')process.exit=function(code){
  if(terminalRequested){if(code!==0){terminalAudit.reentrant_exit_code=code;return nativeExit(code);}return;}
  auditTerminalCandidates(code);
  if(code===0&&receipt.output_written&&ports.size===0&&sockets.size>0&&[...sockets].every(socket=>socket.destroyed||completedClient(socket))){
   terminalRequested=true;terminalAudit.deferred=true;terminalAudit.sockets_at_request=sockets.size;terminalAudit.completed_clients_at_request=[...sockets].filter(socket=>!socket.destroyed&&completedClient(socket)).length;return;
  }
  return nativeExit(code);
 };
 const metadataPaths=new Set(entry.metadata_paths.map(p=>path.join(root,p))),directories=new Set([parent,harness]);
 for(const file of [...allowed.keys(),...metadataPaths]){let d=path.dirname(file);while(true){directories.add(d);const next=path.dirname(d);if(next===d)break;d=next;}}
 function readable(file){const p=typeof file==='string'?path.resolve(file):null;if(!p||!allowed.has(p))deny('private read');checked(p,allowed.get(p));reads.add(p);return p;}
 function metadata(file){if(typeof file!=='string')deny('metadata type');const p=path.resolve(file);if(!allowed.has(p)&&!directories.has(p)&&!metadataPaths.has(p)&&!(p===output&&receipt.output_written))deny('private metadata '+p);return p;}
 fs.statSync=(f,...a)=>raw.statSync(metadata(f),...a);fs.lstatSync=(f,...a)=>raw.lstatSync(metadata(f),...a);fs.realpathSync=(f,...a)=>raw.realpathSync(metadata(f),...a);fs.realpathSync.native=fs.realpathSync;
 fs.existsSync=f=>{
  if(typeof f==='string'){
   const p=path.resolve(f);let ancestor=path.dirname(p);
   // Checked regular files cannot have children: preserve Node's ENOTDIR -> false without IO.
   while(true){if(allowed.has(ancestor))return false;const next=path.dirname(ancestor);if(next===ancestor)break;ancestor=next;}
   // The launcher compares the complete installed regular/symlink map to disk before/finally.
   // Only a missing package.json beneath an already known vendor directory is inferable.
   if(path.basename(p)==='package.json'&&!allowed.has(p)&&!directories.has(p)&&!dependencySymlinks.has(p)&&directories.has(path.dirname(p))&&Object.values(depRoots).some(base=>path.dirname(p).startsWith(path.join(base,'node_modules')+path.sep)))return false;
  }
  try{raw.lstatSync(metadata(f));return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}
 };
 fs.readdirSync=(f,options)=>{const p=path.resolve(f);if(!directories.has(p)||options&&typeof options==='object'&&options.withFileTypes)deny('directory read');const names=[...allowed.keys()].filter(k=>path.dirname(k)===p).map(k=>path.basename(k));if(!names.length)deny('directory read');return [...new Set(names)].sort();};
 fs.openSync=(f,flags,...a)=>{if(!['r','rs',0].includes(flags))deny('open write');const fd=raw.openSync(readable(f),flags,...a);fds.add(fd);return fd;};
 fs.closeSync=fd=>{if(!fds.delete(fd))deny('unowned descriptor close');return raw.closeSync(fd);};
 fs.readSync=(fd,...a)=>{if(!fds.has(fd))deny('unowned descriptor read');return raw.readSync(fd,...a);};fs.fstatSync=(fd,...a)=>{if(!fds.has(fd))deny('unowned descriptor metadata');return raw.fstatSync(fd,...a);};
 fs.readFileSync=(f,...a)=>raw.readFileSync(typeof f==='number'?(fds.has(f)?f:deny('unowned descriptor read')):readable(f),...a);
 fs.mkdirSync=(f,options)=>{if(typeof f!=='string'||(f!==harness&&!(policy.variant!=='world'&&f===parent))||!options||options.recursive!==true||Object.keys(options).some(k=>k!=='recursive')||raw.realpathSync(f)!==f)deny('mkdir');};
 fs.writeFileSync=(f,data)=>{terminalQuiet('output');if(typeof f!=='string'||f!==output||receipt.output_written)deny('output write');const b=Buffer.isBuffer(data)?data:Buffer.from(data);if(b.length>entry.gzip_limit_bytes)deny('compressed output bound');const fd=raw.openSync(output,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{let i=0;while(i<b.length){const n=raw.writeSync(fd,b,i,b.length-i);if(!n)throw Error('short output write');i+=n;}}finally{raw.closeSync(fd);}receipt.output_written=true;receipt.output_sha256=hash(b);receipt.output_bytes=b.length;};
 const safe=new Set(['readFileSync','openSync','closeSync','readSync','writeFileSync','statSync','lstatSync','realpathSync','existsSync','fstatSync','readdirSync','mkdirSync']);for(const n of Object.keys(fs))if(typeof fs[n]==='function'&&!safe.has(n))fs[n]=n==='Stats'?function OracleDeniedStats(){return deny('filesystem Stats');}:()=>deny('filesystem '+n);for(const n of Object.keys(fs.promises))if(typeof fs.promises[n]==='function')fs.promises[n]=()=>deny('filesystem promises '+n);
  process.chdir=f=>{const p=path.resolve(f);if(p!==parent)deny('chdir');changes.push(p);return chdir(p);};
 const createServer=http.createServer,listen=net.Server.prototype.listen,connect=net.Socket.prototype.connect,request=http.request;
 const dns=require('dns'),nativeLookup=dns.lookup;let pendingListen=null;
 http.createServer=function(...a){terminalQuiet('server');const server=createServer.apply(this,a);servers.add(server);server.on('listening',()=>{const a=server.address();if(!a||a.address!=='127.0.0.1')deny('owned listener address');ports.add(a.port);server.__oraclePort=a.port;});server.on('close',()=>{ports.delete(server.__oraclePort);servers.delete(server);});server.on('connection',socket=>{socketRoles.set(socket,{role:'server',port:server.__oraclePort});sockets.add(socket);socket.on('close',()=>retireSocket(socket));});return server;};
 net.Server.prototype.listen=function(...a){
  terminalQuiet('listen');
  if(!servers.has(this)||a[0]!==0||a[1]!=='127.0.0.1'||a.length!==3||typeof a[2]!=='function')deny('listen exact ephemeral loopback');
  const previousListen=pendingListen;pendingListen={consumed:false};
  try{return listen.apply(this,a);}finally{pendingListen=previousListen;}
 };
  const nativeGet=http.get;
  function ownedHttp(options,get=false){
   if(!options||typeof options!=='object'||options.host!=='127.0.0.1'||!ports.has(Number(options.port))||options.protocol&&options.protocol!=='http:'||options.auth||options.socketPath||options.createConnection)deny('HTTP unowned host/port/method');
   const methods=policy.variant==='s02'?['GET','HEAD','PUT','POST','DELETE','OPTIONS']:policy.variant==='widget'?['GET','HEAD']:['GET'];
   if(!methods.includes(options.method||'GET')||(!get&&options.agent!==false)||(get&&options.agent!==undefined))deny('HTTP unowned host/port/method');
  }
  http.request=function(options,...a){terminalQuiet('HTTP');ownedHttp(options);transportCalls++;httpDepth++;try{return request.call(this,options,...a);}finally{httpDepth--;}};
  http.get=function(url,options,callback){
   terminalQuiet('HTTP');if(policy.variant!=='s02'||typeof url!=='string'||arguments.length!==3||!options||Object.keys(options).some(k=>!['headers','agent'].includes(k)))deny('http.get shape');
   const u=new URL(url);ownedHttp({host:u.hostname,port:u.port,protocol:u.protocol,auth:u.username||u.password,agent:options.agent,method:'GET'},true);
   transportCalls++;httpDepth++;try{return nativeGet.call(this,url,options,callback);}finally{httpDepth--;}
  };
 net.Socket.prototype.connect=function(...a){terminalQuiet('socket');let option=a[0];if(Array.isArray(option))option=option[0];const host=typeof option==='object'?option.host:a[1],port=Number(typeof option==='object'?option.port:option);if(!httpDepth||host!=='127.0.0.1'||!ports.has(port))deny('unowned socket connect');sockets.add(this);this.once('close',()=>retireSocket(this));return connect.apply(this,a);};
 net.createServer=()=>deny('net.createServer');
 for(const [m,names] of [['tls',['connect','createServer']],['https',['request','get','createServer']],['dgram',['createSocket']],['child_process',['exec','execFile','execSync','execFileSync','spawn','spawnSync','fork']]]){const target=require(m);for(const n of names)target[n]=()=>deny(m+'.'+n);}
 const timers=require('timers');global.setInterval=timers.setInterval=()=>deny('background interval');require('worker_threads').Worker=function(){return deny('worker');};require('cluster').fork=()=>deny('cluster.fork');
 for(const C of [dns.Resolver,dns.promises.Resolver])if(C)for(const n of Object.getOwnPropertyNames(C.prototype))if(n!=='constructor'&&typeof C.prototype[n]==='function')C.prototype[n]=()=>deny('dns Resolver');for(const target of [dns,dns.promises])for(const n of Object.keys(target))if(typeof target[n]==='function')target[n]=()=>deny('dns '+n);
 // Node16 numeric listen still calls public lookup; permit only its exact one-use native literal branch.
 dns.lookup=function(hostname,callback){
  if(!pendingListen)deny('dns lookup outside owned listen');
  if(pendingListen.consumed)deny('dns lookup consumed');
  if(arguments.length!==2||hostname!=='127.0.0.1'||typeof callback!=='function')deny('dns lookup shape');
  pendingListen.consumed=true;return nativeLookup.call(dns,hostname,callback);
 };
 const nativeResolve=Module._resolveFilename,rawLoad=Module._load,builtins=new Set(Module.builtinModules.map(n=>n.replace(/^node:/,''))),parents=new Set(entry.alias_parents.map(p=>path.join(root,p))),resolutions=[],patchedMongoose=new WeakSet(),patchedMongoClient=new WeakSet();
 Module._resolveFilename=function(id,parent,isMain,...rest){if(Object.hasOwn(entry.direct_aliases,id)&&!(parent&&Object.values(depRoots).some(base=>parent.filename.startsWith(path.join(base,'node_modules')+path.sep)))){if(!parent||!parents.has(parent.filename))deny('direct alias wrong parent');const group=entry.direct_aliases[id],resolved=nativeResolve.call(this,path.join(depRoots[group],'node_modules',id),parent,isMain,...rest);resolutions.push({request:id,parent:parent.filename,root:group,resolved});return resolved;}return nativeResolve.call(this,id,parent,isMain,...rest);};
 // Only the original two fixed consumers in the selected verified primary root may load this real optional builtin.
 const asyncHookParents=depRoots[primary]?new Map([
  [path.join(depRoots[primary],'node_modules/raw-body/index.js'),'e1c1ff9152ec1f5cf1ef1c2b853d6723e93ba13e4e9f1f15f9c6b2026a39a1cb'],
  [path.join(depRoots[primary],'node_modules/on-finished/index.js'),'8e16bae14ec63bac9cdbb50572a7b53061fee914712f5e803ff03c44e8845276']
 ]):new Map();
 Module._load=function(id,parent,isMain){
  const scopedAsync=id==='async_hooks'&&['s02','world','widget'].includes(policy.variant)&&parent&&asyncHookParents.has(parent.filename)&&allowed.get(parent.filename)===asyncHookParents.get(parent.filename);
  const builtin=id.replace(/^node:/,'');if(builtins.has(builtin)){if(!spec.builtins.includes(builtin)&&!scopedAsync){if(builtin==='async_hooks')refusal('builtin async_hooks',{request:id,parent:parent?parent.filename:null,parent_sha256:parent&&allowed.get(parent.filename)||null});deny('builtin '+builtin);}return rawLoad.apply(this,arguments);}
  const resolved=Module._resolveFilename(id,parent,isMain);if(!allowed.has(resolved))deny('module path '+resolved);if(resolved.endsWith('.node'))deny('native module');
  if(parent)for(const base of Object.values(depRoots))if(parent.filename.startsWith(path.join(base,'node_modules')+path.sep)&&!resolved.startsWith(path.join(base,'node_modules')+path.sep))deny('cross-root dependency');
  loads.add(resolved);
  const previousCjs=pendingCjs;
  const freshCjs=(resolved.endsWith('.js')||resolved.endsWith('.cjs'))&&!Object.prototype.hasOwnProperty.call(Module._cache,resolved);
  // JSON and cached/circular loads open no compile permission. Nested loads restore the consumed parent.
  pendingCjs=freshCjs?{filename:resolved,sha256:allowed.get(resolved),consumed:false}:null;
  let result;
  try{result=rawLoad.call(this,resolved,parent,isMain);}finally{pendingCjs=previousCjs;}
  if(resolved.endsWith('/mongoose/index.js')&&!patchedMongoose.has(result)){for(const target of [result,result.Mongoose.prototype])for(const n of ['connect','createConnection'])target[n]=()=>deny('mongoose '+n);for(const n of ['openUri','openSet'])result.Connection.prototype[n]=()=>deny('mongoose Connection');patchedMongoose.add(result);}
  if(resolved.endsWith('/mongodb/index.js')&&result.MongoClient&&!patchedMongoClient.has(result.MongoClient)){result.MongoClient.connect=()=>deny('MongoClient.connect');result.MongoClient.prototype.connect=()=>deny('MongoClient.connect');patchedMongoClient.add(result.MongoClient);}
  return result;
 };
 const newContext=vm.runInNewContext,inContext=vm.runInContext,createContext=vm.createContext,contexts=new WeakSet();
 function vmOptions(code,options={},sandbox,argc,method){
  if(typeof code!=='string')deny('VM code type');const filename=options.filename===undefined?null:options.filename;
  // One source-derived Node16 helper identity; trusted fixed inputs, not caller authentication.
  if(filename==='structured-stack'){
   if(method!=='runInNewContext')deny('VM native method');
   if(argc!==3)deny('VM native arguments');
   const object=o=>o&&typeof o==='object'&&!Array.isArray(o);
   const optionKeys=object(options)?Reflect.ownKeys(options):[],option=object(options)&&Object.getOwnPropertyDescriptor(options,'filename');
   if(optionKeys.length!==1||optionKeys[0]!=='filename'||!option||!Object.hasOwn(option,'value')||option.value!=='structured-stack')deny('VM native options');
   const contextKeys=object(sandbox)?Reflect.ownKeys(sandbox):[],context=object(sandbox)&&Object.getOwnPropertyDescriptor(sandbox,'overrideStackTrace');
   if(contextKeys.length!==1||contextKeys[0]!=='overrideStackTrace'||!context||!Object.hasOwn(context,'value')||!context.value||typeof context.value!=='object'||typeof context.value.set!=='function')deny('VM native context');
   if(!['s02','world','widget'].includes(policy.variant)||spec.node_version!=='v16.20.2'||spec.node_sha256!=='83325958463d59cb0b16433eefab0a03fd1ce7d565a27e0274f507b1f3839a6e'||policy.node_sha256!==spec.node_sha256)deny('VM native profile');
   const digest=hash(Buffer.from(code));if(Buffer.byteLength(code,'utf8')!==243||digest!=='74624fddc8f672961098f19cb2afcbff94c92d21ceb1540c96eaba77d9479b51')deny('VM native code identity');
   if(!entry.vm_entries.some(v=>v.filename===filename&&v.sha256===digest))deny('VM code identity');
   if(vms.length>=10000)deny('VM call bound');vms.push({filename,sha256:digest});return {...options,timeout:1000};
  }
  if(filename!==null&&(!path.isAbsolute(filename)||filename!==path.resolve(filename)||!allowed.has(filename))){refusal('VM filename',{filename,code_utf8_bytes:Buffer.byteLength(code,'utf8'),code_sha256:Buffer.byteLength(code,'utf8')<=64*1024*1024?hash(Buffer.from(code)):null});deny('VM filename');}const relative=filename===null?null:path.relative(root,filename),digest=hash(Buffer.from(code));if(!entry.vm_entries.some(v=>v.filename===relative&&v.sha256===digest))deny('VM code identity');if(vms.length>=10000)deny('VM call bound');vms.push({filename:relative,sha256:digest});return {...options,timeout:1000};
 }
 vm.createContext=(sandbox,...a)=>{const context=createContext.call(vm,sandbox,...a);contexts.add(context);return context;};
 vm.runInNewContext=function(code,sandbox={},options={}){if(oneCaseDiagnostic&&transportCalls>=1&&options.filename===path.join(root,'server/test/offline/rss-response-smoke.js'))deny('diagnostic case boundary');const result=newContext.call(vm,code,sandbox,vmOptions(code,options,sandbox,arguments.length,'runInNewContext'));contexts.add(sandbox);return result;};
 vm.runInContext=(code,context,options={})=>{if(!contexts.has(context))deny('VM context');return inContext.call(vm,code,context,vmOptions(code,options));};
 vm.compileFunction=function(content,params,options){
  const slot=pendingCjs;if(!slot||slot.consumed)deny('VM compileFunction dynamic');
  if(arguments.length!==3)deny('CJS compileFunction arguments');
  if(typeof content!=='string'||Buffer.byteLength(content,'utf8')>64*1024*1024||hash(Buffer.from(content,'utf8'))!==slot.sha256)deny('CJS compileFunction body');
  if(!Array.isArray(params)||params.length!==CJS_PARAMS.length||CJS_PARAMS.some((value,i)=>params[i]!==value))deny('CJS compileFunction parameters');
  if(!options||typeof options!=='object'||Array.isArray(options))deny('CJS compileFunction options');
  const keys=Reflect.ownKeys(options);
  if(keys.length!==2||!keys.includes('filename')||!keys.includes('importModuleDynamically')||typeof options.importModuleDynamically!=='function')deny('CJS compileFunction options');
  if(options.filename!==slot.filename||!path.isAbsolute(options.filename)||options.filename!==path.resolve(options.filename))deny('CJS compileFunction filename');
  const audit={filename:slot.filename,sha256:slot.sha256},auditBytes=Buffer.byteLength(JSON.stringify(audit))+1;
  if(cjsCompiles.length>=4096||cjsAuditBytes+auditBytes>1024*1024)deny('CJS compileFunction audit bound');
  // Consume before native compilation returns the wrapper: module code can never reuse this slot.
  slot.consumed=true;
  const compiled=nativeCompileFunction.call(vm,content,params,options);
  cjsCompiles.push(audit);cjsAuditBytes+=auditBytes;return compiled;
 };
 vm.Script=function(){return deny('VM Script');};vm.runInThisContext=()=>deny('VM runInThisContext');
 finalCheck=()=>{for(const [file,digest] of allowed)checked(file,digest);if(raw.realpathSync(process.cwd())!==parent)deny('cwd not restored');};
 receipt={oracle_guard:1,profile:'rest_http',variant:policy.variant,status:'READY',terminal_close_drain:terminalAudit,sources:policy.sources,exports:policy.exports,guard_sha256:policy.guard_sha256,spec_sha256:policy.spec_sha256,direct_resolutions:resolutions,dependency_file_count:Object.values(policy.dependency_roots).reduce((n,r)=>n+Object.keys(r.files).length,0),output_written:false,clock:'original driver/VM/global clocks retained'};
}catch(error){if(!violations.length)violations.push(error.message);throw error;}
