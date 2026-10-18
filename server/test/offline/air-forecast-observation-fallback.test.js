'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {harness, row} = require('./air-forecast-fallback-harness');
const current = () => ({source:'openweather', dataTime:'2026-09-24 09:00', pm10Value:22.36, pm25Value:12.34,
    attribution:{name:'OpenWeather', url:'https://openweathermap.org/'}});
const invoke = (fn, req) => new Promise(resolve => fn(req, {}, resolve));
function stationModel(rows, error) {
    const queries=[];
    return {queries, find(query) { queries.push(query); const q={limit(n){assert.equal(n,6);return q;},lean(){return q;},exec(cb){cb(error, rows);}};return q; }};
}
for (const method of ['AirForecast','AirForecastList']) {
    for (const source of ['kaq','airkorea',undefined]) {
        test(method+' enriches OpenWeather using nearby metadata, source '+source, async () => {
            const model=stationModel([{stationName:'중구',geo:[126.978,37.56]}]);
            const h=harness([], [row(),row({code:'pm25',val:14})], {stationModel:model, fallback:{getArpltn(g,d,cb){cb(null,current());}}});
            h.keco._getArpLtnList=(stations, date, cb)=>cb(null,[[{stationName:'중구',dataTime:'2026-09-23 10:00',pm10Value:20}]]);
            h.detail._getTownInfo=(r,c,t,cb)=>cb(null,{gCoord:{lon:126.978,lat:37.56}});
            const req={params:{},query:{airUnit:'airkorea',airForecastSource:source},current:{}};
            await invoke(h.detail.getKeco,req);
            assert.equal(req.current.arpltn && req.current.arpltn.pm10Value,undefined,'stale observation rejected');
            await invoke(h.detail.getAirFallback,req);
            assert.equal(req.current.arpltn.pm10Value,22.36);
            await invoke(method==='AirForecast'?h.detail.makeAirInfo:h.detail.makeAirInfoList,req);
            const info=method==='AirForecast'?req.airInfo:req.airInfoList[0];
            const before=JSON.stringify(info.last);
            await invoke(h.detail[method],req);
            assert.equal(info.source,'openweather');assert.equal(JSON.stringify(info.last),before);
            assert.equal(info.last.stationName,undefined);
            assert.equal(info.forecastStationName,'중구');assert.equal(info.forecastSource,'airkorea');
            for(const code of ['pm10','pm25','aqi']) assert(info.pollutants[code].hourly.some(r=>r.date==='2026-09-24 10:00'&&Number.isFinite(r.val)));
            assert(h.calls.every(c=>c.station==='중구'));
            assert.deepEqual(JSON.parse(JSON.stringify(model.queries[0])),{geo:{$near:[126.978,37.56],$maxDistance:1}});
        });
    }
}
test('metadata identity survives no observations and ignores missing names',async()=>{
    for(const stations of [[],[{}],[{stationName:' '}],[{}, {stationName:'종로구'}]]) {
        const h=harness([],[],{stationModel:stationModel(stations)});
        h.keco._getArpLtnList=(s,d,cb)=>cb(null,[]);
        const result=await new Promise(resolve=>h.keco.getArpLtnInfo({gCoord:{lon:126.98,lat:37.56}},new Date(),(err,value)=>resolve({err,value})));
        assert.ifError(result.err);
        assert.equal(result.value.forecastStationName,stations.length===2?'종로구':undefined);
    }
});
function info() { const last=current(); return {source:last.source,last,pollutants:{pm10:{hourly:[{date:last.dataTime,val:last.pm10Value}]},pm25:{hourly:[{date:last.dataTime,val:last.pm25Value}]}}}; }
test('coordinate provider identity is never used as AirKorea station',async()=>{
    for(const source of ['openweather','google','visualcrossing','aqicn']) {
        const h=harness([], [row()]),air=info();air.source=source;air.last.stationName='provider location';
        assert.ifError((await h.get(air)).error);assert.equal(h.calls.length,0);assert.equal(air.forecastSource,undefined);
    }
});
for(const source of ['kaq','airkorea']) {
    test(source+' invalid/expired rows do not attach metadata, partial rows do',async()=>{
        for(const rows of [[],[null],[row({val:Infinity})],[row({val:'30'})],[row({val:-1})],[row({dataTime:'2026-02-30 10:00'})],[row({dataTime:'2026-09-24 09:00'})],[row({dataTime:'2026-09-25 10:00'})]]) {
            const air=info(),before=JSON.stringify(air),h=harness(rows,rows);
            assert.ifError((await h.get(air,source,'중구')).error);assert.equal(JSON.stringify(air),before);
        }
        const air=info(),h=harness([row({code:'pm25',val:0}),null],[row({val:99})]);
        assert.ifError((await h.get(air,source,'중구')).error);
        assert.equal(air.forecastSource,source);assert(Number.isFinite(air.pollutants.aqi.hourly[0].val));
    });
}
test('fallback horizon uses request hour, not earlier observation; keeps current and daily bulletin',async()=>{
    const air=info();air.last.dataTime='2026-09-24 02:00';air.pollutants.pm10.daily=[{date:'2026-09-24',val:20}];
    const h=harness([], [row({dataTime:'2026-09-25 09:00'}),row({dataTime:'2026-09-25 09:01'})]);
    assert.ifError((await h.get(air,'kaq','중구')).error);
    assert.deepEqual(air.pollutants.pm10.hourly.filter(r=>r.date>'2026-09-24 09:10').map(r=>r.date),['2026-09-25 09:00']);
    assert.equal(air.pollutants.pm10.daily[0].val,20);
});
test('missing last or station and read errors remain safe',async()=>{
    const h=harness(new Error('kaq down'),new Error('store down'));
    for(const air of [undefined,{}, {source:'airkorea'},info()]) assert.ifError((await h.get(air)).error);
    const air=info(),before=JSON.stringify(air);
    const result=await h.get(air,'kaq','중구');assert.match(result.error.message,/store down/);assert.equal(JSON.stringify(air),before);
});

