/* Overseas coordinate route smoke on Visual Crossing (#2585).
 * Executes the real v000902/v000903 and v000901 /dsf/coord routers and the widgets'
 * /ww/:version/:category/:days router in process with their complete middleware:
 * DsfController cache/lock/fetch, conversion, local time, merges, units and summary.
 * Mongo models are in-memory; WAQI is replaced by an empty AQI branch; no socket is opened.
 * Default: recorded Visual Crossing fixtures and a fixed clock (2026-09-26 07:04:30 UTC).
 * TW_VC_LIVE=1: the real Visual Crossing requester and VC_SECRET_KEY (from the environment
 * or server/.env), clock starting at the real time; about 25 records per location plus 1 for the stale refresh.
 * Run: TZ=UTC NODE_PATH=/tmp/tw-2585/node_modules node server/test/offline/vc-weather-smoke.js
 * Optional TW_SMOKE_OUTPUT_DIR selects the evidence directory outside the checkout (default: a new temp dir).
 * Fixture mode also runs synthetic scenarios (vc-synthetic.js): DST sequences with stored records
 * (London end, Auckland start, New York end), +5:30/+5:45/+14/-11/-2:30 zones, calm/clear days,
 * missing fields, polar days, missing currentConditions and precipitation types, exact unit
 * conversions, the three apps' parsers and the push/alert consumers of a VC response.
 * The recorded fixtures cover 2026-09-26 ~04:05-14:49 UTC; TW_SMOKE_NOW outside that fails.
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
const outputDir = process.env.TW_SMOKE_OUTPUT_DIR || fs.mkdtempSync(path.join(require('os').tmpdir(), 'vc-weather-smoke-'));
fs.mkdirSync(outputDir, {recursive: true});
const {syntheticTimeline, localParts} = require('./vc-synthetic');
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
    if (!fs.existsSync(env)) return undefined;
    // util.parseEnv needs Node >= 21; a minimal KEY=value reader keeps Node 16 working.
    const line = fs.readFileSync(env, 'utf8').split('\n').find(l => /^\s*VC_SECRET_KEY\s*=/.test(l));
    return line ? line.replace(/^\s*VC_SECRET_KEY\s*=\s*/, '').trim().replace(/^(['"])(.*)\1$/, '$2') : undefined;
}
const KEY = live ? liveKey() : 'SMOKESYNTHETICKEY0123456789';
if (live) assert(KEY, 'TW_VC_LIVE=1 needs VC_SECRET_KEY');

const places = [
    {name: 'Tokyo', lat: 35.68, lon: 139.76, fixture: 'tokyo', zone: 'Asia/Tokyo', offset: 540},
    {name: 'London', lat: 51.51, lon: -0.13, fixture: 'london', zone: 'Europe/London', offset: 60},
    {name: 'New York', lat: 40.71, lon: -74.01, fixture: 'newyork', zone: 'America/New_York', offset: -240}
];
const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'vc-' + name + '.json'), 'utf8'));

