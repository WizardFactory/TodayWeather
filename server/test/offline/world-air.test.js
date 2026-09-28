/* Run with Node >=16.20.2: TZ=UTC NODE_PATH=<async> node server/test/offline/world-air.test.js
 * Overseas weather air (#2628 PR2): the active new-form world query asks the shared air service
 * (lib/AQI/airFallback: provider chain, shared cache and budgets) instead of the legacy WAQI branch,
 * and the normalized concentrations reach the current row only, graded in the requested airUnit,
 * with the observation time shown in the region's offset. Modules run in isolated VMs; the air
 * service, the weather fetch and the legacy WAQI collector are fakes. No network, Mongo or timers.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createLoader, memoryModel, fakeAxios, fixture, logger} = require('./air-harness');
const root = path.resolve(__dirname, '../..');
const lines = [];
const log = logger(lines);
const res = {__: key => key};
const canon = v => JSON.stringify(v, (k, val) => val && typeof val === 'object' && !Array.isArray(val) ?
    Object.keys(val).sort().reduce((o, key) => { o[key] = val[key]; return o; }, {}) : val);
const eq = (actual, expected, message) => assert.equal(canon(actual), canon(expected), message);

function Stub() {}
function load(relative, dependencies = {}, globals = {}) {
    const module = {exports: {}};
    const sandbox = Object.assign({module, exports: module.exports, console, log, Date, setImmediate, setTimeout, clearTimeout,
        require: name => Object.prototype.hasOwnProperty.call(dependencies, name) ? dependencies[name] : Stub}, globals);
    sandbox.global = sandbox;
    vm.runInNewContext(fs.readFileSync(path.join(root, relative), 'utf8'), sandbox, {filename: relative});
    return module.exports;
}
const AqiConverter = load('lib/aqi.converter.js');
const UnitConverter = load('lib/unitConverter.js');
const StationName = load('lib/AQI/waqiStationName.js');
const kmaTimeLib = load('lib/kmaTimeLib.js', {}, {manager: {leadingZeros: (n, l) => String(n).padStart(l, '0')}});
const Keco = load('controllers/kecoController.js');
const Town = load('controllers/controllerTown.js');
const Town24h = load('controllers/controllerTown24h.js', {'../controllers/controllerTown': Town});
const WWUnits = load('controllers/worldWeather/controller.ww.units.js', {'../../lib/unitConverter': UnitConverter, '../controllerTown24h': Town24h,
    '../../lib/kmaTimeLib': kmaTimeLib, '../../lib/aqi.converter': AqiConverter, '../../lib/AQI/waqiStationName': StationName});

function LegacyAqi() { throw new Error('legacy WAQI collector used on the converted path'); }
function world({air, dsf} = {}) {
    const Dsf = function () {};
    Dsf.prototype.getDsfData = dsf || ((req, cDate, cb) => setImmediate(cb));
    const Controller = load('controllers/worldWeather/controllerWorldWeather.js', {
        async: require('async'), '../../lib/unitConverter': UnitConverter, '../../lib/aqi.converter': AqiConverter,
        './controllerAqi': LegacyAqi, './dsf.controller': Dsf, '../../lib/AQI/airFallback': air || {getArpltn: () => { throw new Error('no air service'); }},
        request: () => { throw new Error('Unexpected legacy HTTP request'); }});
    return new Controller();
}
function fakeAir(answer) {
    const calls = [];
    return {calls, getArpltn(gCoord, requestTime, cb) { calls.push({gCoord, requestTime}); setImmediate(() => answer(cb)); }};
}
function query(ctrl, req) {
    return new Promise(resolve => ctrl.queryTwoDaysWeatherNewForm(req, {status() { throw new Error('unexpected status'); }}, err => resolve(err)));
}
function worldReq(extra) {
    return Object.assign({validVersion: true, params: {category: 'current'}, query: {gcode: '27.72,85.32'}, geocode: {lat: '27.72', lon: '85.32'}, sessionID: 't', result: {}}, extra);
}

const OBS = {provider: 'google', stationBased: false, observedAt: '2026-09-27T14:00:00.000Z',
    pollutants: {pm25: 29, pm10: 41, o3: 0.054, no2: 0.0104, so2: 0.0043, co: 0.334}, indexes: {uaqi: 63}, attribution: 'Google Air Quality'};
const WAQI_OBS = {provider: 'aqicn', stationBased: true, observedAt: '2026-09-27T14:00:00.000Z', stationName: 'Ido-dong', stationGeo: [33.5, 126.53],
    pollutants: {pm25: 12.5, pm10: 20}, indexes: {us: 52}, attribution: 'World Air Quality Index Project'};

/** The world pipeline after the query: current row, merge, units, air info, summary. */
function respond(ctrl, obs, {airUnit, offsetMin = 345, withYesterday = true} = {}) {
    const current = {date: '2026.09.27 20:00', desc: 'Clear', temp_c: 20, temp_f: 68, humid: 50};
    const yesterday = {date: '2026.09.26 20:00', desc: 'Clear', temp_c: 19, temp_f: 66, humid: 55};
    const req = {sessionID: 't', query: {airUnit}, airObservation: obs, currentThisTime: current, currentTimeOffsetMs: offsetMin * 60000,
        result: {thisTime: withYesterday ? [yesterday, current] : [current], timezone: {min: offsetMin, ms: offsetMin * 60000}, daily: [], hourly: []}};
    ctrl.mergeAqi(req, res, () => {});
    return {req, current, yesterday};
}

