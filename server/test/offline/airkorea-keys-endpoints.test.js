'use strict';
// #2636 follow-up: usable key selection and supported station-list/forecast/nearby operations.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {harness, invoke} = require('./airkorea-harness');
const Api = require('../../lib/airkoreaObservation');

function fixture(name) { return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/airkorea', name + '.json'))); }
// Values created inside the loader's VM realm compare structurally after a JSON round trip.
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function keyOf(url) { return new URL(url).searchParams.get('serviceKey'); }
function transport(responder) {
    const state = {calls: [], keys: []};
    state.get = (url, options, cb) => {
        state.calls.push(String(url)); state.keys.push(keyOf(url));
        const request = new EventEmitter(); request.destroy = () => {};
        setImmediate(() => {
            const answer = responder(String(url), state.calls.length);
            if (answer.hang) return;
            const response = new EventEmitter(); response.statusCode = answer.status || 200; response.destroy = () => {};
            cb(response);
            setTimeout(() => {
                response.emit('data', Buffer.from(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body || {})));
                response.emit('end');
            }, answer.delay || 0);
        });
        return request;
    };
    return state;
}
// Gateway bodies as returned by apis.data.go.kr on 2026-10-13 for expired and unregistered keys.
function gateway(errMsg, code) {
    return {OpenAPI_ServiceResponse: {cmmMsgHeader: {errMsg: 'SERVICE ERROR', returnAuthMsg: errMsg, returnReasonCode: code}}};
}
const EXPIRED = {status: 401, body: gateway('DEADLINE_HAS_EXPIRED_ERROR', '31')};
const UNREGISTERED = {status: 403, body: gateway('SERVICE_KEY_IS_NOT_REGISTERED_ERROR', '30')};
const KEYS = ['synthetic-k0', 'synthetic-k1', 'synthetic-k2'];

test('invalid credentials are skipped from the last key downward; the working key is reused', async () => {
    const rejected = [];
    const t = transport(url => ({'synthetic-k2': EXPIRED, 'synthetic-k1': UNREGISTERED}[keyOf(url)] || {body: fixture('stations')}));
    const api = Api.create({transport: t, onKeyRejected: (op, index, code) => rejected.push([op, index, code])});
    const first = await invoke(api, 'fetchWithKeys', KEYS, '서울', Api.STATION);
    assert.equal(first.list.length, 4);
    assert.deepEqual(t.keys, ['synthetic-k2', 'synthetic-k1', 'synthetic-k0']);
    assert.deepEqual(rejected, [[Api.STATION, 2, 'PROVIDER_31'], [Api.STATION, 1, 'PROVIDER_30']]);
    await invoke(api, 'fetchWithKeys', KEYS, '부산', Api.STATION).catch(() => {});
    assert.equal(t.keys[3], 'synthetic-k0', 'remembered working key is tried first');
});

test('a remembered key that later expires wraps around to the remaining keys', async () => {
    let expiredK0 = false;
    const t = transport(url => {
        const key = keyOf(url);
        if (key === 'synthetic-k0' && expiredK0) return EXPIRED;
        if (key === 'synthetic-k0' || key === 'synthetic-k2') return {body: fixture('stations')};
        return UNREGISTERED;
    });
    const api = Api.create({transport: t});
    await invoke(api, 'fetchWithKeys', ['synthetic-k0', 'synthetic-k1'], '서울', Api.STATION);
    expiredK0 = true;
    await invoke(api, 'fetchWithKeys', KEYS, '서울', Api.STATION);
    assert.deepEqual(t.keys.slice(-2), ['synthetic-k0', 'synthetic-k2']);
});

