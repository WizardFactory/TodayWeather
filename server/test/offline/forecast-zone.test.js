'use strict';
// Forecast-zone refresh from data.go.kr getFcstZoneCd (#2739). Synthetic responses only:
// the request function, the Mongoose model and the Manager dependencies are in-test doubles.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const async = require('async');
const h = require('./harness');
const managerHarness = require('./current-manager-harness');
const rejection = require('../../lib/dataGoKrRejection');

const keys = ['ZONE_FIRST%2BKEY' + 'x'.repeat(32), 'ZONE_SECOND%2FKEY' + 'y'.repeat(32)];
const ROWS = 1000;

// In-memory stand-in for KmaForecastZoneModel with the query operators the controller uses.
function matches(row, query) {
    return Object.keys(query).every(field => {
        const want = query[field], have = row[field];
        if (want && typeof want === 'object' && !Array.isArray(want)) {
            if ('$ne' in want) { return have !== want.$ne; }
            if ('$nin' in want) { return want.$nin.indexOf(have) === -1; }
            if ('$in' in want) { return want.$in.indexOf(have) !== -1; }
            throw new Error('Unsupported operator ' + JSON.stringify(want));
        }
        return have === want;
    });
}
function fakeModel(seed, options = {}) {
    const rows = (seed || []).map(row => Object.assign({}, row));
    const model = {rows, writes: 0};
    function apply(row, change) {
        Object.assign(row, change.$set || {});
        Object.keys(change.$unset || {}).forEach(field => delete row[field]);
    }
    model.update = (cond, change, opts, cb) => {
        if (typeof opts === 'function') { cb = opts; opts = {}; }
        model.writes++;
        if (options.failUpsert && cond.regId === options.failUpsert) {
            return setImmediate(() => cb(new Error('synthetic upsert failure')));
        }
        assert(change.$set, 'upsert uses $set');
        let row = rows.find(r => matches(r, cond));
        if (!row && opts.upsert) { row = Object.assign({}, cond); rows.push(row); }
        if (row) { apply(row, change); }
        setImmediate(() => cb(null, {n: row ? 1 : 0}));
    };
    model.updateOne = model.update;
    model.updateMany = (cond, change, cb) => {
        model.writes++;
        const hit = rows.filter(r => matches(r, cond));
        hit.forEach(r => apply(r, change));
        setImmediate(() => cb(null, {n: hit.length, nModified: hit.length}));
    };
    model.find = (query) => {
        const result = rows.filter(r => matches(r, query)).map(r => {
            const copy = Object.assign({}, r); delete copy._id; return copy;
        });
        return {lean: () => ({exec: cb => setImmediate(() => cb(null, result))})};
    };
    return model;
}

function item(regId, overrides) {
    return Object.assign({regId, lat: 37.5, lon: 127.0, regEn: '', regName: 'Z' + regId, regSp: 'C',
        regUp: '11B00000', seq: 1, stnF3: 0, tmEd: 210012310000, tmSt: 199001010000}, overrides);
}
function page(items, pageNo, extra) {
    return {body: {response: {header: {resultCode: '00', resultMsg: 'NORMAL_SERVICE'},
        body: Object.assign({dataType: 'JSON', items: {item: items}, pageNo, numOfRows: ROWS, totalCount: items.length}, extra)}}};
}
function noData() {
    return {body: {response: {header: {resultCode: '03', resultMsg: 'NO_DATA'}}}};
}
function ids(prefix, count) {
    return Array.from({length: count}, (_, i) => prefix + String(i).padStart(4, '0'));
}
// Each call consumes the next response; an error object simulates a transport failure.
function fakeRequest(responses) {
    const calls = [];
    const request = (url, options, cb) => {
        calls.push({url, options});
        const response = responses[Math.min(calls.length - 1, responses.length - 1)];
        setImmediate(() => response.error ? cb(response.error) :
            cb(null, {statusCode: response.status || 200, headers: response.headers || {}}, response.body));
    };
    request.calls = calls;
    return request;
}
function load(request, model, logs = []) {
    const Controller = h.load('controllers/kma/kma.forecast.zone.controller.js', {request, async, fs, path,
        '../../models/kma/kma.forecast.zone.model': model, '../../lib/dataGoKrRejection': rejection},
        {log: h.logger(logs), setImmediate, __dirname: path.resolve(__dirname, '../../controllers/kma')});
    return Controller;
}
function controller(responses, seed, options) {
    const logs = [], model = fakeModel(seed, options), request = fakeRequest(responses);
    const Controller = load(request, model, logs);
    return {ctrl: new Controller(keys), model, request, logs, Controller};
}
function assertSanitized(logs) {
    for (const line of logs) {
        for (const key of keys) {
            assert(!line.includes(key) && !line.includes(decodeURIComponent(key)), 'key in log: ' + line);
        }
        assert(!/apis\.data\.go\.kr|serviceKey=|https?:/i.test(line), 'URL in log: ' + line);
    }
}
const query = call => new URL(call.url).searchParams;
const run = async ctrl => { try { return {result: await ctrl.getFromKma()}; } catch (error) { return {error}; } };

