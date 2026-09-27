/* Full v000903 KMA router smoke for the air provider chain (#2628; domestic fallback from #2622).
 * Uses the rss-response-smoke harness (no Mongo, no production calls) and real axios HTTP to one
 * loopback server that plays Google, OpenWeather, Visual Crossing and WAQI. Harness instances that
 * share the same in-memory stores stand in for API workers.
 * Run: TZ=UTC NODE_PATH=/tmp/tw-2622/node_modules node server/test/offline/air-chain-smoke.js
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
const {memoryModel, fixture} = require('./air-harness');
const outputDir = process.env.TW_SMOKE_OUTPUT_DIR || path.join(require('os').tmpdir(), 'air-chain-smoke-output');
fs.mkdirSync(outputDir, {recursive: true});

const KEYS = {google: 'google-smoke-key-0001', openweather: 'owm-smoke-key-0001', visualcrossing: 'vc-smoke-key-0001', aqicn: 'waqi-smoke-token-0001'};
const ALL_KEYS = {google_key: KEYS.google, owm_keys: [{key: KEYS.openweather}], vc_key: KEYS.visualcrossing, aqi_keys: [{key: KEYS.aqicn}]};
const WAQI_ONLY = {aqi_keys: [{key: KEYS.aqicn}]};
const NOW = Date.parse('2026-09-24T00:10:00.000Z');       // harness request time (09:10 KST)
const HOSTS = {'airquality.googleapis.com': 'google', 'api.openweathermap.org': 'openweather', 'weather.visualcrossing.com': 'visualcrossing', 'api.waqi.info': 'aqicn'};
const kst = ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 19) + '+09:00';

// One loopback server for all providers: the path prefix says which one; `modes[id]` selects the answer.
const provider = {modes: {}, requests: []};
const sockets = new Set();
function body(id, mode) {
    const observedMs = NOW - (mode === 'stale' ? 9 : 1.2) * 3600000;
    if (id === 'google') {
        const g = fixture('air/google-seoul'); g.dateTime = new Date(observedMs).toISOString(); return g;
    }
    if (id === 'openweather') {
        const o = fixture('air/openweather-seoul'); o.list[0].dt = Math.floor(observedMs / 1000); return o;
    }
    if (id === 'visualcrossing') {
        const v = fixture('air/visualcrossing-seoul'); v.currentConditions.datetimeEpoch = Math.floor(observedMs / 1000); return v;
    }
    const w = fixture(mode === 'jeju' ? 'waqi-jeju' : 'waqi-seoul');
    w.data.time = {iso: kst(observedMs)};
    if (mode === 'far') { w.data.city.geo = [w.data.city.geo[0] + 1, w.data.city.geo[1]]; }
    return w;
}
const server = http.createServer((req, res) => {
    const id = req.url.startsWith('/v1/currentConditions') ? 'google' : req.url.startsWith('/data/2.5/air_pollution') ? 'openweather' :
        req.url.startsWith('/VisualCrossingWebServices') ? 'visualcrossing' : req.url.startsWith('/feed/geo:') ? 'aqicn' : undefined;
    assert(id, 'known provider path: ' + req.url);
    const mode = provider.modes[id] || 'ok';
    provider.requests.push({provider: id, mode, path: req.url.replace(/(key|appid|token)=[^&]*/g, '$1=<redacted>')});
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
        const send = (status, payload) => { res.writeHead(status, {'content-type': 'application/json'}); res.end(JSON.stringify(payload)); };
        if (id === 'google') { const sent = JSON.parse(Buffer.concat(chunks).toString('utf8')); assert.equal(sent.location.latitude, 37.5665); }
        if (mode === 'http500') { return send(500, {status: 'error'}); }
        if (mode === 'auth') { return send(403, {error: {code: 403, message: 'API disabled'}}); }
        if (mode === 'quota') { return send(429, {error: {code: 429}}); }
        if (mode === 'status') { return send(200, {status: 'error', data: 'Unknown station'}); }
        if (mode === 'timeout') { return setTimeout(() => send(200, body(id, 'ok')), 3500); }
        send(200, body(id, mode));
    });
});
server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

