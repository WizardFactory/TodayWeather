'use strict';
// Offline test for the service-side observation merge (issue #2573 §3):
//  - controllerKmaStnWeather.getStnHourlyAndMinRns continues when hourly rows are missing
//  - controllerTown.getKmaStnMinuteWeather replaces valid current fields with newer observations
// Both are extracted by source slicing into a VM; no app, DB, or network.
// Usage: node server/test/offline/test.minute.merge.js [server dir]
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const serverDir = process.argv[2] || path.join(__dirname, '../..');
const townSrc = fs.readFileSync(path.join(serverDir, 'controllers/controllerTown.js'), 'utf8');
const stnSrc = fs.readFileSync(path.join(serverDir, 'controllers/controllerKmaStnWeather.js'), 'utf8');

function slice(src, startMarker, endMarker) {
    const s = src.indexOf(startMarker);
    assert(s >= 0, 'marker not found: ' + startMarker);
    const e = src.indexOf(endMarker, s + startMarker.length);
    assert(e > s, 'end marker not found: ' + endMarker);
    return src.slice(s, e + endMarker.length);
}

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok - ' + name); }

// ---------- controllerTown: _isValidObservation + merge loop ----------
const validSrc = slice(townSrc, 'this._isValidObservation = function', '\n    };');
const mergeLoopSrc = slice(townSrc, 'var observedFields = {', '\n                    }\n');

function runMerge(reqCurrent, stnWeatherInfo, stnFirst) {
    const self = {};
    vm.runInNewContext('(function(){' + validSrc + '})()', { this: self, self });
    // validSrc assigns this._isValidObservation; rebind explicitly
    const ctx = { self: {}, isFinite };
    vm.runInNewContext('var self = this; ' + validSrc, ctx);
    ctx.self._isValidObservation = ctx._isValidObservation;
    const loopCtx = { self: ctx.self, reqCurrent, stnWeatherInfo, stnFirst, isFinite };
    vm.runInNewContext(mergeLoopSrc, loopCtx);
    return reqCurrent;
}

test('_isValidObservation rejects sentinels and non-numbers', () => {
    const ctx = { isFinite };
    vm.runInNewContext('var self = this; ' + validSrc, ctx);
    const v = ctx._isValidObservation;
    assert.strictEqual(v('t1h', 22), true);
    assert.strictEqual(v('t1h', -50), false);
    assert.strictEqual(v('t1h', -999), false);
    assert.strictEqual(v('t1h', 'x'), false);
    assert.strictEqual(v('t1h', NaN), false);
    assert.strictEqual(v('reh', 86), true);
    assert.strictEqual(v('reh', 101), false);
    assert.strictEqual(v('reh', -1), false);
    assert.strictEqual(v('vec', 360), true);
    assert.strictEqual(v('vec', 361), false);
    assert.strictEqual(v('wsd', 0), true);
    assert.strictEqual(v('wsd', -0.1), false);
});

test('newer observation (stnFirst) replaces valid t1h/reh/vec/wsd, originals kept in dongnae by caller', () => {
    const cur = { t1h: 23.5, reh: 70, vec: 90, wsd: 1.0, rn1: 0, sky: 1, pty: 0 };
    const obs = { t1h: 22, reh: 86, vec: 45, wsd: 2.2, rn1: 0, rns: false, stnId: 108, weather: '맑음' };
    runMerge(cur, obs, true);
    assert.strictEqual(cur.t1h, 22);
    assert.strictEqual(cur.reh, 86);
    assert.strictEqual(cur.vec, 45);
    assert.strictEqual(cur.wsd, 2.2);
    assert.strictEqual(cur.sky, 1, 'unrelated fields untouched');
    assert.strictEqual(cur.stnId, 108, 'new fields appended');
    assert.strictEqual(cur.weather, '맑음');
});

