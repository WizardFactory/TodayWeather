/** Real loopback HTTP + Mongo + production schemas, collector, nation route and global chain.
 * Mongoose 5.13 is used only here: 5.1.2 wire protocol cannot connect to MongoDB >=5.1.
 * No app.js, production config, provider or collection endpoint is reachable.
 */
'use strict';
const assert=require('node:assert/strict'), http=require('node:http'), fs=require('node:fs'), path=require('node:path');
const {MongoMemoryServer}=require('mongodb-memory-server-core');
const mongoose=require('mongoose-smoke');
const express=require('express'), async=require('async');
const {createLoader,logger}=require('./air-harness');
const Api=require('../../lib/airkoreaObservation');
const root=path.resolve(__dirname,'../..');
const fixture=name=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/airkorea',name+'.json')));
const sockets=new Set(), logs=[];
let mongo, provider, appServer, mode='ok', observationCalls=0, globalCalls=0, activeGlobal=0, maxGlobal=0;
async function close(server) { if(server) await new Promise(r=>server.close(r)); }
const invoke=(obj,name,...args)=>new Promise((resolve,reject)=>obj[name](...args,(err,value)=>err?reject(err):resolve(value)));
(async()=>{
    mongo=await MongoMemoryServer.create({binary:{version:'7.0.14'},instance:{ip:'127.0.0.1'}});
    await mongoose.connect(mongo.getUri(),{useNewUrlParser:true,useUnifiedTopology:true});
    const modelLoader=createLoader({overrides:{mongoose}});
    const station=modelLoader.load('models/arpltnKeco.js'), sido=modelLoader.load('models/sido.arpltn.keco.model.js');
    const models={};
    for(const name of ['air.observation.cache.model','air.provider.usage.model','worldWeather/vc.usage.model','worldWeather/vc.fetch.lock.model']) {
        models['models/'+name+'.js']=modelLoader.load('models/'+name+'.js');
    }
    for(const model of [station,sido,...Object.values(models)]) await model.init();
    const now=new Date(), hour=new Date(now.getTime());hour.setUTCMinutes(0,0,0);
    const kst=new Date(hour.getTime()+9*3600000).toISOString().slice(0,16).replace('T',' ');
    provider=http.createServer((req,res)=>{
        req.resume();
        if(req.url.startsWith('/B552584/')) {
            observationCalls++;
            if(mode==='auth') {res.end(JSON.stringify({response:{header:{resultCode:'30',resultMsg:'synthetic-private-key'}}}));return;}
            if(mode==='timeout') return;
            const data=fixture(req.url.includes('ArpltnStatsSvc')?'sido':'stations');
            data.response.body.items.forEach(r=>r.dataTime=kst);
            res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;
        }
        if(req.url.startsWith('/v1/currentConditions:lookup')) {
            globalCalls++;activeGlobal++;maxGlobal=Math.max(maxGlobal,activeGlobal);
            setTimeout(()=>{
                activeGlobal--;
                res.setHeader('Content-Type','application/json');
                res.end(JSON.stringify({dateTime:hour.toISOString(),pollutants:[
                    {code:'pm10',concentration:{value:42,units:'MICROGRAMS_PER_CUBIC_METER'}},
                    {code:'pm25',concentration:{value:19,units:'MICROGRAMS_PER_CUBIC_METER'}}]}));
            },20);return;
        }
        res.statusCode=404;res.end();
    });
    provider.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
    await new Promise(r=>provider.listen(0,'127.0.0.1',r));
    const base='http://127.0.0.1:'+provider.address().port;
    const axios=require('axios').create();
    axios.interceptors.request.use(c=>{
        assert(c.url.startsWith('https://airquality.googleapis.com/'),'only configured global provider');
        return Object.assign(c,{url:c.url.replace('https://airquality.googleapis.com',base),proxy:false});
    });
    function Town() {} Town.prototype.checkQueryValidation=(req,res,next)=>next();
    const config={keyString:{google_key:'google-smoke-valid-key'},vc:{dailyRecordLimit:0},apiServer:{url:'http://unused.invalid'}};
    const l=createLoader({log:logger(logs),allowNodeModules:['https','url'],overrides:Object.assign({
        async,express,mongoose,axios,
        request:(url,opts,cb)=>setImmediate(()=>cb(null,{statusCode:200},{current:{t1h:20},airInfo:{},airInfoList:[]})),
        dnscache:()=>{},'config/config.js':config,
        'controllers/controllerTown24h.js':Town,
        'models/arpltnKeco.js':station,'models/sido.arpltn.keco.model.js':sido,
        'models/arpltnTownKeco.js':{},'models/modelMsrStnInfo.js':{},'models/modelMinuDustFrcst.js':{},
        'controllers/airkorea.hourly.forecast.controller.js':function(){},
        'utils/convertGeocode.js':{},'s3/controller.s3.js':function(){}
    },models)});
    const Keco=l.load('lib/kecoRequester.js'), collector=new Keco();
    collector._uploadS3=(value,cb)=>cb(); // S3 archival is outside this local Mongo smoke.
    collector.setServiceKeys(['synthetic-private-key']);collector._sidoList=['서울'];
    collector._observationApi=Api.create({transport:http,base:base+'/B552584/',timeoutMs:100});
    await invoke(collector,'getAllCtprvn');
    assert.equal(await station.countDocuments(),3);
    const aggregate=await sido.findOne({sidoName:'서울',cityName:''}).lean();
    assert.equal(aggregate.pm10Value,30);assert.equal(aggregate.pm25Value,15);
    assert.equal(aggregate.date.toISOString(),hour.toISOString());
    await invoke(collector,'getSidoCtprvn');
    assert(await sido.findOne({sidocityName:'서울/중구'}));
    const before=await station.countDocuments();mode='auth';
    await assert.rejects(invoke(collector,'getAllCtprvn'),/PARTIAL_COLLECTION/);
    assert.equal(await station.countDocuments(),before);mode='timeout';
    await assert.rejects(invoke(collector,'getAllCtprvn'),/PARTIAL_COLLECTION/);
    assert.equal(await station.countDocuments(),before);mode='ok';
    const route=l.load('routes/v000803/route.nation.js');
    const app=express();app.use((req,res,next)=>{req.version='v000903';next();});app.use('/v000903/nation',route);
    appServer=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
    const request=unit=>new Promise((resolve,reject)=>http.get('http://127.0.0.1:'+appServer.address().port+'/v000903/nation/KR?airUnit='+unit,res=>{
        let b='';res.on('data',c=>b+=c);res.on('end',()=>{try{assert.equal(res.statusCode,200);resolve(JSON.parse(b));}catch(e){reject(e);}});
    }).on('error',reject));
    const beforeRequest=observationCalls;
    const concurrent=await Promise.all([request('airkorea'),request('airkorea')]);
    const response=concurrent[0];
    assert.equal(concurrent[1].air.length,17,'concurrent callers share cache-fill work');
    assert.equal(response.air.length,17);assert.equal(response.weather.length,15);
    const seoul=response.air.find(a=>a.sidoName==='서울'),busan=response.air.find(a=>a.sidoName==='부산');
    assert.equal(seoul.pm10Value,30);assert.equal(seoul.pm25Value,15);assert.equal(seoul.pm10Grade,1);
    assert.equal(seoul.source,'airkorea');assert.equal(busan.source,'google');assert.equal(busan.pm25Grade,2);
    assert.equal(busan.coverage,'representative-point');assert.equal(globalCalls,16);assert(maxGlobal>1&&maxGlobal<=4);
    assert.equal(observationCalls,beforeRequest,'client nation reads must never call AirKorea API');
    assert.equal(await models['models/air.observation.cache.model.js'].countDocuments(),16);
    const again=await request('airkorea');assert.equal(again.air.length,17);assert.equal(globalCalls,16,'global cache reused');
    assert.equal(await sido.countDocuments({cityName:''}),1,'fallback never writes AirKorea province rows');
    const different=await request('aqicn');assert.equal(different.air.length,17);assert.equal(globalCalls,16);
    assert(!JSON.stringify(logs).includes('synthetic-private-key'));
    console.log(JSON.stringify({result:'passed',stationRows:before,provinceRows:1,nationRows:17,weatherRows:15,
        globalRequests:globalCalls,maxGlobalConcurrency:maxGlobal,clientAirKoreaRequests:observationCalls-beforeRequest,
        cacheRows:16,realMongo:true,mongoose:mongoose.version,observedAt:hour.toISOString()}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
    for(const socket of sockets)socket.destroy();
    await close(appServer);await close(provider);await mongoose.disconnect();if(mongo)await mongo.stop();
});
