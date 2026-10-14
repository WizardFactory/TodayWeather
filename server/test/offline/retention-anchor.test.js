'use strict';
// Current/short/shortest retention must follow the publication being collected, not the wall clock.
// The fixed-slot collection smokes broke once the real date passed slot + 9 days (2026-10-12):
// remove(new Date()) deleted the rows the smoke had just written.
const assert=require('assert'),mh=require('./current-manager-harness'),fixture=require('./forecast-grid-fixtures');
const grids=[{mx:60,my:127}];
// A slot years in the past: a wall-clock cutoff would be years later than the slot.
const slots={current:{date:'20200105',time:'1300'},short:{date:'20200105',time:'1100'},shortest:{date:'20200105',time:'1130'}};
const expected={current:'2020-01-05T04:00:00.000Z',short:'2020-01-05T02:00:00.000Z',shortest:'2020-01-05T02:30:00.000Z'};
let passed=false;process.on('exit',()=>{if(!passed){console.error('FAIL: ended before final PASS');process.exitCode=1}});
function run(m,method){return new Promise((resolve,reject)=>m[method](9,'dummy',(e,r)=>e?reject(e):resolve(r)))}
(async()=>{
    const removed={};
    function Town(product){return function(){this.remove=date=>{removed[product]=date}}}
    const model=fixture.memoryModel(()=>[]);
    const overrides={'../models/town':{getCoord:cb=>cb(null,grids)},
        './kma/kma.town.current.controller.js':Town('current'),'./kma/kma.town.short.controller.js':Town('short'),
        './kma/kma.town.shortest.controller.js':Town('shortest'),
        '../models/modelShort':model,'../models/modelShortest':model,'../models/modelCurrent':model,
        '../models/kma/kma.town.short.model':model,'../models/kma/kma.town.shortest.model':model,
        '../models/kma/kma.town.current.model':{find(){return {setOptions(){return this},lean(){return this},exec(cb){cb(null,[])}}}}};
    for(const [product,method,query] of [['current','getTownCurrentData','getCurrentQueryTime'],
        ['short','getTownShortData','getShortQueryTime'],['shortest','getTownShortestData','getShortestQueryTime']]) {
        const f=mh.load(overrides);
        f.m[query]=()=>slots[product];
        f.m._recursiveRequestData=(list,type,key,s,retries,invalid,cb)=>cb();
        f.m.getSaveFunc=()=>function(list,cb){cb()};
        await run(f.m,method).catch(()=>{});
        assert(removed[product] instanceof Date||Object.prototype.toString.call(removed[product])==='[object Date]',product+' retention ran');
        assert.strictEqual(removed[product].toISOString(),expected[product],product+' retention anchors to the collected publication');
    }
    passed=true;
    console.log('PASS retention: current/short/shortest cleanup anchored to the collected publication, not the wall clock');
})().catch(e=>{console.error(e);process.exitCode=1});
