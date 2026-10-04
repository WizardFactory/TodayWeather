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
    const f=manager({GATHER_FORECAST_RETRY_AT_MS:'150,300'});started=Date.now();
    const result=await poll(f);
    assert(result.e,product+': a grid still unpublished after the final walk stays an error');
    assert.strictEqual(result.r.pending,1);assert.strictEqual(result.r.walks,3);
    assert.deepStrictEqual([...stored.keys()].sort(),coords.filter((c,i)=>i!==3).map(key).sort());
    assert.deepStrictEqual(coords.map(c=>calls.get(key(c))),[1,2,2,3,2,2],product+': late/incomplete grids re-walked at the offsets only; transport failure retried as before');
    for(const i of [1,2,3,5])assert(times.get(key(coords[i]))[1]>=150,'second walk waits for the first offset');
    assert(times.get(key(coords[3]))[2]>=300,'final walk waits for the second offset');
    assert(times.get(key(coords[4]))[1]<150,'transport retry is not delayed');
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
 passed=true;
})().catch(e=>{console.error(e);process.exitCode=1});