function stores() {
    return {'air.observation.cache.model': memoryModel(), 'air.provider.usage.model': memoryModel(), 'vc.usage.model': memoryModel(), 'vc.fetch.lock.model': memoryModel()};
}
const missingAir = {arpltn: undefined, list: undefined, stnList: []};
const freshAir = {stationName: '중구', mangName: '도시대기', dataTime: '2026-09-24 09:00',
    pm10Value: 20, pm10Grade: 1, pm25Value: 8, pm25Grade: 1, o3Value: 0.02, o3Grade: 1,
    no2Value: 0.01, no2Grade: 1, coValue: 0.3, coGrade: 1, so2Value: 0.003, so2Grade: 1};

async function run(label, {place = locations[0], version = '1.0', airUnit = 'airkorea', arpltnInfo = missingAir, arpltnError,
    keyString = ALL_KEYS, airModels = stores(), airConfig = {}, addr = false, modes = {}}) {
    provider.modes = modes;
    const fixtureData = makeFixture(place, 'equal');
    fixtureData.arpltnInfo = arpltnInfo;
    if (arpltnError) { fixtureData.arpltnError = arpltnError; }
    const redirected = axios.create();
    redirected.interceptors.request.use(c => {
        const u = new URL(c.url);
        assert(HOSTS[u.hostname], 'unexpected host ' + u.hostname);
        u.protocol = 'http:'; u.host = '127.0.0.1:' + server.address().port;
        return Object.assign(c, {url: u.toString()});
    });
    const harness = createHarness(version, fixtureData, {keyString, airModels, airConfig, modules: {axios: redirected}});
    const before = provider.requests.length;
    const started = Date.now();
    const result = await harness.request({airUnit, windSpeedUnit: 'm/s', temperatureUnit: 'C'}, {addr});
    const thrown = result.logs.filter(x => x.args.some(a => typeof a === 'string' && /TypeError|ReferenceError|AssertionError/.test(a)));
    assert.deepEqual(thrown, [], label + ': no swallowed programming exceptions');
    const expected = addr ? harness.methods.slice(1) : harness.methods;
    assert.deepEqual(result.traces, expected, label + ': every v000903 middleware ran');
    const requests = provider.requests.slice(before);
    const counts = {};
    requests.forEach(r => { counts[r.provider] = (counts[r.provider] || 0) + 1; });
    return {body: result.body, current: result.body.current, requests, counts, ms: Date.now() - started, airModels};
}
function assertNoAir(label, r) {
    assert.equal(r.current.arpltn, undefined, label + ': no arpltn');
    assert.equal('summaryAir' in r.current, false, label + ': summaryAir omitted');
    assert.equal(r.body.airInfoList, undefined, label + ': no airInfoList');
}
function assertAir(label, r, source) {
    const a = r.current.arpltn;
    assert.equal(a.source, source, label + ': source');
    assert.equal(typeof a.pm10Value, 'number', label); assert.equal(typeof a.pm25Value, 'number', label);
    assert(a.pm25Grade >= 1, label + ': pm25 grade'); assert(a.aqiGrade >= 1, label + ': integrated grade');
    assert.equal(typeof a.pm25Str, 'string', label + ': grade text');
    assert(typeof r.current.summaryAir === 'string' && r.current.summaryAir.length > 0, label + ': summaryAir');
    assert.equal(r.body.airInfoList.length, 1, label);
    assert.equal(r.body.airInfoList[0].source, source, label + ': airInfo source');
    assert.equal(r.body.airInfoList[0].last.source, source, label);
    assert.equal(r.body.airInfoList[0].last.pm25Grade, a.pm25Grade, label + ': detail and current agree');
    assert(r.body.airInfoList[0].pollutants.pm25.hourly.length >= 1, label + ': hourly entry for the chart');
    assert.equal(r.body.airInfoList[0].forecastSource, undefined, label + ': no station forecast lookup');
}
const capped = (googleCalls, owmCalls) => {
    const s = stores();
    if (googleCalls) { s['air.provider.usage.model'].rows['google:m:2026-09'] = {_id: 'google:m:2026-09', calls: googleCalls, expireAt: '2026-11-01T00:00:00Z'}; }
    if (owmCalls) { s['air.provider.usage.model'].rows['openweather:m:2026-09'] = {_id: 'openweather:m:2026-09', calls: owmCalls, expireAt: '2026-11-01T00:00:00Z'}; }
    return s;
};

