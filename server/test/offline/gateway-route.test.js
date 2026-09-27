/* Gateway route regressions (#2606), scenarios RT-1 to RT-15 of
 * specs/issue-2606-test-scenarios.md.
 *   NODE_PATH=<isolated deps incl. express@4.13.4, cors, express-session> \
 *     node server/test/offline/gateway-route.test.js
 * The app is composed in app.js order: cors() → gateway router → express-session →
 * a stub backend serving per-version /{v}/kma/addr and /{v}/dsf/coord fixtures. The
 * router's loopback reaches that backend over 127.0.0.1. Providers are scripted
 * (fixtures/gateway/providers.json). No network beyond loopback, no Mongo.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const session = require('express-session');

const root = path.resolve(__dirname, '../..');
const {createGatewayRouter} = require(path.join(root, 'routes/gateway'));
const geocoderModule = require(path.join(root, 'lib/geocoder'));
const transport = require(path.join(root, 'lib/geocoder/transport'));
const providers = require('./fixtures/gateway/providers.json');
const backendFixtures = require('./fixtures/gateway/backend.json');
const cases = require('./fixtures/gateway/cases.json');
const goldens = require('./fixtures/gateway/goldens.json');

const clone = v => JSON.parse(JSON.stringify(v));
const noKeepAlive = new http.Agent({keepAlive: false});
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- scripted providers ----------
function scriptedTransport(script) {
    const queues = {kakao: (script.kakao || []).slice(), google: (script.google || []).slice()};
    return {
        getJson(url) {
            const provider = url.startsWith('http://kakao.test') ? 'kakao' : 'google';
            const item = queues[provider].shift();
            if (item === undefined) { return Promise.reject(Object.assign(new Error('unexpected ' + provider), {code: 'EUNEXPECTED'})); }
            if (item.startsWith('http:')) { return Promise.resolve({status: Number(item.slice(5)), json: false, body: ''}); }
            return Promise.resolve({status: 200, json: true, body: clone(providers[item])});
        }
    };
}
function realGeocoder(script) {
    return geocoderModule.createGeocoder({
        kakaoKeys: ['kakao-key'], googleKey: 'google-key',
        kakaoBaseUrl: 'http://kakao.test', googleBaseUrl: 'http://google.test',
        transport: scriptedTransport(script), random: () => 0, log: quietLog
    });
}
const logLines = [];
const quietLog = {info: m => logLines.push(m), warn: m => logLines.push(m), error: m => logLines.push(m), debug() {}};

// ---------- composed app ----------
const state = {
    geocoder: null,
    backendHits: [],
    backendScript: [],       // per-hit behaviors, consumed in order
    backendDelayMs: 0,       // delay for every default response (RT-13)
    geocoderCalls: 0
};

function backendHandler(req, res) {
    state.backendHits.push({url: req.originalUrl, acceptLanguage: req.headers['accept-language']});
    const behavior = state.backendScript.shift();
    if (behavior) { return behavior(req, res); }
    const version = req.params[0];
    const kind = req.params[1] === 'kma/addr' ? 'kma' : 'dsf';
    const body = clone(backendFixtures[version][kind]);
    if (state.backendDelayMs) { return setTimeout(() => res.json(body), state.backendDelayMs); }
    res.json(body);
}

async function startApp(options) {
    const app = express();
    app.use(cors());
    let port;
    const router = createGatewayRouter(Object.assign({
        geocoder: () => { state.geocoderCalls++; return state.geocoder; },
        // No keep-alive: a reused socket closed by the server would add a retry and
        // make the backend hit counts nondeterministic (RT-11 (d) covers resets).
        loopback: (p, headers, timeoutMs, signal) => transport.getJson('http://127.0.0.1:' + port + p, {headers, timeoutMs, signal, agent: noKeepAlive}),
        log: quietLog
    }, options || {}));
    app.use(router);
    app.use(session({secret: 'test', resave: false, saveUninitialized: true, cookie: {maxAge: 60000}}));
    app.get(/^\/(v000901|v000902|v000903)\/(kma\/addr|dsf\/coord)\/.+/, backendHandler);
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
    return {
        port,
        close() { server.closeAllConnections && server.closeAllConnections(); return new Promise(r => server.close(r)); }
    };
}

function request(port, method, urlPath, headers, abortAfterMs) {
    return new Promise((resolve, reject) => {
        const req = http.request({host: '127.0.0.1', port, method, path: urlPath, headers: headers || {}}, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let json;
                try { json = JSON.parse(text); } catch (e) { json = undefined; }
                resolve({status: res.statusCode, headers: res.headers, text, json});
            });
        });
        req.on('error', err => abortAfterMs ? resolve({aborted: true}) : reject(err));
        if (abortAfterMs) { setTimeout(() => req.destroy(), abortAfterMs); }
        req.end();
    });
}

function reset(geocoder) {
    state.geocoder = geocoder;
    state.backendHits = [];
    state.backendScript = [];
    state.backendDelayMs = 0;
    state.geocoderCalls = 0;
}

function assertErrorResponse(res, status) {
    assert.equal(res.status, status);
    assert.match(res.headers['content-type'], /^text\/plain/);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.equal(res.headers['set-cookie'], undefined);
    assert.doesNotMatch(res.text, /<html|http|\.net|\.com|key/i);
}

function queryPairs(url) {
    const q = url.indexOf('?') < 0 ? '' : url.slice(url.indexOf('?') + 1);
    return q ? q.split('&').map(p => p.split('=').map(decodeURIComponent)) : [];
}

// ---------- RT-1 / RT-2 / RT-3: every weather golden (versions × queries × languages) ----------
test('RT-1/RT-2 weather responses equal the Lambda goldens for every version, query and language', async () => {
    const app = await startApp();
    try {
        let checked = 0;
        for (const [key, golden] of Object.entries(goldens.weather)) {
            const [id, version, qname] = key.split('|');
            const c = cases.coord.find(x => x.id === id);
            reset(realGeocoder({kakao: c.kakao, google: c.google}));
            const query = cases.queries[qname] ? '?' + cases.queries[qname] : '';
            const p = (version === 'unversioned' ? '/weather/coord/' : '/weather/' + version + '/coord/') + c.loc + query;
            const res = await request(app.port, 'GET', p, c.acceptLanguage === null ? {} : {'Accept-Language': c.acceptLanguage});
            assert.equal(res.status, golden.status, key);
            if (golden.status !== 200) {
                assertErrorResponse(res, golden.status);
                continue;
            }
            assert.equal(res.text, JSON.stringify(golden.body), key + ' body incl. key order');
            assert.equal(res.headers['cache-control'], 'max-age=300');
            assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
            assert.equal(res.headers['access-control-allow-origin'], '*');
            assert.equal(res.headers['set-cookie'], undefined);
            assert.equal(state.backendHits.length, 1, key);
            const hit = state.backendHits[0];
            const lambda = golden.backend[0];
            assert.equal(hit.url.split('?')[0], lambda.url.split('?')[0], key + ' backend path');
            assert.deepEqual(queryPairs(hit.url), queryPairs(lambda.url), key + ' backend query pairs');
            assert.equal(hit.acceptLanguage, lambda.acceptLanguage, key + ' backend Accept-Language');
            checked++;
        }
        assert.ok(checked >= 90, 'checked ' + checked);
    }
    finally { await app.close(); }
});

test('RT-3 backend failures give 501 for every version', async () => {
    const app = await startApp({attemptMs: 500});
    try {
        for (const v of ['coord', 'v000901/coord', 'v000902/coord', 'v000903/coord']) {
            for (const behaviors of [
                [(q, r) => r.status(500).end(), (q, r) => r.status(500).end(), (q, r) => r.status(500).end()],
                [(q, r) => r.status(404).send('no')],
                [(q, r) => r.type('html').send('<html>oops</html>')]
            ]) {
                reset(realGeocoder({kakao: ['kakao.coord.seoul']}));
                state.backendScript = behaviors.slice();
                const res = await request(app.port, 'GET', '/weather/' + v + '/37.5665,126.9780', {'Accept-Language': 'ko-KR'});
                assertErrorResponse(res, 501);
                assert.equal(state.backendHits.length, behaviors.length, v);
            }
        }
    }
    finally { await app.close(); }
});

test('RT-4 query forwarding', async () => {
    const app = await startApp();
    try {
        reset(realGeocoder({kakao: ['kakao.coord.seoul']}));
        const res = await request(app.port, 'GET', '/weather/coord/37.5665,126.9780?temperatureUnit=F&a=1&a=2&x=%ED%95%9C&p=a+b&flag&bad=%E0%A4', {'Accept-Language': 'ko'});
        assert.equal(res.status, 200);
        assert.equal(state.backendHits[0].url.split('?')[1], 'temperatureUnit=F&a=2&x=%ED%95%9C&p=a%20b&flag=');
    }
    finally { await app.close(); }
});

test('RT-5 language forms reach the geocoder and the backend unchanged', async () => {
    const app = await startApp();
    try {
        const forms = [[undefined, 'en'], ['ko-KR,ko;q=0.9', 'ko'], ['ko,en-US;q=0.9,en;q=0.8', 'ko,en'], ['KO-KR', 'KO'], ['ko&key=x', 'ko&key=x'], ['y'.repeat(70), 'en']];
        for (const [header, lang] of forms) {
            let seen;
            reset({coord: (loc, l) => { seen = l; return Promise.resolve({name: 'n', country: 'US', address: 'a', location: {lat: loc[0], long: loc[1]}}); }});
            const res = await request(app.port, 'GET', '/weather/coord/40.7128,-74.0060', header === undefined ? {} : {'Accept-Language': header});
            assert.equal(res.status, 200, String(header));
            assert.equal(seen, lang);
            assert.equal(state.backendHits[0].acceptLanguage, lang);
            assert.equal(state.backendHits[0].url, '/v000901/dsf/coord/40.713,-74.006');
        }
    }
    finally { await app.close(); }
});

test('RT-6 coordinate geoinfo', async () => {
    const app = await startApp();
    try {
        reset(realGeocoder({kakao: ['kakao.coord.seoul']}));
        const res = await request(app.port, 'GET', '/geocode/v000903/coord/37.5665,126.9780', {'Accept-Language': 'ko-KR,ko;q=0.9'});
        assert.equal(res.status, 200);
        assert.equal(res.text, JSON.stringify(goldens.coord['seoul-ko'].body));
        assert.deepEqual(Object.keys(res.json), ['name', 'country', 'address', 'location', 'kmaAddress']);
        assert.equal(res.headers['cache-control'], 'max-age=2592000');
        assert.equal(res.headers['set-cookie'], undefined);
        assert.equal(state.backendHits.length, 0);
    }
    finally { await app.close(); }
});

test('RT-7 address geoinfo is the same for v000901 and v000903; the address is the rest of the path', async () => {
    const app = await startApp();
    try {
        const bodies = [];
        for (const v of ['v000903', 'v000901']) {
            reset(realGeocoder({google: ['google.addr.jamsil']}));
            const res = await request(app.port, 'GET', '/geocode/' + v + '/addr/' + encodeURIComponent('서울특별시 송파구 잠실동'));
            assert.equal(res.status, 200);
            assert.equal(res.headers['cache-control'], 'max-age=2592000');
            bodies.push(res.text);
        }
        assert.equal(bodies[0], bodies[1]);
        assert.equal(bodies[0], JSON.stringify(goldens.addr['jamsil-google'].body));
        let seen;
        reset({addr: a => { seen = a; return Promise.resolve({country: 'KR', address: a, location: {lat: 1, long: 2}}); }});
        const res = await request(app.port, 'GET', '/geocode/v000903/addr/a/b');
        assert.equal(res.status, 200);
        assert.equal(seen, 'a/b');
        assert.equal(res.json.address, 'a/b');
    }
    finally { await app.close(); }
});

test('RT-8 excluded shapes return 404 without any call', async () => {
    const app = await startApp();
    try {
        reset({coord() { throw new Error('called'); }, addr() { throw new Error('called'); }});
        const paths = ['/weather', '/weather/', '/geocode', '/weather/addr/x', '/weather/v000903/addr/x', '/geocode/coord/1,2',
            '/geocode/addr/x', '/geocode/v000901/coord/1,2', '/geocode/v000902/addr/x', '/weather/v000803/coord/1,2', '/weather/v000903/coord'];
        for (const p of paths) {
            const res = await request(app.port, 'GET', p);
            assertErrorResponse(res, 404);
            assert.equal(res.text, 'Not Found', p);
        }
        const post = await request(app.port, 'POST', '/weather/coord/1,2');
        assertErrorResponse(post, 404);
        // Other spellings are not gateway paths (CloudFront patterns are case-sensitive).
        for (const p of ['/WEATHER/coord/40.7128,-74.0060', '/Geocode/v000903/coord/1,2']) {
            const res = await request(app.port, 'GET', p);
            assert.equal(res.status, 404, p);
            assert.match(res.headers['content-type'], /html/, p + ' reaches the legacy handlers');
        }
        // An unknown version spelling under /weather/ is an excluded shape.
        assertErrorResponse(await request(app.port, 'GET', '/weather/V000903/coord/40.7128,-74.0060'), 404);
        assert.equal(state.geocoderCalls, 0);
        assert.equal(state.backendHits.length, 0);
    }
    finally { await app.close(); }
});

test('RT-9 input rules', async () => {
    const app = await startApp();
    try {
        reset({coord: () => Promise.resolve({name: 'n', country: 'US', address: 'a', location: {lat: 1, long: 2}}),
               addr: () => Promise.resolve({country: 'KR', address: 'a', location: {lat: 1, long: 2}})});
        for (const loc of ['abc,1', '1', '91,0', '0,181', 'NaN,1']) {
            assertErrorResponse(await request(app.port, 'GET', '/weather/coord/' + loc), 400);
            assertErrorResponse(await request(app.port, 'GET', '/geocode/v000903/coord/' + loc), 400);
        }
        for (const loc of ['0,0', ',', '0.0004,-0.0004']) {
            assertErrorResponse(await request(app.port, 'GET', '/weather/coord/' + loc), 404);
        }
        const three = await request(app.port, 'GET', '/weather/coord/40.7128,-74.0060,5');
        assert.equal(three.status, 200, 'extra parts are ignored like the Lambda');
        assert.equal(state.backendHits.pop().url, '/v000901/dsf/coord/1,2');
        assertErrorResponse(await request(app.port, 'GET', '/geocode/v000903/addr/' + 'a'.repeat(201)), 400);
        assert.equal((await request(app.port, 'GET', '/geocode/v000903/addr/' + 'a'.repeat(200))).status, 200);
        assertErrorResponse(await request(app.port, 'GET', '/weather/coord/%ZZ'), 400);
        assertErrorResponse(await request(app.port, 'GET', '/geocode/v000903/addr/%E0%A4%A'), 400);
    }
    finally { await app.close(); }
});

test('RT-10 error bodies leak nothing', async () => {
    const app = await startApp({attemptMs: 500});
    try {
        reset({coord: () => Promise.reject(new Error('url=https://maps.googleapis.com/x?key=SECRET-KEY-VALUE failed'))});
        assertErrorResponse(await request(app.port, 'GET', '/geocode/v000903/coord/40.7128,-74.0060'), 501);
        reset(realGeocoder({kakao: ['kakao.coord.seoul']}));
        state.backendScript = [0, 1, 2].map(() => (q, r) => r.status(500).send('Error: url=http://internal.example.net/v000901 key=abc'));
        const res = await request(app.port, 'GET', '/weather/coord/37.5665,126.9780');
        assertErrorResponse(res, 501);
        assert.equal(res.text, 'Not Implemented');
    }
    finally { await app.close(); }
});

test('RT-11 backend retries and redirects', async () => {
    const app = await startApp({attemptMs: 200, deadlineMs: 2000});
    const ok = (q, r) => backendHandler.call(null, q, r);
    const scenarios = [
        {name: 'a 503,503,200', script: [(q, r) => r.status(503).end(), (q, r) => r.status(503).end()], status: 200, hits: 3},
        {name: 'b 404', script: [(q, r) => r.status(404).end()], status: 501, hits: 1},
        {name: 'c slow then 200', script: [(q, r) => setTimeout(() => r.json({late: true}), 400)], status: 200, hits: 2},
        {name: 'd reset then 200', script: [(q, r) => q.socket.destroy()], status: 200, hits: 2},
        {name: 'e redirect', script: [(q, r) => r.redirect('/weather/coord/1,2')], status: 501, hits: 1},
        {name: 'f all time out', script: [0, 1, 2].map(() => (q, r) => setTimeout(() => r.json({}), 1500)), status: 501, hits: 3}
    ];
    try {
        for (const s of scenarios) {
            reset(realGeocoder({kakao: ['kakao.coord.seoul']}));
            state.backendScript = s.script.slice();
            const started = Date.now();
            const res = await request(app.port, 'GET', '/weather/v000903/coord/37.5665,126.9780', {'Accept-Language': 'ko'});
            assert.equal(res.status, s.status, s.name);
            // Hits are recorded when the stub receives the request; wait for stragglers.
            await sleep(50);
            assert.equal(state.backendHits.filter(h => h.url.startsWith('/v000903/kma/addr/')).length, s.hits, s.name);
            assert.ok(Date.now() - started < 2100, s.name + ' within the deadline');
            if (s.status === 200) { assert.equal(res.json.name, '명동'); }
        }
        void ok;
    }
    finally { await app.close(); }
});

test('RT-12 the request deadline ends a stuck request with 501', async () => {
    const app = await startApp({deadlineMs: 300, attemptMs: 3000});
    try {
        reset(realGeocoder({kakao: ['kakao.coord.seoul']}));
        state.backendScript = [() => {}];
        const started = Date.now();
        const res = await request(app.port, 'GET', '/weather/coord/37.5665,126.9780', {'Accept-Language': 'ko'});
        const elapsed = Date.now() - started;
        assertErrorResponse(res, 501);
        assert.ok(elapsed >= 280 && elapsed < 800, 'elapsed ' + elapsed);
    }
    finally { await app.close(); }
});

test('RT-13 in-flight limit, and aborted clients release their slots', async () => {
    const app = await startApp({maxInflight: 2});
    try {
        const usGeo = {coord: loc => Promise.resolve({name: 'n', country: 'US', address: 'a', location: {lat: loc[0], long: loc[1]}})};
        reset(usGeo);
        state.backendDelayMs = 1000;
        const first = await Promise.all([0, 1, 2, 3, 4].map(() => request(app.port, 'GET', '/weather/coord/40.7128,-74.0060')));
        assert.deepEqual(first.map(r => r.status).sort(), [200, 200, 503, 503, 503]);
        first.filter(r => r.status === 503).forEach(r => {
            assert.equal(r.headers['retry-after'], '5');
            assertErrorResponse(r, 503);
        });
        // Two clients abort at 100 ms while their handlers wait for the 1 s backend.
        const aborted = await Promise.all([0, 1].map(() => request(app.port, 'GET', '/weather/coord/40.7128,-74.0060', {}, 100)));
        assert.ok(aborted.every(r => r.aborted), JSON.stringify(aborted.map(r => r.aborted ? 'aborted' : r.status)));
        await sleep(1300);          // the aborted handlers finish when the backend answers
        state.backendDelayMs = 0;
        const after = await Promise.all([0, 1].map(() => request(app.port, 'GET', '/weather/coord/40.7128,-74.0060')));
        assert.deepEqual(after.map(r => r.status), [200, 200], 'both slots were released');
    }
    finally { await app.close(); }
});

test('RT-14 OPTIONS, HEAD, no cookies, and the mount order in app.js', async () => {
    const app = await startApp();
    try {
        reset({coord() { throw new Error('called'); }});
        const options = await request(app.port, 'OPTIONS', '/weather/v000903/coord/1,2', {'Origin': 'https://example.test', 'Access-Control-Request-Method': 'GET'});
        assert.equal(options.status, 204);
        assert.equal(options.headers['access-control-allow-origin'], '*');
        assert.equal(state.geocoderCalls, 0);
        reset(realGeocoder({kakao: ['kakao.coord.seoul']}));
        const head = await request(app.port, 'HEAD', '/weather/coord/37.5665,126.9780', {'Accept-Language': 'ko'});
        assert.equal(head.status, 200);
        assert.equal(head.text, '');
        assert.equal(head.headers['cache-control'], 'max-age=300');
        assert.equal(head.headers['set-cookie'], undefined);
    }
    finally { await app.close(); }
    const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const corsAt = source.indexOf('app.use(cors());');
    const gatewayAt = source.indexOf("app.use(require('./routes/gateway'));");
    const sessionAt = source.indexOf('app.use(session(');
    assert.ok(corsAt >= 0 && gatewayAt > corsAt && sessionAt > gatewayAt, 'cors → gateway → session');
});

test('RT-15 handler exceptions become text/plain 501', async () => {
    const app = await startApp();
    try {
        reset({coord() { throw new Error('sync failure'); }});
        assertErrorResponse(await request(app.port, 'GET', '/geocode/v000903/coord/40.7128,-74.0060'), 501);
        reset({coord: () => Promise.reject(new TypeError('async failure'))});
        assertErrorResponse(await request(app.port, 'GET', '/weather/v000902/coord/40.7128,-74.0060'), 501);
    }
    finally { await app.close(); }
});

test('RT-16 one log line per request with the spec fields and no raw location or key', async () => {
    const app = await startApp();
    try {
        logLines.length = 0;
        reset(realGeocoder({kakao: ['kakao.coord.seoul']}));
        await request(app.port, 'GET', '/weather/v000903/coord/37.5665,126.9780?x=1', {'Accept-Language': 'ko'});
        const line = logLines.find(l => l.startsWith('gateway {'));
        assert.ok(line, logLines.join('\n'));
        const info = JSON.parse(line.slice('gateway '.length));
        assert.deepEqual(Object.keys(info), ['route', 'version', 'cache', 'provider', 'backend', 'ms', 'status']);
        assert.equal(info.version, 'v000903');
        assert.equal(info.cache, 'miss');
        assert.equal(info.provider, 'kakao');
        assert.equal(info.backend, 200);
        assert.equal(info.status, 200);
        assert.doesNotMatch(line, /37\.5665|126\.978|kakao-key/);
    }
    finally { await app.close(); }
});
