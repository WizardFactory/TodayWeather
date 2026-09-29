/* #2634: real Mongo persistence + loopback HTTP + full overseas route + web normalization.
 * Use a dedicated local Mongo process. Creates/drops ONLY uv2634_<pid>_<timestamp>.
 * NODE_PATH=<mongoose 5.1.2, async, express, typescript> TW_UV_MONGO_URL=mongodb://127.0.0.1:PORT \
 * TZ=UTC node server/test/offline/overseas-uv-smoke.js
 * Provider weather fixture is recorded; added UV values are synthetic. No paid/provider HTTP.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const mongoose = require('mongoose');
const {createHarness, setNow} = require('./vc-weather-smoke');
const {withDayBefore} = require('./vc-synthetic');
const root = path.resolve(__dirname, '../..');
const at = Date.parse('2026-09-26T07:04:30Z');
const place = {name:'Tokyo',lat:35.69,lon:139.692,zone:'Asia/Tokyo',offset:540};
const uri = process.env.TW_UV_MONGO_URL;
assert(uri && /^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(uri), 'dedicated loopback Mongo URL required, no production DB');
const database = 'uv2634_' + process.pid + '_' + Date.now();
const Model = require(path.join(root,'models/worldWeather/dsf.model'));
function fixture() {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/vc-tokyo-combined.json')));
    raw.currentConditions.uvindex = 0;
    raw.days.forEach(d => { d.uvindex = 7; d.hours.forEach(h => { h.uvindex = 1; }); });
    return withDayBefore(raw);
}
// Harness clock is a Date subclass; normalize it to the plain Date production stores in Mixed paths.
function nativeDates(value) {
    if (Object.prototype.toString.call(value) === '[object Date]') return new Date(+value);
    if (Array.isArray(value)) return value.map(nativeDates);
    if (value && typeof value === 'object') return Object.keys(value).reduce((o,k)=>{o[k]=nativeDates(value[k]);return o;},{});
    return value;
}
const storage = {
    find: q => Model.find(nativeDates(q)),
    update: (q,doc,opts,cb) => Model.update(nativeDates(q),nativeDates(doc),opts,cb),
    remove: q => Model.remove(nativeDates(q))
};
const fetch = url => new Promise((resolve,reject)=>http.get(url,res=>{
    let data='';res.on('data',d=>{data+=d;});res.on('end',()=>{
        try {assert.equal(res.statusCode,200);resolve(JSON.parse(data));}catch(e){reject(e);}
    });
}).on('error',reject));
function webNormalize(raw) {
    const ts = require('typescript');
    const file = path.join(root,'../packages/weather-core/src/index.ts');
    const js = ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
    const mod={exports:{}};vm.runInNewContext(js,{module:mod,exports:mod.exports,require,console,URL},{filename:file});
    return mod.exports.normalizeWeather(raw);
}
(async()=>{
    let server;
    try {
        await mongoose.connect(uri.replace(/\/$/,'')+'/'+database);
        setNow(at);
        const h=createHarness(fixture,{models:{'dsf.model':storage}});
        server=http.createServer((req,res)=>{
            h.request('v000903',place,{}).then(body=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));},e=>{res.statusCode=500;res.end(JSON.stringify({error:e.message}));});
        });
        await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
        const url='http://127.0.0.1:'+server.address().port+'/weather/v000903/coord/35.69,139.692';
        const first=await fetch(url);
        assert.equal(first.thisTime[1].uvIndex,0);
        first.daily.forEach(d=>assert.equal(d.uvIndex,7));
        const stored=await Model.find({}).lean().exec();
        assert(stored.length>=3);
        assert(stored.some(d=>d.data.current.uvIndex===0));
        stored.forEach(d=>d.data.daily.data.forEach(r=>assert.equal(r.uvIndex,7)));
        const second=await fetch(url);
        assert.equal(h.providerCalls.length,1,'real DB cache hit does not refetch');
        assert.equal(second.thisTime[1].uvIndex,0);
        const web=webNormalize(second);
        assert(web.current.uv.includes('(0)'), 'web displays valid zero');
        assert(web.daily.length>=9);
        web.daily.forEach(d=>assert(d.uv.includes('(7)'),'web daily UV'));
        // Exercise real documents from before rollout: omit optional fields and serve cached weather.
        for (const record of stored) {
            delete record.data.current.uvIndex;
            record.data.hourly.data.forEach(r=>delete r.uvIndex);
            record.data.daily.data.forEach(r=>delete r.uvIndex);
            await Model.collection.replaceOne({_id:record._id},record);
        }
        const old=await fetch(url);
        old.thisTime.concat(old.daily).forEach(row=>['uvIndex','ultrv','ultrvGrade','ultrvStr'].forEach(k=>assert(!Object.prototype.hasOwnProperty.call(row,k))));
        assert.equal(h.providerCalls.length,1,'old cache is not forcibly invalidated');
        console.log(JSON.stringify({outcome:'passed',database,storedRecords:stored.length,httpRequests:3,providerCalls:h.providerCalls.length,currentUv:0,dailyUv:7,webCurrent:web.current.uv,legacyUv:'absent',provider:'recorded weather + synthetic UV',mongoose:mongoose.version}));
    } finally {
        if(server) await new Promise(resolve=>server.close(resolve));
        if(mongoose.connection.readyState===1) await mongoose.connection.db.dropDatabase();
        await mongoose.disconnect();
    }
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