function createHarness(bodyFor) {
    const logs = [], providerCalls = [], dsfRows = new Map(), locks = new Map(), cache = new Map(), stubbedPackages = new Set();
    const logger = {};
    for (const level of ['info', 'silly', 'debug', 'verbose', 'warn', 'error']) {
        logger[level] = (...args) => { if (level === 'error' || level === 'warn' || /^VC>/.test(String(args[0]))) logs.push({level, args: args.map(a => a && a.stack || a)}); };
    }
    const sandbox = {console, Buffer, URL, URLSearchParams, Date: ClockDate, setTimeout, clearTimeout, setImmediate, setInterval() { throw new Error('Unexpected interval'); }, log: logger, __: s => s,
        // kmaTimeLib formats push times through the global manager (as in rss-response-smoke).
        manager: {leadingZeros: (n, l) => String(n).padStart(l, '0')}};
    sandbox.global = sandbox;
    const context = vm.createContext(sandbox);
    // Key lists parsed at module load by domestic helpers; empty so any use fails visibly.
    const config = {vc: {dailyRecordLimit: 0}, keyString: {vc_key: KEY, daum_keys: '[]', kakao_keys: '[]', dongnae_forecast_keys: '[]', airkorea_keys: '[]', google_key: ''}, db: {version: '2.0'}, serviceServer: {url: 'http://service.invalid'}, apiServer: {url: 'https://synthetic.invalid'},
        url: {requester: 'http://127.0.0.1:1/'}, push: {}, mode: 'service'};
    const dsfModel = {
        find(query) {
            const since = query.dateObj && query.dateObj.$gte;
            const list = [...dsfRows.values()].filter(r => JSON.stringify(r.geo) === JSON.stringify(query.geo) && (!since || r.dateObj >= since)).map(clone);
            const q = {lean: () => q, sort: () => { list.sort((a, b) => a.dateObj - b.dateObj); return q; }, exec: cb => setImmediate(() => cb(null, list))};
            return q;
        },
        update(query, doc, options, cb) { dsfRows.set(JSON.stringify(query.geo) + '|' + new RealDate(query.dateObj).getTime(), clone(Object.assign({}, doc, query))); setImmediate(() => cb(null)); },
        remove() { return {exec: cb => cb && cb(null)}; }
    };
    const lockModel = {
        create(doc, cb) { setImmediate(() => { if (locks.has(doc._id)) { const e = new Error('E11000 duplicate key'); e.code = 11000; return cb(e); } locks.set(doc._id, doc); cb(null, doc); }); },
        findOneAndUpdate(filter, update, options, cb) { setImmediate(() => { const l = locks.get(filter._id); if (!l || !(l.expireAt < filter.expireAt.$lt)) return cb(null, null); Object.assign(l, update.$set); cb(null, l); }); },
        updateOne(filter, update, options, cb) {
            if (typeof options === 'function') { cb = options; options = {}; }
            setImmediate(() => { let l = locks.get(filter._id); if (!l && options.upsert) { l = {_id: filter._id}; locks.set(filter._id, l); } if (l && (!filter.expireAt || +l.expireAt === +filter.expireAt)) Object.assign(l, update.$set); if (cb) cb(null); });
        },
        deleteOne(filter, cb) { setImmediate(() => { const l = locks.get(filter._id); if (l && (!filter.expireAt || +l.expireAt === +filter.expireAt)) locks.delete(filter._id); if (cb) cb(null); }); }
    };
    lockModel.findById = (id, cb) => setImmediate(() => cb(null, locks.has(id) ? Object.assign({}, locks.get(id)) : null));
    const usage = new Map();
    const usageModel = {
        updateOne(filter, update, options, cb) { setImmediate(() => { const d = usage.get(filter._id) || {_id: filter._id}; for (const k of Object.keys(update.$inc || {})) d[k] = (d[k] || 0) + update.$inc[k]; usage.set(filter._id, d); if (cb) cb(null); }); },
        findById(id, cb) { setImmediate(() => cb(null, usage.get(id) || null)); }
    };
    const emptyModel = () => {
        const q = {lean: () => q, sort: () => q, limit: () => q, exec: cb => cb(null, [])};
        return {find: (a, b, cb) => { if (typeof b === 'function') b(null, []); if (typeof cb === 'function') cb(null, []); return q; }, remove: () => ({exec: cb => cb && cb(null)}), update: (a, b, c, cb) => cb && cb(null)};
    };
    // Fixture requester: serves the recorded response for the coordinates and range.
    function FixtureRequester() {}
    FixtureRequester.isValidKey = key => typeof key === 'string' && key.length >= 10;
    FixtureRequester.prototype.getTimeline = function (params, key, cb) {
        // Route coordinates arrive as strings from the gcode/loc parameter, as in production.
        providerCalls.push({range: params.range, lat: params.lat, lon: params.lon});
        if (bodyFor) {
            const body = bodyFor(params);
            return setImmediate(() => cb(null, body, {status: 200, cost: body.queryCost, ms: 1}));
        }
        const place = places.find(p => p.lat === Number(params.lat) && p.lon === Number(params.lon));
        if (!place) return setImmediate(() => cb(new Error('no fixture for ' + params.lat + ',' + params.lon)));
        const body = params.range === 'forecast' && place.fixture === 'tokyo' ? fixture('tokyo-forecast') : fixture(place.fixture + '-combined');
        setImmediate(() => cb(null, body, {status: 200, cost: body.queryCost, ms: 1}));
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
            // controllerPush constructs a GCM sender at load; sending is never reached here.
            if (id === 'node-gcm') return {Sender: function () { this.send = () => { throw new Error('Unexpected push send'); }; }, Message: function () {}};
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
            if (name === 'vc.usage.model') return usageModel;
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
    return {request, logs, providerCalls, dsfRows, locks, usage, stubbedPackages, load};
}

function localHourString(epochMs, offsetMin) {
    const d = new RealDate(epochMs + offsetMin * 60000);
    const p = n => String(n).padStart(2, '0');
    return d.getUTCFullYear() + '.' + p(d.getUTCMonth() + 1) + '.' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':00';
}

// The /dsf/coord routes run convertUnits (t1h, reh, dateObj, tmx/tmn); the widgets' /ww route
// returns the merged fields as they are (date string, temp_c/temp_f, humid, tempMax_c/tempMin_c).
function checkBody(body, place, label, units, raw, opts) {
    opts = opts || {};
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
    // Known limitation (N2): on the day after a DST change the fixed display offset can hide the
    // yesterday row for the first local hour; those steps check the rest of the body.
    if (!opts.skipYesterdayHour) assert.equal(stamp(yesterday), localHourString(now - 86400000, place.offset), label + ': yesterday same hour');
    const tempOf = t => raw ? (units === 'F' ? t.temp_f : t.temp_c) : t.t1h;
    for (const t of opts.skipYesterdayHour ? [current] : [yesterday, current]) {
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
        for (const k of ['sunrise', 'sunset']) {
            if (opts.polar) assert.equal(d[k], undefined, label + ': no ' + k + ' on a polar day');
            else assert.match(String(d[k]), /^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}$/, label + ': ' + k + ' ' + d.date);
        }
    }
    assert.equal(body.units.temperatureUnit, units);
    // _parseData maps 0 to the -100 "missing" sentinel; it must not reach clients as a value
    // (north wind 0°, calm days, clear days). Ozone keeps its legacy -100 (no provider value).
    for (const row of body.hourly) assert(Number.isInteger(row.weatherType) && row.weatherType >= 0, label + ': hourly weatherType ' + row.date + ' ' + row.weatherType);
    const leaks = [];
    (function scan(value, where) {
        if (value && typeof value === 'object') return Object.keys(value).forEach(k => scan(value[k], where + '.' + k));
        if (typeof value === 'number' && value <= -99 && !/\.oz$|^\.timezone\./.test(where)) leaks.push(where + '=' + value);
        if (typeof value === 'string' && /NaN|Invalid Date/.test(value)) leaks.push(where + '=' + value);
        // -100 °F converted to Celsius.
        if (value === -73.3 && /(t1h|t3h|tmx|tmn|sensorytem|temp_c|ftemp_c|[Mm]ax_c|[Mm]in_c)$/.test(where)) leaks.push(where + '=' + value);
    })(body, '');
    assert.deepEqual(leaks, [], label + ': sentinel values in the response');
}

