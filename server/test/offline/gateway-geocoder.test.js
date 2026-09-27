/* Gateway geocoder regressions (#2606), scenarios U-1 to U-16 of
 * specs/issue-2606-test-scenarios.md.
 *   NODE_PATH=<isolated deps> node server/test/offline/gateway-geocoder.test.js
 * Provider responses come from fixtures/gateway/providers.json; the expected outputs
 * in fixtures/gateway/goldens.json were produced by running the tw-backend-functions
 * a4c1deb modules on the same fixtures (fixtures/gateway/make-goldens.js). The
 * transport is a stub except in U-7, which uses a loopback HTTP server. No network,
 * no Mongo.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const geocoderModule = require(path.join(root, 'lib/geocoder'));
const format = require(path.join(root, 'lib/geocoder/format'));
const keys = require(path.join(root, 'lib/geocoder/keys'));
const cacheModule = require(path.join(root, 'lib/geocoder/cache'));
const gateway = require(path.join(root, 'routes/gateway'));
const providers = require('./fixtures/gateway/providers.json');
const cases = require('./fixtures/gateway/cases.json');
const goldens = require('./fixtures/gateway/goldens.json');

const KAKAO = 'http://kakao.test';
const GOOGLE = 'http://google.test';
const clone = v => JSON.parse(JSON.stringify(v));

function makeLog() {
    const lines = [];
    const log = {};
    ['info', 'warn', 'error', 'debug'].forEach(level => { log[level] = msg => lines.push(level + ' ' + msg); });
    return {log, lines};
}

/** Stub transport: serves scripted responses per provider and records the calls. */
function scriptedTransport(script) {
    const calls = [];
    const queues = {kakao: (script.kakao || []).slice(), google: (script.google || []).slice()};
    function respond(item) {
        if (item === undefined) { return Promise.reject(Object.assign(new Error('unexpected call'), {code: 'EUNEXPECTED'})); }
        if (typeof item === 'string' && item.startsWith('http:')) {
            return Promise.resolve({status: Number(item.slice(5)), json: false, body: ''});
        }
        if (typeof item === 'string' && item === 'timeout') {
            return Promise.reject(Object.assign(new Error('timeout'), {code: 'ETIMEDOUT'}));
        }
        if (typeof item === 'string') {
            return Promise.resolve({status: 200, json: true, body: clone(providers[item])});
        }
        return Promise.resolve(Object.assign({json: true}, clone(item)));
    }
    return {
        calls,
        getJson(url, options) {
            const provider = url.startsWith(KAKAO) ? 'kakao' : url.startsWith(GOOGLE) ? 'google' : 'other';
            calls.push({provider, url, options});
            return respond(queues[provider].shift());
        }
    };
}

// Stores documents the way MongoDB does: an undefined field becomes null.
const mongoLike = v => JSON.parse(JSON.stringify(v, (k, val) => val === undefined ? null : val));

function memoryCache(initial) {
    const store = new Map(Object.entries(initial || {}));
    const gets = [];
    const sets = [];
    return {
        store, gets, sets,
        get(key) { gets.push(key); return Promise.resolve(store.has(key) ? clone(store.get(key)) : null); },
        set(key, doc) { sets.push(key); store.set(key, Object.assign({_id: key, updatedAt: new Date()}, mongoLike(doc))); return Promise.resolve(); }
    };
}

function geocoderWith(script, extra) {
    const transport = scriptedTransport(script);
    const {log, lines} = makeLog();
    const geocoder = geocoderModule.createGeocoder(Object.assign({
        kakaoKeys: ['kakao-key'], googleKey: 'google-key',
        kakaoBaseUrl: KAKAO, googleBaseUrl: GOOGLE,
        transport, random: () => 0, log
    }, extra || {}));
    return {geocoder, transport, lines};
}

/** The Lambda's provider call trace, rewritten into this module's URL form. */
function normalizedCalls(transport) {
    return transport.calls.map(c => c.provider === 'kakao'
        ? 'kakao ' + c.url.slice(KAKAO.length)
        : 'google ' + decodeURIComponent(c.url.slice(GOOGLE.length).replace('/maps/api/geocode/json', '').replace(/&key=[^&]*/, '')));
}

