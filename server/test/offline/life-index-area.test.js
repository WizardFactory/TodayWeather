/* Administrative-area fallback (#2183): real controllers with isolated stores.
 * NODE_PATH=<isolated dependencies>/node_modules node server/test/offline/life-index-area.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const async = require('async');
const time = require('../../lib/kmaTimeLib');
function load(file, dependencies, logs) {
    const module = {exports: {}};
    const log = Object.fromEntries(['info', 'warn', 'error', 'debug', 'silly'].map(level =>
        [level, (...args) => logs.push({level, args})]));
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../controllers', file), 'utf8'), {
        module, exports: module.exports, log, Date, console,
        require: name => dependencies[name] || function () {}
    }, {filename: file});
    return module.exports;
}
function harness(options = {}) {
    const reads = [], geoQueries = [], logs = [];
    let mfds = 0, next = 0;
    const exact = {areaNo: 4119700000, geo: [126.8, 37.48]};
    const nearby = options.nearby || [exact, {areaNo: 4119900000}, {areaNo: 4119086000}];
    const rows = options.rows || {[4119086000]: [{areaNo: 4119086000,
        date: time.convertStringToDate('20261003'), indexType: 'ultrv', index: 0, lastUpdateDate: '2026100306'}]};
    const model = {find: ({areaNo}) => {
        reads.push(areaNo);
        return {batchSize: () => ({lean: () => ({exec: cb => setImmediate(() =>
            cb(options.errors && options.errors[areaNo], rows[areaNo] || []))})})};
    }};
    const controller = load('lifeIndexKmaController.js', {
        async, '../lib/kmaTimeLib': time, '../models/kma/kma.lifeindex.model': model
    }, logs);
    const areas = {find: query => {
        if (query.geo) { geoQueries.push(query); }
        return {limit: n => ({lean: () => ({exec: cb => setImmediate(() =>
            cb(query.geo ? options.nearAreaError : options.areaError, (query.geo ? nearby : options.noAddress ? [] : [exact]).slice(0, n)))})})};
    }};
    const Town = load('controllerTown.js', {async, '../lib/kmaTimeLib': time,
        '../models/modelAreaNo': areas, '../controllers/lifeIndexKmaController': controller,
        '../lib/foodPoisoning': {shared: () => ({append: (region, days, now, cb) => { mfds++; cb(); }})}
    }, logs);
    const req = {sessionID: 'area-regression', params: {region: '경기도', city: '부천시소사구', town: ''},
        gCoord: {lon: 126.81, lat: 37.49}, midData: {dailyData: [{date: '20261003'}]}, current: {date: '20261003'}};
    return {controller, req, reads, geoQueries, logs,
        run: () => new Promise(resolve => new Town().getLifeIndexKma(req, {}, () => {
            next++; resolve({mfds, next});
        }))};
}

test('missing exact and first nearby codes reach the next available index', async () => {
    const h = harness();
    assert.deepEqual(await h.run(), {mfds: 1, next: 1});
    assert.deepEqual(h.reads, [4119700000, 4119900000, 4119086000]);
    assert.equal(h.req.midData.dailyData[0].ultrv, 0);
    assert.equal(h.req.current.ultrv, 0);
    assert.equal(h.req.params.areaNo, 4119086000);
    assert.deepEqual(Array.from(h.geoQueries[0].geo.$near), [126.81, 37.49]);
    assert.equal(h.geoQueries[0].geo.$maxDistance, 0.3);
    assert.equal(h.logs.filter(x => x.level === 'warn').length, 0);
    const receipt = h.logs.find(x => x.args[0] && x.args[0].event === 'life-index-area-fallback');
    assert.equal(receipt.args[0].sID, 'area-regression');
    assert.equal(receipt.args[0].requestedAreaNo, 4119700000);
    assert.equal(receipt.args[0].resolvedAreaNo, 4119086000);
    assert.equal(receipt.args[0].result, 'resolved');
});

test('valid exact code does not query nearby areas', async () => {
    const h = harness();
    h.controller._fromLifeIndexDb2 = (areaNo, cb) => cb(null, [{areaNo,
        date: time.convertStringToDate('20261003'), indexType: 'ultrv', index: 4, lastUpdateDate: '2026100306'}]);
    await h.run();
    assert.equal(h.geoQueries.length, 0);
    assert.equal(h.req.current.ultrv, 4);
    assert.equal(h.req.params.areaNo, 4119700000);
});

test('unknown address uses coordinates and stops after the first available candidate', async () => {
    const h = harness({noAddress: true, nearby: [{areaNo: 4119086000}, {areaNo: 4119900000}]});
    await h.run();
    assert.deepEqual(h.reads, [4119086000]);
    assert.equal(h.req.current.ultrv, 0);
    assert.equal(h.req.params.areaNo, 4119086000);
});

test('all missing nearby records omit optional indices and still run MFDS and next', async () => {
    const h = harness({rows: {}, nearby: [1, 2, 3, 4].map(areaNo => ({areaNo}))});
    assert.deepEqual(await h.run(), {mfds: 1, next: 1});
    assert.deepEqual(h.reads, [4119700000, 1, 2, 3]);
    assert.equal('ultrv' in h.req.current, false);
    assert.equal(h.logs.filter(x => x.level === 'warn').length, 0);
});

test('DB failure stops candidate reads and remains an observable optional failure', async () => {
    const h = harness({errors: {[4119900000]: new Error('synthetic DB failure')}});
    assert.deepEqual(await h.run(), {mfds: 1, next: 1});
    assert.deepEqual(h.reads, [4119700000, 4119900000]);
    assert.equal('ultrv' in h.req.current, false);
    assert.equal(h.logs.filter(x => x.level === 'warn').length, 1);
});

test('missing records have a typed no-data error; DB errors retain their identity', async () => {
    const failure = new Error('synthetic DB failure');
    const h = harness({errors: {[4119900000]: failure}});
    const read = areaNo => new Promise(resolve => h.controller._fromLifeIndexDb2(areaNo, resolve));
    assert.equal((await read(4119700000)).code, 'LIFE_INDEX_NOT_FOUND');
    assert.equal(await read(4119900000), failure);
});


test('exact store failure does not start a geographic fallback', async () => {
    const h = harness({errors: {[4119700000]: new Error('synthetic exact DB failure')}});
    assert.deepEqual(await h.run(), {mfds: 1, next: 1});
    assert.deepEqual(h.reads, [4119700000]);
    assert.equal(h.geoQueries.length, 0);
    assert.equal(h.logs.filter(x => x.level === 'warn').length, 1);
});

test('empty nearby metadata omits indices without warning or extra store reads', async () => {
    const h = harness({nearby: []});
    assert.deepEqual(await h.run(), {mfds: 1, next: 1});
    assert.deepEqual(h.reads, [4119700000]);
    assert.equal(h.logs.filter(x => x.level === 'warn').length, 0);
    assert.equal('ultrv' in h.req.current, false);
});

test('nearest lookup failure continues the weather response and logs its cause', async () => {
    const h = harness({nearAreaError: new Error('synthetic metadata DB failure')});
    assert.deepEqual(await h.run(), {mfds: 1, next: 1});
    assert.equal('ultrv' in h.req.current, false);
    assert.deepEqual(h.reads, [4119700000]);
    assert.equal(h.geoQueries.length, 1);
    const warning = h.logs.find(x => x.level === 'warn');
    assert.equal(warning.args[0].message, 'synthetic metadata DB failure');
    assert.equal(warning.args[0].result, 'failed');
});

test('records without publication metadata are treated as no-data candidates', async () => {
    const h = harness({rows: {[4119900000]: [{indexType: 'ultrv', index: 4}]}});
    const err = await new Promise(resolve => h.controller._fromLifeIndexDb2(4119900000, resolve));
    assert.equal(err.code, 'LIFE_INDEX_NOT_FOUND');
});


test('missing request coordinates use exact metadata coordinates in longitude/latitude order', async () => {
    const h = harness();
    delete h.req.gCoord;
    await h.run();
    assert.deepEqual(Array.from(h.geoQueries[0].geo.$near), [126.8, 37.48]);
    assert.equal(h.req.current.ultrv, 0);
    assert.equal(h.req.geocode.lon, 126.8);
    assert.equal(h.req.geocode.lat, 37.48);
});

test('without address metadata or coordinates optional enrichment still completes once', async () => {
    const h = harness({noAddress: true});
    delete h.req.gCoord;
    assert.deepEqual(await h.run(), {mfds: 1, next: 1});
    assert.equal(h.geoQueries.length, 0);
    assert.equal(h.reads.length, 0);
    assert.equal('ultrv' in h.req.current, false);
});

test('nearby pollen preserves the integrated daily and current summary', async () => {
    const rows = {4119086000: ['flowerPine', 'flowerWeeds'].map((indexType, i) => ({
        areaNo: 4119086000, indexType, index: i * 2,
        date: time.convertStringToDate('20261003'), lastUpdateDate: '2026100306'
    }))};
    const h = harness({rows});
    assert.deepEqual(await h.run(), {mfds: 1, next: 1});
    for (const row of [h.req.midData.dailyData[0], h.req.current]) {
        assert.equal(row.flowerPine, 0);
        assert.equal(row.flowerWeeds, 2);
        assert.equal(row.pollenGrade, 2);
        assert.equal('flowerWoody' in row, false);
    }
});

test('R2183-1 address metadata DB failure stops all fallback reads and preserves optional continuation', async () => {
    const failure = new Error('synthetic address metadata DB failure');
    const h = harness({areaError: failure});
    assert.deepEqual(await h.run(), {mfds: 1, next: 1});
    assert.deepEqual(h.reads, []);
    assert.equal(h.geoQueries.length, 0);
    const warnings = h.logs.filter(x => x.level === 'warn');
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].args[0].event, 'life-index-area-fallback');
    assert.equal(warnings[0].args[0].sID, 'area-regression');
    assert.equal(warnings[0].args[0].message, failure.message);
    assert.equal(failure.message, 'synthetic address metadata DB failure');
});

test('R2183-2 unknown-address store failure records the attempted area code', async () => {
    const h = harness({noAddress: true, nearby: [{areaNo: 4119086000}],
        errors: {[4119086000]: new Error('generic store failure')}});
    assert.deepEqual(await h.run(), {mfds: 1, next: 1});
    const warnings = h.logs.filter(x => x.level === 'warn');
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].args[0].sID, 'area-regression');
    assert.deepEqual(Array.from(warnings[0].args[0].attemptedAreaNos), [4119086000]);
});

test('R2183-2 exact-address nearby failure records both attempted codes', async () => {
    const h = harness({errors: {[4119900000]: new Error('generic store failure')}});
    assert.deepEqual(await h.run(), {mfds: 1, next: 1});
    const warnings = h.logs.filter(x => x.level === 'warn');
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].args[0].requestedAreaNo, 4119700000);
    assert.deepEqual(Array.from(warnings[0].args[0].attemptedAreaNos), [4119700000, 4119900000]);
});

test('R2183-3 exact code with only past-date rows falls back to a nearby requested-date index', async () => {
    const past = areaNo => [{areaNo, date: time.convertStringToDate('20260901'),
        indexType: 'ultrv', index: 7, lastUpdateDate: '2026090106'}];
    const h = harness({rows: {[4119700000]: past(4119700000), [4119086000]: [{areaNo: 4119086000,
        date: time.convertStringToDate('20261003'), indexType: 'ultrv', index: 5, lastUpdateDate: '2026100306'}]}});
    assert.deepEqual(await h.run(), {mfds: 1, next: 1});
    assert.deepEqual(h.reads, [4119700000, 4119900000, 4119086000]);
    assert.equal(h.req.current.ultrv, 5);
    assert.equal(h.req.params.areaNo, 4119086000);
    assert.equal(h.logs.filter(x => x.level === 'warn').length, 0);
});

test('R2183-3 nearby code with only past-date or invalid rows does not stop the candidate walk', async () => {
    const h = harness({rows: {
        [4119900000]: [{areaNo: 4119900000, date: time.convertStringToDate('20260901'),
            indexType: 'ultrv', index: 7, lastUpdateDate: '2026090106'},
        {areaNo: 4119900000, date: time.convertStringToDate('20261003'),
            indexType: 'ultrv', index: -1, lastUpdateDate: '2026100306'}],
        [4119086000]: [{areaNo: 4119086000, date: time.convertStringToDate('20261003'),
            indexType: 'flowerPine', index: 1, lastUpdateDate: '2026100306'}]}});
    assert.deepEqual(await h.run(), {mfds: 1, next: 1});
    assert.deepEqual(h.reads, [4119700000, 4119900000, 4119086000]);
    assert.equal('ultrv' in h.req.current, false);
    assert.equal(h.req.current.flowerPine, 1);
    assert.equal(h.req.params.areaNo, 4119086000);
});

test('R2183-3 past-date rows in every candidate omit indices without warning', async () => {
    const past = areaNo => [{areaNo, date: time.convertStringToDate('20260901'),
        indexType: 'ultrv', index: 7, lastUpdateDate: '2026090106'}];
    const h = harness({rows: {[4119700000]: past(4119700000), [4119900000]: past(4119900000),
        [4119086000]: past(4119086000)}});
    assert.deepEqual(await h.run(), {mfds: 1, next: 1});
    assert.deepEqual(h.reads, [4119700000, 4119900000, 4119086000]);
    assert.equal('ultrv' in h.req.current, false);
    assert.equal(h.req.midData.dailyData[0].ultrv, undefined);
    assert.equal(h.logs.filter(x => x.level === 'warn').length, 0);
    const err = await new Promise(resolve => h.controller.appendData2(4119900000, [{date: '20261003'}], resolve));
    assert.equal(err.code, 'LIFE_INDEX_NOT_FOUND');
});
