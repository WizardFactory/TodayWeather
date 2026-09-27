/* Internal callers of the public geocode API (#2606), scenarios IC-1 and IC-2 of
 * specs/issue-2606-test-scenarios.md. The four callers only switch to the versioned
 * /geocode/v000903/... paths; geocode output does not depend on the version, so each
 * caller must produce the same result from the same response body. The functions
 * are sliced from the production sources and run in a VM with stub HTTP; no
 * network, no app startup.
 *   node server/test/offline/gateway-callers.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

function slice(source, start, end) {
    const i = source.indexOf(start);
    assert.ok(i >= 0, 'missing ' + start);
    const j = source.indexOf(end, i);
    assert.ok(j > i, 'missing end after ' + start);
    return source.slice(i, j + end.length);
}

const API = 'http://api.test';
const seoul = {name: '명동', country: 'KR', address: '서울특별시 중구 명동', location: {lat: 37.566, long: 126.978},
    kmaAddress: {name1: '서울특별시', name2: '중구', name3: '명동'}};

test('IC-1 no server source calls an unversioned gateway geocode path', () => {
    const pattern = /apiServer\.url \+ '\/geocode\/(coord|addr)\//;
    // Built from parts so that this file does not match the pattern itself.
    assert.ok(pattern.test('config.apiServer.url + ' + "'/geo" + "code/coord/'"), 'self-check: the pattern matches the old form');
    const offenders = [];
    (function walk(dir) {
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) { continue; }
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); }
            else if (entry.name.endsWith('.js') && pattern.test(fs.readFileSync(full, 'utf8'))) { offenders.push(full); }
        }
    })(root);
    assert.deepEqual(offenders, []);
});

test('IC-2 controllerTown24h.coord2addr requests the versioned path and sets the KMA params', () => {
    const src = slice(read('controllers/controllerTown24h.js'), 'this.coord2addr = function (req, res, next) {', '\n    };');
    const seen = [];
    const ctx = {config: {apiServer: {url: API}}, Error,
        _retryRequest: (url, lang, cb) => { seen.push({url, lang}); cb(null, JSON.parse(JSON.stringify(seoul))); }};
    vm.runInNewContext('var self = {}; (function(){' + src + '}).call(self); this.fn = self.coord2addr;', ctx);
    const req = {params: {loc: '37.5665,126.9780'}, headers: {'accept-language': 'ko-KR'}};
    let nextArg = 'unset';
    ctx.fn(req, {}, arg => { nextArg = arg; });
    assert.deepEqual(seen, [{url: API + '/geocode/v000903/coord/37.5665,126.9780', lang: 'ko-KR'}]);
    assert.equal(nextArg, undefined);
    assert.deepEqual({region: req.params.region, city: req.params.city, town: req.params.town},
        {region: '서울특별시', city: '중구', town: '명동'});
    // A failure still goes to next(err).
    ctx._retryRequest = (url, lang, cb) => cb(new Error('boom'));
    ctx.fn({params: {loc: '1,2'}, headers: {}}, {}, arg => { nextArg = arg; });
    assert.ok(nextArg instanceof Error);
});

test('IC-2 route.geo.v000903 requests the versioned path and redirects as before', () => {
    const src = slice(read('routes/v000903/route.geo.v000903.js'), 'function coord2addr(req, res, next) {', '\n}');
    for (const [geo, expected] of [
        [seoul, '../kma/addr/' + encodeURIComponent('서울특별시') + '/' + encodeURIComponent('중구') + '/' + encodeURIComponent('명동')],
        [{name: 'Manhattan', country: 'US', address: 'a', location: {lat: 40.713, long: -74.006}}, '../dsf/coord/40.7128,-74.0060']
    ]) {
        const seen = [];
        const ctx = {config: {apiServer: {url: API}}, Error, encodeURIComponent,
            _retryRequest: (url, cb) => { seen.push(url); cb(null, JSON.parse(JSON.stringify(geo))); }};
        vm.runInNewContext(src + '\nthis.fn = coord2addr;', ctx);
        const loc = geo.country === 'KR' ? '37.5665,126.9780' : '40.7128,-74.0060';
        let redirected;
        ctx.fn({params: {loc}}, {redirect: url => { redirected = url; }}, () => assert.fail('next'));
        assert.equal(seen[0], API + '/geocode/v000903/coord/' + loc);
        assert.equal(redirected, expected);
    }
});

test('IC-2 controllerPush._requestGeoInfo requests the versioned path with lat,lon from [lon,lat]', () => {
    const src = slice(read('controllers/controllerPush.js'), 'ControllerPush.prototype._requestGeoInfo = function', '\n};');
    const seen = [];
    const ctx = {ControllerPush: function () {}, config: {apiServer: {url: API}}, Error, Date,
        log: {info() {}, error() {}, warn() {}},
        req: (options, cb) => { seen.push(options); cb(null, {statusCode: 200}, JSON.parse(JSON.stringify(seoul))); }};
    vm.runInNewContext(src, ctx);
    let result;
    new ctx.ControllerPush()._requestGeoInfo({geo: [126.978, 37.566]}, (err, body) => { result = {err, body}; });
    assert.equal(seen[0].url, API + '/geocode/v000903/coord/37.566,126.978');
    assert.equal(seen[0].headers, undefined, 'no Accept-Language, as before');
    assert.equal(result.err, undefined);
    assert.equal(result.body.kmaAddress.name1, '서울특별시');
});
