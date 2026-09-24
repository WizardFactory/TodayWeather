'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const root=require('node:path').resolve(__dirname,'../../..');
const h=require(root+'/server/test/offline/harness');
const dh=require(root+'/server/test/offline/daily-harness');
test('IV-1 entirely unrecognized land item fails rather than publishing success',()=>{
 const c=h.prepare(h.collector()), events=[];
 c.on('recvData',()=>events.push('recvData'));c.on('recvFail',()=>events.push('recvFail'));
 c.organizeLandData(0,h.response([{regId:['11B00000'],wf4Am:['not weather']}]),{date:'20260924',time:'0600'});
 assert.deepEqual(events,['recvFail']);
});
test('IV-2 invalid short weather cannot erase valid mid weather or become zero rain',()=>{
 const e=dh.environment();const good={date:'20260928',taMin:14,taMax:24,wfAm:'맑음',wfPm:'맑음',sky:1,skyAm:1,skyPm:1,pty:0,ptyAm:0,ptyPm:0};
 const req={params:{},shortPubDate:'202609241400',midData:{dailyData:[good]},short:['0900','1500'].map(time=>({date:'20260928',time,tmn:10,tmx:24,t3h:20,reh:50,sky:1,pty:-1,pop:-1,r06:-1,s06:-1,wsd:-1,lgt:-1}))};
 e.town.mergeMidWithShort(req,{},()=>{}); const actual=req.midData.dailyData[0];
 assert.equal(actual.wfAm,'맑음');assert.equal(actual.wfPm,'맑음');assert.equal(actual.ptyAm,0);
 assert.notEqual(actual.r06,0);assert.notEqual(actual.s06,0);
});
test('IV-3 no text DB record does not block fresh primary data',()=>{
 const e=dh.environment();const l={date:'20260924',time:'0600',pubDate:'202609240600',regId:'11B00000',wf4Am:'맑음',wf4Pm:'맑음'};
 e.manager.saveMidLand([l],assert.ifError);e.manager.saveMidTemp([dh.temperature()],assert.ifError);
 const req={params:{region:'Seoul',city:'Seoul'},regId:'11B10101'};let count=0;
 e.town.getMid(req,{},()=>count++);assert.equal(count,1);assert.deepEqual(Array.from(req.midData.dailyData,x=>x.date),['20260928']);
});
test('IV-4 service remains usable without either primary and retired RSS',()=>{
 const e=dh.environment();const req={params:{region:'Seoul',city:'Seoul'},regId:'11B10101',shortPubDate:'202609241400',short:['0900','1500'].map(time=>({date:'20260924',time,tmn:10,tmx:24,t3h:20,reh:50,sky:1,pty:0,pop:0,r06:0,s06:0,wsd:1,lgt:0}))};let count=0;
 e.town.getMid(req,{},()=>count++);e.town.getMidRss(req,{},()=>count++);e.town.convertMidKorStrToSkyInfo(req,{},()=>count++);e.town.mergeMidWithShort(req,{},()=>count++);
 assert.equal(count,4);assert.equal(req.midData.dailyData[0].date,'20260924');assert.equal(req.midData.dailyStatus.healthy,false);
});
test('IV-5 absent source temperature is not a numeric daily mean; real minus one is preserved',()=>{
 for(const [temperature,expected] of [[-50,undefined],[-1,-1]]){
 const e=dh.environment(),req={params:{},shortPubDate:'202609241400',midData:{dailyData:[]},short:['0900','1500'].map(time=>({date:'20260925',time,tmn:temperature===-1?-2:10,tmx:24,t3h:temperature,reh:50,sky:1,pty:0,pop:-1,r06:-1,s06:-1,wsd:-1,lgt:-1}))};
 e.town.mergeMidWithShort(req,{},()=>{});assert.equal(req.midData.dailyData[0].t1d,expected);
 }
});
