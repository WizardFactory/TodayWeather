/* Run with Node >=16.20.2: node server/test/offline/air-chain.test.js
 * Air quality provider chain (#2628): policy config, the four adapters, shared budgets and
 * the ordering rules. Real modules run in an isolated VM; axios and Mongo models are fakes.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createLoader, memoryModel, fakeAxios, fixture, logger} = require('./air-harness');

// Values built inside the VM have another realm's prototypes; compare by canonical JSON.
const canon = v => JSON.stringify(v, (k, val) => val && typeof val === 'object' && !Array.isArray(val) ?
    Object.keys(val).sort().reduce((o, key) => { o[key] = val[key]; return o; }, {}) : val);
const eq = (actual, expected, message) => assert.equal(canon(actual), canon(expected), message);
const KEYS = {google: 'google-key-1234567890', openweather: 'owm-key-1234567890', visualcrossing: 'vc-key-1234567890', aqicn: 'waqi-token-1234567890'};
const keyString = {google_key: KEYS.google, owm_keys: [{key: KEYS.openweather}], vc_key: KEYS.visualcrossing, aqi_keys: [{key: KEYS.aqicn}]};
const seoul = {lat: 37.5665, lon: 126.978};
const at = iso => new Date(iso);
const REQUEST_TIME = at('2026-09-27T15:20:00Z');

function fixedDate(iso) {
    const RealDate = Date;
    const ms = () => new RealDate(iso).getTime();
    return class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [ms()])); }
        static now() { return ms(); }
    };
}
function loader(extra = {}, lines = []) {
    return createLoader({log: logger(lines), overrides: Object.assign({'config/config.js': {keyString}}, extra.overrides || {}), globals: extra.globals});
}
function noKeyLeak(lines, extraText = '') {
    const all = lines.map(l => l.text).join('\n') + extraText;
    for (const k of Object.values(KEYS)) { assert.equal(all.includes(k), false, 'key leaked: ' + k.slice(0, 6)); }
}

// ---- config ---------------------------------------------------------------------------------
test('air policy config: defaults, parsing and validation', () => {
    const air = loader().load('config/air.js');
    assert.equal(air.googleMonthlyCap, 10000);
    assert.equal(air.owmMonthlyCap, 1000000);
    assert.equal(air.owmMinuteCap, 60);
    assert.equal(air.paidProvidersEnabled, false);
    assert.equal(air.paidMonthlyCallCap, 100000);
    assert.equal(air.providerTimeoutMs, 3000);
    eq(air.FREE_ORDER, ['google', 'openweather', 'aqicn']);
    eq(air.PAID_ORDER, ['openweather', 'visualcrossing', 'google']);
    assert.equal(air.RESERVE, 0.05);
    assert.equal(air.DOWN_MS, 10 * 60 * 1000);
    const custom = air.load({AIR_GOOGLE_MONTHLY_CAP: '500', AIR_PAID_PROVIDERS_ENABLED: 'true', AIR_PAID_MONTHLY_CALL_CAP: '10', AIR_PROVIDER_TIMEOUT_MS: '1500'});
    assert.equal(custom.googleMonthlyCap, 500); assert.equal(custom.paidProvidersEnabled, true);
    assert.equal(custom.paidMonthlyCallCap, 10); assert.equal(custom.providerTimeoutMs, 1500);
    assert.throws(() => air.load({AIR_OWM_MINUTE_CAP: '-1'}), /AIR_OWM_MINUTE_CAP/);
    assert.throws(() => air.load({AIR_PAID_PROVIDERS_ENABLED: 'yes'}), /AIR_PAID_PROVIDERS_ENABLED/);
    assert.throws(() => air.load({AIR_PROVIDER_TIMEOUT_MS: '100'}), /AIR_PROVIDER_TIMEOUT_MS/);
});

// ---- adapters -------------------------------------------------------------------------------
function adapters(respond, lines) {
    const http = fakeAxios(respond);
    const l = loader({overrides: {axios: http.axios}}, lines);
    return {http, providers: l.load('lib/air/providers/index.js'), converter: l.load('lib/aqi.converter.js'), observation: l.load('lib/air/observation.js')};
}
function fetch(provider, deps) {
    return new Promise(resolve => provider.fetchCurrent(seoul, deps, resolve));
}

test('Google adapter: request shape and units (µg/m³ as-is, ppb → ppm)', async () => {
    const lines = [];
    const {http, providers, converter} = adapters(() => ({status: 200, data: fixture('air/google-seoul')}), lines);
    const r = await fetch(providers.google, {axios: http.axios, keyString, timeoutMs: 3000});
    assert.equal(r.outcome, 'ok', JSON.stringify(r));
    const c = http.calls[0];
    assert.equal(c.method, 'post');
    assert.equal(c.url, 'https://airquality.googleapis.com/v1/currentConditions:lookup?key=' + KEYS.google);
    eq(c.data.location, {latitude: 37.5665, longitude: 126.978});
    assert.ok(c.data.extraComputations.includes('LOCAL_AQI') && c.data.extraComputations.includes('POLLUTANT_CONCENTRATION'));
    assert.equal(c.data.universalAqi, true);
    assert.equal(c.timeout, 3000);
    const o = r.observation;
    assert.equal(o.provider, 'google');
    assert.equal(o.stationBased, false);
    assert.equal(new Date(o.observedAt).toISOString(), '2026-09-27T14:00:00.000Z');
    eq(o.pollutants, {pm25: 29, pm10: 41, co: converter.ppb2ppm(334.24), no2: converter.ppb2ppm(10.4), o3: converter.ppb2ppm(54.2), so2: converter.ppb2ppm(4.3)});
    assert.equal(o.indexes.uaqi, 63);
    eq(o.indexes.local, {code: 'kor_cai', aqi: 58});
    assert.match(o.attribution, /Google/);
    noKeyLeak(lines, JSON.stringify(o));
});

test('OpenWeather adapter: µg/m³ components → concentrations', async () => {
    const {http, providers, converter} = adapters(() => ({status: 200, data: fixture('air/openweather-seoul')}));
    const r = await fetch(providers.openweather, {axios: http.axios, keyString, timeoutMs: 3000});
    assert.equal(r.outcome, 'ok', JSON.stringify(r));
    assert.equal(http.calls[0].method, 'get');
    assert.equal(http.calls[0].url, 'https://api.openweathermap.org/data/2.5/air_pollution?lat=37.5665&lon=126.978&appid=' + KEYS.openweather);
    const o = r.observation;
    assert.equal(o.provider, 'openweather');
    assert.equal(new Date(o.observedAt).getTime(), 1790521200 * 1000);
    eq(o.pollutants, {pm25: 19, pm10: 22, co: converter.um2ppm('co', 231.3), no2: converter.um2ppm('no2', 15.3), o3: converter.um2ppm('o3', 64.3), so2: converter.um2ppm('so2', 8.3)});
    assert.equal(o.pollutants.co, 0.185);
    assert.equal(o.indexes.owm, 2);
});

test('Visual Crossing adapter: Timeline current air elements, metric units, query cost', async () => {
    const {http, providers, converter} = adapters(() => ({status: 200, data: fixture('air/visualcrossing-seoul')}));
    const r = await fetch(providers.visualcrossing, {axios: http.axios, keyString, timeoutMs: 3000});
    assert.equal(r.outcome, 'ok', JSON.stringify(r));
    const url = http.calls[0].url;
    assert.match(url, /^https:\/\/weather\.visualcrossing\.com\/VisualCrossingWebServices\/rest\/services\/timeline\/37\.5665,126\.978\/today\?/);
    assert.match(url, /unitGroup=metric/); assert.match(url, /include=current/);
    assert.match(url, /elements=datetime,datetimeEpoch,pm2p5,pm10,o3,no2,so2,co,aqius,aqieur/);
    assert.match(url, new RegExp('key=' + KEYS.visualcrossing + '$'));
    const o = r.observation;
    assert.equal(o.provider, 'visualcrossing');
    assert.equal(new Date(o.observedAt).getTime(), 1790524800 * 1000);
    eq(o.pollutants, {pm25: 19, pm10: 22, co: converter.um2ppm('co', 231.3), no2: converter.um2ppm('no2', 15.3), o3: converter.um2ppm('o3', 64.3), so2: converter.um2ppm('so2', 8.3)});
    assert.equal(o.indexes.us, 95); assert.equal(o.indexes.eu, 4);
    assert.equal(r.cost, 1);
});

test('WAQI adapter: station, sub-indices → concentrations, shortened name', async () => {
    const {http, providers, converter} = adapters(() => ({status: 200, data: fixture('waqi-jeju')}));
    const r = await fetch(providers.aqicn, {axios: http.axios, keyString, timeoutMs: 3000});
    assert.equal(r.outcome, 'ok', JSON.stringify(r));
    assert.equal(http.calls[0].url, 'https://api.waqi.info/feed/geo:37.5665;126.978/?token=' + KEYS.aqicn);
    const o = r.observation;
    assert.equal(o.provider, 'aqicn'); assert.equal(o.stationBased, true);
    assert.equal(o.stationName, 'Ido-dong');
    eq(o.stationGeo, [33.500116, 126.532371]);
    assert.equal(new Date(o.observedAt).toISOString(), '2026-09-27T14:00:00.000Z');
    assert.equal(o.pollutants.pm25, converter.extractValue('pm25', 25));
    assert.equal(o.pollutants.o3, converter.ppb2ppm(converter.extractValue('o3', 29.6)));
    assert.equal(o.indexes.us, 30);
    assert.match(o.attribution, /World Air Quality Index/);
});

test('every adapter classifies failures and never exposes the key', async () => {
    const cases = [
        ['timeout', () => { const e = new Error('timeout of 3000ms exceeded'); e.code = 'ECONNABORTED'; throw e; }],
        ['transport', () => { const e = new Error('socket hang up'); e.code = 'ECONNRESET'; throw e; }],
        ['auth', () => ({status: 401, data: {error: 'key ' + KEYS.google}})],
        ['auth', () => ({status: 403, data: {}})],
        ['quota', () => ({status: 429, data: {}})],
        ['http', () => ({status: 503, data: 'oops'})],
        ['invalid-body', () => ({status: 200, data: 'not json'})],
        ['invalid-body', () => ({status: 200, data: {}})],
        ['invalid-body', () => ({status: 200, data: {list: [{dt: 'x', components: 'none'}], pollutants: 'x', currentConditions: 'x', status: 'ok', data: {time: {s: 5}}}})]
    ];
    const lines = [];
    const reasons = [];
    for (const [kind, respond] of cases) {
        const {http, providers} = adapters(respond, lines);
        for (const id of ['google', 'openweather', 'visualcrossing', 'aqicn']) {
            const r = await fetch(providers[id], {axios: http.axios, keyString, timeoutMs: 3000});
            assert.equal(r.outcome, 'failed', id + ' ' + kind);
            assert.equal(r.kind, kind, id + ' ' + kind + ' ' + JSON.stringify(r));
            if (kind === 'http') { assert.equal(r.reason, 'http-503'); }
            reasons.push(JSON.stringify(r));
        }
    }
    const {http, providers} = adapters(() => ({status: 200, data: {status: 'error', data: 'Invalid key'}}), lines);
    const r = await fetch(providers.aqicn, {axios: http.axios, keyString, timeoutMs: 3000});
    assert.equal(r.kind, 'status'); assert.equal(r.reason, 'status-error');
    noKeyLeak(lines, reasons.join('\n'));
});

test('adapters without a configured key are not configured', () => {
    const {providers} = adapters(() => ({}));
    for (const id of ['google', 'openweather', 'visualcrossing', 'aqicn']) {
        assert.equal(providers[id].isConfigured(keyString), true, id);
        assert.equal(providers[id].isConfigured({}), false, id);
    }
    assert.equal(providers.google.isConfigured({google_key: 'You have to set googe api key'}), false);
    assert.equal(providers.aqicn.isConfigured({aqi_keys: [{key: 'You have to set key of WAQI'}]}), false);
    assert.equal(providers.openweather.isConfigured({owm_keys: [{key: 'You have to set key of Open weather map'}]}), false);
    assert.equal(providers.visualcrossing.isConfigured({vc_key: ''}), false);
});

// ---- observation ------------------------------------------------------------------------------
test('evaluate: freshness for all providers, distance for station-based only, PM required', () => {
    const {observation} = adapters(() => ({}));
    const base = {provider: 'google', stationBased: false, observedAt: at('2026-09-27T14:00:00Z'), pollutants: {pm25: 10, pm10: 20, o3: 0.03}, indexes: {}, attribution: 'x'};
    let r = observation.evaluate(base, seoul, at('2026-09-27T21:59:00Z'));
    assert.equal(r.arpltn.source, 'google'); assert.equal(r.arpltn.dataTime, '2026-09-27 23:00');
    assert.equal(r.arpltn.pm25Value, 10); assert.equal(r.arpltn.o3Value, 0.03); assert.equal(r.arpltn.stationName, undefined);
    assert.equal(observation.evaluate(base, seoul, at('2026-09-27T22:01:00Z')).reason, 'stale');
    assert.equal(observation.evaluate(base, seoul, at('2026-09-27T12:30:00Z')).reason, 'future');
    assert.equal(observation.evaluate(Object.assign({}, base, {pollutants: {o3: 0.03}}), seoul, REQUEST_TIME).reason, 'no-pm');
    assert.equal(observation.evaluate(Object.assign({}, base, {observedAt: 'garbage'}), seoul, REQUEST_TIME).reason, 'no-time');
    const station = Object.assign({}, base, {provider: 'aqicn', stationBased: true, stationName: 'Far', stationGeo: [37.95, 126.978]});
    assert.equal(observation.evaluate(station, seoul, REQUEST_TIME).reason, 'too-far');
    assert.equal(observation.evaluate(Object.assign({}, station, {stationGeo: [37.75, 126.978]}), seoul, REQUEST_TIME).arpltn.stationName, 'Far');
    assert.equal(observation.evaluate(Object.assign({}, base, {stationGeo: [0, 0]}), seoul, REQUEST_TIME).arpltn.source, 'google', 'model data ignores distance');
});

// ---- budgets ------------------------------------------------------------------------------------
function budgetSetup(configOverrides = {}, nowIso = '2026-09-27T15:20:00Z') {
    const usage = memoryModel(), vcUsage = memoryModel(), vcLock = memoryModel();
    const lines = [];
    const l = loader({overrides: {'models/air.provider.usage.model.js': usage, 'models/worldWeather/vc.usage.model.js': vcUsage, 'models/worldWeather/vc.fetch.lock.model.js': vcLock}, globals: {Date: fixedDate(nowIso)}}, lines);
    const airConfig = Object.assign({}, l.load('config/air.js'), configOverrides);
    const budget = l.load('lib/air/providerBudget.js').createBudget({config: airConfig, vcDailyRecordLimit: configOverrides.vcDailyRecordLimit});
    return {budget, usage, vcUsage, vcLock, lines, airConfig};
}
const check = (b, id, phase, cost = 1) => new Promise(r => b.check(id, phase, cost, r));
const record = (b, id, phase, opts) => new Promise(r => b.record(id, phase, opts, r));

test('budget: monthly free cap with reserve, shared counters, failures counted', async () => {
    const {budget, usage} = budgetSetup({googleMonthlyCap: 1000});
    eq(await check(budget, 'google', 'free'), {allowed: true});
    for (let i = 0; i < 949; i++) { await record(budget, 'google', 'free', {}); }
    assert.equal(usage.rows['google:m:2026-09'].calls, 949);
    eq(await check(budget, 'google', 'free'), {allowed: true});
    await record(budget, 'google', 'free', {failed: true});
    assert.equal(usage.rows['google:m:2026-09'].failures, 1);
    eq(await check(budget, 'google', 'free'), {allowed: false, reason: 'free-cap'});
    assert.ok(new Date(usage.rows['google:m:2026-09'].expireAt) > new Date('2026-10-30T00:00:00Z'), 'month document expires after the month');
});

test('budget: OpenWeather minute cap', async () => {
    const {budget, usage} = budgetSetup({owmMinuteCap: 60});
    for (let i = 0; i < 60; i++) { await record(budget, 'openweather', 'free', {}); }
    assert.equal(usage.rows['openweather:min:2026-09-27T15:20'].calls, 60);
    eq(await check(budget, 'openweather', 'free'), {allowed: false, reason: 'minute-cap'});
    const later = budgetSetup({owmMinuteCap: 60}, '2026-09-27T15:21:00Z');
    later.usage.rows = Object.assign(later.usage.rows, usage.rows);
    eq(await check(later.budget, 'openweather', 'free'), {allowed: true});
});

test('budget: down marker for ten minutes', async () => {
    const {budget, usage} = budgetSetup();
    await new Promise(r => budget.markDown('google', 'auth', r));
    eq(await check(budget, 'google', 'free'), {allowed: false, reason: 'down'});
    eq(await check(budget, 'google', 'paid'), {allowed: false, reason: 'down'});
    const later = budgetSetup({}, '2026-09-27T15:31:00Z');
    later.usage.rows = Object.assign(later.usage.rows, usage.rows);
    assert.equal((await check(later.budget, 'google', 'free')).allowed, true, 'expired marker');
});

test('budget: paid phase disabled by default, per-provider paid cap', async () => {
    const off = budgetSetup();
    eq(await check(off.budget, 'google', 'paid'), {allowed: false, reason: 'paid-disabled'});
    const on = budgetSetup({paidProvidersEnabled: true, paidMonthlyCallCap: 3});
    eq(await check(on.budget, 'openweather', 'paid'), {allowed: true});
    for (let i = 0; i < 3; i++) { await record(on.budget, 'openweather', 'paid', {}); }
    assert.equal(on.usage.rows['openweather:paid:m:2026-09'].calls, 3);
    eq(await check(on.budget, 'openweather', 'paid'), {allowed: false, reason: 'paid-cap'});
    eq(await check(on.budget, 'google', 'paid'), {allowed: true});
});

test('budget: Visual Crossing uses the overseas weather day budget and provider marker', async () => {
    const s = budgetSetup({paidProvidersEnabled: true, vcDailyRecordLimit: 100});
    eq(await check(s.budget, 'visualcrossing', 'free'), {allowed: false, reason: 'free-phase-excluded'});
    s.vcUsage.rows['2026-09-27'] = {_id: '2026-09-27', calls: 5, records: 99};
    eq(await check(s.budget, 'visualcrossing', 'paid'), {allowed: true});
    s.vcUsage.rows['2026-09-27'].records = 100;
    eq(await check(s.budget, 'visualcrossing', 'paid'), {allowed: false, reason: 'vc-record-limit'});
    s.vcUsage.rows['2026-09-27'].records = 10;
    s.vcLock.rows['~provider'] = {_id: '~provider', expireAt: '2026-09-27T15:25:00Z', failed: true};
    eq(await check(s.budget, 'visualcrossing', 'paid'), {allowed: false, reason: 'down'});
    delete s.vcLock.rows['~provider'];
    await record(s.budget, 'visualcrossing', 'paid', {cost: 1});
    assert.equal(s.vcUsage.rows['2026-09-27'].records, 11); assert.equal(s.vcUsage.rows['2026-09-27'].calls, 6);
    assert.equal(s.usage.rows['visualcrossing:paid:m:2026-09'].calls, 1);
});

test('budget: store errors do not block a request', async () => {
    const s = budgetSetup();
    s.usage.failRead = true; s.usage.failWrite = true;
    eq(await check(s.budget, 'google', 'free'), {allowed: true});
    await record(s.budget, 'google', 'free', {});
    assert.ok(s.lines.some(l => l.level === 'warn'));
});

// ---- chain --------------------------------------------------------------------------------------
function fakeProvider(id, script, options = {}) {
    const p = {id, label: id, stationBased: !!options.stationBased, calls: [],
        isConfigured: () => options.configured !== false,
        fetchCurrent(gCoord, deps, cb) {
            p.calls.push(deps.phase);
            const next = typeof script === 'function' ? script(p.calls.length) : script;
            setImmediate(() => cb(next));
        }};
    return p;
}
const okObs = (provider, extra = {}) => ({outcome: 'ok', cost: 1, observation: Object.assign({provider, stationBased: false, observedAt: at('2026-09-27T15:00:00Z'), pollutants: {pm25: 12, pm10: 30}, indexes: {}, attribution: provider}, extra)});
const failed = (kind, reason) => ({outcome: 'failed', kind, reason: reason || kind});

function chainSetup({scripts = {}, config = {}, usageRows = {}, nowIso = '2026-09-27T15:20:00Z', configured = {}} = {}) {
    const usage = memoryModel(); Object.assign(usage.rows, usageRows);
    const lines = [];
    const l = loader({overrides: {'models/air.provider.usage.model.js': usage, 'models/worldWeather/vc.usage.model.js': memoryModel(), 'models/worldWeather/vc.fetch.lock.model.js': memoryModel()}, globals: {Date: fixedDate(nowIso)}}, lines);
    const airConfig = Object.assign({}, l.load('config/air.js'), config);
    const budget = l.load('lib/air/providerBudget.js').createBudget({config: airConfig});
    const providers = {};
    for (const id of ['google', 'openweather', 'visualcrossing', 'aqicn']) {
        providers[id] = fakeProvider(id, scripts[id] || okObs(id), {configured: configured[id], stationBased: id === 'aqicn'});
    }
    const chain = l.load('lib/air/providerChain.js').createChain({providers, budget, config: airConfig, keyString, axios: {}});
    return {chain, providers, usage, lines, budget};
}
const run = (chain) => new Promise(r => chain.fetch(seoul, REQUEST_TIME, r));
const called = providers => Object.keys(providers).filter(id => providers[id].calls.length);

test('chain: free phase calls Google only; capped Google → OpenWeather; both capped → WAQI', async () => {
    const a = chainSetup();
    const ra = await run(a.chain);
    assert.equal(ra.outcome, 'ok'); assert.equal(ra.provider, 'google'); assert.equal(ra.arpltn.source, 'google');
    eq(called(a.providers), ['google']);
    eq(a.providers.google.calls, ['free']);
    assert.equal(a.usage.rows['google:m:2026-09'].calls, 1);
    const b = chainSetup({usageRows: {'google:m:2026-09': {_id: 'google:m:2026-09', calls: 9500, expireAt: '2026-11-01T00:00:00Z'}}});
    const rb = await run(b.chain);
    assert.equal(rb.provider, 'openweather'); eq(called(b.providers), ['openweather']);
    const c = chainSetup({usageRows: {'google:m:2026-09': {_id: 'google:m:2026-09', calls: 9500, expireAt: 'x'}, 'openweather:m:2026-09': {_id: 'openweather:m:2026-09', calls: 950000, expireAt: 'x'}}});
    const rc = await run(c.chain);
    assert.equal(rc.provider, 'aqicn'); eq(called(c.providers), ['aqicn']);
    assert.equal(rc.arpltn.source, 'aqicn');
});

test('chain: a failing or unusable provider moves on; auth/quota marks the provider down', async () => {
    const a = chainSetup({scripts: {google: failed('transport'), openweather: okObs('openweather', {observedAt: at('2026-09-27T05:00:00Z')})}});
    const r = await run(a.chain);
    assert.equal(r.provider, 'aqicn');
    eq(r.attempts.map(x => x.provider + ':' + x.outcome + ':' + x.reason), ['google:failed:transport', 'openweather:unusable:stale', 'aqicn:ok:undefined']);
    const b = chainSetup({scripts: {google: failed('auth', 'http-403')}});
    const r1 = await run(b.chain);
    assert.equal(r1.provider, 'openweather');
    assert.ok(b.usage.rows['google:down'], 'down marker written');
    const r2 = await run(b.chain);
    assert.equal(r2.provider, 'openweather'); assert.equal(b.providers.google.calls.length, 1, 'google skipped while down');
    const c = chainSetup({scripts: {google: failed('quota', 'http-429')}});
    await run(c.chain); assert.ok(c.usage.rows['google:down']);
});

test('chain: with every free budget exhausted, WAQI only unless paid providers are enabled', async () => {
    const exhausted = {'google:m:2026-09': {_id: 'google:m:2026-09', calls: 9500, expireAt: 'x'}, 'openweather:m:2026-09': {_id: 'openweather:m:2026-09', calls: 950000, expireAt: 'x'}};
    const off = chainSetup({usageRows: exhausted, scripts: {aqicn: failed('transport')}});
    const r = await run(off.chain);
    assert.equal(r.outcome, 'failed'); eq(called(off.providers), ['aqicn']);
    assert.equal(r.reason, 'aqicn:transport');
    const on = chainSetup({usageRows: exhausted, config: {paidProvidersEnabled: true}, scripts: {aqicn: failed('transport'), openweather: failed('http', 'http-500')}});
    const r2 = await run(on.chain);
    assert.equal(r2.provider, 'visualcrossing');
    eq(r2.attempts.map(x => x.provider + ':' + x.phase), ['aqicn:free', 'openweather:paid', 'visualcrossing:paid']);
    assert.equal(on.providers.google.calls.length, 0, 'stops at the first success');
    assert.equal(on.usage.rows['openweather:paid:m:2026-09'].calls, 1);
    assert.equal(on.usage.rows['visualcrossing:paid:m:2026-09'].calls, 1);
    const capped = chainSetup({usageRows: Object.assign({'openweather:paid:m:2026-09': {_id: 'x', calls: 100000, expireAt: 'x'}}, exhausted), config: {paidProvidersEnabled: true}, scripts: {aqicn: failed('transport')}});
    const r3 = await run(capped.chain);
    assert.equal(r3.provider, 'visualcrossing'); assert.equal(capped.providers.openweather.calls.length, 0, 'paid cap respected');
});

test('chain: unconfigured providers are skipped; nothing configured → no-provider without calls', async () => {
    const a = chainSetup({configured: {google: false, openweather: false}});
    const r = await run(a.chain);
    assert.equal(r.provider, 'aqicn'); eq(called(a.providers), ['aqicn']);
    const none = chainSetup({configured: {google: false, openweather: false, visualcrossing: false, aqicn: false}});
    const r2 = await run(none.chain);
    assert.equal(r2.outcome, 'failed'); assert.equal(r2.reason, 'no-provider'); eq(called(none.providers), []);
});

test('chain: WAQI is not called twice when it already failed in the free phase', async () => {
    const s = chainSetup({config: {paidProvidersEnabled: true}, scripts: {google: failed('transport'), openweather: failed('transport'), aqicn: failed('transport'), visualcrossing: failed('transport')}});
    const r = await run(s.chain);
    assert.equal(r.outcome, 'failed');
    assert.equal(s.providers.aqicn.calls.length, 1);
    eq(r.attempts.map(x => x.provider + ':' + x.phase), ['google:free', 'openweather:free', 'aqicn:free', 'openweather:paid', 'visualcrossing:paid', 'google:paid']);
});

test('budget: a caller exception is not swallowed by a store answering synchronously, and callbacks run once', async () => {
    const {budget} = budgetSetup();
    const boom = new Error('caller failed');
    let checks = 0, records = 0;
    assert.throws(() => budget.check('google', 'free', 1, () => { checks++; throw boom; }), err => err === boom, 'check propagates');
    assert.throws(() => budget.record('google', 'free', {}, () => { records++; throw boom; }), err => err === boom, 'record propagates');
    await new Promise(r => setImmediate(r));
    assert.equal(checks, 1); assert.equal(records, 1);
});
