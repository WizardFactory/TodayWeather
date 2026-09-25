'use strict';
// Synthetic, offline module integration: real XML, requester events and storage
// controller exports. HTTP and Mongo boundaries are in-memory adapters.
var assert = require('assert');
var h = require('./harness');
var logs = [];
var log = h.logger(logs);
var time = h.load('lib/kmaTimeLib.js', {}, {log: log});
function memoryModel(records) {
    return {
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
}
var records = [];
var model = memoryModel(records);
var Short = h.load('controllers/kma/kma.town.short.controller.js', {
    async: require('async'), '../../models/kma/kma.town.short.model.js': model, '../../lib/midForecastPolicy': require('../../lib/midForecastPolicy'),
    '../../lib/kmaTimeLib': time
}, {log: log, commonString: ['date', 'time', 'mx', 'my'], shortString: ['r06', 's06', 't3h', 'sky', 'reh', 'pty']});
var short = new Short();
var callbacks = 0;
var body = h.xml(h.response(h.shortItems({PCP: '1.5mm', SNO: '0.5cm'})));
var collector = h.collector({get: function (url, options, callback) {
    assert(url.startsWith('http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?'));
    assert.strictEqual(new URL(url).searchParams.get('serviceKey'), 'OFFLINE_SMOKE+a/b=');
    callback(null, {statusCode: 200}, body);
}}, logs);
collector.requestData([{mx: 60, my: 127}], collector.DATA_TYPE.TOWN_SHORT, 'OFFLINE_SMOKE%2Ba%2Fb%3D', '20260924', '0800', function (err, results) {
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

// A truncated page must never reach the actual storage controller, even when
// every group in its prefix is complete. No continuation HTTP is scheduled.
var partial = h.response(h.shortItems()); partial.response.body[0].totalCount = ['1000'];
var pageRequests = 0;
var paged = h.collector({get: function (url, options, callback) {
    pageRequests++; callback(null, {statusCode: 200}, h.xml(partial));
}}, logs);
paged.requestData([{mx: 60, my: 127}], paged.DATA_TYPE.TOWN_SHORT, 'OFFLINE_SMOKE+a/b=', '20260924', '0800', function (failed, results) {
    assert.strictEqual(failed, true); assert.strictEqual(results[0].isCompleted, false); callbacks++;
    if (results[0].isCompleted) short.saveShort(results[0].data, function () {});
});
assert.strictEqual(callbacks, 3); assert.strictEqual(records.length, 1); assert.strictEqual(pageRequests, 1);
assert(!logs.join(' ').includes('OFFLINE_SMOKE')); assert(!logs.join(' ').includes('serviceKey='));
console.log('PASS truncated XML page -> failed requestData -> no additional persistence; encoded/raw dummy keys safe');

// #2590: a 1,016-row short product spans two 999-row pages. Both pages are
// requested, merged and checked before the actual storage controller runs.
var pagedRecords = [];
var PagedShort = h.load('controllers/kma/kma.town.short.controller.js', {
    async: require('async'), '../../models/kma/kma.town.short.model.js': memoryModel(pagedRecords),
    '../../lib/midForecastPolicy': require('../../lib/midForecastPolicy'), '../../lib/kmaTimeLib': time
}, {log: log, commonString: ['date', 'time', 'mx', 'my'], shortString: ['r06', 's06', 't3h', 'sky', 'reh', 'pty']});
var twoPageRequests = [];
var twoPage = h.collector(h.pagedHttp(h.shortProduct(), twoPageRequests, null, true), logs);
twoPage.requestData([{mx: 60, my: 127}], twoPage.DATA_TYPE.TOWN_SHORT, 'OFFLINE_SMOKE+a/b=', '20260924', '0500', function (failed, results) {
    assert.strictEqual(failed, false); assert(results[0].isCompleted);
    new PagedShort().saveShort(results[0].data, function (err) {
        assert.ifError(err);
        new PagedShort().getShortFromDB(null, {mx: 60, my: 127}, {}, function (err, result) {
            assert.ifError(err); assert.strictEqual(result.pubDate, '202609240500');
            assert.strictEqual(result.ret.length, 84);
            var last = result.ret[83];
            assert.strictEqual(last.date + last.time, '202609271700');
            assert.strictEqual(last.t3h, 13); assert.strictEqual(last.reh, 60); callbacks++;
        });
    });
});
assert.strictEqual(callbacks, 4); assert.strictEqual(pagedRecords.length, 84);
assert.strictEqual(pagedRecords[83].fcsDate.toISOString(), '2026-09-27T08:00:00.000Z');
assert.deepStrictEqual(twoPageRequests.map(function (u) { return new URL(u).searchParams.get('pageNo'); }), ['1', '2']);
assert(!logs.join(' ').includes('OFFLINE_SMOKE')); assert(!logs.join(' ').includes('serviceKey='));
console.log('PASS 1,016-row short XML over pages 1-2 -> requestData -> saveShort -> getShortFromDB (84 hours, last 2026-09-27 17:00 KST)');

// Sea XML -> requester/events -> actual mid controller save with memory model.
var seaItem = {regId: ['11B00000']};
for (var day = 3; day <= 10; day++) {
    (day <= 7 ? ['Am', 'Pm'] : ['']).forEach(function (half) { seaItem['wf' + day + half] = ['Clear']; });
    (day <= 7 ? ['AAm', 'APm', 'BAm', 'BPm'] : ['A', 'B']).forEach(function (suffix, index) {
        seaItem['wh' + day + suffix] = [String(day + index / 10)];
    });
}
var seaRecords = [];
var seaModel = {
    update: function (query, doc, options, cb) { seaRecords.push(doc); cb(); },
    remove: function () { return {exec: function () {}}; }
};
var midDeps = {'../../lib/midForecastPolicy': require('../../lib/midForecastPolicy'), async: require('async'), '../../lib/midForecastPolicy': require('../../lib/midForecastPolicy'),
    '../../lib/kmaTimeLib': time};
['forecast', 'land', 'sea', 'temp'].forEach(function (type) {
    midDeps['../../models/kma/kma.town.mid.' + type + '.model.js'] = type === 'sea' ? seaModel : {};
});
var Mid = h.load('controllers/kma/kma.town.mid.controller.js', midDeps, {log: log});
var seaBody = h.xml(h.response([seaItem]));
var seaCollector = h.collector({get: function (url, options, cb) { cb(null, {statusCode: 200}, seaBody); }}, logs);
var seaCallbacks = 0;
function collectSea(expectFailure) {
    seaCollector.requestData([{code: '11B00000'}], seaCollector.DATA_TYPE.MID_SEA, 'OFFLINE_SMOKE+a/b=', '20260924', '0600', function (failed, results) {
        assert.strictEqual(failed, expectFailure); seaCallbacks++;
        if (results[0].isCompleted) {
            new Mid().saveMid('modelMidSea', results[0].data[0], true, function (err) { assert.ifError(err); });
        }
    });
}
collectSea(false);
assert.strictEqual(seaCallbacks, 1); assert.strictEqual(seaRecords.length, 1);
Object.keys(seaItem).filter(function (key) { return key.indexOf('wh') === 0; }).forEach(function (key) {
    assert.strictEqual(seaRecords[0].data[key], Number(seaItem[key][0]), key);
});
assert.strictEqual(seaRecords[0].pubDate.toISOString(), '2026-09-23T21:00:00.000Z');
seaItem.wh7BPm = ['NaN']; seaBody = h.xml(h.response([seaItem]));
collectSea(true);
assert.strictEqual(seaCallbacks, 2); assert.strictEqual(seaRecords.length, 1);
assert(!logs.join(' ').includes('OFFLINE_SMOKE')); assert(!logs.join(' ').includes('serviceKey='));
console.log('PASS sea XML -> requester -> events -> saveMid (26 distinct heights); later-day NaN prevents another write');
