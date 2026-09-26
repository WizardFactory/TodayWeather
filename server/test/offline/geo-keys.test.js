'use strict';
// geo.controller.js must load without Kakao/Daum keys (#2589). Real module in a VM;
// axios, request, config and log are explicit substitutes, so no request leaves the process.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');

const KAKAO_OK = {meta: {total_count: 2}, documents: [
    {region_type: 'B', code: '1168010100', address_name: '서울특별시 강남구 역삼동', region_1depth_name: '서울특별시',
        region_2depth_name: '강남구', region_3depth_name: '역삼동', region_4depth_name: '', x: 127.033, y: 37.495},
    {region_type: 'H', code: '1168064000', address_name: '서울특별시 강남구 역삼1동', region_1depth_name: '서울특별시',
        region_2depth_name: '강남구', region_3depth_name: '역삼1동', region_4depth_name: '', x: 127.033, y: 37.495}]};

function loadGeo(keyString, axiosGet) {
    const warns = [];
    const events = {axios: [], request: []};
    const log = h.logger([]);
    log.warn = function () { warns.push(Array.prototype.join.call(arguments, ' ')); };
    const axios = {get: (url, options) => {
        events.axios.push({url, auth: options.headers.Authorization});
        return axiosGet ? axiosGet(url, options) : Promise.reject(new Error('Unexpected Kakao request'));
    }};
    const request = function (url) { events.request.push(url); throw new Error('Unexpected HTTP ' + url); };
    const Geo = h.load('controllers/geo.controller.js', {
        axios, async: require('async'), request, dnscache: () => ({}),
        '../config/config': {keyString: keyString}
    }, {log, Promise});
    return {Geo, warns, events};
}

function kakao(geo) {
    return new Promise(resolve => geo._getAddressFromKakao((err, result) => resolve({err, result})));
}

const missing = [
    ['unset', {}],
    ['not JSON', {kakao_keys: 'SECRET-NOT-JSON', daum_keys: 'SECRET-NOT-JSON'}],
    ['not an array', {kakao_keys: '{"key":"SECRET-OBJECT"}', daum_keys: '"SECRET-STRING"'}],
    ['empty array', {kakao_keys: '[]', daum_keys: '[]'}]
];

for (const [name, keyString] of missing) {
    test(`loads and fails Kakao calls with a clear error when kakao_keys is ${name}`, async () => {
        const fixture = loadGeo(keyString);
        assert.deepEqual(fixture.warns, [], 'nothing is parsed or logged at load');
        const geo = new fixture.Geo(37.5, 127.03, 'ko');
        const first = await kakao(geo);
        const second = await kakao(geo);
        for (const call of [first, second]) {
            assert.equal(Object.prototype.toString.call(call.err), '[object Error]'); // VM realm
            assert.match(call.err.message, /Kakao API key is not configured \(kakao_keys\)/);
            assert.equal(call.result, undefined);
        }
        assert.equal(fixture.events.axios.length, 0, 'no Kakao request without a key');
        assert.equal(fixture.warns.length, 1, 'one warning per setting');
        assert.match(fixture.warns[0], /kakao_keys/);
        assert.doesNotMatch(fixture.warns.join('\n'), /SECRET/, 'the setting value is never logged');
    });
}

test('Daum requests also fail with a clear error and no HTTP when daum_keys is unusable', async () => {
    for (const [, keyString] of missing) {
        const fixture = loadGeo(keyString);
        const err = await new Promise(resolve => new fixture.Geo(37.5, 127.03)._getAddressFromDaum(resolve));
        assert.match(err.message, /Daum API key is not configured \(daum_keys\)/);
        assert.equal(fixture.events.request.length, 0);
        assert.doesNotMatch(fixture.warns.join('\n'), /SECRET/);
    }
});

test('configured Kakao keys: same header, one attempt per key, result unchanged', async () => {
    let attempt = 0;
    const fixture = loadGeo({kakao_keys: '["k1","k2"]', daum_keys: '["d1"]'}, () => {
        attempt++;
        return attempt === 1 ? Promise.reject(new Error('quota')) : Promise.resolve({data: KAKAO_OK});
    });
    const call = await kakao(new fixture.Geo(37.495, 127.033, 'ko'));
    assert.equal(call.err, null);
    assert.deepEqual(call.result, KAKAO_OK);
    assert.deepEqual(fixture.events.axios.map(e => e.auth), ['KakaoAK k1', 'KakaoAK k2']);
    assert.match(fixture.events.axios[0].url, /coord2regioncode\.json\?x=127\.033&y=37\.495&input_coord=WGS84$/);
    assert.deepEqual(fixture.warns, []);

    const failing = loadGeo({kakao_keys: '["k1","k2"]', daum_keys: '["d1"]'}, () => Promise.reject(new Error('quota')));
    const failed = await kakao(new failing.Geo(37.495, 127.033, 'ko'));
    assert.equal(failed.err.message, 'quota');
    assert.equal(failing.events.axios.length, 2, 'retry count equals key count');
});

function locate(fixture, lat, lon) {
    const req = {params: {lat, lon}, query: {}};
    return new Promise(resolve => new fixture.Geo(lat, lon, 'ko').location2address(req, {}, err => resolve({err, req})));
}

test('location2address passes the missing-key error to next for a Korean coordinate', async () => {
    const fixture = loadGeo({});
    const {err, req} = await locate(fixture, 37.495, 127.033);
    assert.match(err.message, /Kakao API key is not configured \(kakao_keys\)/);
    assert.equal(req.result, undefined);
    assert.equal(fixture.events.request.length, 0);
});

test('location2address passes a Kakao request error to next, not a parse TypeError', async () => {
    const fixture = loadGeo({kakao_keys: '["k1"]', daum_keys: '["d1"]'}, () => Promise.reject(new Error('kakao 401')));
    const {err} = await locate(fixture, 37.495, 127.033);
    assert.equal(err.message, 'kakao 401');
});

test('location2address with a configured key still resolves the KMA address', async () => {
    const fixture = loadGeo({kakao_keys: '["k1"]', daum_keys: '["d1"]'}, () => Promise.resolve({data: KAKAO_OK}));
    const {err, req} = await locate(fixture, 37.495, 127.033);
    assert.equal(err, undefined);
    assert.deepEqual({region: req.params.region, city: req.params.city, town: req.params.town},
        {region: '서울특별시', city: '강남구', town: '역삼1동'});
    assert.equal(req.result.country, 'KR');
    assert.equal(req.result.name, '역삼1동');
    assert.equal(fixture.events.request.length, 0, 'Google is not needed for a complete Kakao result');
});
