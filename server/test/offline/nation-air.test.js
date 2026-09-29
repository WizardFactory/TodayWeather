'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {createLoader,logger}=require('./air-harness');
const {harness: freshness}=require('./air-freshness-harness');
const now=new Date('2026-09-29T14:30:00Z');
const fresh=(sidoName='서울')=>({sidoName,cityName:'',dataTime:'2026-09-29 23:00',pm10Value:30,pm25Value:15});
function setup(read, fetch) {
    const keco=freshness(now.toISOString()).keco, calls=[];
    keco.getSidoArpltn=read;
    const loader=createLoader({log:logger([]),overrides:{
        'controllers/kecoController.js':keco,
        'lib/AQI/airFallback.js':{getArpltn(coord,time,cb){calls.push(coord);fetch(coord,time,cb);}}
    }});
    return {service:loader.load('lib/air/nationAir.js'),calls,keco};
}
function run(service,deadlineMs=200) {
    return new Promise((resolve,reject)=>service.getAir((err,air,status)=>err?reject(err):resolve({air,status}),{now,deadlineMs}));
}
test('fresh AirKorea for 17 provinces wins without provider calls; requested grades preserved',async()=>{
    let names;
    const h=setup(cb=>cb(null,names.map(fresh)),()=>assert.fail('no fallback'));
    names=h.service.regions.map(r=>r[0]);const result=await run(h.service);
    assert.equal(result.air.length,17);assert.equal(h.calls.length,0);
    assert(result.air.every(a=>a.source==='airkorea'&&a.coverage==='province-average'));
    h.keco.recalculateValue(result.air[0],'airkorea'); assert.equal(result.air[0].pm10Grade,1);assert.equal(result.air[0].pm25Grade,1);
});
test('missing/stale/DB-failed provinces use shared flow, retain fresh rows, source and point provenance',async()=>{
    const h=setup(cb=>cb(null,[fresh(),{...fresh('부산'),dataTime:'2026-09-29 02:00'}],
        [{sidoName:'대구',reason:'database-error'}]),(coord,time,cb)=>cb(null,{...fresh(),source:'aqicn',attribution:'Synthetic attribution'},null));
    const r=await run(h.service);assert.equal(r.air.length,17);assert.equal(h.calls.length,16);
    const busan=r.air.find(a=>a.sidoName==='부산');assert.equal(busan.source,'aqicn');
    assert.equal(busan.attribution,'Synthetic attribution');assert.equal(busan.coverage,'representative-point');
    assert.equal(busan.representativeCity,'Busan');assert.equal(busan.cityName,'');
    assert.equal(r.status.provinces.find(a=>a.sidoName==='대구').airkorea,'database-error');
    assert.equal(r.status.provinces.find(a=>a.sidoName==='부산').airkorea,'stale');
    assert.equal(r.status.provinces.find(a=>a.sidoName==='제주').airkorea,'missing');
    h.keco.recalculateValue(busan,'airkorea');assert.equal(busan.pm25Grade,1);
});
test('parallel fanout is bounded at four and completes all regions when time allows',async()=>{
    let active=0,max=0;
    const h=setup(cb=>cb(null,[]),(coord,time,cb)=>{active++;max=Math.max(max,active);setTimeout(()=>{active--;cb(null,{...fresh(),source:'google'});},5);});
    const r=await run(h.service);assert.equal(max,4);assert.equal(r.air.length,17);
});
test('one overall deadline stops new calls; late callbacks cannot mutate completed air/status',async()=>{
    const waiting=[];const h=setup(cb=>cb(null,[fresh()]),(coord,time,cb)=>waiting.push(cb));
    const r=await run(h.service,15);assert.equal(h.calls.length,4);assert.equal(r.air.length,1);
    const before=JSON.stringify(r);waiting.forEach(cb=>cb(null,{...fresh(),source:'google'}));
    assert.equal(JSON.stringify(r),before);assert.equal(h.calls.length,4);
    assert.equal(r.status.provinces.filter(a=>a.reason==='deadline').length,16);
});
test('DB timeout terminates; DB error and provider failures preserve response with explicit per-province status',async()=>{
    let read;
    const hanging=setup(cb=>{read=cb;},()=>assert.fail('no call before read'));
    const r=await run(hanging.service,10);assert.equal(r.air.length,0);assert.equal(r.status.provinces.length,17);
    read(null,[fresh()]);assert.equal(r.air.length,0);
    const failed=setup(cb=>cb(new Error('private DB URL')),(coord,time,cb)=>cb(new Error('private token')));
    const f=await run(failed.service);assert.equal(f.air.length,0);
    assert(f.status.provinces.every(s=>s.airkorea==='database-error'&&s.reason==='fallback-unavailable'));
    assert(!JSON.stringify(f).includes('private'));
});
test('future and invalid/empty PM rows trigger fallback, never fabricated zero',async()=>{
    const h=setup(cb=>cb(null,[{...fresh(),dataTime:'2026-10-01 23:00'}, {...fresh('부산'),pm10Value:-1,pm25Value:NaN}]),
        (coord,time,cb)=>cb(null,undefined,'no-provider'));
    const r=await run(h.service);assert.equal(r.air.length,0);assert.equal(h.calls.length,17);
});
test('eight-hour boundary, excessive future and partial pollutant values do not become fabricated data',async()=>{
    const h=setup(cb=>cb(null,[{...fresh(),dataTime:'2026-09-29 15:30'},
        {...fresh('부산'),pm10Value:undefined,pm25Value:0}]),(coord,time,cb)=>cb(null,undefined,'no-provider'));
    const r=await run(h.service);assert.equal(h.calls.length,16);assert.equal(r.air.length,1);
    assert.equal(r.air[0].sidoName,'부산');assert.equal(r.air[0].pm25Value,0);assert.equal(r.air[0].pm10Value,undefined);
});
test('provider throw or duplicate callback cannot lose other provinces or complete twice',async()=>{
    let n=0,completed=0;
    const h=setup(cb=>cb(null,[]),(coord,time,cb)=>{
        n++;if(n===1)throw new Error('secret');
        cb(null,{...fresh(),source:'google'});cb(null,{...fresh(),source:'aqicn'});
    });
    const r=await new Promise(resolve=>h.service.getAir((err,air,status)=>{completed++;resolve({air,status});},{now,deadlineMs:200}));
    assert.equal(completed,1);assert.equal(r.air.length,16);assert(r.air.every(a=>a.source==='google'));
});
test('storage read throws: shared provider flow still supplies partial safe results',async()=>{
    let calls=0;const h=setup(()=>{throw new Error('private-db-uri');},(coord,time,cb)=>{
        calls++;cb(null,calls===2?{...fresh(),source:'google'}:undefined,'no-provider');
    });
    const r=await run(h.service);assert.equal(r.air.length,1);assert.equal(h.calls.length,17);
    assert(r.status.provinces.every(s=>s.airkorea==='database-error'));
});
test('completed provider response is copied before unit conversion; cached object is unchanged',async()=>{
    const air={...fresh(),source:'google',attribution:'Google Air Quality'}, before=JSON.stringify(air);
    const h=setup(cb=>cb(null,[]),(coord,time,cb)=>cb(null,air));const r=await run(h.service);
    r.air.forEach(row=>h.keco.recalculateValue(row,'aqicn'));
    assert.equal(JSON.stringify(air),before);assert.equal(r.air.length,17);
});
test('global observations at exactly eight hours retain the shared domestic-flow acceptance policy',async()=>{
    const h=setup(cb=>cb(null,[]),(coord,time,cb)=>cb(null,{...fresh(),source:'google',dataTime:'2026-09-29 15:30'}));
    const r=await run(h.service);assert.equal(r.air.length,17);
    assert(r.air.every(a=>a.source==='google'));
});

