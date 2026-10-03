/* #2183 real local Mongo + HTTP smoke; no server startup or live providers.
 * TZ=UTC NODE_PATH=<isolated deps> node server/test/offline/life-index-area-mongo-smoke.js
 * Requires mongoose 5.13.x (or mongoose-smoke alias), mongodb-memory-server-core,
 * async 2.x and express 4.x. Mongo 7 cannot use the historical 5.1 driver.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const async = require('async');
const express = require('express');
const {MongoMemoryServer} = require('mongodb-memory-server-core');
let mongoose;
try { mongoose = require('mongoose-smoke'); } catch (_) { mongoose = require('mongoose'); }
assert(/^5\.13\./.test(mongoose.version), 'use the isolated Mongo-compatible 5.13 driver');
const root = path.resolve(__dirname, '../..');
const time = require('../../lib/kmaTimeLib');
const logs = [];
const log = Object.fromEntries(['debug','info','warn','error','silly'].map(level =>
    [level, (...args) => logs.push({level, args})]));
function load(relative, deps) {
    const module = {exports: {}};
    vm.runInNewContext(fs.readFileSync(path.join(root, relative), 'utf8'), {
        module, exports: module.exports, Date, console, log,
        require: name => deps[name] || function () {}
    }, {filename: relative});
    return module.exports;
}
function get(port) {
    return new Promise((resolve, reject) => {
        const request = http.get({host: '127.0.0.1', port, path: '/weather'}, response => {
            let body = '';
            response.on('data', chunk => {body += chunk;});
            response.on('end', () => {
                try { assert.equal(response.statusCode, 200); resolve(JSON.parse(body)); }
                catch (err) { reject(err); }
            });
        });
        request.setTimeout(5000, () => request.destroy(new Error('local HTTP deadline')));
        request.on('error', reject);
    });
}
async function main() {
    let mongo, server;
    try {
        mongo = await MongoMemoryServer.create({binary: {version: '7.0.14'}});
        await mongoose.connect(mongo.getUri(), {useNewUrlParser: true, useUnifiedTopology: true, autoIndex: false});
        const Area = load('models/modelAreaNo.js', {mongoose});
        const Index = load('models/kma/kma.lifeindex.model.js', {mongoose});
        // Only the indexes used by this path; old empty-string town index types
        // are not accepted by Mongo 7 and are unrelated to the geographic lookup.
        await Area.collection.createIndex({geo: '2d'});
        await Index.collection.createIndex({areaNo: 1});
        await Area.insertMany([
            {areaNo: 4119700000, town: {first:'경기도',second:'부천시소사구',third:''},geo:[126.8,37.48]},
            {areaNo: 4119900000, town: {first:'경기도',second:'old',third:''},geo:[126.81,37.49]},
            {areaNo: 4119086000, town: {first:'경기도',second:'nearby',third:''},geo:[126.82,37.5]}
        ]);
        const row = (areaNo, indexType, index) => ({areaNo, indexType, index,
            date: time.convertStringToDate('20261003'), lastUpdateDate:'2026100306'});
        await Index.insertMany([row(4119700000,'flowerWeeds',1),row(4119086000,'ultrv',0),row(4119086000,'flowerWeeds',2)]);
        const Life = load('controllers/lifeIndexKmaController.js', {
            async, '../lib/kmaTimeLib': time, '../models/kma/kma.lifeindex.model': Index
        });
        let mfds = 0;
        const Town = load('controllers/controllerTown.js', {async, '../lib/kmaTimeLib':time,
            '../models/modelAreaNo':Area, '../controllers/lifeIndexKmaController':Life,
            '../lib/foodPoisoning':{shared:()=>({append:(region, days, now, cb)=>{mfds++;cb();}})}
        });
        const app = express();
        app.get('/weather', (req,res) => {
            req.sessionID = 'local-mongo-smoke';
            req.params = {region:'경기도',city:'부천시소사구',town:''};
            req.gCoord = {lon:126.81,lat:37.49};
            req.midData = {dailyData:[{date:'20261003',taMax:23}]};
            req.current = {date:'20261003',t1h:20};
            new Town().getLifeIndexKma(req,res,()=>res.json({areaNo:req.params.areaNo,current:req.current,midData:req.midData}));
        });
        server = await new Promise(resolve => {const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
        const port = server.address().port;
        const exact = await get(port);
        assert.equal(exact.areaNo,4119700000);
        assert.equal(exact.current.flowerWeeds,1);
        await Index.deleteMany({areaNo:4119700000});
        const nearby = await get(port);
        assert.equal(nearby.areaNo,4119086000);
        assert.equal(nearby.current.ultrv,0);
        assert.equal(nearby.current.flowerWeeds,2);
        assert.equal(nearby.current.pollenGrade,2);
        assert.equal(nearby.midData.dailyData[0].pollenGrade,2);
        await Index.deleteMany({});
        const missing = await get(port);
        assert.equal('ultrv' in missing.current,false);
        assert.equal('pollenGrade' in missing.current,false);
        assert.equal(missing.current.t1h,20);
        assert.equal(missing.midData.dailyData[0].taMax,23);
        assert.equal(mfds,3);
        assert.equal(logs.filter(x=>x.level==='warn').length,0);
        assert(logs.some(x=>x.args[0] && x.args[0].event==='life-index-area-fallback' && x.args[0].result==='resolved'));
        console.log(JSON.stringify({outcome:'passed',mongoose:mongoose.version,mongo:'7.0.14',scenarios:3,
            exactArea:exact.areaNo,nearbyArea:nearby.areaNo,zeroUv:nearby.current.ultrv,pollenGrade:nearby.current.pollenGrade,optionalWeatherContinues:true}));
    } finally {
        if (server) { await new Promise(resolve=>server.close(resolve)); }
        await mongoose.disconnect();
        if (mongo) { await mongo.stop(); }
    }
}
main().catch(err=>{console.error(err.stack);process.exitCode=1;});