// ---- AC1/AC2: the active new-form query uses the shared air service -----------------------------
test('new-form world query asks the shared air service once, never the legacy WAQI collector', async () => {
    const air = fakeAir(cb => cb(null, {source: 'google', pm25Value: 29}, undefined, OBS));
    const req = worldReq();
    const err = await query(world({air}), req);
    assert.equal(err, undefined);
    assert.equal(air.calls.length, 1);
    eq(air.calls[0].gCoord, {lat: 27.72, lon: 85.32});
    assert.equal(air.calls[0].requestTime.getTime(), req.cDate.getTime(), 'request time is the query clock');
    eq(req.airObservation, OBS);
    assert.equal(req.AQI, undefined, 'no legacy AQI data');
});

test('a weather-cache hit still retrieves air (both branches always run)', async () => {
    const air = fakeAir(cb => cb(null, {source: 'openweather'}, undefined, Object.assign({}, OBS, {provider: 'openweather'})));
    const req = worldReq();
    const err = await query(world({air, dsf: (r, c, cb) => cb()}), req);   // synchronous "cache hit"
    assert.equal(err, undefined);
    assert.equal(air.calls.length, 1);
    assert.equal(req.airObservation.provider, 'openweather');
});

// ---- AC4: air failures are nonfatal; weather errors are not hidden -------------------------------
test('no usable air, a callback error or a thrown air service keeps the weather response going', async () => {
    for (const air of [fakeAir(cb => cb(null, undefined, 'no-provider')), fakeAir(cb => cb(null, undefined, 'stale', undefined)),
        fakeAir(cb => cb(new Error('programming'))), {getArpltn() { throw new Error('boom'); }}]) {
        const req = worldReq();
        assert.equal(await query(world({air}), req), undefined);
        assert.equal(req.airObservation, undefined);
    }
    const noCoord = fakeAir(cb => cb(null, undefined, 'no-coord'));
    assert.equal(await query(world({air: noCoord}), worldReq({geocode: {lat: 'x', lon: 'y'}})), undefined);
});

test('a weather error still reaches next(err) with or without air', async () => {
    const air = fakeAir(cb => cb(null, {source: 'google'}, undefined, OBS));
    const err = await query(world({air, dsf: (r, c, cb) => setImmediate(() => cb(new Error('VC failed')))}), worldReq());
    assert.ok(err instanceof Error || (err && err.message), 'weather error forwarded');
    assert.match(err.message, /VC failed/);
});

