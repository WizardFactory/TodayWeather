'use strict';
const {createLoader, logger} = require('./air-harness');
const async = require('async');
const now = Date.parse('2026-10-17T00:00:00Z');
const page = items => ({response:{header:{resultCode:'00'},body:{items:{item:items}}}});
// Synthetic prose using issue-reported metadata, not a captured complete bulletin.
const item = {stnId:108,tmFc:'202610161700',wfSv1:'○ 18일 전국 비\r\n* 예상 강수량: 30~80mm\r\n<img src=x onerror="alert(1)"> & 안내',wn:'ignored',wr:'ignored'};
const plain = x => JSON.parse(JSON.stringify(x));
function memory(rows) {
 const m={rows,reads:0,find(q) {
  m.reads++;let r=m.returnRows || rows.filter(x=>Object.keys(q).every(k=>String(x[k])===String(q[k])));
  const c={sort(){r=r.slice().sort((a,b)=>+new Date(b.announcement)-+new Date(a.announcement));return c;},limit(n){r=r.slice(0,n);return c;},lean(){return c;},maxTimeMS(){return c;},exec(cb){const finish=()=>m.failRead?cb(new Error('private db detail')):cb(null,plain(r));if(m.holdRead)m.pending=finish;else setImmediate(finish);}};return c;
 },update(q,d,o,cb) {
  if(m.failWrite)return setImmediate(()=>cb(new Error('private db detail')));
  const found=rows.find(x=>String(x._id)===String(q._id));if(!found)rows.push(plain(d.$setOnInsert));setImmediate(()=>cb(null,{upserted:found?[]:[{_id:q._id}]}));
 }};return m;
}
function harness(respond, rows=[]) {
 let time=now;class Clock extends Date {constructor(...a){super(...(a.length?a:[time]));}static now(){return time;}}
 const calls=[],logs=[],Model=memory(rows),warnings=memory([]);
 const overrides={async,'config/config.js':{keyString:{dongnae_forecast_keys:JSON.stringify(['a'+'x'.repeat(40),'b'+'x'.repeat(40)])}},
 request:(url,opts,cb)=>{calls.push({url,opts});setImmediate(()=>{const stn=Number(new URL(url).searchParams.get('stnId'));const r=respond?respond(calls.length,stn,url):page([{...item,stnId:stn,wfSv1:'office '+stn+'\n'+item.wfSv1}]);if(r instanceof Error)return cb(r);cb(null,{statusCode:r.status||200},r.body||r);});},
 'models/modelKmaForecastNarrative.js':Model,'models/modelKmaSpecialWeatherSituation.js':warnings,'models/modelKmaSpecialWeatherZone.js':{},'lib/kmaWarningZones.js':{}};
 const loader=createLoader({log:logger(logs),globals:{Date:Clock},overrides});
 return {loader,Model,warnings,rows,calls,logs,overrides,setTime:t=>{time=t;}};
}
const invoke = (o,m,...a) => new Promise((resolve,reject)=>o[m](...a,(e,r)=>e?reject(e):resolve(r)));
function narrative(h, options) {return new (h.loader.load('lib/kmaForecastNarrative.js'))(Object.assign({stationIds:[108]},options));}
function response() {return {headers:{},getHeader(n){return this.headers[n.toLowerCase()];},setHeader(n,v){this.headers[n.toLowerCase()]=v;}};}
module.exports={harness,narrative,invoke,response,page,item,plain,now,memory};
