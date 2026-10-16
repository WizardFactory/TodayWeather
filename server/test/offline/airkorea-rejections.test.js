'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {harness, invoke} = require('./airkorea-harness');
const Api = require('../../lib/airkoreaObservation');
const recorded = require('./fixtures/airkorea/rejections-20261016.json').records;
const clone = x => JSON.parse(JSON.stringify(x));
const sample = (sido, op = Api.STATION, page = 1) => ({response: clone(recorded.find(r => r.sido === sido && r.operation === op && r.requestedPage === page).response)});
function transport(answer) {
    const calls = [];
    return {calls, get(url, opts, cb) {
        const u = new URL(url); calls.push(u);
        const req = new EventEmitter(); req.destroy = () => {};
        setImmediate(() => {
            const a = answer(u, calls.length), res = new EventEmitter();
            res.statusCode = a.status || 200; res.destroy = () => {}; cb(res);
            res.emit('data', Buffer.from(JSON.stringify(a.body))); res.emit('end');
        });
        return req;
    }};
}
const fetch = (t, sido = '광주', op = Api.STATION, options = {}) =>
    invoke(Api.create(Object.assign({transport: t}, options)), 'fetch', sido, 'synthetic', op);
function page(items, no, total = 0, size = 2) {
    return {response: {header: {resultCode: '00'}, body: {items, pageNo: no, numOfRows: size, totalCount: total}}};
}
for (const sido of ['인천', '경기', '강원', '충남', '전북', '경남']) {
    test('recorded null-time station does not discard valid ' + sido + ' observations', async () => {
        const h = harness(), list = sample(sido).response.body.items;
        const rows = await invoke(h.keco, 'parseRLTMCtprvn', {list, parm: {sidoName: sido}});
        assert.equal(rows.length, 1);
        assert.deepEqual(Array.from(rows.unavailable), list.filter(x => x.dataTime === null).map(x => x.stationName));
        assert(rows.every(x => Number.isFinite(x.date.getTime())));
    });
}
test('valid recorded Seoul control and explicit unavailable edge cases remain strict', async () => {
    const h = harness(), valid = sample('서울').response.body.items[0];
    assert.equal((await invoke(h.keco, 'parseRLTMCtprvn', {list: [valid]})).length, 1);
    const missing = sample('인천').response.body.items.find(x => x.dataTime === null);
    for (const mutate of [x => x.stationName = '', x => x.mangName = '', x => x.sidoName = '부산', x => delete x.sidoName,
        x => x.dataTime = '', x => x.dataTime = '2026-02-30 07:00', x => delete x.dataTime,
        x => delete x.coValue, x => x.pm10Value = '1', x => x.pm10Value = 'bad']) {
        const bad = clone(missing); mutate(bad);
        const err = await invoke(h.keco, 'parseRLTMCtprvn', {list: [{...valid, sidoName: '인천'}, bad], parm: {sidoName: '인천'}}).catch(e => e);
        assert.equal(err.code, 'INVALID_OBSERVATION');
    }
    await assert.rejects(invoke(h.keco, 'parseRLTMCtprvn', {list: [missing]}), /NO_USABLE_OBSERVATIONS/);
    await assert.rejects(invoke(h.keco, 'parseRLTMCtprvn', {list: [missing, clone(missing), {...valid, sidoName: '인천'}]}), /DUPLICATE_OBSERVATION/);
    assert.equal(h.stationWrites.length + h.sidoWrites.length, 0);
});
for (const sido of ['광주', '전남']) for (const op of [Api.STATION, Api.SIDO]) {
    test('recorded zero-total ' + sido + '/' + op + ' requires the observed empty terminal page', async () => {
        const t = transport(u => ({body: sample(sido, op, Number(u.searchParams.get('pageNo')))}));
        const result = await fetch(t, sido, op);
        assert.equal(result.list.length, sample(sido, op).response.body.items.length);
        assert.equal(t.calls.length, 2);
        assert.equal(t.calls[1].searchParams.get('pageNo'), '2');
    });
}
test('zero-total pages traverse full pages and reject repeats, holes, changed totals and budgets', async () => {
    const rows = sample('전남').response.body.items.slice(0, 5);
    const t = transport(u => { const n = Number(u.searchParams.get('pageNo')); return {body: page(rows.slice((n - 1) * 2, n * 2), n)}; });
    assert.equal((await fetch(t, '전남', Api.STATION, {pageSize: 2})).list.length, 5);
    assert.equal(t.calls.length, 4);
    const failures = {
        repeat: ['DUPLICATE_OBSERVATION'], hole: ['INCOMPLETE_PAGE', 'noncontiguous-page'],
        changed: ['CHANGED_TOTAL'], limit: ['COLLECTION_LIMIT'], 'failed-terminal': ['HTTP_503'],
        oversize: ['INCOMPLETE_PAGE', 'item-count'], 'wrong-page': ['INCOMPLETE_PAGE', 'page-number'],
        'wrong-size': ['INCOMPLETE_PAGE', 'page-size']
    };
    for (const kind of Object.keys(failures)) {
        const broken = transport(u => {
            const n = Number(u.searchParams.get('pageNo'));
            let items = kind === 'hole' ? [rows[n - 1]] : rows.slice(0, 2);
            if (n === 2 && !['repeat', 'hole', 'limit'].includes(kind)) items = [];
            const body = page(items, kind === 'wrong-page' ? n + 1 : n, kind === 'changed' && n === 2 ? 2 : 0,
                kind === 'wrong-size' ? 3 : 2);
            if (kind === 'oversize') body.response.body.items = rows;
            return {body, status: kind === 'failed-terminal' && n === 2 ? 503 : 200};
        });
        await assert.rejects(fetch(broken, '전남', Api.STATION, {pageSize: 2, maxPages: kind === 'limit' ? 1 : 20}), err => {
            assert.equal(err.code, failures[kind][0], kind);
            assert.equal(err.diagnostic && err.diagnostic.reason, failures[kind][1], kind);
            return true;
        });
    }
});
test('positive total stays exact; auxiliary operations cannot use zero-total recovery', async () => {
    const row = sample('전남').response.body.items[0];
    await assert.rejects(fetch(transport(() => ({body: page([row], 1, 3)})), '전남', Api.STATION, {pageSize: 2}), /INCOMPLETE_PAGE/);
    await assert.rejects(fetch(transport(() => ({body: page([], 1)})), '전남', Api.STATION, {pageSize: 2}), /EMPTY_ITEMS/);
    const t = transport(() => ({body: page([{stationName: 'control', dmX: '1', dmY: '1'}], 1)}));
    await assert.rejects(invoke(Api.create({transport: t, pageSize: 2}), 'query', Api.STATION_LIST, 'synthetic', {}), /INCOMPLETE_PAGE/);
});
test('failed terminal page prevents all observation and aggregate writes', async () => {
    const h = harness(); h.keco._sidoList = ['광주']; h.keco.setServiceKeys(['synthetic']);
    h.keco._observationApi = Api.create({transport: transport(u => Number(u.searchParams.get('pageNo')) === 1 ?
        {body: sample('광주')} : {body: {}, status: 503})});
    await assert.rejects(invoke(h.keco, 'getAllCtprvn'), /PARTIAL_COLLECTION/);
    assert.equal(h.stationWrites.length + h.sidoWrites.length, 0);
});
test('rejection metadata explains a failed predicate without observation values, URL or key', async () => {
    const h = harness(), bad = sample('인천').response.body.items[1]; bad.dataTime = 'https://private.invalid/secret';
    h.keco._sidoList = ['인천']; h.keco.getCtprvn = (s, op, cb) => cb(null, {list: [bad], parm: {sidoName: s}});
    await assert.rejects(invoke(h.keco, 'getAllCtprvn'), /PARTIAL_COLLECTION/);
    const logs = JSON.stringify(h.logs);
    assert(logs.includes('timestamp')); assert(logs.includes('rowIndex'));
    assert(!logs.includes('private.invalid')); assert(!logs.includes(bad.stationName));
    const t = transport(() => ({body: page([], 1, 3)}));
    const err = await fetch(t, '인천', Api.STATION, {pageSize: 2}).catch(e => e);
    assert.equal(err.diagnostic.reason, 'item-count');
    assert.equal(err.diagnostic.expectedItems, 2); assert.equal(err.diagnostic.itemCount, 0);
});