// ---- AC3: normalized concentrations into the current row only ------------------------------------
test('concentrations go straight into current: values, source, regional time; yesterday untouched', () => {
    const ctrl = world();
    const {req, current, yesterday} = respond(ctrl, OBS, {airUnit: 'airkorea'});
    assert.equal(current.pm25Value, 29); assert.equal(current.pm10Value, 41);
    assert.equal(current.o3Value, 0.054); assert.equal(current.no2Value, 0.0104); assert.equal(current.so2Value, 0.0043); assert.equal(current.coValue, 0.334);
    assert.equal(current.airSource, 'google');
    assert.equal(current.mTime, '2026-09-27 19:45', 'UTC 14:00 at +5:45');
    assert.equal(current.mCity, undefined, 'no station for modeled data');
    eq(Object.keys(yesterday).sort(), ['date', 'desc', 'humid', 'temp_c', 'temp_f']);
    const units = new WWUnits();
    req.result.thisTime.forEach(t => units._makeArpltn(t, req.query));
    assert.equal(current.arpltn.source, 'google');
    assert.equal(current.arpltn.dataTime, '2026-09-27 19:45');
    assert.equal(current.arpltn.stationName, undefined);
    for (const k of ['source', 'dataTime', 'pm25Value', 'pm25Grade', 'aqiValue', 'khaiGrade', 'stationName']) {
        assert.equal(yesterday.arpltn[k], undefined, 'yesterday.arpltn.' + k);
    }
    ctrl.makeAirInfo(req, res, () => {});
    assert.equal(req.result.airInfo.source, 'google');
    assert.equal(req.result.airInfo.last.pm25ActionGuide !== undefined, true);
});

test('observation time renders once in the region offset (negative, fractional, date line), host TZ independent', () => {
    const ctrl = world();
    for (const [offset, expected] of [[345, '2026-09-27 19:45'], [-150, '2026-09-27 11:30'], [-660, '2026-09-27 03:00'], [840, '2026-09-28 04:00'], [0, '2026-09-27 14:00'], [330, '2026-09-27 19:30']]) {
        const {current} = respond(ctrl, OBS, {airUnit: 'airkorea', offsetMin: offset});
        assert.equal(current.mTime, expected, 'offset ' + offset);
    }
});