// ------------------------------------------------------------ synthetic scenarios (fixture mode)
function zoneOffset(zone, ms) {
    const l = localParts(zone)(Math.floor(ms / 1000));
    return Math.round((Date.parse(l.date + 'T' + String(l.hour).padStart(2, '0') + ':' + String(l.minute).padStart(2, '0') + ':00Z') - Math.floor(ms / 60000) * 60000) / 60000);
}
// Local calendar date, shifted by whole calendar days (not 24 h, which crosses DST wrongly).
function localDay(zone, ms, shiftDays) {
    const day = localParts(zone)(Math.floor(ms / 1000)).date;
    return new RealDate(Date.parse(day + 'T00:00:00Z') + (shiftDays || 0) * 86400000).toISOString().slice(0, 10);
}
// Bodies the way Visual Crossing builds them for the requested range at the harness clock.
function syntheticProvider(zone, options) {
    return params => params.range === 'combined'
        ? syntheticTimeline(zone, localDay(zone, now, -1), 9, Object.assign({now}, options))
        : syntheticTimeline(zone, localDay(zone, now), 8, Object.assign({now}, options));
}

async function runScenario(output, name, zone, lat, lon, steps, options) {
    options = options || {};
    const h = createHarness(syntheticProvider(zone, options.body));
    for (const step of steps) {
        now = Date.parse(step.at);
        const place = {name, lat, lon, zone, offset: zoneOffset(zone, now)};
        const before = h.providerCalls.length;
        const bodies = {};
        for (const [kind, units] of step.kinds || [['v000903', 'C']]) {
            const label = name + ' ' + step.at + ' ' + kind;
            const body = bodies[kind] = await h.request(kind, place, {temperatureUnit: units, windSpeedUnit: 'm/s'});
            if (process.env.VC_SMOKE_DEBUG) console.error(label, JSON.stringify({calls: h.providerCalls.slice(before).map(c => c.range), daily: body.daily.map(d => d.date), thisTime: body.thisTime.map(t => t.dateObj), tz: body.timezone}));
            checkBody(body, place, label, units, kind === 'ww', {skipYesterdayHour: step.skipYesterdayHour, polar: options.polar});
        }
        const calls = h.providerCalls.slice(before).map(c => c.range);
        if (step.calls) assert.deepEqual(calls, step.calls, name + ' ' + step.at + ': provider calls');
        if (step.check) step.check(bodies, place);
        output.push({scenario: name, at: step.at, offset: place.offset, providerCalls: calls,
            thisTime: bodies.v000903 && bodies.v000903.thisTime.map(t => (t.dateObj || '-') + ' ' + t.t1h + ' ' + t.desc)});
    }
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual([...h.locks.keys()].filter(k => k !== '~provider'), [], name + ': no lock left behind');
    const programming = h.logs.filter(x => x.args.some(a => typeof a === 'string' && /TypeError|ReferenceError|AssertionError/.test(a)));
    assert.deepEqual(programming, [], name + ': no swallowed programming exceptions');
    return h;
}

