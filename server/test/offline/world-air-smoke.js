/* Overseas weather air route smoke (#2628 PR2).
 * Runs the real v000903, v000902, v000901 /dsf/coord routers and the widgets' /ww router in process
 * (the vc-weather-smoke harness: Visual Crossing fixtures, in-memory weather stores) with the real
 * shared air service — provider chain, budgets and observation cache on in-memory models — and real
 * axios redirected to a loopback server that plays Google, OpenWeather, WAQI and Visual Crossing air. The legacy WAQI
 * collector throws if constructed. Checks provider order and free-cap fallback, the shared cache across
 * routes, air after a weather-cache hit, every airUnit, regional observation times (+5:45, -2:30, -11),
 * station names, no air on yesterday, nonfatal no-key / all-fail / timeout paths, and the paid phase: Visual
 * Crossing air after exhausted free tiers and a capped paid OpenWeather, with its D20 reservation and vc.usage records.
 * Run: TZ=UTC NODE_PATH=/tmp/tw-2622/node_modules node server/test/offline/world-air-smoke.js
 * Optional TW_SMOKE_OUTPUT_DIR selects the evidence directory (default: a temp directory).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');
const {URL} = require('url');
const axios = require('axios');
const {createHarness, checkBody, syntheticProvider, zoneOffset, setNow, RealDate} = require('./vc-weather-smoke');
const {memoryModel, fixture} = require('./air-harness');
const outputDir = process.env.TW_SMOKE_OUTPUT_DIR || fs.mkdtempSync(path.join(require('os').tmpdir(), 'world-air-smoke-'));
fs.mkdirSync(outputDir, {recursive: true});

const KEYS = {google_key: 'world-google-key-0001', owm_keys: [{key: 'world-owm-key-000001'}], aqi_keys: [{key: 'world-waqi-token-0001'}]};
const HOSTS = {'airquality.googleapis.com': 'google', 'api.openweathermap.org': 'openweather', 'api.waqi.info': 'aqicn', 'weather.visualcrossing.com': 'visualcrossing'};
const VC_AIR_COST = 7;   // distinct from the weather bodies' queryCost, so the air share of vc.usage is visible
const T = RealDate.parse('2026-09-27T14:20:00Z');
const OBSERVED = RealDate.parse('2026-09-27T14:00:00Z');
const PLACES = {
    kathmandu: {name: 'Kathmandu', zone: 'Asia/Kathmandu', lat: 27.72, lon: 85.32},
    stjohns: {name: "St. John's", zone: 'America/St_Johns', lat: 47.56, lon: -52.71},
    pago: {name: 'Pago Pago', zone: 'Pacific/Pago_Pago', lat: -14.28, lon: -170.7}
};

// ---- loopback providers ----------------------------------------------------------------------
const provider = {modes: {}, requests: []};
const sockets = new Set();
function body(id, place) {
    if (id === 'google') { const g = fixture('air/google-seoul'); g.dateTime = new RealDate(OBSERVED).toISOString(); return g; }
    if (id === 'openweather') { const o = fixture('air/openweather-seoul'); o.list[0].dt = OBSERVED / 1000; return o; }
    if (id === 'visualcrossing') {
        const v = fixture('air/visualcrossing-seoul');
        v.currentConditions.datetimeEpoch = OBSERVED / 1000; v.queryCost = VC_AIR_COST;
        return v;
    }
    const w = fixture('waqi-seoul');
    w.data.time = {iso: new RealDate(OBSERVED).toISOString().slice(0, 19) + 'Z'};
    w.data.city = {geo: [place.lat + 0.02, place.lon + 0.02], name: place.name + ', American Samoa (Tutuila monitoring)'};
    // a station without gas sensors: only PM reaches the response
    ['o3', 'no2', 'so2', 'co'].forEach(code => { delete w.data.iaqi[code]; });
    return w;
}
const server = http.createServer((req, res) => {
    const id = req.url.startsWith('/v1/currentConditions') ? 'google' : req.url.startsWith('/data/2.5/air_pollution') ? 'openweather' :
        req.url.startsWith('/feed/geo:') ? 'aqicn' : req.url.startsWith('/VisualCrossingWebServices/') ? 'visualcrossing' : undefined;
    assert(id, 'known provider path: ' + req.url);
    const mode = provider.modes[id] || 'ok';
    provider.requests.push({provider: id, mode, path: req.url.replace(/(key|appid|token)=[^&]*/g, '$1=<redacted>')});
    req.resume();
    req.on('end', () => {
        const send = (status, payload) => { res.writeHead(status, {'content-type': 'application/json'}); res.end(JSON.stringify(payload)); };
        if (mode === 'http500') return send(500, {status: 'error'});
        if (mode === 'hang') return;   // the client times out; the socket is destroyed at the end
        send(200, body(id, provider.place));
    });
});
server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

