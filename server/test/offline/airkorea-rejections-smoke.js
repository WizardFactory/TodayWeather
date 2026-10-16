/** Real loopback HTTP + disposable Mongo; no app startup, provider or production storage.
 * Recorded observation values/times stay unchanged. Reduced station fixtures use synthetic envelope
 * counts; the eight unaffected provinces use a relabeled Seoul control. Zero-total pages stay exact.
 */
'use strict';
const assert = require('node:assert/strict'), http = require('node:http');
const mongoose = require('mongoose-smoke'), express = require('express'), async = require('async');
const {MongoMemoryServer} = require('mongodb-memory-server-core');
const {createLoader, logger} = require('./air-harness');
const Api = require('../../lib/airkoreaObservation');
const records = require('./fixtures/airkorea/rejections-20261016.json').records;
const invoke = (obj, name, ...args) => new Promise((resolve, reject) => obj[name](...args, (err, value) => err ? reject(err) : resolve(value)));
const clone = x => JSON.parse(JSON.stringify(x));
const clock = new Date('2026-10-15T23:30:00Z');
class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.getTime()])); }
    static now() { return clock.getTime(); }
}
let mongo, provider, appServer, calls = 0, fallbackCalls = 0, mode = 'ok';
const sockets = new Set(), logs = [], outcomes = [];
const close = s => s && new Promise(resolve => s.close(resolve));
function get(url) {
    return new Promise((resolve, reject) => http.get(url, res => {
        let body = ''; res.on('data', c => body += c);
        res.on('end', () => { try { assert.equal(res.statusCode, 200); resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject));
}
(async () => {
    mongo = await MongoMemoryServer.create({binary: {version: '7.0.14'}, instance: {ip: '127.0.0.1'}});
    await mongoose.connect(mongo.getUri(), {useNewUrlParser: true, useUnifiedTopology: true});
    const models = createLoader({overrides: {mongoose}});
    const station = models.load('models/arpltnKeco.js'), sido = models.load('models/sido.arpltn.keco.model.js');
    await station.init(); await sido.init();
    const names = station.getCtprvnSidoList(), batches = {};
    for (const name of names) {
        const source = records.filter(r => r.sido === name && r.operation === Api.STATION);
        const pages = (source.length ? source : records.filter(r => r.sido === '서울')).map(clone);
        pages.forEach(r => {
            r.response.body.items.forEach(x => x.sidoName = name);
            if (r.projection !== 'Full page cardinality') r.response.body.totalCount = r.response.body.items.length;
        });
        batches[name] = pages;
    }
    provider = http.createServer((req, res) => {
        req.resume(); calls++;
        const u = new URL(req.url, 'http://127.0.0.1'), name = u.searchParams.get('sidoName'), page = Number(u.searchParams.get('pageNo'));
        assert.equal(u.pathname, '/B552584/ArpltnInforInqireSvc/' + Api.STATION);
        if (mode === 'terminal-failure' && page === 2) { res.statusCode = 503; res.end('{}'); return; }
        const r = batches[name].find(x => x.requestedPage === page); assert(r, 'unexpected page');
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({response: r.response}));
    });
    provider.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
    function Town() {} Town.prototype.checkQueryValidation = (req, res, next) => next();
    const loader = createLoader({log: logger(logs), globals: {Date: Clock}, allowNodeModules: ['https', 'url'], overrides: {
        async, express, mongoose, dnscache: () => {},
        request: (url, opts, cb) => setImmediate(() => cb(null, {statusCode: 200}, {current: {t1h: 20}, airInfo: {}, airInfoList: []})),
        'config/config.js': {apiServer: {url: 'http://unused.invalid'}},
        'models/arpltnKeco.js': station, 'models/sido.arpltn.keco.model.js': sido,
        'models/arpltnTownKeco.js': {}, 'models/modelMsrStnInfo.js': {}, 'models/modelMinuDustFrcst.js': {},
        'controllers/airkorea.hourly.forecast.controller.js': function () {},
        'controllers/controllerTown24h.js': Town, 'utils/convertGeocode.js': {}, 's3/controller.s3.js': function () {},
        'lib/AQI/airFallback.js': {getArpltn(coord, now, cb) { fallbackCalls++; cb(null, undefined, 'no-provider'); }}
    }});
    const Keco = loader.load('lib/kecoRequester.js'), collector = new Keco();
    const reader = loader.load('controllers/kecoController.js');
    collector._uploadS3 = (value, cb) => cb(); collector.setServiceKeys(['synthetic']);
    collector._emitOutcome = r => outcomes.push(r);
    collector._observationApi = Api.create({transport: http, base: 'http://127.0.0.1:' + provider.address().port + '/B552584/'});
    await sido.create({sidocityName: '인천/도시대조', sidoName: '인천', cityName: '도시대조', date: clock, dataTime: '2026-10-16 08:00', pm10Value: 999, pm25Value: 999});
    assert.equal((await invoke(reader, 'getSidoArpltn')).length, 0, 'city-only rows cannot satisfy nation');
    mode = 'terminal-failure';
    await assert.rejects(invoke(collector, 'getAllCtprvn', ['광주']), /PARTIAL_COLLECTION/);
    assert.equal(await station.countDocuments(), 0); assert.equal(await sido.countDocuments({cityName: ''}), 0);
    mode = 'ok'; await invoke(collector, 'getAllCtprvn', names);
    assert.equal(await sido.countDocuments({cityName: ''}), 17);
    const direct = await invoke(reader, 'getSidoArpltn'); assert.equal(direct.length, 17);
    const route = loader.load('routes/v000803/route.nation.js');
    const app = express(); app.use((req, res, next) => { req.version = 'v000903'; next(); }); app.use('/v000903/nation', route);
    appServer = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const before = calls, response = await get('http://127.0.0.1:' + appServer.address().port + '/v000903/nation/KR?airUnit=airkorea');
    assert.deepEqual(response.air.map(r => r.sidoName).sort(), Array.from(names).sort());
    for (const name of names) {
        const input = batches[name][0].response.body.items;
        const times = input.filter(x => x.mangName === '도시대기' && x.dataTime !== null).map(x => x.dataTime).sort();
        const time = times[times.length - 1], urban = input.filter(x => x.mangName === '도시대기' && x.dataTime === time);
        const row = response.air.find(r => r.sidoName === name), stored = direct.find(r => r.sidoName === name);
        for (const key of ['pm10Value', 'pm25Value']) {
            const values = urban.map(x => x[key]).filter(x => /^\d+(?:\.\d+)?$/.test(String(x))).map(Number);
            assert(values.length); const expected = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
            assert.equal(row[key], expected); assert.equal(stored[key], expected);
            const grade = key === 'pm10Value' ? (expected <= 30 ? 1 : expected <= 80 ? 2 : expected <= 150 ? 3 : 4) :
                (expected <= 15 ? 1 : expected <= 35 ? 2 : expected <= 75 ? 3 : 4);
            assert.equal(row[key.replace('Value', 'Grade')], grade);
        }
        assert.equal(row.dataTime, time); assert.equal(stored.date.toISOString(), new Date(Api.kstInstant(time)).toISOString());
        assert.equal(row.source, 'airkorea'); assert.equal(row.coverage, 'province-average');
        for (const missing of input.filter(x => x.dataTime === null)) {
            assert.equal(await station.countDocuments({stationName: missing.stationName}), 0);
            assert(outcomes.find(x => x.sido === name && x.outcome === 'success').unavailable.includes(missing.stationName));
        }
    }
    assert.equal(fallbackCalls, 0); assert.equal(calls, before);
    console.log(JSON.stringify({result: 'passed',realMongo: true, realHttp: true, directProvinceRows: direct.length,
        nationRows: response.air.length, stationRows: await station.countDocuments(), fallbackCalls,
        cityOnlyRejected: true, failedTerminalWrites: 0, recordedProvinces: 9, syntheticControlProvinces: 8,
        observationClock: clock.toISOString()}));
})().catch(err => { console.error(err); process.exitCode = 1; }).finally(async () => {
    for (const s of sockets) s.destroy();
    await close(appServer); await close(provider); await mongoose.disconnect(); if (mongo) await mongo.stop();
});
