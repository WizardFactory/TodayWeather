/* Run with Node >=16.20.2 and NODE_PATH containing xml2js, async and sprintf:
 *   TZ=UTC NODE_PATH=/tmp/tw-air-smoke/node_modules node server/test/offline/precipitation.test.js
 * Forecast rain/snow periods (#2583, D45). Loads whole production modules in an isolated VM;
 * collaborators the exercised functions do not need are stubs. No app startup, providers, Mongo or timers.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const h = require('./harness');
const root = path.resolve(__dirname, '../..');
const noop = function () {};
const log = Object.fromEntries(['info','warn','debug','verbose','silly'].map(k => [k,noop]));
// TW_DEBUG=1 prints errors that controllers log and swallow.
log.error = (...args) => { if (process.env.TW_DEBUG) console.error('log.error', ...args); };
const RealDate = Date;
const instant = '2026-09-24T00:10:00.000Z'; // 09:10 KST
class FixedDate extends RealDate { constructor(...args) { super(...(args.length ? args : [instant])); } static now() { return new RealDate(instant).getTime(); } }
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const globals = {};
for (const match of app.matchAll(/global\.(\w+String)\s*=\s*(\[[\s\S]*?\]);/g)) globals[match[1]] = vm.runInNewContext(match[2]);
// Controllers read time through the global manager; take its real methods without its constructor.
const managerCode = fs.readFileSync(path.join(root, 'controllers/controllerManager.js'), 'utf8');
globals.manager = {};
for (const method of ['getWorldTime', 'leadingZeros']) {
    const source = managerCode.match(new RegExp('Manager\\.prototype\\.' + method + ' = (function[\\s\\S]*?\\n});'))[1];
    globals.manager[method] = vm.runInNewContext('(' + source + ')', {Date: FixedDate});
}

function Stub() {}
function precipitation() { return require(path.join(root, 'lib/kmaPrecipitation')); }
// For the baseline Red run: behavior checks must fail on assertions, not on the missing module.
function maybePrecipitation() { return h.optional(path.join(root, 'lib/kmaPrecipitation')); }
function load(relative, dependencies = {}) {
    const module = {exports: {}};
    const sandbox = Object.assign({module, exports: module.exports, console, log, Date: FixedDate,
        require: name => {
            if (Object.prototype.hasOwnProperty.call(dependencies, name)) return dependencies[name];
            if (name === '../lib/kmaPrecipitation' || name === '../../lib/kmaPrecipitation') return maybePrecipitation();
            if (name === '../lib/midForecastPolicy' || name === '../../lib/midForecastPolicy') return require(path.join(root, 'lib/midForecastPolicy'));
            if (name === '../lib/kmaTimeLib' || name === '../../lib/kmaTimeLib') return kmaTimeLib;
            if (name === '../lib/unitConverter') return require(path.join(root, 'lib/unitConverter'));
            if (name === 'async') return require('async');
            return Stub;
        }}, globals);
    sandbox.global = sandbox;
    vm.runInNewContext(fs.readFileSync(path.join(root, relative), 'utf8'), sandbox, {filename: relative});
    return module.exports;
}
const kmaTimeLib = h.load('lib/kmaTimeLib.js', {}, {Date: FixedDate});
const shortController = {getShortFromDB: (model, coord, req, cb) => cb(null, req.modelShort)};
const Town = load('controllers/controllerTown.js', {'../config/config': {db: {version: '2.0'}},
    './kma/kma.town.short.controller.js': function () { return shortController; }});
const Town24h = load('controllers/controllerTown24h.js', {'../controllers/controllerTown': Town, '../config/config': {db: {version: '2.0'}}});
const town24h = new Town24h();
town24h._getCoord = (region, city, town, cb) => cb(null, {mx: 60, my: 127});

function ymd(d) { return d.toISOString().slice(0, 10).replace(/-/g, ''); }
function hhmm(d) { return d.toISOString().slice(11, 16).replace(':', ''); }
// Hourly short rows as stored by the collector: amount plus category text for categories.
function hourlyRows(values) {
    const rows = [];
    for (let hour = -48; hour <= 24 * 3; hour++) {
        const d = new RealDate(Date.UTC(2026, 8, 24, hour));
        const key = ymd(d) + hhmm(d).slice(0, 2);
        const row = {date: ymd(d), time: hhmm(d), pop: 10, pty: 0, r06: 0, s06: 0, reh: 60, sky: 1, t3h: 20, tmn: -50, tmx: -50, uuu: 1, vvv: -2, wav: -1, vec: 270, wsd: 2};
        Object.assign(row, values[key] || {});
        rows.push(row);
    }
    return rows;
}
function getShort(rows) {
    const req = {params: {region: 'r', city: 'c', town: 't'}, modelShort: {pubDate: '202609240800', ret: rows, dailyRows: []}};
    town24h.getShort(req, {}, noop);
    return req;
}
const slot = (list, date, time) => list.find(row => row.date === date && row.time === time);

test('AC2 parser: rain categories become amount, bounds and approximation', () => {
    const p = precipitation();
    assert.deepEqual(p.parse('강수없음', 'mm', '강수없음'), {amount: 0, min: 0, max: 0, approx: false});
    assert.deepEqual(p.parse('1mm 미만', 'mm', '강수없음'), {amount: 0.5, min: 0, max: 1, approx: true});
    assert.deepEqual(p.parse('1.0mm 미만', 'mm'), {amount: 0.5, min: 0, max: 1, approx: true});
    assert.deepEqual(p.parse('30.0~50.0mm', 'mm'), {amount: 40, min: 30, max: 50, approx: true});
    assert.deepEqual(p.parse('50.0mm 이상', 'mm'), {amount: 50, min: 50, max: null, approx: true});
    assert.deepEqual(p.parse(' 2.5mm ', 'mm'), {amount: 2.5, min: 2.5, max: 2.5, approx: false});
    assert.deepEqual(p.parse('7', 'mm'), {amount: 7, min: 7, max: 7, approx: false});
    assert.ok(p.parse('1mm 미만', 'mm').amount < 1);
    for (const bad of ['', ' ', 'unknown', '1.5cm', '-1', '-999', 'Infinity', 'NaN', '1e999', '1.2junk', '5~5mm', '9~3mm', undefined, null, -1, NaN, Infinity]) {
        assert.equal(p.parse(bad, 'mm', '강수없음'), null, JSON.stringify(bad));
    }
});

test('AC2 parser: snow categories in cm parse the same way', () => {
    const p = precipitation();
    assert.deepEqual(p.parse('적설없음', 'cm', '적설없음'), {amount: 0, min: 0, max: 0, approx: false});
    assert.deepEqual(p.parse('1cm 미만', 'cm'), {amount: 0.5, min: 0, max: 1, approx: true});
    assert.deepEqual(p.parse('1.0~5.0cm', 'cm'), {amount: 3, min: 1, max: 5, approx: true});
    assert.deepEqual(p.parse('5.0cm 이상', 'cm'), {amount: 5, min: 5, max: null, approx: true});
    assert.deepEqual(p.parse('2.4cm', 'cm'), {amount: 2.4, min: 2.4, max: 2.4, approx: false});
    assert.equal(p.parse('2.4mm', 'cm'), null);
});

test('AC2 collector stores the representative amount and the category text', () => {
    const cases = [
        ['1mm 미만', '1cm 미만', 0.5, 0.5, true],
        ['30.0~50.0mm', '1.0~5.0cm', 40, 3, true],
        ['50.0mm 이상', '5.0cm 이상', 50, 5, true],
        ['2.0mm', '1.2cm', 2, 1.2, false],
        ['강수없음', '적설없음', 0, 0, false]
    ];
    for (const [pcp, sno, r06, s06, approx] of cases) {
        const result = h.organize('organizeShortData', h.shortItems({PCP: pcp, SNO: sno}));
        assert.ok(result.isCompleted, pcp);
        const row = result.data[0];
        assert.equal(row.r06, r06, pcp); assert.equal(row.s06, s06, sno);
        assert.equal(row.r06Text, approx ? pcp : undefined, pcp);
        assert.equal(row.s06Text, approx ? sno : undefined, sno);
    }
    const items = h.shortItems().filter(i => !['TMP', 'PCP', 'SNO'].includes(i.category[0]));
    items.push(h.item('T1H', '12.5'), h.item('LGT', '0'), h.item('RN1', '30.0~50.0mm'));
    const shortest = h.organize('organizeShortestData', items).data[0];
    assert.equal(shortest.rn1, 40); assert.equal(shortest.rn1Text, '30.0~50.0mm');
});

test('AC1 hourly PCP 2, 4 and 1 in one slot give r06 7 over 3 hours; neighbours receive nothing', () => {
    const req = getShort(hourlyRows({'2026092416': {r06: 2, pty: 1}, '2026092417': {r06: 4, pty: 1}, '2026092418': {r06: 1, pty: 1}}));
    const s18 = slot(req.short, '20260924', '1800');
    assert.equal(s18.r06, 7); assert.equal(s18.r06Hours, 3); assert.equal(s18.r06Approx, false);
    assert.equal(slot(req.short, '20260924', '1500').r06, 0);
    assert.equal(slot(req.short, '20260924', '2100').r06, 0);
    // adjustShort keeps each slot's own total: no halving, sampling or moving.
    town24h.adjustShort(req, {}, noop);
    assert.deepEqual(['1500', '1800', '2100'].map(t => slot(req.short, '20260924', t).r06), [0, 7, 0]);
    assert.equal(slot(req.short, '20260924', '1800').r06Hours, 3);
});

test('AC1 next-day midnight slot holds 22h, 23h and 00h', () => {
    const req = getShort(hourlyRows({'2026092422': {r06: 1}, '2026092423': {r06: 2}, '2026092500': {r06: 4}, '2026092501': {r06: 8}}));
    assert.equal(slot(req.short, '20260925', '0000').r06, 7);
    assert.equal(slot(req.short, '20260925', '0300').r06, 8);
});

test('AC1 category totals keep bounds and approximation', () => {
    const req = getShort(hourlyRows({'2026092420': {r06: 0.5, r06Text: '1mm 미만'}, '2026092421': {r06: 40, r06Text: '30.0~50.0mm'},
        '2026092510': {s06: 0.5, s06Text: '1cm 미만'}, '2026092511': {s06: 2}}));
    const s21 = slot(req.short, '20260924', '2100');
    assert.equal(s21.r06, 40.5); assert.equal(s21.r06Approx, true); assert.equal(s21.r06Hours, 3);
    const s12 = slot(req.short, '20260925', '1200');
    assert.equal(s12.s06, 2.5); assert.equal(s12.s06Approx, true);
    assert.equal(s12.r06, 0); assert.equal(s12.r06Approx, false);
});

test('AC3 shortest pty 3 slot keeps rain in r06 and s06 is not a x10 rain value', () => {
    const req = getShort(hourlyRows({'2026092412': {s06: 1}}));
    const currentTime = {date: '20260924', time: '0900'};
    const shortest = [10, 11, 12].map((hour, i) => {
        const row = {date: '20260924', time: hour + '00', pty: 3, rn1: [1, 2, 0.5][i], sky: 4, lgt: 0, t1h: 1, reh: 90, uuu: 0, vvv: 0, vec: 0, wsd: 1};
        if (i === 2) row.rn1Text = '1mm 미만';
        return row;
    });
    const p = maybePrecipitation(); // getShortestFromDB does this for stored rows
    if (p) shortest.forEach(row => p.assign(row, 'rn1', p.read(row.rn1, row.rn1Text, 'mm')));
    town24h._mergeShortByShortest(req.short, shortest, undefined, currentTime);
    town24h.adjustShort(req, {}, noop);
    const s12 = slot(req.short, '20260924', '1200');
    assert.equal(s12.pty, 3);
    assert.equal(s12.r06, 3.5); assert.equal(s12.r06Hours, 3); assert.equal(s12.r06Approx, true);
    assert.equal(s12.s06, 1, 'snow comes from SNO, not from rain');
    town24h._convertWeatherData(s12, {});
    assert.equal(s12.s06, 10, 'cm to mm applies to the 1 cm snow only');
    assert.equal(s12.r06, 3.5);
});

test('AC3 shortest slot with a missing hourly rn1 falls back to the PCP total', () => {
    const req = getShort(hourlyRows({'2026092411': {r06: 3, pty: 1}}));
    const shortest = [10, 11, 12].map((hour, i) => ({date: '20260924', time: hour + '00', pty: 1, rn1: i === 1 ? -1 : 0, sky: 4, lgt: 0, t1h: 1, reh: 90, uuu: 0, vvv: 0, vec: 0, wsd: 1}));
    town24h._mergeShortByShortest(req.short, shortest, undefined, {date: '20260924', time: '0900'});
    town24h.adjustShort(req, {}, noop);
    assert.equal(slot(req.short, '20260924', '1200').r06, 3);
});

test('AC6 strings come from the amount or category, not the retired table', () => {
    const exact = {pty: 1, r06: 10};
    town24h._makeStrForKma(exact, {__: s => s});
    assert.equal(exact.r06Str, '10mm');
    assert.notEqual(exact.r06Str, '5~9mm');
    const five = {pty: 1, r06: 5};
    town24h._makeStrForKma(five, {__: s => s});
    assert.equal(five.r06Str, '5mm');
    const dry = {pty: 1, r06: 0, s06: 0};
    town24h._makeStrForKma(dry, {__: s => s});
    assert.equal(dry.r06Str, '0mm'); assert.equal('s06Str' in dry, false, 'no snow text for rain');
    const observed = {pty: 0, rn1: 9}; // past row: observed rn1, no kept total, not precipitating now
    town24h._makeStrForKma(observed, {__: s => s});
    assert.equal('rn1Str' in observed, false, 'no string for a converted observation without pty');
    const p = precipitation();
    const approx = {pty: 1};
    p.assign(approx, 'r06', p.total([p.parse('1mm 미만', 'mm'), p.parse('30.0~50.0mm', 'mm'), p.parse('2mm', 'mm')]));
    town24h._makeStrForKma(approx, {__: s => s});
    assert.equal(approx.r06Str, '32~53mm');
    const open = {pty: 3};
    p.assign(open, 's06', p.total([p.parse('5.0cm 이상', 'cm')]));
    open.s06 *= 10; // convertUnits runs before the strings
    town24h._makeStrForKma(open, {__: s => s});
    assert.equal(open.s06Str, '5~?cm');
    const below = {pty: 3, rn1: 0.5};
    p.assign(below, 'rn1', p.read(0.5, '1mm 미만', 'mm'));
    town24h._makeStrForKma(below, {__: s => s});
    assert.equal(below.rn1Str, '~1mm', 'rn1 is precipitation in mm even for snow');
});

test('AC8 DB 2.0 reads keep the category; shortest rows expose period and approximation', () => {
    const find = rows => ({find: () => ({sort() { return this; }, batchSize() { return this; }, lean() { return this; },
        exec: cb => cb(null, rows)})});
    const pub = new RealDate('2026-09-23T23:00:00Z');
    const ShortCtl = load('controllers/kma/kma.town.short.controller.js', {'../../models/kma/kma.town.short.model.js':
        find([{pubDate: pub, shortData: {date: '20260924', time: '1000', r06: 40, r06Text: '30.0~50.0mm', s06: 0.5, s06Text: '1cm 미만', pty: 1}}])});
    new ShortCtl().getShortFromDB(null, {mx: 60, my: 127}, undefined, (err, info) => {
        assert.ifError(err);
        assert.equal(info.ret[0].r06Text, '30.0~50.0mm'); assert.equal(info.ret[0].s06Text, '1cm 미만');
    });
    const ShortestCtl = load('controllers/kma/kma.town.shortest.controller.js', {'../../models/kma/kma.town.shortest.model.js':
        find([{pubDate: pub, shortestData: {date: '20260924', time: '1000', rn1: 0.5, rn1Text: '1mm 미만', pty: 1}},
            {pubDate: pub, shortestData: {date: '20260924', time: '1100', rn1: 2, pty: 1}}])});
    new ShortestCtl().getShortestFromDB(null, {mx: 60, my: 127}, undefined, (err, info) => {
        assert.ifError(err);
        assert.equal(info.ret[0].rn1, 0.5); assert.equal(info.ret[0].rn1Approx, true); assert.equal(info.ret[0].rn1Hours, 1);
        assert.equal(info.ret[1].rn1Approx, false); assert.equal('rn1Text' in info.ret[0], false);
    });
});

test('AC8 DB 1.0 per-field merge replaces the category with its amount and keeps hourly rows', () => {
    const saved = [];
    const existing = {shortData: [{date: '20260924', time: '1000', pop: 10, pty: 1, r06: 40, r06Text: '30.0~50.0mm', s06: 0, reh: 60, sky: 4, t3h: 20, tmn: -50, tmx: -50, uuu: 0, vvv: 0, wav: -1, vec: 0, wsd: 1}],
        save(cb) { saved.push(this); cb(null); }};
    const Manager = load('controllers/controllerManager.js', {'../models/modelShort': {find: (query, cb) => cb(null, [existing])},
        '../config/config': {keyString: {dongnae_forecast_keys: '[]'}}});
    // The constructor needs production configuration; use the prototype and the declared limit.
    const manager = Object.create(Manager.prototype);
    manager.MAX_SHORT_COUNT = +managerCode.match(/self\.MAX_SHORT_COUNT = (\d+);/)[1];
    const incoming = [];
    for (let hour = 0; hour < 24 * 5; hour++) {
        const d = new RealDate(Date.UTC(2026, 8, 24, 1 + hour));
        incoming.push({date: ymd(d), time: hhmm(d), mx: 60, my: 127, pubDate: '202609240800', pop: 10, pty: 1, r06: 2, s06: 0.5, s06Text: '1cm 미만', reh: 60, sky: 4, t3h: 20, tmn: -50, tmx: -50, uuu: 0, vvv: 0, wav: -1, vec: 0, wsd: 1});
    }
    manager.saveShort(incoming, err => assert.ifError(err));
    assert.equal(saved.length, 1);
    assert.equal(existing.shortData.length, 120, 'hourly rows for five days are kept');
    assert.equal(existing.shortData[0].date + existing.shortData[0].time, '202609240100', 'nearest hours are not truncated');
    const row = existing.shortData.find(r => r.time === '1000' && r.date === '20260924');
    assert.equal(row.r06, 2); assert.equal(row.r06Text, undefined, 'exact amount replaces the old category');
    assert.equal(row.s06Text, '1cm 미만');
});
