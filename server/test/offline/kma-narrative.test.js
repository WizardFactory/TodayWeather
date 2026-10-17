'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {createLoader, logger} = require('./air-harness');
const async = require('async');
const key = s => s + 'x'.repeat(40);
const now = Date.parse('2026-10-17T00:00:00Z');
class Clock extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }
const page = items => ({response:{header:{resultCode:'00'},body:{items:{item:items}}}});
// Issue-reported publication and precipitation; synthetic excerpt, NOT the full captured response.
const item = {stnId:108,tmFc:'202610161700',wfSv1:'○ 18일 전국 비\r\n* 수도권 예상 강수량: 30~80mm\r\n<참고> & 안내',wn:'ignored',wr:'ignored'};
function harness(respond = () => page([item]), rows = []) {
    const calls=[], logs=[];
    const Model={
        find(q) { let r=rows.filter(x=>x.type===q.type); const chain={sort(){r.sort((a,b)=>+new Date(b.announcement)-+new Date(a.announcement));return chain;},limit(n){r=r.slice(0,n);return chain;},lean(){return chain;},exec(cb){setImmediate(()=>Model.failType===q.type?cb(new Error('db down')):cb(null,JSON.parse(JSON.stringify(r))));}};return chain;},
        update(q, doc, opts, cb) { const x=rows.find(x=>String(x._id)===String(q._id));if(Model.failWrite)return setImmediate(()=>cb(new Error('db down')));if(!x)rows.push(JSON.parse(JSON.stringify(doc.$setOnInsert)));setImmediate(()=>cb(null,{upserted:x?[]:[{_id:q._id}]})); }
    };
    const loader=createLoader({log:logger(logs),globals:{Date:Clock},overrides:{async,'config/config.js':{keyString:{dongnae_forecast_keys:JSON.stringify([key('a'),key('b')])}},
        request:(url,opts,cb)=>{calls.push({url,opts});setImmediate(()=>{const r=respond(calls.length,url);if(r instanceof Error) return cb(r);cb(null,{statusCode:r.status||200},r.body||r);});},
        'models/modelKmaSpecialWeatherSituation.js':Model,'models/modelKmaSpecialWeatherZone.js':{},'lib/kmaWarningZones.js':{}}});
    return {loader,Model,rows,calls,logs};
}
const invoke = (o,m,...a) => new Promise((resolve,reject)=>o[m](...a,(e,r)=>e?reject(e):resolve(r)));
test('scheduled warning cycle acquires the separate narrative after legacy work',async()=>{
    const h=harness(); const C=h.loader.load('lib/kmaWarningCollector.js');const c=new C();
    c._specialStep=(r,cb)=>cb();c._resyncStep=(r,cb)=>cb();c._bulletinStep=(o,t,b,r,cb)=>cb();
    await invoke(c,'gather'); assert.equal(h.rows.filter(x=>x.type===5).length,1);
});

