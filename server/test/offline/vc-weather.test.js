/* Overseas weather on Visual Crossing instead of Dark Sky (#2585).
 * Run with Node >=16.20.2 and async on NODE_PATH:
 *   TZ=UTC NODE_PATH=/tmp/tw-2585/node_modules node server/test/offline/vc-weather.test.js
 * Loads production modules in an isolated VM. HTTPS, models and config are stubs;
 * no app startup, provider call, Mongo or background timer is reachable.
 * fixtures/vc-*.json are live Visual Crossing Timeline responses recorded on
 * 2026-09-26 07:04:23-24 UTC (unitGroup=us, include=days,hours,current, the
 * production elements list; the key is not in the bodies).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const async = require('async');
const root = path.resolve(__dirname, '../..');
const repo = path.resolve(root, '..');
const logs = [];
const log = Object.fromEntries(['info', 'warn', 'error', 'debug', 'verbose', 'silly'].map(k => [k, (...args) => logs.push({level: k, args})]));
const KEY = 'SYNTHETICKEY0123456789ABCD';
const CAPTURED = Date.parse('2026-09-26T07:04:23Z');
const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'vc-' + name + '.json'), 'utf8'));
// VM results carry the sandbox realm's prototypes; compare them as plain JSON values.
const plain = value => value === undefined ? value : JSON.parse(JSON.stringify(value));
// Lock release is fire-and-forget after the response; let its model callback run.
const settle = () => new Promise(resolve => setImmediate(resolve));
const logText = () => logs.map(l => l.args.map(a => a && a.stack || String(a)).join(' ')).join('\n');

function Stub() {}
function load(relative, dependencies = {}, globals = {}) {
    const module = {exports: {}};
    const sandbox = Object.assign({module, exports: module.exports, console, log, Date, setTimeout, clearTimeout, setImmediate,
        require: name => {
            if (Object.prototype.hasOwnProperty.call(dependencies, name)) return dependencies[name];
            throw new Error('Unstubbed dependency ' + name + ' in ' + relative);
        }}, globals);
    sandbox.global = sandbox;
    vm.runInNewContext(fs.readFileSync(path.join(root, relative), 'utf8'), sandbox, {filename: relative});
    return module.exports;
}

const kmaTimeLib = load('lib/kmaTimeLib.js');
const WeatherDesc = load('controllers/controller.weather.desc.js');
const vcConverter = () => load('lib/VC/vcConverter.js');

// ---------------------------------------------------------------- requester
// Fake https: each handler(url, n) returns {status, body, delay?}, 'hang' or an Error.
function fakeHttps(handler) {
    const calls = [];
    return {
        calls,
        Agent: function (options) { this.options = options; },
        get(url, options, onResponse) {
            calls.push({url, options});
            const req = new EventEmitter();
            req.destroy = err => { req.destroyed = err || true; };
            const result = handler(url, calls.length);
            setTimeout(() => {
                if (result === 'hang' || req.destroyed) return;
                if (result instanceof Error) return req.emit('error', result);
                const res = new EventEmitter();
                res.statusCode = result.status;
                res.setEncoding = () => {};
                onResponse(res);
                res.emit('data', typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
                res.emit('end');
            }, (result && result.delay) || 0);
            return req;
        }
    };
}
function loadRequester(https) {
    return load('lib/VC/vcRequester.js', {https});
}
const timeline = (Requester, options, params, key) => new Promise(resolve =>
    new Requester(options).getTimeline(params, key, (err, body) => resolve({err, body})));

test('requester builds the Timeline request and logs cost and latency without the key', async () => {
    const https = fakeHttps(() => ({status: 200, body: fixture('tokyo-combined')}));
    const Requester = loadRequester(https);
    logs.length = 0;
    const {err, body} = await timeline(Requester, {}, {lat: 35.68, lon: 139.76, range: 'combined'}, KEY);
    assert.ifError(err);
    assert.equal(body.queryCost, 25);
    const url = new URL(https.calls[0].url);
    assert.equal(url.origin + url.pathname, 'https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/35.68,139.76/yesterday/next7days');
    assert.equal(url.searchParams.get('unitGroup'), 'us');
    assert.equal(url.searchParams.get('lang'), 'en');
    assert.equal(url.searchParams.get('include'), 'days,hours,current');
    assert.equal(url.searchParams.get('key'), KEY);
    for (const e of ['datetimeEpoch', 'temp', 'feelslike', 'humidity', 'precip', 'precipprob', 'preciptype', 'windspeed', 'winddir',
        'pressure', 'visibility', 'cloudcover', 'conditions', 'icon', 'source', 'sunriseEpoch', 'sunsetEpoch', 'moonphase', 'tempmax', 'tempmin']) {
        assert(url.searchParams.get('elements').split(',').includes(e), 'element ' + e);
    }
    assert.equal(https.calls[0].options.agent.options.keepAlive, true, 'keep-alive agent');
    const forecast = fakeHttps(() => ({status: 200, body: fixture('tokyo-forecast')}));
    await timeline(loadRequester(forecast), {}, {lat: 35.68, lon: 139.76, range: 'forecast'}, KEY);
    assert.match(forecast.calls[0].url, /timeline\/35\.68,139\.76\/today\/next7days\?/);
    assert.match(logText(), /VC> .*combined.*status=200.*cost=25.*ms=\d+/);
    assert.doesNotMatch(logText(), new RegExp(KEY));
});

test('requester rejects a missing or placeholder key and bad input before any network call', async () => {
    const https = fakeHttps(() => { throw new Error('network'); });
    const Requester = loadRequester(https);
    for (const key of [undefined, '', 'You have to set key of Visual Crossing']) {
        const {err} = await timeline(Requester, {}, {lat: 35.68, lon: 139.76, range: 'combined'}, key);
        assert.match(err.message, /VC_SECRET_KEY/);
    }
    assert.match((await timeline(Requester, {}, {lat: 35.68, lon: 139.76, range: 'history'}, KEY)).err.message, /range/);
    assert.match((await timeline(Requester, {}, {lat: 'x', lon: 139.76, range: 'forecast'}, KEY)).err.message, /coordinate/);
    assert.equal(https.calls.length, 0);
});

test('requester retries a 429 once, then fails; errors never carry the key', async () => {
    let calls = 0;
    const flaky = fakeHttps(() => (++calls === 1 ? {status: 429, body: 'Maximum concurrent jobs'} : {status: 200, body: fixture('tokyo-forecast')}));
    let result = await timeline(loadRequester(flaky), {retryDelayMs: 5}, {lat: 35.68, lon: 139.76, range: 'forecast'}, KEY);
    assert.ifError(result.err);
    assert.equal(flaky.calls.length, 2);
    const busy = fakeHttps(() => ({status: 429, body: 'busy ' + KEY}));
    result = await timeline(loadRequester(busy), {retryDelayMs: 5}, {lat: 35.68, lon: 139.76, range: 'forecast'}, KEY);
    assert.equal(busy.calls.length, 2, 'one retry only');
    assert.equal(result.err.statusCode, 429);
    assert.doesNotMatch(result.err.message, new RegExp(KEY));
    const late = fakeHttps(() => ({status: 429, body: 'busy'}));
    result = await timeline(loadRequester(late), {retryDelayMs: 5, retryWindowMs: 0}, {lat: 35.68, lon: 139.76, range: 'forecast'}, KEY);
    assert.equal(late.calls.length, 1, 'no retry outside the retry window');
});

test('requester fails on HTTP errors, bad bodies and the 2.5 s timeout', async () => {
    const cases = [
        [{status: 401, body: 'No account found with API key ' + KEY}, /HTTP 401/],
        [{status: 200, body: '<html>'}, /invalid JSON/],
        [{status: 200, body: {days: []}}, /unexpected body/],
        [new Error('socket hang up'), /request error/]
    ];
    for (const [reply, pattern] of cases) {
        const https = fakeHttps(() => reply);
        const {err} = await timeline(loadRequester(https), {}, {lat: 35.68, lon: 139.76, range: 'forecast'}, KEY);
        assert.match(err.message, pattern);
        assert.doesNotMatch(err.message + (err.stack || ''), new RegExp(KEY));
    }
    const hang = fakeHttps(() => 'hang');
    const started = Date.now();
    const {err} = await timeline(loadRequester(hang), {timeoutMs: 40}, {lat: 35.68, lon: 139.76, range: 'forecast'}, KEY);
    assert.match(err.message, /timeout after 40ms/);
    assert(Date.now() - started < 1000);
    const Requester = loadRequester(fakeHttps(() => 'hang'));
    assert.equal(new Requester().timeoutMs, 2500, 'default budget for the whole call');
    // F4: the retry shares one deadline with the first attempt (Lambda waits 3 s per attempt).
    const retryHang = fakeHttps((url, n) => n === 1 ? {status: 429, body: 'busy', delay: 150} : 'hang');
    const t0 = Date.now();
    const late = await timeline(loadRequester(retryHang), {timeoutMs: 300, retryDelayMs: 20}, {lat: 35.68, lon: 139.76, range: 'forecast'}, KEY);
    assert.equal(retryHang.calls.length, 2);
    assert.match(late.err.message, /timeout/);
    // A fresh per-attempt timeout would end at about 150 + 20 + 300 = 470 ms.
    assert(Date.now() - t0 < 400, 'retry ends within the original budget: ' + (Date.now() - t0) + 'ms');
    assert.doesNotMatch(logText(), new RegExp(KEY));
});

// ---------------------------------------------------------------- converter
const localDate = (epochSec, offsetHours) => new Date((epochSec + offsetHours * 3600) * 1000).toISOString().slice(0, 10);
const localHour = (epochSec, offsetHours) => new Date((epochSec + offsetHours * 3600) * 1000).getUTCHours();

test('converter splits a combined response into yesterday, today and current Dark Sky documents', () => {
    const conv = vcConverter();
    for (const [name, offset, today] of [['tokyo', 9, '2026-09-26'], ['london', 1, '2026-09-26'], ['newyork', -4, '2026-09-26']]) {
        const vc = fixture(name + '-combined');
        const docs = conv.toDarkSkyDocs(vc, new Date(CAPTURED));
        assert.equal(docs.timezone, vc.timezone, name);
        assert.equal(docs.offsetMin, offset * 60, name);
        const midnight = Date.parse(today + 'T00:00:00Z') / 1000 - offset * 3600;
        assert.equal(docs.today.currently.time, midnight, name + ': today record at local midnight');
        assert.equal(docs.yesterday.currently.time, midnight - 86400, name + ': yesterday record at local midnight');
        assert.equal(docs.current.currently.time, Math.floor(CAPTURED / 1000), name + ': current record at fetch time');
        for (const doc of [docs.yesterday, docs.today, docs.current]) {
            assert.equal(doc.timezone, vc.timezone);
            assert.equal(doc.offset, offset);
        }
        assert.equal(docs.yesterday.hourly.data.length, 24);
        assert(docs.yesterday.hourly.data.every(h => localDate(h.time, offset) === '2026-09-25'), name + ': yesterday hours');
        assert.deepEqual(plain(docs.yesterday.hourly.data.map(h => localHour(h.time, offset))), [...Array(24).keys()]);
        assert.equal(docs.today.hourly.data.length, 24);
        assert(docs.today.hourly.data.every(h => localDate(h.time, offset) === today), name + ': today hours');
        assert.deepEqual(plain(docs.yesterday.daily.data.map(d => localDate(d.time, offset))), ['2026-09-25']);
        assert.deepEqual(plain(docs.today.daily.data.map(d => localDate(d.time, offset))), [today]);
        const firstHour = Math.floor(CAPTURED / 3600000) * 3600;
        assert.equal(docs.current.hourly.data[0].time, firstHour, name + ': current hourly starts at the current hour');
        assert.equal(docs.current.hourly.data.length, 49, name + ': 48 h ahead');
        assert.equal(docs.current.daily.data.length, 8, name + ': today + 7 days');
        assert.equal(localDate(docs.current.daily.data[0].time, offset), today);
    }
});

test('converter reproduces Dark Sky units, fractions and derived daily fields', () => {
    const conv = vcConverter();
    const vc = fixture('tokyo-combined');
    const docs = conv.toDarkSkyDocs(vc, new Date(CAPTURED));
    const day = vc.days[0], hour = day.hours[14], c = vc.currentConditions;
    const h = docs.yesterday.hourly.data[14];
    assert.equal(h.time, hour.datetimeEpoch);
    assert.equal(h.temperature, hour.temp, '°F kept');
    assert.equal(h.apparentTemperature, hour.feelslike);
    assert.equal(h.humidity, hour.humidity / 100, 'fraction');
    assert.equal(h.cloudCover, hour.cloudcover / 100, 'fraction');
    assert.equal(h.precipProbability, hour.precipprob / 100, 'fraction');
    assert.equal(h.precipIntensity, hour.precip, 'in/h');
    assert.equal(h.windSpeed, hour.windspeed, 'mph');
    assert.equal(h.windBearing, hour.winddir);
    assert.equal(h.visibility, hour.visibility, 'miles');
    assert.equal(h.pressure, hour.pressure, 'hPa');
    assert.equal(h.precipType, hour.preciptype ? 'rain' : undefined);
    const cur = docs.current.currently;
    assert.equal(cur.temperature, c.temp);
    assert.equal(cur.humidity, c.humidity / 100);
    assert.equal(cur.precipIntensity, 0, 'null precipitation → 0');
    const d = docs.yesterday.daily.data[0];
    assert.equal(d.time, docs.yesterday.currently.time);
    assert.equal(d.sunriseTime, day.sunriseEpoch);
    assert.equal(d.sunsetTime, day.sunsetEpoch);
    assert.equal(d.moonPhase, day.moonphase);
    assert.equal(d.temperatureMax, day.tempmax);
    assert.equal(d.temperatureMin, day.tempmin);
    assert.equal(d.apparentTemperatureMax, day.feelslikemax);
    assert.equal(d.precipType, 'rain');
    assert(Math.abs(d.precipIntensity - day.precip / 24) < 1e-12, 'daily total / 24 so the ×24 conversion yields the total');
    const hottest = day.hours.reduce((a, b) => (b.temp > a.temp ? b : a));
    assert.equal(d.temperatureMaxTime, hottest.datetimeEpoch);
    const wettest = day.hours.reduce((a, b) => ((b.precip || 0) > (a.precip || 0) ? b : a));
    assert.equal(d.precipIntensityMax, wettest.precip);
    assert.equal(d.precipIntensityMaxTime, wettest.datetimeEpoch);
});

test('converter handles a forecast-only response without yesterday', () => {
    const docs = vcConverter().toDarkSkyDocs(fixture('tokyo-forecast'), new Date(CAPTURED));
    assert.equal(docs.yesterday, undefined);
    assert.equal(docs.today.hourly.data.length, 24);
    assert.equal(docs.current.daily.data.length, 8);
    assert.throws(() => vcConverter().toDarkSkyDocs({days: [{datetime: '2026-09-20', datetimeEpoch: 1, hours: []}], timezone: 'Asia/Tokyo', tzoffset: 9}, new Date(CAPTURED)),
        /today/, 'a response without the local today is rejected');
});

test('summaries use the existing weather vocabulary', () => {
    const conv = vcConverter();
    const row = o => Object.assign({temp: 50, humidity: 60, precip: 0, precipprob: 0, preciptype: null, windspeed: 3, winddir: 90,
        pressure: 1010, visibility: 9, cloudcover: 10, conditions: 'Clear', icon: 'clear-day', source: 'obs'}, o);
    const cases = [
        [row({}), 'clear'],
        [row({cloudcover: 40, icon: 'partly-cloudy-day'}), 'partly cloudy'],
        [row({cloudcover: 70}), 'mostly cloudy'],
        [row({cloudcover: 95, icon: 'cloudy'}), 'overcast'],
        [row({visibility: 0.3, icon: 'fog'}), 'fog'],
        [row({icon: 'wind'}), 'windy'],
        [row({conditions: 'Thunderstorm, Rain', icon: 'rain', precip: 0.1, preciptype: ['rain']}), 'thundershowers'],
        [row({precip: 0.02, preciptype: ['rain'], icon: 'rain'}), 'light rain'],
        [row({precip: 0.2, preciptype: ['rain'], icon: 'rain'}), 'rain'],
        [row({precip: 0.4, preciptype: ['rain'], icon: 'rain'}), 'heavy rain'],
        [row({source: 'fcst', precip: 0, precipprob: 70, preciptype: ['rain'], icon: 'rain'}), 'possible light rain'],
        [row({source: 'fcst', precip: 0.01, precipprob: 30, preciptype: ['rain'], icon: 'cloudy', cloudcover: 90}), 'overcast'],
        [row({precip: 0.05, preciptype: ['snow'], icon: 'snow'}), 'light snow'],
        [row({precip: 0.5, preciptype: ['snow'], icon: 'snow'}), 'heavy snow'],
        [row({precip: 0.05, preciptype: ['rain', 'snow'], icon: 'rain'}), 'light sleet'],
        [row({precip: 0.2, preciptype: ['freezingrain'], icon: 'rain'}), 'sleet'],
        [row({source: 'obs', precip: 0.03, preciptype: ['rain'], icon: 'cloudy', cloudcover: 90}), 'light rain']
    ];
    for (const [input, expected] of cases) {
        const out = conv.toDarkSkyHour(input);
        assert.equal(out.summary, expected, JSON.stringify(input));
        assert.notEqual(WeatherDesc.makeWeatherType(out.summary), -1, expected + ' is known to makeWeatherType');
    }
    assert.equal(conv.toDarkSkyHour(row({precip: 0.05, preciptype: ['rain', 'snow'], icon: 'rain'})).icon, 'sleet');
    assert.equal(conv.toDarkSkyHour(row({source: 'obs', precip: 0.03, preciptype: ['rain'], icon: 'cloudy'})).icon, 'rain', 'observed precipitation drives the icon');
    assert.equal(conv.toDarkSkyHour(row({precip: 0.05, preciptype: ['snow'], icon: 'snow'})).precipType, 'snow');
    assert.equal(conv.toDarkSkyHour(row({winddir: 0})).windBearing, 360, 'north stays a valid bearing after _parseData');
    assert.equal(conv.toDarkSkyHour(row({winddir: 90})).windBearing, 90);
    for (const name of ['tokyo-combined', 'london-combined', 'newyork-combined', 'tokyo-forecast']) {
        const docs = conv.toDarkSkyDocs(fixture(name), new Date(CAPTURED));
        for (const doc of [docs.yesterday, docs.today, docs.current].filter(Boolean)) {
            for (const item of [doc.currently].concat(doc.hourly.data, doc.daily.data)) {
                assert.notEqual(WeatherDesc.makeWeatherType(item.summary), -1, name + ': ' + item.summary);
            }
        }
    }
});

// Synthetic Timeline body for an IANA zone, built with Intl like Visual Crossing's local days:
// hour rows at local wall-clock hours, day epochs at local midnight, and the top-level
// tzoffset of the range start (observed live for Pacific/Auckland on 2026-09-26).
function syntheticTimeline(zone, firstDay, days) {
    const fmt = new Intl.DateTimeFormat('en-CA', {timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit'});
    const local = epoch => { const p = Object.fromEntries(fmt.formatToParts(new Date(epoch * 1000)).map(x => [x.type, x.value])); return {date: p.year + '-' + p.month + '-' + p.day, hour: Number(p.hour)}; };
    const offsetAt = epoch => { const l = local(epoch); return (Date.parse(l.date + 'T' + String(l.hour).padStart(2, '0') + ':00:00Z') / 1000 - epoch) / 3600; };
    let epoch = Date.parse(firstDay + 'T00:00:00Z') / 1000 - 14 * 3600;
    while (local(epoch).date !== firstDay || local(epoch).hour !== 0) epoch += 3600;
    const byDay = new Map();
    for (; byDay.size <= days; epoch += 3600) {
        const l = local(epoch);
        if (!byDay.has(l.date)) byDay.set(l.date, []);
        byDay.get(l.date).push({datetime: String(l.hour).padStart(2, '0') + ':00:00', datetimeEpoch: epoch, temp: 50 + l.hour, feelslike: 50 + l.hour,
            humidity: 60, precip: 0, precipprob: 0, preciptype: null, windspeed: 5, winddir: 90, pressure: 1010, visibility: 9, cloudcover: 30,
            conditions: 'Partially cloudy', icon: 'partly-cloudy-day', source: 'fcst'});
    }
    const list = [...byDay.entries()].slice(0, days).map(([date, hours]) => ({datetime: date, datetimeEpoch: hours[0].datetimeEpoch, tempmax: 73, tempmin: 50,
        feelslikemax: 73, feelslikemin: 50, humidity: 60, precip: 0, precipprob: 0, preciptype: null, windspeed: 5, winddir: 90, pressure: 1010,
        visibility: 9, cloudcover: 30, conditions: 'Partially cloudy', icon: 'partly-cloudy-day', source: 'fcst',
        sunriseEpoch: hours[0].datetimeEpoch + 6 * 3600, sunsetEpoch: hours[0].datetimeEpoch + 18 * 3600, moonphase: 0.5, hours}));
    return {queryCost: 25, timezone: zone, tzoffset: offsetAt(list[0].datetimeEpoch), days: list,
        currentConditions: Object.assign({}, list[1].hours[0], {source: 'obs'})};
}

test('F1: day assignment and offset use the offset at now, not the range-start tzoffset (DST)', () => {
    const conv = vcConverter();
    // Auckland: NZST +12 -> NZDT +13 at 2026-09-27 02:00. Now = 09-28 00:30 NZDT, range from yesterday 09-27.
    const nz = syntheticTimeline('Pacific/Auckland', '2026-09-27', 9);
    assert.equal(nz.tzoffset, 12, 'fixture reproduces the range-start offset');
    let docs = conv.toDarkSkyDocs(nz, new Date('2026-09-27T11:30:00Z'));
    assert.equal(docs.offsetMin, 780);
    assert.equal(docs.today.currently.time, Date.parse('2026-09-27T11:00:00Z') / 1000, 'today = 09-28 00:00 NZDT');
    assert.equal(docs.yesterday.currently.time, docs.today.currently.time - 86400, 'yesterday at the stored offset');
    assert.equal(docs.yesterday.hourly.data.length, 23, 'the 23-hour transition day');
    assert.equal(docs.today.hourly.data[0].time, Date.parse('2026-09-27T11:00:00Z') / 1000);
    // New York: EDT -4 -> EST -5 at 2026-11-01 02:00. Now = 11-02 23:30 EST, range from 11-01.
    const ny = syntheticTimeline('America/New_York', '2026-11-01', 9);
    assert.equal(ny.tzoffset, -4);
    docs = conv.toDarkSkyDocs(ny, new Date('2026-11-03T04:30:00Z'));
    assert.equal(docs.offsetMin, -300);
    assert.equal(docs.today.currently.time, Date.parse('2026-11-02T05:00:00Z') / 1000, 'today = 11-02 00:00 EST');
    assert.equal(docs.yesterday.hourly.data.length, 25, 'the 25-hour transition day');
    // Transition day itself, after the change: the response offset is the new one.
    docs = conv.toDarkSkyDocs(syntheticTimeline('Pacific/Auckland', '2026-09-26', 9), new Date('2026-09-27T01:00:00Z'));
    assert.equal(docs.offsetMin, 780, '09-27 14:00 NZDT');
});

test('F2: an exact 0 °F temperature stays a temperature', () => {
    const conv = vcConverter();
    const hour = conv.toDarkSkyHour({temp: 0, feelslike: 0, humidity: 50, cloudcover: 10, source: 'obs'});
    for (const v of [hour.temperature, hour.apparentTemperature]) {
        assert.notEqual(v, 0, '0 would become the -100 sentinel in _parseData');
        assert.equal((v - 32) / 1.8 > -17.8 - 0.05 && (v - 32) / 1.8 < -17.7, true, 'rounds to the same -17.8 °C');
        assert.equal(v.toFixed(1), '0.0', 'rounds to the same 0.0 °F');
    }
    const day = conv.toDarkSkyDay({tempmax: 0, tempmin: 0, feelslikemax: 0, feelslikemin: 0, hours: []}, 0);
    for (const k of ['temperatureMax', 'temperatureMin', 'apparentTemperatureMax', 'apparentTemperatureMin']) assert.equal(day[k].toFixed(1), '0.0', k);
    assert.notEqual(day.temperatureMax, 0);
});

// ---------------------------------------------------------------- controller
function memoryDsfModel() {
    const rows = new Map();
    const keyOf = q => JSON.stringify(q.geo) + '|' + new Date(q.dateObj).getTime();
    const copy = v => v8clone(v);
    return {
        rows,
        find(query) {
            const list = [...rows.values()].filter(r => JSON.stringify(r.geo) === JSON.stringify(query.geo)).map(copy);
            const q = {lean: () => q, sort: s => { list.sort((a, b) => (a.dateObj - b.dateObj) * (s.dateObj || 1)); return q; }, exec: cb => setImmediate(() => cb(null, list))};
            return q;
        },
        update(query, doc, options, cb) { rows.set(keyOf(query), copy(Object.assign({}, doc, query))); setImmediate(() => cb(null)); },
        remove() { return {exec: cb => cb && cb(null)}; }
    };
}
const v8 = require('node:v8');
const v8clone = v => v8.deserialize(v8.serialize(v));
function memoryLockModel(now) {
    const locks = new Map();
    return {
        locks,
        create(doc, cb) {
            setImmediate(() => {
                if (locks.has(doc._id)) { const err = new Error('E11000 duplicate key'); err.code = 11000; return cb(err); }
                locks.set(doc._id, Object.assign({}, doc)); cb(null, doc);
            });
        },
        findOneAndUpdate(filter, update, options, cb) {
            setImmediate(() => {
                const lock = locks.get(filter._id);
                if (!lock || !(lock.expireAt < filter.expireAt.$lt)) return cb(null, null);
                Object.assign(lock, update.$set); cb(null, lock);
            });
        },
        updateOne(filter, update, cb) {
            setImmediate(() => {
                const lock = locks.get(filter._id);
                if (lock && (!filter.expireAt || +lock.expireAt === +filter.expireAt)) Object.assign(lock, update.$set);
                if (cb) cb(null);
            });
        },
        deleteOne(filter, cb) {
            setImmediate(() => {
                const lock = locks.get(filter._id);
                if (lock && (!filter.expireAt || +lock.expireAt === +filter.expireAt)) locks.delete(filter._id);
                if (cb) cb(null);
            });
        }
    };
}
function loadDsfController({model, lockModel, requester, key = KEY, clock}) {
    const Clock = clock ? class extends Date { constructor(...a) { super(...(a.length ? a : [clock.now])); } static now() { return clock.now; } } : Date;
    const timezoneCalls = [];
    const Controller = load('controllers/worldWeather/dsf.controller.js', {
        'async': async,
        '../../config/config': {keyString: {vc_key: key}},
        '../../models/worldWeather/dsf.model': model,
        '../../models/worldWeather/vc.fetch.lock.model': lockModel,
        '../../lib/DSF/dsfRequester': function () { throw new Error('Dark Sky requester used'); },
        '../../lib/VC/vcRequester': requester,
        '../../lib/VC/vcConverter': load('lib/VC/vcConverter.js'),
        './controllerKeys': function () {},
        '../../lib/kmaTimeLib': kmaTimeLib,
        '../timezone.controller': function () { timezoneCalls.push(arguments); throw new Error('Google time zone used'); }
    }, {Date: Clock});
    Controller.timezoneCalls = timezoneCalls;
    Controller.clock = clock;
    return Controller;
}
function fakeVcRequester(replies, delayMs = 0) {
    const calls = [];
    function Requester() {}
    Requester.prototype.getTimeline = function (params, key, cb) {
        calls.push(Object.assign({key}, params));
        const reply = typeof replies === 'function' ? replies(params, calls.length) : replies[params.range];
        setTimeout(() => (reply instanceof Error ? cb(reply) : cb(null, v8clone(reply))), delayMs);
    };
    Requester.calls = calls;
    return Requester;
}
const TOKYO = {lat: 35.68, lon: 139.76};
const getDsf = (Controller, geocode = TOKYO, options = {}) => new Promise(resolve => {
    const c = new Controller();
    Object.assign(c, options);
    const req = {geocode, sessionID: 'test'};
    const now = new Date(Controller.clock ? Controller.clock.now : Date.now());
    c.getDsfData(req, now, (err, res) => resolve({err, res, req}));
});

test('first request fetches one combined range; a fresh cache makes no call; a stale current fetches forecast only', async () => {
    const clock = {now: CAPTURED};
    const model = memoryDsfModel(), lockModel = memoryLockModel();
    const Requester = fakeVcRequester({combined: fixture('tokyo-combined'), forecast: fixture('tokyo-forecast')});
    const Controller = loadDsfController({model, lockModel, requester: Requester, clock});
    let r = await getDsf(Controller);
    assert.ifError(r.err);
    assert.deepEqual(Requester.calls.map(c => c.range), ['combined']);
    assert.equal(Requester.calls[0].key, KEY);
    assert.deepEqual([Requester.calls[0].lat, Requester.calls[0].lon], [35.68, 139.76]);
    assert.equal(model.rows.size, 3, 'yesterday, today and current stored');
    assert.equal(r.res.data.length, 3);
    assert.equal(r.req.result.timezone.min, 540);
    assert.equal(r.req.result.timezone.timezoneId, 'Asia/Tokyo');
    assert.equal(r.req.cWeatherDate.getTime(), Math.floor(CAPTURED / 1000) * 1000);
    await settle();
    assert.equal(lockModel.locks.size, 0, 'lock released');

    clock.now = CAPTURED + 10 * 60000;
    r = await getDsf(Controller);
    assert.ifError(r.err);
    assert.equal(Requester.calls.length, 1, 'fresh cache: no provider call');

    clock.now = CAPTURED + 20 * 60000;
    r = await getDsf(Controller);
    assert.ifError(r.err);
    assert.deepEqual(Requester.calls.map(c => c.range), ['combined', 'forecast'], 'yesterday stored: forecast only');
    assert.equal(r.res.data.length, 3);
    assert.equal(model.rows.size, 4, 'new current record; today upserted');
    assert.equal(Controller.timezoneCalls.length, 0, 'Google time zone lookup not used');
});

test('concurrent requests for one location from separate workers make a single provider call', async () => {
    const clock = {now: CAPTURED};
    const model = memoryDsfModel(), lockModel = memoryLockModel();
    const Requester = fakeVcRequester({combined: fixture('tokyo-combined')}, 60);
    const workerA = loadDsfController({model, lockModel, requester: Requester, clock});
    const workerB = loadDsfController({model, lockModel, requester: Requester, clock});
    const fast = {pollMs: 10, waitMs: 1000};
    const results = await Promise.all([getDsf(workerA, TOKYO, fast), getDsf(workerB, TOKYO, fast), getDsf(workerB, TOKYO, fast)]);
    for (const r of results) { assert.ifError(r.err); assert.equal(r.res.data.length, 3); }
    assert.equal(Requester.calls.length, 1);
    await settle();
    assert.equal(lockModel.locks.size, 0);
    assert.match(logText(), /VC fetch in progress|waiting for/i);
});

test('an expired lock is taken over; a held lock times out waiters without a provider call', async () => {
    const clock = {now: CAPTURED};
    let model = memoryDsfModel(), lockModel = memoryLockModel();
    const key = '139.76,35.68';
    lockModel.locks.set(key, {_id: key, expireAt: new Date(CAPTURED - 1000)});
    let Requester = fakeVcRequester({combined: fixture('tokyo-combined')});
    let r = await getDsf(loadDsfController({model, lockModel, requester: Requester, clock}), TOKYO, {pollMs: 10, waitMs: 100});
    assert.ifError(r.err);
    assert.equal(Requester.calls.length, 1, 'takeover fetches');
    await settle();
    assert.equal(lockModel.locks.size, 0);

    model = memoryDsfModel(); lockModel = memoryLockModel();
    lockModel.locks.set(key, {_id: key, expireAt: new Date(CAPTURED + 10000)});
    Requester = fakeVcRequester({combined: fixture('tokyo-combined')});
    r = await getDsf(loadDsfController({model, lockModel, requester: Requester, clock}), TOKYO, {pollMs: 10, waitMs: 60});
    assert(r.err, 'no stored data and the lock is held: error');
    assert.equal(Requester.calls.length, 0);
    assert.equal(lockModel.locks.size, 1, 'the other worker keeps its lock');
});

test('a provider failure keeps stored current/today data and backs off with the lock', async () => {
    const clock = {now: CAPTURED};
    const model = memoryDsfModel(), lockModel = memoryLockModel();
    // Stored today and current from a forecast-only fetch; yesterday missing.
    let Requester = fakeVcRequester({forecast: fixture('tokyo-forecast'), combined: fixture('tokyo-forecast')});
    let Controller = loadDsfController({model, lockModel, requester: Requester, clock});
    let r = await getDsf(Controller);
    assert.ifError(r.err);
    assert.equal(r.res.data.length, 2, 'combined request without yesterday in the body still stores today and current');
    Requester = fakeVcRequester(() => Object.assign(new Error('VC> HTTP 500'), {statusCode: 500}));
    Controller = loadDsfController({model, lockModel, requester: Requester, clock});
    clock.now = CAPTURED + 5 * 60000;
    r = await getDsf(Controller);
    assert.ifError(r.err);
    assert.deepEqual(Requester.calls.map(c => c.range), ['combined'], 'yesterday missing → combined attempt');
    assert.equal(r.res.data.length, 2, 'stored today and current returned without yesterday');
    await settle();
    assert.equal(lockModel.locks.size, 1, 'failure keeps the lock until it expires (backoff)');

    const empty = loadDsfController({model: memoryDsfModel(), lockModel: memoryLockModel(), requester: Requester, clock});
    r = await getDsf(empty);
    assert(r.err, 'nothing stored and provider failed');
    const noKey = loadDsfController({model: memoryDsfModel(), lockModel: memoryLockModel(), requester: loadRequester(fakeHttps(() => { throw new Error('network'); })), clock, key: 'You have to set key'});
    r = await getDsf(noKey);
    assert.match(String(r.err && r.err.message), /VC_SECRET_KEY/);
});

test('a failing lock store still serves the request and never deletes another lock', async () => {
    const clock = {now: CAPTURED};
    const lockModel = memoryLockModel();
    const deletes = [];
    lockModel.create = (doc, cb) => setImmediate(() => cb(Object.assign(new Error('connection reset'), {code: 'ECONNRESET'})));
    lockModel.deleteOne = (filter, cb) => { deletes.push(filter._id); if (cb) setImmediate(cb); };
    const Requester = fakeVcRequester({combined: fixture('tokyo-combined')});
    const r = await getDsf(loadDsfController({model: memoryDsfModel(), lockModel, requester: Requester, clock}), {lat: '35.680', lon: '139.760'});
    assert.ifError(r.err);
    assert.equal(Requester.calls.length, 1);
    await settle();
    assert.deepEqual(deletes, [], 'no release without ownership');
    assert.match(logText(), /VC fetch lock unavailable 139\.76,35\.68/, 'numeric lock key');
});

test('F1: after a DST change the first local hour does not loop combined calls', async () => {
    const clock = {now: Date.parse('2026-09-27T11:30:00Z')};
    const Requester = fakeVcRequester({combined: syntheticTimeline('Pacific/Auckland', '2026-09-27', 9), forecast: syntheticTimeline('Pacific/Auckland', '2026-09-28', 8)});
    const Controller = loadDsfController({model: memoryDsfModel(), lockModel: memoryLockModel(), requester: Requester, clock});
    const auckland = {lat: '-36.85', lon: '174.76'};
    let r = await getDsf(Controller, auckland);
    assert.ifError(r.err);
    assert.equal(r.req.result.timezone.min, 780);
    for (const minutes of [1, 5, 10]) {
        clock.now = Date.parse('2026-09-27T11:30:00Z') + minutes * 60000;
        r = await getDsf(Controller, auckland);
        assert.ifError(r.err);
    }
    assert.deepEqual(Requester.calls.map(c => c.range), ['combined'], 'one combined call, then the cache');
});

test('F5: yesterday must have been fetched after its local day ended', async () => {
    // Day D: requests at 09:00 and 20:00 JST store today/current only (forecast values for later hours).
    const clock = {now: Date.parse('2026-09-26T00:00:00Z')};
    const model = memoryDsfModel(), lockModel = memoryLockModel();
    const Requester = fakeVcRequester(params => params.range === 'combined'
        ? syntheticTimeline('Asia/Tokyo', clock.now < Date.parse('2026-09-26T15:00:00Z') ? '2026-09-25' : '2026-09-26', 9)
        : syntheticTimeline('Asia/Tokyo', clock.now < Date.parse('2026-09-26T15:00:00Z') ? '2026-09-26' : '2026-09-27', 8));
    const Controller = loadDsfController({model, lockModel, requester: Requester, clock});
    await getDsf(Controller);
    clock.now = Date.parse('2026-09-26T11:00:00Z');
    await getDsf(Controller);
    assert.deepEqual(Requester.calls.map(c => c.range), ['combined', 'forecast']);
    // Day D+1 10:00 JST: D's record is in the yesterday window but was fetched during D.
    clock.now = Date.parse('2026-09-27T01:00:00Z');
    let r = await getDsf(Controller);
    assert.ifError(r.err);
    assert.deepEqual(Requester.calls.map(c => c.range), ['combined', 'forecast', 'combined'], 'observed yesterday fetched once');
    clock.now = Date.parse('2026-09-27T01:30:00Z');
    r = await getDsf(Controller);
    assert.ifError(r.err);
    assert.deepEqual(Requester.calls.map(c => c.range), ['combined', 'forecast', 'combined', 'forecast'], 'then forecast refreshes only');
});

test('F3: a late release never deletes a lock another worker has taken over', async () => {
    const clock = {now: CAPTURED};
    const lockModel = memoryLockModel();
    const Controller = loadDsfController({model: memoryDsfModel(), lockModel, requester: fakeVcRequester({}), clock});
    const a = new Controller(), b = new Controller();
    const tokenA = await new Promise(resolve => a._acquireLock('k', (err, token) => resolve(token)));
    assert(tokenA);
    clock.now += 11000;
    const tokenB = await new Promise(resolve => b._acquireLock('k', (err, token) => resolve(token)));
    assert(tokenB, 'expired lock taken over');
    a._releaseLock('k', tokenA);
    await settle();
    assert.equal(lockModel.locks.size, 1, 'the new holder keeps its lock');
    b._releaseLock('k', tokenB);
    await settle();
    assert.equal(lockModel.locks.size, 0);
});

test('F6/N1: after a provider failure the location backs off for 2 s, within the gateway retry', async () => {
    const clock = {now: CAPTURED};
    const lockModel = memoryLockModel();
    const Requester = fakeVcRequester(() => Object.assign(new Error('VC> HTTP 429: busy'), {statusCode: 429}));
    const Controller = loadDsfController({model: memoryDsfModel(), lockModel, requester: Requester, clock});
    let r = await getDsf(Controller, TOKYO, {pollMs: 5, waitMs: 20});
    assert(r.err);
    r = await getDsf(Controller, TOKYO, {pollMs: 5, waitMs: 20});
    assert(r.err);
    assert.equal(Requester.calls.length, 1, 'no second provider call within the backoff');
    assert(lockModel.locks.get('139.76,35.68').expireAt - clock.now <= 2000, 'backoff shortened to 2 s');
    clock.now += 2100;   // the gateway retries after its 3 s attempt timeout
    await getDsf(Controller, TOKYO, {pollMs: 5, waitMs: 20});
    assert.equal(Requester.calls.length, 2, 'retried after the backoff');
});

// ---------------------------------------------------------------- push, legacy, config
test('push paths accept VC and legacy DSF registrations', async () => {
    const AlertPush = load('controllers/alert.push.controller.js', {
        'async': async, 'request': () => { throw new Error('network'); }, 'i18n': {}, 'sprintf': {},
        '../config/config': {serviceServer: {url: 'http://service.invalid'}}, '../models/alert.push.model': {},
        '../lib/kmaTimeLib': kmaTimeLib, './controllerPush': function () {}, '../lib/aqi.converter': {},
        '../lib/unitConverter': {initUnits: units => units || {temperatureUnit: 'C'}}
    });
    const alert = new AlertPush();
    for (const source of ['VC', 'DSF']) {
        const url = alert._makeRequestUrl({source, geo: [139.76, 35.68], units: {temperatureUnit: 'C'}});
        assert.equal(url, 'http://service.invalid/v000902/dsf/coord/35.68,139.76?temperatureUnit=C', source);
        const current = alert._getCurrentWeather({source, thisTime: [{t1h: 20}, {t1h: 21, pty: 1}]});
        assert.deepEqual(plain(current), {t1h: 21, pty: 1, rns: true}, source);
    }
    assert.throws(() => alert._getCurrentWeather({source: 'XX'}), /Unknown source/);
    // Released apps do not know VC, so their new overseas registrations carry no source:
    // the alert is skipped with an error instead of throwing inside the push worker.
    const skipped = await new Promise(resolve => alert._getWeatherData({geo: [139.76, 35.68], units: {}}, resolve));
    assert.match(String(skipped && skipped.message), /source/);

    const routed = [];
    const Push = load('controllers/controllerPush.js', {
        '../lib/pushProviders': {}, 'node-gcm': {Sender: function () {}}, '../config/config': {serviceServer: {url: 'http://service.invalid'}, push: {}},
        '../models/modelPush': {}, 'async': async, 'request': () => { throw new Error('network'); },
        './controllerTown24h': function () {}, '../lib/unitConverter': {initUnits: u => u || {}}, '../lib/aqi.converter': {},
        '../lib/kmaTimeLib': kmaTimeLib, 'dnscache': () => ({}), 'i18n': {}
    });
    const push = new Push();
    push._requestDsfDailySummary = (info, cb) => { routed.push('overseas:' + info.source); cb(); };
    push._requestKmaDailySummary = (info, cb) => { routed.push('kma'); cb(); };
    push._requestDailySummaryByGeo = (info, cb) => { routed.push('geo'); cb(); };
    for (const source of ['VC', 'DSF']) await new Promise(r => push.requestDailySummary({source, cityIndex: 1, geo: [139.76, 35.68]}, r));
    assert.deepEqual(routed, ['overseas:VC', 'overseas:DSF']);
});

test('no runtime server source calls Dark Sky; the legacy requester fails without network', async () => {
    const hits = [];
    const walk = dir => {
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            if (['node_modules', 'test', 'public'].includes(entry.name)) continue;
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(file);
            else if (/\.(js|json)$/.test(entry.name) && /darksky\.net|forecast\.io\/forecast/.test(fs.readFileSync(file, 'utf8'))) hits.push(path.relative(root, file));
        }
    };
    walk(root);
    assert.deepEqual(hits, []);
    const DsfRequester = load('lib/DSF/dsfRequester.js', {'request': () => { throw new Error('network'); }});
    const err = await new Promise(resolve => new DsfRequester().getForecast({lat: 35.68, lon: 139.76}, undefined, 'key', resolve));
    assert.match(String(err && err.message), /retired/);
    const config = fs.readFileSync(path.join(root, 'config/config.js'), 'utf8');
    assert.match(config, /vc_key\s*:\s*\(?process\.env\.VC_SECRET_KEY/);
    assert.match(fs.readFileSync(path.join(root, '.env.example'), 'utf8'), /^VC_SECRET_KEY=/m);
});

test('the world response reports Visual Crossing as its source', () => {
    const source = fs.readFileSync(path.join(root, 'controllers/worldWeather/controllerWorldWeather.js'), 'utf8');
    assert.match(source, /req\.result\.source = "VC";/);
    assert.doesNotMatch(source, /pubDate\.DSF\s*=/);
    assert.match(fs.readFileSync(path.join(repo, 'client/www/js/service.weatherutil.js'), 'utf8'), /pubDate\.hasOwnProperty\('VC'\)/);
});
