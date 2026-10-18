'use strict';
// Real loopback HTTP + local MongoDB + legacy middleware + installed client chart code.
// Uses issue #2831's recorded fallback readings; production observations may recover.
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const {MongoMemoryServer} = require('mongodb-memory-server-core');
const mongoose = require('mongoose-smoke'); // 5.13: MongoDB 7 wire protocol, production schemas unchanged.
const {createLoader} = require('./air-harness');
const {harness} = require('./air-forecast-fallback-harness');
const {clientChart} = require('./air-forecast-fallback-smoke');
const NOW = '2026-10-18T15:43:00Z'; // Fixed after the captured 00:42 KST observation.
const captured = require('./fixtures/air/issue-2831-current-only.json');
const current = captured.last;
const output = process.env.TW_SMOKE_OUTPUT_DIR;
function get(url) {
    return new Promise((resolve,reject)=>http.get(url,res=>{
        let body='';res.setEncoding('utf8');res.on('data',c=>body+=c);
        res.on('end',()=>{try {assert.equal(res.statusCode,200);resolve(JSON.parse(body));}catch(e){reject(e);}});
    }).on('error',reject));
}
(async()=>{
    let mongo,server;
    const reports=[];
    try {
        mongo=await MongoMemoryServer.create({binary:{version:'7.0.14'},instance:{ip:'127.0.0.1'}});
        await mongoose.connect(mongo.getUri(),{useNewUrlParser:true,useUnifiedTopology:true});
        const loader=createLoader({allowNodeModules:['async'],overrides:{mongoose}});
        const stations=loader.load('models/modelMsrStnInfo.js');
        const observations=loader.load('models/arpltnKeco.js');
        const forecasts=loader.load('models/arpltn.hourly.forecast.js');
        const kaq=loader.load('models/kaq.hourly.forecast.model.js');
        const Base=loader.load('controllers/img.hourly.forecast.controller.js');
        class StoredAirkorea extends Base {constructor(){super(null,forecasts);}}
        class StoredKaq extends Base {constructor(){super(null,kaq);}}
        for(const model of [stations,observations,forecasts,kaq]) await model.init();
        await stations.create({stationName:'중구',geo:[126.98,37.56]});
        await observations.create({stationName:'중구',date:new Date('2026-10-18T01:00:00Z'),dataTime:'2026-10-18 10:00',pm10Value:20,pm25Value:10});
        const rows=['pm10','pm25'].flatMap(code=>Array.from({length:23},(_,i)=>({stationName:'중구',code,val:code==='pm10'?35:16,
            dataTime:'2026-10-19 '+String(i+1).padStart(2,'0')+':00',date:new Date(Date.parse('2026-10-18T15:00:00Z')+(i+1)*3600000),pubDate:'2026-10-18 05:00'})));
        await forecasts.insertMany(rows);
        const h=harness([],[],{now:NOW,stationModel:stations,observationModel:observations,
            airkoreaController:StoredAirkorea,kaqController:StoredKaq,
            fallback:{getArpltn(g,d,cb){cb(null,JSON.parse(JSON.stringify(current)));}}});
        h.detail._getTownInfo=(r,c,t,cb)=>cb(null,{gCoord:{lat:37.56,lon:126.98}});
        const app=express();
        app.get('/v000903/kma/addr/:region/:city/:town',
            (req,res,next)=>{req.current={};req.query.airUnit=req.query.airUnit||'airkorea';next();},h.detail.getKeco,h.detail.getAirFallback,
            (req,res,next)=>(req.query.flow==='single'?h.detail.makeAirInfo:h.detail.makeAirInfoList)(req,res,next),
            (req,res,next)=>{if(req.query.baseline)return next();(req.query.flow==='single'?h.detail.AirForecast:h.detail.AirForecastList)(req,res,next);},
            (req,res)=>res.json({airInfoList:req.airInfoList||[req.airInfo]}));
        server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
        const url='http://127.0.0.1:'+server.address().port+'/v000903/kma/addr/seoul/jung/myeong';
        const baseline=await get(url+'?baseline=1');
        const base=baseline.airInfoList[0];
        assert.equal(base.source,'openweather');assert.deepEqual(base.last,current);assert.equal(base.last.aqiValue,52);
        for(const code of ['pm10','pm25','aqi']) assert.equal(clientChart(base,code).data.filter(r=>r.date>base.last.dataTime&&Number.isFinite(r.val)).length,0);
        if(output){fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'current-only-replay.json'),JSON.stringify(baseline,null,2));}
        for(const flow of ['single','list']) for(const source of ['kaq','airkorea','omitted']) {
            const body=await get(url+'?flow='+flow+(source==='omitted'?'':'&airForecastSource='+source));
            const info=body.airInfoList[0];
            assert.deepEqual(info.last,base.last);assert.equal(info.source,base.source);
            assert.equal(info.last.stationName,undefined);assert.equal(info.forecastStationName,'중구');
            assert.equal(info.forecastSource,'airkorea');assert.equal(info.forecastPubDate,'2026-10-18 05:00');
            const counts={};
            for(const code of ['pm10','pm25','aqi']) {
                const future=info.pollutants[code].hourly.filter(r=>r.date>='2026-10-19 01:00');
                assert.equal(future.length,23);assert(future.every(r=>Number.isFinite(r.val)&&r.val>=0));
                if(code!=='aqi') for(const row of future){const stored=rows.find(x=>x.code===code&&x.dataTime===row.date);assert.equal(row.val,stored.val);assert.equal(row.pubDate,stored.pubDate);}
                counts[code]=clientChart(info,code).data.filter(r=>r.date>base.last.dataTime&&Number.isFinite(r.val)).length;
                assert(counts[code]>0,'numeric client future slots for '+code);
            }
            reports.push({flow,requestSource:source,currentSource:info.source,forecastSource:info.forecastSource,station:info.forecastStationName,publication:info.forecastPubDate,storedFutureRowsPerPM:23,chartFutureSlots:counts});
            if(output)fs.writeFileSync(path.join(output,flow+'-'+source+'.json'),JSON.stringify(body,null,2));
        }
        await forecasts.deleteMany({});
        const missing=(await get(url+'?airForecastSource=kaq')).airInfoList[0];
        assert.deepEqual(missing.last,base.last);assert.equal(missing.forecastSource,undefined);
        await stations.deleteMany({});
        const noStation=(await get(url+'?airForecastSource=kaq')).airInfoList[0];
        assert.deepEqual(noStation.last,base.last);assert.equal(noStation.forecastStationName,undefined);
        console.log(JSON.stringify({outcome:'passed',runtime:process.version,clock:NOW,integration:'real loopback HTTP, MongoDB 7, production station/observation schemas and stored reader, legacy middleware/chart code',baselineProvenance:'actual captured OpenWeather airInfo from coordinate-provider route, replayed through stale domestic middleware; see fixture provenance',scenarios:reports},null,2));
    } finally {
        if(server)await new Promise(resolve=>server.close(resolve));
        await mongoose.disconnect();if(mongo)await mongo.stop();
    }
})().catch(e=>{console.error(e);process.exitCode=1;});