async function main() {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const out = [];
    const record = (id, ac, r, extra) => out.push(Object.assign({id, ac, requests: r.counts, ms: r.ms, source: r.current.arpltn && r.current.arpltn.source,
        pm25: r.current.arpltn && r.current.arpltn.pm25Value, summaryAir: r.current.summaryAir, airInfoSources: (r.body.airInfoList || []).map(a => a.source)}, extra));

    // S1 (AC6): free phase → Google answers; concentrations, grades, summary and detail list per DB version and unit.
    for (const version of ['1.0', '2.0']) {
        for (const airUnit of ['airkorea', 'airnow']) {
            const label = 'S1/' + version + '/' + airUnit;
            const r = await run(label, {version, airUnit});
            assert.deepEqual(r.counts, {google: 1}, label + ': Google only');
            assertAir(label, r, 'google');
            assert.equal(r.current.arpltn.pm25Value, 29, label + ': µg/m³ as delivered');
            assert.equal(r.current.arpltn.o3Value, 0.054, label + ': ppb → ppm');
            record(label, 'AC6', r);
        }
        const withKeys = await run('S2/' + version, {version, arpltnInfo: {arpltn: freshAir, list: [freshAir], stnList: [[freshAir]]}});
        const noKeys = await run('S2-baseline/' + version, {version, keyString: {}, arpltnInfo: {arpltn: freshAir, list: [freshAir], stnList: [[freshAir]]}});
        assert.deepEqual(withKeys.counts, {}, 'S2: no provider request');
        assert.deepEqual(withKeys.current.arpltn, noKeys.current.arpltn, 'S2: arpltn unchanged');
        assert.deepEqual(withKeys.body.airInfoList, noKeys.body.airInfoList, 'S2: airInfoList unchanged');
        assert.equal(withKeys.body.airInfoList[0].source, 'airkorea');
        record('S2/' + version, 'AC6', withKeys);
    }

    // S-order (AC2): Google capped → OpenWeather; both capped → WAQI.
    const owm = await run('S-order/openweather', {airModels: capped(9500)});
    assert.deepEqual(owm.counts, {openweather: 1}); assertAir('S-order/openweather', owm, 'openweather');
    assert.equal(owm.current.arpltn.coValue, 0.185, 'µg/m³ → ppm');
    record('S-order/openweather', 'AC2', owm);
    const waqi = await run('S-order/aqicn', {airModels: capped(9500, 950000)});
    assert.deepEqual(waqi.counts, {aqicn: 1}); assertAir('S-order/aqicn', waqi, 'aqicn');
    assert.equal(waqi.current.arpltn.stationName, 'Seoul (서울)');
    record('S-order/aqicn', 'AC2', waqi);

    // S-paid (AC3): free budgets gone and WAQI failing → nothing without the flag; with it OpenWeather → Visual Crossing.
    const off = await run('S-paid/off', {airModels: capped(9500, 950000), modes: {aqicn: 'http500'}});
    assert.deepEqual(off.counts, {aqicn: 1}, 'paid off: WAQI only'); assertNoAir('S-paid/off', off);
    record('S-paid/off', 'AC3', off);
    const on = await run('S-paid/on', {airModels: capped(9500, 950000), airConfig: {paidProvidersEnabled: true}, modes: {aqicn: 'http500', openweather: 'http500'}});
    assert.deepEqual(on.requests.map(r => r.provider), ['aqicn', 'openweather', 'visualcrossing'], 'paid on: cheapest first, stop at first success');
    assertAir('S-paid/on', on, 'visualcrossing');
    assert.equal(on.airModels['vc.usage.model'].rows['2026-09-24'].records, 1, 'Visual Crossing air call counted in the weather day budget');
    assert.equal(on.airModels['air.provider.usage.model'].rows['openweather:paid:m:2026-09'].calls, 1);
    record('S-paid/on', 'AC3', on);

    // S5 (AC5): an auth rejection marks Google down for every later request that shares the store.
    const shared = stores();
    const first = await run('S5/first', {airModels: shared, modes: {google: 'auth'}});
    assert.deepEqual(first.requests.map(r => r.provider), ['google', 'openweather']); assertAir('S5/first', first, 'openweather');
    assert.ok(shared['air.provider.usage.model'].rows['google:down'], 'down marker');
    shared['air.observation.cache.model'] = memoryModel();   // another cell/worker without the cached answer
    const second = await run('S5/second', {airModels: shared, place: locations[1], modes: {}});
    assert.deepEqual(second.counts, {openweather: 1}, 'Google skipped while down'); assertAir('S5/second', second, 'openweather');
    record('S5/second', 'AC5', second);

    // S-timeout (AC3/AC7): a hanging provider is bounded by the timeout and the chain continues.
    const slow = await run('S-timeout', {modes: {google: 'timeout'}});
    assert.deepEqual(slow.requests.map(r => r.provider), ['google', 'openweather']); assertAir('S-timeout', slow, 'openweather');
    assert(slow.ms < 8000, 'bounded: ' + slow.ms + ' ms');
    record('S-timeout', 'AC3', slow);

    // S7 (AC7): every provider failing leaves the response without air; a second request within 2 minutes calls nobody.
    const failing = stores();
    const allFail = await run('S7/all-fail', {airModels: failing, modes: {google: 'http500', openweather: 'http500', aqicn: 'status'}});
    assert.deepEqual(allFail.requests.map(r => r.provider), ['google', 'openweather', 'aqicn']); assertNoAir('S7/all-fail', allFail);
    const again = await run('S7/again', {airModels: failing, modes: {}});
    assert.deepEqual(again.counts, {}, 'failure cached'); assertNoAir('S7/again', again);
    record('S7/again', 'AC7', again, {firstRequests: allFail.counts});
    const kecoFail = await run('S7/keco-error', {arpltnError: 'mongo down'});
    assertAir('S7/keco-error', kecoFail, 'google');
    const stale = await run('S7/stale-then-next', {modes: {google: 'stale'}});
    assert.deepEqual(stale.requests.map(r => r.provider), ['google', 'openweather'], 'stale observation → next provider'); assertAir('S7/stale', stale, 'openweather');
    record('S7/stale-then-next', 'AC3', stale);

    // S-addr (AC6): the address route gives the same air result.
    const byCoord = await run('S-addr/coord', {});
    const byAddr = await run('S-addr/addr', {addr: true});
    assert.deepEqual(byAddr.current.arpltn, byCoord.current.arpltn, 'addr = coord arpltn');
    assert.deepEqual(byAddr.body.airInfoList, byCoord.body.airInfoList, 'addr = coord airInfoList');
    record('S-addr/addr', 'AC6', byAddr);

    // S6 (#2622): a long WAQI name reaches the response as its smallest unit; far station rejected.
    const jeju = await run('S6/jeju', {place: locations[2], keyString: WAQI_ONLY, modes: {aqicn: 'jeju'}});
    assert.equal(jeju.current.arpltn.stationName, 'Ido-dong'); assert.equal(jeju.body.airInfoList[0].last.stationName, 'Ido-dong');
    record('S6/jeju', 'AC6', jeju);
    const far = await run('S6/far', {keyString: WAQI_ONLY, modes: {aqicn: 'far'}});
    assertNoAir('S6/far', far);

    const report = {createdAt: new Date().toISOString(), hostTimezone: process.env.TZ || 'system', node: process.version,
        provider: 'loopback fake Google/OpenWeather/Visual Crossing/WAQI over real axios ' + require('axios/package.json').version,
        outcome: 'passed', scenarioCount: out.length, providerRequests: provider.requests, scenarios: out};
    fs.writeFileSync(path.join(outputDir, 'air-chain-evidence.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({outcome: report.outcome, scenarioCount: out.length, providerRequests: provider.requests.length,
        evidence: path.join(outputDir, 'air-chain-evidence.json')}, null, 2));
}
main().catch(err => { console.error(err.stack); process.exitCode = 1; })
    .finally(() => { sockets.forEach(s => s.destroy()); server.close(); });