function redirectedAxios() {
    const instance = axios.create();
    instance.interceptors.request.use(c => {
        const u = new URL(c.url);
        assert(HOSTS[u.hostname], 'unexpected host ' + u.hostname);
        u.protocol = 'http:'; u.host = '127.0.0.1:' + server.address().port;
        return Object.assign(c, {url: u.toString()});
    });
    return instance;
}

function LegacyAqi() { throw new Error('legacy WAQI collector used on the converted path'); }
/** h.airUsage: shared air budgets (air.provider.usage); h.usage: vc.usage day counters; h.weather: Visual Crossing weather calls and cost. */
function harness(place, {keyString = KEYS, airPolicy, cache = memoryModel(), airUsage = memoryModel()} = {}) {
    const synthetic = syntheticProvider(place.zone);
    const weather = {calls: 0, records: 0};
    const h = createHarness(params => { const b = synthetic(params); weather.calls++; weather.records += b.queryCost || 0; return b; },
        {keyString, airPolicy, models: {'air.observation.cache.model': cache, 'air.provider.usage.model': airUsage},
            packages: {axios: redirectedAxios()}, stubs: {controllerAqi: LegacyAqi}});
    h.cache = cache; h.airUsage = airUsage; h.weather = weather;
    return h;
}
function placeAt(p) { return Object.assign({}, p, {offset: zoneOffset(p.zone, T)}); }

async function request(h, kind, place, airUnit, label) {
    provider.place = place;
    const before = provider.requests.length;
    const body = await h.request(kind, place, Object.assign({temperatureUnit: 'C', windSpeedUnit: 'm/s'}, airUnit ? {airUnit} : {}));
    checkBody(body, place, label, 'C', kind === 'ww', {kind});
    const programming = h.logs.filter(x => x.args.some(a => typeof a === 'string' && /TypeError|ReferenceError|AssertionError|legacy WAQI/.test(a)));
    assert.deepEqual(programming, [], label + ': no swallowed programming exceptions or legacy WAQI use');
    fs.writeFileSync(path.join(outputDir, label.replace(/[^\w.-]+/g, '_') + '.json'), JSON.stringify(body, null, 2));
    return {body, current: body.thisTime[1], yesterday: body.thisTime[0], requests: provider.requests.slice(before).map(r => r.provider)};
}
const cellRow = (h, place) => h.cache.rows[place.lat.toFixed(2) + ',' + place.lon.toFixed(2)];
const CODES = ['pm10', 'pm25', 'o3', 'no2', 'so2', 'co'];

