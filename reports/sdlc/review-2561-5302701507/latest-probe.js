'use strict';
// All added inputs are synthetic. Captured item is reused from issue #2560.
// Real parser/controllers/route; provider, DB, configuration and timers stubbed.
process.env.TW_SMOKE_NOW='2026-09-24T07:27:00.000Z';
const path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..');
const h=require(root+'/server/test/offline/harness');
const dh=require(root+'/server/test/offline/daily-harness');
const route=require(root+'/server/test/offline/rss-response-smoke');
const captured=require(root+'/server/test/offline/fixtures/mid-land-captured.json');
const rows=[];
(async()=>{
 for(const version of ['1.0','2.0']) {
  const env=dh.environment(version);
  for(const weather of ['구름많고 소나기','흐리고 소나기']) {
   const item={regId:['11B00000'],wf4Am:[weather],wf4Pm:[weather],wf5Am:[weather],wf5Pm:[weather],wf6Am:['맑음'],wf6Pm:['맑음']};
   const parsed=env.policy.parse('land',h.response([item]),{date:'20260924',time:'0600'})[0];
   assert.equal(parsed.wf4Am,undefined);assert.equal(parsed.wf5Pm,undefined);assert.equal(parsed.wf6Am,'맑음');
   assert.equal(env.town._convertKorStrToSky(weather),undefined);
   const f=route.makeFixture(route.locations[0],'newer');f.land=parsed;
   const r=await route.createHarness(version,f).request({temperatureUnit:'C',windSpeedUnit:'m/s'});
   const dates=r.body.midData.dailyData.map(x=>x.date);
   assert(!dates.includes('20260928'));assert(!dates.includes('20260929'));assert(dates.includes('20260930'));
   rows.push({version,case:'shower-loss',weather,retainedWeather:Object.keys(parsed).filter(k=>k.startsWith('wf')),dates});
  }
  for(const legacy of [false,true]) {
   const f=route.makeFixture(route.locations[0],'newer');
   if(!legacy)f.land=env.policy.parse('land',h.response([captured]),{date:'20260924',time:'0600'})[0];
   const storedD3=f.short.filter(x=>x.date==='20260927');assert.equal(storedD3.length,8);
   const r=await route.createHarness(version,f).request({temperatureUnit:'C',windSpeedUnit:'m/s'});
   const dates=r.body.midData.dailyData.map(x=>x.date);
   assert.equal(dates.includes('20260927'),legacy);
   assert.equal(r.body.midData.dailyStatus.healthy,true);
   assert.equal(r.body.midData.dailyStatus.unavailableDates.includes('20260927'),!legacy);
   assert(!r.body.short.some(x=>x.date==='20260927'));
   rows.push({version,case:legacy?'legacy-day3-control':'captured-day3-gap',storedD3Slots:storedD3.length,responseShortLast:r.body.short[r.body.short.length-1].date,dates,status:r.body.midData.dailyStatus});
  }
  const f=route.makeFixture(route.locations[0],'newer');f.basePub='202609161400';f.rssPub='202609241400';
  f.rss=f.rss.map(x=>({...x,ftm:f.rssPub,date:x.date.replace('20260924','20260925'),reh:-1}));
  const r=await route.createHarness(version,f).request({temperatureUnit:'C',windSpeedUnit:'m/s'});
  const tomorrow=r.body.short.filter(x=>x.date==='20260925');
  assert(tomorrow.some(x=>x.tmx===28));assert(f.rss.some(x=>x.tmn===19));
  assert(!r.body.midData.dailyData.some(x=>x.date==='20260925'));
  rows.push({version,case:'rss-missing-humidity',hourlyTomorrowSlots:tomorrow.length,dailyTomorrow:false});
 }
 console.log(JSON.stringify({head:'b13dc38adece3d301765b03afea4a5feb9d02d8b',fixedClock:process.env.TW_SMOKE_NOW,scenarioCount:rows.length,outcome:'All review-probe expectations confirmed',rows},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
