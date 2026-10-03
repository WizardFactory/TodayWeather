/* UV V5 and pollen V3 provider-shape and response-enrichment contract (#2650).
 * node --test server/test/offline/life-index-2650.test.js
 * All imports run in a VM with isolated models; no server or provider starts.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const fixture = require('./fixtures/uv-idx-v5.json');
const pollenFixture = require('./fixtures/pollen-risk-v3.json');
const livePollenFixture = require('./fixtures/pollen-risk-v3-live-20261001.json');
const noop = function () {};
const log = {info: noop, warn: noop, error: noop, debug: noop, silly: noop};
function load(relative, dependencies) {
    const module = {exports: {}};
    const sandbox = {module, exports: module.exports, log, console, Date,
        require: name => /(?:^|\/)dataGoKrKeys$/.test(name) ? require('../../lib/dataGoKrKeys') : /(?:^|\/)dataGoKrRejection$/.test(name) ? require('../../lib/dataGoKrRejection') : dependencies[name] || function () {}};
    sandbox.global = sandbox;
    vm.runInNewContext(fs.readFileSync(path.join(root, relative), 'utf8'), sandbox, {filename: relative});
    return module.exports;
}
const time = require('../../lib/kmaTimeLib');
const Requester = load('lib/lifeIndexKmaRequester.js', {'../lib/kmaTimeLib': time});
const Controller = load('controllers/lifeIndexKmaController.js', {'../lib/kmaTimeLib': time});
const TownController = load('controllers/controllerTown.js', {
    '../controllers/lifeIndexKmaController': Controller
});

test('a current UV V5 response adds valid daily values and omits missing values', () => {
    const service = new Requester();
    const parsed = service.parseUvIdxV5(fixture);
    assert.equal(parsed.totalCount, 3851);
    const rows = service.convertUvItemsV5(parsed.items);
    const seoul = rows.filter(r => r.areaNo === 1100000000);
    assert.deepEqual(Array.from(seoul, r => r.index), [4, 7, 6]);
    const days = [{date: '20260926'}, {date: '20260927'}, {date: '20260929'}];
    Controller._addIndexData2(days, rows.filter(r => r.areaNo === 1100000000));
    assert.equal(days[0].ultrv, 4);
    assert.equal(days[0].ultrvGrade, 1);
    assert.equal(days[1].ultrv, 7);
    assert.equal('ultrv' in days[2], false);
    assert.equal('fsn' in days[0], false);
    Controller._addIndexData2(days, [{date: time.convertStringToDate('20260926'), indexType: 'ultrv', index: -1},
        {date: time.convertStringToDate('20260927'), indexType: 'fsn', index: 55}]);
    assert.equal(days[0].ultrv, 4, 'invalid UV cannot overwrite a valid value');
    assert.equal('fsn' in days[1], false, 'retired stored data stays out of the response');
});

test('current pollen V3 responses enrich all three species and omit absent grades', () => {
    const service = new Requester();
    const parsed = service.parseUvIdxV5(pollenFixture);
    assert.equal(parsed.totalCount, 2);
    const days = [{date: '20261001'}, {date: '20261002'}, {date: '20261003'}];
    for (const type of ['flowerWoody', 'flowerPine', 'flowerWeeds']) {
        const rows = service.convertPollenItemsV3(type, parsed.items)
            .filter(row => row.areaNo === 1100000000);
        Controller._addIndexData2(days, rows);
        assert.equal(days[0][type], 2);
        assert.equal(days[0][type + 'Grade'], 2);
        assert.equal(days[1][type], 3);
        assert.equal(type in days[2], false);
    }
    Controller._addIndexData2(days, [{date: time.convertStringToDate('20261001'),
        indexType: 'flowerWeeds', index: -1}]);
    assert.equal(days[0].flowerWeeds, 2);
    assert.match(service.getPollenUrlV3('flowerWeeds', '2026100100', 1, 'test'),
        /getWeedsPollenRiskndxV3\?/);
});

test('a live weeds response maps an empty today and zero tomorrow to the correct KST day', () => {
    const service = new Requester();
    const parsed = service.parseUvIdxV5(livePollenFixture, 'pollen v3');
    assert.equal(parsed.totalCount, 3851);
    const rows = service.convertPollenItemsV3('flowerWeeds', parsed.items);
    assert.equal(rows.length, 3);
    const days = [{date: '20260930'}, {date: '20261001'}, {date: '20261002'}];
    Controller._addIndexData2(days, rows.filter(row => row.areaNo === 1100000000));
    assert.equal('flowerWeeds' in days[0], false);
    assert.equal(days[1].flowerWeeds, 0);
    assert.equal('flowerWeeds' in days[2], false);
    assert.equal(service.parseUvIdxV5({response: {header: {resultCode: '99'}}}, 'pollen v3').noData, true);
});

test('pollen grades reject malformed values instead of coercing them to zero or one', () => {
    const service = new Requester();
    for (const raw of [' ', '\t', false, true, [], {}, '1.5']) {
        const rows = service.convertPollenItemsV3('flowerWeeds', [{
            areaNo: '1100000000', date: '2026100106', today: raw,
            tomorrow: '', theDayAfterTomorrow: ''
        }]);
        assert.equal(rows.length, 0, 'must omit malformed grade ' + JSON.stringify(raw));
    }
    assert.equal(service.convertPollenItemsV3('flowerWeeds', [{
        areaNo: '1100000000', date: '2026100106', today: ' 0 ', tomorrow: ''
    }]).length, 1, 'trimmed numeric provider text remains usable');
});

test('pollen task fetches every page and lets the provider decide off-season availability', async () => {
    const requested = [];
    const twoPage = structuredClone(pollenFixture);
    twoPage.response.body.items.item = Array.from({length: 1000}, (_, i) => ({
        areaNo: String(1100000000 + i), date: '2026100106', today: '0'
    }));
    twoPage.response.body.totalCount = 1001;
    const lastPage = structuredClone(pollenFixture);
    lastPage.response.body.items.item = [{areaNo: '1100001000', date: '2026100106', today: '0'}];
    lastPage.response.body.totalCount = 1001;
    lastPage.response.body.pageNo = 2;
    const request = (url, options, callback) => {
        requested.push(url);
        callback(null, {statusCode: 200}, url.includes('time=20260701')
            ? {response: {header: {resultCode: '99'}}}
            : url.includes('pageNo=1') ? twoPage : lastPage);
    };
    const asyncStub = {mapSeries(list, worker, done) {
        const results = [];
        let i = 0;
        const next = (err, value) => {
            if (err) return done(err, results);
            results.push(value);
            if (i === list.length) return done(null, results);
            worker(list[i++], next);
        };
        if (list.length === 0) return done(null, []);
        worker(list[i++], next);
    }};
    const Service = load('lib/lifeIndexKmaRequester.js', {
        request, async: asyncStub, '../lib/kmaTimeLib': time
    });
    const service = new Service();
    service.setServiceKey(['fixture-key-xxxxxxxxxxxxxxxxxxxx']);
    let saved;
    service.saveLifeIndex2 = (type, rows, cb) => { saved = {type, rows}; cb(null, rows.length); };
    await new Promise((resolve, reject) => service.taskPollenV3('flowerWeeds',
        new Date('2026-10-01T03:00:00Z'), err => err ? reject(err) : resolve()));
    assert.equal(requested.length, 2);
    assert.ok(requested.every(url => url.includes('time=2026100112')),
        'pollen query must use the current KST hour to see later publications');
    assert.equal(saved.type, 'flowerWeeds');
    assert.equal(saved.rows.length, 1001);
    const count = requested.length;
    await new Promise((resolve, reject) => service.taskPollenV3('flowerWeeds',
        new Date('2026-07-01T03:00:00Z'), err => err ? reject(err) : resolve()));
    assert.equal(requested.length, count + 1, 'off-season no-data must come from the provider');
    assert.equal(service.flowerWeeds.nextTime.toISOString(), '2026-07-01T09:10:00.000Z');
});

test('later pollen issuance on the same KST day replaces the earlier one', async () => {
    const requested = [];
    const saved = [];
    const request = (url, options, callback) => {
        const queryTime = new URL(url).searchParams.get('time');
        requested.push(queryTime);
        const issued = queryTime === '2026100112' ? '2026100106' : '2026100112';
        const body = structuredClone(pollenFixture);
        body.response.body.totalCount = 1;
        body.response.body.items.item = [{areaNo: '1100000000', date: issued, today: '1'}];
        callback(null, {statusCode: 200}, body);
    };
    const Service = load('lib/lifeIndexKmaRequester.js', {
        request, async: {mapSeries: (items, worker, done) => done(null, [])},
        '../lib/kmaTimeLib': time
    });
    const service = new Service();
    service.setServiceKey(['fixture-key-xxxxxxxxxxxxxxxxxxxx']);
    service.saveLifeIndex2 = (type, rows, callback) => {
        saved.push(rows[0].lastUpdateDate);
        callback(null, rows.length);
    };
    for (const instant of ['2026-10-01T03:00:00Z', '2026-10-01T06:00:00Z']) {
        await new Promise((resolve, reject) => service.taskPollenV3('flowerWeeds',
            new Date(instant), err => err ? reject(err) : resolve()));
    }
    assert.deepEqual(requested, ['2026100112', '2026100115']);
    assert.deepEqual(saved, ['2026100106', '2026100112']);
    assert.equal(service.flowerWeeds.lastIssued, '2026100112');
});

test('incomplete or duplicate pollen pages cannot mark an issuance complete', async () => {
    const first = structuredClone(pollenFixture);
    first.response.body.totalCount = 1001;
    first.response.body.items.item = Array.from({length: 1000}, (_, i) => ({
        areaNo: String(1100000000 + i), date: '2026100106', today: '0'
    }));
    const duplicate = structuredClone(pollenFixture);
    duplicate.response.body.totalCount = 1001;
    duplicate.response.body.pageNo = 2;
    duplicate.response.body.items.item = [{areaNo: '1100000000', date: '2026100106', today: '0'}];
    const wrongPage = structuredClone(duplicate);
    wrongPage.response.body.pageNo = 1;
    wrongPage.response.body.items.item[0].areaNo = '1100001000';
    const wrongCount = structuredClone(wrongPage);
    wrongCount.response.body.pageNo = 2;
    wrongCount.response.body.totalCount = 1002;
    const wrongIssue = structuredClone(wrongPage);
    wrongIssue.response.body.pageNo = 2;
    wrongIssue.response.body.items.item[0].date = '2026100112';
    const emptyPage = structuredClone(wrongPage);
    emptyPage.response.body.pageNo = 2;
    emptyPage.response.body.items.item = [];
    const asyncStub = {mapSeries(list, worker, done) {
        const results = [];
        function next(i) {
            if (i === list.length) return done(null, results);
            worker(list[i], (err, value) => {
                if (err) return done(err, results);
                results.push(value);
                next(i + 1);
            });
        }
        next(0);
    }};
    for (const second of [duplicate, wrongPage, wrongCount, wrongIssue, emptyPage]) {
        const request = (url, options, callback) => callback(null, {statusCode: 200},
            url.includes('pageNo=1') ? first : second);
        const Service = load('lib/lifeIndexKmaRequester.js', {
            request, async: asyncStub, '../lib/kmaTimeLib': time
        });
        const service = new Service();
        service.setServiceKey(['fixture-key-xxxxxxxxxxxxxxxxxxxx']);
        let saved = false;
        service.saveLifeIndex2 = (type, rows, cb) => { saved = true; cb(null, rows.length); };
        const err = await new Promise(resolve => service.taskPollenV3('flowerWeeds',
            new Date('2026-10-01T03:00:00Z'), resolve));
        assert.ok(err, 'partial publication must fail and retry');
        assert.equal(saved, false);
        assert.equal(service.flowerWeeds.lastIssued, undefined);
    }
});

test('pollen collection is due at the first KST day of each season', () => {
    const service = new Requester();
    for (const [name, instant] of [
        ['flowerWoody', '2027-03-31T15:00:00Z'],
        ['flowerPine', '2027-03-31T15:00:00Z'],
        ['flowerWeeds', '2027-07-31T15:00:00Z']
    ]) {
        const now = new Date(instant);
        service.setNextGetTime(name, new Date(now));
        assert.equal(service[name].nextTime.toISOString(), now.toISOString(), name + ' must keep the first KST day');
        assert.equal(service.checkGetTime(name, now), true, name + ' must not skip the season start');
    }
});

test('daily zero grades survive the current weather response and get labels', () => {
    const town = new TownController();
    const daily = [{date: '20261001', ultrv: 0, ultrvGrade: 0,
        flowerWeeds: 0, flowerWeedsGrade: 0}];
    const current = {date: '20261001'};
    town._appendLifeIndexToCurrent(current, [], daily);
    assert.equal(current.ultrv, 0);
    assert.equal(current.flowerWeeds, 0);
    const translate = {__: key => key};
    town._makeStrForKma(current, translate);
    assert.equal(current.ultrvStr, 'LOC_LOW');
    assert.equal(current.flowerWeedsStr, 'LOC_LOW');
});


test('unchanged pollen issuance keeps the due time and never writes a duplicate batch', async () => {
    const response = structuredClone(pollenFixture);
    response.response.body.totalCount = 1;
    response.response.body.items.item = [{areaNo: '1100000000', date: '2026100106', today: '1'}];
    const Service = load('lib/lifeIndexKmaRequester.js', {
        request: (url, options, callback) => callback(null, {statusCode: 200}, response),
        async: {mapSeries: (items, worker, done) => done(null, [])},
        '../lib/kmaTimeLib': time
    });
    const service = new Service();
    service.setServiceKey(['fixture-key-xxxxxxxxxxxxxxxxxxxx']);
    let writes = 0;
    service.saveLifeIndex2 = (type, rows, callback) => { writes++; callback(null, rows.length); };
    const collect = instant => new Promise((resolve, reject) => service.taskPollenV3('flowerWeeds',
        new Date(instant), (err, count) => err ? reject(err) : resolve(count)));
    assert.equal(await collect('2026-09-30T21:10:00Z'), 1);
    const due = service.flowerWeeds.nextTime;
    assert.equal(due.toISOString(), '2026-10-01T09:10:00.000Z');
    for (const instant of ['2026-10-01T09:10:00Z', '2026-10-01T10:10:00Z']) {
        assert.equal(await collect(instant), 0);
        assert.equal(service.flowerWeeds.nextTime, due, 'same issuance stays due for the next manager pass');
        assert.equal(service.flowerWeeds.lastIssued, '2026100106');
        assert.equal(writes, 1, 'only the initial complete batch is written');
    }
});