test('multi-page fetch requests HTTPS getFcstZoneCd and stores every zone', async () => {
    const a = ids('11A', ROWS), b = ids('11B', ROWS), c = ids('11C', 5);
    const t = controller([page(a.map(id => item(id)), 1), page(b.map(id => item(id)), 2), page(c.map(id => item(id)), 3)]);
    const {error} = await run(t.ctrl);
    assert.ifError(error);
    assert.equal(t.request.calls.length, 3);
    t.request.calls.forEach((call, i) => {
        const u = new URL(call.url);
        assert.equal(u.protocol + '//' + u.host + u.pathname, 'https://apis.data.go.kr/1360000/FcstZoneInfoService/getFcstZoneCd');
        assert.equal(query(call).get('serviceKey'), decodeURIComponent(keys[0]));
        assert.equal(query(call).get('numOfRows'), String(ROWS));
        assert.equal(query(call).get('pageNo'), String(i + 1));
        assert.equal(query(call).get('dataType'), 'JSON');
        assert.equal(call.options.followRedirect, false);
    });
    assert.equal(t.model.rows.length, 2005);
    const stored = t.model.rows.find(r => r.regId === '11C0004');
    assert.deepEqual(Array.from(stored.geo), [127.0, 37.5]);
    assert.equal(stored.regSp, 'C');
    assertSanitized(t.logs);
});

test('a full last page ends at the following 03 NO_DATA page', async () => {
    const t = controller([page(ids('11A', ROWS).map(id => item(id)), 1), noData()]);
    assert.ifError((await run(t.ctrl)).error);
    assert.equal(t.request.calls.length, 2);
    assert.equal(t.model.rows.length, ROWS);
});

test('undocumented regSp and missing or zero coordinates are stored without geo', async () => {
    const t = controller([page([item('11BD0000', {regSp: '0', lat: 0, lon: 0}), item('11A00000', {regSp: 'A', lat: undefined, lon: undefined})], 1)],
        [{regId: '11BD0000', geo: [1, 2]}]);
    assert.ifError((await run(t.ctrl)).error);
    const aggregate = t.model.rows.find(r => r.regId === '11BD0000');
    assert.equal(aggregate.regSp, '0');
    assert.equal(aggregate.geo, undefined);
});

