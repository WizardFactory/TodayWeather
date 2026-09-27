/* Full v000903 KMA router smoke for the WAQI domestic air fallback (#2622).
 * Uses the rss-response-smoke harness (no Mongo, no production calls) and real axios HTTP to a
 * loopback fake WAQI feed. Two harness instances sharing one cache store stand in for two API workers.
 * Run: TZ=UTC NODE_PATH=/tmp/tw-2622/node_modules node server/test/offline/waqi-air-smoke.js
 * Requires axios 0.18 in NODE_PATH in addition to the rss-response-smoke dependencies.
 * Optional TW_SMOKE_OUTPUT_DIR selects artifact directory outside the checkout.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');
const axios = require('axios');
const {makeFixture, createHarness, locations} = require('./rss-response-smoke');
const outputDir = process.env.TW_SMOKE_OUTPUT_DIR || path.join(require('os').tmpdir(), 'waqi-air-smoke-output');
fs.mkdirSync(outputDir, {recursive: true});

const TOKEN = 'smoke-token';
const NOW = Date.parse('2026-09-24T00:10:00.000Z');       // harness request time (09:10 KST)
const feeds = ['seoul', 'jeju'].map(name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'waqi-' + name + '.json'), 'utf8')));
const kst = ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 19) + '+09:00';

// Loopback WAQI: `provider.mode` selects the answer; every request is recorded.
const provider = {mode: 'ok', requests: []};
const sockets = new Set();
const server = http.createServer((req, res) => {
    const match = /^\/feed\/geo:([-\d.]+);([-\d.]+)\/\?token=(.*)$/.exec(req.url);
    provider.requests.push({url: req.url.replace(/token=.*/, 'token=<redacted>'), mode: provider.mode});
    assert(match, 'geo feed path');
    assert.equal(decodeURIComponent(match[3]), TOKEN);
    const lat = Number(match[1]);
    const body = JSON.parse(JSON.stringify(feeds.reduce((best, f) =>
        Math.abs(f.data.city.geo[0] - lat) < Math.abs(best.data.city.geo[0] - lat) ? f : best)));
    body.data.time = {iso: kst(NOW - (provider.mode === 'stale' ? 9 : 1.2) * 3600000)};
    if (provider.mode === 'far') { body.data.city.geo = [body.data.city.geo[0] + 1, body.data.city.geo[1]]; }
    const send = (status, payload) => { res.writeHead(status, {'content-type': 'application/json'}); res.end(JSON.stringify(payload)); };
    if (provider.mode === 'http500') { return send(500, {status: 'error'}); }
    if (provider.mode === 'status') { return send(200, {status: 'error', data: 'Unknown station'}); }
    if (provider.mode === 'timeout') { return setTimeout(() => send(200, body), 3500); }
    send(200, body);
});
server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

function cacheStore() {
    const rows = new Map();
    return {rows, model: {
        find(query) {
            const q = {limit() { return q; }, lean() { return q; },
                exec(cb) { cb(null, rows.has(query._id) ? [JSON.parse(JSON.stringify(rows.get(query._id)))] : []); }};
            return q;
        },
        updateOne(query, update, options, cb) {
            assert.equal(options.upsert, true);
            rows.set(query._id, Object.assign({_id: query._id}, JSON.parse(JSON.stringify(update.$set))));
            cb(null);
        }
    }};
}

const missingAir = {arpltn: undefined, list: undefined, stnList: []};
const freshAir = {stationName: '중구', mangName: '도시대기', dataTime: '2026-09-24 09:00',
    pm10Value: 20, pm10Grade: 1, pm25Value: 8, pm25Grade: 1, o3Value: 0.02, o3Grade: 1,
    no2Value: 0.01, no2Grade: 1, coValue: 0.3, coGrade: 1, so2Value: 0.003, so2Grade: 1};

