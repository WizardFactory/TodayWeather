'use strict';
const assert = require('node:assert/strict');
const ReadCache = require('../../lib/history/readCache');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function read(cache,key,loader) {return new Promise(resolve=>cache.read(key,loader,(error,value)=>resolve({error,value})));}
(async()=>{
    let calls=0, finish;
    const cache=new ReadCache({wait:20,readTimeout:100,ttl:100,failureTTL:30,max:2});
    const loader=done=>{calls++;finish=done;};
    const started=Date.now();
    const results=await Promise.all([read(cache,'a',loader),read(cache,'a',loader)]);
    assert(results.every(r=>r.error.message==='HISTORY_CACHE_WAIT'));
    assert(Date.now()-started<200);assert.equal(calls,1);
    finish(null,[{t1h:22}]);
    const warm=await read(cache,'a',loader);assert.equal(warm.value[0].t1h,22);assert.equal(calls,1);
    let errors=0;
    const bad=done=>{errors++;done(new Error('offline'));};
    assert((await read(cache,'bad',bad)).error);
    assert((await read(cache,'bad',bad)).error);assert.equal(errors,1);
    await sleep(35);await read(cache,'bad',bad);assert.equal(errors,2);
    const hung=new ReadCache({wait:10,readTimeout:20,failureTTL:40});let attempts=0;
    const never=()=>{attempts++;};
    await read(hung,'key',never);await sleep(15);
    assert.equal((await read(hung,'key',never)).error.message,'HISTORY_READ_TIMEOUT');assert.equal(attempts,1);
    const bounded=new ReadCache({wait:10,max:1,readTimeout:25});
    const pending=read(bounded,'one',()=>{});
    assert.equal((await read(bounded,'two',()=>{})).error.message,'HISTORY_CACHE_BUSY');await pending;
    console.log(JSON.stringify({passed:5,checks:['coalesced wait','late warm','negative cache','read timeout','bounded capacity']}));
})().catch(error=>{console.error(error);process.exitCode=1;});
