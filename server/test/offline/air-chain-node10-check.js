/* Node 10.15.3 compatibility check for the air provider chain (#2628) and domestic fallback (#2622).
 * The service host runs Node 10.15.3 (docs/architecture/ec2-internals.md); node:test is not available there.
 * This plain script loads the real policy, adapters, budgets, chain, fallback, cache model definition and
 * the v000903 air middleware in VMs, maps every provider fixture, orders providers with in-memory budgets,
 * calls a loopback fake WAQI through real axios, and checks the middleware wiring and the overseas name.
 * Run: TZ=UTC NODE_PATH=<async, axios@0.18.1> node server/test/offline/air-chain-node10-check.js
 * Keep this file to Node 10 syntax and APIs (no Object.fromEntries, Array#flat, ?. or ??).
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm'), http = require('http'), assert = require('assert');
var harness = require('./air-harness');
var root = path.resolve(__dirname, '../..');
var lines = [];
var log = harness.logger(lines);
var KEYS = {google_key: 'google-node10-key-01', owm_keys: [{key: 'owm-node10-key-0001'}], vc_key: 'vc-node10-key-00001', aqi_keys: [{key: 'node10-token-000001'}]};
var seoul = {lat: 37.5665, lon: 126.978};
var requestTime = new Date('2026-09-27T15:20:00Z');
// Budget periods and fixture counters must use the same clock after month rollover.
class FixtureDate extends Date {
    constructor() {
        var args = Array.prototype.slice.call(arguments);
        super(...(args.length ? args : [requestTime.getTime()]));
    }
    static now() { return requestTime.getTime(); }
}
function canon(v) { return JSON.stringify(v, function (k, val) { if (val && typeof val === 'object' && !Array.isArray(val)) { var o = {}; Object.keys(val).sort().forEach(function (key) { o[key] = val[key]; }); return o; } return val; }); }
function Stub() {}
function loadSingle(relative, deps, globals) {
    var module = {exports: {}};
    var sandbox = {module: module, exports: module.exports, console: console, log: log, Date: Date, setImmediate: setImmediate,
        require: function (name) { return Object.prototype.hasOwnProperty.call(deps, name) ? deps[name] : Stub; }};
    Object.keys(globals || {}).forEach(function (k) { sandbox[k] = globals[k]; });
    vm.runInNewContext(fs.readFileSync(path.join(root, relative), 'utf8'), sandbox, {filename: relative});
    return module.exports;
}

// 1. Cache and usage model definitions on a fake mongoose: collection names and TTL paths.
var captured = [];
var fakeMongoose = {Schema: function (definition) { this.definition = definition; }, model: function (name, schema, collection) { captured.push({collection: collection, definition: schema.definition}); return {}; }};
fakeMongoose.Schema.Types = {Mixed: 'Mixed'};
loadSingle('models/air.observation.cache.model.js', {mongoose: fakeMongoose});
loadSingle('models/air.provider.usage.model.js', {mongoose: fakeMongoose});
assert.strictEqual(captured[0].collection, 'air.observation.caches'); assert.strictEqual(captured[0].definition.expireAt.expires, 0);
assert.strictEqual(captured[1].collection, 'air.provider.usage'); assert.strictEqual(captured[1].definition.expireAt.expires, 0);

// 2. Adapters map every fixture with a fake axios.
var fixtures = {google: harness.fixture('air/google-seoul'), openweather: harness.fixture('air/openweather-seoul'), visualcrossing: harness.fixture('air/visualcrossing-seoul'), aqicn: harness.fixture('waqi-seoul')};
var fake = harness.fakeAxios(function (config) {
    var id = config.url.indexOf('googleapis') !== -1 ? 'google' : config.url.indexOf('openweathermap') !== -1 ? 'openweather' : config.url.indexOf('visualcrossing') !== -1 ? 'visualcrossing' : 'aqicn';
    return {status: 200, data: fixtures[id]};
});
var usage = harness.memoryModel();
function loader(axiosImpl, cacheModel) {
    var overrides = {'config/config.js': {keyString: KEYS}, axios: axiosImpl, 'models/air.provider.usage.model.js': usage,
        'models/worldWeather/vc.usage.model.js': harness.memoryModel(), 'models/worldWeather/vc.fetch.lock.model.js': harness.memoryModel()};
    if (cacheModel) { overrides['models/air.observation.cache.model.js'] = cacheModel; }
    return harness.createLoader({log: log, overrides: overrides, globals: {Date: FixtureDate}});
}
var l = loader(fake.axios);
var providers = l.load('lib/air/providers/index.js');
var converter = l.load('lib/aqi.converter.js');
var expected = {
    google: {pm25: 29, pm10: 41, co: converter.ppb2ppm(334.24), no2: converter.ppb2ppm(10.4), o3: converter.ppb2ppm(54.2), so2: converter.ppb2ppm(4.3)},
    openweather: {pm25: 19, pm10: 22, co: converter.um2ppm('co', 231.3), no2: converter.um2ppm('no2', 15.3), o3: converter.um2ppm('o3', 64.3), so2: converter.um2ppm('so2', 8.3)},
    visualcrossing: {pm25: 19, pm10: 22, co: converter.um2ppm('co', 231.3), no2: converter.um2ppm('no2', 15.3), o3: converter.um2ppm('o3', 64.3), so2: converter.um2ppm('so2', 8.3)}
};
var ids = ['google', 'openweather', 'visualcrossing', 'aqicn'];
var done = 0;
ids.forEach(function (id) {
    providers[id].fetchCurrent(seoul, {axios: fake.axios, keyString: KEYS, timeoutMs: 3000}, function (r) {
        assert.strictEqual(r.outcome, 'ok', id + ' ' + JSON.stringify(r));
        assert.strictEqual(r.observation.provider, id);
        if (expected[id]) { assert.strictEqual(canon(r.observation.pollutants), canon(expected[id]), id); }
        else { assert.strictEqual(r.observation.stationName, 'Seoul (서울)'); assert.strictEqual(r.observation.stationBased, true); }
        if (++done === ids.length) { chainChecks(); }
    });
});

// 3. Chain ordering with in-memory budgets: Google first; capped → OpenWeather; auth → down → next.
function chainChecks() {
    var policy = l.load('config/air.js');
    var budget = l.load('lib/air/providerBudget.js').createBudget({config: policy});
    var chain = l.load('lib/air/providerChain.js').createChain({providers: providers.byId, budget: budget, config: policy, keyString: KEYS, axios: fake.axios});
    chain.fetch(seoul, requestTime, function (r1) {
        assert.strictEqual(r1.outcome, 'ok'); assert.strictEqual(r1.provider, 'google'); assert.strictEqual(r1.arpltn.source, 'google');
        usage.rows['google:m:' + requestTime.toISOString().slice(0, 7)] = {_id: 'x', calls: 9500, expireAt: '2026-11-01T00:00:00Z'};
        chain.fetch(seoul, requestTime, function (r2) {
            assert.strictEqual(r2.provider, 'openweather');
            assert.strictEqual(r2.arpltn.coValue, 0.185);
            var authAxios = harness.fakeAxios(function (config) {
                if (config.url.indexOf('openweathermap') !== -1) { return {status: 401, data: {}}; }
                return {status: 200, data: fixtures[config.url.indexOf('googleapis') !== -1 ? 'google' : 'aqicn']};
            });
            var l2 = loader(authAxios.axios);
            var p2 = l2.load('lib/air/providers/index.js');
            var b2 = l2.load('lib/air/providerBudget.js').createBudget({config: policy});
            var c2 = l2.load('lib/air/providerChain.js').createChain({providers: p2.byId, budget: b2, config: policy, keyString: KEYS, axios: authAxios.axios});
            c2.fetch(seoul, requestTime, function (r3) {
                assert.strictEqual(r3.provider, 'aqicn', JSON.stringify(r3.attempts));
                assert(usage.rows['openweather:down'], 'down marker');
                paidChecks();
            });
        });
    });
}

// 3b. Paid admission (D20): strict reads, reservation before HTTP, last slot under concurrency, no double count.
function paidChecks() {
    var paidUsage = harness.memoryModel();
    var lp = harness.createLoader({log: log, overrides: {'config/config.js': {keyString: KEYS}, axios: fake.axios, 'models/air.provider.usage.model.js': paidUsage,
        'models/worldWeather/vc.usage.model.js': harness.memoryModel(), 'models/worldWeather/vc.fetch.lock.model.js': harness.memoryModel()}});
    var policy = Object.assign({}, lp.load('config/air.js'), {paidProvidersEnabled: true, paidMonthlyCallCap: 2});
    var budget = lp.load('lib/air/providerBudget.js').createBudget({config: policy});
    var id = 'openweather:paid:m:' + new Date().toISOString().slice(0, 7);
    paidUsage.failRead = true;
    budget.check('openweather', 'paid', 1, function (denied) {
        assert.strictEqual(canon(denied), canon({allowed: false, reason: 'store-error'}));
        paidUsage.failRead = false;
        paidUsage.failWrite = true;
        budget.check('openweather', 'paid', 1, function (unreserved) {
            assert.strictEqual(canon(unreserved), canon({allowed: false, reason: 'reserve-error'}));
            paidUsage.failWrite = false;
            // mongoose 5.1.2 on the host answers the driver 3.0.8 result; an unacknowledged write has no n
            var realUpdate = paidUsage.updateOne;
            paidUsage.updateOne = function (q, u, o, cb) { cb(null, {result: {ok: 1}}); };
            budget.check('openweather', 'paid', 1, function (unacknowledged) {
                assert.strictEqual(canon(unacknowledged), canon({allowed: false, reason: 'reserve-error'}));
                paidUsage.updateOne = function (q, u, o, cb) {
                    realUpdate(q, u, o, function (err, raw) { cb(err, raw && {result: raw, matchedCount: raw.upserted ? 0 : raw.n, modifiedCount: raw.nModified, upsertedCount: raw.upserted ? 1 : 0}); });
                };
                paidUsage.rows[id] = {_id: id, calls: 1, failures: 0, expireAt: '2026-11-01T00:00:00.000Z'};
                paidUsage.holdWrites = true;
                var states = [], n = 0;
                for (var i = 0; i < 3; i++) {
                    budget.check('openweather', 'paid', 1, function (state) {
                        states.push(state);
                        if (++n === 3) { lastSlot(states); }
                    });
                }
                setImmediate(function () {
                    paidUsage.holdWrites = false;
                    (function flush() {
                        var p = paidUsage.pendingWrites.splice(0);
                        p.forEach(function (fn) { fn(); });
                        if (p.length) { setImmediate(flush); }
                    })();
                });
            });
        });
    });
    function lastSlot(states) {
        assert.strictEqual(states.filter(function (x) { return x.allowed; }).length, 1, canon(states));
        var admitted = states.filter(function (x) { return x.allowed; })[0];
        assert.strictEqual(admitted.reservation, id);
        assert.strictEqual(paidUsage.rows[id].calls, 2);
        budget.record('openweather', 'paid', {failed: true, reservation: admitted.reservation}, function () {
            assert.strictEqual(paidUsage.rows[id].calls, 2, 'no double count');
            assert.strictEqual(paidUsage.rows[id].failures, 1);
            fallbackChecks();
        });
    }
}

// 4. Fallback with a loopback WAQI over real axios (only WAQI configured), shared cache between two instances.
var feed = harness.fixture('waqi-jeju');
var requests = 0;
var server = http.createServer(function (req, res) {
    requests++;
    assert(/^\/feed\/geo:33\.4996;126\.5312\/\?token=node10-token-000001$/.test(req.url), req.url);
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify(feed));
});
function fallbackChecks() {
    server.listen(0, '127.0.0.1', function () {
        var port = server.address().port;
        var axios = require('axios').create();
        axios.interceptors.request.use(function (c) { c.url = c.url.replace('https://api.waqi.info', 'http://127.0.0.1:' + port); return c; });
        var cache = harness.memoryModel();
        var waqiOnly = {aqi_keys: KEYS.aqi_keys};
        function instance() {
            var overrides = {'config/config.js': {keyString: waqiOnly}, axios: axios, 'models/air.provider.usage.model.js': harness.memoryModel(),
                'models/worldWeather/vc.usage.model.js': harness.memoryModel(), 'models/worldWeather/vc.fetch.lock.model.js': harness.memoryModel(),
                'models/air.observation.cache.model.js': cache};
            return harness.createLoader({log: log, overrides: overrides}).load('lib/AQI/airFallback.js');
        }
        var jeju = {lat: 33.4996, lon: 126.5312};
        var t = new Date('2026-09-27T15:00:00Z');
        instance().getArpltn(jeju, t, function (err, arpltn, reason) {
            assert.ifError(err);
            assert(arpltn, 'observation: ' + reason);
            assert.strictEqual(arpltn.source, 'aqicn'); assert.strictEqual(arpltn.stationName, 'Ido-dong');
            assert.strictEqual(arpltn.dataTime, '2026-09-27 23:00'); assert.strictEqual(requests, 1);
            instance().getArpltn(jeju, t, function (err2, again) {
                assert.ifError(err2);
                assert.strictEqual(requests, 1, 'second instance served from the shared cache');
                assert.strictEqual(JSON.stringify(again), JSON.stringify(arpltn));
                middleware(arpltn);
            });
        });
    });
}

// 5. Middleware wiring and the overseas station name.
function middleware(arpltn) {
    var async = require('async');
    var AqiConverter = loadSingle('lib/aqi.converter.js', {});
    var Keco = loadSingle('controllers/kecoController.js', {'../lib/aqi.converter': AqiConverter});
    var Town = loadSingle('controllers/controllerTown.js', {'../controllers/kecoController': Keco});
    var T24 = loadSingle('controllers/controllerTown24h.js', {async: async, '../controllers/controllerTown': Town,
        '../lib/kmaTimeLib': loadSingle('lib/kmaTimeLib.js', {}, {manager: {leadingZeros: function (n, len) { var s = String(n); while (s.length < len) { s = '0' + s; } return s; }}}),
        '../controllers/kecoController': Keco, '../lib/aqi.converter': AqiConverter,
        '../lib/AQI/airFallback': {getArpltn: function (g, tm, cb) { cb(null, JSON.parse(JSON.stringify(arpltn))); }}});
    var t = new T24();
    var req = {params: {}, query: {airUnit: 'airkorea', airForecastSource: 'kaq'}, current: {}, airGCoord: {lat: 33.4996, lon: 126.5312}};
    t.getAirFallback(req, {}, function () {
        assert.strictEqual(req.current.arpltn.source, 'aqicn');
        t.makeAirInfoList(req, {}, function () {
            assert.strictEqual(req.airInfoList[0].source, 'aqicn');
            t.AirForecastList(req, {}, function () {
                assert.strictEqual(req.airInfoList[0].forecastSource, undefined);
                var route = fs.readFileSync(path.join(root, 'routes/v000903/route.kma.v000903.js'), 'utf8');
                var list = route.match(/var routerList = \[([\s\S]*?)\];/)[1].match(/cTown\.(\w+)/g).map(function (s) { return s.slice(6); });
                assert.strictEqual(list[list.indexOf('getKeco') + 1], 'getAirFallback');
                var StationName = loadSingle('lib/AQI/waqiStationName.js', {});
                var WW = loadSingle('controllers/worldWeather/controller.ww.units.js', {'../controllerTown24h': Stub, '../../lib/aqi.converter': AqiConverter, '../../lib/AQI/waqiStationName': StationName});
                var current = {mCity: 'Sasazuka, Shibuya, Tokyo, Japan (甲州街道大原渋谷区)', pm25Value: 10};
                new WW()._makeArpltn(current, {airUnit: 'airkorea'});
                assert.strictEqual(current.arpltn.stationName, 'Sasazuka');
                var all = lines.map(function (x) { return x.text; }).join('\n');
                ['google-node10-key-01', 'owm-node10-key-0001', 'vc-node10-key-00001', 'node10-token-000001'].forEach(function (k) { assert(all.indexOf(k) === -1, 'key never logged'); });
                server.close();
                console.log(JSON.stringify({outcome: 'passed', node: process.version, waqiRequests: requests}));
            });
        });
    });
}
