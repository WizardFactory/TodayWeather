'use strict';
// Grids of one publication become available at different times after the KMA provision time
// (AK, 2026-10-04): polls start about two minutes after it, and grids still pending (NO_DATA,
// the previous publication or incomplete content) are walked again near +5 and +10 minutes,
// never by an immediate retry storm.
const assert=require('assert'),mh=require('./current-manager-harness'),h=require('./harness'),fx=require('./forecast-grid-fixtures'),Forecast=require('../../lib/forecastGridCollection'),policy=require('../../config/gather');
const coords=[{mx:60,my:127},{mx:61,my:127},{mx:62,my:127},{mx:63,my:127},{mx:64,my:127},{mx:65,my:127}];
const key=c=>c.mx+':'+c.my;
let passed=false;process.on('exit',()=>{if(!passed){console.error('FAIL: ended before final PASS');process.exitCode=1}});
function page(items){const r=h.response(items);r.response.body[0].totalCount=[String(items.length)];r.response.body[0].numOfRows=['999'];r.response.body[0].pageNo=['1'];return h.xml(r)}
function noData(){return h.xml({response:{header:[{resultCode:['03'],resultMsg:['NO_DATA']}],body:[{totalCount:['0']}]}})}
(async()=>{
 const fs=require('fs'),source=fs.readFileSync(require.resolve('../../controllers/controllerManager.js'),'utf8');
 assert(/if \(time === 12 \|\| putAll\) \{\s*log\.info\('push short'\)/.test(source),'short polls at :12 (provision HH:10 + 2 min)');
 assert(/if \(time === 47 \|\| time === 54 \|\| time === 4 \|\| time === 14 \|\| putAll\)/.test(source),'ultra-short first poll at :47 (HH:45 + 2 min)');
 assert.deepStrictEqual(policy.load({}).forecastRetryAtMs,[180000,480000],'re-walks near provision +5 and +10 minutes');
 assert.strictEqual(policy.load({}).forecastDeadlineMs,840000,'the run deadline leaves room for the final walk');
 assert.deepStrictEqual(policy.load({GATHER_FORECAST_RETRY_AT_MS:'none'}).forecastRetryAtMs,[]);
 assert.deepStrictEqual(policy.load({GATHER_FORECAST_DEADLINE_MS:'200000'}).forecastRetryAtMs,[180000]);
 for(const bad of ['-1','300000,180000','0','900000','x'])assert.throws(()=>policy.load({GATHER_FORECAST_RETRY_AT_MS:bad}),/Invalid GATHER_FORECAST_RETRY_AT_MS/);
 for(const product of ['short','shortest']){
    const slot={date:'20261004',time:product==='short'?'1400':'1530'},method=product==='short'?'getTownShortData':'getTownShortestData';
    const previous=product==='short'?{date:'20261004',time:'1100'}:{date:'20261004',time:'1430'};
    assert(Forecast.stale(fx.items(product,previous,coords[0]),product,slot),'previous publication is late, not invalid');
    assert(!Forecast.stale(fx.items(product,slot,coords[0]),product,slot));
    assert(!Forecast.stale(fx.items(product,{...slot,time:product==='short'?'1700':'1630'},coords[0]),product,slot),'a newer publication is not late');
    assert(!Forecast.stale(fx.items(product,previous,coords[0]).map((r,i)=>i?r:{...r,baseTime:[fx.echo(product,slot)]}),product,slot),'mixed echoes stay invalid');
    // 0 available; 1 NO_DATA then available; 2 previous publication then requested; 3 always NO_DATA;
    // 4 transport failure retried at once by the existing bounded pass; 5 missing wind then complete.
    const calls=new Map(),times=new Map(),stored=new Map();let started;
    function Provider(){return h.collector({get(url,opts,cb){
        const u=new URL(url),c=coords.find(c=>String(c.mx)===u.searchParams.get('nx')),n=(calls.get(key(c))||0)+1;
        calls.set(key(c),n);if(!times.has(key(c)))times.set(key(c),[]);times.get(key(c)).push(Date.now()-started);
        const i=coords.indexOf(c);
        setImmediate(()=>{
            if(i===4&&n===1)return cb(null,{statusCode:500},'');
            if((i===1&&n===1)||i===3)return cb(null,{statusCode:200},noData());
            let items=fx.items(product,i===2&&n===1?previous:slot,c);
            if(i===5&&n===1)items=items.filter((r,k)=>!(r.category[0]==='WSD'&&k===items.findIndex(x=>x.category[0]==='WSD')));
            cb(null,{statusCode:200},page(items));
        });return {abort(){}};
    }})}
    function manager(env){
        const f=mh.load({'../lib/collectTownForecast':Provider,'../models/town':{getCoord:cb=>cb(null,coords)},
            '../models/kma/kma.town.short.model':fx.memoryModel(()=>[...stored.values()].flat()),
            '../models/kma/kma.town.shortest.model':fx.memoryModel(()=>[...stored.values()].flat()),
            '../config/gather':policy.load(Object.assign({GATHER_TOWN_RETRY:'70',GATHER_SHORTEST_REFRESH_AFTER_MS:'0'},env))});
        f.m[product==='short'?'getShortQueryTime':'getShortestQueryTime']=()=>slot;
        f.m.getSaveFunc=()=>function(rows,cb){stored.set(key(rows[0]),fx.documents(product,'2.0',slot,rows[0],rows));cb()};
        return f;
    }
    const poll=f=>new Promise(res=>f.m[method](9,'dummy',(e,r)=>res({e,r})));
    const f=manager({GATHER_FORECAST_RETRY_AT_MS:'600,1200'});started=Date.now();
    const result=await poll(f);
    assert(result.e,product+': a grid still unpublished after the final walk stays an error');
    assert.strictEqual(result.r.pending,1);assert.strictEqual(result.r.walks,3);
    assert.deepStrictEqual([...stored.keys()].sort(),coords.filter((c,i)=>i!==3).map(key).sort());
    assert.deepStrictEqual(coords.map(c=>calls.get(key(c))),[1,2,2,3,2,2],product+': late/incomplete grids re-walked at the offsets only; transport failure retried as before');
    for(const i of [1,2,3,5])assert(times.get(key(coords[i]))[1]>=600,'second walk waits for the first offset');
    assert(times.get(key(coords[3]))[2]>=1200,'final walk waits for the second offset');
    // Ordering, not wall-clock bounds, so slow CI runners cannot flip it.
    assert(times.get(key(coords[4]))[1]<Math.min(...[1,2,3,5].map(i=>times.get(key(coords[i]))[1])),'transport retry is not delayed');
    const records=f.records.map(r=>JSON.parse(r));
    assert.deepStrictEqual(records.filter(r=>r.event==='forecast-retry').map(r=>[r.walk,r.pending]),[[2,4],[3,1]],'sanitized re-walk records');
    const pass=records.find(r=>r.event==='forecast-pass');assert.strictEqual(pass.notPublished,2);assert.strictEqual(pass.previousPublication,1);
    assert.strictEqual(result.r.httpAttempts,12,'every page request, delayed walks included');
    assert(!f.records.join('').includes('SYNTHETIC_CURRENT_KEY'));
    // A later scheduled poll of the same publication walks the pending grid once: the publication ends near +10 min.
    const later=await poll(f);
    assert.strictEqual(later.r.walks,1);assert.strictEqual(later.r.pending,1);assert.strictEqual(calls.get(key(coords[3])),4);
    assert.strictEqual(f.records.map(r=>JSON.parse(r)).filter(r=>r.event==='forecast-retry').length,2,'no further delayed re-walks');
    // Without re-walks, late grids stay pending for the next scheduled poll, which requests only them.
    calls.clear();times.clear();stored.clear();
    const off=manager({GATHER_FORECAST_RETRY_AT_MS:'none'});started=Date.now();
    const disabled=await poll(off);
    assert(disabled.e);assert.strictEqual(disabled.r.pending,4);assert.deepStrictEqual(coords.map(c=>calls.get(key(c))),[1,1,1,1,2,1]);
    const next=await poll(off);
    assert.strictEqual(next.r.pending,1);assert.deepStrictEqual(coords.map(c=>calls.get(key(c))),[1,2,2,2,2,2]);
    // Every key rejected: no delayed re-walk repeats the rejection.
    let rejected=0;
    function Quota(){return h.collector({get(url,opts,cb){rejected++;setImmediate(()=>cb(null,{statusCode:200},'<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>'));return {abort(){}}}})}
    const q=mh.load({'../lib/collectTownForecast':Quota,'../models/town':{getCoord:cb=>cb(null,coords)},
        '../models/kma/kma.town.short.model':fx.memoryModel(()=>[]),'../models/kma/kma.town.shortest.model':fx.memoryModel(()=>[]),
        '../config/gather':policy.load({GATHER_REQUEST_CONCURRENCY:'1',GATHER_FORECAST_RETRY_AT_MS:'50,100'})});
    q.m[product==='short'?'getShortQueryTime':'getShortestQueryTime']=()=>slot;
    const quota=await poll(q);assert(quota.e);assert.strictEqual(quota.r.walks,1);assert.strictEqual(rejected,2,'one attempt per rejected key');
    console.log('PASS late publication '+product+': staggered grids re-walked at +5/+10-minute offsets, no immediate retry storm');
 }
 // AK review 5406464242 #2: a refresh write that fails for an already complete grid is re-walked, and the run
 // succeeds (consuming the refresh) only once every grid was written.
 for(const keepFailing of [false,true]){
    const Forecast=require('../../lib/forecastGridCollection'),slot={date:'20261004',time:'1530'},A=coords[0],B=coords[1];
    const base=fx.publication(slot)-9*fx.hour;let docs=fx.documents('shortest','2.0',slot,A,fx.rows('shortest',slot,A)),walks=[];
    const c=new Forecast({product:'shortest',version:'2.0',model:fx.memoryModel(()=>docs),coords:cb=>cb(null,[A,B]),emit:()=>{},
        retryAtMs:[15,30],refreshAfterMs:60000,now:()=>base+2*60000,readTimeoutMs:200,collectTimeoutMs:2000,
        collect:(list,s,k,cb,control)=>{walks.push(list.map(key).sort());control.written=control.written||new Set();
            if(walks.length===1)return cb(new Error('write failed for A; B not published'));
            if(!keepFailing)control.written.add(key(A));
            docs=docs.concat(fx.documents('shortest','2.0',slot,B,fx.rows('shortest',slot,B)));control.written.add(key(B));
            cb(keepFailing?new Error('write failed for A'):null)}});
    const r=await new Promise(res=>c.run(slot,'dummy',(e,r)=>res({e,r})));
    assert.deepStrictEqual(walks[1],[key(A),key(B)],'the failed refresh grid is kept for the next walk');
    if(keepFailing){assert(r.e,'an unwritten refresh grid keeps the run incomplete');assert.strictEqual(r.r.pending,0);assert.strictEqual(r.r.unwritten,1);
        assert.notStrictEqual(c.refreshed,'202610041530','refresh not consumed');}
    else{assert(!r.e,r.e&&r.e.message);assert.strictEqual(r.r.walks,2);assert.strictEqual(c.refreshed,'202610041530')}
 }
 // Review R1-02: the first run of a publication consumes the delayed re-walks however it ends.
 {
    const Forecast=require('../../lib/forecastGridCollection'),slot={date:'20261004',time:'1400'},one=[coords[0]];
    const make=(collect,model)=>new Forecast({product:'short',version:'2.0',model:model||fx.memoryModel(()=>[]),coords:cb=>cb(null,one),
        emit:()=>{},retryAtMs:[15,30],readTimeoutMs:200,collectTimeoutMs:1000,collect});
    const go=c=>new Promise(res=>c.run(slot,'dummy',(e,r)=>res({e,r})));
    const branches={
        exhausted:(n,cb,control)=>{if(n===1)control.keysExhausted=true;cb(new Error('keys'))},
        complete:(n,cb)=>cb(),
        failing:(n,cb)=>cb(new Error('provider'))};
    for(const [name,first] of Object.entries(branches)){
        // 'complete' persists the grid on its first walk; the slot is then damaged before the later run.
        let n=0,docs=[];const c=make((list,s,k,cb,control)=>{n++;
            if(name==='complete'&&n===1)docs=fx.documents('short','2.0',slot,one[0],fx.rows('short',slot,one[0]));first(n,cb,control)},fx.memoryModel(()=>docs));
        const a=await go(c);assert.strictEqual(a.r.walks,name==='failing'?3:1,name+': first run');
        if(name==='complete'){assert.strictEqual(a.r.pending,0);docs[0]={...docs[0],shortData:{...docs[0].shortData,wsd:-1}}}
        const b=await go(c);assert.strictEqual(b.r.walks,1,name+': a later run of the publication walks once');
    }
    // A first run that fails its coverage read or expires also consumes the re-walks.
    let reads=0,calls=0;const flaky={aggregate(){return {option(){return this},exec(cb){if(reads++===0)return cb(new Error('read'));cb(null,[])}}}};
    const r=make((list,s,k,cb)=>{calls++;cb()},flaky);
    assert((await go(r)).e,'read failure');assert.strictEqual((await go(r)).r.walks,1,'after a read failure');
    const stalled=make((list,s,k,cb)=>{calls++;if(calls===2)return;cb()});stalled.options.collectTimeoutMs=10;
    assert((await go(stalled)).e,'deadline');stalled.options.collectTimeoutMs=1000;assert.strictEqual((await go(stalled)).r.walks,1,'after a deadline');
 }
 passed=true;
})().catch(e=>{console.error(e);process.exitCode=1});