function assertAir(r, label, {source, dataTime, observation, stationName, airUnit}) {
    const a = r.current.arpltn;
    assert(a, label + ': current.arpltn');
    assert.equal(a.source, source, label + ': arpltn.source');
    assert.equal(r.body.airInfo.source, source, label + ': airInfo.source');
    assert.equal(a.dataTime, dataTime, label + ': dataTime in the region offset');
    assert.equal(a.stationName, stationName, label + ': stationName');
    for (const c of CODES) {
        assert.equal(a[c + 'Value'], observation.pollutants[c], label + ': ' + c + ' is the normalized concentration');
        if (observation.pollutants[c] === undefined) assert.equal(a[c + 'Grade'], undefined, label + ': missing ' + c + ' stays missing');
        else assert(Number.isInteger(a[c + 'Grade']) && a[c + 'Grade'] > 0, label + ': ' + c + ' grade');
    }
    assert(Number.isInteger(a.aqiGrade) && a.aqiGrade > 0 && a.khaiGrade === a.aqiGrade, label + ': integrated grade and khai alias');
    assert.equal(typeof a.aqiStr, 'string'); assert.notEqual(a.aqiStr, '', label + ': aqiStr');
    assert.equal(typeof r.current.summaryAir, 'string', label + ': summaryAir');
    assert.equal(r.body.units.airUnit, airUnit, label + ': airUnit');
    assertNoYesterdayAir(r, label);
}
function assertNoYesterdayAir(r, label) {
    const y = r.yesterday.arpltn || {};
    for (const k of ['source', 'dataTime', 'stationName', 'aqiGrade', 'khaiGrade'].concat(CODES.map(c => c + 'Value'), CODES.map(c => c + 'Grade'))) {
        assert.equal(y[k], undefined, label + ': no yesterday air ' + k);
    }
    for (const row of r.body.hourly.concat(r.body.daily)) {
        assert(CODES.every(c => row[c + 'Value'] === undefined) && !row.arpltn, label + ': no air on forecast/history rows ' + row.date);
    }
}
function assertNoAir(r, label) {
    const a = r.current.arpltn || {};
    assert.equal(a.source, undefined, label + ': no air source');
    assert(CODES.every(c => a[c + 'Value'] === undefined), label + ': no air values');
    assert.equal(r.current.summaryAir, undefined, label + ': no summaryAir');
    assert.equal(typeof r.current.summary, 'string', label + ': weather summary still made');
    assertNoYesterdayAir(r, label);
}

