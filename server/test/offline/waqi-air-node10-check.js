/* Node 10.15.3 compatibility check for the WAQI domestic air fallback (#2622).
 * The service host runs Node 10.15.3 (docs/architecture/ec2-internals.md); node:test is not available there.
 * This plain script loads the real station-name helper, fallback module, cache model definition and the
 * v000903 air middleware in VMs, calls a loopback fake WAQI feed through real axios, and checks the
 * shared cache, the middleware wiring and the overseas station name.
 * Run: TZ=UTC NODE_PATH=<async, axios@0.18.1> node server/test/offline/waqi-air-node10-check.js
 * Keep this file to Node 10 syntax and APIs (no Object.fromEntries, Array#flat, ?. or ??).
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm'), http = require('http'), assert = require('assert');
var root = path.resolve(__dirname, '../..');
var lines = [];
var log = {};
['info', 'warn', 'error', 'debug', 'verbose', 'silly'].forEach(function (k) { log[k] = function () { lines.push(k + ' ' + Array.prototype.join.call(arguments, ' ')); }; });
function Stub() {}
function load(relative, deps, globals) {
    var module = {exports: {}};
    var sandbox = {module: module, exports: module.exports, console: console, log: log, Date: Date, setImmediate: setImmediate,
        require: function (name) { return Object.prototype.hasOwnProperty.call(deps, name) ? deps[name] : Stub; }};
    Object.keys(globals || {}).forEach(function (k) { sandbox[k] = globals[k]; });
    vm.runInNewContext(fs.readFileSync(path.join(root, relative), 'utf8'), sandbox, {filename: relative});
    return module.exports;
}
var AqiConverter = load('lib/aqi.converter.js', {});
var StationName = load('lib/AQI/waqiStationName.js', {});

// Cache model definition on a fake mongoose: collection name, _id key and TTL path.
var captured = {};
var fakeMongoose = {Schema: function (definition, options) { captured.definition = definition; captured.options = options; }, model: function (name, schema, collection) { captured.name = name; captured.collection = collection; return {}; }};
fakeMongoose.Schema.Types = {Mixed: 'Mixed'};
load('models/waqi.air.cache.model.js', {mongoose: fakeMongoose});
assert.strictEqual(captured.collection, 'waqi.air.caches');
assert.strictEqual(captured.definition._id.name, 'String');
assert.strictEqual(captured.definition.expireAt.expires, 0);

var rows = {};
var store = {
    find: function (query) {
        var q = {limit: function () { return q; }, lean: function () { return q; },
            exec: function (cb) { cb(null, rows[query._id] ? [JSON.parse(JSON.stringify(rows[query._id]))] : []); }};
        return q;
    },
    updateOne: function (query, update, options, cb) { rows[query._id] = JSON.parse(JSON.stringify(update.$set)); rows[query._id]._id = query._id; cb(null); }
};
var feed = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'waqi-jeju.json'), 'utf8'));
var requests = 0;
var server = http.createServer(function (req, res) {
    requests++;
    assert(/^\/feed\/geo:33\.4996;126\.5312\/\?token=node10-token$/.test(req.url), req.url);
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify(feed));
});

function fallback(port) {
    var axios = require('axios').create();
    axios.interceptors.request.use(function (c) { c.url = c.url.replace('https://api.waqi.info', 'http://127.0.0.1:' + port); return c; });
    return load('lib/AQI/waqiAirFallback.js', {'../../config/config': {keyString: {aqi_keys: [{key: 'node10-token'}]}},
        '../aqi.converter': AqiConverter, './waqiStationName': StationName, '../../models/waqi.air.cache.model': store, axios: axios});
}

server.listen(0, '127.0.0.1', function () {
    var port = server.address().port;
    var jeju = {lat: 33.4996, lon: 126.5312};
    var requestTime = new Date('2026-09-27T15:00:00Z');
    fallback(port).getArpltn(jeju, requestTime, function (err, arpltn, reason) {
        assert.ifError(err);
        assert(arpltn, 'observation: ' + reason);
        assert.strictEqual(arpltn.source, 'aqicn');
        assert.strictEqual(arpltn.stationName, 'Ido-dong');
        assert.strictEqual(arpltn.dataTime, '2026-09-27 23:00');
        assert.strictEqual(typeof arpltn.pm25Value, 'number');
        assert.strictEqual(requests, 1);
        // another worker (fresh module instance) reuses the shared cache
        fallback(port).getArpltn(jeju, requestTime, function (err2, again) {
            assert.ifError(err2);
            assert.strictEqual(requests, 1, 'second request served from cache');
            assert.strictEqual(JSON.stringify(again), JSON.stringify(arpltn));
            middleware(arpltn);
        });
    });
});

function middleware(arpltn) {
    var async = require('async');
    var Keco = load('controllers/kecoController.js', {'../lib/aqi.converter': AqiConverter});
    var Town = load('controllers/controllerTown.js', {'../controllers/kecoController': Keco});
    var T24 = load('controllers/controllerTown24h.js', {async: async, '../controllers/controllerTown': Town,
        '../lib/kmaTimeLib': load('lib/kmaTimeLib.js', {}, {manager: {leadingZeros: function (n, l) { var t = String(n); while (t.length < l) { t = '0' + t; } return t; }}}),
        '../controllers/kecoController': Keco, '../lib/aqi.converter': AqiConverter,
        '../lib/AQI/waqiAirFallback': {getArpltn: function (g, t, cb) { cb(null, JSON.parse(JSON.stringify(arpltn))); }}});
    var t = new T24();
    var req = {params: {}, query: {airUnit: 'airkorea', airForecastSource: 'kaq'}, current: {}, airGCoord: {lat: 33.4996, lon: 126.5312}};
    var calls = 0;
    t.getWaqiAirFallback(req, {}, function () {
        calls++;
        assert.strictEqual(req.current.arpltn.source, 'aqicn');
        t.makeAirInfoList(req, {}, function () {
            assert.strictEqual(req.airInfoList[0].source, 'aqicn');
            t.AirForecastList(req, {}, function () {
                assert.strictEqual(req.airInfoList[0].forecastSource, undefined);
                // getKeco no longer dereferences a failed lookup
                Keco.getArpLtnInfo = function (townInfo, date, cb) { cb(new Error('lookup failed')); };
                var town = new Town();
                town._getTownInfo = function (r, c, tw, cb) { cb(null, {gCoord: {lat: 1, lon: 2}}); };
                var kreq = {params: {}, current: {}};
                town.getKeco(kreq, {}, function () {
                    assert.strictEqual(JSON.stringify(kreq.airGCoord), '{"lat":1,"lon":2}');
                    assert(!lines.some(function (l) { return /^(error|warn) .*(TypeError|ReferenceError|Cannot read)/.test(l); }), 'no programming errors');
                    world();
                });
            });
        });
    });
    setImmediate(function () { assert.strictEqual(calls, 1); });
}

function world() {
    var WW = load('controllers/worldWeather/controller.ww.units.js', {'../controllerTown24h': Stub,
        '../../lib/aqi.converter': AqiConverter, '../../lib/AQI/waqiStationName': StationName});
    var current = {mCity: 'Sasazuka, Shibuya, Tokyo, Japan (甲州街道大原渋谷区)', pm25Value: 10};
    new WW()._makeArpltn(current, {airUnit: 'airkorea'});
    assert.strictEqual(current.arpltn.stationName, 'Sasazuka');
    assert(!lines.some(function (l) { return l.indexOf('node10-token') !== -1; }), 'token never logged');
    server.close();
    console.log(JSON.stringify({outcome: 'passed', node: process.version, waqiRequests: requests}));
}
