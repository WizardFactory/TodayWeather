/** Separate real request -> Mongo -> mounted Express route smoke. Synthetic provider, no app startup. */
'use strict';
const assert=require('node:assert/strict'), http=require('node:http'), fs=require('node:fs');
const mongoose=require('mongoose-smoke'), express=require('express'), async=require('async'), request=require('request');
const {MongoMemoryServer}=require('mongodb-memory-server-core');
const {createLoader,logger}=require('./air-harness');
let mongo,provider,server,calls=0,mode='ok';
let clock=Date.parse('2026-10-17T00:00:00Z');
class Clock extends Date { constructor(...a){super(...(a.length?a:[clock]));}static now(){return clock;} }
const item={stnId:108,tmFc:'202610161700',wfSv1:'○ 18일 전국 비\r\n* 수도권 예상 강수량: 30~80mm\r\n<img src=x onerror="alert(1)"> & 안내'};
const invoke=(o,m,...a)=>new Promise((resolve,reject)=>o[m](...a,(e,r)=>e?reject(e):resolve(r)));
const listen=s=>new Promise(resolve=>s.listen(0,'127.0.0.1',()=>resolve(s)));
const close=s=>s&&new Promise(resolve=>s.close(resolve));
const get=url=>new Promise((resolve,reject)=>http.get(url,r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{try{assert.equal(r.statusCode,200);resolve({body:JSON.parse(b),cache:r.headers['cache-control']});}catch(e){reject(e);}});}).on('error',reject));
(async()=>{
 mongo=await MongoMemoryServer.create({binary:{version:'7.0.14',systemBinary:process.env.TW_MONGOD||process.env.MONGOMS_SYSTEM_BINARY},instance:{ip:'127.0.0.1'}});
 await mongoose.connect(mongo.getUri(),{useNewUrlParser:true,useUnifiedTopology:true});
 const logs=[];
 function Town(){return new Proxy({},{get:()=> (req,res,next)=>next()});}
 const model=createLoader({overrides:{mongoose}}).load('models/modelKmaSpecialWeatherSituation.js');
 const loader=createLoader({log:logger(logs),globals:{Date:Clock},overrides:{async,request,express,mongoose,'config/config.js':{keyString:{}},
  'models/modelKmaSpecialWeatherSituation.js':model,'lib/kmaWarningZones.js':{},'models/modelKmaSpecialWeatherZone.js':{},'controllers/controllerTown24h.js':Town}});
 await model.init();
 for(const type of [1,2,3,4])await model.create({type,announcement:new Date('2026-10-17T08:30:00Z'),comment:'legacy-'+type});
 provider=await listen(http.createServer((req,res)=>{
  calls++;const u=new URL(req.url,'http://127.0.0.1');assert.equal(u.pathname,'/getWthrSituation');assert.equal(u.searchParams.get('stnId'),'108');assert.equal(u.searchParams.get('pageNo'),'1');
  const reject=mode==='quota'||u.searchParams.get('serviceKey').startsWith('rejected');
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({response:{header:{resultCode:reject?'22':mode==='no-data'?'03':'00'},body:{items:{item:[item]}}}}));
 }));
 const Requester=loader.load('lib/kmaWarningRequester.js'),Narrative=loader.load('lib/kmaForecastNarrative.js'),Collector=loader.load('lib/kmaWarningCollector.js');
 const requester=new Requester({keys:['rejected'+'x'.repeat(40),'approved'+'x'.repeat(40)],baseUrl:'http://127.0.0.1:'+provider.address().port+'/',strict:true});
 const collector=new Collector({requester});collector.narrative=new Narrative({requester,model});
 // The legacy collector is exercised in its own regressions. Seeded real warning rows remain unchanged.
 collector._specialStep=(r,cb)=>cb();collector._resyncStep=(r,cb)=>cb();collector._bulletinStep=(o,t,b,r,cb)=>cb();
 await invoke(collector,'gather');assert.equal(calls,2);assert.equal(await model.countDocuments({type:5}),1);
 await assert.rejects(invoke(collector,'gather'),e=>e==='skip');assert.equal(await model.countDocuments({type:5}),1);
 const raw=await model.findOne({type:5}).lean();assert.equal(raw.comment,item.wfSv1.replace(/\r/g,''));
 const route=loader.load('routes/v000903/route.kma.v000903.js');const app=express();app.use((req,res,next)=>{res.__=s=>s;next();});app.use('/v000903/kma',route);server=await listen(http.createServer(app));
 const url='http://127.0.0.1:'+server.address().port+'/v000903/kma/special';
 let response=await get(url);assert.deepEqual(response.body.map(r=>r.type),[4,1,2,3,5]);
 const entry=response.body[4];assert.equal(entry.name,'종합예보');assert.equal(entry.announcement,'2026-10-16T08:00:00.000Z');assert.equal(entry.comment,Narrative.escapeText(item.wfSv1.replace(/\r/g,'')));assert(!entry.comment.includes('<img'));
 if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify({command:'GET /v000903/kma/special',status:200,environment:'Isolated loopback HTTP + real Mongo; synthetic narrative excerpt',response:response.body},null,2)+'\n');
 item.tmFc='202610170500';
 await Promise.all([invoke(collector,'gather').catch(err=>{ if(err!=='skip')throw err; }),invoke(new Narrative({requester,model}),'gather')]);assert.equal(await model.countDocuments({type:5}),2);
 const second=await model.findOne({type:5,announcement:new Date('2026-10-17T05:00:00Z')}).lean();
 assert.equal(second.comment,item.wfSv1.replace(/\r/g,''));response=await get(url);assert.equal(response.body[4].announcement,'2026-10-16T20:00:00.000Z');
 clock=Date.parse('2026-10-17T19:59:58Z');assert.equal((await get(url)).cache,'max-age=2');
 mode='quota';const before=calls;await assert.rejects(invoke(collector,'gather'),/collection failed/);assert.equal(calls-before,2);assert.equal(await model.countDocuments(),6);
 mode='no-data';await assert.rejects(invoke(collector,'gather'),e=>e==='skip');assert.deepEqual((await get(url)).body.map(r=>r.type),[1,2,3,5]);
 clock=Date.parse('2026-10-17T20:00:00Z');response=await get(url);assert.deepEqual(response.body.map(r=>r.type),[1,2,3]); // flash also expires under its existing policy
 for(const type of [1,2,3,4])assert.equal((await model.findOne({type}).lean()).comment,'legacy-'+type);
 console.log(JSON.stringify({result:'passed',realHttp:true,realMongo:true,driver:mongoose.version,calls,storedPublications:2,concurrentInstances:true,warningTypesRetained:[1,2,3,4],exact24hExpiry:true,provider:'synthetic; issue-reported metadata and precipitation, not full captured response'}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await close(server);await close(provider);await mongoose.disconnect();if(mongo)await mongo.stop();});
