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
        require: name => dependencies[name] || function () {}};
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

test('seasonal pollen task fetches every page, stores rows, and skips off-season calls', async () => {
    const requested = [];
    const twoPage = structuredClone(pollenFixture);
    twoPage.response.body.totalCount = 1001;
    const request = (url, options, callback) => {
        requested.push(url);
        callback(null, {statusCode: 200}, url.includes('pageNo=1')
            ? twoPage : pollenFixture);
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
    service.serviceKey = 'fixture-key';
    let saved;
    service.saveLifeIndex2 = (type, rows, cb) => { saved = {type, rows}; cb(null, rows.length); };
    await new Promise((resolve, reject) => service.taskPollenV3('flowerWeeds',
        new Date('2026-10-01T03:00:00Z'), err => err ? reject(err) : resolve()));
    assert.equal(requested.length, 2);
    assert.equal(saved.type, 'flowerWeeds');
    assert.equal(saved.rows.length, 10);
    const count = requested.length;
    await new Promise((resolve, reject) => service.taskPollenV3('flowerWeeds',
        new Date('2026-07-01T03:00:00Z'), err => err ? reject(err) : resolve()));
    assert.equal(requested.length, count);
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
