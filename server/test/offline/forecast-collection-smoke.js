'use strict';
// Real production Node/Mongoose, real loopback request/XML and temporary Mongo4.4.
// Run with TW_MONGOD pointing to a compatible local binary. Never loads app/config.
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),http=require('http'),net=require('net'),cp=require('child_process');
const mongoose=require('mongoose'),request=require('request'),h=require('./harness'),mh=require('./current-manager-harness'),fx=require('./forecast-grid-fixtures'),Forecast=require('../../lib/forecastGridCollection');
const grids=Array.from({length:2033},(_,i)=>({mx:i%149,my:Math.floor(i/149)}));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let dbProcess,connection,provider,scratch,logFd,requests=0,pages=0,retries=0,retried=false,currentProduct,slot,late,staleTemplates;
const summaries=[];
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p}
function writeXML(product,s){
 const categories={t3h:'TMP',r06:'PCP',s06:'SNO',t1h:'T1H',rn1:'RN1',sky:'SKY',reh:'REH',pty:'PTY',pop:'POP',uuu:'UUU',vvv:'VVV',vec:'VEC',wsd:'WSD',tmn:'TMN',tmx:'TMX',lgt:'LGT'};
 const items=[];
 for(const row of fx.rows(product,s,{mx:60,my:127})){
    // The provider answers an ultra-short HH30 request with baseTime HH00 (production, 2026-10-04).
    for(const name of Object.keys(categories))if(row[name]!==undefined){items.push({baseDate:[s.date],baseTime:[fx.echo(product,s)],fcstDate:[row.date],fcstTime:[row.time],nx:['NX_TOKEN'],ny:['NY_TOKEN'],category:[categories[name]],fcstValue:[String(row[name])]})}
    if(product==='short')items.push({baseDate:[s.date],baseTime:[fx.echo(product,s)],fcstDate:[row.date],fcstTime:[row.time],nx:['NX_TOKEN'],ny:['NY_TOKEN'],category:['WAV'],fcstValue:['0']});
 }
 const out=[];
 for(let i=0;i<items.length;i+=999){const r=h.response(items.slice(i,i+999));r.response.body[0].totalCount=[String(items.length)];r.response.body[0].pageNo=[String(out.length+1)];r.response.body[0].numOfRows=['999'];out.push(h.xml(r))}
 return out;
}
function gather(m,product){return new Promise((res,rej)=>m[product==='short'?'getTownShortData':'getTownShortestData'](9,'dummy',(e,r)=>e?rej(e):res(r)))}
(async()=>{
 assert.strictEqual(process.versions.node,'16.20.2','acceptance smoke uses production Node16.20.2');
 assert.strictEqual(mongoose.version,'5.1.2','do not substitute a newer Mongoose driver');
 const binary=process.env.TW_MONGOD;assert(binary,'TW_MONGOD must identify a local Mongo4.4 binary');
 assert.match(cp.execFileSync(binary,['--version'],{encoding:'utf8'}),/v4\.4\./,'Mongo4.4 supports pinned legacy driver');
 scratch=fs.mkdtempSync(path.join(os.tmpdir(),'tw-2676-mongo-'));const port=await freePort();logFd=fs.openSync(path.join(scratch,'mongo.log'),'w');
 dbProcess=cp.spawn(binary,['--dbpath',scratch,'--port',String(port),'--bind_ip','127.0.0.1','--storageEngine','wiredTiger','--quiet'],{stdio:['ignore',logFd,logFd]});
 for(let i=0;i<200;i++){
    if(dbProcess.exitCode!==null)throw new Error('Temporary Mongo exited: '+dbProcess.exitCode);
    const ready=await new Promise(r=>{const s=net.connect(port,'127.0.0.1');s.once('connect',()=>{s.destroy();r(true)});s.once('error',()=>r(false))});
    if(ready)break;if(i===199)throw new Error('Temporary Mongo startup deadline');await wait(50);
 }
 connection=mongoose.createConnection('mongodb://127.0.0.1:'+port+'/forecast2676',{autoIndex:false});
 await new Promise((res,rej)=>{connection.once('open',res);connection.once('error',rej)});
 const modelApi={Schema:mongoose.Schema,model:connection.model.bind(connection)},models={};
 for(const product of ['short','shortest']){
    models[product+'1']=h.load('models/model'+product[0].toUpperCase()+product.slice(1)+'.js',{mongoose:modelApi});
    models[product+'2']=h.load('models/kma/kma.town.'+product+'.model.js',{mongoose:modelApi});
 }
 // Production model indexes are part of the real writer path: build them on the
 // empty temporary DB instead of timing unindexed growing-collection upserts.
 for(const model of Object.values(models))await new Promise((res,rej)=>model.ensureIndexes(e=>e?rej(e):res()));
 let templates;
 provider=http.createServer((req,res)=>{
    const u=new URL(req.url,'http://127.0.0.1');
    assert(u.pathname.endsWith(currentProduct==='short'?'/getVilageFcst':'/getUltraSrtFcst'));
    assert.strictEqual(u.searchParams.get('base_date'),slot.date);assert.strictEqual(u.searchParams.get('base_time'),slot.time);
    requests++;const page=Number(u.searchParams.get('pageNo')||1);if(page>1)pages++;
    // One transient failed continuation/page per product/version; existing bounded retry repairs it.
    // Grids publish at different times: grid 1 first answers NO_DATA, grid 2 the previous publication;
    // both are collected by the delayed re-walk, not by immediate retries (AK, 2026-10-04).
    const at=grids.findIndex(g=>String(g.mx)===u.searchParams.get('nx')&&String(g.my)===u.searchParams.get('ny'));
    if((at===1||at===2)&&!late.has(at)){
        late.add(at);res.writeHead(200,{'Content-Type':'text/xml'});
        if(at===1)return res.end(h.xml({response:{header:[{resultCode:['03'],resultMsg:['NO_DATA']}],body:[{totalCount:['0']}]}}));
        return res.end(staleTemplates[0].replace(/NX_TOKEN/g,u.searchParams.get('nx')).replace(/NY_TOKEN/g,u.searchParams.get('ny')));
    }
    if(!retried&&u.searchParams.get('nx')===String(grids[0].mx)&&u.searchParams.get('ny')===String(grids[0].my)&&page===(templates.length>1?2:1)){
        retried=true;retries++;res.writeHead(503);return res.end('synthetic transient failure');
    }
    res.writeHead(200,{'Content-Type':'text/xml'});
    res.end(templates[page-1].replace(/NX_TOKEN/g,u.searchParams.get('nx')).replace(/NY_TOKEN/g,u.searchParams.get('ny')));
 });
 await new Promise(r=>provider.listen(0,'127.0.0.1',r));
 function Collector(){return h.collector({get(url,opts,cb){const u=new URL(url);assert.strictEqual(u.host,'apis.data.go.kr');return request.get('http://127.0.0.1:'+provider.address().port+u.pathname+u.search,{...opts,proxy:null},cb)}},[])}
 for(const version of ['1.0','2.0'])for(const product of ['short','shortest']){
    currentProduct=product;slot={date:'20261003',time:product==='short'?'1700':'1730'};retried=false;templates=writeXML(product,slot);late=new Set();
    staleTemplates=writeXML(product,{date:slot.date,time:product==='short'?'1400':'1630'});
    const model=models[product+(version==='1.0'?'1':'2')],log=h.logger([]);
    const Controller=h.load('controllers/kma/kma.town.'+product+'.controller.js',{
        async:require('async'),['../../models/kma/kma.town.'+product+'.model.js']:models[product+'2'],
        '../../lib/kmaTimeLib':require('../../lib/kmaTimeLib'),'../../lib/kmaPrecipitation':require('../../lib/kmaPrecipitation'),
        '../../lib/midForecastPolicy':require('../../lib/midForecastPolicy')},{log});
    const overrides={'../lib/collectTownForecast':Collector,'../models/town':{getCoord:cb=>cb(null,grids)},
        '../models/modelShort':models.short1,'../models/modelShortest':models.shortest1,
        '../models/kma/kma.town.short.model':models.short2,'../models/kma/kma.town.shortest.model':models.shortest2,
        ['./kma/kma.town.'+product+'.controller.js']:Controller,'../lib/midForecastPolicy':require('../../lib/midForecastPolicy'),
        '../config/gather':require('../../config/gather').load({GATHER_TOWN_RETRY:'2',GATHER_REQUEST_CONCURRENCY:'16',GATHER_FORECAST_RETRY_AT_MS:'500,1000',GATHER_SHORTEST_REFRESH_AFTER_MS:'0'})};
    function manager(){const f=mh.load(overrides);f.config.db.version=version;f.m.MAX_SHORT_COUNT=192;f.m.MAX_SHORTEST_COUNT=192;
        f.m[product==='short'?'getShortQueryTime':'getShortestQueryTime']=()=>slot;return f}
    const f=manager(),start=requests,pageStart=pages,retryStart=retries;
    const results=await Promise.all([gather(f.m,product),gather(f.m,product)]);
    // NO_DATA answers one page; the previous publication's first page fails strict validation.
    assert.strictEqual(requests-start,2033*templates.length+templates.length-2*(templates.length-1)+2*templates.length,'full grid, one transient retry, two late grids re-walked once');
    assert.strictEqual(results[0].walks,2,'late grids are collected by the first delayed re-walk');
    assert.strictEqual(results[0].pending,0);assert.strictEqual(results[0].httpAttempts,requests-start);
    const read=()=>new Promise((res,rej)=>Forecast.pending(model,version,product,slot,grids,(e,p)=>e?rej(e):res(p)));
    assert.strictEqual((await read()).length,0,'full persisted horizon/categories for every grid');
    const completeCalls=requests;await gather(f.m,product);await gather(manager().m,product);assert.strictEqual(requests,completeCalls,'repeat and recreated Manager send zero HTTP');
    const field=product+'Data',query={'mCoord.mx':grids[0].mx,'mCoord.my':grids[0].my};
    if(version==='1.0')await model.collection.updateOne(query,{$unset:{[field+'.0.reh']:''}});
    else {query[field+'.time']=fx.rows(product,slot,grids[0])[0].time;await model.collection.updateOne(query,{$unset:{[field+'.reh']:''}})}
    assert.strictEqual((await read()).length,1);const repairStart=requests;await gather(f.m,product);assert.strictEqual(requests-repairStart,templates.length);assert.strictEqual((await read()).length,0);
    // An older publication written after completion keeps the newer slots on real Mongoose (#2678 review).
    const older={...slot,time:product==='short'?'1400':'1630'},staleControl={product,slot:older,cancelled:false};
    const staleRows=fx.rows(product,older,grids[0]),save=product==='short'?'saveShort':'saveShortest';
    if(version==='1.0')assert(await new Promise(r=>f.m[save](staleRows,r,staleControl)),'DB1 refuses to downgrade');
    else await new Promise((res,rej)=>new Controller()[save](staleRows,e=>e?rej(e):res(),staleControl));
    assert.strictEqual((await read()).length,0,'older publication cannot replace completed slots');
    if(version==='2.0'){
        const slots=(await model.find({'mCoord.mx':grids[0].mx,'mCoord.my':grids[0].my}).lean().exec()).map(d=>Number(d.fcsDate));
        assert.strictEqual(new Set(slots).size,slots.length,'fenced misses insert no duplicate slot documents');
    }
    const stored=await model.findOne({'mCoord.mx':grids[0].mx,'mCoord.my':grids[0].my}).lean().exec();
    // Rows are stored under the provider's echoed publication (ultra-short HH30 request -> HH00).
    const echoed=version==='1.0'?slot.date+fx.echo(product,slot):new Date(fx.publication({date:slot.date,time:fx.echo(product,slot)})-9*fx.hour);
    assert.strictEqual(await model.count({'mCoord.mx':grids[0].mx,'mCoord.my':grids[0].my,pubDate:echoed}).exec(),version==='1.0'?1:fx.rows(product,slot,grids[0]).length,'stored publication is the provider echo');
    const reads=f.records.join('\n').split('\n').filter(l=>l.includes('"forecast-coverage"')).map(l=>JSON.parse(l.slice(l.indexOf('{')))).filter(r=>typeof r.readMs==='number');
    assert(reads.length&&reads.every(r=>r.outcome!=='read-failed'));
    const row=version==='1.0'?stored[field][0]:stored[field];assert.strictEqual(row[product==='short'?'t3h':'t1h'],-12.5);assert.strictEqual(row.uuu,-2);assert.strictEqual(row.pty,0);
    assert(!f.records.join('').includes('SYNTHETIC_CURRENT_KEY'));assert(!f.records.join('').includes('serviceKey'));
    summaries.push({version,product,grids:2033,slots:fx.rows(product,slot,grids[0]).length,httpAttempts:requests-start,continuationAttempts:pages-pageStart,transientFailures:retries-retryStart,repeatAttempts:0,repairAttempts:templates.length,readbackPending:0,lateGrids:2,walks:results[0].walks,maxCoverageReadMs:Math.max(...reads.map(r=>r.readMs))});
    console.log(JSON.stringify({event:'smoke-product',...summaries[summaries.length-1]}));
 }
 console.log(JSON.stringify({result:'passed',node:process.versions.node,mongoose:mongoose.version,mongo:'4.4',provider:'synthetic loopback',summaries}));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{
 if(provider)await new Promise(r=>provider.close(r));if(connection)await connection.close();
 if(dbProcess&&dbProcess.exitCode===null){dbProcess.kill('SIGTERM');await new Promise(r=>dbProcess.once('exit',r))}
 if(logFd!==undefined)fs.closeSync(logFd);if(scratch)fs.rmSync(scratch,{recursive:true,force:true});
});
