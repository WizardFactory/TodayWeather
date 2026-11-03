'use strict';
// One offline towns replay boundary; not a sandbox for arbitrary hostile code.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), Module = require('module');
// Initialize Node's lazy standard streams before denying new filesystem streams.
void process.stdin; void process.stdout; void process.stderr;
const raw = Object.fromEntries(['readFileSync','openSync','closeSync','readSync','writeSync','lstatSync','statSync','fstatSync','realpathSync','writeFileSync'].map(k=>[k,fs[k].bind(fs)]));
const SOURCES = ['server/controllers/geo.controller.js','server/controllers/controllerTown.js','server/models/town.js','server/controllers/controllerTown24h.js','server/lib/unitConverter.js'];
const hash = b=>crypto.createHash('sha256').update(b).digest('hex');
let violations = [], receipt = {towns_guard:1,status:'INVALID'};
function deny(reason) { violations.push(reason); throw Error('TOWNS_DENIED '+reason); }
function regular(file) {
  const absolute=path.resolve(file); let current=path.parse(absolute).root;
  for(const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current=path.join(current,part); if(raw.lstatSync(current).isSymbolicLink())deny('symlink');
  }
  if(!raw.lstatSync(absolute).isFile())deny('regular file required'); return absolute;
}
function readChecked(file,expected,limit=8*1024*1024) {
  file=regular(file);const stat=raw.lstatSync(file);
  if(stat.size>limit)deny('input size');const bytes=raw.readFileSync(file);
  if(hash(bytes)!==expected)deny('input identity '+file);return bytes;
}
process.on('exit',code=>{
  receipt.status=violations.length?'DENIED':code?'ERROR':'RECORDED';receipt.violations=violations;
  if(violations.length)process.exitCode=2;
  raw.writeSync(1,JSON.stringify(receipt)+'\n');
});
try {
  if(process.version!=='v16.20.2')deny('node version');
  const policyPath=regular(process.env.TW_TOWNS_POLICY||'');
  if(raw.lstatSync(policyPath).size>2*1024*1024)deny('policy size');
  const policy=JSON.parse(raw.readFileSync(policyPath,'utf8'));
  if(policy.schema!==1||Object.keys(policy.sources).sort().join('\n')!==SOURCES.slice().sort().join('\n'))deny('fixed five sources');
  const root=raw.realpathSync(policy.root),deps=raw.realpathSync(policy.dependencies);
  const driver=path.join(root,'server/test/offline/record-towns.js'),guard=path.join(root,'server/test/offline/towns-oracle-guard.js');
  readChecked(driver,policy.driver_sha256);readChecked(guard,policy.guard_sha256);
  const allowed=new Set([driver,guard]);const actualSources={};
  for(const relative of SOURCES){const file=path.join(root,relative);readChecked(file,policy.sources[relative],1024*1024);allowed.add(file);actualSources[relative]=policy.sources[relative];}
  for(const [relative,expected] of Object.entries(policy.dependency_files)) {
    if(path.isAbsolute(relative)||relative.split('/').includes('..'))deny('dependency path');
    const file=path.join(deps,relative);readChecked(file,expected);allowed.add(file);
  }
  const mongoosePackage=path.join(deps,'node_modules/mongoose/package.json');
  if(JSON.parse(raw.readFileSync(mongoosePackage,'utf8')).version!=='5.1.2')deny('mongoose version');
  const output=path.resolve(policy.output),outputParent=path.dirname(output);
  if(path.dirname(outputParent)!==path.join(root,'reports')||raw.realpathSync(outputParent)!==outputParent)deny('owned output');
  try{raw.lstatSync(output);deny('output exists');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(process.argv[1]!==driver||process.argv[2]!==output||process.argv.length!==3)deny('driver argv');
  if(process.env.TW_REPO!==root||process.env.TW_MONGOOSE_MODULE!==path.join(deps,'node_modules/mongoose')||process.env.TZ!=='UTC'||process.env.NODE_ENV!=='production')deny('fixed environment');
  const expectedEnv=new Set(['PATH','LANG','TZ','NODE_ENV','TW_REPO','TW_MONGOOSE_MODULE','TW_TOWNS_POLICY']);
  // Darwin's runtime injects this encoding key even into an explicit empty env.
  if(process.platform==='darwin'&&/^0x[0-9a-f]+:0x[0-9a-f]+:0x[0-9a-f]+$/i.test(process.env.__CF_USER_TEXT_ENCODING||''))expectedEnv.add('__CF_USER_TEXT_ENCODING');
  if(Object.keys(process.env).some(k=>!expectedEnv.has(k)))deny('inherited environment');
  function readable(file){const absolute=typeof file==='string'?path.resolve(file):null;if(!absolute||!allowed.has(absolute))deny('private read');return regular(absolute);}
  const directories=new Set();
  for(const file of allowed){let directory=path.dirname(file);while(true){directories.add(directory);const parent=path.dirname(directory);if(parent===directory)break;directory=parent;}}
  function metadata(file){const absolute=path.resolve(file);if(!allowed.has(absolute)&&!directories.has(absolute)&&!absolute.startsWith(path.join(deps,'node_modules')+path.sep))deny('private metadata '+absolute);return absolute;}
  fs.statSync=(file,...args)=>raw.statSync(metadata(file),...args);
  fs.lstatSync=(file,...args)=>raw.lstatSync(metadata(file),...args);
  fs.realpathSync=(file,...args)=>raw.realpathSync(metadata(file),...args);fs.realpathSync.native=fs.realpathSync;
  fs.existsSync=file=>{try{raw.lstatSync(metadata(file));return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
  const fds=new Set();
  fs.fstatSync=(fd,...args)=>{if(!fds.has(fd))deny('unowned descriptor metadata');return raw.fstatSync(fd,...args);};
  fs.openSync=(file,flags,...rest)=>{if(!['r','rs',0].includes(flags))deny('open write');const fd=raw.openSync(readable(file),flags,...rest);fds.add(fd);return fd;};
  fs.closeSync=fd=>{fds.delete(fd);return raw.closeSync(fd);};
  fs.readSync=(fd,...args)=>{if(!fds.has(fd))deny('unowned descriptor read');return raw.readSync(fd,...args);};
  fs.readFileSync=(file,...args)=>raw.readFileSync(typeof file==='number'?(fds.has(file)?file:deny('unowned descriptor read')):readable(file),...args);
  fs.writeFileSync=(file,data)=>{
    if(path.resolve(file)!==output||receipt.output_written)deny('output write');
    const bytes=Buffer.isBuffer(data)?data:Buffer.from(data);if(bytes.length>2*1024*1024)deny('output size');
    const fd=raw.openSync(output,'wx',0o600);try{let offset=0;while(offset<bytes.length)offset+=raw.writeSync(fd,bytes,offset,bytes.length-offset);}finally{raw.closeSync(fd);}
    receipt.output_written=true;
  };
  const safeFs=new Set(['readFileSync','openSync','closeSync','readSync','writeFileSync','statSync','lstatSync','realpathSync','existsSync','fstatSync']);
  for(const name of Object.keys(fs))if(typeof fs[name]==='function'&&!safeFs.has(name))fs[name]=function(){return deny('filesystem '+name);};
  for(const name of Object.keys(fs.promises))if(typeof fs.promises[name]==='function')fs.promises[name]=()=>deny('filesystem promises '+name);
  for(const [module,names] of [['net',['connect','createConnection','createServer']],['tls',['connect','createServer']],['http',['request','get','createServer']],['https',['request','get','createServer']],['dgram',['createSocket']],['child_process',['exec','execFile','execSync','execFileSync','spawn','spawnSync','fork']]]) {
    const target=require(module);for(const name of names)target[name]=()=>deny(module+'.'+name);
  }
  require('worker_threads').Worker=function(){return deny('worker_threads.Worker');};
  require('cluster').fork=()=>deny('cluster.fork');
  require('net').Socket.prototype.connect=()=>deny('net.Socket.connect');
  require('net').Server.prototype.listen=()=>deny('net.Server.listen');
  const dns=require('dns');for(const name of Object.keys(dns)){if(typeof dns[name]==='function')dns[name]=()=>deny('dns.'+name);}
  for(const name of Object.keys(dns.promises))if(typeof dns.promises[name]==='function')dns.promises[name]=()=>deny('dns.promises.'+name);
  const rawLoad=Module._load,builtins=new Set(Module.builtinModules.map(n=>n.replace(/^node:/,'')));
  const mongooseEntry=path.join(deps,'node_modules/mongoose/index.js');
  Module._load=function(id,parent,isMain){
    if(builtins.has(id.replace(/^node:/,'')))return rawLoad.apply(this,arguments);
    const resolved=Module._resolveFilename(id,parent,isMain);if(!allowed.has(resolved))deny('module path');
    const result=rawLoad.apply(this,arguments);
    if(resolved===mongooseEntry){result.connect=()=>deny('mongoose.connect');result.createConnection=()=>deny('mongoose.createConnection');result.Mongoose.prototype.connect=()=>deny('mongoose.connect');result.Mongoose.prototype.createConnection=()=>deny('mongoose.createConnection');}
    return result;
  };
  const RealDate=Date,clock=Date.UTC(2026,9,16,0,0,0);
  class FixedDate extends RealDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
  const vm=require('vm'),run=vm.runInNewContext;
  vm.runInNewContext=(code,context={},options={})=>{if(!Object.prototype.hasOwnProperty.call(context,'Date'))context.Date=FixedDate;return run.call(vm,code,context,{...options,timeout:1000});};
  receipt={towns_guard:1,status:'READY',sources:actualSources,driver_sha256:policy.driver_sha256,guard_sha256:policy.guard_sha256,dependency_files:Object.keys(policy.dependency_files).length,clock:'2026-10-16T00:00:00.000Z',output_written:false};
} catch(error) { if(!violations.length)violations.push(error.message);throw error; }
