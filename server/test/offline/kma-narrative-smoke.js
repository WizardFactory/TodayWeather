/** Synthetic loopback provider -> real Mongo -> existing weather/nation/special HTTP paths. */
'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs');
const mongoose=require('mongoose-smoke'),express=require('express'),async=require('async'),request=require('request');
const {MongoMemoryServer}=require('mongodb-memory-server-core');
const {createLoader,logger}=require('./air-harness');
let mongo,provider,server,providerCalls=0,mode='ok',publication='202610161700';
let clock=Date.parse('2026-10-17T00:00:00Z');
class Clock extends Date {constructor(...a){super(...(a.length?a:[clock]));}static now(){return clock;}}
const prose='○ 18일 비\r\n* 예상 강수량: 30~80mm\r\n<img src=x onerror="alert(1)"> & 안내';
const invoke=(o,m,...a)=>new Promise((resolve,reject)=>o[m](...a,(e,r)=>e?reject(e):resolve(r)));
const listen=s=>new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',()=>resolve(s));});
const close=s=>s&&new Promise(resolve=>s.close(resolve));
const get=(url,status=200)=>new Promise((resolve,reject)=>http.get(url,r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{try{assert.equal(r.statusCode,status);resolve({body:status===200?JSON.parse(b):b,cache:r.headers['cache-control'],contentType:r.headers['content-type']});}catch(e){reject(e);}});}).on('error',reject));
(async()=>{
 mongo=await MongoMemoryServer.create({binary:{version:'7.0.14',systemBinary:process.env.TW_MONGOD||process.env.MONGOMS_SYSTEM_BINARY},instance:{ip:'127.0.0.1'}});
 await mongoose.connect(mongo.getUri(),{useNewUrlParser:true,useUnifiedTopology:true});
 const modelLoader=createLoader({overrides:{mongoose}});
 const model=modelLoader.load('models/modelKmaForecastNarrative.js'),warnings=modelLoader.load('models/modelKmaSpecialWeatherSituation.js');
 await model.init();await warnings.init();
 for(const type of [1,2,3,4])await warnings.create({type,announcement:new Date('2026-10-17T08:30:00Z'),comment:'legacy-'+type});
 const logs=[],config={keyString:{},apiServer:{url:''}},noop=(req,res,next)=>next();
 const overrides={async,request,express,mongoose,'config/config.js':config,
  'models/modelKmaForecastNarrative.js':model,'models/modelKmaSpecialWeatherSituation.js':warnings,
  'lib/kmaWarningZones.js':{},'models/modelKmaSpecialWeatherZone.js':{},
  'controllers/controllerTown.js':function(){},'lib/kmaTimeLib.js':{},'lib/kmaPrecipitation.js':{},'lib/history/observations.js':{},
  'lib/unitConverter.js':{getUnitList:()=>['temperatureUnit'],getDefaultValue:()=> 'C'},'lib/aqi.converter.js':{},
  'controllers/kecoController.js':{recalculateValue(){}},'controllers/airkorea.hourly.forecast.controller.js':function(){},
  'controllers/kaq.hourly.forecast.controller.js':function(){},'lib/AQI/airFallback.js':{},
  'lib/air/nationAir.js':{getAir(cb){cb(null,[{sidoName:'서울',pm10Value:12}],{source:'fixture'});}}};
 const loader=createLoader({log:logger(logs),globals:{Date:Clock},overrides});
 const Town=loader.load('controllers/controllerTown24h.js');
 // Preserve changed response assembly/sending; isolate unrelated weather acquisition/enrichment.
 overrides['controllers/controllerTown24h.js']=function(){
  const town=new Town();return new Proxy(town,{get(o,k){
   if(['checkQueryValidation','makeResult','sendResult'].includes(k))return o[k];
   if(k==='coord2addr')return (req,res,next)=>{req.params.region='서울특별시';req.params.city='중구';req.gCoord={lat:37.5665,lon:126.978};next();};
   return noop;
  }});
 };
 provider=await listen(http.createServer((req,res)=>{
  providerCalls++;const u=new URL(req.url,'http://127.0.0.1'),station=Number(u.searchParams.get('stnId'));assert.equal(u.pathname,'/getWthrSituation');assert.equal(u.searchParams.get('pageNo'),'1');
  const reject=mode==='quota'||u.searchParams.get('serviceKey').startsWith('rejected');
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({response:{header:{resultCode:reject?'22':mode==='no-data'?'03':'00'},body:{items:{item:[{stnId:station,tmFc:publication,wfSv1:'office '+station+'\r\n'+prose,wn:'ignored',wr:'ignored'}]}}}}));
 }));
 const Requester=loader.load('lib/kmaWarningRequester.js'),Narrative=loader.load('lib/kmaForecastNarrative.js'),Collector=loader.load('lib/kmaWarningCollector.js');
 const requester=new Requester({keys:['rejected'+'x'.repeat(40),'approved'+'x'.repeat(40)],baseUrl:'http://127.0.0.1:'+provider.address().port+'/',strict:true});
 const n=new Narrative({requester,model}),collector=new Collector({requester});collector.narrative=n;
 collector._specialStep=(r,cb)=>cb();collector._resyncStep=(r,cb)=>cb();collector._bulletinStep=(o,t,b,r,cb)=>cb();
 const gather=n.gather.bind(n);let batch;
 const completed=new Promise((resolve,reject)=>{batch=(e,v)=>e?reject(e):resolve(v);});
 n.gather=cb=>gather((e,v)=>{cb(e,v);batch(e,v);});
 const warningResult=await new Promise(resolve=>collector.gather(resolve));assert.equal(warningResult,'skip');await completed;n.gather=gather;
 assert.equal(providerCalls,11);assert.equal(await model.countDocuments(),10);assert.equal(await warnings.countDocuments(),4);
 await invoke(n,'gather');assert.equal(await model.countDocuments(),10);
 const app=express();app.use((req,res,next)=>{res.__=s=>s;req.result={existing:'preserved',current:{t1h:12},units:{temperatureUnit:'C'}};next();});
 app.use('/v000903/kma',loader.load('routes/v000903/route.kma.v000903.js'));
 app.use('/v000901/kma/addr',loader.load('routes/v000901/route.kma.addr.js'));
 app.use('/v000902/kma',loader.load('routes/v000902/route.kma.v000902.js'));
 app.use('/v000903/nation',loader.load('routes/v000803/route.nation.js'));
 server=await listen(http.createServer(app));const origin='http://127.0.0.1:'+server.address().port;config.apiServer.url=origin;
 const weather=(region,version='v000903')=>get(origin+'/'+version+'/kma/addr/'+encodeURIComponent(region)+'?temperatureUnit=F');
 const cases={서울특별시:109,인천광역시:109,경기도:109,부산광역시:159,울산광역시:159,경상남도:159,대구광역시:143,경상북도:143,광주광역시:156,전라남도:156,전북특별자치도:146,대전광역시:133,세종특별자치시:133,충청남도:133,충청북도:131,강원특별자치도:105,제주특별자치도:184};
 let regional;
 for(const [region,id] of Object.entries(cases)){
  const r=await weather(region);assert(r.body.forecastNarrative,region+' '+JSON.stringify(r.body)+' '+JSON.stringify(logs.slice(-5)));assert.equal(r.body.forecastNarrative.stationId,id,region);assert.equal(r.body.existing,'preserved');assert.equal(r.body.current.t1h,12);assert.equal(r.body.units.temperatureUnit,'F');assert.match(r.contentType,/application\/json/);assert.equal(r.body.forecastNarrative.text,'office '+id+'\n'+prose.replace(/\r/g,''));assert.equal(r.body.forecastNarrative.textFormat,'plain');assert.equal(r.body.forecastNarrative.announcement,'2026-10-16T08:00:00.000Z');if(id===109)regional=r.body;
 }
 for(const version of ['v000901','v000902'])assert.equal((await weather('경기도',version)).body.forecastNarrative.stationId,109);
 const coord=await get(origin+'/v000903/kma/coord/37.56,126.97');assert.equal(coord.body.forecastNarrative.stationId,109);assert.equal(coord.body.regionName,'서울특별시');assert.equal(coord.body.location.lat,37.566);
 const national=await get(origin+'/v000903/nation/KR');assert.equal(national.body.forecastNarrative.stationId,108);assert.equal(national.body.weather.length,15);assert.equal(national.body.air.length,1);assert(national.body.weather.every(x=>!x.forecastNarrative&&x.existing==='preserved'));
 for(const region of ['Tokyo','광주시'])assert.equal((await weather(region)).body.forecastNarrative,undefined);
 assert.equal((await get(origin+'/v000903/nation/US')).body.forecastNarrative,undefined);
 const special=await get(origin+'/v000903/kma/special');assert.deepEqual(special.body.map(x=>x.type),[4,1,2,3]);
 await get(origin+'/v000903/kma/forecast-narrative',404);
 if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify({environment:'Isolated HTTP/request + Mongo; synthetic prose and unrelated weather collaborators',national:national.body,regional,special:special.body},null,2)+'\n');
 publication='202610170500';await Promise.all([invoke(n,'gather'),invoke(new Narrative({requester,model}),'gather')]);assert.equal(await model.countDocuments(),20);for(const id of [108,109,105,184])assert.equal(await model.countDocuments({stationId:id}),2);
 let r=await weather('서울특별시');assert.equal(r.body.forecastNarrative.announcement,'2026-10-16T20:00:00.000Z');
 mode='quota';let before=providerCalls;await assert.rejects(invoke(n,'gather'),/collection failed/);assert.equal(providerCalls-before,20);assert.equal(await model.countDocuments(),20);
 mode='no-data';await invoke(n,'gather');assert.equal(await model.countDocuments(),20);
 const find=model.find;model.find=()=>{throw new Error('private database detail');};r=await weather('서울특별시');assert.equal(r.body.forecastNarrative,undefined);assert.equal(r.body.existing,'preserved');model.find=find;
 clock=Date.parse('2026-10-17T19:59:58Z');r=await weather('서울특별시');assert.equal(r.cache,'max-age=2');
 clock=Date.parse('2026-10-17T20:00:00Z');assert.equal((await weather('서울특별시')).body.forecastNarrative,undefined);assert.equal((await get(origin+'/v000903/nation/KR')).body.forecastNarrative,undefined);
 for(const type of [1,2,3,4])assert.equal((await warnings.findOne({type}).lean()).comment,'legacy-'+type);
 assert(!JSON.stringify(logs).includes('private database detail'));
 console.log(JSON.stringify({result:'passed',realHttp:true,realMongo:true,driver:mongoose.version,providerCalls,storedPublications:20,officeCount:10,provinces:17,versions:['v000901','v000902','v000903'],concurrentInstances:true,unchangedSpecialTypes:[4,1,2,3],exact24hExpiry:true,provider:'synthetic; no live regional access claimed'}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await close(server);await close(provider);await mongoose.disconnect();if(mongo)await mongo.stop();});
