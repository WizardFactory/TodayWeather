/* Node 10.15.3 compatibility check for the KMA warning path (#2609).
 * The service host runs Node 10.15.3 (docs/architecture/ec2-internals.md) and serves /v000903/kma/special
 * and current.specialInfo; node:test is not available there. This plain script loads the real model,
 * zone, requester, collector and controller modules in a VM with in-memory models and the recorded
 * responses, runs one collection cycle and both readers.
 * Run: TZ=UTC NODE_PATH=<async> node server/test/offline/kma-warning-node10-check.js
 * Keep this file to Node 10 syntax and APIs (no Object.fromEntries, Array#flat, ?. or ??).
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
var async = require('async');
var root = path.resolve(__dirname, '../..');
var lines = [];
var log = {};
['info', 'warn', 'error', 'debug', 'verbose', 'silly'].forEach(function (k) { log[k] = function (m) { lines.push(k + ' ' + m); }; });
function fixture(name) { return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/kma-warning', name + '.json'), 'utf8')); }
function items(body) { return body.response.body.items.item; }
function page(list) { return {response: {header: {resultCode: '00', resultMsg: 'NORMAL_SERVICE'}, body: {items: {item: list}, numOfRows: 1000}}}; }
function load(relative, deps) {
    var module = {exports: {}};
    var sandbox = {module: module, exports: module.exports, console: console, log: log, Date: Date,
        setTimeout: setTimeout, clearTimeout: clearTimeout, setImmediate: setImmediate, __dirname: path.dirname(path.join(root, relative)),
        require: function (name) { if (!(name in deps)) { throw new Error('Unstubbed ' + name); } return deps[name]; }};
    vm.runInNewContext(fs.readFileSync(path.join(root, relative), 'utf8'), sandbox, {filename: relative});
    return module.exports;
}
var plain = function (v) { return JSON.parse(JSON.stringify(v)); };
var fakeMongoose = {
    Schema: function (definition) { this.definition = definition; this.statics = {}; this.index = function () {}; },
    model: function (name, schema) { var M = function () {}; Object.keys(schema.statics).forEach(function (k) { M[k] = schema.statics[k]; }); return M; }
};
function memoryModel(statics) {
    var docs = [];
    function matches(doc, query) {
        return Object.keys(query).every(function (key) {
            var cond = query[key], value = doc[key];
            if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
                if ('$in' in cond) { return cond.$in.indexOf(value) !== -1; }
                if ('$gt' in cond) { return value > cond.$gt; }
            }
            if (cond instanceof Date || value instanceof Date) { return new Date(cond).getTime() === new Date(value).getTime(); }
            return value === cond;
        });
    }
    var model = {
        docs: docs,
        find: function (query) {
            var result = docs.filter(function (d) { return matches(d, query); });
            var chain = {
                sort: function (spec) { var k = Object.keys(spec)[0]; result = result.slice().sort(function (a, b) { return (a[k] > b[k] ? 1 : -1) * spec[k]; }); return chain; },
                limit: function (n) { result = result.slice(0, n); return chain; },
                lean: function () { return chain; },
                exec: function (cb) { var out = result.map(function (d) { var c = plain(d); if (d.announcement) { c.announcement = new Date(d.announcement); } return c; }); setImmediate(function () { cb(null, out); }); }
            };
            return chain;
        },
        update: function (query, doc, options, cb) {
            var existing = docs.filter(function (d) { return matches(d, query); })[0];
            if (existing) { Object.assign(existing, plain(doc)); } else { docs.push(Object.assign(plain(query), plain(doc))); }
            setImmediate(function () { cb(null); });
        }
    };
    Object.keys(statics || {}).forEach(function (k) { model[k] = statics[k]; });
    return model;
}

var Situation = load('models/modelKmaSpecialWeatherSituation.js', {mongoose: fakeMongoose});
load('models/modelKmaSpecialWeatherZone.js', {mongoose: fakeMongoose});
var zones = load('lib/kmaWarningZones.js', {fs: fs, path: path});
var keyBox = {dongnae_forecast_keys: JSON.stringify(['NODE10%2BKEYxxxxxxxxxxxxxxxxxxxx'])};
var Requester = load('lib/kmaWarningRequester.js', {request: function () {}, '../config/config': {keyString: keyBox}, './dataGoKrRejection': require('../../lib/dataGoKrRejection')});

// Parsers and codes.
assert.deepEqual(plain(Situation.parseSpecialText('o 폭풍해일주의보 : 부산\r\no 폭염중대경보 : 대구')).map(function (s) { return [s.weather, s.level]; }), [[7, 1], [12, 4]]);
assert.equal(Situation.parsePreliminaryText('o 없음')[0].weatherStr, '없음');

// Replay: recorded rows end with no active zone, as t6 "o 없 음".
var rows = items(fixture('pwn-cd-daily-excerpt')).concat(items(fixture('pwn-cd-0921-0927')));
var state = {};
zones.applyEvents(state, zones.prepareEvents(rows));
assert.equal(Object.keys(state).filter(function (k) { return state[k].active && state[k].warnVar > 0; }).length, 0);
assert.ok(zones.zonesForTown({first: '제주특별자치도', second: '서귀포시', third: '성산읍'}).indexOf('L1091430') !== -1);

// Controller order on Node 10's unstable sort (independent verification F3): 경보 first, then zone name.
(function () {
    var ControllerForSort = load('controllers/kma.specialweather.controller.js', {async: async, '../models/modelKmaSpecialWeatherSituation': {},
        '../models/modelKmaSpecialWeatherZone': {}, '../lib/kmaWarningZones': zones});
    var list = [];
    for (var i = 0; i < 40; i++) { list.push({weather: 3, level: i % 5 === 0 ? 2 : 1, locationName: 'Z' + (100 - i)}); }
    var sorted = new ControllerForSort()._sort(list);
    for (var j = 1; j < sorted.length; j++) {
        var a = sorted[j - 1], b = sorted[j];
        assert.ok(a.level > b.level || (a.level === b.level && a.locationName <= b.locationName), 'order at ' + j);
    }
})();
assert.deepEqual(zones.zonesForTown({first: '경상북도', second: '군위군', third: ''}).map(zones.zoneName).sort(), ['군위군', '대구광역시', '전국']);

// One collection cycle at 2026-09-26 11:30 KST and both readers.
var wrnMsgDay = items(fixture('wrn-msg-0926'));
var at1130 = wrnMsgDay.filter(function (i) { return i.tmSeq === 128; })[0];
var bodies = {
    getPwnStatus: page([{other: at1130.other, t6: at1130.t6, t7: at1130.t7, tmFc: at1130.tmFc, tmSeq: at1130.tmSeq}]),
    getWthrWrnMsg: page(wrnMsgDay),
    getPwnCd: page(items(fixture('pwn-cd-0921-0927')).filter(function (r) { return r.tmFc < 202609261140; })),
    getWthrPwn: fixture('wthr-pwn'), getWthrInfo: fixture('wthr-info'), getWthrBrkNews: fixture('brk-news')
};
var request = function (url, opts, cb) {
    var op = url.split('?')[0].split('/').pop();
    setImmediate(function () { cb(null, {statusCode: 200}, plain(bodies[op])); });
};
var situationStatics = {parseSpecialText: Situation.parseSpecialText, parsePreliminaryText: Situation.parsePreliminaryText, TYPE_WEATHER_FLASH: 4};
var situations = memoryModel(situationStatics), zoneStore = memoryModel();
var Collector = load('lib/kmaWarningCollector.js', {async: async, './kmaWarningRequester': Requester, './kmaWarningZones': zones,
    '../models/modelKmaSpecialWeatherSituation': situations, '../models/modelKmaSpecialWeatherZone': zoneStore});
var Controller = load('controllers/kma.specialweather.controller.js', {async: async, '../models/modelKmaSpecialWeatherSituation': situations,
    '../models/modelKmaSpecialWeatherZone': zoneStore, '../lib/kmaWarningZones': zones});
var collector = new Collector({requester: new Requester({request: request})});
collector.gather(function (err) {
    assert.equal(err, undefined, String(err && err.message));
    assert.deepEqual(situations.docs.map(function (d) { return d.type; }).sort(), [1, 2, 3, 4]);
    var controller = new Controller();
    controller.getCurrent({__: function (s) { return s; }}, function (err, list) {
        assert.ifError(err);
        var t1 = list.filter(function (s) { return s.type === 1; })[0];
        assert.equal(new Date(t1.announcement).toISOString(), '2026-09-26T02:30:00.000Z');
        assert.equal(t1.bulletin.title, at1130.t1);
        controller.getSpecialInfo({first: '제주특별자치도', second: '서귀포시', third: '성산읍'}, '', function (err, info) {
            assert.ifError(err);
            assert.deepEqual(info.map(function (s) { return s.weatherStr + s.levelStr + '@' + s.locationName; }).slice(0, 2),
                ['호우경보@제주도산지', '호우주의보@서귀포시남부']);
            collector.gather(function (err) {
                assert.equal(err, 'skip');
                console.log('kma warning Node ' + process.version + ' check passed');
            });
        });
    });
});