async function syntheticScenarios(output) {
    const at20 = t => new RealDate(Date.parse(t) + 20 * 60000).toISOString();
    // I-F1: London (UTC+0 after the change) on the day BST ends; records stored before the change.
    await runScenario(output, 'London DST end', 'Europe/London', 51.51, -0.13, [
        {at: '2026-10-24T12:00:00Z', calls: ['combined']},
        {at: '2026-10-25T00:30:00Z', calls: ['combined']},          // 01:30 BST: records stored at +1
        {at: '2026-10-25T01:30:00Z', calls: ['forecast']},          // 01:30 GMT: current at 0, others at +1
        {at: '2026-10-25T10:00:00Z', calls: ['forecast'], kinds: [['v000903', 'C'], ['v000901', 'F'], ['ww', 'C']]},
        {at: '2026-10-25T22:00:00Z', calls: ['forecast']},
        {at: '2026-10-26T00:30:00Z', calls: ['combined'], skipYesterdayHour: true},
        {at: '2026-10-26T02:00:00Z', calls: ['forecast']}
    ]);
    // T1: Auckland spring-forward with stored records; the 00:30 request must see 09-27 as yesterday.
    await runScenario(output, 'Auckland DST start', 'Pacific/Auckland', -36.85, 174.76, [
        {at: '2026-09-26T13:30:00Z', calls: ['combined']},
        {at: '2026-09-27T00:00:00Z', calls: ['forecast']},
        {at: '2026-09-27T11:30:00Z', calls: ['combined'], skipYesterdayHour: true,
            check: b => assert.equal(b.v000903.daily[0].date, '20260927', 'first daily row is yesterday 09-27')},
        {at: '2026-09-27T13:00:00Z', calls: ['forecast']}
    ]);
    // T12: New York fall-back: one combined per local day, no extra call.
    await runScenario(output, 'New York DST end', 'America/New_York', 40.71, -74.01, [
        {at: '2026-11-01T03:00:00Z', calls: ['combined']},
        {at: '2026-11-02T04:30:00Z', calls: ['combined']},
        {at: '2026-11-02T05:10:00Z', calls: ['combined'], skipYesterdayHour: true},
        {at: '2026-11-02T06:10:00Z', calls: ['forecast']}
    ]);
    // D13: half-hour, 45-minute and date-line zones.
    for (const [name, zone, lat, lon] of [['Delhi', 'Asia/Kolkata', 28.61, 77.21], ['Kathmandu', 'Asia/Kathmandu', 27.72, 85.32],
        ['Kiritimati', 'Pacific/Kiritimati', 1.87, -157.36], ['Pago Pago', 'Pacific/Pago_Pago', -14.28, -170.7], ["St. John's", 'America/St_Johns', 47.56, -52.71]]) {
        await runScenario(output, name, zone, lat, lon, [
            {at: '2026-09-26T07:04:30Z', calls: ['combined'], kinds: [['v000903', 'C'], ['v000901', 'F'], ['ww', 'C']]},
            {at: at20('2026-09-26T07:04:30Z'), calls: ['forecast']}
        ]);
    }
    const berlin = ['Europe/Berlin', 52.52, 13.40];
    const one = [{at: '2026-09-26T07:04:30Z', calls: ['combined'], kinds: [['v000903', 'C'], ['v000901', 'F'], ['ww', 'C']]}];
    // T2: calm, clear, north wind: daily cloud/wind and wind direction stay real values.
    await runScenario(output, 'Calm clear', ...berlin, one, {body: {
        hour: () => ({cloudcover: 0, windspeed: 0, winddir: 0, conditions: 'Clear', icon: 'clear-day'}),
        day: () => ({cloudcover: 0, windspeed: 0, winddir: 0, conditions: 'Clear', icon: 'clear-day'})}});
    // I-F4: fields Visual Crossing omits (null) never surface as -100.
    await runScenario(output, 'Missing fields', ...berlin, one, {body: {
        hour: row => (row.datetimeEpoch / 3600) % 2 === 0 ? {pressure: null, winddir: null, humidity: null, visibility: null, feelslike: null, temp: null} : {},
        day: () => ({pressure: null, winddir: null}),
        current: {temp: 55, feelslike: null, pressure: null}}});
    // T5: precipitation types through the whole route.
    await runScenario(output, 'Precipitation types', ...berlin, one, {body: {hour: row => {
        const h = Number(row.datetime.slice(0, 2));
        if (h === 2) return {preciptype: ['snow'], precip: 0.5, snow: 4, icon: 'snow', conditions: 'Snow'};
        if (h === 5) return {preciptype: ['ice'], precip: 0.05, icon: 'rain', conditions: 'Ice'};
        if (h === 8) return {visibility: 0.3, icon: 'fog', conditions: 'Fog'};
        if (h === 11) return {preciptype: ['rain'], precip: 0.2, icon: 'rain', conditions: 'Thunderstorm, Rain'};
        if (h >= 20) return {preciptype: ['rain', 'snow'], precipprob: 70, precip: 0, icon: 'rain', conditions: 'Rain, Snow'};
        return {};
    }}});
    // T9: no currentConditions in the body.
    await runScenario(output, 'Missing currentConditions', ...berlin, one, {body: {current: false}});
    // T3: polar day: no sunrise or sunset.
    now = Date.parse('2026-06-21T12:00:00Z');
    await runScenario(output, 'Polar day', 'Arctic/Longyearbyen', 78.22, 15.65,
        [{at: '2026-06-21T12:00:00Z', calls: ['combined'], kinds: [['v000903', 'C'], ['v000901', 'F'], ['ww', 'C']]}], {polar: true, body: {polar: true}});
}

