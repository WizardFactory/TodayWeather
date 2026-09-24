'use strict';
// Synthetic review regressions. Real implementations; no production initialization.
const test=require('node:test'),assert=require('node:assert/strict');
const h=require('./harness'),dh=require('./daily-harness');
for(const version of ['1.0','2.0'])for(const weather of ['구름많고 소나기','흐리고 소나기']) {
 test(version+' shower parse/storage/conversion '+weather,()=>{
  const e=dh.environment(version),item={regId:['11B00000'],wf4Am:[weather],wf4Pm:[weather]};
  const parsed=e.policy.parse('land',h.response([item]),{date:'20260924',time:'0600'});
  assert.equal(parsed[0].wf4Am,weather);
  e.manager.saveMidLand(parsed,assert.ifError);
  let land;e.town._getMidDataFromDB(e.model('modelMidLand'),'11B00000',{},(err,r)=>{assert(!err);land=r;});
  assert.equal(land.ret[0].wf4Pm,weather);
  const converted=e.town._convertKorStrToSky(weather);
  assert.equal(converted.sky,weather.startsWith('구름')?3:4);assert.equal(converted.pty,1);
 });
}
test('weather acceptance and conversion share every recognized label',()=>{
 const e=dh.environment();
 for(const [text,sky,pty] of [['맑음',1,0],['흐리고 눈',4,3],['구름많고 비/눈',3,2],['구름많고 소나기',3,1],['흐리고 소나기',4,1]]) {
  assert(e.policy.weather(text));assert.equal(e.town._convertKorStrToSky(text).sky,sky);assert.equal(e.town._convertKorStrToSky(text).pty,pty);
 }
 for(const text of ['',null,'unknown','toString','__proto__'])assert(!e.policy.weather(text));
});
test('health flags an internal gap without requiring an unsupported trailing horizon',()=>{
 const e=dh.environment(),p=e.policy;
 const dailyData=Array.from({length:10},(_,i)=>({date:p.addDays('20260924',i),taMin:10,taMax:20,wfAm:'맑음',wfPm:'맑음'}));
 const mid={landPubDate:'202609240600',tempPubDate:'202609240600',dailyData};
 assert(p.dailyHealth(mid).healthy);assert.deepEqual(Array.from(p.dailyHealth(mid).unavailableDates),['20261004']);
 mid.dailyData=dailyData.filter(r=>r.date!=='20260927');
 assert.equal(p.dailyHealth(mid).healthy,false);assert(p.dailyHealth(mid).reasons.includes('forecast-gap'));
 mid.dailyData=dailyData.map(r=>r.date==='20260927'?Object.assign({},r,{taMin:-999}):r);
 assert.equal(p.dailyHealth(mid).healthy,false);
});
test('retired mid RSS never enters startup or minute-2 scheduling',()=>{
 for(const [now,putAll] of [['2026-09-24T07:02:00Z',false],['2026-09-24T07:27:00Z',true]]) {
  const e=dh.environment('2.0',now),queued=[];e.manager.asyncTasks={length:0,push:fn=>queued.push(fn.name)};e.manager._requestApi=(name,cb)=>cb();
  e.manager.checkTimeAndRequestTask(putAll);
  assert(!queued.includes('MidRss'));assert(queued.includes('ShortRss'));
 }
});
test('raw daily slots use their own publication and newest slot, never outer publication',()=>{
 const e=dh.environment(),p=e.policy;
 const row={date:'20260927',time:'0600',tmn:12,tmx:23,sky:3,pty:0};
 const records=[{pubDate:'202609240500',...row},{pubDate:'202609241400',...row,tmn:-50}];
 assert.equal(p.dailyShortRows(records)[0].tmn,-50,'new partial cannot borrow old minimum');
 assert.equal(p.dailyShortRows([{pubDate:'202609161400',...row}]).length,0);
 assert.equal(p.dailyShortRows([{pubDate:'202609241800',...row}]).length,0);
 assert.equal(p.dailyShortRows([{pubDate:'202609241400',...row,date:'20260929'}]).length,0);
 assert.equal(p.dailyShortRows([{pubDate:'202609241400',...row,time:'oops'}]).length,0);
});
test('DB1 current raw snapshot replaces partial batch without inheriting prior fields',()=>{
 const e=dh.environment('1.0'),model=e.model('modelShort');
 const Manager=e.load('controllers/controllerManager.js',{'../models/modelShort':model});
 const manager=Object.create(Manager.prototype);manager.MAX_SHORT_COUNT=64;
 const row={mx:60,my:127,date:'20260927',time:'0600',pubDate:'202609240500',tmn:12,tmx:23,t3h:18,sky:3,pty:0,reh:50};
 let callbacks=0;manager.saveShort([row,{...row,date:'20260928'}],err=>{assert(!err);callbacks++;});
 assert.equal(model.docs[0].dailySource.pubDate,row.pubDate);
 assert.equal(model.docs[0].dailySource.rows[0].tmn,12);
 manager.saveShort([{...row,pubDate:'202609241400',tmn:-50,sky:-1}],err=>{assert(!err);callbacks++;});
 assert.equal(callbacks,2);
 assert.equal(model.docs[0].shortData[0].tmn,12,'legacy hourly merge unchanged');
 assert.equal(model.docs[0].dailySource.rows[0].tmn,-50,'daily snapshot retains missing value');
 assert.equal(model.docs[0].dailySource.rows[0].sky,-1);
 assert.equal(model.docs[0].dailySource.rows.length,1,'old batch horizons removed');
 assert.equal(model.docs[0].shortData.length,2,'legacy hourly history preserved');
});

test('extended daily source keeps KST month/year and midnight target identity',()=>{
 const e=dh.environment('2.0','2026-12-30T15:30:00Z'),p=e.policy;
 const raw=[{date:'20270103',time:'0000',tmn:10,tmx:20,sky:3,pty:0,pubDate:'202612301800'}];
 const rows=p.dailyShortRows(raw);assert.equal(rows.length,1);assert.equal(rows[0].date,'20270103');
 const aligned={...rows[0]};e.time.convert0Hto24H(aligned);assert.equal(aligned.date,'20270102');assert.equal(aligned.time,'2400');
 assert.equal(p.dailyShortRows([{...raw[0],date:'20270104'}]).length,0);
 assert.equal(p.dailyShortRows([null,{}, {...raw[0],date:20270103}]).length,0);
});
test('actual shared client daily parser ignores additive status and preserves shower/date fields',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const source=fs.readFileSync(path.resolve(__dirname,'../../../client/www/js/service.weatherutil.js'),'utf8');
 const start=source.indexOf('function _parseMidTownWeather(midData)');
 const end=source.indexOf('\n        function',start+10);
 const parse=vm.runInNewContext('('+source.slice(start,end).trim()+')');
 const row={date:'20260927',fromToday:3,tmn:18,tmx:27,wfAm:'구름많고 소나기',skyAm:'sun_bigcloud_rain',skyPm:'cloud_rain'};
 const plain=parse({dailyData:[{...row}]}),status=parse({dailyData:[{...row}],dailyStatus:{healthy:false,reasons:['forecast-gap']}});
 assert.deepEqual(JSON.parse(JSON.stringify(plain)),JSON.parse(JSON.stringify(status)));
 assert.equal(status.dayTable[0].date,'20260927');assert.equal(status.dayTable[0].wfAm,row.wfAm);
});
