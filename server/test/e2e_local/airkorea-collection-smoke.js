/** #2636 real collection smoke: the actual AirKorea API (apis.data.go.kr B552584) with the operator's
 * AIRKOREA_SECRET_KEYS, an in-memory MongoDB and the production schemas, collector and read controller.
 * It writes only to the in-memory database and makes about 20 read-only AirKorea calls.
 * No app.js, production config, S3, geocoder or production database is reachable.
 *
 * Prerequisites: AIRKOREA_SECRET_KEYS (JSON array) in the environment, network access, and NODE_PATH with
 * async, mongoose-smoke@npm:mongoose@5.13.23 and mongodb-memory-server-core@10.1.4.
 *   node -r dotenv/config server/test/e2e_local/airkorea-collection-smoke.js dotenv_config_path=server/.env
 * Output is a JSON summary without keys, URLs or provider bodies.
 */
'use strict';
const assert = require('node:assert/strict');
const {MongoMemoryServer} = require('mongodb-memory-server-core');
const mongoose = require('mongoose-smoke');
const async = require('async');
const {createLoader, logger} = require('../offline/air-harness');

const keys = JSON.parse(process.env.AIRKOREA_SECRET_KEYS || '[]');
const provinces = ['서울', '부산'];
const logs = [], hourlyForecastRuns = [];
const invoke = (obj, name, ...args) => new Promise((resolve, reject) =>
    obj[name](...args, (err, value) => err ? reject(err) : resolve(value)));
const elapsed = start => Date.now() - start;
let mongo;

(async () => {
    assert(Array.isArray(keys) && keys.length, 'AIRKOREA_SECRET_KEYS is required');
    mongo = await MongoMemoryServer.create({binary: {version: '7.0.14'}, instance: {ip: '127.0.0.1'}});
    await mongoose.connect(mongo.getUri(), {useNewUrlParser: true, useUnifiedTopology: true});
    const modelLoader = createLoader({overrides: {mongoose}});
    const models = {};
    for (const name of ['arpltnKeco', 'sido.arpltn.keco.model', 'modelMsrStnInfo', 'modelMinuDustFrcst', 'arpltnTownKeco']) {
        models['models/' + name + '.js'] = modelLoader.load('models/' + name + '.js');
        await models['models/' + name + '.js'].init();
    }
    // kmaTimeLib and the dust-forecast region lookup read the gather process's global manager.
    const manager = {codeTable: [], leadingZeros: (n, digits) => String(n).padStart(digits, '0')};
    const loader = createLoader({log: logger(logs), globals: {manager}, allowNodeModules: ['https', 'url'], overrides: Object.assign({
        async, dnscache: () => {}, 'config/config.js': {}, 's3/controller.s3.js': function () {},
        'utils/convertGeocode.js': (a, b, c, cb) => cb(new Error('geocoder outside smoke')),
        'controllers/airkorea.hourly.forecast.controller.js': function () { this.do = time => hourlyForecastRuns.push(time); }
    }, models)});
    const Keco = loader.load('lib/kecoRequester.js');
    const controller = loader.load('controllers/kecoController.js');
    const keco = new Keco();
    keco._uploadS3 = (value, cb) => cb(); // S3 archival is outside this smoke.
    keco.setServiceKeys(keys); keco._sidoList = provinces;
    const [Arpltn, Sido, MsrStn, Frcst] = ['arpltnKeco', 'sido.arpltn.keco.model', 'modelMsrStnInfo', 'modelMinuDustFrcst']
        .map(name => models['models/' + name + '.js']);
    const timings = {};

    let start = Date.now();
    await invoke(keco, 'cbKecoProcess', keco);
    timings.station = elapsed(start);
    const stationRows = await Arpltn.countDocuments();
    const aggregates = await Sido.find({cityName: ''}).lean();
    assert(stationRows > 30, 'station rows ' + stationRows);
    assert.deepEqual(aggregates.map(a => a.sidoName).sort(), provinces.slice().sort());
    const newest = await Arpltn.findOne().sort({date: -1}).lean();
    const ageHours = (Date.now() - newest.date.getTime()) / 3600000;
    assert(ageHours >= 0 && ageHours < 3, 'fresh observation, age ' + ageHours.toFixed(2) + 'h');

    start = Date.now();
    await invoke(keco, 'cbKecoSidoProcess', keco);
    timings.sido = elapsed(start);
    const cityRows = await Sido.countDocuments({cityName: {$ne: ''}});
    assert(cityRows >= 25, 'sido city rows ' + cityRows);

    start = Date.now();
    await invoke(keco, 'getAllMsrStnInfo');
    timings.stationList = elapsed(start);
    const stations = await MsrStn.countDocuments();
    const jongno = await MsrStn.findOne({stationName: '종로구'}).lean();
    assert(stations > 400, 'stations ' + stations);
    assert(jongno.geo[0] > 126 && jongno.geo[0] < 128 && jongno.geo[1] > 37 && jongno.geo[1] < 38, 'geo [lon, lat]');

    start = Date.now();
    await invoke(keco, 'getMinuDustFrcstDspth').catch(err => { if (err !== 'skip') throw err; });
    timings.forecast = elapsed(start);
    const forecasts = await Frcst.countDocuments();
    assert(forecasts > 0, 'forecast rows'); assert.equal(hourlyForecastRuns.length, 1);

    start = Date.now();
    const nearby = await invoke(keco, 'getNearbyMsrstn', '453586.837449', '198245.053183');
    const nearest = await invoke(keco, 'getStationNameFromMsrstn', nearby);
    timings.nearby = elapsed(start);
    assert.equal(typeof nearest, 'string');

    // Existing read paths over the collected rows.
    const seoul = await invoke(controller, 'getArpLtnInfo', {gCoord: {lat: 37.5665, lon: 126.978}}, new Date());
    assert(seoul.arpltn && seoul.arpltn.pm10Value !== undefined, 'Seoul current arpltn');
    const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10).replace(/-/g, '');
    const dust = await invoke(controller, 'getDustFrcst', {region: '서울특별시', city: '중구'}, today);
    assert(Array.isArray(dust) && dust.length > 0, 'dust forecast readback');
    const nation = await new Promise((resolve, reject) => controller.getSidoArpltn((err, rows) => err ? reject(err) : resolve(rows)));
    assert(nation.some(r => r.sidoName === '서울' && r.pm10Value !== undefined));

    const text = JSON.stringify(logs);
    for (const key of keys) {
        assert(!text.includes(key) && !text.includes(decodeURIComponent(key)), 'logs contain no key text');
    }
    const rejected = logs.filter(entry => JSON.stringify(entry).includes('KEY_REJECTED')).length;
    console.log(JSON.stringify({result: 'passed', configuredKeys: keys.length, keyRejectionsLogged: rejected,
        stationRows, provinceAggregates: aggregates.length, newestObservation: newest.dataTime,
        newestAgeHours: Number(ageHours.toFixed(2)), sidoCityRows: cityRows, stations, forecasts,
        nearestStation: nearest, seoulStation: seoul.arpltn.stationName, seoulPm10: seoul.arpltn.pm10Value,
        seoulDataTime: seoul.arpltn.dataTime, dustForecastDays: dust.length, nationRows: nation.length,
        timingsMs: timings, realMongo: true, mongoose: mongoose.version}));
})().catch(err => {
    console.error(JSON.stringify({result: 'failed', code: err.code, message: String(err.message).slice(0, 200),
        provinces: err.provinces}));
    process.exitCode = 1;
}).finally(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
});