// T8/T11/T10: exact conversions, sky icon case, the apps' parsers and the push consumers of a VC response.
function checkConsumers(h, bodies) {
    const ny = bodies['newyork-v000903'], nyF = bodies['newyork-v000901'], cur = fixture('newyork-combined').currentConditions;
    assert.equal(ny.thisTime[1].t1h, parseFloat(((cur.temp - 32) / 1.8).toFixed(1)), 'current °C from the fixture');
    assert.equal(nyF.thisTime[1].t1h, cur.temp, 'current °F from the fixture');
    assert.equal(ny.thisTime[1].wsd, parseFloat((cur.windspeed * 0.44704).toFixed(2)), 'wind m/s from mph');
    assert.equal(ny.thisTime[1].reh, Math.round(cur.humidity), 'humidity percent');
    for (const [key, pattern] of [['tokyo-v000903', /^[a-z_]+$/], ['tokyo-v000901', /^[A-Z][A-Za-z]*$/], ['tokyo-ww', /^[A-Z][A-Za-z]*$/]]) {
        assert.match(bodies[key].thisTime[1].skyIcon, pattern, key + ' sky icon case');
    }
    const units = {temperatureUnit: 'C', windSpeedUnit: 'm/s', pressureUnit: 'hPa', distanceUnit: 'km', precipitationUnit: 'mm', airUnit: 'airkorea'};
    const Units = {getUnit: k => units[k], convertUnits: (a, b, v) => v, getDefaultUnits: () => Object.assign({}, units)};
    const app = file => {
        let converter;
        const ctx = {angular: {module: () => ({factory: (n, f) => { converter = f({}, () => { throw new Error('Network disabled'); },
            {ga: {trackEvent() {}, trackException(e) { throw e; }}}, Units); }})}, console: {log() {}, info() {}, warn() {}, error() {}},
            clientConfig: {debug: false}, alert: m => { throw new Error('app alert: ' + m); }};
        vm.runInNewContext(fs.readFileSync(path.join(root, '..', file), 'utf8'), ctx);
        return converter;
    };
    const apps = {};
    for (const [file, key] of [['client/www/js/service.weatherutil.js', 'tokyo-v000903'], ['ta.ios/www/js/service.weatherutil.js', 'tokyo-v000903'], ['tw.ios/www/js/service.weatherutil.js', 'tokyo-ww']]) {
        const data = app(file).convertWeatherData([{data: JSON.parse(JSON.stringify(bodies[key]))}]);
        assert(data && data.currentWeather, file + ': parsed');
        assert.equal(data.source, 'VC', file + ': overseas source detected from pubDate.VC');
        assert.equal(typeof data.currentWeather.t1h, 'number', file + ': current temperature');
        apps[file] = {source: data.source, t1h: data.currentWeather.t1h};
    }
    // Push: the daily summary text and the alert parser run on a real v000902/v000903 VC body.
    const Push = h.load(path.join(root, 'controllers/controllerPush.js'));
    const push = new Push();
    const msg = push._makeDsfPushMessage({name: 'Tokyo', lang: 'en', package: 'todayWeather', units, source: 'VC'}, JSON.parse(JSON.stringify(bodies['tokyo-v000903'])));
    assert(msg && typeof msg.title === 'string' && msg.title.length > 6 && /\d/.test(msg.title + msg.text), 'daily push text: ' + JSON.stringify(msg));
    const Alert = h.load(path.join(root, 'controllers/alert.push.controller.js'));
    const alert = new Alert();
    alert.time = 7 * 3600 + 50 * 60;
    const info = alert._parseWeatherAirData({source: 'VC', lang: 'en', units}, JSON.parse(JSON.stringify(bodies['newyork-v000903'])));
    assert(info && info.weather, 'alert parser returns the weather part');
    assert(info.weather.pty > 0, 'observed rain in New York is precipitation');
    assert.equal(info.weather.rns, true, 'observed rain flagged for the alert');
    return {apps, push: msg, alert: {pty: info.weather.pty, rns: info.weather.rns}};
}

