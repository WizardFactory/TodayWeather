# S15 KMA v000903 oracle fixtures

`oracle.json.gz` (sha256 `d4393ff00d583b0a37d95668a3e03eb47d28a759a85a3dafe34bafdffc5eb1bc`) holds pinned legacy-oracle recordings
for the native KMA v000903 assembly tests. It is test data only; the server2 runtime never reads
it or any legacy file.

## Recording

- Legacy source: the S02 oracle baseline files; the sha256 of every legacy file read while
  recording is stored in `source.files` (50 files, as merged with master `437baccb`; responses re-recorded byte-identical after the #2737 `controllerManager.js` change).
- Runtime: Node.js `v16.20.2` (official darwin-arm64 tarball, sha256
  `6a5c4108475871362d742b988566f3fe307f6a67ce14634eb3fbceb4f9eea88c`, matching `SHASUMS256.txt`),
  `TZ=UTC`, `NODE_ENV=production`, dependencies installed with `npm ci --ignore-scripts` from
  `server2/tools/golden/package-lock.json` (express 4.13.4, i18n 0.8.3). Network was denied except
  task-owned loopback; HTTPS was denied.
- Harness: the maintained legacy offline harness `server/test/offline/rss-response-smoke.js`, loaded
  as the S02 recorder loads it, with the real `/v000903/kma` router (`route.kma.v000903.js`) and i18n.
  The harness stubs `manager.MAX_CURRENT_COUNT` as 200 (the deployed manager uses 192); tests use
  the recorded value.
- Driver: the script below (sha256 `22d0351d075a8c31a0e556e2d74edd29544955488f146d84f76f3417e318a05e`), run as
  `TZ=UTC NODE_ENV=production NODE_PATH=<deps>/node_modules node record-kma.js <repo> <out.json.gz>`.
  It is retained here as documentation rather than as an executable repository tool, because a new
  server2-located script reading legacy source would be a new placement exception; the S02 recorder
  remains the only legacy-oracle path (S11 precedent). Recording twice gives identical bytes.
- Cross-check: the 15 recorded `domestic-*` bodies and their Express ETags equal the S02 v000903
  goldens byte for byte, and the 5 `gateway-*` backend bodies equal the S02 gateway domestic
  v000903 goldens after the gateway's geographic merge (both asserted in tests).

## What is recorded

Each request records its path, query, Accept-Language, clock, DB data version, status, content
type, ETag, exact body and, in order, every dependency answer the legacy controllers received at
the store-read boundary, named by the server2 `KmaStore` methods: model reads (`towns`, `town`,
`town_model`, `mid_model`, `area_no`, `area_no_near`, `life_index`, `food_poisoning`,
`special_zones`) and controller dependencies (`region_code`, `forecast_zone`,
`stn_hourly_and_min_rns`, `city_hourly`, `arpltn`, `dust_forecast`, `air_fallback`, `air_forecast`,
`rise_set`). Dates are `{"$date": ms}`, undefined values `{"$undefined": true}`; object key
order is preserved. 1459 answers in total; 1 are flagged `after_response` because legacy
`async.map` keeps calling after an error has already ended the chain and the reply was sent.
Each call also records its complete arguments, copied when legacy made the call. The replay store
(`server2/tests/domestic/recorded.rs`, a test double) checks the method, order and arguments of every call and that
every recorded call was used; any difference forwards the request instead of answering.

The harness answers model reads synchronously. In the deployed service they are asynchronous
callbacks, so an exception thrown while a controller converts an answer escapes the `try` that
issued the read. The native assembly follows the deployed behavior (such an exception forwards to
legacy); no recorded scenario depends on the difference.

The harness air fallback (`lib/AQI/airFallback.js`) throws synchronously in the oracle runtime
(`axios` is not an oracle dependency); legacy catches it and serves no fallback. Those calls are
recorded as `air_fallback` with a `null` answer and `legacy_exception`. Scenarios that need a
fallback observation, dust or KAQ forecasts, station hourly rows or rise/set rows supply the
dependency answer through the driver's `overrides`.

## Content

75 scenarios: 15 S02 direct-route equivalents (domestic-v000903, domestic-locale-en, domestic-locale-ko, domestic-locale-ja, domestic-locale-zh-CN, domestic-locale-de, domestic-locale-zh-TW, domestic-v000903-db1, domestic-null-units, domestic-pop-covered, domestic-pop-missing-hour, domestic-old-no-pop, domestic-never-requested-history, domestic-partial-history, domestic-special-info); 5 gateway backend
requests (gateway-v000903-domestic, gateway-query-normalization, gateway-history-never-requested, gateway-history-resumed-after-eight-days, gateway-history-partial-eight-day-history); and 55 supplementary scenarios (rss-older, rss-equal, busan, jeju, station-first-rain, station-first-snow-cloud, rain-categories, air-stations, air-stations-airnow, air-stale, air-kaq-forecast, air-dust-forecast, air-fallback, life-food-kasi, life-index-near-area, warning-two-zones, winter-cold-wind, hot-humid, missing-short, model-errors, unknown-air-unit, db1-history, stn-error, station-hourly-fill, db1-daily-source, short-publications, current-error, mid-forecast-error, yesterday-warmer, yesterday-colder, rss-unusable-values, current-sky-from-shortest, stn-invalid-zero, stn-fog-thunder, region-guard, clock-night-2340, clock-kst-0030, clock-kst-1010, clock-kst-1110, clock-kst-0605, clock-kst-1535, rss-pub-invalid-offset, rss-pub-hour24-fraction, rss-pub-non-ascii-offset, rss-pub-non-ascii, rss-pub-iso-offset, rss-pub-hour24-submillisecond, current-pub-small-year, stn-boolean-datetime-false, stn-boolean-datetime-true, life-index-hex-area, query-malformed-escape, current-interpolated-strings, stn-cloud-radix-sign, stn-small-year-datetime).

## Driver source

```js
/* S15 KMA v000903 oracle driver (task evidence, not a repository tool).
 * Executes the legacy /v000903/kma router through the maintained offline harness
 * (server/test/offline/rss-response-smoke.js) exactly as the S02 recorder does, and records,
 * for every request, the response plus each dependency answer at the legacy store-read
 * boundary (model reads and controller dependency calls) in the server2 KmaStore vocabulary.
 * Run: TZ=UTC NODE_ENV=production NODE_PATH=<deps>/node_modules node record-kma.js <repo> <out.json.gz>
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');
const crypto = require('crypto'), assert = require('assert'), http = require('http'), zlib = require('zlib');
const root = path.resolve(process.argv[2]);
const outFile = path.resolve(process.argv[3]);
const server = path.join(root, 'server');
process.env.TW_REPO = root;
if (process.version !== 'v16.20.2') throw new Error('Pinned oracle Node v16.20.2 required');
if (process.env.TZ !== 'UTC' || process.env.NODE_ENV !== 'production') throw new Error('TZ=UTC NODE_ENV=production required');
const sourceFiles = {}, rawRead = fs.readFileSync;
fs.readFileSync = function (file, ...args) {
    if (typeof file === 'string') {
        const resolved = path.resolve(file);
        if (resolved.startsWith(server + path.sep) && (/\.(?:pem|env)$/.test(resolved) || resolved === path.join(server, 'config/config.js'))) throw new Error('private input forbidden');
    }
    const bytes = rawRead.call(this, file, ...args);
    if (typeof file === 'string') {
        const resolved = path.resolve(file);
        if (resolved.startsWith(server + path.sep)) sourceFiles[path.relative(root, resolved)] = crypto.createHash('sha256').update(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)).digest('hex');
    }
    return bytes;
};
const allowedPorts = new Set();
const net = require('net'), connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
    let a = args[0]; if (Array.isArray(a)) a = a[0];
    const host = typeof a === 'object' ? a.host : args[1];
    const port = typeof a === 'object' ? Number(a.port) : Number(a);
    if (host !== '127.0.0.1' || !allowedPorts.has(port)) throw new Error('Oracle network denied');
    return connect.apply(this, args);
};
for (const method of ['request', 'get']) require('https')[method] = () => { throw new Error('Oracle HTTPS denied'); };
const express = require('express'), session = require('express-session'), i18n = require('i18n');
const bodyParser = require('body-parser'), cookieParser = require('cookie-parser'), cors = require('cors');
i18n.configure({locales: ['en', 'ko', 'ja', 'zh-CN', 'de', 'zh-TW'], cookie: 'twcookie', directory: path.join(server, 'locales'), register: global, updateFiles: false});
function translate() { return function (...args) { return i18n.__.apply(global, args); }; }
const RealDate = Date;
let now = '2026-09-24T00:10:00.000Z';
class FixedDate extends RealDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return RealDate.parse(now); } }
global.Date = FixedDate;
const clone = v => require('v8').deserialize(require('v8').serialize(v));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

// ---- recording ----
let calls = null, suppress = 0, overrides = {}, thrown = [], responded = false;
function isDate(v) { return v !== null && typeof v === 'object' && Object.prototype.toString.call(v) === '[object Date]'; }
function enc(v) {
    if (isDate(v)) return {$date: v.getTime()};
    if (v === undefined) return {$undefined: true};
    if (typeof v === 'number' && !isFinite(v)) throw new Error('non-finite number in a recorded answer');
    if (Array.isArray(v)) return v.map(enc);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = enc(v[k]); return o; }
    return v;
}
function record(m, args, result, error) {
    if (!calls || suppress > 0) return;
    const entry = {m, args: enc(args)};
    // Legacy async.map keeps calling after an error ends the chain and the reply is sent.
    if (responded) entry.after_response = true;
    if (error !== undefined && error !== null) entry.error = String(error && error.message || error);
    else entry.result = enc(result === undefined ? null : result);
    calls.push(entry);
}
const TOWN = {'kma.town.short.model': 'Short', 'kma.town.current.model': 'Current', 'kma.town.shortest.model': 'Shortest', 'kma.town.short.rss.model': 'ShortRss',
    modelShort: 'Short', modelCurrent: 'Current', modelShortest: 'Shortest', modelShortRss: 'ShortRss'};
const MID = {'kma.town.mid.forecast.model': 'Forecast', 'kma.town.mid.land.model': 'Land', 'kma.town.mid.temp.model': 'Temp',
    modelMidForecast: 'Forecast', modelMidLand: 'Land', modelMidTemp: 'Temp'};
function modelCall(name, query, result, error) {
    const q = query || {};
    if (name === 'town') {
        if (!Object.keys(q).length) return record('towns', [], result, error);
        return record('town', [q['town.first'], q['town.second'], q['town.third']], result, error);
    }
    if (TOWN[name]) return record('town_model', [TOWN[name], q['mCoord.mx'], q['mCoord.my']], result, error);
    if (MID[name]) return record('mid_model', [MID[name], q.regId], result, error);
    if (name === 'modelAreaNo') {
        if (q.geo) return record('area_no_near', [q.geo.$near], result, error);
        return record('area_no', [q['town.first'], q['town.second'], q['town.third']], result, error);
    }
    if (name === 'kma.lifeindex.model') return record('life_index', [q.areaNo], result, error);
    if (name === 'modelFoodPoisoning') return record('food_poisoning', [q.sd, q.sgg.$in[0], q.date.$gte, q.date.$lte], result, error);
    if (name === 'modelKmaSpecialWeatherZone') return record('special_zones', [q.areaCode.$in], result, error);
    return record('unknown_model:' + name, [q], result, error);
}
function answer(key, original, args, done) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
        const o = overrides[key];
        const value = typeof o === 'function' ? o(...args) : clone(o);
        if (value && value.__error) return done(new Error(value.__error));
        return done(null, value);
    }
    suppress++;
    let finished = false;
    try {
        original((err, value, ...rest) => {
            if (finished) return; finished = true;
            suppress--;
            done(err, value, ...rest);
        });
    } catch (e) {
        if (!finished) { finished = true; suppress--; }
        thrown.push({key, message: String(e && e.message)});
        // The legacy caller catches this synchronous failure: no dependency answer is used.
        if (key === 'air_fallback') calls && calls.push({m: 'air_fallback', args: enc(args), result: null, legacy_exception: String(e && e.message).split('\n')[0]});
        throw e;
    }
}
function instrument(id, m) {
    const base = path.basename(String(id)).replace(/\.js$/, '');
    if (!m || m.__instrumented) return m;
    let w = m;
    if (base === 'kecoController') {
        w = Object.create(m);
        w.getArpLtnInfo = (town, date, cb) => { const at = enc([town, date]); answer('arpltn', c => m.getArpLtnInfo(town, date, c), [town, date], (e, v) => { record('arpltn', at, v, e); cb(e, v); }); };
        w.getDustFrcst = (town, date, cb) => { const at = enc([town.region, town.city, date]); answer('dust_forecast', c => m.getDustFrcst(town, date, c), [town, date], (e, v) => { record('dust_forecast', at, v, e); cb(e, v); }); };
    } else if (base === 'controllerKmaStnWeather') {
        w = Object.create(m);
        w.getStnHourlyAndMinRns = (town, dt, cur, cb) => { const at = enc([town, dt, cur]); answer('stn', c => m.getStnHourlyAndMinRns(town, dt, cur, c), [town, dt, cur], (e, v) => { record('stn_hourly_and_min_rns', at, v, e); cb(e, v); }); };
        w.getCityHourlyList = (town, cb) => { const at = enc([town]); answer('city_hourly', c => m.getCityHourlyList(town, c), [town], (e, v) => { record('city_hourly', at, v, e); cb(e, v); }); };
    } else if (base === 'kasi.riseset.controller') {
        w = Object.create(m);
        w.getRiseSetList = (geo, dates, cb) => { const at = enc([geo, dates]); answer('rise_set', c => m.getRiseSetList(geo, dates, c), [geo, dates], (e, v) => { record('rise_set', at, v, e); cb(e, v); }); };
    } else if (base === 'airkorea.hourly.forecast.controller' || base === 'kaq.hourly.forecast.controller') {
        const source = base.startsWith('kaq') ? 'kaq' : 'airkorea';
        w = function () {
            const inner = new m();
            this.getForecast = (stn, cb) => { const at = enc([source, stn]); answer('air_forecast_' + source, c => inner.getForecast(stn, c), [stn], (e, v) => { record('air_forecast', at, v, e); cb(e, v); }); };
        };
    } else if (base === 'airFallback') {
        w = Object.create(m);
        w.getArpltn = (g, t, cb) => { const at = enc([g, t]); answer('air_fallback', c => m.getArpltn(g, t, c), [g, t], (e, v, reason) => { record('air_fallback', at, v || null, e); cb(e, v, reason); }); };
    } else if (base === 'kma.forecast.zone.controller') {
        w = function () {
            const inner = new m();
            this.findForecastZoneByName = (r, c) => ({exec: cb => { const at = enc([r, c]); answer('forecast_zone', k => inner.findForecastZoneByName(r, c).exec(k), [r, c], (e, v) => { record('forecast_zone', at, v, e); cb(e, v); }); }});
        };
    } else {
        return m;
    }
    w.__instrumented = true;
    return w;
}

function harnessModule(file, extra, transform) {
    let code = fs.readFileSync(file, 'utf8');
    if (transform) code = transform(code);
    const m = {exports: {}}, req = Module.createRequire(file);
    const sandbox = {require: req, module: m, exports: m.exports, __dirname: path.dirname(file), __filename: file,
        process, console, Buffer, Date: FixedDate, URL, URLSearchParams, setTimeout, clearTimeout, setImmediate, ...extra};
    vm.runInNewContext('(function(require,module,exports,__filename,__dirname){' + code + '\n})', sandbox, {filename: file})(req, m, m.exports, file, path.dirname(file));
    return m.exports;
}
function swap(code, from, to) { assert(code.includes(from), 'harness boundary changed: ' + from.slice(0, 60)); return code.replace(from, to); }
function makeDomesticHarness() {
    return harnessModule(path.join(server, 'test/offline/rss-response-smoke.js'), {__modelCall: modelCall, __record: record, __instrument: instrument}, code => {
        code = swap(code, 'const data=()=>clone(modelData(name));', 'const data=()=>{const d=clone(modelData(name));__modelCall(name,query,d);return clone(d);};');
        code = swap(code, 'exec(callback){if(failure)return callback(new Error(failure));callback(null,data());}',
            'exec(callback){if(failure){__modelCall(name,query,undefined,failure);return callback(new Error(failure));}callback(null,data());}');
        code = swap(code, "current:'202609240900'", "current:fixture.currentPub||'202609240900'");
        code = swap(code, "getRegIdByTown:(r,c,cb)=>cb(null,{pointNumber:'109',cityCode:'11B10101'})",
            "getRegIdByTown:(r,c,cb)=>{const v={pointNumber:'109',cityCode:'11B10101'};__record('region_code',[r,c],v);cb(null,v);}");
        code = swap(code, '  function localRequire(id) {', '  function localRequire(id) { return __instrument(id, __innerRequire(id)); }\n  function __innerRequire(id) {');
        const marker = '  const routeFile=path.join(root,\'server/routes/v000903/route.kma.v000903.js\');';
        assert(code.includes(marker));
        return code.slice(0, code.indexOf(marker)) + `
  const router=load(historyOptions.oracleRoute);
  return {router,logs,queries,load};
}
module.exports={makeFixture,createHarness,locations};`;
    });
}
function appFor(router, mount) {
    const app = express(); app.set('env', 'production');
    app.use(cors());
    app.use(session({secret: 'wizard factory', resave: false, saveUninitialized: true, genid: () => 'golden-session-fixed', cookie: {maxAge: 60000}}));
    app.use(bodyParser.json()); app.use(bodyParser.urlencoded({extended: false})); app.use(cookieParser()); app.use(i18n.init);
    app.use((req, res, next) => { req.version = (req.url.match(/^\/(v\d+)/) || [])[1]; next(); });
    app.use((req, res, next) => { const json = res.json, send = res.send; res.json = function (...a) { responded = true; return json.apply(this, a); };
        res.send = function (...a) { responded = true; return send.apply(this, a); }; next(); });
    app.use(mount, router);
    return app;
}
async function wire(app, input) {
    const listener = http.createServer(app), sockets = new Set();
    listener.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    await new Promise((ok, bad) => { listener.once('error', bad); listener.listen(0, '127.0.0.1', ok); });
    const port = listener.address().port; allowedPorts.add(port);
    try {
        return await new Promise((resolve, reject) => {
            const req = http.request({host: '127.0.0.1', port, path: input.path, method: 'GET', headers: {connection: 'close', ...input.headers}, agent: false}, res => {
                const chunks = []; res.on('data', c => chunks.push(c));
                res.on('end', () => resolve({status: res.statusCode, contentType: res.headers['content-type'], etag: res.headers.etag, raw: Buffer.concat(chunks)}));
            });
            req.setTimeout(15000, () => req.destroy(new Error('case timeout'))); req.on('error', reject); req.end();
        });
    } finally { for (const s of sockets) s.destroy(); await new Promise(ok => listener.close(ok)); allowedPorts.delete(port); }
}

const enc8 = s => s.split('/').map(encodeURIComponent).join('/');
const SEOUL = '/addr/' + enc8('서울특별시/종로구/청운효자동');
const MYEONG = '/addr/' + enc8('서울특별시/중구/명동');
const APP = 'temperatureUnit=F&windSpeedUnit=mph&pressureUnit=inHg&distanceUnit=mi&precipitationUnit=in&airUnit=aqicn&airForecastSource=kaq';
const UNITS = [
    'temperatureUnit=F&windSpeedUnit=mph&pressureUnit=inHg&distanceUnit=mi&precipitationUnit=in&airUnit=aqicn',
    'temperatureUnit=C&windSpeedUnit=km%2Fh&pressureUnit=hPa&distanceUnit=km&precipitationUnit=mm&airUnit=airkorea',
    'temperatureUnit=F&windSpeedUnit=bft&pressureUnit=mmHg&distanceUnit=mi&precipitationUnit=in&airUnit=airnow',
    'temperatureUnit=C&windSpeedUnit=kr&pressureUnit=mb&distanceUnit=km&precipitationUnit=mm&airUnit=airkorea_who',
    'temperatureUnit=C&windSpeedUnit=m%2Fs&pressureUnit=hPa&distanceUnit=km&precipitationUnit=mm&airUnit=airkorea',
    'temperatureUnit=F&windSpeedUnit=mph&pressureUnit=inHg&distanceUnit=mi&precipitationUnit=in&airUnit=aqicn'];
const LOCALES = ['en', 'ko', 'ja', 'zh-CN', 'de', 'zh-TW'];
const AIR = {arpltn: {pm10Value: 30, pm25Value: 15, pm10Grade: 1, pm25Grade: 1, dataTime: '2026-09-24 09:00'}, list: [], stnList: []};
const kst = s => new RealDate(s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) + 'T' + s.slice(8, 10) + ':' + s.slice(10, 12) + ':00+09:00');
function station(name, dataTime, values) {
    return Object.assign({stationName: name, mangName: '도시대기', dataTime, so2Value: 0.003, coValue: 0.4, o3Value: 0.032, no2Value: 0.021,
        pm10Value: 41, pm25Value: 22, khaiValue: 62, khaiGrade: 2, so2Grade: 1, coGrade: 1, o3Grade: 2, no2Grade: 1, pm10Grade: 2, pm25Grade: 2}, values || {});
}
function hours(name, last, n, values) {
    const out = []; const base = Date.parse(last.replace(' ', 'T') + ':00+09:00');
    for (let i = 0; i < n; i++) { const t = new RealDate(base - i * 3600000 + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' '); out.push(station(name, t, values && values(i))); }
    return out;
}

// Each case: id, modifier(fixture), request {path, query, lang}, options {db, clock, overrides, place}.
const cases = [];
function add(id, request, modifier, options) { cases.push({id, request, modifier: modifier || (() => {}), options: options || {}}); }
// S02 golden equivalents (direct route).
add('domestic-v000903', {path: SEOUL});
LOCALES.forEach((locale, i) => add('domestic-locale-' + locale, {path: SEOUL, query: UNITS[i], lang: locale}, f => { f.arpltnInfo = clone(AIR); }));
add('domestic-v000903-db1', {path: SEOUL}, null, {db: '1.0'});
add('domestic-null-units', {path: SEOUL, query: 'temperatureUnit=(null)&airUnit=(null)'});
add('domestic-pop-covered', {path: SEOUL}, f => f.shortest.forEach((r, i) => { r.pop = [42, 55, 77][i]; }));
add('domestic-pop-missing-hour', {path: SEOUL}, f => { f.shortest[0].pop = 42; f.shortest[1].pop = 55; });
add('domestic-old-no-pop', {path: SEOUL});
add('domestic-never-requested-history', {path: SEOUL}, f => { f.current = f.current.slice(-1); });
add('domestic-partial-history', {path: SEOUL}, f => { f.current = f.current.slice(-12); });
add('domestic-special-info', {path: SEOUL, lang: 'ko'}, f => { f.zoneRows = []; }, {zones: codes => [{areaCode: codes[0], areaName: 'fixed provider area label', active: true, warnVar: 3, warnStress: 1}]});
// S02 gateway backend equivalents (the paths the gateway forwards).
const myeong = f => { f.townRows = [Object.assign(clone(f.place), {town: {first: '서울특별시', second: '중구', third: '명동'}})]; };
add('gateway-v000903-domestic', {path: MYEONG, query: APP, lang: 'ko'}, myeong);
add('gateway-query-normalization', {path: MYEONG, query: 'temperatureUnit=F&note=a%20b&airForecastSource=kaq', lang: 'ko'}, myeong);
add('gateway-history-never-requested', {path: MYEONG, lang: 'en'}, f => { myeong(f); f.current = f.current.slice(-1); });
add('gateway-history-resumed-after-eight-days', {path: MYEONG, lang: 'en'}, f => {
    const recent = f.current.slice(-1);
    const old = clone(f.current.slice(0, 24)).map((r, i) => Object.assign({}, r, {date: '20260915', time: String(i * 100).padStart(4, '0'), t1h: -9}));
    f.current = [...old, ...recent]; myeong(f);
});
add('gateway-history-partial-eight-day-history', {path: MYEONG, lang: 'en'}, f => { myeong(f); f.current = f.current.slice(-12); });

// Supplementary oracle scenarios beyond the S02 goldens.
for (const policy of ['older', 'equal']) add('rss-' + policy, {path: SEOUL, query: 'windSpeedUnit=km%2Fh&temperatureUnit=F'}, null, {policy});
add('busan', {path: '/addr/' + enc8('부산광역시/중구/중앙동'), lang: 'ko'}, null, {place: 1});
add('jeju', {path: '/addr/' + enc8('제주특별자치도/제주시/일도1동'), query: UNITS[2], lang: 'ja'}, null, {place: 2});
add('station-first-rain', {path: SEOUL, lang: 'ko'}, f => { f.stnWeather = {stnDateTime: '2026-09-24 09:05', t1h: 18.4, weather: '약한비', rns: true, rs1h: 1.5, reh: 92, stnId: 108}; },
    {overrides: {}});
add('station-first-snow-cloud', {path: SEOUL, query: 'temperatureUnit=F', lang: 'de'}, f => { f.stnWeather = {stnDateTime: '2026-09-24 09:07', t1h: -1.2, weather: '눈', cloud: 7, rs1h: 0, wsd: 6.3, vec: 22.5, stnId: 108}; });
add('rain-categories', {path: SEOUL, lang: 'ko'}, f => {
    f.short.forEach((r, i) => { if (i % 3 === 1) { r.pty = 1; r.pop = 70; r.r06 = 0.5; r.r06Text = '1mm 미만'; } if (i % 5 === 2) { r.pty = 4; r.r06 = 40; r.r06Text = '30.0~50.0mm'; } if (i % 7 === 3) { r.pty = 3; r.s06 = 5; r.s06Text = '5.0cm 이상'; } });
    f.shortest.forEach((r, i) => { r.pty = [1, 1, 4][i]; r.rn1 = [0.5, 2, 40][i]; r.rn1Text = ['1mm 미만', '2.0mm', '30.0~50.0mm'][i]; r.pop = [60, 70, 80][i]; });
});
add('air-stations', {path: SEOUL, query: 'airUnit=airkorea', lang: 'ko'}, f => {
    const a = hours('종로구', '2026-09-24 09:00', 25), b = hours('중구', '2026-09-24 24:00', 3, i => ({pm10Value: 160 + i, pm10Grade: 4, khaiValue: 180}));
    f.arpltnInfo = {arpltn: station('종로구', '2026-09-24 09:00', {pm25Value: 76, pm25Grade: 4}), list: a, stnList: [a, b]};
});
add('air-stations-airnow', {path: SEOUL, query: 'airUnit=airnow&temperatureUnit=F', lang: 'en'}, f => {
    const a = hours('종로구', '2026-09-24 08:00', 4, i => ({o3Value: 0.08 + i / 100}));
    f.arpltnInfo = {arpltn: station('종로구', '2026-09-24 08:00'), list: a, stnList: [a]};
});
add('air-stale', {path: SEOUL, lang: 'ko'}, f => {
    const a = hours('종로구', '2026-09-23 23:00', 3);
    f.arpltnInfo = {arpltn: {}, list: a, stnList: [a]};
}, {overrides: {air_fallback: {source: 'aqicn', stationName: 'Jongno', dataTime: '2026-09-24 08:00', pm10Value: 33, pm25Value: 12, o3Value: 0.021, no2Value: 0.01, coValue: 0.3, so2Value: 0.002}}});
add('air-kaq-forecast', {path: SEOUL, query: APP, lang: 'ko'}, f => {
    const a = hours('종로구', '2026-09-24 09:00', 2);
    f.arpltnInfo = {arpltn: station('종로구', '2026-09-24 09:00'), list: a, stnList: [a]};
}, {overrides: {air_forecast_kaq: () => {
    const out = [];
    for (let h = 1; h <= 40; h++) for (const code of ['pm10', 'pm25', 'o3']) {
        const t = new RealDate(Date.parse('2026-09-24T09:00:00+09:00') + h * 3600000 + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
        out.push({code, dataTime: t, val: code === 'o3' ? 0.03 + h / 1000 : 20 + h, pubDate: '2026-09-24 05:00'});
    }
    return out;
}}});
add('air-dust-forecast', {path: SEOUL, lang: 'ko'}, f => {
    const a = hours('종로구', '2026-09-24 09:00', 2);
    f.arpltnInfo = {arpltn: station('종로구', '2026-09-24 09:00'), list: a, stnList: [a]};
}, {overrides: {dust_forecast: [
    {date: '20260924', dustForecast: {PM10Grade: 1, PM10Str: '보통', PM25Grade: 2, PM25Str: '나쁨', O3Grade: 0, O3Str: '좋음'}},
    {date: '20260925', dustForecast: {PM10Grade: 0, PM10Str: '좋음'}}]}});
add('air-fallback', {path: SEOUL, query: 'airUnit=aqicn', lang: 'en'}, null, {overrides: {air_fallback:
    {source: 'aqicn', stationName: 'Jongno', dataTime: '2026-09-24 08:00', pm10Value: 45, pm25Value: 30, o3Value: 0.03, no2Value: 0.02, coValue: 0.4, so2Value: 0.003}}});
add('life-food-kasi', {path: SEOUL, lang: 'ko'}, f => {
    f.areaNoRows = [{town: f.place.town, areaNo: '1111051500', geo: [126.97, 37.58]}];
    f.lifeIndexRows = [];
    for (const [d, i] of [['20260924', 0], ['20260925', 1], ['20260926', 2]]) {
        f.lifeIndexRows.push({areaNo: 1111051500, date: new RealDate(Date.UTC(2026, 8, 24 + i)), indexType: 'ultrv', index: [3, 8, 11][i], lastUpdateDate: new RealDate(Date.UTC(2026, 8, 23))});
        f.lifeIndexRows.push({areaNo: 1111051500, date: new RealDate(Date.UTC(2026, 8, 24 + i)), indexType: 'flowerPine', index: [0, 2, 3][i], lastUpdateDate: new RealDate(Date.UTC(2026, 8, 23))});
    }
    f.foodPoisoningRows = [{sd: '서울특별시', sgg: '종로구', date: '20260924', risk: 0.62, value: 62, grade: 2, baseDate: '20260924', publication: '2026-09-240600'},
        {sd: '서울특별시', sgg: '', date: '20260925', risk: 0.2, value: 20, grade: 0, baseDate: '20260924', publication: '2026-09-240600'}];
}, {overrides: {rise_set: (geo, dates) => dates.filter((d, i) => i % 2 === 0).map(d => ({date: d, sunrise: d.slice(0, 4) + '.' + d.slice(4, 6) + '.' + d.slice(6) + ' 06:20', sunset: d.slice(0, 4) + '.' + d.slice(4, 6) + '.' + d.slice(6) + ' 18:25', moonrise: '1200', locationName: '서울'}))}});
add('life-index-near-area', {path: SEOUL, lang: 'en'}, f => {
    f.areaNoRows = [{town: f.place.town, areaNo: '1111051500', geo: [126.97, 37.58]}, {town: {first: '서울특별시', second: '종로구', third: '사직동'}, areaNo: '1111053000', geo: [126.96, 37.57]}];
    f.lifeIndexRows = [{areaNo: 1111053000, date: new RealDate(Date.UTC(2026, 8, 24)), indexType: 'ultrv', index: 6, lastUpdateDate: new RealDate(Date.UTC(2026, 8, 23))}];
});
add('warning-two-zones', {path: SEOUL, lang: 'en'}, f => { f.zoneRows = []; }, {zones: codes => [
    {areaCode: codes[0], areaName: 'a', active: true, warnVar: 1, warnStress: 0}, {areaCode: codes[0], areaName: 'a', active: true, warnVar: 12, warnStress: 1},
    {areaCode: codes[codes.length - 1], areaName: 'b', active: true, warnVar: 3, warnStress: 0}, {areaCode: 'L9999999', areaName: 'elsewhere', active: true, warnVar: 2, warnStress: 2}]});
add('winter-cold-wind', {path: SEOUL, query: 'windSpeedUnit=kt&temperatureUnit=F&precipitationUnit=in', lang: 'zh-TW'}, f => {
    f.short.forEach(r => { r.t3h = -14; r.tmn = -18; r.tmx = -6; r.wsd = 11; r.reh = 40; });
    f.current.forEach(r => { r.t1h = -12.5; r.wsd = 9.4; r.reh = 35; });
    f.shortest.forEach(r => { r.t1h = -11; r.wsd = 12; });
});
add('hot-humid', {path: SEOUL, lang: 'ko'}, f => {
    f.short.forEach(r => { r.t3h = 33; r.tmx = 35; r.reh = 88; r.wsd = 1; });
    f.current.forEach(r => { r.t1h = 34.2; r.reh = 75; r.wsd = 0.5; });
});
add('missing-short', {path: SEOUL, lang: 'en'}, f => { f.missingShort = true; });
add('model-errors', {path: SEOUL, lang: 'en'}, f => { f.modelErrors = {'kma.town.shortest.model': 'shortest read failed', 'kma.town.mid.land.model': 'land read failed'}; });
add('unknown-air-unit', {path: SEOUL, query: 'airUnit=other&temperatureUnit=F', lang: 'en'}, f => { f.arpltnInfo = clone(AIR); });
add('db1-history', {path: SEOUL, query: UNITS[0], lang: 'ko'}, f => { f.current = f.current.slice(-30); }, {db: '1.0'});
add('stn-error', {path: SEOUL, lang: 'en'}, null, {overrides: {stn: {__error: 'station read failed'}}});
add('station-hourly-fill', {path: SEOUL, lang: 'ko'}, f => {
    f.current.forEach((r, i) => { if (i % 6 === 0) { r.t1h = -50; r.reh = -1; r.rn1 = -1; } });
}, {overrides: {city_hourly: () => {
    const rows = [];
    for (let h = 0; h < 48; h++) {
        const ms = Date.UTC(2026, 8, 24, 9) - h * 3600000;
        rows.push({stnId: 108, date: new RealDate(ms), t1h: 19 + (h % 5) / 10, reh: 50 + h % 7, rs1h: h % 9 === 0 ? 0.5 : 0, vec: 200, wsd: 2.2});
    }
    return rows;
}}});
add('db1-daily-source', {path: SEOUL, lang: 'en'}, f => {
    f.dailySource = {pubDate: '202609240500', rows: [26, 27, 28].flatMap(d => [0, 600, 1200, 1500, 1800].map(t => ({date: '202609' + d, time: String(t).padStart(4, '0'), t3h: 15 + t / 300, tmn: t === 600 ? 12 : -50, tmx: t === 1500 ? 24 : -50, sky: 3, pty: d === 27 ? 1 : 0, reh: 70, pop: 60, wsd: 3})))};
}, {db: '1.0'});
add('short-publications', {path: SEOUL, lang: 'en'}, f => { f.shortPublications = {'20260923': '202609221700', '20260926': '202609230500', '20260927': '202609220500'}; });
add('current-error', {path: SEOUL, lang: 'ko'}, f => { f.modelErrors = {'kma.town.current.model': 'current read failed'}; });
add('mid-forecast-error', {path: SEOUL, lang: 'en'}, f => { f.modelErrors = {'kma.town.mid.forecast.model': 'forecast read failed'}; });
add('yesterday-warmer', {path: SEOUL, lang: 'de'}, f => { f.current.forEach(r => { if (r.date === '20260923') { r.t1h = 13.6; r.sky = 4; r.pty = 1; r.rn1 = 2.5; } }); });
add('yesterday-colder', {path: SEOUL, lang: 'ja'}, f => { f.current.forEach(r => { if (r.date === '20260923') r.t1h = 27.4; }); f.current[f.current.length - 1].t1h = 21.4; });
add('rss-unusable-values', {path: SEOUL, lang: 'en'}, f => { f.rss.forEach((r, i) => { r.temp = i % 2 ? -999 : 24.46; r.ws = i % 3 ? -1 : 2.55; r.wd = [8, 2.5, 3, 7, 0, -1, 4][i]; r.pop = i % 2 ? 50 : -1; r.tmx = -999; r.tmn = -999; }); });
add('current-sky-from-shortest', {path: SEOUL, lang: 'ko'}, f => { f.current.forEach((r, i) => { if (i % 4 === 0) r.sky = -1; }); f.current[f.current.length - 1].sky = -1; f.shortest.forEach(r => { r.date = '20260924'; }); });
add('stn-invalid-zero', {path: SEOUL, lang: 'en'}, f => { f.stnWeather = {t1h: 0, vec: 0, wsd: 0}; });
add('stn-fog-thunder', {path: SEOUL, lang: 'zh-CN'}, f => { f.stnWeather = {stnDateTime: '2026-09-24 09:03', weather: '뇌우끝,비', weatherType: 53, rns: false, localMinAws: true, rs1h: 12.36, stnId: 108}; });
add('region-guard', {path: '/addr/' + enc8('중국/베이징'), lang: 'en'});
for (const [id, clock] of [['night-2340', '2026-09-24T14:40:00.000Z'], ['kst-0030', '2026-09-23T15:30:00.000Z'], ['kst-1010', '2026-09-24T01:10:00.000Z'],
    ['kst-1110', '2026-09-24T02:10:00.000Z'], ['kst-0605', '2026-09-23T21:05:00.000Z'], ['kst-1535', '2026-09-24T06:35:00.000Z']]) {
    add('clock-' + id, {path: SEOUL, lang: 'ko'}, null, {clock});
}
// DB 1.0 RSS publication strings (S15-R7/R9/R10): V8 rejects all but the last; a rejected
// publication contributes neither fields nor shortRssPubDate.
for (const [id, pub] of [['invalid-offset', '2026-09-28T04:39:00+99:99'], ['hour24-fraction', '2026-09-24T24:00:00.001Z'],
    ['non-ascii-offset', '2026-09-24T00:00:00+aé00'], ['non-ascii', '한글날짜'], ['iso-offset', '2026-09-24T08:00:00+09:00']]) {
    add('rss-pub-' + id, {path: SEOUL, lang: 'en'}, f => { f.rssPub = pub; }, {db: '1.0'});
}
// S15-R11: hour 24 with a sub-millisecond fraction is rejected by V8's ISO parser.
add('rss-pub-hour24-submillisecond', {path: SEOUL, lang: 'en'}, f => { f.rssPub = '2026-09-23T24:00:00.0001Z'; }, {db: '1.0'});
// S15-R13: `new Date(1, ...)` is 1901, so legacy rejects the DB 1.0 current publication, the
// station merge throws and is caught, and current weather is kept.
add('current-pub-small-year', {path: SEOUL, lang: 'ko'}, f => {
    f.currentPub = '000109240900';
    f.stnWeather = {stnDateTime: '2026-09-24 09:05', t1h: 18.4, weather: '약한비', rns: true, rs1h: 1.5, reh: 92, stnId: 108};
}, {db: '1.0'});
// S15-R14: `new Date(false)`/`new Date(true)` are 0/1 ms, so the station observation is older
// than the current publication and current weather is kept.
for (const value of [false, true]) {
    add('stn-boolean-datetime-' + value, {path: SEOUL, lang: 'ko'}, f => {
        f.stnWeather = {stnDateTime: value, t1h: 18.4, weather: '\uc57d\ud55c\ube44', rns: true, rs1h: 1.5, reh: 92, stnId: 108};
    });
}
// S15-R15: parseInt without a radix reads a hexadecimal area number (0x42394cec = 1111051500).
add('life-index-hex-area', {path: SEOUL, lang: 'ko'}, f => {
    f.areaNoRows = [{town: f.place.town, areaNo: '0x42394cec', geo: [126.97, 37.58]}];
    f.lifeIndexRows = [];
    for (const i of [0, 1, 2]) {
        f.lifeIndexRows.push({areaNo: 1111051500, date: new RealDate(Date.UTC(2026, 8, 24 + i)), indexType: 'ultrv', index: [3, 8, 11][i], lastUpdateDate: new RealDate(Date.UTC(2026, 8, 23))});
    }
});
// S15-R16: qs keeps the original text (plus signs included) when decodeURIComponent fails.
add('query-malformed-escape', {path: SEOUL, query: 'temperatureUnit=F+%ZZ&windSpeedUnit=m%2Fs+%E0%A4%A&airUnit=airkorea+%C3%28', lang: 'en'});
// S15-R18: a stale current observation is rebuilt from short rows; string humidity/wind concatenate.
add('current-interpolated-strings', {path: SEOUL, lang: 'ko'}, f => {
    f.current = f.current.filter(r => r.date + r.time <= '202609240600');
    f.short.forEach(r => { r.reh = String(r.reh); r.wsd = String(r.wsd); });
}, {clock: '2026-09-24T01:10:00.000Z'});
// S15-R19: Number('0x+1') is NaN, so the station cloud amount is unusable.
add('stn-cloud-radix-sign', {path: SEOUL, lang: 'en'}, f => { f.stnWeather = {stnDateTime: '2026-09-24 09:07', t1h: 21.2, weather: '눈', cloud: '0x+1', rs1h: 0, wsd: 3.1, vec: 22.5, stnId: 108}; });
// S15-R12: V8's legacy parser reads `0001-09-24 09:03` as 2026-01-09 09:03 (the native port forwards).
add('stn-small-year-datetime', {path: SEOUL, lang: 'zh-CN'}, f => { f.stnWeather = {stnDateTime: '0001-09-24 09:03', weather: '뇌우끝,비', weatherType: 53, rns: false, localMinAws: true, rs1h: 12.36, stnId: 108}; });

async function run() {
    const out = [];
    for (const c of cases) {
        now = c.options.clock || '2026-09-24T00:10:00.000Z';
        process.env.TW_SMOKE_NOW = now;
        const harness = makeDomesticHarness();
        const fixture = harness.makeFixture(harness.locations[c.options.place || 0], c.options.policy || 'newer');
        c.modifier(fixture);
        const h = harness.createHarness(c.options.db || '2.0', fixture, {oracleRoute: path.join(server, 'routes/v000903/route.kma.v000903.js'), translate: translate()});
        if (c.options.zones) {
            const codes = h.load(path.join(server, 'lib/kmaWarningZones.js')).zonesForTown(fixture.place.town);
            assert(codes.length, 'zones for town');
            fixture.zoneRows.push(...c.options.zones(codes));
        }
        overrides = c.options.overrides || {};
        calls = []; responded = false;
        const p = '/v000903/kma' + c.request.path + (c.request.query ? '?' + c.request.query : '');
        const res = await wire(appFor(h.router, '/v000903/kma'), {path: p, headers: c.request.lang ? {'accept-language': c.request.lang} : {}});
        await new Promise(ok => setImmediate(ok));
        const recorded = calls; calls = null;
        out.push({id: c.id, clock: now, db: c.options.db || '2.0', path: c.request.path, query: c.request.query || '', lang: c.request.lang || null,
            status: res.status, content_type: res.contentType || null, etag: res.etag || null, body: res.raw.toString('utf8'), body_sha256: sha(res.raw), calls: recorded});
        if (thrown.length) process.stderr.write('  thrown: ' + JSON.stringify(thrown) + '\n');
        thrown = [];
        process.stderr.write(c.id + ' ' + res.status + ' ' + res.raw.length + ' calls=' + recorded.length + ' suppress=' + suppress + ' ' + recorded.map(x => x.m).join(',') + '\n');
        suppress = 0;
    }
    delete process.env.TW_SMOKE_NOW;
    const recordOut = {schema: 1, oracle: {node: process.version, tz: process.env.TZ, harness: 'server/test/offline/rss-response-smoke.js',
        route: 'server/routes/v000903/route.kma.v000903.js', i18n: require('i18n/package.json').version, express: require('express/package.json').version,
        max_current_count: 200}, source: {files: Object.fromEntries(Object.entries(sourceFiles).sort())}, scenarios: out};
    const text = JSON.stringify(recordOut);
    fs.writeFileSync(outFile, zlib.gzipSync(Buffer.from(text), {level: 9, mtime: 0}));
    console.log(JSON.stringify({scenarios: out.length, bytes: text.length, sha256: sha(Buffer.from(text))}));
}
run().catch(e => { console.error(e.stack); process.exit(1); });
```