test('grades, indexes, strings and the integrated index follow the requested airUnit', () => {
    const ctrl = world();
    const codes = ['pm10', 'pm25', 'co', 'so2', 'no2', 'o3'];
    // airkorea: grade from the concentration table, index per pollutant, khai = max index (+ extra points)
    const k = respond(ctrl, OBS, {airUnit: 'airkorea'}).current;
    for (const c of codes) {
        assert.equal(k[c + 'Grade'], AqiConverter.value2grade('airkorea', c, OBS.pollutants[c]), 'airkorea ' + c);
        assert.equal(k[c + 'Str'], UnitConverter.airkoreaGrade2str(k[c + 'Grade'], c, res));
    }
    assert.equal(k.pm10Grade, 2); assert.equal(k.pm25Grade, 2);
    const kIdx = codes.map(c => AqiConverter.value2index('airkorea', c, OBS.pollutants[c]));
    assert.equal(k.aqiValue, Math.max(...kIdx));
    assert.equal(k.aqiGrade, AqiConverter.index2Grade('airkorea', k.aqiValue));
    // airkorea_who: max index and max grade
    const w = respond(ctrl, OBS, {airUnit: 'airkorea_who'}).current;
    for (const c of codes) { assert.equal(w[c + 'Grade'], AqiConverter.value2grade('airkorea_who', c, OBS.pollutants[c]), 'who ' + c); }
    assert.equal(w.aqiValue, Math.max(...codes.map(c => AqiConverter.value2index('airkorea_who', c, OBS.pollutants[c]))));
    assert.equal(w.aqiGrade, Math.max(...codes.map(c => w[c + 'Grade'])));
    // airnow: US AQI per pollutant from the concentration; integrated = max index, grade = max grade
    const n = respond(ctrl, OBS, {airUnit: 'airnow'}).current;
    for (const c of codes) {
        assert.equal(n[c + 'Grade'], AqiConverter.value2grade('airnow', c, OBS.pollutants[c]), 'airnow ' + c);
        assert.equal(n[c + 'Str'], UnitConverter.airnowGrade2str(n[c + 'Grade'], c, res));
    }
    assert.equal(n.pm25Grade, 2, 'PM2.5 29 µg/m³ is moderate');
    assert.equal(n.aqiValue, Math.max(...codes.map(c => AqiConverter.value2index('airnow', c, OBS.pollutants[c]))));
    assert.equal(n.aqiGrade, Math.max(...codes.map(c => n[c + 'Grade'])));
    // aqicn (and the widget route, which sends no airUnit)
    for (const unit of ['aqicn', undefined]) {
        const a = respond(ctrl, OBS, {airUnit: unit}).current;
        const idx = codes.map(c => AqiConverter.value2index('aqicn', c, OBS.pollutants[c]));
        for (const c of codes) { assert.equal(a[c + 'Grade'], AqiConverter.index2Grade('aqicn', AqiConverter.value2index('aqicn', c, OBS.pollutants[c])), 'aqicn ' + c); }
        assert.equal(a.aqiValue, Math.max(...idx));
        assert.equal(a.aqiGrade, AqiConverter.index2Grade('aqicn', a.aqiValue));
        // airGrade2Str(airUnit, grade): the legacy WAQI merge passes (grade, 'aqi') and gets ''
        assert.equal(a.aqiStr, UnitConverter.airGrade2Str('aqicn', a.aqiGrade, res));
        assert.notEqual(a.aqiStr, '');
    }
});

test('no WAQI-index round trip: values are the provider concentrations, not extractValue(index)', () => {
    const {current} = respond(world(), {provider: 'openweather', observedAt: OBS.observedAt, pollutants: {pm25: 35.7, o3: 0.0613}}, {airUnit: 'airnow'});
    assert.equal(current.pm25Value, 35.7);
    assert.equal(current.o3Value, 0.0613);
});

test('partial pollutants stay partial; the station name is shown only for station data', () => {
    const ctrl = world();
    const {req, current} = respond(ctrl, WAQI_OBS, {airUnit: 'airkorea'});
    eq(['pm10', 'pm25', 'co', 'so2', 'no2', 'o3'].filter(c => current[c + 'Value'] !== undefined), ['pm10', 'pm25']);
    for (const c of ['co', 'so2', 'no2', 'o3']) { assert.equal(current[c + 'Grade'], undefined); assert.equal(current[c + 'Str'], undefined); }
    const units = new WWUnits();
    req.result.thisTime.forEach(t => units._makeArpltn(t, req.query));
    assert.equal(current.arpltn.stationName, 'Ido-dong');
    assert.equal(current.arpltn.source, 'aqicn');
    for (const c of ['co', 'so2', 'no2', 'o3']) { assert.equal(current.arpltn[c + 'Value'], undefined); assert.equal(current.arpltn[c + 'Grade'], undefined); }
    const summary = new Town24h().makeSummaryAir(current, req.query, res);
    assert.equal(typeof summary, 'string');
});

test('summary uses the graded air; without an observation there is no air and no summaryAir', () => {
    const units = new WWUnits();
    const ctrl = world();
    const withAir = respond(ctrl, OBS, {airUnit: 'airkorea'});
    withAir.req.result.thisTime.forEach(t => units._makeArpltn(t, withAir.req.query));
    assert.equal(new Town24h().makeSummaryAir(withAir.current, withAir.req.query, res), 'LOC_AIR_QUALITY_IS_MODERATE');
    const without = respond(ctrl, undefined, {airUnit: 'airkorea'});
    without.req.result.thisTime.forEach(t => units._makeArpltn(t, without.req.query));
    assert.equal(without.current.pm25Value, undefined);
    assert.equal(without.current.arpltn.source, undefined);
    assert.equal(new Town24h().makeSummaryAir(without.current, without.req.query, res), '');
    ctrl.makeAirInfo(without.req, res, () => {});
    assert.equal(without.req.result.airInfo && without.req.result.airInfo.source, 'aqicn', 'legacy airInfo shape unchanged when arpltn exists');
});