function narrative(h) { return new (h.loader.load('lib/kmaForecastNarrative.js'))(); }
const run = h => invoke(narrative(h),'gather');
test('publication identity, repeat/new and complete text with UTC conversion',async()=>{
 const h=harness();await run(h);await run(h);assert.equal(h.rows.length,1);
 assert.equal(new Date(h.rows[0].announcement).toISOString(),'2026-10-16T17:00:00.000Z');
 assert.equal(h.rows[0].comment,item.wfSv1.replace(/\r/g,''));assert.equal(h.rows[0].situationList,undefined);
 const C=h.loader.load('controllers/kma.specialweather.controller.js');const row=new C()._parseSpecialWeatherSituation(h.rows[0],{});
 assert.equal(row.name,'종합예보');assert.equal(row.announcement.toISOString(),'2026-10-16T08:00:00.000Z');
 assert.equal(row.comment,'○ 18일 전국 비\n* 수도권 예상 강수량: 30~80mm\n&lt;참고&gt; &amp; 안내');
 const n=harness(()=>page([{...item,tmFc:'202610170500'}]),h.rows);await run(n);assert.equal(h.rows.length,2);
});
test('strict calendar validation and exact24h/future publication suppression',async()=>{
 for(const tmFc of ['202602300500','202613010500','202610162460','20261016','202610180500','202610160900']) {
  const h=harness(()=>page([{...item,tmFc}]));await run(h).catch(()=>{});assert.equal(h.rows.length,0,tmFc);
 }
 const h=harness(()=>page([{...item,tmFc:'202610160901'}]));await run(h);assert.equal(h.rows.length,1);
});
test('no-data and malformed rows never write',async()=>{
 for(const body of [{response:{header:{resultCode:'03'}}}, page([]),page([{...item,stnId:109}]),page([{...item,wfSv1:''}]),page([{...item,wfSv1:{}}]),page([item,{...item,stnId:null}]),page(Array(11).fill(item)),{},'not json']) {
  const h=harness(()=>body);await run(h).catch(()=>{});assert.equal(h.rows.length,0);
 }
});
test('auth/quota rotation is bounded; strict transport and logs contain no provider text or key',async()=>{
 for(const code of ['20','22','30','31','32']) {
  const h=harness(n=>n===1?{status:500,body:{response:{header:{resultCode:code,resultMsg:'https://secret.invalid/?key=secret'}}}}:page([item]));
  await run(h);assert.equal(h.calls.length,2);assert.equal(h.rows.length,1);assert(h.calls.every(c=>c.opts.timeout===30000 && c.opts.followRedirect===false));
  assert(h.calls[0].url.startsWith('https://apis.data.go.kr/1360000/VilageFcstMsgService/getWthrSituation?'));
 }
 for(const response of [{response:{header:{resultCode:'22',resultMsg:'secret'}}},{status:429,body:{}},{status:403,body:{}},{status:307,body:page([item])},new Error('https://secret.invalid/?serviceKey=secret'),{response:{header:{resultCode:'secret',resultMsg:'secret'}}}]) {
  const h=harness(()=>response);let error;try{await run(h);}catch(e){error=e;}assert(error);assert(!JSON.stringify(error).includes('secret'));assert(!error.message.includes('secret'));assert(h.calls.length<=2);assert.equal(h.rows.length,0);
 }
});
test('same-instance overlapping acquisition coalesces; persistence failures are safe',async()=>{
 const h=harness();const n=narrative(h);await Promise.all([invoke(n,'gather'),invoke(n,'gather')]);assert.equal(h.calls.length,1);assert.equal(h.rows.length,1);
 const b=harness();b.Model.failWrite=true;await assert.rejects(run(b),/persistence failed/);assert.equal(b.rows.length,0);
});
test('optional narrative read keeps warnings, stable order, escaping and expiry',async()=>{
 const h=harness();for(const type of [1,2,3,4])h.rows.push({type,announcement:'2026-10-17T08:30:00Z',comment:'legacy',situationList:[]});await run(h);
 const C=h.loader.load('controllers/kma.specialweather.controller.js'),c=new C(),trans={__:s=>s};
 let rows=await invoke(c,'getCurrent',trans);assert.deepEqual(Array.from(rows,x=>x.type),[4,1,2,3,5]);
 h.Model.failType=5;rows=await invoke(c,'getCurrent',trans);assert.deepEqual(Array.from(rows,x=>x.type),[4,1,2,3]);h.Model.failType=undefined;
 h.rows.find(x=>x.type===5).announcement='2026-10-16T09:00:00Z';rows=await invoke(c,'getCurrent',trans);assert.equal(rows.length,4);
 h.rows.find(x=>x.type===5).announcement='invalid';rows=await invoke(c,'getCurrent',trans);assert.equal(rows.length,4);
});

test('strict requester absolute deadline terminates a never-callback transport once',async()=>{
 const h=harness();const R=h.loader.load('lib/kmaWarningRequester.js');let aborted=0,callbacks=0,late;
 const r=new R({keys:[key('a')],strict:true,timeoutMs:10,request:(url,o,cb)=>{late=cb;return {abort(){aborted++;}};}});
 await new Promise(resolve=>r.get('getWthrSituation',{},e=>{callbacks++;assert(e);resolve();}));
 late(null,{statusCode:200},page([item]));assert.equal(callbacks,1);assert.equal(aborted,1);
});
