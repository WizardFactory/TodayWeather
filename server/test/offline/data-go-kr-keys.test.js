'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const rejection = require('../../lib/dataGoKrRejection');
const async = require('async');
const keys = ['FIRST%2BKEY' + 'x'.repeat(32), 'SECOND%2FKEY' + 'x'.repeat(32)];
const config = {keyString: {dongnae_forecast_keys: JSON.stringify(keys)}};
const log = h.logger([]);
const time = require('../../lib/kmaTimeLib');
function keyList() { return require('../../lib/dataGoKrKeys'); }
function fake(responses) {
    const calls = [];
    const request = (url, options, cb) => {
        calls.push(url);
        const response = responses[Math.min(calls.length - 1, responses.length - 1)];
        setImmediate(() => cb(null, {statusCode: response.status || 200}, response.body));
    };
    request.calls = calls;
    return request;
}
function loadLife(request) {
    const Service = h.load('lib/lifeIndexKmaRequester.js', {request, async,
        '../models/town': {}, '../models/lifeIndexKma': {}, '../models/kma/kma.lifeindex.model': {},
        '../lib/kmaTimeLib': time, './dataGoKrKeys': keyList(), './dataGoKrRejection': rejection}, {log});
    const service = new Service(); service.setServiceKey(keys); return service;
}
function loadKasi(request, list = keys) {
    return h.load('controllers/kasi.riseset.controller.js', {request, async,
        '../config/config': {keyString: {dongnae_forecast_keys: JSON.stringify(list)}},
        '../lib/kmaTimeLib': time, '../models/modelKasiRiseSet': {}, '../models/town': {},
        dnscache: () => {}, '../lib/dataGoKrKeys': keyList(), '../lib/dataGoKrRejection': rejection}, {log});
}
function loadWarning(request, list = keys) {
    const Service = h.load('lib/kmaWarningRequester.js', {request, '../config/config': config,
        './dataGoKrKeys': keyList(), './dataGoKrRejection': rejection}, {log});
    return new Service({keys: list, request});
}
function loadZone(request, list = keys) {
    const Service = h.load('controllers/kma/kma.forecast.zone.controller.js', {request, async,
        '../../models/kma/kma.forecast.zone.model': {}, '../../lib/dataGoKrKeys': keyList(),
        '../../lib/dataGoKrRejection': rejection}, {log});
    return new Service(list);
}
const success = {body: {response: {header: {resultCode: '00'}, body: {totalCount: 1, items: {item: [{areaNo: '1100000000', date: '2026100309'}]}}}}};
const invoke = {
    uv: (r, list) => {const s = loadLife(r); s.setServiceKey(list); return new Promise(resolve => s._requestUvPageV5('2026100309', 1, err => resolve(err)));},
    pollen: (r, list) => {const s = loadLife(r); s.setServiceKey(list); return new Promise(resolve => s._requestPollenPageV3('flowerWeeds', '2026100309', 1, err => resolve(err)));},
    kasi: (r, list) => {const s = loadKasi(r, list); return new Promise(resolve => s._requestWithKeyRotation(() => s._makeAreaApiUrl('서울', '20261003'), err => resolve(err)));},
    warning: (r, list) => new Promise(resolve => loadWarning(r, list).get('getPwnStatus', {}, err => resolve(err))),
    zone: async (r, list) => {const s = loadZone(r, list); try {await s._request(s._getKmaApiUrl());} catch (err) {return err;}}
};
test('shared list parser validates shape, skips placeholders and deduplicates without legacy fallback', () => {
    assert.deepEqual(keyList().parse(JSON.stringify([keys[0], keys[0], '', 'key1', keys[1]])), keys);
    for (const value of ['{bad', '{}', 'null', '', undefined]) assert.deepEqual(keyList().parse(value), []);
});
for (const [name, run] of Object.entries(invoke)) {
    for (const rejectionResponse of [{status: 403, body: '<resultCode>30</resultCode>'},
        {status: 429, body: ''}, {status: 403, body: {response: {header: {resultCode: '03'}}}}, {body: {response: {header: {resultCode: '22'}}}}]) {
        test(name + ' rotates auth/quota to second key and stops on exhaustion ' + JSON.stringify(rejectionResponse), async () => {
            const r = fake([rejectionResponse, success]); assert.ifError(await run(r, keys));
            assert.equal(r.calls.length, 2); assert.equal(new URL(r.calls[1]).searchParams.get(name === 'kasi' || name === 'zone' ? 'ServiceKey' : 'serviceKey'), decodeURIComponent(keys[1]));
            const denied = fake([rejectionResponse]); assert(await run(denied, keys)); assert.equal(denied.calls.length, 2);
        });
    }
    test(name + ' empty list sends no HTTP', async () => {const r = fake([success]); assert(await run(r, [])); assert.equal(r.calls.length, 0);});
    test(name + ' non-key failure never rotates', async () => {const r = fake([{status: 500, body: '<resultCode>99</resultCode>'}]); assert(await run(r, keys)); assert(r.calls.every(u => new URL(u).searchParams.get(name === 'kasi' || name === 'zone' ? 'ServiceKey' : 'serviceKey') === decodeURIComponent(keys[0])));});
}
test('config retires legacy slots and warns by name without values', () => {
    const warnings = [];
    const c = h.load('config/config.js', {}, {process: {env: {DATA_GO_KR_TEST_CERT_KEY: 'SECRET_SENTINEL', DONGNAE_SECRET_KEYS: JSON.stringify(keys)}}, console: {warn: value => warnings.push(value)}});
    for (const name of ['normal', 'test_normal', 'cert_key', 'test_cert']) assert.equal(Object.prototype.hasOwnProperty.call(c.keyString, name), false);
    assert.equal(warnings.length, 1); assert(warnings[0].includes('DATA_GO_KR_TEST_CERT_KEY')); assert(!warnings[0].includes('SECRET_SENTINEL'));
});

test('R2618-1 actual life-index entrypoints terminate empty/malformed lists', () => {
    for (const list of [[], '{malformed']) {
        const r = fake([success]), s = loadLife(r); s.setServiceKey(list);
        let mainCalls = 0, townCalls = 0;
        s.cbKmaIndexProcess(s, err => {mainCalls++; assert(err && /configured/.test(err.message));});
        s.getLifeIndexByTown({}, err => {townCalls++; assert(err && /configured/.test(err.message));});
        assert.equal(mainCalls, 1); assert.equal(townCalls, 1); assert.equal(r.calls.length, 0);
        assert.doesNotThrow(() => s.cbKmaIndexProcess(s));
    }
});