const failures = {
    'HTTP 307 redirect': [{status: 307, headers: {location: '/503.html'}, body: ''}],
    'resultCode 01': [{body: {response: {header: {resultCode: '01', resultMsg: 'APPLICATION_ERROR'}}}}],
    '03 on the first page': [noData()],
    'HTML body': [{body: '<html>503</html>'}],
    'missing items': [{body: {response: {header: {resultCode: '00'}, body: {pageNo: 1, numOfRows: ROWS, totalCount: 1}}}}],
    'items.item not an array': [{body: {response: {header: {resultCode: '00'}, body: {items: {item: item('11A00101')}, pageNo: 1, numOfRows: ROWS, totalCount: 1}}}}],
    'item without regName': [page([item('11A00101', {regName: ''})], 1)],
    'item without regSp': [page([item('11A00101', {regSp: undefined})], 1)],
    'totalCount differs from the page items': [page([item('11A00101')], 1, {totalCount: 2})],
    'echoed pageNo mismatch': [page([item('11A00101')], 2)],
    'echoed numOfRows mismatch': [page([item('11A00101')], 1, {numOfRows: 10})],
    'incomplete second page': [page(ids('11A', ROWS).map(id => item(id)), 1), page([item('11B0000'), item('11B0001')], 2, {totalCount: 3})],
    'duplicate regId across pages': [page(ids('11A', ROWS).map(id => item(id)), 1), page([item('11A0000')], 2)],
    'second-page transport failure': [page(ids('11A', ROWS).map(id => item(id)), 1), {error: new Error('socket hang up')}],
    // Review Z-R1-001: optional fields that cannot be stored must fail the whole fetch before any write.
    'item with a non-numeric seq': [page([item('11B10101'), item('11B10102', {seq: 'bad number'})], 1)],
    'item with a non-numeric tmEd': [page([item('11B10101'), item('11B10102', {tmEd: '2100-12-31'})], 1)],
    'item with an object stnF3': [page([item('11B10101'), item('11B10102', {stnF3: {code: 1}})], 1)],
    'item with a non-numeric lat': [page([item('11B10101'), item('11B10102', {lat: 'north'})], 1)],
    'item with a non-string regUp': [page([item('11B10101'), item('11B10102', {regUp: ['11B00000']})], 1)],
    'page limit exceeded': Array.from({length: 11}, (_, i) => page(ids('1' + String.fromCharCode(65 + i), ROWS).map(id => item(id)), i + 1))
};
for (const [name, responses] of Object.entries(failures)) {
    test('fails without writes: ' + name, async () => {
        const seed = [{regId: '11H10603', regName: '군위', regSp: 'C'}];
        const t = controller(responses, seed);
        const {error} = await run(t.ctrl);
        // The controller runs in a separate VM realm, so check the shape instead of instanceof.
        assert(error && typeof error.message === 'string', 'rejects');
        assert.equal(t.model.writes, 0);
        assert.deepEqual(t.model.rows, seed);
        assertSanitized(t.logs.concat(error.message));
        if (name === 'HTTP 307 redirect') { assert.equal(t.request.calls.length, 1, '3xx is not retried'); }
        if (name === 'page limit exceeded') { assert.equal(t.request.calls.length, 10); }
    });
}

// Review Z-R1-002: provider codes reach errors and logs only when they are short digit strings.
test('provider result codes cannot carry URLs or keys into errors or logs', async () => {
    const hostile = 'https://apis.data.go.kr/x?serviceKey=' + decodeURIComponent(keys[0]);
    for (const responses of [
        [{body: {response: {header: {resultCode: hostile}}}}],
        [{status: 500, body: {response: {header: {resultCode: hostile}}}}],
        [{status: 404, body: {OpenAPI_ServiceResponse: {cmmMsgHeader: {returnReasonCode: hostile}}}}],
        [page(ids('11A', ROWS).map(id => item(id)), 1), {body: {response: {header: {resultCode: hostile}}}}]]) {
        const t = controller(responses);
        const {error} = await run(t.ctrl);
        assert(error && typeof error.message === 'string');
        // controllerManager.startManager logs the rejected error object as is.
        t.logs.push(String(error), error.message, String(error.stack));
        assertSanitized(t.logs);
        assert(/code=invalid|resultCode invalid/.test(error.message), error.message);
        assert.equal(t.model.writes, 0);
    }
});