async function run(label, {place = locations[0], version = '1.0', airUnit = 'airkorea', arpltnInfo = missingAir,
    arpltnError, key = TOKEN, store = cacheStore(), addr = false, mode = 'ok'}) {
    provider.mode = mode;
    const fixture = makeFixture(place, 'equal');
    fixture.arpltnInfo = arpltnInfo;
    if (arpltnError) { fixture.arpltnError = arpltnError; }
    const redirected = axios.create();
    redirected.interceptors.request.use(c => Object.assign(c, {url: c.url.replace('https://api.waqi.info', 'http://127.0.0.1:' + server.address().port)}));
    const harness = createHarness(version, fixture, {
        keyString: key === null ? undefined : {aqi_keys: [{key}]}, waqiCache: store, modules: {axios: redirected}});
    const before = provider.requests.length;
    const started = Date.now();
    const result = await harness.request({airUnit, windSpeedUnit: 'm/s', temperatureUnit: 'C'}, {addr});
    const thrown = result.logs.filter(x => x.args.some(a => typeof a === 'string' && /TypeError|ReferenceError|AssertionError/.test(a)));
    assert.deepEqual(thrown, [], label + ': no swallowed programming exceptions');
    const expected = addr ? harness.methods.slice(1) : harness.methods;
    assert.deepEqual(result.traces, expected, label + ': every v000903 middleware ran');
    return {body: result.body, current: result.body.current, waqiRequests: provider.requests.length - before, ms: Date.now() - started, store};
}

function assertNoAir(label, r) {
    assert.equal(r.current.arpltn, undefined, label + ': no arpltn');
    assert.equal('summaryAir' in r.current, false, label + ': summaryAir omitted');
    assert.equal(r.body.airInfoList, undefined, label + ': no airInfoList');
}