test('stored AirKorea failure reasons distinguish stale, future and invalid data',async()=>{
    const h=setup(cb=>cb(null,[{...fresh(),dataTime:'2026-09-29 15:30'},
        {...fresh('부산'),dataTime:'2026-10-01 23:00'},
        {...fresh('대구'),pm10Value:-1,pm25Value:NaN},
        {...fresh('인천'),dataTime:'invalid'}]),(coord,time,cb)=>cb(null,undefined,'no-provider'));
    const r=await run(h.service);
    const reasons=r.status.provinces.slice(0,4).map(s=>s.airkorea);
    assert.deepEqual(Array.from(reasons),['stale','future','invalid','invalid']);
});
test('nation preserves actual shared evaluation at eight hours and minute-truncation boundary',async()=>{
    const observation=createLoader({log:logger([])}).load('lib/air/observation.js');
    for (const observedAt of ['2026-09-29T06:30:00Z','2026-09-29T06:30:30Z']) {
        const obs={provider:'google',observedAt,stationBased:false,pollutants:{pm10:42,pm25:19}};
        const h=setup(cb=>cb(null,[]),(coord,time,cb)=>{
            const evaluated=observation.evaluate(obs,coord,time);
            assert(evaluated.arpltn);cb(null,evaluated.arpltn,evaluated.reason);
        });
        const r=await run(h.service);assert.equal(r.air.length,17);
    }
});
