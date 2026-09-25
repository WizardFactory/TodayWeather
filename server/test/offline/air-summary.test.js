/* Run with Node >=16.20.2: node server/test/offline/air-summary.test.js
 * Loads whole production modules in an isolated VM; every collaborator that the
 * exercised functions do not need is a stub. No app startup, providers, Mongo or timers.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const noop = function () {};
const log = Object.fromEntries(['info','warn','error','debug','verbose','silly'].map(k => [k,noop]));
const ts = {__: key => key};

function Stub() {}
function load(relative, dependencies = {}) {
    const module = {exports: {}};
    const sandbox = {module, exports: module.exports, console, log, Date,
        require: name => Object.prototype.hasOwnProperty.call(dependencies, name) ? dependencies[name] : Stub};
    sandbox.global = sandbox;
    vm.runInNewContext(fs.readFileSync(path.join(root, relative), 'utf8'), sandbox, {filename: relative});
    return module.exports;
}

const Keco = load('controllers/kecoController.js');
const Town = load('controllers/controllerTown.js');
const town = new Town();
town._diffTodayYesterday = () => ({str: 'LOC_TEMP_DIFF', grade: 1});
const Town24h = load('controllers/controllerTown24h.js', {'../controllers/controllerTown': Town});
const town24h = new Town24h();

// Mirrors the 2026-09-25 Seoul response: no AirKorea observation, weak wind (#2578).
function currentWithoutAir(extra) {
    return Object.assign({date: '20260925', time: 22, t1h: 18.6, sky: 4, pty: 0,
        dsplsGrade: 0, decpsnGrade: 1, heatIndexGrade: 0, frostGrade: 0, wsdGrade: 1, wsdStr: 'LOC_WEAK_WIND'}, extra);
}

test('missing air observation yields no air summary instead of weather grades', () => {
    assert.equal(town24h.makeSummaryAir(currentWithoutAir(), {}, ts), '');
    assert.equal(town24h.makeSummaryAir(currentWithoutAir({arpltn: null}), {}, ts), '');
    assert.equal(town24h.makeSummaryAir(currentWithoutAir({arpltn: undefined, wsdGrade: 2}), {}, ts), '');
});

test('air observation without grades yields no air summary', () => {
    assert.equal(town24h.makeSummaryAir(currentWithoutAir({arpltn: {}}), {}, ts), '');
    assert.equal(town24h.makeSummaryAir(currentWithoutAir({arpltn: {aqiIndex: -1}}), {}, ts), '');
});

test('air summary uses pollutant grades only, not current weather grades', () => {
    const good = currentWithoutAir({wsdGrade: 4, arpltn: {pm10Grade: 1, pm25Grade: 1, pm25Grade24: 3, khaiGrade: 1}});
    assert.equal(town24h.makeSummaryAir(good, {}, ts), 'LOC_AIR_QUALITY_IS_GOOD');
    const moderate = currentWithoutAir({arpltn: {pm10Grade: 2, pm25Grade: 1}});
    assert.equal(town24h.makeSummaryAir(moderate, {}, ts), 'LOC_AIR_QUALITY_IS_MODERATE');
    const bad = currentWithoutAir({arpltn: {pm25Grade: 3, pm25Value: 40, pm25Str: 'LOC_BAD', pm25Index: 110,
        pm10Grade: 2, pm10Value: 60, pm10Str: 'LOC_MODERATE', pm10Index: 70}});
    assert.equal(town24h.makeSummaryAir(bad, {}, ts), 'LOC_PM25 40 LOC_BAD');
});

test('combined summary neither reads nor writes air fields on current', () => {
    const current = currentWithoutAir({weatherType: 3, weather: 'LOC_CLOUDY'});
    delete current.wsdGrade;
    assert.equal(town.makeSummary(current, {t1h: 21.6}, {}, ts), 'LOC_TEMP_DIFF, LOC_CLOUDY');
    assert.equal('aqiGrade' in current, false, 'no aqiGrade written onto current');
    assert.equal('aqiStr' in current, false, 'no aqiStr written onto current');
    const withAir = currentWithoutAir({weatherType: 3, weather: 'LOC_CLOUDY', arpltn: {pm25Grade: 3, pm25Str: 'LOC_BAD'}});
    delete withAir.wsdGrade;
    assert.equal(town.makeSummary(withAir, {t1h: 21.6}, {}, ts), 'LOC_PM25 LOC_BAD, LOC_TEMP_DIFF');
});

// dataTime uses the same timezone-less local form that _checkDateTime parses.
function dataTime(now, hoursAgo) {
    const d = new Date(now.getTime() - hoursAgo * 3600 * 1000);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':00';
}
function station(name, now, hoursAgo) {
    return [{stationName: name, dataTime: dataTime(now, hoursAgo), pm10Value: 20, pm10Grade: 1, pm25Value: 10,
        pm25Grade: 1, o3Value: 0.02, o3Grade: 1, no2Value: 0.01, no2Grade: 1, coValue: 0.3, coGrade: 1,
        so2Value: 0.003, so2Grade: 1, khaiValue: 40, khaiGrade: 1}];
}

test('every station uses the same eight-hour freshness window', () => {
    const now = new Date(2026, 8, 25, 22, 13);
    const requestTime = new Date(now);
    const merged = Keco._mergeArpltnList([station('A', now, 10), station('B', now, 12), station('C', now, 20)], requestTime);
    assert.equal(merged, undefined, 'observations older than eight hours are not current');
    assert.equal(requestTime.getTime(), now.getTime(), 'request time is not mutated');
});

test('fresh station after a stale one is still merged', () => {
    const now = new Date(2026, 8, 25, 22, 13);
    const merged = Keco._mergeArpltnList([station('A', now, 10), station('B', now, 1)], new Date(now));
    assert.equal(merged.stationName, 'B');
    assert.equal(merged.pm10Grade, 1);
});