async function main() {
    const output = [];
    const h = createHarness();
    const bodies = {};
    for (const place of places) {
        for (const [kind, units] of [['v000903', 'C'], ['v000901', 'F'], ['ww', 'C']]) {
            const before = h.providerCalls.length;
            const body = await h.request(kind, place, {temperatureUnit: units, windSpeedUnit: 'm/s'});
            const label = place.name + ' ' + kind;
            fs.writeFileSync(path.join(outputDir, 'vc-' + place.fixture + '-' + kind + '.json'), JSON.stringify(body, null, 2));
            checkBody(body, place, label, units, kind === 'ww');
            bodies[place.fixture + '-' + kind] = body;
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
    let consumers;
    if (!live) {
        consumers = checkConsumers(h, bodies);
        await syntheticScenarios(output);
    }
    const vcLines = h.logs.filter(x => /^VC>/.test(String(x.args[0]))).map(x => String(x.args[0]));
    assert(!vcLines.some(l => l.includes(KEY)), 'key not logged');
    const report = {createdAt: new RealDate().toISOString(), mode: live ? 'live' : 'fixture', clock: new RealDate(now).toISOString(), hostTimezone: process.env.TZ || 'system',
        outcome: 'passed', consumers, usage: [...h.usage.values()], stubbedPackages: [...h.stubbedPackages].sort(), providerCalls: h.providerCalls.length, storedRecords: h.dsfRows.size, vcLog: vcLines, scenarios: output,
        warnings: h.logs.filter(x => x.level !== 'info').map(x => x.level + ': ' + String(x.args[0]).split('\n')[0].slice(0, 160))};
    fs.writeFileSync(path.join(outputDir, 'vc-weather-evidence' + (live ? '-live' : '') + '.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({outcome: report.outcome, mode: report.mode, scenarios: output.length, providerCalls: report.providerCalls, vcLog: vcLines, evidence: outputDir}, null, 2));
}
main().catch(err => { console.error(err.stack); process.exitCode = 1; });