test('key rejection moves to the next DONGNAE_SECRET_KEYS entry', async () => {
    const denied = {status: 403, body: {OpenAPI_ServiceResponse: {cmmMsgHeader: {errMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', returnReasonCode: '30'}}}};
    const t = controller([denied, page([item('11B10101', {regName: '서울'})], 1)]);
    assert.ifError((await run(t.ctrl)).error);
    assert.deepEqual(t.request.calls.map(c => query(c).get('serviceKey')), keys.map(decodeURIComponent));
    assert.equal(t.model.rows.length, 1);
    assertSanitized(t.logs);
    const exhausted = controller([denied]);
    assert((await run(exhausted.ctrl)).error);
    assert.equal(exhausted.request.calls.length, 2);
    assert.equal(exhausted.model.writes, 0);
});

test('a complete fetch retires absent zones and restores returning ones; lookups hide retired rows', async () => {
    const seed = [{regId: '11H10603', regName: '군위', regSp: 'C'}, {regId: '11A00102', regName: '연평도', regSp: 'C', retired: true, retiredAt: new Date(0)}];
    const t = controller([page([item('11H10707', {regName: '군위'}), item('11A00102', {regName: '연평도'})], 1)], seed);
    assert.ifError((await run(t.ctrl)).error);
    const old = t.model.rows.find(r => r.regId === '11H10603');
    assert.equal(old.retired, true);
    assert.equal(Object.prototype.toString.call(old.retiredAt), '[object Date]');
    assert.equal(t.model.rows.find(r => r.regId === '11A00102').retired, undefined);
    const found = await new Promise(resolve => t.ctrl.findForecastZoneCode({regName: '군위'}).exec((e, rows) => resolve(rows)));
    assert.deepEqual(found.map(r => r.regId), ['11H10707']);
});

test('an upsert failure leaves every other row unretired', async () => {
    const seed = [{regId: '11H10603', regName: '군위', regSp: 'C'}];
    const t = controller([page([item('11H10707', {regName: '군위'}), item('11B10101')], 1)], seed, {failUpsert: '11B10101'});
    assert((await run(t.ctrl)).error);
    assert.equal(t.model.rows.find(r => r.regId === '11H10603').retired, undefined);
});

const guideZones = [
    ['11B10101', '서울'], ['11F20501', '광주'], ['11B20702', '광주'], ['11D20402', '고성'], ['11H20404', '고성'],
    ['11H10701', '대구'], ['11H10707', '군위'], ['11B20101', '강화'], ['11B20201', '인천']
].map(([regId, regName]) => ({regId, regName, regSp: 'C'})).concat([{regId: '11H10603', regName: '군위', regSp: 'C', retired: true}]);
const lookup = (ctrl, region, city) => new Promise((resolve, reject) =>
    ctrl.findForecastZoneByName(region, city).exec((err, rows) => err ? reject(err) : resolve(rows.map(r => r.regId))));
test('town mapping returns the guide codes, including 군위 for both provinces', async () => {
    const t = controller([], guideZones);
    for (const [region, city, expected] of [
        ['서울특별시', '강남구', '11B10101'], ['광주광역시', '북구', '11F20501'], ['경기도', '광주시', '11B20702'],
        ['강원특별자치도', '고성군', '11D20402'], ['경상남도', '고성군', '11H20404'], ['경상북도', '군위군', '11H10707'],
        ['대구광역시', '군위군', '11H10707'], ['대구광역시', '수성구', '11H10701'], ['인천광역시', '강화군', '11B20101']]) {
        assert.deepEqual(await lookup(t.ctrl, region, city), [expected], region + ' ' + city);
    }
});

test('the land-zone file lists the 240715 guide land zones with 종료/신설 applied', () => {
    const t = controller([]);
    const land = t.Controller.landZoneIds();
    assert.equal(land.size, 176);
    assert(land.has('11H10707'));
    assert(!land.has('11H10603'));
    assert(!land.has('11A00102'));
    assert(fs.readFileSync(path.resolve(__dirname, '../../utils/data/kma_forecast_land_zones.csv'), 'utf8').includes('구역목록(240715)'));
});

test('mid-term temperature collection requests getMidTa only for listed, active zones', async () => {
    const seed = [
        {regId: '11B10101', regName: '서울', regSp: 'C'}, {regId: '11A00102', regName: '연평도', regSp: 'C'},
        {regId: '11D20101', regName: '설악', regSp: 'C'}, {regId: '11H10707', regName: '군위', regSp: 'C'},
        {regId: '11H10603', regName: '군위', regSp: 'C', retired: true}, {regId: '11B00000', regName: '서울.인천.경기도', regSp: 'A'}];
    const model = fakeModel(seed);
    const Zone = load(fakeRequest([]), model);
    const {m} = managerHarness.load({'./kma/kma.forecast.zone.controller': Zone});
    m.getWorldTime = () => '202610141000';
    m.kmaTownMid = {checkTempPubDate: (db, list, date, cb) => cb(null, list)};
    let requested;
    m._recursiveRequestData = (list, type, key, date, retry, options, cb) => { requested = list; cb(null, []); };
    await new Promise((resolve, reject) => m.getMidTempByForecastZone(9, 'unused', err => err ? reject(err) : resolve()));
    assert.deepEqual(requested.map(z => z.code).sort(), ['11B10101', '11H10707']);
    assert(requested.every(z => Zone.landZoneIds().has(z.code)));
});