test('quota, timeout, server and payload failures never move to another key', async () => {
    const cases = [
        [{body: {response: {header: {resultCode: '22', resultMsg: 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR'}}}}, /PROVIDER_22/, 1],
        [{body: gateway('LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR', '22'), status: 429}, /HTTP_429|PROVIDER_22/, 1],
        [{status: 503}, /HTTP_503/, 2],
        [{body: {response: {header: {resultCode: '00'}, body: {items: 'bad'}}}}, /INVALID_ITEMS/, 1],
        [{hang: true}, /TIMEOUT/, 2]
    ];
    for (const [answer, pattern, calls] of cases) {
        const t = transport(() => answer);
        await assert.rejects(invoke(Api.create({transport: t, timeoutMs: 10}), 'fetchWithKeys', KEYS, '서울', Api.STATION), pattern);
        assert.equal(t.calls.length, calls);
        assert.deepEqual([...new Set(t.keys)], ['synthetic-k2']);
    }
});

test('all invalid keys end with NO_VALID_KEY without key text; placeholders cost no HTTP call', async () => {
    const t = transport(url => keyOf(url) === 'synthetic-k1' ? EXPIRED : UNREGISTERED);
    const err = await invoke(Api.create({transport: t}), 'fetchWithKeys', KEYS, '서울', Api.STATION).catch(e => e);
    assert.equal(err.code, 'NO_VALID_KEY'); assert.equal(t.calls.length, 3);
    assert(!JSON.stringify({m: err.message, s: err.stack, e: err}).includes('synthetic'));
    const none = transport(() => assert.fail('network forbidden'));
    await assert.rejects(invoke(Api.create({transport: none}), 'fetchWithKeys', ['key1', 'key2', '', '%zz'], '서울', Api.STATION), /NO_VALID_KEY/);
    await assert.rejects(invoke(Api.create({transport: none}), 'fetchWithKeys', [], '서울', Api.STATION), /NO_KEY/);
    assert.equal(none.calls.length, 0);
});

test('keco station collection uses every configured key and logs only index and code', async () => {
    const h = harness();
    const t = transport(url => keyOf(url) === 'synthetic-k2' ? EXPIRED : {body: fixture('stations')});
    h.keco._observationApi = Api.create({transport: t, onKeyRejected: h.keco._onKeyRejected});
    h.keco.setServiceKeys(KEYS); h.keco._sidoList = ['서울'];
    await invoke(h.keco, 'cbKecoProcess', h.keco);
    assert.equal(h.stationWrites.length, 3);
    const logs = JSON.stringify(h.logs);
    assert(logs.includes('KEY_REJECTED') && logs.includes('PROVIDER_31'));
    assert(!logs.includes('synthetic'));
});

test('station list uses the supported service, pages completely and keeps geo [lon, lat]', async () => {
    const writes = [];
    const h = harness({overrides: {'models/modelMsrStnInfo.js': {update(q, row, opts, cb) { writes.push(row); cb(null, {ok: 1}); }}}});
    const t = transport(url => {
        const page = Number(new URL(url).searchParams.get('pageNo'));
        const data = fixture('msrstn'); data.response.body.numOfRows = 2; data.response.body.pageNo = page;
        data.response.body.items = data.response.body.items.slice((page - 1) * 2, page * 2);
        return {body: data};
    });
    h.keco._observationApi = Api.create({transport: t, pageSize: 2}); h.keco.setServiceKeys(['synthetic+key/=']);
    await invoke(h.keco, 'getAllMsrStnInfo');
    const u = new URL(t.calls[0]);
    assert.equal(u.origin + u.pathname, 'https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getMsrstnList');
    assert.equal(u.searchParams.get('serviceKey'), 'synthetic+key/=');
    assert.equal(u.searchParams.get('returnType'), 'json');
    assert.equal(u.searchParams.get('ver'), null);
    assert.equal(t.calls.length, 2); assert.equal(writes.length, 3);
    const gangnam = writes.find(w => w.stationName === '강남구');
    assert.deepEqual(plain(gangnam.geo), [127.049357, 37.515336]);
    assert.equal(gangnam.item.length, 6); assert.equal(gangnam.mangName, '도시대기');
});

test('dust forecast uses the supported service with searchDate and keeps the stored document shape', async () => {
    const saved = [];
    function Frcst(doc) { this.doc = doc; }
    Frcst.prototype.save = function (cb) { saved.push(this.doc); cb(null); };
    Frcst.find = () => ({lean: () => ({exec: cb => cb(null, [])}), exec: cb => cb(null, [])});
    Frcst.remove = (q, cb) => cb && cb(null);
    const ran = [];
    const h = harness({overrides: {
        'models/modelMinuDustFrcst.js': Frcst,
        'controllers/airkorea.hourly.forecast.controller.js': function () { this.do = time => ran.push(time); },
        'lib/kmaTimeLib.js': {toTimeZone: () => new Date(2026, 9, 13, 23, 30), convertDateToYYYY_MM_DD: () => '2026-10-13'}
    }});
    const t = transport(() => ({body: fixture('frcst')}));
    h.keco._observationApi = Api.create({transport: t}); h.keco.setServiceKeys(['synthetic']);
    await invoke(h.keco, 'getMinuDustFrcstDspth');
    const u = new URL(t.calls[0]);
    assert.equal(u.origin + u.pathname, 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMinuDustFrcstDspth');
    assert.equal(u.searchParams.get('searchDate'), '2026-10-13'); assert.equal(u.searchParams.get('ver'), '1.1');
    assert.equal(saved.length, 4);
    assert.equal(saved[0].dataTime, '2026-10-13 23시 발표'); assert.equal(saved[0].informCode, 'PM10');
    assert.deepEqual(plain(saved[0].informGrade[0]), {region: '서울', grade: '좋음'});
    assert.equal(saved[0].imageUrl.length, 9);
    assert.deepEqual(ran, ['2026-10-13 23시 발표']);
});

test('nearby station uses the supported service with TM coordinates and returns the nearest name', async () => {
    const h = harness();
    const t = transport(() => ({body: fixture('nearby')}));
    h.keco._observationApi = Api.create({transport: t}); h.keco.setServiceKeys(['synthetic']);
    const body = await invoke(h.keco, 'getNearbyMsrstn', '453586.837449', '198245.053183');
    const u = new URL(t.calls[0]);
    assert.equal(u.origin + u.pathname, 'https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getNearbyMsrstnList');
    assert.equal(u.searchParams.get('tmX'), '198245.053183'); assert.equal(u.searchParams.get('tmY'), '453586.837449');
    assert.equal(await invoke(h.keco, 'getStationNameFromMsrstn', body), '종로');
});

// The provider pages forecast and nearby results like the others (default 10 rows), although the
// forecast document says date searches ignore paging; observed on 2026-10-13 as totalCount 28 with 10 items.
test('forecast and nearby request pages and assemble every page; partial or empty results are rejected', async () => {
    for (const [op, name, params] of [[Api.FORECAST, 'frcst', {searchDate: '2026-10-13'}], [Api.NEARBY, 'nearby', {tmX: '1', tmY: '2'}]]) {
        const t = transport(url => {
            const u = new URL(url), page = Number(u.searchParams.get('pageNo')), size = Number(u.searchParams.get('numOfRows'));
            const data = fixture(name), items = data.response.body.items;
            Object.assign(data.response.body, {pageNo: page, numOfRows: size, totalCount: items.length, items: items.slice((page - 1) * size, page * size)});
            return {body: data};
        });
        const result = await invoke(Api.create({transport: t, pageSize: 2}), 'query', op, 'synthetic', params);
        assert.equal(result.list.length, fixture(name).response.body.items.length, op);
        assert.equal(t.calls.length, 2, op);
        assert.equal(new URL(t.calls[0]).searchParams.get('numOfRows'), '2');
    }
    function answer(change) { const data = fixture('frcst'); change(data); return () => ({body: data}); }
    const query = t => invoke(Api.create({transport: t}), 'query', Api.FORECAST, 'synthetic', {searchDate: '2026-10-13'});
    // Default provider paging: 10 of 28 items.
    await assert.rejects(query(transport(answer(d => { Object.assign(d.response.body, {numOfRows: 10, totalCount: 28}); }))), /INCOMPLETE_PAGE/);
    await assert.rejects(query(transport(answer(d => { d.response.header.resultCode = '03'; }))), /PROVIDER_03/);
    await assert.rejects(query(transport(answer(d => { Object.assign(d.response.body, {items: [], totalCount: 0}); }))), /EMPTY_ITEMS/);
    await assert.rejects(invoke(Api.create({transport: transport(() => assert.fail('network'))}), 'query', 'getTMStdrCrdnt', 'synthetic', {}), /INVALID_OPERATION/);
});

test('provider serviceKey echoes are removed from returned items', async () => {
    const data = fixture('sido'); data.response.body.items.forEach(item => { item.serviceKey = 'synthetic-echo'; });
    const result = await invoke(Api.create({transport: transport(() => ({body: data}))}), 'fetch', '서울', 'synthetic', Api.SIDO);
    assert(!JSON.stringify(result).includes('synthetic-echo'));
});

test('no runtime request to the retired openapi.airkorea.or.kr host remains', () => {
    for (const file of ['lib/kecoRequester.js', 'lib/airkoreaObservation.js']) {
        const source = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
        assert(!source.includes('openapi.airkorea.or.kr'), file);
        assert(!/require\(['"]request['"]\)/.test(source), file);
    }
});

// Review round 1 (PR #2737).
test('R1: a 401/403 with a regular JSON or XML envelope keeps its provider code; quota never switches keys', async () => {
    const envelope = code => ({response: {header: {resultCode: code, resultMsg: 'synthetic'}}});
    for (const [answer, pattern, calls] of [
        [{status: 401, body: envelope('22')}, /PROVIDER_22/, 1],
        [{status: 403, body: envelope('22')}, /PROVIDER_22/, 1],
        [{status: 401, body: '<response><header><resultCode>22</resultCode></header></response>'}, /PROVIDER_22/, 1],
        [{status: 403, body: gateway('LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR', '22')}, /PROVIDER_22/, 1],
        [{status: 403, body: envelope('30')}, /NO_VALID_KEY/, 3],
        [{status: 401, body: envelope('99')}, /PROVIDER_99/, 1],
        // Review round 2: XML and gateway-JSON bodies keep non-credential codes too.
        [{status: 403, body: '<response><header><resultCode>99</resultCode></header></response>'}, /PROVIDER_99/, 1],
        [{status: 403, body: gateway('SERVICE ERROR', '99')}, /PROVIDER_99/, 1],
        [{status: 403, body: gateway('SERVICE ERROR', '77')}, /PROVIDER_ERROR/, 1],
        [{status: 401, body: '<OpenAPI_ServiceResponse><returnReasonCode>31</returnReasonCode></OpenAPI_ServiceResponse>'}, /NO_VALID_KEY/, 3]
    ]) {
        const t = transport(() => answer);
        await assert.rejects(invoke(Api.create({transport: t}), 'fetchWithKeys', KEYS, '서울', Api.STATION), pattern);
        assert.equal(t.calls.length, calls, JSON.stringify(answer.body));
    }
});

test('R2: malformed station-list, forecast and nearby items fail with INVALID_ITEM before any consumer', async () => {
    const cases = [
        [Api.STATION_LIST, 'msrstn', [null], [{}], [{stationName: '', dmX: '37', dmY: '127'}], [{stationName: 'x', dmX: {}, dmY: '127'}],
            [{stationName: 'x', dmX: '', dmY: '', addr: 123}]],
        [Api.FORECAST, 'frcst', [null], [{dataTime: '2026-10-13 23시 발표', informCode: 'PM10', informData: '2026-10-13'}]],
        [Api.NEARBY, 'nearby', [null], [{}], [{stationName: 7}]]
    ];
    for (const [op, name, ...variants] of cases) {
        for (const items of variants) {
            const data = fixture(name); Object.assign(data.response.body, {items, totalCount: items.length, numOfRows: 100, pageNo: 1});
            await assert.rejects(invoke(Api.create({transport: transport(() => ({body: data}))}), 'query', op, 'synthetic', {}), /INVALID_ITEM/, op);
        }
    }
});

test('R2: an invalid item stops station-list and forecast collection once, without writes', async () => {
    const writes = [], saved = [];
    function Frcst(doc) { this.doc = doc; }
    Frcst.prototype.save = function (cb) { saved.push(this.doc); cb(null); };
    Frcst.find = () => ({lean: () => ({exec: cb => cb(null, [])}), exec: cb => cb(null, [])});
    Frcst.remove = (q, cb) => cb && cb(null);
    const h = harness({overrides: {
        'models/modelMsrStnInfo.js': {update(q, row, opts, cb) { writes.push(row); cb(null, {ok: 1}); }},
        'models/modelMinuDustFrcst.js': Frcst,
        'controllers/airkorea.hourly.forecast.controller.js': function () { this.do = () => {}; },
        'lib/kmaTimeLib.js': {toTimeZone: () => new Date(2026, 9, 13, 23, 30), convertDateToYYYY_MM_DD: () => '2026-10-13'}
    }});
    const t = transport(url => {
        const data = fixture(url.includes('getMsrstnList') ? 'msrstn' : 'frcst');
        Object.assign(data.response.body, {numOfRows: 100, pageNo: 1});
        data.response.body.items[1] = null;
        return {body: data};
    });
    // Review round 2: an empty-coordinate station with a non-string address used to throw in the geocoding step.
    const addressCase = transport(() => {
        const data = fixture('msrstn'); Object.assign(data.response.body, {numOfRows: 100, pageNo: 1});
        Object.assign(data.response.body.items[0], {dmX: '', dmY: '', addr: 123});
        return {body: data};
    });
    h.keco._observationApi = Api.create({transport: addressCase}); h.keco.setServiceKeys(['synthetic']);
    {
        let calls = 0, error;
        await new Promise(resolve => { h.keco.getAllMsrStnInfo(err => { calls++; error = err; resolve(); }); });
        await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(calls, 1); assert.equal(error && error.code, 'INVALID_ITEM');
    }
    h.keco._observationApi = Api.create({transport: t}); h.keco.setServiceKeys(['synthetic']);
    for (const method of ['getAllMsrStnInfo', 'getMinuDustFrcstDspth']) {
        let calls = 0, error;
        await new Promise(resolve => { h.keco[method]((err) => { calls++; error = err; resolve(); }); });
        await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(calls, 1, method); assert.match(String(error && error.code), /INVALID_ITEM/, method);
    }
    assert.equal(writes.length, 0); assert.equal(saved.length, 0);
});

test('R3: key failover shares one budget across keys, pages and retries', async () => {
    const t = transport(() => ({status: 401, body: gateway('DEADLINE_HAS_EXPIRED_ERROR', '31'), delay: 40}));
    const start = Date.now();
    await assert.rejects(invoke(Api.create({transport: t, budgetMs: 60}), 'fetchWithKeys', KEYS, '서울', Api.STATION), /COLLECTION_LIMIT|TIMEOUT/);
    assert(Date.now() - start < 100, 'elapsed ' + (Date.now() - start));
    assert(t.calls.length <= 2, 'calls ' + t.calls.length);
});