// U-1, U-2, U-5, U-6, U-16: every coordinate case against the Lambda goldens.
for (const c of cases.coord) {
    const golden = goldens.coord[c.id];
    if (golden.status === 404) { continue; }   // (0,0) is decided by the router (RT-9)
    test(`U-1/2/5/6/16 coord ${c.id} equals the Lambda golden`, async () => {
        const {geocoder, transport} = geocoderWith({kakao: c.kakao, google: c.google});
        const loc = gateway.parseLoc(c.loc);
        const lang = format.languageFromHeader(c.acceptLanguage === null ? undefined : c.acceptLanguage);
        if (golden.status === 200) {
            const out = await geocoder.coord(loc, lang);
            assert.equal(JSON.stringify(out), JSON.stringify(golden.body), 'client shape incl. key order');
        }
        else {
            await assert.rejects(geocoder.coord(loc, lang), err => err.code === 'EPROVIDER');
        }
        const lambdaCalls = golden.calls.filter(call => call !== 'darksky');
        assert.deepEqual(normalizedCalls(transport), lambdaCalls, 'same provider calls as the Lambda (Dark Sky removed)');
    });
}

// U-3, U-18: address cases.
for (const a of cases.addr) {
    const golden = goldens.addr[a.id];
    test(`U-3 addr ${a.id}`, async () => {
        const {geocoder} = geocoderWith({kakao: a.kakao, google: a.google});
        const out = await geocoder.addr(a.address, 'ko');
        const expected = golden.status === 200 ? golden.body : a.expectedPort;
        assert.equal(JSON.stringify(out), JSON.stringify(expected));
        assert.ok(Object.keys(out).every(k => ['country', 'address', 'location'].includes(k)));
    });
}

test('U-4 Korea box is checked on normalized coordinates', async () => {
    const inside = [[32.695, 124], [39.376, 127], [35, 123.953], [35, 131.88]];
    const outside = [[32.694, 124], [39.377, 127], [35, 123.952], [35, 131.881]];
    for (const loc of inside) {
        const {geocoder, transport} = geocoderWith({kakao: ['kakao.coord.seoul']});
        await geocoder.coord(format.normalizeLoc(loc), 'ko');
        assert.equal(transport.calls[0].provider, 'kakao', String(loc));
    }
    for (const loc of outside) {
        const {geocoder, transport} = geocoderWith({google: ['google.coord.london']});
        await geocoder.coord(format.normalizeLoc(loc), 'en');
        assert.equal(transport.calls[0].provider, 'google', String(loc));
    }
});

test('U-6 a KR result without kmaAddress is returned but not cached', async () => {
    const krNoKma = {status: 200, body: {meta: {total_count: 0}, documents: []}};
    const cache = memoryCache();
    const {geocoder} = geocoderWith({kakao: [krNoKma], google: ['google.coord.seoul.ko']}, {cache});
    const out = await geocoder.coord([37.566, 126.978], 'ko');
    assert.equal(out.country, 'KR');
    assert.equal(out.kmaAddress, undefined);
    assert.equal(cache.sets.length, 0);
});

