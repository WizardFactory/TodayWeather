/* Node 10.15.3 compatibility check for the Visual Crossing path (#2585).
 * The service host runs Node 10.15.3 (docs/architecture/ec2-internals.md). node:test is not
 * available there, so this plain script loads the real converter, requester and DsfController in
 * a VM with in-memory models and a fixture requester, and runs the main flow.
 * Run: TZ=UTC NODE_PATH=<async> node server/test/offline/vc-node10-check.js
 * Keep this file to Node 10 syntax and APIs (no Object.fromEntries, Array#flat, ?. or ??).
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert'), zlib = require('zlib');
var async = require('async');
var root = path.resolve(__dirname, '../..');
var CAPTURED = Date.parse('2026-09-26T07:04:23Z');
var clock = CAPTURED;
var RealDate = Date;
function Clock() {
    var a = Array.prototype.slice.call(arguments);
    return a.length ? new (Function.prototype.bind.apply(RealDate, [null].concat(a)))() : new RealDate(clock);
}
Clock.now = function () { return clock; }; Clock.parse = RealDate.parse; Clock.UTC = RealDate.UTC; Clock.prototype = RealDate.prototype;
var lines = [];
var log = {};
['info', 'warn', 'error', 'debug', 'verbose', 'silly'].forEach(function (k) { log[k] = function (m) { lines.push(k + ' ' + m); }; });
function fixture(name) { return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'vc-' + name + '.json'), 'utf8')); }
function load(relative, deps, globals) {
    var module = {exports: {}};
    var sandbox = Object.assign({module: module, exports: module.exports, console: console, log: log, Date: Clock, Buffer: Buffer, Intl: Intl,
        setTimeout: setTimeout, clearTimeout: clearTimeout, setImmediate: setImmediate,
        require: function (name) { if (!(name in deps)) { throw new Error('Unstubbed ' + name); } return deps[name]; }}, globals || {});
    vm.runInNewContext(fs.readFileSync(path.join(root, relative), 'utf8'), sandbox, {filename: relative});
    return module.exports;
}
var v8 = require('v8');
var clone = function (v) { return v8.deserialize(v8.serialize(v)); };

// Requester: request shape and gzip decoding with a fake https.
var calls = [];
var fakeHttps = {
    Agent: function (o) { this.options = o; },
    get: function (url, options, onResponse) {
        calls.push(url);
        var EventEmitter = require('events');
        var req = new EventEmitter();
        req.destroy = function () {};
        setImmediate(function () {
            var res = new EventEmitter();
            res.statusCode = 200;
            res.headers = {'content-encoding': 'gzip'};
            onResponse(res);
            res.emit('data', zlib.gzipSync(Buffer.from(JSON.stringify(fixture('tokyo-forecast')))));
            res.emit('end');
        });
        return req;
    }
};
var VcRequester = load('lib/VC/vcRequester.js', {https: fakeHttps, zlib: zlib});
var converter = load('lib/VC/vcConverter.js', {});
var steps = [];
var completed = false;
// A callback that never fires lets Node exit with code 0 before the checks ran: fail instead.
process.on('exit', function () { if (!completed && !process.exitCode) { console.error('vc-node10-check did not complete'); process.exitCode = 1; } });

new VcRequester().getTimeline({lat: 35.68, lon: 139.76, range: 'forecast'}, 'NODE10CHECKKEY0123456789', function (err, body, meta) {
    assert.ifError(err);
    assert.equal(body.queryCost, 1);
    assert.equal(meta.cost, 1);
    assert(/timeline\/35\.68,139\.76\/today\/next7days\?/.test(calls[0]));
    steps.push('requester');

    ['tokyo', 'london', 'newyork'].forEach(function (name) {
        var docs = converter.toDarkSkyDocs(fixture(name + '-combined'), new RealDate(CAPTURED));
        assert.equal(docs.yesterday.hourly.data.length, 24, name);
        assert.equal(docs.current.daily.data.length, 8, name);
    });
    steps.push('converter');

    // Controller: combined, cache hit, forecast refresh; Intl zone offsets on this runtime.
    var rows = {}, locks = {}, usage = {};
    var model = {
        find: function (query) {
            var list = Object.keys(rows).map(function (k) { return rows[k]; }).filter(function (r) {
                return JSON.stringify(r.geo) === JSON.stringify(query.geo) && r.dateObj >= query.dateObj.$gte;
            }).map(clone);
            var q = {lean: function () { return q; }, sort: function () { list.sort(function (a, b) { return a.dateObj - b.dateObj; }); return q; },
                exec: function (cb) { setImmediate(function () { cb(null, list); }); }};
            return q;
        },
        update: function (query, doc, options, cb) { rows[JSON.stringify(query.geo) + new RealDate(query.dateObj).getTime()] = clone(Object.assign({}, doc, query)); setImmediate(cb); }
    };
    var lockModel = {
        create: function (doc, cb) { setImmediate(function () { if (locks[doc._id]) { var e = new Error('dup'); e.code = 11000; return cb(e); } locks[doc._id] = doc; cb(null); }); },
        findOneAndUpdate: function (f, u, o, cb) { setImmediate(function () { cb(null, null); }); },
        findById: function (id, cb) { setImmediate(function () { cb(null, locks[id] || null); }); },
        updateOne: function (f, u, o, cb) { (cb || o)(null); },
        deleteOne: function (f, cb) { delete locks[f._id]; setImmediate(function () { cb(null); }); }
    };
    var usageModel = {
        updateOne: function (f, u, o, cb) { var d = usage[f._id] || {}; Object.keys(u.$inc).forEach(function (k) { d[k] = (d[k] || 0) + u.$inc[k]; }); usage[f._id] = d; cb(null); },
        findById: function (id, cb) { cb(null, usage[id] || null); }
    };
    var ranges = [];
    function Fixture() {}
    Fixture.isValidKey = function () { return true; };
    Fixture.prototype.getTimeline = function (p, key, cb) {
        ranges.push(p.range);
        var body = p.range === 'combined' ? fixture('tokyo-combined') : fixture('tokyo-forecast');
        setImmediate(function () { cb(null, body, {status: 200, cost: body.queryCost, ms: 1}); });
    };
    var Controller = load('controllers/worldWeather/dsf.controller.js', {
        'async': async, '../../config/config': {keyString: {vc_key: 'NODE10CHECKKEY0123456789'}, vc: {dailyRecordLimit: 0}},
        '../../models/worldWeather/dsf.model': model, '../../models/worldWeather/vc.fetch.lock.model': lockModel,
        '../../models/worldWeather/vc.usage.model': usageModel, '../../lib/VC/vcRequester': Fixture,
        '../../lib/VC/vcConverter': converter, '../../lib/kmaTimeLib': load('lib/kmaTimeLib.js', {})
    });
    var get = function (cb) { new Controller().getDsfData({geocode: {lat: '35.68', lon: '139.76'}, sessionID: 'n10'}, new Clock(), cb); };
    async.series([
        function (cb) { get(function (err, res) { assert.ifError(err); assert.equal(res.data.length, 3); cb(); }); },
        function (cb) { clock += 10 * 60000; get(function (err) { assert.ifError(err); cb(); }); },
        function (cb) { clock += 10 * 60000; get(function (err) { assert.ifError(err); cb(); }); }
    ], function () {
        assert.deepEqual(ranges, ['combined', 'forecast']);
        assert.equal(usage['2026-09-26'].records, 26);
        var at = function (zone, offset, date) { return {address: {country: zone}, timeOffset: offset, dateObj: new RealDate(date)}; };
        var c = new Controller();
        assert.equal(c._offsetAt(at('Pacific/Auckland', 720, '2026-09-26T07:00:00Z'), new RealDate('2026-09-27T11:30:00Z')), 780, 'Intl zone offset');
        // Zone data this runtime lacks or has wrong (tzdata 2018e on 10.15.3): the stored offset stands.
        assert.equal(c._offsetAt(at('Asia/Almaty', 300, '2026-09-26T07:00:00Z'), new RealDate('2026-09-26T07:10:00Z')), 300, 'stale zone');
        assert.equal(c._offsetAt(at('Europe/Kyiv', 180, '2026-09-26T07:00:00Z'), new RealDate('2026-09-26T07:10:00Z')), 180, 'zone renamed after 2018');
        assert.equal(c._offsetAt(at('Invalid/Zone', 540, '2026-09-26T07:00:00Z'), new RealDate('2026-09-26T07:10:00Z')), 540, 'unknown zone');
        steps.push('controller', 'intl', 'stale/unknown zones');
        completed = true;
        console.log(JSON.stringify({outcome: 'passed', node: process.version, steps: steps}));
    });
});
