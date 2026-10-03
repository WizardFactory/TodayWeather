'use strict';
const assert=require('assert'),Current=require('../../lib/currentGridCollection'),h=require('./harness'),mh=require('./current-manager-harness');
const slot={date:'20261003',time:'0000'},coords=[{mx:60,my:127},{mx:61,my:127}];
const empty={find(){return {setOptions(){return this},lean(){return this},exec(cb){cb(null,[])}}}};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
    const policy=require('../../config/gather');
    assert.strictEqual(policy.load({}).currentDeadlineMs,540000);
    for (const value of ['0','-1','NaN','2147483648']) { assert.throws(()=>policy.load({GATHER_CURRENT_DEADLINE_MS:value})); }
    const callbacks=[],controls=[],records=[];let completions=0;
    const c=new Current({model:empty,version:'2.0',collectTimeoutMs:10,coords:cb=>cb(null,coords),emit:r=>records.push(r),
        collect:(list,s,key,cb,control)=>{callbacks.push(cb);controls.push(control)}});
    c.run(slot,'synthetic',e=>{assert.match(e.message,/deadline/i);completions++});
    c.run(slot,'synthetic',e=>{assert(e);completions++});
    await wait(25);assert.strictEqual(completions,2);assert.strictEqual(c.active,null,'stalled collection releases own guard');
    assert(controls[0].cancelled);assert(records.some(r=>r.event==='current-collection-stop'&&r.reason==='deadline'));
    c.options.collectTimeoutMs=1000;c.run({...slot,time:'0100'},'synthetic',e=>{assert(e);completions++});
    const active=c.active;callbacks[0]();assert.strictEqual(c.active,active,'late old callback cannot clear new run');
    callbacks[1]();assert.strictEqual(completions,3);assert.strictEqual(c.active,null);

    let requested=0,aborted=0,late;
    const collector=h.collector({get(url,options,cb){requested++;late=cb;return {abort(){aborted++}}}});
    collector.concurrency=1;collector.requestData(coords,0,'SYNTHETIC_CURRENT_KEY_A',slot.date,slot.time,()=>{});
    collector.cancel();assert.strictEqual(aborted,1);assert.strictEqual(requested,1);
    late(new Error('synthetic abort'));assert.strictEqual(requested,1,'cancelled transport cannot start next grid');

    let saved=0,release,collects=0;
    function Col(){} Col.prototype.requestData=function(list,type,key,date,time,cb){collects++;cb(null,list.map(mCoord=>({mCoord,isCompleted:true,data:[{...slot,mx:mCoord.mx,my:mCoord.my}]})))};
    const f=mh.load({'../lib/collectTownForecast':Col,'../models/town':{getCoord:cb=>cb(null,coords)},'../models/kma/kma.town.current.model':empty,
        '../config/gather':policy.load({GATHER_CURRENT_DEADLINE_MS:'10'})});
    f.m.getCurrentQueryTime=()=>slot;f.m.getSaveFunc=()=>function(data,cb){saved++;release=cb};
    f.m.getTownCurrentData(9,'unused',e=>assert(e));await wait(25);const oldRelease=release;
    assert.strictEqual(f.m._currentCollection.active,null);const before=saved;
    oldRelease();assert.strictEqual(saved,before,'late write completion cannot admit another save');
    f.m.getTownCurrentData(9,'unused',e=>assert(e));assert.strictEqual(collects,2);release(new Error('fixture completion'));

    let passes=0;
    function Failed(){} Failed.prototype.requestData=function(list,type,key,date,time,cb){passes++;cb(true,list.map(mCoord=>({mCoord,isCompleted:false})))};
    const retry=mh.load({'../lib/collectTownForecast':Failed,'../models/town':{getCoord:cb=>cb(null,coords)},'../models/kma/kma.town.current.model':empty,
        '../config/gather':policy.load({GATHER_CURRENT_DEADLINE_MS:'10',GATHER_RETRY_DELAY_MS:'60',GATHER_TOWN_RETRY:'3'})});
    retry.m.getCurrentQueryTime=()=>slot;retry.m.getTownCurrentData(9,'unused',e=>assert(e));
    await wait(90);assert.strictEqual(passes,1,'cancelled cycle cannot dispatch delayed recursive retry');
    console.log('current lifecycle: joined deadlines, late-run fencing, HTTP abort and stalled-write admission passed');
})().catch(e=>{console.error(e);process.exitCode=1});
