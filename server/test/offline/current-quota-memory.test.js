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
assert(!f.records.join('').includes('SYNTHETIC_A'));
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
