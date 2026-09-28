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

test('air policy config loads with defaults in a sandbox without a process global', () => {
    const vm = require('node:vm');
    const fs = require('node:fs');
    const path = require('node:path');
    const module = {exports: {}};
    const sandbox = {module, exports: module.exports, require: () => { throw new Error('no requires expected'); }};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../config/air.js'), 'utf8'), sandbox, {filename: 'config/air.js'});
    assert.equal(module.exports.googleMonthlyCap, 10000);
    assert.equal(module.exports.paidProvidersEnabled, false);
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
function budgetSetup(configOverrides = {}, nowIso = '2026-09-27T15:20:00Z', DateClass = fixedDate(nowIso)) {
    const usage = memoryModel(), vcUsage = memoryModel(), vcLock = memoryModel();
    const lines = [];
    const l = loader({overrides: {'models/air.provider.usage.model.js': usage, 'models/worldWeather/vc.usage.model.js': vcUsage, 'models/worldWeather/vc.fetch.lock.model.js': vcLock}, globals: {Date: DateClass}}, lines);
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
    const nextMinute = budgetSetup({owmMinuteCap: 60}, '2026-09-27T15:21:00Z');
    nextMinute.usage.rows = Object.assign(nextMinute.usage.rows, usage.rows);
    eq(await check(nextMinute.budget, 'openweather', 'free'), {allowed: false, reason: 'minute-cap'}, 'rolling: the previous minute still counts fully');
    const later = budgetSetup({owmMinuteCap: 60}, '2026-09-27T15:22:00Z');
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

test('budget: paid phase disabled by default, per-provider paid cap reserved at admission', async () => {
    const off = budgetSetup();
    eq(await check(off.budget, 'google', 'paid'), {allowed: false, reason: 'paid-disabled'});
    assert.equal(off.usage.writes, 0);
    const on = budgetSetup({paidProvidersEnabled: true, paidMonthlyCallCap: 3});
    for (let i = 0; i < 3; i++) {
        eq(await check(on.budget, 'openweather', 'paid'), {allowed: true, reservation: 'openweather:paid:m:2026-09'});
        await record(on.budget, 'openweather', 'paid', {reservation: 'openweather:paid:m:2026-09'});
    }
    assert.equal(on.usage.rows['openweather:paid:m:2026-09'].calls, 3, 'one call per admission, none added at completion');
    eq(await check(on.budget, 'openweather', 'paid'), {allowed: false, reason: 'paid-cap'});
    assert.equal(on.usage.rows['openweather:paid:m:2026-09'].calls, 3, 'a denied admission reserves nothing');
    eq(await check(on.budget, 'google', 'paid'), {allowed: true, reservation: 'google:paid:m:2026-09'});
});

test('budget: Visual Crossing uses the overseas weather day budget and provider marker', async () => {
    const s = budgetSetup({paidProvidersEnabled: true, vcDailyRecordLimit: 100});
    eq(await check(s.budget, 'visualcrossing', 'free'), {allowed: false, reason: 'free-phase-excluded'});
    s.vcUsage.rows['2026-09-27'] = {_id: '2026-09-27', calls: 5, records: 99};
    eq(await check(s.budget, 'visualcrossing', 'paid'), {allowed: true, reservation: 'visualcrossing:paid:m:2026-09'});
    s.vcUsage.rows['2026-09-27'].records = 100;
    eq(await check(s.budget, 'visualcrossing', 'paid'), {allowed: false, reason: 'vc-record-limit'});
    s.vcUsage.rows['2026-09-27'].records = 10;
    s.vcLock.rows['~provider'] = {_id: '~provider', expireAt: '2026-09-27T15:25:00Z', failed: true};
    eq(await check(s.budget, 'visualcrossing', 'paid'), {allowed: false, reason: 'down'});
    delete s.vcLock.rows['~provider'];
    assert.equal(s.usage.rows['visualcrossing:paid:m:2026-09'].calls, 1, 'record-limit and marker denials reserve nothing');
    await record(s.budget, 'visualcrossing', 'paid', {cost: 1, reservation: 'visualcrossing:paid:m:2026-09'});
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
    eq(r.attempts.map(x => x.provider + ':' + x.phase), ['google:free', 'openweather:free', 'aqicn:free', 'visualcrossing:paid']);
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

// ---- review round 1 (F1-F4) ----------------------------------------------------------------
test('F1: a status field that cannot be coerced or is not a string is a classified failure, never a throw', async () => {
    const bodies = [{status: {toString: null}}, {status: {valueOf: null, toString: null}, data: {}}, {status: 42, data: {}}, {status: ['ok'], data: {}},
        {status: 'nope-' + KEYS.aqicn}];
    const lines = [];
    for (const body of bodies) {
        const {http, providers} = adapters(() => ({status: 200, data: body}), lines);
        for (const id of ['google', 'openweather', 'visualcrossing', 'aqicn']) {
            let calls = 0;
            const r = await new Promise(resolve => providers[id].fetchCurrent(seoul, {axios: http.axios, keyString, timeoutMs: 3000}, x => { calls++; resolve(x); }));
            assert.equal(r.outcome, 'failed', id);
            assert.ok(['invalid-body', 'status'].includes(r.kind), id + ' ' + JSON.stringify(r));
            assert.equal(calls, 1);
        }
    }
    const {http, providers} = adapters(() => ({status: 200, data: {status: 'nope-' + KEYS.aqicn}}), lines);
    const r = await fetch(providers.aqicn, {axios: http.axios, keyString, timeoutMs: 3000});
    assert.equal(r.reason, 'status-other', 'unknown status text is not reflected');
    noKeyLeak(lines, JSON.stringify(r));
});

test('F2: a zero cap blocks the first call on an empty store, in every window', async () => {
    const s = budgetSetup({googleMonthlyCap: 0, owmMonthlyCap: 0, owmMinuteCap: 0, paidProvidersEnabled: true, paidMonthlyCallCap: 0});
    eq(await check(s.budget, 'google', 'free'), {allowed: false, reason: 'free-cap'});
    eq(await check(s.budget, 'openweather', 'free'), {allowed: false, reason: 'free-cap'});
    eq(await check(s.budget, 'google', 'paid'), {allowed: false, reason: 'paid-cap'});
    eq(await check(s.budget, 'visualcrossing', 'paid'), {allowed: false, reason: 'paid-cap'});
    const minuteOnly = budgetSetup({owmMinuteCap: 0});
    eq(await check(minuteOnly.budget, 'openweather', 'free'), {allowed: false, reason: 'minute-cap'});
    const one = budgetSetup({googleMonthlyCap: 1});
    eq(await check(one.budget, 'google', 'free'), {allowed: true}, 'cap 1 with reserve still admits the first call');
    await record(one.budget, 'google', 'free', {});
    eq(await check(one.budget, 'google', 'free'), {allowed: false, reason: 'free-cap'});
});

test('F3: the OpenWeather minute cap is a rolling minute across the bucket boundary', async () => {
    const late = budgetSetup({owmMinuteCap: 60}, '2026-09-27T23:59:59Z');
    for (let i = 0; i < 60; i++) { await record(late.budget, 'openweather', 'free', {}); }
    const atMidnight = budgetSetup({owmMinuteCap: 60}, '2026-09-28T00:00:00Z');
    Object.assign(atMidnight.usage.rows, late.usage.rows);
    eq(await check(atMidnight.budget, 'openweather', 'free'), {allowed: false, reason: 'minute-cap'}, '60 calls one second ago still count');
    const halfway = budgetSetup({owmMinuteCap: 60}, '2026-09-28T00:00:30Z');
    Object.assign(halfway.usage.rows, late.usage.rows);
    for (let i = 0; i < 29; i++) { await record(halfway.budget, 'openweather', 'free', {}); }
    eq(await check(halfway.budget, 'openweather', 'free'), {allowed: true}, '30 weighted from the previous minute + 29 = 59');
    await record(halfway.budget, 'openweather', 'free', {});
    eq(await check(halfway.budget, 'openweather', 'free'), {allowed: false, reason: 'minute-cap'}, '30 + 30 = 60');
    const later = budgetSetup({owmMinuteCap: 60}, '2026-09-28T00:00:59Z');
    Object.assign(later.usage.rows, halfway.usage.rows);
    eq(await check(later.budget, 'openweather', 'free'), {allowed: true}, '30 this minute + 60 weighted 1/60 = 31');
    const clear = budgetSetup({owmMinuteCap: 60}, '2026-09-28T00:02:00Z');
    Object.assign(clear.usage.rows, halfway.usage.rows);
    eq(await check(clear.budget, 'openweather', 'free'), {allowed: true});
});

test('F4: each provider is attempted at most once per request, across phases (at most four attempts)', async () => {
    const s = chainSetup({config: {paidProvidersEnabled: true}, scripts: {google: failed('timeout'), openweather: failed('timeout'), aqicn: failed('timeout'), visualcrossing: failed('timeout')}});
    const r = await run(s.chain);
    assert.equal(r.outcome, 'failed');
    eq(r.attempts.map(x => x.provider + ':' + x.phase), ['google:free', 'openweather:free', 'aqicn:free', 'visualcrossing:paid']);
    for (const id of ['google', 'openweather', 'visualcrossing', 'aqicn']) { assert.equal(s.providers[id].calls.length, 1, id); }
    // a provider skipped by its free budget is still eligible in the paid phase
    const capped = chainSetup({config: {paidProvidersEnabled: true}, usageRows: {'google:m:2026-09': {_id: 'google:m:2026-09', calls: 9500, expireAt: 'x'}},
        scripts: {openweather: failed('timeout'), aqicn: failed('timeout'), visualcrossing: failed('timeout')}});
    const r2 = await run(capped.chain);
    assert.equal(r2.provider, 'google');
    eq(r2.attempts.map(x => x.provider + ':' + x.phase), ['openweather:free', 'aqicn:free', 'visualcrossing:paid', 'google:paid']);
});

// ---- review 5339346212 (D20): paid admission during storage failure --------------------------
function clock(iso) {
    const RealDate = Date;
    let ms = new RealDate(iso).getTime();
    const C = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [ms])); }
        static now() { return ms; }
    };
    C.set = next => { ms = new RealDate(next).getTime(); };
    return C;
}
const paidRow = (s, id = 'openweather') => s.usage.rows[id + ':paid:m:2026-09'];
const exhaustedFree = {'google:m:2026-09': {_id: 'google:m:2026-09', calls: 9500, expireAt: 'x'}, 'openweather:m:2026-09': {_id: 'openweather:m:2026-09', calls: 950000, expireAt: 'x'}};
const tick = () => new Promise(r => setImmediate(r));

test('D20: every applicable paid policy read fails closed; free reads stay fail-open', async () => {
    const all = budgetSetup({paidProvidersEnabled: true});
    all.usage.failRead = true;
    for (const id of ['openweather', 'google', 'visualcrossing']) {
        eq(await check(all.budget, id, 'paid'), {allowed: false, reason: 'store-error'}, id);
    }
    eq(await check(all.budget, 'google', 'free'), {allowed: true}, 'free phase unchanged');
    assert.equal(all.usage.writes, 0, 'nothing reserved after a failed read');
    // each read on its own: down marker, OpenWeather minute buckets, Visual Crossing marker and day usage
    const cases = [
        ['openweather', s => { s.usage.failRead = id => id === 'openweather:down'; }],
        ['openweather', s => { s.usage.failRead = id => id.indexOf('openweather:min:') === 0; }],
        ['visualcrossing', s => { s.vcLock.failRead = true; }],
        ['visualcrossing', s => { s.vcUsage.failRead = true; }]
    ];
    for (const [id, inject] of cases) {
        const s = budgetSetup({paidProvidersEnabled: true, vcDailyRecordLimit: 100});
        inject(s);
        eq(await check(s.budget, id, 'paid'), {allowed: false, reason: 'store-error'}, inject.toString());
        assert.equal(paidRow(s, id), undefined, 'no reservation');
        assert.ok(s.lines.some(l => l.level === 'warn'));
    }
});

test('D20: a failed reservation denies the paid candidate; the chain moves on without HTTP', async () => {
    const s = budgetSetup({paidProvidersEnabled: true});
    s.usage.failWrite = true;
    eq(await check(s.budget, 'openweather', 'paid'), {allowed: false, reason: 'reserve-error'});
    const c = chainSetup({usageRows: exhaustedFree, config: {paidProvidersEnabled: true}, configured: {aqicn: false}});
    c.usage.failWrite = id => id === 'openweather:paid:m:2026-09';
    const r = await run(c.chain);
    assert.equal(r.provider, 'visualcrossing', JSON.stringify(r));
    assert.equal(c.providers.openweather.calls.length, 0, 'no unreserved paid HTTP');
    eq(r.skipped.filter(x => x.phase === 'paid'), [{provider: 'openweather', phase: 'paid', reason: 'reserve-error'}]);
    const none = chainSetup({usageRows: exhaustedFree, config: {paidProvidersEnabled: true}, configured: {aqicn: false}});
    none.usage.failWrite = id => id.indexOf(':paid:') !== -1;
    const r2 = await run(none.chain);
    assert.equal(r2.outcome, 'failed'); assert.equal(r2.reason, 'no-provider');
    eq(called(none.providers), []);
});

test('D20: paid HTTP starts only after the reservation is acknowledged', async () => {
    const c = chainSetup({usageRows: exhaustedFree, config: {paidProvidersEnabled: true}, configured: {aqicn: false}});
    c.usage.holdWrites = true;
    const pending = run(c.chain);
    for (let i = 0; i < 5; i++) { await tick(); }
    assert.equal(c.usage.pendingWrites.length, 1, 'reservation in flight');
    assert.equal(c.providers.openweather.calls.length, 0, 'no HTTP before acknowledgement');
    c.usage.holdWrites = false;
    c.usage.pendingWrites.splice(0).forEach(fn => fn());
    const r = await pending;
    assert.equal(r.provider, 'openweather');
    eq(c.providers.openweather.calls, ['paid']);
    assert.equal(paidRow(c).calls, 1, 'no double count at completion');
    assert.equal(paidRow(c).failures || 0, 0);
});

test('D20: a post-call accounting failure keeps the reservation; failures add no calls', async () => {
    const s = budgetSetup({paidProvidersEnabled: true, paidMonthlyCallCap: 2});
    const a = await check(s.budget, 'openweather', 'paid');
    assert.equal(a.allowed, true);
    s.usage.failWrite = true;
    await record(s.budget, 'openweather', 'paid', {failed: true, reservation: a.reservation});
    s.usage.failWrite = false;
    assert.equal(paidRow(s).calls, 1, 'the reservation is not refunded');
    const b = await check(s.budget, 'openweather', 'paid');
    await record(s.budget, 'openweather', 'paid', {failed: true, reservation: b.reservation});
    assert.equal(paidRow(s).calls, 2); assert.equal(paidRow(s).failures, 1);
    eq(await check(s.budget, 'openweather', 'paid'), {allowed: false, reason: 'paid-cap'}, 'cap consumed despite the lost write');
    // through the chain: a failing paid provider is counted once
    const c = chainSetup({usageRows: exhaustedFree, config: {paidProvidersEnabled: true}, configured: {aqicn: false}, scripts: {openweather: failed('http', 'http-500')}});
    await run(c.chain);
    assert.equal(paidRow(c).calls, 1); assert.equal(paidRow(c).failures, 1);
});

test('D20: concurrent admissions for the last slot admit exactly one; existing rows stay compatible', async () => {
    const s = budgetSetup({paidProvidersEnabled: true, paidMonthlyCallCap: 3});
    s.usage.rows['openweather:paid:m:2026-09'] = {_id: 'openweather:paid:m:2026-09', calls: 2, failures: 1, expireAt: '2026-11-01T00:00:00.000Z'};
    s.usage.holdWrites = true;
    const results = [1, 2, 3, 4, 5].map(() => check(s.budget, 'openweather', 'paid'));
    for (let i = 0; i < 5; i++) { await tick(); }
    s.usage.holdWrites = false;
    while (s.usage.pendingWrites.length) { s.usage.pendingWrites.splice(0).forEach(fn => fn()); await tick(); }
    const states = await Promise.all(results);
    assert.equal(states.filter(x => x.allowed).length, 1, canon(states));
    assert.ok(states.filter(x => !x.allowed).every(x => x.reason === 'paid-cap'), canon(states));
    assert.equal(paidRow(s).calls, 3); assert.equal(paidRow(s).failures, 1);
    // two requests racing through the chain: one paid HTTP call
    const c = chainSetup({usageRows: Object.assign({'openweather:paid:m:2026-09': {_id: 'openweather:paid:m:2026-09', calls: 99999, expireAt: 'x'}}, exhaustedFree),
        config: {paidProvidersEnabled: true}, configured: {aqicn: false, visualcrossing: false, google: false}});
    const [r1, r2] = await Promise.all([run(c.chain), run(c.chain)]);
    assert.equal(c.providers.openweather.calls.length, 1);
    eq([r1.outcome, r2.outcome].sort(), ['failed', 'ok']);
    assert.equal(paidRow(c).calls, 100000);
});

test('D20: zero paid cap reserves nothing; a slot reserved before month end stays charged to that month', async () => {
    const zero = budgetSetup({paidProvidersEnabled: true, paidMonthlyCallCap: 0});
    eq(await check(zero.budget, 'openweather', 'paid'), {allowed: false, reason: 'paid-cap'});
    assert.equal(zero.usage.writes, 0); assert.equal(paidRow(zero), undefined);
    const C = clock('2026-09-30T23:59:59.500Z');
    const s = budgetSetup({paidProvidersEnabled: true, paidMonthlyCallCap: 1}, undefined, C);
    const a = await check(s.budget, 'openweather', 'paid');
    eq(a, {allowed: true, reservation: 'openweather:paid:m:2026-09'});
    eq(await check(s.budget, 'openweather', 'paid'), {allowed: false, reason: 'paid-cap'});
    C.set('2026-10-01T00:00:01Z');
    await record(s.budget, 'openweather', 'paid', {failed: true, reservation: a.reservation});
    assert.equal(paidRow(s).calls, 1); assert.equal(paidRow(s).failures, 1, 'late completion charged to the admission month');
    assert.equal(s.usage.rows['openweather:paid:m:2026-10'], undefined, 'nothing written to the new month');
    assert.ok(new Date(paidRow(s).expireAt) >= new Date('2026-11-01T00:00:00Z'));
    eq(await check(s.budget, 'openweather', 'paid'), {allowed: true, reservation: 'openweather:paid:m:2026-10'}, 'new month starts empty');
    assert.equal(s.usage.rows['openweather:paid:m:2026-10'].calls, 1);
});

test('D20: only an acknowledged single-row reservation admits a paid call', async () => {
    const answers = [
        [undefined, false], [null, false], [{}, false], [{acknowledged: false}, false], [{acknowledged: false, n: 1}, false],
        [{n: 0, nModified: 0, ok: 1}, false], [{n: 1, nModified: 1, ok: 0}, false], [{n: 2, nModified: 2, ok: 1}, false],
        [{acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0}, false],
        [{result: {ok: 1}}, false], [{result: {ok: 1, n: 0, nModified: 0}, matchedCount: 0, modifiedCount: 0, upsertedCount: 0}, false],
        [{ok: 0, n: 0, nModified: 0}, false],
        // mongoose 5.1.2 + driver 3.0.8 (production): the driver result with the server result nested
        [{result: {ok: 1, n: 1, nModified: 1}, matchedCount: 1, modifiedCount: 1, upsertedCount: 0}, true],
        [{result: {ok: 1, n: 1, nModified: 0, upserted: [{index: 0, _id: 'x'}]}, matchedCount: 0, modifiedCount: 0, upsertedCount: 1}, true],
        // mongoose 5.13: the unwrapped server result
        [{n: 1, nModified: 1, ok: 1}, true], [{n: 1, nModified: 0, upserted: [{index: 0, _id: 'x'}], ok: 1}, true],
        [{acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0}, true],
        [{acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1}, true]
    ];
    for (const [raw, admitted] of answers) {
        const c = chainSetup({usageRows: exhaustedFree, config: {paidProvidersEnabled: true}, configured: {aqicn: false, visualcrossing: false, google: false}});
        const updateOne = c.usage.updateOne;
        c.usage.updateOne = (q, u, o, cb) => q.calls ? cb(null, raw) : updateOne(q, u, o, cb);
        const r = await run(c.chain);
        assert.equal(c.providers.openweather.calls.length, admitted ? 1 : 0, canon(raw));
        if (!admitted) { eq(r.skipped, [{provider: 'google', phase: 'free', reason: 'free-cap'}, {provider: 'openweather', phase: 'free', reason: 'free-cap'}, {provider: 'openweather', phase: 'paid', reason: 'reserve-error'}].filter(x => x.provider !== 'google'), canon(raw)); }
    }
});
