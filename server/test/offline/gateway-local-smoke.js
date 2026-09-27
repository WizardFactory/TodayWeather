/* Local functional smoke for the gateway routes (#2606), scenario LD-1 of
 * specs/issue-2606-test-scenarios.md. Runs the real bin/www (SERVER_MODE=service)
 * against an empty mongod and stub Kakao/Google servers on loopback, with
 * API_SERVER pointing at itself so the internal callers exercise the versioned
 * public geocode path end to end.
 *
 * Needs the full server dependency install and a mongod 4.0.x binary. Run it in a
 * network namespace with only loopback, so no real provider or KMA endpoint is
 * reachable:
 *   SERVER_NODE_MODULES=/path/to/server/node_modules MONGOD_BIN=/path/to/mongod \
 *   NODE_BIN=/path/to/node-16.20.2 \
 *     unshare -rn sh -c 'ip link set lo up && node server/test/offline/gateway-local-smoke.js'
 * NODE_BIN (default: this Node) runs bin/www; use the production Node 16.20.2 with a
 * dependency install built for it (native iconv).
 * Everything it starts is stopped and its temporary directory removed at the end.
 */
'use strict';
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const serverDir = path.resolve(__dirname, '../..');
const nodeModules = process.env.SERVER_NODE_MODULES;
const mongodBin = process.env.MONGOD_BIN;
if (!nodeModules || !mongodBin) {
    console.error('not run: SERVER_NODE_MODULES and MONGOD_BIN are required');
    process.exit(2);
}
const providers = require('./fixtures/gateway/providers.json');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-ld-'));
const children = [];
const results = [];
const providerCalls = [];
const APP_PORT = 39000 + Math.floor(Math.random() * 500);
const MONGO_PORT = APP_PORT + 1000;
const STUB_PORT = APP_PORT + 2000;

function copyServer(src, dst) {
    fs.mkdirSync(dst, {recursive: true});
    for (const entry of fs.readdirSync(src, {withFileTypes: true})) {
        if (entry.name === 'node_modules' || entry.name === '.env') { continue; }
        const from = path.join(src, entry.name);
        const to = path.join(dst, entry.name);
        if (entry.isDirectory()) { copyServer(from, to); } else { fs.copyFileSync(from, to); }
    }
}

function stubProviders() {
    return http.createServer((req, res) => {
        const url = new URL(req.url, 'http://stub');
        providerCalls.push(url.pathname);
        let body;
        if (url.pathname === '/v2/local/geo/coord2regioncode.json') { body = providers['kakao.coord.seoul']; }
        else if (url.pathname === '/v2/local/search/address.json') { body = providers['kakao.addr.jamsil']; }
        else if (url.pathname === '/maps/api/geocode/json' && url.searchParams.has('address')) { body = providers['google.addr.jamsil']; }
        else if (url.pathname === '/maps/api/geocode/json') { body = providers['google.coord.london']; }
        else { res.writeHead(404); return res.end(); }
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify(body));
    });
}

function get(pathname, headers, method) {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const req = http.request({host: '127.0.0.1', port: APP_PORT, path: pathname, method: method || 'GET', headers: headers || {}}, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve({status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8'), ms: Date.now() - started}));
        });
        req.on('error', reject);
        req.setTimeout(15000, () => req.destroy(new Error('client timeout')));
        req.end();
    });
}

async function waitFor(check, timeoutMs, what) {
    const until = Date.now() + timeoutMs;
    for (;;) {
        try { if (await check()) { return; } } catch (e) { /* retry */ }
        if (Date.now() > until) { throw new Error('timed out waiting for ' + what); }
        await new Promise(r => setTimeout(r, 200));
    }
}

function record(name, ok, detail) {
    results.push({name, ok, detail});
    console.log((ok ? 'ok     ' : 'FAILED ') + name + (detail ? ' — ' + detail : ''));
}

function assertNotHtml(res) {
    assert.doesNotMatch(res.headers['content-type'] || '', /html/);
    assert.equal(res.headers['set-cookie'], undefined);
}