async function main() {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const out = [];
    const record = (id, ac, r, extra) => out.push(Object.assign({id, ac, waqiRequests: r.waqiRequests, ms: r.ms,
        arpltn: r.current.arpltn, summaryAir: r.current.summaryAir,
        airInfoSources: (r.body.airInfoList || []).map(a => a.source)}, extra));

    for (const version of ['1.0', '2.0']) {
        // S1 (AC1): fallback fills current air, summary and the air detail list.
        for (const airUnit of ['airkorea', 'airnow']) {
            const label = 'S1/' + version + '/' + airUnit;
            const r = await run(label, {version, airUnit});
            const a = r.current.arpltn;
            assert.equal(r.waqiRequests, 1, label + ': one WAQI request');
            assert.equal(a.source, 'aqicn', label);
            assert.equal(a.stationName, 'Seoul (서울)', label);
            assert.equal(typeof a.pm10Value, 'number', label); assert.equal(typeof a.pm25Value, 'number', label);
            assert(a.pm25Grade >= 1, label + ': pm25 grade for ' + airUnit);
            assert(a.aqiGrade >= 1, label + ': integrated grade');
            assert.equal(typeof r.current.summaryAir, 'string', label); assert(r.current.summaryAir.length > 0, label + ': summaryAir');
            assert.equal(r.body.airInfoList.length, 1, label);
            assert.equal(r.body.airInfoList[0].source, 'aqicn', label);
            assert.equal(r.body.airInfoList[0].last.source, 'aqicn', label);
            assert.equal(r.body.airInfoList[0].last.pm25Grade, a.pm25Grade, label + ': detail and current agree');
            assert(r.body.airInfoList[0].pollutants.pm25.hourly.length >= 1, label + ': hourly entry for the chart');
            record(label, 'AC1', r);
        }
        // S2 (AC2): fresh AirKorea observation, WAQI untouched, same arpltn as without a key.
        const withKey = await run('S2/' + version, {version, arpltnInfo: {arpltn: freshAir, list: [freshAir], stnList: [[freshAir]]}});
        const noKey = await run('S2-baseline/' + version, {version, key: null, arpltnInfo: {arpltn: freshAir, list: [freshAir], stnList: [[freshAir]]}});
        assert.equal(withKey.waqiRequests, 0, 'S2: no WAQI request');
        assert.deepEqual(withKey.current.arpltn, noKey.current.arpltn, 'S2: arpltn unchanged');
        assert.deepEqual(withKey.body.airInfoList, noKey.body.airInfoList, 'S2: airInfoList unchanged');
        assert.equal(withKey.body.airInfoList[0].source, 'airkorea');
        record('S2/' + version, 'AC2', withKey);
    }

    // S3 (AC3): every failure keeps the no-air response and the route completes.
    for (const mode of ['stale', 'far', 'http500', 'status', 'timeout']) {
        const r = await run('S3/' + mode, {mode});
        assert.equal(r.waqiRequests, 1, 'S3/' + mode);
        assertNoAir('S3/' + mode, r);
        if (mode === 'timeout') { assert(r.ms < 5000, 'S3/timeout bounded: ' + r.ms + ' ms'); }
        record('S3/' + mode, 'AC3', r);
    }
    const noKey = await run('S3/no-key', {key: null});
    assert.equal(noKey.waqiRequests, 0); assertNoAir('S3/no-key', noKey); record('S3/no-key', 'AC3', noKey);
    const placeholder = await run('S3/placeholder-key', {key: 'You have to set key of WAQI'});
    assert.equal(placeholder.waqiRequests, 0); assertNoAir('S3/placeholder-key', placeholder); record('S3/placeholder-key', 'AC3', placeholder);
    const kecoFailNoKey = await run('S3/keco-error-no-key', {arpltnError: 'mongo down', key: null});
    assertNoAir('S3/keco-error-no-key', kecoFailNoKey); record('S3/keco-error-no-key', 'AC3', kecoFailNoKey);
    const kecoFail = await run('S3/keco-error-waqi-ok', {arpltnError: 'mongo down'});
    assert.equal(kecoFail.current.arpltn.source, 'aqicn', 'failing AirKorea lookup falls back to WAQI');
    record('S3/keco-error-waqi-ok', 'AC3', kecoFail);

    // S4 (AC4): a second request on another worker reuses the shared cache.
    const shared = cacheStore();
    const first = await run('S4/worker-a', {store: shared});
    const second = await run('S4/worker-b', {store: shared});
    assert.equal(first.waqiRequests, 1); assert.equal(second.waqiRequests, 0, 'S4: second request served from cache');
    assert.deepEqual(second.current.arpltn, first.current.arpltn);
    const failed = cacheStore();
    await run('S4/failure-a', {store: failed, mode: 'http500'});
    const failedAgain = await run('S4/failure-b', {store: failed, mode: 'ok'});
    assert.equal(failedAgain.waqiRequests, 0, 'S4: recent failure reused, no hammering'); assertNoAir('S4/failure-b', failedAgain);
    record('S4/worker-b', 'AC4', second, {cacheRows: [...shared.rows.values()].map(r => ({_id: r._id, outcome: r.outcome, ttlMin: (new Date(r.expireAt) - new Date(r.fetchedAt)) / 60000}))});
    record('S4/failure-b', 'AC4', failedAgain);

    // S5 (AC5): the address route gives the same air result.
    const byCoord = await run('S5/coord', {});
    const byAddr = await run('S5/addr', {addr: true});
    assert.equal(byAddr.waqiRequests, 1);
    assert.deepEqual(byAddr.current.arpltn, byCoord.current.arpltn, 'S5: arpltn');
    assert.deepEqual(byAddr.body.airInfoList, byCoord.body.airInfoList, 'S5: airInfoList');
    record('S5/addr', 'AC5', byAddr);

    // S6 (AC6): a long WAQI name reaches the response as its smallest unit.
    const jeju = await run('S6/jeju', {place: locations[2]});
    assert.equal(jeju.current.arpltn.stationName, 'Ido-dong');
    assert.equal(jeju.body.airInfoList[0].last.stationName, 'Ido-dong');
    record('S6/jeju', 'AC6', jeju);

    const report = {createdAt: new Date().toISOString(), hostTimezone: process.env.TZ || 'system', node: process.version,
        provider: 'loopback fake WAQI over real axios ' + require('axios/package.json').version, outcome: 'passed',
        scenarioCount: out.length, waqiRequests: provider.requests, scenarios: out};
    fs.writeFileSync(path.join(outputDir, 'waqi-air-evidence.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({outcome: report.outcome, scenarioCount: out.length, evidence: path.join(outputDir, 'waqi-air-evidence.json')}, null, 2));
}
main().catch(err => { console.error(err.stack); process.exitCode = 1; })
    .finally(() => { sockets.forEach(s => s.destroy()); server.close(); });