async function main() {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    setNow(T);
    const evidence = [];
    const record = (scenario, r, extra) => evidence.push(Object.assign({scenario, providerRequests: r.requests,
        arpltn: r.current.arpltn && {source: r.current.arpltn.source, dataTime: r.current.arpltn.dataTime, stationName: r.current.arpltn.stationName,
            pm25Value: r.current.arpltn.pm25Value, pm25Grade: r.current.arpltn.pm25Grade, aqiValue: r.current.arpltn.aqiValue, aqiGrade: r.current.arpltn.aqiGrade},
        summaryAir: r.current.summaryAir}, extra));

    // W1 (AC1-3): Kathmandu +5:45, all keys: Google first; the other routes and units reuse the shared cache.
    const kt = placeAt(PLACES.kathmandu);
    provider.modes = {};
    const h1 = harness(kt);
    const a = await request(h1, 'v000903', kt, 'airkorea', 'W1 Kathmandu v000903 airkorea');
    assert.deepEqual(a.requests, ['google'], 'W1: Google only');
    const googleObs = cellRow(h1, kt).observation;
    assert.equal(googleObs.provider, 'google');
    assertAir(a, 'W1 airkorea', {source: 'google', dataTime: '2026-09-27 19:45', observation: googleObs, stationName: undefined, airUnit: 'airkorea'});
    assert.equal(h1.airUsage.rows['google:m:2026-09'].calls, 1, 'W1: shared free budget counted');
    record('W1 v000903 airkorea', a);
    for (const [kind, unit] of [['v000902', 'airnow'], ['v000901', 'airkorea_who'], ['v000903', 'aqicn']]) {
        const r = await request(h1, kind, kt, unit, 'W1 Kathmandu ' + kind + ' ' + unit);
        assert.deepEqual(r.requests, [], 'W1 ' + kind + ': served from the shared air cache');
        assertAir(r, 'W1 ' + kind + ' ' + unit, {source: 'google', dataTime: '2026-09-27 19:45', observation: googleObs, stationName: undefined, airUnit: unit});
        record('W1 ' + kind + ' ' + unit + ' (cached)', r);
    }
    const widget = await request(h1, 'ww', kt, undefined, 'W1 Kathmandu ww');
    assert.deepEqual(widget.requests, [], 'W1 ww: served from the shared air cache');
    assert.equal(widget.current.airSource, 'google'); assert.equal(widget.current.mTime, '2026-09-27 19:45');
    assert.equal(widget.current.pm25Value, googleObs.pollutants.pm25);
    assert(Number.isInteger(widget.current.aqiGrade), 'W1 ww: default (aqicn) grading');
    assert.equal(widget.yesterday.pm25Value, undefined, 'W1 ww: no yesterday air');
    evidence.push({scenario: 'W1 ww (cached)', providerRequests: widget.requests, current: {airSource: widget.current.airSource, mTime: widget.current.mTime, aqiGrade: widget.current.aqiGrade}});

    // W2 (AC2): St. John's -2:30; Google over its free budget → OpenWeather, in the shared usage model.
    const sj = placeAt(PLACES.stjohns);
    assert.equal(sj.offset, -150);
    const h2 = harness(sj);
    h2.airUsage.rows['google:m:2026-09'] = {_id: 'google:m:2026-09', calls: 9500, expireAt: '2026-11-01T00:00:00.000Z'};
    const b = await request(h2, 'v000903', sj, 'airnow', "W2 St John's v000903 airnow");
    assert.deepEqual(b.requests, ['openweather'], 'W2: free-capped Google skipped');
    const owmObs = cellRow(h2, sj).observation;
    assertAir(b, 'W2', {source: 'openweather', dataTime: '2026-09-27 11:30', observation: owmObs, stationName: undefined, airUnit: 'airnow'});
    record('W2 free cap → openweather', b);

    // W3 (AC3): Pago Pago -11, WAQI only: station name shortened; missing gases stay missing.
    const pg = placeAt(PLACES.pago);
    assert.equal(pg.offset, -660);
    const h3 = harness(pg, {keyString: {aqi_keys: KEYS.aqi_keys}});
    const c = await request(h3, 'v000902', pg, 'airkorea', 'W3 Pago Pago v000902 airkorea');
    assert.deepEqual(c.requests, ['aqicn']);
    const waqiObs = cellRow(h3, pg).observation;
    assert.deepEqual(Object.keys(waqiObs.pollutants).sort(), ['pm10', 'pm25'], 'W3: PM-only station');
    assertAir(c, 'W3', {source: 'aqicn', dataTime: '2026-09-27 03:00', observation: waqiObs, stationName: 'Pago Pago', airUnit: 'airkorea'});
    record('W3 waqi station', c);

    // W4 (AC1/AC4): all providers fail → weather without air; 3 min later (failure cache expired,
    // weather still cached: no Visual Crossing call) air is fetched again and appears.
    const h4 = harness(kt);
    provider.modes = {google: 'http500', openweather: 'http500', aqicn: 'http500'};
    const d1 = await request(h4, 'v000903', kt, 'airkorea', 'W4 all fail');
    assert.deepEqual(d1.requests, ['google', 'openweather', 'aqicn']);
    assertNoAir(d1, 'W4 all fail');
    record('W4 all providers fail', d1);
    provider.modes = {};
    setNow(T + 3 * 60000);
    const vcBefore = h4.providerCalls.length;
    const d2 = await request(h4, 'v000903', kt, 'airkorea', 'W4 weather cache hit');
    assert.equal(h4.providerCalls.length, vcBefore, 'W4: weather served from its cache');
    assert.deepEqual(d2.requests, ['google'], 'W4: air still retrieved');
    assert.equal(d2.current.arpltn.source, 'google');
    record('W4 weather cache hit, air fetched', d2, {visualCrossingCalls: h4.providerCalls.length - vcBefore});
    setNow(T);

    // W5 (AC4): no air key → no provider request, no air, weather intact.
    const h5 = harness(kt, {keyString: {}});
    const e = await request(h5, 'v000903', kt, 'airkorea', 'W5 no key');
    assert.deepEqual(e.requests, []);
    assertNoAir(e, 'W5 no key');
    record('W5 no key', e);

    // W6 (AC4): providers hang → each times out (policy timeout 500 ms), weather still answers.
    const h6 = harness(kt, {airPolicy: {providerTimeoutMs: 500}});
    provider.modes = {google: 'hang', openweather: 'hang', aqicn: 'hang'};
    const started = RealDate.now();
    const f = await request(h6, 'v000901', kt, 'airkorea', 'W6 timeout');
    const ms = RealDate.now() - started;
    assert.deepEqual(f.requests, ['google', 'openweather', 'aqicn']);
    assert(ms >= 1500 && ms < 5000, 'W6: three 500 ms timeouts, took ' + ms);
    assertNoAir(f, 'W6 timeout');
    assert.equal(cellRow(h6, kt).outcome, 'failed', 'W6: failure cached for the other workers');
    record('W6 timeouts', f, {ms});
    provider.modes = {};

    // W7 (AC1-3, paid): free tiers exhausted, WAQI failing, paid OpenWeather at its cap → paid Visual Crossing air,
    // reserved before the call (D20), counted once in the paid month and in the overseas vc.usage day; cached for the next route.
    const h7 = harness(kt, {airPolicy: {paidProvidersEnabled: true}});
    const cap = h7.load(path.join(__dirname, '../../config/air.js')).paidMonthlyCallCap;
    const exhausted = {'google:m:2026-09': 9500, 'openweather:m:2026-09': 950000, 'openweather:paid:m:2026-09': cap};
    Object.keys(exhausted).forEach(id => { h7.airUsage.rows[id] = {_id: id, calls: exhausted[id], expireAt: '2026-11-01T00:00:00.000Z'}; });
    provider.modes = {aqicn: 'http500'};
    const g = await request(h7, 'v000903', kt, 'airkorea', 'W7 paid Visual Crossing v000903 airkorea');
    assert.deepEqual(g.requests, ['aqicn', 'visualcrossing'], 'W7: free Google/OpenWeather over budget, WAQI failed, paid OpenWeather capped');
    const vcObs = cellRow(h7, kt).observation;
    assert.equal(vcObs.provider, 'visualcrossing');
    assertAir(g, 'W7', {source: 'visualcrossing', dataTime: '2026-09-27 19:45', observation: vcObs, stationName: undefined, airUnit: 'airkorea'});
    const paidRow = h7.airUsage.rows['visualcrossing:paid:m:2026-09'];
    assert.equal(paidRow.calls, 1, 'W7: one paid reservation, no double count');
    assert.equal(paidRow.failures || 0, 0);
    assert.equal(h7.airUsage.rows['openweather:paid:m:2026-09'].calls, cap, 'W7: capped paid OpenWeather not reserved');
    await new Promise(r => setTimeout(r, 20));   // the weather fetch records its usage after answering (fire-and-forget)
    const day = [...h7.usage.values()].find(d => d._id === '2026-09-27');
    assert.equal(day.calls, h7.weather.calls + 1, 'W7: vc.usage calls = weather calls + one air call');
    assert.equal(day.records, h7.weather.records + VC_AIR_COST, 'W7: vc.usage records = weather cost + air queryCost');
    record('W7 paid visualcrossing', g, {paidReservation: paidRow.calls, vcUsage: {calls: day.calls, records: day.records}, weather: Object.assign({}, h7.weather)});
    provider.modes = {};
    const usageBefore = JSON.stringify(day);
    const g2 = await request(h7, 'v000902', kt, 'airnow', 'W7 paid Visual Crossing v000902 airnow (cached)');
    assert.deepEqual(g2.requests, [], 'W7: cached paid observation reused');
    assertAir(g2, 'W7 cached', {source: 'visualcrossing', dataTime: '2026-09-27 19:45', observation: vcObs, stationName: undefined, airUnit: 'airnow'});
    assert.equal(h7.airUsage.rows['visualcrossing:paid:m:2026-09'].calls, 1, 'W7: no new reservation for a cache hit');
    assert.equal(JSON.stringify([...h7.usage.values()].find(d => d._id === '2026-09-27')), usageBefore, 'W7: vc.usage unchanged by the cached request');
    record('W7 paid visualcrossing cached', g2);

    const allText = JSON.stringify(evidence) + [h1, h2, h3, h4, h5, h6, h7].map(h => JSON.stringify(h.logs)).join('');
    for (const k of [KEYS.google_key, KEYS.owm_keys[0].key, KEYS.aqi_keys[0].key]) assert(!allText.includes(k), 'key not logged');
    const report = {createdAt: new RealDate().toISOString(), node: process.version, hostTimezone: process.env.TZ || 'system', clock: new RealDate(T).toISOString(),
        outcome: 'passed', providerRequests: provider.requests, scenarios: evidence};
    fs.writeFileSync(path.join(outputDir, 'world-air-evidence.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({outcome: 'passed', scenarios: evidence.length, providerRequests: provider.requests.length, evidence: outputDir}, null, 2));
}

let completed = false;
process.on('exit', () => { if (!completed && !process.exitCode) { console.error('world-air-smoke did not complete'); process.exitCode = 1; } });
main().then(() => { completed = true; }, err => { console.error(err.stack); process.exitCode = 1; })
    .then(() => { sockets.forEach(s => s.destroy()); server.close(); });
