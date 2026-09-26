/* Overseas coordinate route smoke on Visual Crossing (#2585).
 * Executes the real v000902/v000903 and v000901 /dsf/coord routers and the widgets'
 * /ww/:version/:category/:days router in process with their complete middleware:
 * DsfController cache/lock/fetch, conversion, local time, merges, units and summary.
 * Mongo models are in-memory; WAQI is replaced by an empty AQI branch; no socket is opened.
 * Default: recorded Visual Crossing fixtures and a fixed clock (2026-09-26 07:04:30 UTC).
 * TW_VC_LIVE=1: the real Visual Crossing requester and VC_SECRET_KEY (from the environment
 * or server/.env), clock starting at the real time; about 25 records per location plus 1 for the stale refresh.
 * Run: TZ=UTC NODE_PATH=/tmp/tw-2585/node_modules node server/test/offline/vc-weather-smoke.js
 * Optional TW_SMOKE_OUTPUT_DIR selects the evidence directory outside the checkout.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const util = require('util');
const v8 = require('v8');
const root = path.resolve(__dirname, '../..');
const live = process.env.TW_VC_LIVE === '1';
const outputDir = process.env.TW_SMOKE_OUTPUT_DIR || path.join(require('os').tmpdir(), 'vc-weather-smoke-output');
fs.mkdirSync(outputDir, {recursive: true});
const clone = value => v8.deserialize(v8.serialize(value));
const RealDate = Date;
const instant = process.env.TW_SMOKE_NOW || '2026-09-26T07:04:30.000Z';
let now = live ? RealDate.now() : RealDate.parse(instant);
class FixedDate extends RealDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
// Live mode starts the fixed clock at the real time so the stale-refresh step can advance it.
const ClockDate = FixedDate;

function liveKey() {
    if (process.env.VC_SECRET_KEY) return process.env.VC_SECRET_KEY;
    const env = path.join(root, '.env');
    return fs.existsSync(env) ? util.parseEnv(fs.readFileSync(env, 'utf8')).VC_SECRET_KEY : undefined;
}
const KEY = live ? liveKey() : 'SMOKESYNTHETICKEY0123456789';
if (live) assert(KEY, 'TW_VC_LIVE=1 needs VC_SECRET_KEY');

const places = [
    {name: 'Tokyo', lat: 35.68, lon: 139.76, fixture: 'tokyo', zone: 'Asia/Tokyo', offset: 540},
    {name: 'London', lat: 51.51, lon: -0.13, fixture: 'london', zone: 'Europe/London', offset: 60},
    {name: 'New York', lat: 40.71, lon: -74.01, fixture: 'newyork', zone: 'America/New_York', offset: -240}
];
const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'vc-' + name + '.json'), 'utf8'));

function createHarness() {
    const logs = [], providerCalls = [], dsfRows = new Map(), locks = new Map(), cache = new Map(), stubbedPackages = new Set();
    const logger = {};
    for (const level of ['info', 'silly', 'debug', 'verbose', 'warn', 'error']) {
        logger[level] = (...args) => { if (level === 'error' || level === 'warn' || /^VC>/.test(String(args[0]))) logs.push({level, args: args.map(a => a && a.stack || a)}); };
    }
    const sandbox = {console, Buffer, URL, URLSearchParams, Date: ClockDate, setTimeout, clearTimeout, setImmediate, setInterval() { throw new Error('Unexpected interval'); }, log: logger, __: s => s};
    sandbox.global = sandbox;
    const context = vm.createContext(sandbox);
    // Key lists parsed at module load by domestic helpers; empty so any use fails visibly.
    const config = {keyString: {vc_key: KEY, daum_keys: '[]', kakao_keys: '[]', dongnae_forecast_keys: '[]', airkorea_keys: '[]', google_key: ''}, db: {version: '2.0'}, serviceServer: {url: 'http://service.invalid'}, apiServer: {url: 'https://synthetic.invalid'},
        url: {requester: 'http://127.0.0.1:1/'}, push: {}, mode: 'service'};
    const dsfModel = {
        find(query) {
            const list = [...dsfRows.values()].filter(r => JSON.stringify(r.geo) === JSON.stringify(query.geo)).map(clone);
            const q = {lean: () => q, sort: () => { list.sort((a, b) => a.dateObj - b.dateObj); return q; }, exec: cb => setImmediate(() => cb(null, list))};
            return q;
        },
        update(query, doc, options, cb) { dsfRows.set(JSON.stringify(query.geo) + '|' + new RealDate(query.dateObj).getTime(), clone(Object.assign({}, doc, query))); setImmediate(() => cb(null)); },
        remove() { return {exec: cb => cb && cb(null)}; }
    };
    const lockModel = {
        create(doc, cb) { setImmediate(() => { if (locks.has(doc._id)) { const e = new Error('E11000 duplicate key'); e.code = 11000; return cb(e); } locks.set(doc._id, doc); cb(null, doc); }); },
        findOneAndUpdate(filter, update, options, cb) { setImmediate(() => { const l = locks.get(filter._id); if (!l || !(l.expireAt < filter.expireAt.$lt)) return cb(null, null); Object.assign(l, update.$set); cb(null, l); }); },
        updateOne(filter, update, cb) { setImmediate(() => { const l = locks.get(filter._id); if (l && (!filter.expireAt || +l.expireAt === +filter.expireAt)) Object.assign(l, update.$set); if (cb) cb(null); }); },
        deleteOne(filter, cb) { setImmediate(() => { const l = locks.get(filter._id); if (l && (!filter.expireAt || +l.expireAt === +filter.expireAt)) locks.delete(filter._id); if (cb) cb(null); }); }
    };
    const emptyModel = () => {
        const q = {lean: () => q, sort: () => q, limit: () => q, exec: cb => cb(null, [])};
        return {find: (a, b, cb) => { if (typeof b === 'function') b(null, []); if (typeof cb === 'function') cb(null, []); return q; }, remove: () => ({exec: cb => cb && cb(null)}), update: (a, b, c, cb) => cb && cb(null)};
    };
    // Fixture requester: serves the recorded response for the coordinates and range.
    function FixtureRequester() {}
    FixtureRequester.prototype.getTimeline = function (params, key, cb) {
        // Route coordinates arrive as strings from the gcode/loc parameter, as in production.
        providerCalls.push({range: params.range, lat: params.lat, lon: params.lon});
        const place = places.find(p => p.lat === Number(params.lat) && p.lon === Number(params.lon));
        if (!place) return setImmediate(() => cb(new Error('no fixture for ' + params.lat + ',' + params.lon)));
        const body = params.range === 'forecast' && place.fixture === 'tokyo' ? fixture('tokyo-forecast') : fixture(place.fixture + '-combined');
        setImmediate(() => cb(null, body));
    };
    function AqiStub() {}
    AqiStub.prototype.removeAqiDb = (geo, cb) => cb();
    AqiStub.prototype.requestAqiData = (geo, a, b, tz, cb) => cb(null, undefined);
    AqiStub.prototype.requestAqiDataFromFeed = (geo, idx, tz, cb) => cb(new Error('no feed'));
    const stubs = {
        'controllerAqi': AqiStub,
        'controllerCollector': function () {},
        'controllerRequester': function () {},
        'timezone.controller': function () { throw new Error('Unexpected Google time zone lookup'); },
        'dsfRequester': function () { throw new Error('Unexpected Dark Sky requester'); },
        // Domestic helpers pulled in by controllerTown24h (summary text); unused on this path.
        'convertGeocode': () => { throw new Error('Unexpected geocode'); },
        'kecoRequester': function () {},
        'kecoController': {},
        'geo.controller': function () {},
        'controllerKmaStnWeather': {},
        'kasi.riseset.controller': {},
        'kma.town.mid.rss.controller': {},
        'kma.forecast.zone.controller': function () {},
        'airkorea.hourly.forecast.controller': function () {},
        'kaq.hourly.forecast.controller': function () {},
        'kma.specialweather.controller': function () {},
        'airkorea.dust.image.controller': function () {}
    };
    function load(filename) {
        if (cache.has(filename)) return cache.get(filename).exports;
        const mod = {exports: {}};
        cache.set(filename, mod);
        function localRequire(id) {
            if (id === 'request') return () => { throw new Error('Unexpected legacy HTTP request'); };
            if (id === 'https') {
                if (live) return require('https');
                return {Agent: function () {}, get() { throw new Error('Unexpected HTTPS request'); }};
            }
            if (id === 'dnscache') return () => ({});
            if (!id.startsWith('.')) {
                // Packages outside the isolated dependency set become stubs that fail on any use.
                try { return require(id); } catch (e) {
                    if (e.code !== 'MODULE_NOT_FOUND') throw e;
                    stubbedPackages.add(id);
                    return new Proxy(function () {}, {get(t, prop) { return prop === 'prototype' ? {} : () => { throw new Error('Unexpected use of ' + id); }; },
                        apply() { throw new Error('Unexpected use of ' + id); }, construct() { throw new Error('Unexpected use of ' + id); }});
                }
            }
            const resolved = path.resolve(path.dirname(filename), id) + (path.extname(id) === '.js' ? '' : '.js');
            if (resolved.endsWith('/config/config.js')) return config;
            const name = path.basename(resolved, '.js');
            if (name === 'dsf.model') return dsfModel;
            if (name === 'vc.fetch.lock.model') return lockModel;
            if (resolved.includes('/models/')) return emptyModel();
            if (name === 'vcRequester') {
                if (!live) return FixtureRequester;
                // Live: the real requester, counting calls like the fixture requester.
                const Real = load(resolved), getTimeline = Real.prototype.getTimeline;
                Real.prototype.getTimeline = function (params, key, cb) {
                    providerCalls.push({range: params.range, lat: params.lat, lon: params.lon});
                    return getTimeline.call(this, params, key, cb);
                };
                return Real;
            }
            if (Object.prototype.hasOwnProperty.call(stubs, name)) return stubs[name];
            return load(resolved);
        }
        const code = fs.readFileSync(filename, 'utf8');
        vm.runInContext('(function(require,module,exports,__filename,__dirname){' + code + '\n})', context, {filename})(localRequire, mod, mod.exports, filename, path.dirname(filename));
        return mod.exports;
    }
    const routers = {
        'v000903': load(path.join(root, 'routes/v000902/route.dsf.coord.v000902.js')),
        'v000901': load(path.join(root, 'routes/v000901/route.dsf.coord.js')),
        'ww': load(path.join(root, 'routes/worldweather/routeWeather.js'))
    };
    function request(kind, place, query) {
        return new Promise((resolve, reject) => {
            const loc = place.lat + ',' + place.lon;
            const url = kind === 'ww' ? '/010000/current/2?gcode=' + loc : '/' + loc;
            const q = Object.assign({}, query, kind === 'ww' ? {gcode: loc} : {});
            const req = {method: 'GET', url, originalUrl: (kind === 'ww' ? '/ww' : '/' + kind + '/dsf') + url, headers: {}, query: q, sessionID: 'vc-smoke'};
            const res = {__: s => s, status(code) { this.statusCode = code; return this; }, send(body) { reject(new Error('Unexpected response ' + this.statusCode + ': ' + body)); },
                json(body) { resolve(JSON.parse(JSON.stringify(body))); }, setHeader() {}};
            routers[kind].handle(req, res, err => reject(err || new Error('No JSON response')));
        });
    }
    return {request, logs, providerCalls, dsfRows, locks, stubbedPackages};
}

function localHourString(epochMs, offsetMin) {
    const d = new RealDate(epochMs + offsetMin * 60000);
    const p = n => String(n).padStart(2, '0');
    return d.getUTCFullYear() + '.' + p(d.getUTCMonth() + 1) + '.' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':00';
}

// The /dsf/coord routes run convertUnits (t1h, reh, dateObj, tmx/tmn); the widgets' /ww route
// returns the merged fields as they are (date string, temp_c/temp_f, humid, tempMax_c/tempMin_c).
function checkBody(body, place, label, units, raw) {
    assert.equal(body.source, 'VC', label + ': source');
    assert(body.pubDate && body.pubDate.VC, label + ': pubDate.VC');
    assert.equal(body.pubDate.DSF, undefined, label + ': no pubDate.DSF');
    assert.doesNotMatch(JSON.stringify(body), /"DSF"/, label + ': no DSF token in the response');
    assert.equal(body.timezone.timezoneId, place.zone, label + ': zone');
    assert.equal(body.timezone.min, place.offset, label + ': offset');
    assert.equal(body.thisTime.length, 2, label + ': yesterday + current');
    const [yesterday, current] = body.thisTime;
    const nowHour = localHourString(now, place.offset);
    const stamp = t => raw ? t.date : t.dateObj;
    assert.equal(stamp(current).slice(0, 13), nowHour.slice(0, 13), label + ': current at request hour (local)');
    if (!raw) assert.equal(current.date, nowHour.slice(0, 10).replace(/\./g, ''), label + ': current local date');
    assert.equal(stamp(yesterday), localHourString(now - 86400000, place.offset), label + ': yesterday same hour');
    const tempOf = t => raw ? (units === 'F' ? t.temp_f : t.temp_c) : t.t1h;
    for (const t of [yesterday, current]) {
        const temp = tempOf(t), humidity = raw ? t.humid : t.reh;
        assert.equal(typeof temp, 'number', label + ': temperature');
        assert(temp > -40 && temp < (units === 'F' ? 130 : 55), label + ': plausible temperature ' + temp);
        assert(humidity >= 0 && humidity <= 100, label + ': humidity percent ' + humidity);
        assert(Number.isInteger(t.weatherType) && t.weatherType >= 0, label + ': known weatherType ' + t.weatherType);
    }
    // Only the current entry gets a sky icon (mergeDsfCurrentDataNewForm); yesterday never had one.
    assert.equal(typeof current.skyIcon, 'string', label + ': current sky icon');
    if (!raw) assert.equal(typeof current.summary, 'string', label + ': summary');
    assert(body.hourly.length >= 20, label + ': hourly rows ' + body.hourly.length);
    assert(body.daily.length >= 9, label + ': daily rows ' + body.daily.length);
    for (const d of body.daily) {
        const max = raw ? d.tempMax_c : d.tmx, min = raw ? d.tempMin_c : d.tmn;
        assert(typeof max === 'number' && typeof min === 'number' && max >= min, label + ': daily max/min ' + d.date);
        assert(d.sunrise && d.sunset, label + ': sunrise/sunset ' + d.date);
    }
    assert.equal(body.units.temperatureUnit, units);
    // _parseData maps 0 to the -100 "missing" sentinel; it must not reach clients as a value
    // (north wind 0°, calm days, clear days). Ozone keeps its legacy -100 (no provider value).
    const leaks = [];
    (function scan(value, where) {
        if (value && typeof value === 'object') return Object.keys(value).forEach(k => scan(value[k], where + '.' + k));
        if (typeof value === 'number' && value <= -99 && !/\.oz$|^\.timezone\./.test(where)) leaks.push(where + '=' + value);
    })(body, '');
    assert.deepEqual(leaks, [], label + ': sentinel values in the response');
}

async function main() {
    const output = [];
    const h = createHarness();
    for (const place of places) {
        for (const [kind, units] of [['v000903', 'C'], ['v000901', 'F'], ['ww', 'C']]) {
            const before = h.providerCalls.length;
            const body = await h.request(kind, place, {temperatureUnit: units, windSpeedUnit: 'm/s'});
            const label = place.name + ' ' + kind;
            fs.writeFileSync(path.join(outputDir, 'vc-' + place.fixture + '-' + kind + '.json'), JSON.stringify(body, null, 2));
            checkBody(body, place, label, units, kind === 'ww');
            const calls = h.providerCalls.slice(before).map(c => c.range);
            assert.deepEqual(calls, kind === 'v000903' ? ['combined'] : [], label + ': provider calls ' + JSON.stringify(calls));
            fs.writeFileSync(path.join(outputDir, 'vc-' + place.fixture + '-' + kind + '.json'), JSON.stringify(body, null, 2));
            output.push({place: place.name, kind, units, providerCalls: calls, thisTime: body.thisTime.map(t => ({date: t.dateObj || t.date, temp: t.t1h === undefined ? t.temp_c : t.t1h, humidity: t.reh === undefined ? t.humid : t.reh, desc: t.desc, weatherType: t.weatherType})),
                hourly: body.hourly.length, daily: body.daily.length, pubDate: body.pubDate, source: body.source});
        }
    }
    // 20 minutes later the current record is stale: one forecast-only call; yesterday is reused.
    now += 20 * 60000;
    const tokyo = places[0];
    const before = h.providerCalls.length;
    const body = await h.request('v000903', tokyo, {temperatureUnit: 'C'});
    checkBody(body, tokyo, 'Tokyo stale refresh', 'C');
    const refresh = h.providerCalls.slice(before).map(c => c.range);
    assert.deepEqual(refresh, ['forecast'], 'stale current → forecast-only');
    output.push({place: tokyo.name, kind: 'v000903 +20 min', providerCalls: refresh});
    await new Promise(resolve => setImmediate(resolve)); // lock release is fire-and-forget
    assert.equal(h.locks.size, 0, 'no lock left behind');
    const programming = h.logs.filter(x => x.args.some(a => typeof a === 'string' && /TypeError|ReferenceError|AssertionError/.test(a)));
    assert.deepEqual(programming, [], 'no swallowed programming exceptions');
    const vcLines = h.logs.filter(x => /^VC>/.test(String(x.args[0]))).map(x => String(x.args[0]));
    assert(!vcLines.some(l => l.includes(KEY)), 'key not logged');
    const report = {createdAt: new RealDate().toISOString(), mode: live ? 'live' : 'fixture', clock: new RealDate(now).toISOString(), hostTimezone: process.env.TZ || 'system',
        outcome: 'passed', stubbedPackages: [...h.stubbedPackages].sort(), providerCalls: h.providerCalls.length, storedRecords: h.dsfRows.size, vcLog: vcLines, scenarios: output,
        warnings: h.logs.filter(x => x.level !== 'info').map(x => x.level + ': ' + String(x.args[0]).split('\n')[0].slice(0, 160))};
    fs.writeFileSync(path.join(outputDir, 'vc-weather-evidence' + (live ? '-live' : '') + '.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({outcome: report.outcome, mode: report.mode, scenarios: output.length, providerCalls: report.providerCalls, vcLog: vcLines, evidence: outputDir}, null, 2));
}
main().catch(err => { console.error(err.stack); process.exitCode = 1; });
