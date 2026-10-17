'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness,narrative,invoke,response,page,item,plain,now}=require('./kma-narrative-harness');
test('official national and9office mapping covers17provinces and renamed aliases without city guessing',()=>{
 const h=harness(),r=h.loader.load('lib/kmaForecastRegions.js');
 assert.equal(r.offices.length,10);
 const expected={서울특별시:109,인천광역시:109,경기도:109,부산광역시:159,울산광역시:159,경상남도:159,대구광역시:143,경상북도:143,광주광역시:156,전라남도:156,전남광주통합특별시:156,전라북도:146,전북특별자치도:146,전북자치도:146,대전광역시:133,세종특별자치시:133,충청남도:133,충청북도:131,강원도:105,강원특별자치도:105,제주도:184,제주특별자치도:184};
 for(const [region,id] of Object.entries(expected))assert.equal(r.forProvince(region).stationId,id,region);
 for(const x of ['광주시','Tokyo','US','',null,{},'경기도<script>'])assert.equal(r.forProvince(x),null);
});
test('scheduled10office batch persists separately and continues after one office failure',async()=>{
 const h=harness((n,s)=>s===109?new Error('private URL'):page([{...item,stnId:s}]));
 await assert.rejects(invoke(narrative(h,{stationIds:undefined}),'gather'),/collection failed/);
 assert.equal(h.calls.length,10);assert.equal(h.rows.length,9);assert.equal(h.warnings.rows.length,0);assert(!JSON.stringify(h.logs).includes('private URL'));
});
test('publication identity is station-isolated, immutable and trueUTC; repeat/new publications',async()=>{
 const h=harness();const n=narrative(h,{stationIds:[108,109]});await invoke(n,'gather');await invoke(n,'gather');
 assert.equal(h.rows.length,2);assert.equal(h.rows[0].announcement,'2026-10-16T08:00:00.000Z');assert.notEqual(h.rows[0]._id,h.rows[1]._id);
 const old=plain(h.rows);const h2=harness((c,s)=>page([{...item,stnId:s,tmFc:s===108?'202610170500':item.tmFc,wfSv1:'new text'}]),h.rows);
 await invoke(narrative(h2,{stationIds:[108,109]}),'gather');assert.equal(h.rows.length,3);assert.deepEqual(h.rows.slice(0,2),old);
});
test('regional read returns complete original multiline plain text with publication and expiry',async()=>{
 const h=harness(()=>page([item]));const n=narrative(h);await invoke(n,'gather');const v=await invoke(n,'read',108);
 assert.equal(v.stationId,108);assert.equal(v.region,'전국');assert.equal(v.text,item.wfSv1.replace(/\r/g,''));assert.equal(v.textFormat,'plain');assert.equal(v.language,'ko');assert.equal(v.source,'KMA');assert.equal(v.announcement,'2026-10-16T08:00:00.000Z');assert.equal(v.expiresAt,'2026-10-17T08:00:00.000Z');
});
test('strict KST calendar, future and exact24h publications never become fresh content',async()=>{
 for(const tmFc of ['202602300500','202613010500','202610162460','20261016','202610180500','202610160900']){
  const h=harness(()=>page([{...item,tmFc}]));await invoke(narrative(h),'gather').catch(()=>{});assert.equal(h.rows.length,0,tmFc);
 }
 const h=harness(()=>page([{...item,tmFc:'202610160901'}]));await invoke(narrative(h),'gather');assert.equal(h.rows.length,1);
});
test('no-data and malformed station/text/items never write',async()=>{
 for(const body of [{response:{header:{resultCode:'03'}}},page([]),page([{...item,stnId:109}]),page([{...item,wfSv1:''}]),page([{...item,wfSv1:{}}]),page([item,{...item,stnId:null}]),page(Array(11).fill(item)),{},'not json']){
  const h=harness(()=>body);await invoke(narrative(h),'gather').catch(()=>{});assert.equal(h.rows.length,0);
 }
});
test('auth/quota rotation remains bounded and provider/credential errors stay sanitized',async()=>{
 for(const code of ['20','22','30','31','32']){
  const h=harness(n=>n===1?{status:500,body:{response:{header:{resultCode:code,resultMsg:'https://private/?serviceKey=secret'}}}}:page([item]));
  await invoke(narrative(h),'gather');assert.equal(h.calls.length,2);assert.equal(h.rows.length,1);assert(h.calls.every(c=>c.opts.timeout===30000&&c.opts.followRedirect===false));
 }
 for(const r of [{response:{header:{resultCode:'22',resultMsg:'secret'}}},{status:429,body:{}},{status:403,body:{}},{status:307,body:page([item])},new Error('https://private/?serviceKey=secret')]){
  const h=harness(()=>r);await assert.rejects(invoke(narrative(h),'gather'),e=>!String(e.message).includes('secret'));assert(h.calls.length<=2);assert.equal(h.rows.length,0);
 }
});
test('same-instance overlap coalesces and separate instances converge after11000 race',async()=>{
 const h=harness(),n=narrative(h);await Promise.all([invoke(n,'gather'),invoke(n,'gather')]);assert.equal(h.calls.length,1);
 const race=harness(),update=race.Model.update;let calls=0;race.Model.update=(q,d,o,cb)=>{if(++calls===1)return update(q,d,o,cb);const e=new Error('lost race');e.code=11000;setImmediate(()=>cb(e));};
 const results=await Promise.all([invoke(narrative(race),'gather'),invoke(narrative(race),'gather')]);assert.equal(calls,2);assert.deepEqual(results,[true,false]);assert.equal(race.rows.length,1);assert.equal(race.rows[0].announcement,'2026-10-16T08:00:00.000Z');
 h.Model.failWrite=true;await assert.rejects(invoke(narrative(h),'gather'),/collection failed/);
});
test('warning cycle dispatches narrative without waiting or changing warning state and errors',{timeout:1000},async()=>{
 for(const fail of [false,true]){
  const h=harness(),C=h.loader.load('lib/kmaWarningCollector.js'),c=new C();let dispatch=0,finish;
  c._specialStep=(r,cb)=>{if(fail){const e=new Error('quota');e.isQuotaError=true;cb(e);}else cb();};c._resyncStep=(r,cb)=>cb();c._bulletinStep=(o,t,b,r,cb)=>cb();
  c.narrative={gather(cb){dispatch++;finish=cb;}};
  const e=await new Promise(resolve=>c.gather(resolve));assert.equal(dispatch,1);assert.equal(h.warnings.rows.length,0);assert(finish);
  if(fail)assert.match(e.message,/collection failed/);else assert.equal(e,'skip');finish(new Error('private provider detail'));assert(!JSON.stringify(h.logs).includes('private provider detail'));
 }
});
test('special endpoint reader ignores even retained historicaltype5 rows',async()=>{
 const h=harness();for(const type of [1,2,3,4,5])h.warnings.rows.push({type,announcement:'2026-10-17T08:30:00Z',comment:'legacy',situationList:[]});
 const C=h.loader.load('controllers/kma.specialweather.controller.js');const rows=await invoke(new C(),'getCurrent',{__:s=>s});assert.deepEqual(Array.from(rows,r=>r.type),[4,1,2,3]);assert.equal(h.Model.reads,0);
});
test('weather extension preserves fields and uses regional metadata; unknown region omitted',async()=>{
 const h=harness();await invoke(narrative(h,{stationIds:[109]}),'gather');const helper=h.loader.load('lib/kmaForecastNarrativeResponse.js');
 const value={source:'KMA',regionName:'서울특별시',current:{t1h:12},units:{temperatureUnit:'F'}};const before=plain(value),res=response();
 await new Promise(resolve=>helper.attach(value,109,res,resolve));assert.equal(value.forecastNarrative.stationId,109);const f=value.forecastNarrative;delete value.forecastNarrative;assert.deepEqual(value,before);assert.equal(f.textFormat,'plain');assert.equal(res.headers['cache-control'],'max-age=300');
 await new Promise(resolve=>helper.attach(value,null,res,resolve));assert.equal(value.forecastNarrative,undefined);
});
test('reader omits expired/future/empty/wrong-office data and DB failure',async()=>{
 for(const patch of [{announcement:'2026-10-16T00:00:00Z'},{announcement:'2026-10-18T00:00:00Z'},{announcement:'invalid'},{text:''},{text:{}},{stationId:109}]){
  const h=harness();h.Model.returnRows=[{stationId:108,announcement:'2026-10-16T08:00:00Z',text:'text',...patch}];assert.equal(await invoke(narrative(h),'read',108),null);
 }
 const h=harness();h.Model.failRead=true;assert.equal(await invoke(narrative(h),'read',108),null);
});
test('bounded optional read suppresses late completion and stale field mutation',async()=>{
 const h=harness();await invoke(narrative(h),'gather');h.Model.holdRead=true;const reader=narrative(h,{readTimeoutMs:10});const helper=h.loader.load('lib/kmaForecastNarrativeResponse.js');const body={current:{t1h:1},forecastNarrative:{old:true}};
 let finished=0;await new Promise(resolve=>helper.attach(body,108,response(),()=>{finished++;resolve();},reader));assert.equal(body.forecastNarrative,undefined);h.Model.pending();assert.equal(finished,1);assert.equal(body.forecastNarrative,undefined);
});
test('cache lifetime stops at exact expiry and keeps restrictive directives',async()=>{
 const h=harness();await invoke(narrative(h),'gather');h.setTime(Date.parse('2026-10-17T07:59:58Z'));const helper=h.loader.load('lib/kmaForecastNarrativeResponse.js');const res=response();res.headers['cache-control']='private, max-age=1, s-maxage=999, stale-if-error=86400';const body={};await new Promise(resolve=>helper.attach(body,108,res,resolve));assert(body.forecastNarrative);assert.match(res.headers['cache-control'],/private/);assert.match(res.headers['cache-control'],/max-age=1/);assert(!res.headers['cache-control'].includes('stale'));
 h.setTime(Date.parse('2026-10-17T08:00:00Z'));await new Promise(resolve=>helper.attach(body,108,response(),resolve));assert.equal(body.forecastNarrative,undefined);
});
test('strict requester deadline terminates never-callback transport once',async()=>{
 const h=harness(),R=h.loader.load('lib/kmaWarningRequester.js');let aborted=0,count=0,late;
 const r=new R({keys:['a'+'x'.repeat(40)],strict:true,timeoutMs:10,request:(u,o,cb)=>{late=cb;return {abort(){aborted++;}};}});
 await new Promise(resolve=>r.get('getWthrSituation',{},e=>{count++;assert(e);resolve();}));late(null,{statusCode:200},page([item]));assert.equal(count,1);assert.equal(aborted,1);
});

test('persistence deadline releases the batch and ignores late completion',async()=>{
 const h=harness();let late,finished=0;h.Model.update=(q,d,o,cb)=>{late=cb;};const n=narrative(h,{writeTimeoutMs:10});
 await new Promise(resolve=>n.gather(e=>{finished++;assert.match(e.message,/collection failed/);resolve();}));assert.equal(n.inFlight,false);late(null,{upserted:[{}]});assert.equal(finished,1);
});
test('response attachment completes once even if an injected reader calls twice',async()=>{
 const h=harness(),helper=h.loader.load('lib/kmaForecastNarrativeResponse.js');let calls=0;const reader={read(id,cb){cb(null,null);cb(null,null);}};
 helper.attach({},108,response(),()=>{calls++;},reader);assert.equal(calls,1);
});