test('older observation (not stnFirst) keeps valid API values, fills only missing/sentinel', () => {
    const cur = { t1h: 23.5, reh: 70, vec: -1, wsd: 1.0 };
    const obs = { t1h: 22, reh: 86, vec: 45, wsd: 2.2, rns: false };
    runMerge(cur, obs, false);
    assert.strictEqual(cur.t1h, 23.5);
    assert.strictEqual(cur.reh, 70);
    assert.strictEqual(cur.vec, 45, 'sentinel -1 filled');
    assert.strictEqual(cur.wsd, 1.0);
    assert.strictEqual(cur.rns, false, 'missing field appended');
});

test('newer observation with invalid values never overwrites a valid API value', () => {
    const cur = { t1h: 23.5, reh: 70, vec: 90, wsd: 1.0 };
    const obs = { t1h: -999, reh: 150, vec: 400, wsd: -1 };
    runMerge(cur, obs, true);
    assert.deepStrictEqual({ t1h: cur.t1h, reh: cur.reh, vec: cur.vec, wsd: cur.wsd }, { t1h: 23.5, reh: 70, vec: 90, wsd: 1.0 });
});

test('sentinel API value is replaced regardless of freshness', () => {
    const cur = { t1h: -50, reh: -1 };
    const obs = { t1h: 22, reh: 86 };
    runMerge(cur, obs, false);
    assert.strictEqual(cur.t1h, 22);
    assert.strictEqual(cur.reh, 86);
});

test('rn1 is only filled when missing/negative, never replaced by freshness', () => {
    const cur = { rn1: 0.5 };
    runMerge(cur, { rn1: 3 }, true);
    assert.strictEqual(cur.rn1, 0.5);
    const cur2 = { rn1: -1 };
    runMerge(cur2, { rn1: 3 }, false);
    assert.strictEqual(cur2.rn1, 3);
});

// ---------- controllerKmaStnWeather: hourly optional ----------
const hourlyStepSrc = slice(stnSrc, 'self.findHourlies2(stn.stnId, fromTime, function (err, hourlyWeatherList) {', '\n                });');

function runHourlyStep(findResult) {
    const logs = { warn: [], debug: [] };
    const stnWeather = {};
    let out;
    const ctx = {
        self: { findHourlies2: (id, from, cb) => cb(findResult.err, findResult.rows) },
        stn: { stnId: 108 }, fromTime: new Date(), stnWeather,
        pCallback: (err, s) => { out = { err, s }; },
        log: { warn: m => logs.warn.push(m), debug: m => logs.debug.push(m) },
        JSON
    };
    vm.runInNewContext(hourlyStepSrc, ctx);
    return { out, stnWeather, logs };
}

test('missing hourly rows → continue with hourlyMissing flag, no error', () => {
    const r = runHourlyStep({ err: new Error('Fail to find hourlies stnId=108') });
    assert.strictEqual(r.out.err, null);
    assert.deepStrictEqual(r.out.s, { stnId: 108 });
    assert.strictEqual(r.stnWeather.hourlyMissing, true);
    assert.strictEqual(r.stnWeather.cityHourAws, undefined);
    assert.strictEqual(r.logs.warn.length, 1);
});

test('present hourly rows → merged as before, rs15m promotes rns', () => {
    const r = runHourlyStep({ err: null, rows: [{ t1h: 10, rns: false, rs15m: 0 }, { t1h: 11, rns: false, rs15m: 0.5, weather: '비' }] });
    assert.strictEqual(r.out.err, null);
    assert.strictEqual(r.stnWeather.t1h, 11, 'last row wins');
    assert.strictEqual(r.stnWeather.rns, true);
    assert.strictEqual(r.stnWeather.rnsSource, 'rs15m');
    assert.strictEqual(r.stnWeather.hourlyMissing, undefined);
    assert.strictEqual(r.stnWeather.cityHourAws.weather, '비');
});

console.log('# ' + passed + ' tests passed');
