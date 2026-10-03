'use strict';
const assert = require('assert');
const fixture = require('./kma-query-fixture');
const h = require('./harness');
const Store = require('../../lib/history/store');
const policy = require('../../lib/history/policy');
const ReadCache = require('../../lib/history/readCache');
const call = (fn, ...args) => new Promise((resolve, reject) => fn(...args, (e, rows) => e ? reject(e) : resolve(rows)));
const town = {gCoord: {lat: 37.5665, lon: 126.978}};
const station = {stnId: '108', geo: [126.978, 37.5665], isCityWeather: true};
function history(f, enabled, reads) {
    return h.load('lib/history/service.js', {
        './policy': policy, './store': {create: () => ({read: async kind => {reads.push(kind); return [];}})},
        './provider': {}, './recovery': {}, './readCache': ReadCache,
        '../../config/config': {history: {readEnabled: enabled, stations: ['108']}},
        '../../models/modelKmaStnInfo': f.models.modelKmaStnInfo
    }, {setTimeout, clearTimeout});
}
async function main() {
    assert.strictEqual(typeof new fixture.mongoose.Query().maxTimeMS, 'undefined');
    assert.strictEqual(typeof new fixture.mongoose.Query().setOptions, 'function');
    const f = fixture.create({modelKmaStnInfo: [station], modelKmaStnHourly2: [{stnId: 108, t1h: 22.7}]});
    const c = f.controller();
    assert.strictEqual((await call(c.getStnList, [126.978, 37.5665], 1, true, 1))[0].stnId, '108');
    let q = f.queries[0].query;
    assert.deepStrictEqual(q._conditions, {geo: {$near: [126.978, 37.5665], $maxDistance: 1}, isCityWeather: true});
    assert.deepStrictEqual(q._fields, {_id: 0, __v: 0});
    assert.strictEqual(q.options.limit, 1);
    const from = new Date('2026-09-29T10:00:00Z');
    assert.strictEqual((await call(c.findHourlies2, '108', from))[0].t1h, 22.7);
    q = f.queries[1].query;
    assert.deepStrictEqual(q._conditions, {stnId: 108, date: {$gt: from}});
    assert.deepStrictEqual(q._fields, {_id: 0});
    assert.deepStrictEqual(q.options.sort, {date: 1});
    for (const error of [undefined, new Error('fixture database failure')]) {
        const failed = fixture.create({}, error).controller();
        await assert.rejects(call(failed.getStnList, null, null, false, 2), error ? /fixture database failure/ : /Fail to find stn/);
        await assert.rejects(call(failed.findHourlies2, '108', from), error ? /fixture database failure/ : /Fail to find hourlies/);
    }
    const reads = [];
    const result = await call(history(f, true, reads).loadForTown, town);
    assert.strictEqual(result.mapping.stationId, '108');
    assert.deepStrictEqual(reads.sort(), ['daily', 'hourly']);
    q = f.queries[2].query;
    assert.deepStrictEqual(q._conditions, {stnId: {$in: ['108']}, isCityWeather: true});
    assert.strictEqual(await call(history(f, false, []).loadForTown, town), null);
    const failed = fixture.create({}, new Error('fixture database failure'));
    assert.strictEqual((await call(history(failed, true, []).loadForTown, town)).reason, 'station-read-failed');
    // Native cursor API is intentionally different from Mongoose Query.
    const NativeCursor = require('mongodb').Cursor;
    assert.strictEqual(typeof NativeCursor.prototype.maxTimeMS, 'function');
    const options = {};
    const cursor = {sort(value) {options.sort = value; return this;}, maxTimeMS(value) {options.maxTimeMS = value; return this;}, toArray() {return Promise.resolve([]);}};
    const store = new Store({find(query) {options.query = query; return cursor;}}, {});
    assert.deepStrictEqual(await store.read('hourly', '108', '202609290000', '202609292300'), []);
    assert.deepStrictEqual(options.sort, {key: 1});
    assert.strictEqual(options.maxTimeMS, 2000);
    assert.deepStrictEqual(options.query._id, {$gte: policy.id('hourly', '108', '202609290000'), $lte: policy.id('hourly', '108', '202609292300')});
    console.log(JSON.stringify({outcome: 'passed', mongoose: fixture.mongoose.version, node: process.version,
        realQueries: f.queries.length + failed.queries.length, storage: 'fixture exec, no DB connection', nativeCursor: 'API and store chain verified'}));
}
main().catch(e => {console.error(e.stack); process.exitCode = 1;});
