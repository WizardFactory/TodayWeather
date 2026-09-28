/* Run with Node >=16.20.2: node server/test/offline/air-fallback.test.js
 * Domestic air fallback (#2622, generalized to the provider chain in #2628) and short WAQI
 * station names. Real modules run in isolated VMs; axios, Mongo models and collaborators are
 * stubs. No app startup, network, Mongo or timers. Only WAQI is configured here, so the chain
 * resolves to WAQI; the chain itself is covered by air-chain.test.js.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createLoader, memoryModel, fakeAxios, fixture, logger} = require('./air-harness');
const root = path.resolve(__dirname, '../..');
const logs = [];
const log = logger(logs);

function Stub() {}
// Single-level loader for the controllers: every collaborator not listed is a stub.
function load(relative, dependencies = {}, globals = {}) {
    const module = {exports: {}};
    const sandbox = Object.assign({module, exports: module.exports, console, log, Date, setImmediate,
        require: name => Object.prototype.hasOwnProperty.call(dependencies, name) ? dependencies[name] : Stub}, globals);
    sandbox.global = sandbox;
    vm.runInNewContext(fs.readFileSync(path.join(root, relative), 'utf8'), sandbox, {filename: relative});
    return module.exports;
}
const AqiConverter = load('lib/aqi.converter.js');
const StationName = fs.existsSync(path.join(root, 'lib/AQI/waqiStationName.js')) ? load('lib/AQI/waqiStationName.js') : {};

function fixedDate(iso) {
    const RealDate = Date;
    const at = () => new RealDate(iso).getTime();
    return class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [at()])); }
        static now() { return at(); }
    };
}
function fallbackModule(store, http, key = 'synthetic-token', FixedNow) {
    const l = createLoader({log, overrides: {
        'config/config.js': {keyString: {aqi_keys: [{key}]}},
        'models/air.observation.cache.model.js': store,
        'models/air.provider.usage.model.js': memoryModel(),
        'models/worldWeather/vc.usage.model.js': memoryModel(),
        'models/worldWeather/vc.fetch.lock.model.js': memoryModel(),
        axios: http.axios
    }, globals: FixedNow ? {Date: FixedNow} : {}});
    return l.load('lib/AQI/airFallback.js');
}
const seoul = {lat: 37.5665, lon: 126.978};
const at = (iso) => new Date(iso);
const feed = name => fixture(name);
function call(mod, gCoord, requestTime) {
    return new Promise(resolve => mod.getArpltn(gCoord, requestTime, (err, arpltn, reason) => resolve({err, arpltn, reason})));
}
const waqiOk = () => ({status: 200, data: feed('waqi-seoul')});

test('long WAQI station names are reduced to their smallest unit; short names are unchanged', () => {
    assert.equal(StationName.shorten('Sasazuka, Shibuya, Tokyo, Japan (甲州街道大原渋谷区)'), 'Sasazuka');
    assert.equal(StationName.shorten('Ido-dong, Jeju-si, Jeju, South Korea (이도동 제주)'), 'Ido-dong');
    assert.equal(StationName.shorten('Seoul (서울)'), 'Seoul (서울)');
    assert.equal(StationName.shorten('Busan'), 'Busan');
    assert.equal(StationName.shorten('Guro-gu Guro-dong Monitoring Station (구로동)'), 'Guro-gu Guro-dong Monitoring Station');
    assert.equal(StationName.shorten('(甲州街道大原渋谷区大原渋谷区大原渋谷区)'), '(甲州街道大原渋谷区大原渋谷区大原渋谷区)');
    assert.equal(StationName.shorten(undefined), undefined);
});

test('fresh WAQI observation near the town maps to the AirKorea arpltn shape', async () => {
    const store = memoryModel();
    const http = fakeAxios(waqiOk);
    const r = await call(fallbackModule(store, http), seoul, at('2026-09-27T14:52:00Z'));
    assert.equal(r.err, null);
    assert.equal(http.calls.length, 1);
    assert.equal(http.calls[0].url, 'https://api.waqi.info/feed/geo:37.5665;126.978/?token=synthetic-token');
    assert.equal(http.calls[0].timeout, 3000);
    const a = r.arpltn;
    assert.equal(a.source, 'aqicn');
    assert.equal(a.stationName, 'Seoul (서울)');
    assert.equal(a.dataTime, '2026-09-27 23:00');
    assert.equal(a.pm25Value, AqiConverter.extractValue('pm25', 87));
    assert.equal(a.pm10Value, AqiConverter.extractValue('pm10', 41));
    assert.equal(a.o3Value, AqiConverter.ppb2ppm(AqiConverter.extractValue('o3', 54.2)));
    assert.equal(a.coValue, AqiConverter.extractValue('co', 5.5));
    assert.equal(a.pm25Grade, undefined, 'grades are computed later for the requested airUnit');
    assert(!logs.some(l => l.text.includes('synthetic-token')), 'token never logged');
    const row = store.rows['37.57,126.98'];
    assert.equal(row.outcome, 'ok'); assert.equal(row.provider, 'aqicn');
    assert.equal(JSON.stringify(row).includes('synthetic-token'), false, 'token never cached');
});

test('observation age and station distance limits', async () => {
    const http = fakeAxios(waqiOk);
    const mod = fallbackModule(memoryModel(), http);
    assert.ok((await call(mod, seoul, at('2026-09-27T21:00:00Z'))).arpltn, '7 h old is accepted');
    const stale = await call(mod, seoul, at('2026-09-27T23:00:00Z'));
    assert.equal(stale.arpltn, undefined); assert.equal(stale.reason, 'stale', '9 h old is rejected');
    const future = await call(mod, seoul, at('2026-09-27T11:30:00Z'));
    assert.equal(future.arpltn, undefined); assert.equal(future.reason, 'future');
    const near = await call(mod, {lat: 37.75, lon: 126.978}, at('2026-09-27T15:00:00Z'));
    assert.ok(near.arpltn, 'station ~20 km away is accepted');
    const far = await call(mod, {lat: 37.95, lon: 126.978}, at('2026-09-27T15:00:00Z'));
    assert.equal(far.arpltn, undefined); assert.equal(far.reason, 'too-far');
});

test('missing or placeholder key disables the fallback without a request', async () => {
    for (const key of ['', 'You have to set key of WAQI', null]) {
        const http = fakeAxios(() => { throw new Error('unexpected'); });
        const r = await call(fallbackModule(memoryModel(), http, key), seoul, at('2026-09-27T15:00:00Z'));
        assert.equal(r.arpltn, undefined); assert.equal(r.reason, 'no-provider'); assert.equal(http.calls.length, 0);
    }
});

test('provider failures yield no observation and are cached briefly', async () => {
    const cases = [
        [() => ({status: 200, data: {status: 'error', data: 'Unknown station'}}), 'aqicn:status-error'],
        [() => ({status: 200, data: {status: 'ok', data: {city: {name: 'x', geo: [37.5, 127]}, time: {iso: '2026-09-27T23:00:00+09:00'}, iaqi: {o3: {v: 20}}}}}), 'no-pm'],
        [() => { const e = new Error('timeout of 3000ms exceeded'); e.code = 'ECONNABORTED'; throw e; }, 'aqicn:timeout'],
        [() => ({status: 500, data: {}}), 'aqicn:http-500'],
        [() => { const e = new Error('socket hang up'); e.code = 'ECONNRESET'; throw e; }, 'aqicn:transport']
    ];
    for (const [respond, reason] of cases) {
        const store = memoryModel();
        const r = await call(fallbackModule(store, fakeAxios(respond)), seoul, at('2026-09-27T15:00:00Z'));
        assert.equal(r.err, null); assert.equal(r.arpltn, undefined); assert.equal(r.reason, reason);
        const row = store.rows['37.57,126.98'];
        // an observation without PM is kept for 30 min (re-evaluated per request); real failures 2 min
        assert.equal(row.outcome, reason === 'no-pm' ? 'ok' : 'failed');
        assert.equal(new Date(row.expireAt) - new Date(row.fetchedAt), (reason === 'no-pm' ? 30 : 2) * 60000, reason + ' cache period');
    }
});

test('a second request reuses the shared cache, also from another worker', async () => {
    const store = memoryModel();
    const http = fakeAxios(waqiOk);
    const Now = fixedDate('2026-09-27T14:52:00Z');
    const first = await call(fallbackModule(store, http, 'synthetic-token', Now), seoul, at('2026-09-27T14:52:00Z'));
    const second = await call(fallbackModule(store, http, 'synthetic-token', Now), seoul, at('2026-09-27T14:53:00Z'));
    assert.equal(http.calls.length, 1, 'one WAQI call for two requests');
    assert.equal(JSON.stringify(second.arpltn), JSON.stringify(first.arpltn));
    const row = store.rows['37.57,126.98'];
    assert.equal(row.outcome, 'ok');
    assert.equal(new Date(row.expireAt) - new Date(row.fetchedAt), 30 * 60000);
});

test('expired cache rows are refetched; failures are retried after two minutes', async () => {
    const store = memoryModel();
    let fail = true;
    const http = fakeAxios(() => { if (fail) { const e = new Error('x'); e.code = 'ECONNRESET'; throw e; } return waqiOk(); });
    await call(fallbackModule(store, http, 'synthetic-token', fixedDate('2026-09-27T14:50:00Z')), seoul, at('2026-09-27T14:50:00Z'));
    fail = false;
    const within = await call(fallbackModule(store, http, 'synthetic-token', fixedDate('2026-09-27T14:51:30Z')), seoul, at('2026-09-27T14:51:30Z'));
    assert.equal(within.reason, 'aqicn:transport'); assert.equal(http.calls.length, 1, 'failure reused within 2 min');
    const after = await call(fallbackModule(store, http, 'synthetic-token', fixedDate('2026-09-27T14:52:30Z')), seoul, at('2026-09-27T14:52:30Z'));
    assert.ok(after.arpltn); assert.equal(http.calls.length, 2);
    await call(fallbackModule(store, http, 'synthetic-token', fixedDate('2026-09-27T15:20:00Z')), seoul, at('2026-09-27T15:20:00Z'));
    assert.equal(http.calls.length, 2, 'ok row reused within 30 min');
    await call(fallbackModule(store, http, 'synthetic-token', fixedDate('2026-09-27T15:23:00Z')), seoul, at('2026-09-27T15:23:00Z'));
    assert.equal(http.calls.length, 3, 'ok row refetched after 30 min');
});

test('concurrent requests in one worker share one call; cache errors fall back to a fetch', async () => {
    const store = memoryModel();
    const http = fakeAxios(waqiOk);
    http.hold = true;
    const mod = fallbackModule(store, http);
    const pending = [call(mod, seoul, at('2026-09-27T15:00:00Z')), call(mod, {lat: 37.5701, lon: 126.9812}, at('2026-09-27T15:00:00Z'))];
    for (let i = 0; i < 5; i++) { await new Promise(r => setImmediate(r)); }
    assert.equal(http.calls.length, 1, 'same cell, one in-flight call');
    http.release();
    const [a, b] = await Promise.all(pending);
    assert.ok(a.arpltn); assert.ok(b.arpltn);
    const broken = memoryModel(); broken.failRead = true; broken.failWrite = true;
    const http2 = fakeAxios(waqiOk);
    const r = await call(fallbackModule(broken, http2), seoul, at('2026-09-27T15:00:00Z'));
    assert.ok(r.arpltn, 'read/write errors do not block the observation');
    assert.equal(http2.calls.length, 1);
});

test('an exception in the caller on a cache hit is not taken as a cache failure', async () => {
    const store = memoryModel();
    const http = fakeAxios(waqiOk);
    await call(fallbackModule(store, http), seoul, at('2026-09-27T15:00:00Z'));
    assert.equal(http.calls.length, 1);
    let calls = 0;
    const boom = new Error('caller failed');
    assert.throws(() => fallbackModule(store, http).getArpltn(seoul, at('2026-09-27T15:00:00Z'), () => { calls++; throw boom; }), err => err === boom);
    for (let i = 0; i < 3; i++) { await new Promise(r => setImmediate(r)); }
    assert.equal(calls, 1); assert.equal(http.calls.length, 1);
});

test('a request answers only after the shared cache write, so the next request on any worker reuses it', async () => {
    const store = memoryModel();
    store.holdWrites = true;
    const http = fakeAxios(waqiOk);
    const workerA = fallbackModule(store, http);
    let answered = false;
    const first = call(workerA, seoul, at('2026-09-27T15:00:00Z')).then(r => { answered = true; return r; });
    for (let i = 0; i < 8; i++) { await new Promise(r => setImmediate(r)); }
    assert.equal(http.calls.length, 1);
    assert.equal(store.pendingWrites.length, 1, 'cache write started');
    assert.equal(answered, false, 'no answer before the cache write is acknowledged');
    const sameWorker = call(workerA, seoul, at('2026-09-27T15:00:00Z'));
    for (let i = 0; i < 5; i++) { await new Promise(r => setImmediate(r)); }
    assert.equal(http.calls.length, 1, 'a same-worker request during the write joins the call');
    store.pendingWrites.splice(0).forEach(fn => fn());
    const a = await first;
    assert.ok(a.arpltn); assert.ok((await sameWorker).arpltn);
    const b = await call(fallbackModule(store, http), seoul, at('2026-09-27T15:00:00Z'));
    assert.ok(b.arpltn);
    assert.equal(http.calls.length, 1, 'worker B right after A is served from the cache');
});

test('malformed WAQI bodies become one failed outcome and every waiter is answered once', async () => {
    const rejections = [];
    const onRejection = reason => rejections.push(String(reason));
    process.on('unhandledRejection', onRejection);
    try {
        const bodies = [
            {status: 'ok', data: {city: {name: 'x', geo: [37.57, 126.98]}, time: {s: 123, tz: '+09:00'}, iaqi: {pm25: {v: 50}}}},
            {status: 'ok', data: {city: {name: 42, geo: 'nowhere'}, time: {iso: 7}, iaqi: {pm25: {v: 50}}}},
            {status: 'ok', data: {city: null, time: null, iaqi: 'none'}}
        ];
        for (const body of bodies) {
            const store = memoryModel();
            const http = fakeAxios(() => ({status: 200, data: body}));
            http.hold = true;
            const mod = fallbackModule(store, http);
            let calls = 0;
            const count = p => p.then(r => { calls++; return r; });
            const waiting = [count(call(mod, seoul, at('2026-09-27T15:00:00Z'))), count(call(mod, seoul, at('2026-09-27T15:00:00Z')))];
            for (let i = 0; i < 5; i++) { await new Promise(r => setImmediate(r)); }
            http.release();
            const results = await Promise.race([Promise.all(waiting), new Promise(r => setTimeout(() => r('hung'), 500))]);
            assert.notEqual(results, 'hung', 'every waiter is answered: ' + JSON.stringify(body));
            for (const r of results) { assert.equal(r.err, null); assert.equal(r.arpltn, undefined); assert.ok(r.reason); }
            assert.equal(calls, 2);
            assert.equal(http.calls.length, 1);
        }
        await new Promise(r => setImmediate(r));
        assert.deepEqual(rejections, [], 'no unhandled promise rejection');
    }
    finally {
        process.removeListener('unhandledRejection', onRejection);
    }
});

// ---- Route middleware ----------------------------------------------------------------
function town24h(fallback) {
    const Keco = load('controllers/kecoController.js', {'../lib/aqi.converter': AqiConverter});
    const Town = load('controllers/controllerTown.js', {'../controllers/kecoController': Keco});
    const T24 = load('controllers/controllerTown24h.js', {
        async: require('async'), '../lib/kmaTimeLib': load('lib/kmaTimeLib.js', {}, {manager: {leadingZeros: (n, l) => String(n).padStart(l, '0')}}),
        '../controllers/controllerTown': Town, '../controllers/kecoController': Keco, '../lib/aqi.converter': AqiConverter,
        '../lib/AQI/airFallback': fallback,
        '../controllers/airkorea.hourly.forecast.controller': function () { this.getForecast = () => { throw new Error('unexpected forecast lookup'); }; },
        '../controllers/kaq.hourly.forecast.controller': function () { this.getForecast = () => { throw new Error('unexpected forecast lookup'); }; }
    });
    return new T24();
}
function runMiddleware(fn, req) {
    return new Promise((resolve, reject) => {
        let calls = 0;
        fn(req, {}, () => { calls++; setImmediate(() => calls === 1 ? resolve(req) : reject(new Error('next called ' + calls))); });
    });
}
const googleArpltn = {source: 'google', dataTime: '2026-09-27 23:00', pm10Value: 41, pm25Value: 29};

test('middleware keeps a fresh AirKorea observation and does not call the chain', async () => {
    const t = town24h({getArpltn() { throw new Error('unexpected chain call'); }});
    const airkorea = {stationName: '중구', dataTime: '2026-09-27 22:00', pm10Value: 20, pm10Grade: 1};
    const req = await runMiddleware(t.getAirFallback, {params: {}, current: {arpltn: airkorea}, gCoord: seoul, arpltnStnList: [[airkorea]]});
    assert.equal(req.current.arpltn, airkorea);
    assert.deepEqual(req.arpltnStnList, [[airkorea]]);
});

test('middleware fills current and station lists from the chain when AirKorea is missing', async () => {
    let asked;
    const t = town24h({getArpltn(gCoord, time, cb) { asked = gCoord; cb(null, Object.assign({}, googleArpltn)); }});
    for (const arpltn of [undefined, {}, {pm10Value: -1, stationName: 'x'}]) {
        const stale = [{stationName: '중구', dataTime: '2026-09-26 10:00', pm10Value: 20}];
        const req = await runMiddleware(t.getAirFallback, {params: {}, current: {arpltn}, airGCoord: seoul, arpltnStnList: [stale]});
        assert.deepEqual(asked, seoul);
        assert.equal(req.current.arpltn.source, 'google');
        assert.equal(req.arpltnStnList.length, 1); assert.equal(req.arpltnStnList[0][0], req.current.arpltn);
    }
});

test('middleware leaves the response without air when the chain yields nothing or throws', async () => {
    for (const fallback of [{getArpltn: (g, t, cb) => cb(null, undefined, 'aqicn:stale')}, {getArpltn: (g, t, cb) => cb(new Error('boom'))},
        {getArpltn() { throw new Error('sync boom'); }}]) {
        const req = await runMiddleware(town24h(fallback).getAirFallback, {params: {}, current: {}, gCoord: seoul});
        assert.equal(req.current.arpltn, undefined);
        assert.equal(req.arpltnStnList, undefined);
    }
    const noCoord = await runMiddleware(town24h({getArpltn() { throw new Error('unexpected'); }}).getAirFallback, {params: {}, current: {}});
    assert.equal(noCoord.current.arpltn, undefined);
});

test('a non-AirKorea station list becomes an airInfo with that source and skips the station forecast lookup', async () => {
    const t = town24h({});
    const before = logs.length;
    for (const source of ['google', 'openweather', 'visualcrossing', 'aqicn']) {
        const req = {params: {}, query: {airUnit: 'airkorea', airForecastSource: 'kaq'}, arpltnStnList: [[Object.assign({}, googleArpltn, {source})]]};
        await runMiddleware(t.makeAirInfoList, req);
        assert.equal(req.airInfoList.length, 1);
        assert.equal(req.airInfoList[0].source, source);
        await runMiddleware(t.AirForecastList, req);
        assert.equal(req.airInfoList[0].forecastSource, undefined);
    }
    const ak = {params: {}, query: {}, arpltnStnList: [[{stationName: '중구', dataTime: '2026-09-27 22:00', pm10Value: 20, pm10Grade: 1}]]};
    await runMiddleware(t.makeAirInfoList, ak);
    assert.equal(ak.airInfoList[0].source, 'airkorea');
    assert.deepEqual(logs.slice(before).filter(l => l.level === 'error' || l.level === 'warn').map(l => l.text), []);
});

test('getKeco calls next once when the AirKorea lookup fails and keeps the town coordinate', async () => {
    const Keco = load('controllers/kecoController.js', {'../lib/aqi.converter': AqiConverter});
    Keco.getArpLtnInfo = (townInfo, date, cb) => cb(new Error('mongo down'));
    const Town = load('controllers/controllerTown.js', {'../controllers/kecoController': Keco});
    const town = new Town();
    town._getTownInfo = (r, c, t, cb) => cb(null, {gCoord: seoul});
    const before = logs.length;
    const req = await runMiddleware(town.getKeco, {params: {region: '서울특별시', city: '중구', town: '명동'}, current: {}, sessionID: 's'});
    assert.equal(req.current.arpltn, undefined);
    assert.deepEqual(req.airGCoord, seoul);
    assert.deepEqual(logs.slice(before).filter(l => /TypeError|Cannot read/.test(l.text)), []);
});

test('v000903 KMA routes run the air fallback right after getKeco', () => {
    const source = fs.readFileSync(path.join(root, 'routes/v000903/route.kma.v000903.js'), 'utf8');
    const list = source.match(/var routerList = \[([\s\S]*?)\];/)[1].match(/cTown\.(\w+)/g).map(s => s.slice(6));
    assert.equal(list[list.indexOf('getKeco') + 1], 'getAirFallback');
});

test('overseas air detail delivers a short WAQI station name', () => {
    const WWUnits = load('controllers/worldWeather/controller.ww.units.js', {
        '../controllerTown24h': Stub, '../../lib/aqi.converter': AqiConverter, '../../lib/AQI/waqiStationName': StationName});
    const current = {mCity: 'Sasazuka, Shibuya, Tokyo, Japan (甲州街道大原渋谷区)', mTime: '2026-09-27 22:00:00', pm25Value: 10};
    new WWUnits()._makeArpltn(current, {airUnit: 'airkorea'});
    assert.equal(current.arpltn.stationName, 'Sasazuka');
    const short = {mCity: 'Seoul (서울)'};
    new WWUnits()._makeArpltn(short, {airUnit: 'airkorea'});
    assert.equal(short.arpltn.stationName, 'Seoul (서울)');
});