test('only displayed forecast publications describe hourly enrichment',async()=>{
    const air=info(),h=harness([], [row(),row({dataTime:'2026-09-26 10:00',pubDate:'2030-01-01 00:00'})]);
    assert.ifError((await h.get(air,'airkorea','중구')).error);
    assert.equal(air.forecastPubDate,row().pubDate);
    assert.equal(air.pollutants.aqi.hourly[0].pubDate,row().pubDate);
});
test('metadata store error leaves fallback current-only and calls next once',async()=>{
    const h=harness([], [row()], {stationModel:stationModel(undefined,new Error('metadata down')),fallback:{getArpltn(g,d,cb){cb(null,current());}}});
    h.detail._getTownInfo=(r,c,t,cb)=>cb(null,{gCoord:{lat:37.56,lon:126.98}});
    const req={params:{},query:{airUnit:'airkorea'},current:{}};
    let count=0;await new Promise(resolve=>h.detail.getKeco(req,{},()=>{count++;resolve();}));
    assert.equal(count,1);await invoke(h.detail.getAirFallback,req);await invoke(h.detail.makeAirInfoList,req);await invoke(h.detail.AirForecastList,req);
    assert.equal(req.airInfoList[0].source,'openweather');assert.equal(h.calls.length,0);
});
test('observation store error calls back instead of dereferencing missing rows',async()=>{
    const model={find(){const q={sort(){return q;},lean(){return q;},exec(cb){cb(new Error('observation down'));}};return q;}};
    const h=harness([],[],{observationModel:model});
    const result=await new Promise(resolve=>h.keco._getArpLtnList([{stationName:'중구'}],new Date(),error=>resolve(error)));
    assert.match(result.message,/observation down/);
});
test('every coordinate provider keeps current identity while valid KAQ wins at verified station',async()=>{
    for(const source of ['openweather','google','visualcrossing','aqicn']) {
        const air=info();air.source=source;air.last.source=source;air.last.stationName='provider location';
        const before=JSON.stringify(air.last),h=harness([row({code:'pm25',val:0})],[row({val:99})]);
        assert.ifError((await h.get(air,'kaq','중구')).error);
        assert.equal(air.source,source);assert.equal(JSON.stringify(air.last),before);
        assert.equal(air.forecastSource,'kaq');assert.equal(air.forecastStationName,'중구');assert.equal(h.calls.length,1);
    }
});
