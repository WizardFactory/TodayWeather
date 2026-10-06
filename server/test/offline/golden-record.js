/* S02 named legacy oracle exception. Executes frozen real handlers, never app startup.
 * New recordings belong to server2/tests/golden; production runtime never imports this file.
 * Existing offline harness inputs remain maintained legacy inputs, with source hashes below.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');
const crypto = require('crypto'), assert = require('assert'), http = require('http');
const root = path.resolve(__dirname, '../../..');
const server = path.join(root, 'server');
const baseRevision = 'f568508da68d408a282752f55614407899631c88';
if(Object.keys(process.env).some(k=>k.startsWith('TW_SMOKE_')))throw new Error('Host smoke clock/mode overrides forbidden');
if (process.env.TW_VC_LIVE || process.env.VC_SECRET_KEY || process.env.PUSH_STORE || process.env.TW_MONGO_URL) throw new Error('Live mode or production hints forbidden');
if (process.env.TZ !== 'UTC' || process.env.NODE_ENV !== 'production') throw new Error('TZ=UTC NODE_ENV=production required');
if(process.version!=='v16.20.2')throw new Error('Pinned oracle Node v16.20.2 required');
const outputArg = process.argv.indexOf('--output');
if (outputArg < 0 || !process.argv[outputArg+1]) throw new Error('Explicit --output required');
const outputDir = path.resolve(process.argv[outputArg+1]);
assert(!outputDir.startsWith(server + path.sep), 'No golden output under legacy server');
fs.mkdirSync(outputDir, {recursive:true});
process.env.TW_SMOKE_OUTPUT_DIR=path.join(outputDir,'harness-scratch');
const sourceFiles = {}, rawRead = fs.readFileSync;
const nodePath=process.env.NODE_PATH;if(!nodePath||nodePath.includes(path.delimiter)||!path.isAbsolute(nodePath))throw new Error('Single isolated absolute NODE_PATH required');
const dependencyRoot=fs.realpathSync(nodePath),builtin=new Set(Module.builtinModules.map(n=>n.replace(/^node:/,''))),loadModule=Module._load;
Module._load=function(id,parent,isMain){
    if(!builtin.has(id.replace(/^node:/,''))){const resolved=fs.realpathSync(Module._resolveFilename(id,parent,isMain));
        if(!resolved.startsWith(server+path.sep)&&!resolved.startsWith(dependencyRoot+path.sep))throw new Error('Oracle module outside legacy/dependency boundary');}
    return loadModule.apply(this,arguments);
};
fs.readFileSync = function(file, ...args) {
    if(typeof file==='string'){const resolved=path.resolve(file);if(resolved.startsWith(server+path.sep)&&( /\.(?:pem|env)$/.test(resolved)||resolved===path.join(server,'config/config.js')))throw new Error('Production/private input forbidden before read');}
    const bytes = rawRead.call(this, file, ...args);
    if (typeof file === 'string' || file instanceof URL || Buffer.isBuffer(file)) {
        const resolved = path.resolve(String(file));
        if (resolved.startsWith(server + path.sep)) {
            if (/\.(?:pem|env)$/.test(resolved) || resolved === path.join(server, 'config/config.js')) throw new Error('Production/private input forbidden');
            const raw = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
            sourceFiles[path.relative(root,resolved).replace(/\\/g,'/')] = crypto.createHash('sha256').update(raw).digest('hex');
        }
    }
    return bytes;
};
const allowedPorts = new Set(), network = {rejected:0, accepted:0};
const net = require('net'), connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
    let a = args[0]; if (Array.isArray(a)) a = a[0];
    const host = typeof a === 'object' ? a.host : args[1];
    const port = typeof a === 'object' ? Number(a.port) : Number(a);
    if (host !== '127.0.0.1' || !allowedPorts.has(port)) { network.rejected++; throw new Error('Oracle network denied'); }
    network.accepted++; return connect.apply(this,args);
};
require('dns').lookup = (host,options,callback) => {if(typeof options==='function')callback=options;if(host!=='127.0.0.1')throw new Error('Oracle DNS denied');process.nextTick(()=>callback(null,'127.0.0.1',4));};
for (const method of ['resolve','resolve4','resolve6']) require('dns')[method] = () => { throw new Error('Oracle DNS denied'); };
for (const method of ['request','get']) require('https')[method] = () => { throw new Error('Oracle HTTPS denied'); };
require('dgram').createSocket = () => { throw new Error('Oracle UDP denied'); };
for (const method of ['exec','execFile','execFileSync','spawn','fork','execSync','spawnSync']) require('child_process')[method] = () => { throw new Error('Oracle child process denied'); };
assert.throws(()=>require('net').connect({host:'127.0.0.1',port:1}), /Oracle network denied/);
const express = require('express'), cors = require('cors'), session = require('express-session');
const bodyParser = require('body-parser'), cookieParser = require('cookie-parser'), i18n = require('i18n');
const locales = ['en','ko','ja','zh-CN','de','zh-TW'];
i18n.configure({locales,cookie:'twcookie',directory:path.join(server,'locales'),register:global,updateFiles:false});
let now = '2026-09-24T00:10:00.000Z';
const RealDate = Date;
class FixedDate extends RealDate { constructor(...args){super(...(args.length?args:[now]));} static now(){return RealDate.parse(now);} }
global.Date = FixedDate;
const clone = v => require('v8').deserialize(require('v8').serialize(v));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const quiet = Object.fromEntries(['info','warn','error','debug','verbose','silly'].map(k=>[k,()=>{}]));
// Actual app.js registers global: i18n.init updates it for each request. Delegate
// VM globals to that registered object; never preselect a synthetic translation locale.
function translate(){return function(...args){return i18n.__.apply(global,args);};}
function harnessModule(file, extra, transform) {
    let code = fs.readFileSync(file,'utf8');
    if (transform) code = transform(code);
    const m = {exports:{}}, req = Module.createRequire(file);
    const sandbox = {require:req,module:m,exports:m.exports,__dirname:path.dirname(file),__filename:file,
        process,console,Buffer,Date:FixedDate,URL,URLSearchParams,setTimeout,clearTimeout,setImmediate,...extra};
    vm.runInNewContext('(function(require,module,exports,__filename,__dirname){'+code+'\n})',sandbox,{filename:file})(req,m,m.exports,file,path.dirname(file));
    return m.exports;
}
// Reuse the existing fixture/store/loader setup unchanged; replace only its hardcoded test
// route/request orchestration tail, not any production source or controller function.
function makeDomesticHarness(){return harnessModule(path.join(__dirname,'rss-response-smoke.js'),{oracleRoute:''},code=>{
    const marker = '  const routeFile=path.join(root,\'server/routes/v000903/route.kma.v000903.js\');';
    assert(code.includes(marker), 'Maintained domestic harness boundary changed');
    return code.slice(0,code.indexOf(marker))+`
  const routeFile=historyOptions.oracleRoute;
  const family=load(routeFile);const router=historyOptions.fullIndex?load(historyOptions.fullIndex):family;
  const methods=[];
  for(const layer of family.stack) if(layer.route) {
    layer.route.stack.forEach((entry,index)=>{
      const original=entry.handle;
      entry.handle=function(req,res,next){activeMethod=entry.routeMethod || original.name || 'layer-'+index;traces.push(activeMethod);return original(req,res,next);};
    });
  }
  return {router,logs,queries,traces,load};
}
module.exports={makeFixture,createHarness,locations};`;
});}
process.env.TW_REPO=root;const domesticHarness=makeDomesticHarness();
process.env.TW_REPO = root;
// Domestic harness resolves root at load; compile above receives explicit root via env before call.
const cases=[], coverage=new Set(), domesticBodies={};
const inventory=JSON.parse(fs.readFileSync(path.join(root,'server2/tests/golden/inventory.json'),'utf8')).groups;
function appFor(router, mount, gateway) {
    const app=express(); app.set('env','production'); app.set('views',path.join(server,'views'));app.set('view engine','jade');
    app.use((req,res,next)=>{res.setHeader('Date',new RealDate(now).toUTCString());next();});
    app.use(cors());
    if(gateway) app.use(gateway);
    app.use(session({secret:'wizard factory',resave:false,saveUninitialized:true,genid:()=> 'golden-session-fixed',cookie:{maxAge:60000}}));
    app.use(bodyParser.json());app.use(bodyParser.urlencoded({extended:false}));app.use(cookieParser());app.use(i18n.init);
    app.use((req,res,next)=>{req.version=(req.url.match(/^\/(v\d+)/)||[])[1];next();});
    if(router)app.use(mount,router);
    // app.js's legacy production error callback has three parameters, so Express uses its
    // standard finalhandler for propagated errors. Do not synthesize a four-argument replacement.
    return app;
}
async function wire(app, input) {
    const listener = http.createServer(app), sockets=new Set();
    listener.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
    await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});const port=listener.address().port;allowedPorts.add(port);
    try { return await new Promise((resolve,reject)=>{
        const body=input.body===undefined?null:Buffer.from(JSON.stringify(input.body));
        const headers={connection:'close',...input.headers};if(body){headers['content-type']='application/json';headers['content-length']=body.length;}
        const req=http.request({host:'127.0.0.1',port,path:input.path,method:input.method||'GET',headers,agent:false},res=>{
            const chunks=[];let bytes=0;res.on('data',chunk=>{bytes+=chunk.length;if(bytes>4*1024*1024)req.destroy(new Error('Oracle response cap'));else chunks.push(chunk);});
            res.on('end',()=>resolve({status:res.statusCode,headers:Object.entries(res.headers).sort(([a],[b])=>a.localeCompare(b)),raw:Buffer.concat(chunks)}));
        });req.setTimeout(12000,()=>req.destroy(new Error('Oracle case timeout')));req.on('error',reject);req.end(body);
    });} finally {for(const s of sockets)s.destroy();await new Promise(resolve=>listener.close(resolve));allowedPorts.delete(port);}
}
async function capture(id,group,handler,app,input,details={}) {
    const response=await wire(app,input);
    cases.push({id,group,handler,kind:'wire',clock:now,timezone:'UTC',request:input,
        status:response.status,headers:response.headers,body_base64:response.raw.toString('base64'),body_sha256:sha(response.raw),...clone(details)});
    return response;
}
function domestic(version,locale='en',modifier=()=>{},dbVersion='2.0') {
    const fixture=domesticHarness.makeFixture(domesticHarness.locations[0],'newer');modifier(fixture);
    const routes={'v000901':'v000901/route.kma.addr.js','v000902':'v000902/route.kma.v000902.js','v000903':'v000903/route.kma.v000903.js',
        'v000705':'v000705/routeTownForecast.js','v000803':'v000803/routeTownForecast.js'};
    const options={oracleRoute:path.join(server,'routes',routes[version]),translate:translate(locale)};
    if(version==='v000705'){options.fullIndex=path.join(server,'routes/v000705/index.js');options.modules={'../v000001/routeGather':express.Router(),'./dailySummary':express.Router(),'./routePushNotification':express.Router()};}
    return domesticHarness.createHarness(dbVersion,fixture,options);
}
const townPath='/'+['서울특별시','종로구','청운효자동'].map(encodeURIComponent).join('/');
async function domesticCases(){
    for(const version of ['v000901','v000902','v000903','v000705','v000803']) {
        const h=domestic(version), mount='/'+version+(version>='v000901'?'/kma'+(version==='v000901'?'/addr':''):'/town');
        const routePath=version>='v000902'?'/addr'+townPath:version==='v000705'?'/town'+townPath:townPath;
        const group=version==='v000902'?null:'GET /'+version+(version>='v000901'?'/kma/addr/{location}':'/town/{location}');
        const actualMount=version==='v000705'?'/v000705':mount;const app=appFor(h.router,actualMount);
        const r=await capture('domestic-'+version,group,path.relative(root,path.join(server,'routes',version,version==='v000901'?'route.kma.addr.js':version==='v000902'?'route.kma.v000902.js':version==='v000903'?'route.kma.v000903.js':'routeTownForecast.js')),app,{path:actualMount+routePath});
        assert.equal(r.status,200,'Actual domestic route response '+version);if(r.raw.length)domesticBodies[version]=JSON.parse(r.raw);
        assert(h.queries.length>5,'Actual domestic models queried');
        coverage.add(version>='v000901'?'domestic-'+version:'town-'+version);
        cases[cases.length-1].backend=version>='v000901'?'domestic-'+version:'town-'+version;
        cases[cases.length-1].dependency_trace=clone({queries:h.queries,middleware:h.traces});
        const etag=Object.fromEntries(r.headers).etag;
        if(etag){const r304=await capture('domestic-'+version+'-304',group,cases[cases.length-1].handler,app,{path:actualMount+routePath,headers:{'if-none-match':etag}});assert.equal(r304.status,304);assert.equal(r304.raw.length,0);}
        else cases[cases.length-1].revalidation='No ETag emitted by this actual handler; no synthetic304';
    }

    const requestedUnits=[
        {temperatureUnit:'F',windSpeedUnit:'mph',pressureUnit:'inHg',distanceUnit:'mi',precipitationUnit:'in',airUnit:'aqicn'},
        {temperatureUnit:'C',windSpeedUnit:'km/h',pressureUnit:'hPa',distanceUnit:'km',precipitationUnit:'mm',airUnit:'airkorea'},
        {temperatureUnit:'F',windSpeedUnit:'bft',pressureUnit:'mmHg',distanceUnit:'mi',precipitationUnit:'in',airUnit:'airnow'},
        {temperatureUnit:'C',windSpeedUnit:'kr',pressureUnit:'mb',distanceUnit:'km',precipitationUnit:'mm',airUnit:'airkorea_who'},
        {temperatureUnit:'C',windSpeedUnit:'m/s',pressureUnit:'hPa',distanceUnit:'km',precipitationUnit:'mm',airUnit:'airkorea'},
        {temperatureUnit:'F',windSpeedUnit:'mph',pressureUnit:'inHg',distanceUnit:'mi',precipitationUnit:'in',airUnit:'aqicn'}];
    for(const [i,locale] of locales.entries()) {
        const h=domestic('v000903',locale,f=>{f.arpltnInfo={arpltn:{pm10Value:30,pm25Value:15,pm10Grade:1,pm25Grade:1,dataTime:'2026-09-24 09:00'},list:[],stnList:[]};});const app=appFor(h.router,'/v000903/kma');
        const units=requestedUnits[i],query=new URLSearchParams(units).toString();
        const r=await capture('domestic-locale-'+locale,'GET /v000903/kma/addr/{location}','server/routes/v000903/route.kma.v000903.js',app,
            {path:'/v000903/kma/addr'+townPath+'?'+query,headers:{'accept-language':locale}},
            {dependency_trace:{locale,units,air_store:'fixed numeric AirKorea dependency rows'}});
        assert.equal(r.status,200);assert.deepEqual(JSON.parse(r.raw).units,units);
    }
    for(const version of ['v000901','v000902','v000903']){
        const h=domestic(version,'en',()=>{},'1.0');const mount='/'+version+'/kma'+(version==='v000901'?'/addr':'');
        const p=mount+(version==='v000901'?'':'/addr')+townPath;
        const r=await capture('domestic-'+version+'-db1',version==='v000902'?null:'GET /'+version+'/kma/addr/{location}','server/routes/'+version+'/'+(version==='v000901'?'route.kma.addr.js':'route.kma.'+version+'.js'),appFor(h.router,mount),{path:p},
            {dependency_trace:{db_data_version:'1.0',queries:h.queries}});assert.equal(r.status,200);assert.equal(JSON.parse(r.raw).current.t1h,20);
    }
    const nullUnits=domestic('v000903');const nullResponse=await capture('domestic-null-units','GET /v000903/kma/addr/{location}','server/routes/v000903/route.kma.v000903.js',appFor(nullUnits.router,'/v000903/kma'),{path:'/v000903/kma/addr'+townPath+'?temperatureUnit=(null)&airUnit=(null)'});
    assert.equal(JSON.parse(nullResponse.raw).units.temperatureUnit,'C');
    for(const edge of ['pop-covered','pop-missing-hour','old-no-pop','never-requested-history','partial-history']) {
        const h=domestic('v000903','en',f=>{
            if(edge==='pop-covered') f.shortest.forEach((r,i)=>{r.pop=[42,55,77][i];});
            if(edge==='pop-missing-hour') {f.shortest[0].pop=42;f.shortest[1].pop=55;}
            if(edge==='never-requested-history') f.current=f.current.slice(-1);
            if(edge==='partial-history') f.current=f.current.slice(-12);
        });
        const r=await capture('domestic-'+edge,'GET /v000903/kma/addr/{location}','server/routes/v000903/route.kma.v000903.js',appFor(h.router,'/v000903/kma'),{path:'/v000903/kma/addr'+townPath},{dependency_trace:{edge,queries:h.queries}});
        assert.equal(r.status,200);const body=JSON.parse(r.raw);
        if(edge.startsWith('pop-') || edge==='old-no-pop'){const slot=body.short.find(r=>r.date==='20260924'&&r.time===12);assert.equal(slot.pop,edge==='pop-covered'?77:30);assert(Number.isInteger(slot.pop));}
        if(edge==='old-no-pop')assert(body.short.some(r=>r.time===24),'Actual midnight normalization');
    }

    const probe=domestic('v000903'),zones=probe.load(path.join(server,'lib/kmaWarningZones.js'));
    const areaCodes=zones.zonesForTown(domesticHarness.locations[0].town);assert(areaCodes.length);
    const warning=domestic('v000903','ko',f=>{f.zoneRows=[{areaCode:areaCodes[0],areaName:'fixed provider area label',active:true,warnVar:3,warnStress:1}];});
    const warnResponse=await capture('domestic-special-info','GET /v000903/kma/addr/{location}','server/routes/v000903/route.kma.v000903.js',appFor(warning.router,'/v000903/kma'),{path:'/v000903/kma/addr'+townPath,headers:{'accept-language':'ko'}},
        {dependency_trace:{zones:areaCodes,seed:'fixed active warning zone store row; actual zonesForTown and specialInfoFor'}});
    assert.equal(warnResponse.status,200);assert(JSON.parse(warnResponse.raw).current.specialInfo.length>0);
}

let worldHarness;
function world(version){
    now='2026-09-26T07:04:30.000Z';
    if(!worldHarness)worldHarness=harnessModule(path.join(__dirname,'vc-weather-smoke.js'),{oracleTranslate:translate('en')},code=>{assert(code.includes('__: s => s'));return code.replace('__: s => s','__: oracleTranslate');});
    worldHarness.setNow(RealDate.parse(now));
    const h=worldHarness.createHarness();
    const file=version==='v000901'?'route.dsf.coord.js':'route.dsf.coord.'+version+'.js';
    const handler='server/routes/'+version+'/'+file;
    return {h,router:h.load(path.join(root,handler)),handler};
}
async function worldCases(){
    for(const version of ['v000901','v000902','v000903']){
        const {h,router,handler}=world(version);const app=appFor(router,'/'+version+'/dsf/coord');
        const response=await capture('world-'+version,null,handler,app,{path:'/'+version+'/dsf/coord/35.68,139.76?temperatureUnit=F&windSpeedUnit=mph'},
            {dependency_trace:{provider:'recorded Visual Crossing fixture',calls:h.providerCalls}});
        assert.equal(response.status,200);const body=JSON.parse(response.raw);assert.equal(body.source,'VC');assert(body.hourly.length>24);assert(h.providerCalls.length>0);
        cases[cases.length-1].backend='world-'+version;coverage.add('world-'+version);
    }
}
function geocoder(kind,fail){
    const mod=require('../../lib/geocoder');
    const bodies=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/gateway/providers.json'),'utf8'));
    const calls=[];
    const scripted={getJson:(url,options)=>{
        const google=url.startsWith('http://google.test');calls.push({provider:google?'google':'kakao'});
        const name=google?(kind==='world'?'google.coord.london':kind==='addr'?'google.addr.jamsil':'google.coord.seoul.en'):
            kind==='addr'?'kakao.addr.jamsil':'kakao.coord.seoul';
        const denied=fail==='auth',quota=fail==='quota';
        return Promise.resolve({status:!google&&denied?401:!google&&quota?429:200,body:clone(fail?bodies[google?(denied?'google.coord.denied':quota?'google.coord.overlimit':'google.coord.zero'):'kakao.coord.empty']:bodies[name]),json:true});
    }};
    const geo=mod.createGeocoder({kakaoKeys:['synthetic-kakao'],googleKey:'synthetic-google',kakaoBaseUrl:'http://kakao.test',googleBaseUrl:'http://google.test',transport:scripted,random:()=>0,log:quiet});
    for(const method of ['coord','addr']){const original=geo[method];geo[method]=(...args)=>original(...args).catch(err=>{calls.push({error:err.code,message:err.message});throw err;});}
    return {geo,calls};
}
async function gatewayCases(){
    global.log=quiet;
    const create=require('../../routes/gateway').createGatewayRouter;
    for(const version of ['default','v000901','v000902','v000903'])for(const kind of ['domestic','world']){
        const actualVersion=version==='default'?'v000901':version;
        let backend, handler;
        if(kind==='domestic'){
            now='2026-09-24T00:10:00.000Z';const h=domestic(actualVersion,'en',f=>{f.townRows=[{...clone(f.place),town:{first:'서울특별시',second:'중구',third:'명동'}}];});
            backend=appFor(h.router,'/'+actualVersion+'/kma'+(actualVersion==='v000901'?'/addr':''));
            handler='server/routes/gateway.js';
        }else{
            const w=world(actualVersion);backend=appFor(w.router,'/'+actualVersion+'/dsf/coord');handler='server/routes/gateway.js';
        }
        const {geo,calls}=geocoder(kind);
        const backendCalls=[];
        const gateway=create({geocoder:()=>geo,log:quiet,loopback:async(p,headers)=>{
            backendCalls.push({path:p,headers});const r=await wire(backend,{path:p,headers});
            const type=Object.fromEntries(r.headers)['content-type'];let body;try{body=JSON.parse(r.raw);}catch(_){body=r.raw.toString();}
            return {status:r.status,json:!!type&&type.includes('application/json'),body};
        }});
        const prefix='/weather'+(version==='default'?'':'/'+version);
        const response=await capture('gateway-'+version+'-'+kind,'GET '+prefix+'/coord/{location}',handler,appFor(null,null,gateway),
            {path:prefix+'/coord/'+(kind==='domestic'?'37.5663,126.9779':'51.507,-0.128')},
            {dependency_trace:{geocoder:calls,backend:backendCalls,actual_backend:true}});
        assert.equal(response.status,200,'Actual gateway '+version+'/'+kind+' '+response.raw.toString().slice(0,300)+' '+JSON.stringify({backendCalls,calls}));assert(backendCalls.length>0);if(kind==='domestic')assert.equal(JSON.parse(response.raw).current.t1h,20,'Seeded matching geocode town preserves actual full backend observations');assert(!Object.fromEntries(response.headers)['set-cookie']);
    }

    for(const [id,hours] of [['never-requested',1],['resumed-after-eight-days',1],['partial-eight-day-history',12]]){
        now='2026-09-24T00:10:00.000Z';const h=domestic('v000903','en',f=>{f.current=f.current.slice(-hours);f.townRows=[{...clone(f.place),town:{first:'서울특별시',second:'중구',third:'명동'}}];});
        const backend=appFor(h.router,'/v000903/kma'),{geo,calls}=geocoder('domestic');const forwarded=[];
        const gateway=create({geocoder:()=>geo,log:quiet,loopback:async(p,headers)=>{forwarded.push({path:p});const r=await wire(backend,{path:p,headers});return {status:r.status,json:true,body:JSON.parse(r.raw)};}});
        const r=await capture('gateway-history-'+id,'GET /weather/v000903/coord/{location}','server/routes/gateway.js',appFor(null,null,gateway),{path:'/weather/v000903/coord/37.5663,126.9779'},
            {dependency_trace:{geocoder:calls,forwarded,available_observation_hours:hours,history_policy:'actual missing legacy grid observations; no synthetic ASOS replacement'}});
        assert.equal(r.status,200);const body=JSON.parse(r.raw);assert.equal(body.current.yesterday.missing,true);assert(body.midData.dailyData.length<18);
    }
    for(const [version,kind] of [['v000903','coord'],['v000903','addr'],['v000901','addr']]){
        const {geo,calls}=geocoder(kind);
        const gateway=create({geocoder:()=>geo,log:quiet,loopback:()=>{throw new Error('Geocode must not call weather');}});
        const p='/geocode/'+version+'/'+kind;
        const r=await capture('geocode-'+version+'-'+kind,'GET '+p+'/{location}','server/routes/gateway.js',appFor(null,null,gateway),
            {path:p+(kind==='coord'?'/37.5663,126.9779':'/'+['서울특별시','송파구','잠실본동'].map(encodeURIComponent).join('/'))},{dependency_trace:{geocoder:calls}});
        assert.equal(r.status,200);
    }

    for(const mode of ['auth','quota']){
        const {geo,calls}=geocoder('coord',mode);const gateway=create({geocoder:()=>geo,log:quiet,loopback:()=>{throw new Error('Rejected geocoder must not call backend');}});
        const r=await capture('geocode-'+mode,'GET /geocode/v000903/coord/{location}','server/routes/gateway.js',appFor(null,null,gateway),{path:'/geocode/v000903/coord/37.5,127'},
            {dependency_trace:{geocoder:calls,failure_mode:mode}});assert.equal(r.status,501);
    }
    const failedGeo=geocoder('domestic'),attempts=[];
    const failedGateway=create({geocoder:()=>failedGeo.geo,log:quiet,loopback:()=>{attempts.push({status:503,json:false});return Promise.resolve({status:503,json:false,body:'<synthetic-upstream-error/>'});}});
    const failedResponse=await capture('gateway-non-json-backend-error','GET /weather/v000903/coord/{location}','server/routes/gateway.js',appFor(null,null,failedGateway),{path:'/weather/v000903/coord/37.5,127'},
        {dependency_trace:{attempts,geocoder:failedGeo.calls,fixed_outcome:'non-JSON upstream503, actual max3 attempts'}});
    assert.equal(failedResponse.status,501);assert.equal(attempts.length,3);assert.equal(Object.fromEntries(failedResponse.headers)['cache-control'],'no-store');
    for(const [id,p,kind] of [['weather-invalid','/weather/coord/not-a-coordinate','domestic'],['weather-no-geocode','/weather/v000903/coord/37.5,127','domestic'],['geocode-empty','/geocode/v000903/coord/37.5,127','coord']]){
        const {geo,calls}=geocoder(kind,true);
        const gateway=create({geocoder:()=>geo,log:quiet,loopback:()=>{throw new Error('Failed geocode must not call backend');}});
        const r=await capture(id,id==='weather-invalid'?'GET /weather/coord/{location}':id.startsWith('weather')?'GET /weather/v000903/coord/{location}':'GET /geocode/v000903/coord/{location}','server/routes/gateway.js',appFor(null,null,gateway),{path:p},{dependency_trace:{geocoder:calls,expected:'fixed rejected input/provider zero-results'}});
        assert.equal(r.status,id==='weather-invalid'?400:501);assert(Object.fromEntries(r.headers)['content-type'].startsWith('text/plain'));assert.equal(Object.fromEntries(r.headers)['cache-control'],'no-store');
    }
}


const airHarness=require('./air-harness');
async function nationCases(){
    now='2026-09-24T00:10:00.000Z';
    for(const version of ['v000903','v000901']){
        const h=domestic('v000903'), Town=h.load(path.join(server,'controllers/controllerTown24h.js'));
        const Keco=h.load(path.join(server,'controllers/kecoController.js'));
        Keco.getSidoArpltn=cb=>cb(null,['서울','부산','대구','인천','광주','대전','울산','경기','강원','충북','충남','전북','전남','경북','경남','제주','세종'].map(sidoName=>({sidoName,cityName:'',sidocityName:sidoName,dataTime:'2026-09-24 09:00',pm10Value:30,pm25Value:15,pm10Grade:1,pm25Grade:1})),[]);
        const requests=[];
        const l=airHarness.createLoader({log:quiet,globals:{Date:FixedDate,__:translate('en')},overrides:{async:require('async'),express,
            'config/config.js':{apiServer:{url:'http://frozen-backend.invalid'}},
            'controllers/controllerTown24h.js':Town,'controllers/kecoController.js':Keco,
            'lib/AQI/airFallback.js':{getArpltn(){throw new Error('Fresh nation store fixture must not call provider');}},
            request:(url,options,cb)=>{requests.push({path:new URL(url).pathname,language:options.headers['Accept-Language']||null});
                if(version==='v000901')return setImmediate(()=>cb(Object.assign(new Error('frozen nation backend failure'),{status:502})));
                setImmediate(()=>cb(null,{statusCode:200},clone(domesticBodies.v000903)));}
        }});
        const router=l.load('routes/v000803/route.nation.js');
        const r=await capture('nation-'+version,'GET /'+version+'/nation/KR','server/routes/v000803/route.nation.js',appFor(router,'/'+version+'/nation'),{path:'/'+version+'/nation/KR',headers:{'accept-language':'ko'}},
            {dependency_trace:{province_store:'17 fixed valid observations',backend_requests:requests,outcome:version==='v000901'?'fixed backend502':'actual domestic body repeated as fixed HTTP dependency'},baseline_scope:version==='v000901'?'failure-only observed group; frozen actual dependency failure':'actual nation/NationAir assembly'});
        assert.equal(r.status,version==='v000901'?502:200);
        if(version==='v000903'){const b=JSON.parse(r.raw);assert.equal(b.air.length,17);assert.equal(b.weather.length,15);cases[cases.length-1].backend='nation';coverage.add('nation');}
        else assert(Object.fromEntries(r.headers)['content-type'].startsWith('text/html'));
    }
}
async function pushCases(){
    now='2026-09-24T00:10:00.000Z';let failed=false;const calls=[];
    const store={};for(const method of ['upsertAlarm','upsertAlert','updateAlarmToken','updateAlertToken','removeAlarms','removeAlerts'])store[method]=(...args)=>{
        const cb=args.pop();calls.push({method,args:clone(args)});cb(failed?new Error('frozen push store unavailable'):null,{n:1,nModified:1,ok:1});};
    const l=airHarness.createLoader({log:quiet,globals:{Date:FixedDate,manager:{leadingZeros:(n,l)=>String(n).padStart(l,'0')},__:translate('en')},overrides:{
        async:require('async'),express,i18n,sprintf:require('sprintf'),
        'config/config.js':{push:{gcmAccessKey:'synthetic'},serviceServer:{url:'http://unused.invalid'}},
        'lib/pushStore/index.js':{get:()=>store}, 'lib/pushProviders.js':{firebase(){throw new Error('Push send denied');}},
        'controllers/controllerTown24h.js':function(){},dnscache:()=>({}),request:()=>{throw new Error('Push HTTP denied');},
        'node-gcm':{Sender:function(){this.send=()=>{throw new Error('GCM send denied');};},Message:function(){}}
    }});
    const router=l.load('routes/v000705/routePushNotification.js'), list=l.load('routes/v000902/route.push.update.list.js');
    const app=appFor(null,null);app.use('/v000902/push',router);app.use('/v000705/push',router);app.use('/v000902/push-list',list);
    const rows=[
        ['push-put','PUT /v000902/push',{method:'PUT',path:'/v000902/push',body:{newToken:'synthetic-new',oldToken:'synthetic-old'}},200],
        ['push-put-invalid','PUT /v000902/push',{method:'PUT',path:'/v000902/push',body:{}},403],
        ['push-list','POST /v000902/push-list',{method:'POST',path:'/v000902/push-list',headers:{'accept-language':'ja'},body:[{type:'ios',fcmToken:'synthetic-token',location:{lat:37.5,long:127},source:'KMA',units:{temperatureUnit:'F'},cityIndex:0}]},200],
        ['push-options','OPTIONS /v000902/push',{method:'OPTIONS',path:'/v000902/push',headers:{origin:'https://synthetic.invalid','access-control-request-method':'PUT','access-control-request-headers':'content-type,device-id'}},204],
        ['push-delete','DELETE /v000902/push',{method:'DELETE',path:'/v000902/push',body:{fcmToken:'synthetic-token',cityIndex:0,id:0}},200],
        ['push-v705-store-failure','POST /v000705/push',{method:'POST',path:'/v000705/push',body:{type:'android',registrationId:'synthetic-reg',location:{lat:37.5,long:127},source:'KMA',cityIndex:0}},500]
    ];
    for(const [id,group,input,status] of rows){failed=id==='push-v705-store-failure';calls.length=0;
        const r=await capture(id,group,group.includes('push-list')?'server/routes/v000902/route.push.update.list.js':'server/routes/v000705/routePushNotification.js',app,input,
            {dependency_trace:{store:calls,outcome:failed?'fixed upsert failure':'fixed successful store callbacks'},baseline_scope:failed?'failure-only group, actual controller/store failure':'legacy registration contract; no sends'});
        assert.equal(r.status,status);if(id==='push-options')assert.equal(r.raw.length,0);if(id==='push-v705-store-failure')assert.equal(r.raw.toString(),'frozen push store unavailable');
    }
    cases.find(c=>c.id==='push-list').backend='push';coverage.add('push');
}
function warningModel(rows,statics={}){
    return Object.assign({find(query){let data=rows.filter(r=>Object.keys(query).every(k=>r[k]===query[k]));
        const chain={sort(spec){const k=Object.keys(spec)[0];data.sort((a,b)=>(a[k]>b[k]?1:-1)*spec[k]);return chain;},limit(n){data=data.slice(0,n);return chain;},lean(){return chain;},exec(cb){cb(null,clone(data));}};return chain;}},statics);
}
async function warningCases(){
    const read=name=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/kma-warning',name+'.json'),'utf8')).response.body.items.item;
    const fakeMongoose={Schema:function(){this.index=()=>{};this.statics={};},model:(n,s)=>s.statics};fakeMongoose.Schema.Types={Mixed:Object};
    const loader=airHarness.createLoader({log:quiet,globals:{Date:FixedDate},overrides:{mongoose:fakeMongoose}});
    const model=loader.load('models/modelKmaSpecialWeatherSituation.js');
    const pre=read('wthr-pwn')[0],info=read('wthr-info')[0],flash=read('brk-news')[0],msg=read('wrn-msg-0926').find(r=>r.tmSeq===128);
    const announcement=new RealDate('2026-09-27T09:10:00.000Z'); // Legacy stores KST wall time as UTC.
    const old=new RealDate('2026-09-20T09:10:00.000Z');
    const rows=[{type:1,announcement:old,situationList:model.parseSpecialText(msg.t6),comment:msg.other,bulletin:{title:msg.t1,areas:msg.t2,effectiveTimes:msg.t3,releaseOutlook:msg.t4}},
        {type:2,announcement:old,situationList:model.parsePreliminaryText(pre.pwn),comment:pre.rem},
        {type:3,announcement:old,situationList:[],comment:info.t1},
        {type:4,announcement,situationList:[],comment:flash.ann}];
    for(const [id,clock,include] of [['plus10h','2026-09-27T10:10:00.000Z',true],['plus19h','2026-09-27T19:10:00.000Z',true],['plus19h-1ms','2026-09-27T19:10:00.001Z',false],['week-old','2026-10-04T00:10:00.000Z',false]]){
        now=clock;process.env.TW_SMOKE_NOW=clock;const warningHarness=makeDomesticHarness();const fixture=warningHarness.makeFixture(warningHarness.locations[0],'newer');fixture.zoneRows=[];
        const h=warningHarness.createHarness('2.0',fixture,{oracleRoute:path.join(server,'routes/v000903/route.kma.v000903.js'),translate:translate('ko'),
            modules:{'../models/modelKmaSpecialWeatherSituation':warningModel(rows,model),'../models/modelKmaSpecialWeatherZone':warningModel([])}});
        const r=await capture('warning-'+id,'GET /v000903/kma/special','server/routes/v000903/route.kma.v000903.js',appFor(h.router,'/v000903/kma'),{path:'/v000903/kma/special',headers:{'accept-language':'ko'}},
            {dependency_trace:{seed:'recorded provider bodies converted through real model parsers; fixed legacy store dates',announcement_actual:'2026-09-27T00:10:00.000Z',comparison:id}});
        assert.equal(r.status,200);const list=JSON.parse(r.raw);assert.equal(list.some(r=>r.type===4),include);assert(list.some(r=>r.type===2)&&list.some(r=>r.type===3));
        if(id==='week-old'){assert.equal(list.length,3);cases[cases.length-1].backend='special';coverage.add('special');}
    }
}


async function healthCases(){
    now='2026-09-24T00:10:00.000Z';const source=fs.readFileSync(path.join(server,'app.js'),'utf8');
    const match=source.match(/app\.get\('\/health', (function\s*\(req, res\)\s*\{[\s\S]*?\n\})\);/);assert(match,'Actual health source boundary');
    const handler=vm.runInNewContext('('+match[1]+')');const app=appFor(null,null);app.get('/health',handler);
    for(const method of ['GET','HEAD']){const r=await capture('health-'+method,null,'server/app.js',app,{method,path:'/health'},{baseline_scope:'supplementary operational health, outside19 product groups'});assert.equal(r.status,200);assert.equal(r.raw.toString(),method==='GET'?'OK':'');}
}

async function main(){await domesticCases();await worldCases();await gatewayCases();await nationCases();await pushCases();await warningCases();await healthCases();
    const dependencies={};for(const name of ['express','express-session','cors','body-parser','cookie-parser','i18n','async','sprintf','xml2js'])dependencies[name]=require(name+'/package.json').version;
    const record={schema:1,inventory,source:{revision:baseRevision,oracle_sha256:sha(rawRead(__filename)),dependency_lock_sha256:sha(rawRead(path.join(root,'server2/tools/golden/package-lock.json'))),files:Object.fromEntries(Object.entries(sourceFiles).sort())},runtime:{node:process.version,dependencies},
        normalization:{date:'Explicit fixed per-scenario Date header; Node HTTP cached Date does not use VM Date',session:'Fixed generated session identity and expiry clock',excluded_headers:[]},
        approved_future_differences:['D02 server2 push sends do not automatically retry failure/unknown outcomes; legacy baseline retained','D03 no legacy registration migration; not a wire baseline rewrite'],
        backend_coverage:[...coverage].sort(),network,cases};
    fs.writeFileSync(path.join(outputDir,'records.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify({recorded:cases.length,backend_coverage:record.backend_coverage,network}));
}
const wall=setTimeout(()=>{console.error('Oracle total deadline exceeded');process.exit(1);},110000);
main().then(()=>clearTimeout(wall),err=>{clearTimeout(wall);console.error(err.stack);process.exitCode=1;});