test('without a current row the observation is dropped rather than attached to yesterday', () => {
    const ctrl = world();
    const yesterday = {date: '2026.09.26 20:00'};
    const req = {sessionID: 't', query: {airUnit: 'airkorea'}, airObservation: OBS, result: {thisTime: [yesterday], timezone: {min: 0, ms: 0}}};
    ctrl.mergeAqi(req, res, () => {});
    eq(yesterday, {date: '2026.09.26 20:00'});
});

// ---- legacy path stays compatible ---------------------------------------------------------------
test('legacy WAQI AQI data (other routes) still merges by WAQI sub-index', () => {
    const ctrl = world();
    const current = {date: '2026.09.27 20:00'};
    const req = {sessionID: 't', query: {airUnit: 'airkorea'}, AQI: {data: [{dateObj: '2026-09-27T14:00:00Z', mTime: '2026-09-27 19:00:00', mCity: 'Kathmandu', pm25: 87, pm10: 40, aqi: 87}]},
        result: {thisTime: [current], timezone: {min: 345, ms: 345 * 60000}}};
    ctrl.mergeAqi(req, res, () => {});
    assert.equal(current.pm25Value, AqiConverter.extractValue('pm25', 87));
    assert.equal(current.mCity, 'Kathmandu');
    assert.equal(current.airSource, undefined);
});

// ---- the shared air service exposes the accepted observation --------------------------------------
test('airFallback.getArpltn passes the accepted normalized observation as a fourth value (cached and fetched)', async () => {
    const store = memoryModel();
    const http = fakeAxios(() => ({status: 200, data: fixture('waqi-seoul')}));
    const RealDate = Date;
    const clock = class extends RealDate {
        constructor(...a) { super(...(a.length ? a : [RealDate.parse('2026-09-27T14:52:00Z')])); }
        static now() { return RealDate.parse('2026-09-27T14:52:00Z'); }
    };
    const l = createLoader({log, overrides: {'config/config.js': {keyString: {aqi_keys: [{key: 'synthetic-token'}]}},
        'models/air.observation.cache.model.js': store, 'models/air.provider.usage.model.js': memoryModel(),
        'models/worldWeather/vc.usage.model.js': memoryModel(), 'models/worldWeather/vc.fetch.lock.model.js': memoryModel(), axios: http.axios}, globals: {Date: clock}});
    const fallback = l.load('lib/AQI/airFallback.js');
    const call = () => new Promise(r => fallback.getArpltn({lat: 37.5665, lon: 126.978}, new clock(), (...args) => r(args)));
    const fetched = await call();
    assert.equal(fetched[0], null); assert.equal(fetched[1].source, 'aqicn'); assert.equal(fetched[2], undefined);
    assert.equal(fetched[3].provider, 'aqicn');
    assert.equal(fetched[3].observedAt, '2026-09-27T14:00:00.000Z', 'UTC ISO, not the KST dataTime');
    assert.equal(fetched[1].dataTime, '2026-09-27 23:00', 'domestic arpltn unchanged');
    const cached = await call();
    assert.equal(http.calls.length, 1, 'second call from the cache');
    eq(cached[3], fetched[3]);
    const far = await new Promise(r => fallback.getArpltn({lat: 35.1, lon: 129.0}, new clock(), (...args) => r(args)));
    assert.equal(far[1], undefined); assert.equal(far[3], undefined, 'no observation for an unusable result');
});
