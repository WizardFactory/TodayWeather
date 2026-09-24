'use strict';
// Synthetic, offline module integration: real XML, requester events and storage
// controller exports. HTTP and Mongo boundaries are in-memory adapters.
var assert = require('assert');
var h = require('./harness');
var logs = [];
var log = h.logger(logs);
var time = h.load('lib/kmaTimeLib.js', {}, {log: log});
var records = [];
var model = {
    update: function (query, record, options, callback) {
        assert.strictEqual(options.upsert, true);
        records.push(record); callback();
    },
    find: function () {
        var query = {sort: function () { return query; }, batchSize: function () { return query; },
            lean: function () { return query; }, exec: function (callback) { callback(null, records); }};
        return query;
    }
};
var Short = h.load('controllers/kma/kma.town.short.controller.js', {
    async: require('async'), '../../models/kma/kma.town.short.model.js': model, '../../lib/kmaTimeLib': time
}, {log: log, commonString: ['date', 'time', 'mx', 'my'], shortString: ['r06', 's06', 't3h', 'sky', 'reh', 'pty']});
var short = new Short();
var callbacks = 0;
var body = h.xml(h.response(h.shortItems({PCP: '1.5mm', SNO: '0.5cm'})));
var collector = h.collector({get: function (url, options, callback) {
    assert(url.startsWith('http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?'));
    callback(null, {statusCode: 200}, body);
}}, logs);
collector.requestData([{mx: 60, my: 127}], collector.DATA_TYPE.TOWN_SHORT, 'OFFLINE_SMOKE_DUMMY', '20260924', '0800', function (err, results) {
    assert.strictEqual(err, false); assert(results[0].isCompleted);
    short.saveShort(results[0].data, function (err) {
        assert.ifError(err);
        short.getShortFromDB(null, {mx: 60, my: 127}, {}, function (err, result) {
            assert.ifError(err); assert.strictEqual(result.pubDate, '202609240800');
            var v = result.ret[0];
            assert.strictEqual(v.r06, 1.5); assert.strictEqual(v.s06, 0.5); assert.strictEqual(v.t3h, 12.5);
            assert.strictEqual(v.date, '20260924'); assert.strictEqual(v.time, '0900');
            assert.strictEqual(v.mx, 60); assert.strictEqual(v.my, 127); callbacks++;
        });
    });
});
assert.strictEqual(callbacks, 1); assert.strictEqual(records.length, 1);
assert.strictEqual(records[0].fcsDate.toISOString(), '2026-09-24T00:00:00.000Z');
var bad = h.collector({get: function (url, options, callback) {
    callback(null, {statusCode: 200}, '<response><header><resultCode>22</resultCode></header></response>');
}}, logs);
bad.requestData([{mx: 60, my: 127}], bad.DATA_TYPE.TOWN_SHORT, 'OFFLINE_SMOKE_DUMMY', '20260924', '0800', function (failed, results) {
    assert.strictEqual(failed, true); assert.strictEqual(results[0].isCompleted, false); callbacks++;
    if (results[0].isCompleted) short.saveShort(results[0].data, function () {});
});
assert.strictEqual(callbacks, 2); assert.strictEqual(records.length, 1);
assert(!logs.join('\n').includes('OFFLINE_SMOKE_DUMMY')); assert(!logs.join('\n').includes('serviceKey='));
console.log('PASS synthetic XML -> requester -> events -> saveShort -> getShortFromDB (1 write, exact quantities/timestamps/grid)');
console.log('PASS provider-error XML -> failed collection, no additional persistence; no key-bearing logs');
