'use strict';
const assert=require('assert'),h=require('./current-manager-harness');
let attempts=0,reasonCode='22';
function Collector(){}
Collector.prototype.requestData=function(list,type,key,date,time,cb){
    attempts++;this.stopReason='quota';
    if(this.onPageRequest){this.onPageRequest()}
    if(this.onQuota){this.onQuota(reasonCode,429)}
    cb(true,list.map(mCoord=>({mCoord,isCompleted:false})));
};
const f=h.load({'../lib/collectTownForecast':Collector});
let now=Date.parse('2026-10-02T14:59:00Z');
f.m._collectionNow=()=>now;f.m.getSaveFunc=()=>function(d,cb){cb()};
function run(type){let done=0,error;f.m._recursiveRequestData([{mx:60,my:127}],type,'unused',{date:'20261002',time:'2300'},1,undefined,e=>{done++;error=e});assert.strictEqual(done,1);assert(error);}
run(f.m.DATA_TYPE.TOWN_CURRENT);assert.strictEqual(attempts,2);
run(f.m.DATA_TYPE.TOWN_CURRENT);assert.strictEqual(attempts,2,'all current keys rejected today must cause zero further HTTP');
run(f.m.DATA_TYPE.TOWN_SHORTEST);assert.strictEqual(attempts,4,'unverified shared quota must not suppress another product');
now=Date.parse('2026-10-02T15:00:00Z');
run(f.m.DATA_TYPE.TOWN_CURRENT);assert.strictEqual(attempts,6,'next KST day probes again');
const records=f.records.map(JSON.parse);
assert(records.some(r=>r.event==='first-quota'&&r.kstHour==='2026-10-02T23'));
assert(!f.records.join('').includes('SYNTHETIC_CURRENT_KEY_A'));
assert(!f.records.join('').includes('serviceKey'));
reasonCode='23';
const throttled=h.load({'../lib/collectTownForecast':Collector});
throttled.m._collectionNow=()=>now;throttled.m.getSaveFunc=()=>function(d,cb){cb()};
const start=attempts;
for(let i=0;i<2;i++){
    throttled.m._recursiveRequestData([{mx:60,my:127}],throttled.m.DATA_TYPE.TOWN_CURRENT,'unused',slot(),1,undefined,e=>assert(e));
}
assert.strictEqual(attempts-start,4,'HTTP429/code23 is not a verified daily rejection');
function slot(){return {date:'20261003',time:'0000'}}
console.log('current quota memory: day isolation, reset, product boundary and secret-free records passed');
// R3-001: cooldown filtering must not recycle the only remaining rejected key.
for(const stopReason of ['quota','key']) {
    const keys=[];
    function Mixed(){}
    Mixed.prototype.requestData=function(list,type,key,date,time,cb){
        keys.push(key);this.stopReason=stopReason;
        this.onPageRequest();if(stopReason==='quota'){this.onQuota('23',429)}
        cb(true,list.map(mCoord=>({mCoord,isCompleted:false})));
    };
    const mixed=h.load({'../lib/collectTownForecast':Mixed});
    mixed.m._collectionNow=()=>now;mixed.m.getSaveFunc=()=>function(d,cb){cb()};
    mixed.m._forecastTraffic=new (require('../../lib/forecastTraffic'))(()=>{});
    mixed.m._forecastTraffic.quota(0,'TOWN_CURRENT',0,now,'22',now);
    let called=0;
    mixed.m._recursiveRequestData([{mx:60,my:127}],0,'unused',slot(),1,undefined,e=>{assert(e);called++});
    assert.strictEqual(called,1);
    assert.deepStrictEqual(keys,['SYNTHETIC_CURRENT_KEY_B'],'R3-001: each eligible rejected key is tried once per cycle');
}
// R3-002: permanent rejection and retryable failures are separately measurable.
function Outcomes(){}
Outcomes.prototype.requestData=function(list,type,key,date,time,cb){
    list.forEach(()=>this.onPageRequest());
    cb(true,[{mCoord:list[0],isCompleted:true,data:{}},{mCoord:list[1],isCompleted:false,rejected:true},{mCoord:list[2],isCompleted:false}]);
};
const outcomes=h.load({'../lib/collectTownForecast':Outcomes});
outcomes.m.getSaveFunc=()=>function(d,cb){cb()};
outcomes.m._recursiveRequestData([{mx:1,my:1},{mx:2,my:2},{mx:3,my:3}],0,'unused',slot(),1,undefined,()=>{});
const pass=outcomes.records.map(JSON.parse).find(r=>r.event==='forecast-pass');
assert.strictEqual(pass.received,1);assert.strictEqual(pass.pending,2);
assert.strictEqual(pass.failed,1,'R3-002: retryable incomplete items counted separately');
assert.strictEqual(pass.rejected,1,'R3-002: non-retryable rejected items counted separately');
