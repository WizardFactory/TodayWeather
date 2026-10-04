'use strict';
const assert=require('assert'),mh=require('./current-manager-harness'),fixture=require('./forecast-grid-fixtures');
const grids=Array.from({length:2033},(_,i)=>({mx:i%149,my:Math.floor(i/149)}));
function run(m,method){return new Promise((resolve,reject)=>m[method](9,'dummy',(e,r)=>e?reject(e):resolve(r)))}
// A test that stops before its final PASS (e.g. a swallowed assertion) must fail, not exit 0.
let passed=false;process.on('exit',()=>{if(!passed){console.error('FAIL: ended before final PASS');process.exitCode=1}});
(async()=>{
 for(const version of ['1.0','2.0'])for(const product of ['short','shortest']){
    let slot={date:'20261003',time:product==='short'?'0500':'0530'},stored=new Map(),attempts=0,walks=[];
    const model=fixture.memoryModel(()=>Array.from(stored.values()).flat());
    const overrides={'../models/town':{getCoord:cb=>cb(null,grids)},'../models/modelShort':model,'../models/modelShortest':model,
        '../models/kma/kma.town.short.model':model,'../models/kma/kma.town.shortest.model':model};
    // New coordinator uses the real module when present, never an implementation mock.
    try{overrides['../lib/forecastGridCollection']=require('../../lib/forecastGridCollection')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e}
    function manager(){const f=mh.load(overrides);f.config.db.version=version;
        f.m[product==='short'?'getShortQueryTime':'getShortestQueryTime']=()=>slot;
        f.m._recursiveRequestData=(list,type,key,s,retries,invalid,cb,cycle)=>{
            attempts+=list.length;walks.push(list);if(cycle&&cycle.control)cycle.control.httpAttempts+=list.length;
            for(const c of list){stored.set(c.mx+':'+c.my,fixture.documents(product,version,s,c,fixture.rows(product,s,c)))}
            cb();
        };return f.m;
    }
    const method=product==='short'?'getTownShortData':'getTownShortestData',m=manager();
    await run(m,method);assert.strictEqual(attempts,2033);
    await run(m,method);assert.strictEqual(attempts,2033,product+' completed publication must skip every grid');
    await run(manager(),method);assert.strictEqual(attempts,2033,'restart reads persisted completion');
    const field=product+'Data';
    if(version==='1.0')delete stored.values().next().value[0][field][0].reh;else delete stored.values().next().value[0][field].reh;
    await run(m,method);assert.strictEqual(attempts,2034,'only one incomplete grid repairs');
    slot={date:'20261003',time:product==='short'?'0800':'0630'};
    await run(m,method);assert.strictEqual(attempts,4067,'new publication collects all expected grids');
    assert.strictEqual(walks.at(-1).length,2033);
    const options=m._forecastCollections[product].options;
    assert.strictEqual(options.refreshAfterMs,product==='short'?0:2400000,'only ultra-short refreshes once per publication');
    assert.strictEqual(options.readTimeoutMs,10000);
    console.log('PASS Manager '+product+' DB'+version+': full-grid / repeat / recreation / repair / rollover');
 }
 passed=true;
})().catch(e=>{console.error(e);process.exitCode=1});