async function main() {
    const appDir = path.join(tmp, 'server');
    copyServer(serverDir, appDir);
    fs.symlinkSync(nodeModules, path.join(appDir, 'node_modules'));
    fs.mkdirSync(path.join(tmp, 'db'));

    const mongod = spawn(mongodBin, ['--dbpath', path.join(tmp, 'db'), '--port', String(MONGO_PORT), '--bind_ip', '127.0.0.1', '--nounixsocket'], {stdio: 'ignore'});
    children.push(mongod);
    const stub = stubProviders();
    await new Promise(r => stub.listen(STUB_PORT, '127.0.0.1', r));

    const appLog = [];
    appLogRef = appLog;
    const env = {
        PATH: process.env.PATH, HOME: tmp, TZ: 'UTC', NODE_ENV: 'production',
        SERVER_MODE: 'service', PORT: String(APP_PORT),
        MONGOLAB_MONGODB_URL: 'mongodb://127.0.0.1:' + MONGO_PORT + '/tw_gateway_smoke',
        MONGOLAB_MONGODB_DATABASE: 'tw_gateway_smoke',
        API_SERVER: 'http://127.0.0.1:' + APP_PORT,
        GEOCODER_KAKAO_KEYS: '["ld-kakao-key"]',
        // Accepted only because GEOCODER_GOOGLE_BASE_URL points at the stub; against the
        // real endpoint only the key with fingerprint ecd5fdb1 is used (keys.js).
        GEOCODER_GOOGLE_KEY: 'ld-google-key',
        GEOCODER_KAKAO_BASE_URL: 'http://127.0.0.1:' + STUB_PORT,
        GEOCODER_GOOGLE_BASE_URL: 'http://127.0.0.1:' + STUB_PORT
    };
    const app = spawn(process.env.NODE_BIN || process.execPath, ['bin/www'], {cwd: appDir, env});
    children.push(app);
    app.stdout.on('data', d => appLog.push(d.toString()));
    app.stderr.on('data', d => appLog.push(d.toString()));
    await waitFor(async () => (await get('/health')).status === 200, 60000, 'bin/www');
    const mongoose = require(path.join(nodeModules, 'mongoose'));
    await waitFor(async () => { await mongoose.connect(env.MONGOLAB_MONGODB_URL); return true; }, 30000, 'mongod');
    const caches = () => mongoose.connection.db.collection('geocodecaches');
    await new Promise(r => setTimeout(r, 2000));          // the app connects at startup

    const seoul = '37.5665,126.9780';
    const ko = {'Accept-Language': 'ko-KR,ko;q=0.9'};

    // R3 miss, then hit.
    let res = await get('/geocode/v000903/coord/' + seoul, ko);
    assertNotHtml(res);
    const r3 = JSON.parse(res.text);
    record('R3 200 with name and kmaAddress, no cookie', res.status === 200 && r3.name === '명동' && !!r3.kmaAddress, res.status + ' ' + res.text.slice(0, 80));
    const callsAfterMiss = providerCalls.length;
    await waitFor(async () => (await caches().count()) >= 1, 10000, 'cache write');
    res = await get('/geocode/v000903/coord/' + seoul, ko);
    record('R3 second request is a cache hit', res.status === 200 && res.text === JSON.stringify(r3) && providerCalls.length === callsAfterMiss);

    // R1/R2 reach each version's real kma/addr chain.
    const weather = {};
    for (const [label, p] of [['R1', '/weather/coord/'], ['R2 v000901', '/weather/v000901/coord/'], ['R2 v000902', '/weather/v000902/coord/'], ['R2 v000903', '/weather/v000903/coord/']]) {
        res = await get(p + seoul, ko);
        assertNotHtml(res);
        weather[label] = res;
        const ok = (res.status === 200 && /application\/json/.test(res.headers['content-type'])) ||
            (res.status === 501 && res.text === 'Not Implemented');
        record(label + ' reaches the ' + (label === 'R1' ? 'v000901' : label.slice(3)) + ' chain within 9 s',
            ok && res.ms < 9500, res.status + ' in ' + res.ms + ' ms');
    }
    // Non-KR: the real dsf/coord chain of each version (Visual Crossing since #2585; it
    // fails without network, so a quick 501 is the expected outcome here).
    const london = '51.5074,-0.1278';
    for (const [label, p] of [['R1 London', '/weather/coord/'], ['R2 v000901 London', '/weather/v000901/coord/'], ['R2 v000902 London', '/weather/v000902/coord/'], ['R2 v000903 London', '/weather/v000903/coord/']]) {
        res = await get(p + london, {'Accept-Language': 'en-GB'});
        assertNotHtml(res);
        const ok = (res.status === 200 && /application\/json/.test(res.headers['content-type'])) ||
            (res.status === 501 && res.text === 'Not Implemented');
        record(label + ' reaches the dsf/coord chain within 9 s', ok && res.ms < 9500, res.status + ' in ' + res.ms + ' ms');
    }
    res = await get('/weather/coord/' + seoul + '?_twcb=1', ko);
    record('R1 with _twcb has the same status', res.status === weather.R1.status);

    // R4, X1, OPTIONS.
    res = await get('/geocode/v000903/addr/' + encodeURIComponent('서울특별시 송파구 잠실동'));
    record('R4 200', res.status === 200 && JSON.parse(res.text).country === 'KR', res.text.slice(0, 80));
    record('key-fingerprint log line (first gateway request) shows fingerprints only', /gateway geocoder keys: kakao=\[[0-9a-f]{8}\] google=\[[0-9a-f]{8}\]/.test(appLog.join('')) && !appLog.join('').includes('ld-google-key'));
    res = await get('/weather/addr/x');
    record('X1 → 404 text/plain', res.status === 404 && res.text === 'Not Found' && res.headers['cache-control'] === 'no-store');
    res = await get('/weather/v000903/coord/1,2', {'Origin': 'https://example.test', 'Access-Control-Request-Method': 'GET'}, 'OPTIONS');
    record('OPTIONS → 204 with ACAO', res.status === 204 && res.headers['access-control-allow-origin'] === '*');

    // Internal caller through the versioned public path (API_SERVER = this server).
    res = await get('/v000903/geo/' + seoul);
    record('route.geo → ../kma/addr redirect via /geocode/v000903/coord', res.status === 302 && /^\.\.\/kma\/addr\//.test(res.headers.location || ''), res.status + ' ' + res.headers.location);

    // One gateway log line per gateway request, with the version.
    const lines = appLog.join('').split('\n').filter(l => l.includes('gateway {'));
    const infos = lines.map(l => { try { return JSON.parse(l.slice(l.indexOf('{'))); } catch (e) { return null; } }).filter(Boolean);
    const weatherInfos = infos.filter(i => i.route === 'weather');
    record('gateway log lines carry the version', ['v000901', 'v000902', 'v000903'].every(v => weatherInfos.some(i => i.version === v)), lines.length + ' lines');
    record('every weather request reached its backend (numeric backend status in the log)',
        weatherInfos.length >= 9 && weatherInfos.every(i => typeof i.backend === 'number'),
        weatherInfos.map(i => i.version + ':' + i.backend).join(' '));

    // TTL index created by the first geocoder use.
    const indexes = await caches().indexes();
    const count = await caches().count();
    await mongoose.disconnect();
    record('geocodecaches TTL index and records', indexes.some(i => i.key.updatedAt === 1 && i.expireAfterSeconds === 2592000) && count >= 2, count + ' records');

    const failed = results.filter(r => !r.ok);
    console.log(JSON.stringify({passed: results.length - failed.length, failed: failed.length, weather: Object.fromEntries(Object.entries(weather).map(([k, v]) => [k, v.status]))}));
    if (failed.length) {
        console.log(appLog.join('').split('\n').slice(-40).join('\n'));
        process.exitCode = 1;
    }
    stub.close();
}

let appLogRef = [];
function appLogTail() { return appLogRef.join('').split('\n').slice(-30).join('\n'); }

function cleanup() {
    for (const child of children) { try { child.kill('SIGKILL'); } catch (e) { /* ignore */ } }
    setTimeout(() => fs.rmSync(tmp, {recursive: true, force: true}), 300);
}

main().catch(err => {
    console.error('FAILED', err);
    console.error(appLogTail());
    process.exitCode = 1;
}).finally(() => {
    cleanup();
    setTimeout(() => process.exit(process.exitCode || 0), 600);
});