test('U-7 provider requests have a total timer (silent and slow-drip servers)', async () => {
    let mode = 'silent';
    const server = http.createServer((req, res) => {
        if (mode === 'silent') { return; }
        res.writeHead(200, {'Content-Type': 'application/json'});
        const drip = setInterval(() => res.write(' '), 50);
        req.on('close', () => clearInterval(drip));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + server.address().port;
    try {
        for (mode of ['silent', 'drip']) {
            const {log} = makeLog();
            const geocoder = geocoderModule.createGeocoder({
                kakaoKeys: ['k1', 'k2'], googleKey: 'g1', kakaoBaseUrl: base, googleBaseUrl: base,
                random: () => 0, log, providerTimeoutMs: 300, budgetMs: 500
            });
            const started = Date.now();
            await assert.rejects(geocoder.coord([37.566, 126.978], 'ko'), err => err.code === 'EPROVIDER');
            const elapsed = Date.now() - started;
            assert.ok(elapsed >= 450 && elapsed < 900, mode + ' elapsed ' + elapsed);
        }
    }
    finally {
        server.closeAllConnections && server.closeAllConnections();
        server.close();
    }
});

test('U-8 key rotation per outcome', async () => {
    // Kakao 401 then 200: success on the second key.
    let r = geocoderWith({kakao: ['http:401', 'kakao.coord.seoul']}, {kakaoKeys: ['k1', 'k2']});
    assert.equal((await r.geocoder.coord([37.566, 126.978], 'ko')).name, '명동');
    assert.equal(r.transport.calls.length, 2);
    assert.match(r.transport.calls[1].options.headers.Authorization, /k2$/);
    // 429 then 500: one attempt per key, then EPROVIDER.
    r = geocoderWith({kakao: ['http:429', 'http:500']}, {kakaoKeys: ['k1', 'k2']});
    await assert.rejects(r.geocoder.coord([37.566, 126.978], 'ko'), err => err.code === 'EPROVIDER');
    assert.equal(r.transport.calls.length, 2);
    // Kakao quota and auth error bodies on HTTP 400 rotate; another 400 code does not.
    r = geocoderWith({kakao: [{status: 400, body: {code: -10, msg: 'quota'}}, 'kakao.coord.seoul']}, {kakaoKeys: ['k1', 'k2']});
    await r.geocoder.coord([37.566, 126.978], 'ko');
    assert.equal(r.transport.calls.length, 2);
    r = geocoderWith({kakao: [{status: 400, body: {errorType: 'AccessDeniedError', message: 'x'}}, 'kakao.coord.seoul']}, {kakaoKeys: ['k1', 'k2']});
    await r.geocoder.coord([37.566, 126.978], 'ko');
    assert.equal(r.transport.calls.length, 2);
    r = geocoderWith({kakao: [{status: 400, body: {code: -2, msg: 'bad parameter'}}]}, {kakaoKeys: ['k1', 'k2']});
    await assert.rejects(r.geocoder.coord([37.566, 126.978], 'ko'));
    assert.equal(r.transport.calls.length, 1);
    // Google has a single key: OVER_QUERY_LIMIT fails after one attempt.
    r = geocoderWith({google: ['google.coord.overlimit', 'google.coord.london']});
    await assert.rejects(r.geocoder.coord([51.507, -0.128], 'en'), err => err.code === 'EPROVIDER');
    assert.equal(r.transport.calls.length, 1);
    assert.match(r.transport.calls[0].url, /key=google-key$/);
    // An empty Kakao answer does not try another key; the flow continues with Google.
    r = geocoderWith({kakao: ['kakao.coord.empty'], google: ['google.coord.tsushima']}, {kakaoKeys: ['k1', 'k2']});
    await r.geocoder.coord([34.2, 129.3], 'ko');
    assert.deepEqual(r.transport.calls.map(c => c.provider), ['kakao', 'google']);
    // Google ZERO_RESULTS does not try another key.
    r = geocoderWith({google: ['google.coord.zero']});
    await assert.rejects(r.geocoder.coord([40.713, -74.006], 'en'));
    assert.equal(r.transport.calls.length, 1);
});

test('U-9 key lists: unset or invalid values are empty; shared names are not read', async () => {
    for (const value of [undefined, '', 'not-json', '{}', '[]', '[1, ""]']) {
        assert.deepEqual(keys.parseKeys(value), [], String(value));
    }
    assert.deepEqual(keys.parseKeys('["a","b"]'), ['a', 'b']);
    const saved = Object.assign({}, process.env);
    try {
        delete process.env.GEOCODER_KAKAO_KEYS;
        // A Google key with another fingerprint is ignored (U-18).
        process.env.GEOCODER_GOOGLE_KEY = 'not-the-allowed-key';
        process.env.KAKAO_SECRET_KEYS = '["shared-kakao"]';
        process.env.GOOGLE_SECRET_KEY = 'shared-google';
        const printed = [];
        const originalLog = console.log;
        console.log = (...args) => printed.push(args.join(' '));
        let geocoder;
        try { geocoder = geocoderModule.getDefaultGeocoder(); }
        finally { console.log = originalLog; }
        const keyLine = printed.find(l => l.startsWith('gateway geocoder keys:'));
        assert.equal(keyLine, 'gateway geocoder keys: kakao=[] google=[] ignored google=[' + keys.fingerprint('not-the-allowed-key') + ']');
        await assert.rejects(geocoder.coord([37.566, 126.978], 'ko'), err => err.code === 'EPROVIDER' && /no keys/.test(err.message));
        await assert.rejects(geocoder.coord([51.507, -0.128], 'en'), err => err.code === 'EPROVIDER' && /no keys/.test(err.message));
    }
    finally {
        process.env = saved;
    }
});

test('U-10 logs never contain a key', async () => {
    const secret = 'secret-google-key-123';
    const {geocoder, lines} = geocoderWith({google: ['google.coord.denied']}, {googleKey: secret});
    await assert.rejects(geocoder.coord([51.507, -0.128], 'en'));
    assert.ok(lines.length > 0);
    assert.ok(lines.every(line => !line.includes('secret-google-key')), lines.join('\n'));
    assert.ok(lines.some(line => line.includes('key=***')));
});

test('U-11 cache keys', async () => {
    const cache = memoryCache();
    let r = geocoderWith({kakao: ['kakao.coord.seoul']}, {cache});
    await r.geocoder.coord(gateway.parseLoc('37.5665,126.9780'), 'ko');
    r = geocoderWith({google: ['google.addr.jamsil']}, {cache});
    await r.geocoder.addr(' 잠실 ', 'ko');
    assert.deepEqual(cache.gets, ['c:37.566,126.978,ko', 'a: 잠실 ']);
});

test('U-12 a cache hit equals the miss', async () => {
    const cache = memoryCache();
    const {geocoder, transport} = geocoderWith({kakao: ['kakao.coord.seoul'], google: ['google.coord.seoul.en']}, {cache});
    const miss = await geocoder.coord([37.566, 126.978], 'en');
    await miss.meta.write;
    const hit = await geocoder.coord([37.566, 126.978], 'en');
    assert.equal(hit.meta.cacheHit, true);
    assert.equal(JSON.stringify(hit), JSON.stringify(miss));
    assert.equal(transport.calls.length, 2, 'providers called only for the miss');
});

test('U-12 an address cache hit equals the miss, also without a country', async () => {
    for (const fixture of ['google.addr.jamsil', 'google.addr.nocountry']) {
        const cache = memoryCache();
        const {geocoder, transport} = geocoderWith({google: [fixture]}, {cache});
        const miss = await geocoder.addr('Somewhere', 'ko');
        await miss.meta.write;
        const hit = await geocoder.addr('Somewhere', 'ko');
        assert.equal(hit.meta.cacheHit, true);
        assert.equal(JSON.stringify(hit), JSON.stringify(miss), fixture);
        assert.equal(transport.calls.length, 1);
    }
});

test('U-17 response size caps: 1 MB by default, larger when requested (6 MB loopback)', async () => {
    const transport = require(path.join(root, 'lib/geocoder/transport'));
    const big = JSON.stringify({pad: 'x'.repeat(2 * 1024 * 1024)});
    const server = http.createServer((req, res) => { res.writeHead(200, {'Content-Type': 'application/json'}); res.end(big); });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const url = 'http://127.0.0.1:' + server.address().port + '/';
    try {
        await assert.rejects(transport.getJson(url, {timeoutMs: 3000}), err => err.code === 'ETOOLARGE');
        const res = await transport.getJson(url, {timeoutMs: 3000, maxBytes: 6 * 1024 * 1024});
        assert.equal(res.status, 200);
        assert.equal(res.body.pad.length, 2 * 1024 * 1024);
    }
    finally { server.close(); }
});

test('U-13 stale or invalid cache records are not used', async () => {
    const valid = {kind: 'coord', lang: 'ko', updatedAt: new Date(), geoInfo: {loc: [37.566, 126.978], country: 'KR', label: '명동', address: 'a', kmaAddress: {name1: '서울특별시'}}};
    const noKma = Object.assign(clone(valid), {updatedAt: new Date()});
    delete noKma.geoInfo.kmaAddress;
    const old = Object.assign(clone(valid), {updatedAt: new Date(Date.now() - 31 * 24 * 3600 * 1000)});
    for (const [doc, expectCall] of [[noKma, true], [old, true], [valid, false]]) {
        const cache = memoryCache({'c:37.566,126.978,ko': doc});
        const {geocoder, transport} = geocoderWith({kakao: ['kakao.coord.seoul']}, {cache});
        await geocoder.coord([37.566, 126.978], 'ko');
        assert.equal(transport.calls.length > 0, expectCall);
    }
});

function fakeConnection(readyState) {
    const listeners = {};
    return {
        readyState,
        once(event, fn) { listeners[event] = fn; },
        emit(event) { listeners[event] && listeners[event](); }
    };
}

test('U-14 bounded cache reads and writes', async () => {
    const {log, lines} = makeLog();
    let findOneCalls = 0;
    const collection = {
        findOne(filter, options, cb) { findOneCalls++; assert.deepEqual(options, {maxTimeMS: 300}); setTimeout(() => cb(null, {_id: filter._id}), 1000); },
        updateOne(filter, update, options, cb) { assert.equal(options.upsert, true); setTimeout(() => cb(new Error('write failed')), 10); }
    };
    let cache = cacheModule.createMongoCache({connection: fakeConnection(0), collection, log});
    assert.equal(await cache.get('k'), null);
    assert.equal(findOneCalls, 0, 'no read while the connection is not open');
    await cache.set('k', {kind: 'coord', geoInfo: {}});
    cache = cacheModule.createMongoCache({connection: fakeConnection(1), collection, log});
    const started = Date.now();
    assert.equal(await cache.get('k'), null);
    assert.ok(Date.now() - started < 450, 'read bounded at 300 ms');
    await cache.set('k', {kind: 'coord', geoInfo: {}});
    assert.ok(lines.some(l => /write failed/.test(l)));
});

test('U-15 TTL index is created once after the connection opens; errors are logged', () => {
    const {log, lines} = makeLog();
    const created = [];
    const collection = {createIndex(spec, options, cb) { created.push([spec, options]); cb(new Error('IndexOptionsConflict')); }};
    let connection = fakeConnection(1);
    let cache = cacheModule.createMongoCache({connection, collection, log});
    cache.ensureIndex();
    cache.ensureIndex();
    assert.deepEqual(created, [[{updatedAt: 1}, {expireAfterSeconds: 2592000}]]);
    assert.ok(lines.some(l => /IndexOptionsConflict/.test(l)));
    created.length = 0;
    connection = fakeConnection(2);
    cache = cacheModule.createMongoCache({connection, collection, log});
    cache.ensureIndex();
    assert.equal(created.length, 0, 'not before open');
    connection.emit('open');
    assert.equal(created.length, 1);
});

test('U-18 a single Google key, used only with fingerprint ecd5fdb1', () => {
    assert.equal(keys.GOOGLE_KEY_FINGERPRINT, 'ecd5fdb1');
    assert.equal(keys.fingerprint('abc'), 'ba7816bf');
    assert.deepEqual(keys.googleKey(undefined), {key: null, ignored: null});
    assert.deepEqual(keys.googleKey(''), {key: null, ignored: null});
    assert.deepEqual(keys.googleKey('key-a'), {key: null, ignored: keys.fingerprint('key-a')});
    assert.deepEqual(keys.googleKey('["key-a","key-b"]'), {key: null, ignored: keys.fingerprint('["key-a","key-b"]')}, 'a list is not a key');
    // Only against a test stub (GEOCODER_GOOGLE_BASE_URL) is another key accepted.
    assert.deepEqual(keys.googleKey('key-a', {stub: true}), {key: 'key-a', ignored: null});
    assert.deepEqual(keys.googleKey('key-a', {stub: false}), {key: null, ignored: keys.fingerprint('key-a')});
});

test('U-16 language values follow the Lambda rule', () => {
    const expected = [
        [undefined, 'en'], ['ko-KR,ko;q=0.9', 'ko'], ['ko,en-US;q=0.9,en;q=0.8', 'ko,en'],
        ['KO-KR', 'KO'], ['ko_KR', 'ko_KR'], ['', ''], ['x'.repeat(65), 'en'], ['ko&key=x', 'ko&key=x']
    ];
    for (const [header, lang] of expected) {
        assert.equal(format.languageFromHeader(header), lang, String(header));
    }
});
