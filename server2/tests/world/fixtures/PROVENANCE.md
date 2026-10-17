# S11 world oracle fixtures

`oracle.json.gz` (sha256 `54825f967c5cd422fd9b625e8c863ab6c519657697f944198ba22524f92fe864`)
holds pinned legacy-oracle recordings for the native world backend tests. It is test data
only; the server2 runtime never reads it or any legacy file.

## Recording

- Legacy source: repository revision `ca8735cf937a634e7af57396d605e26db8bfc4ff`; the
  sha256 of every legacy file read by the oracle is stored in `source.files`.
- Runtime: Node.js `v16.20.2` (official darwin-arm64 tarball, checksum verified against
  `SHASUMS256.txt`), `TZ=UTC`, `NODE_ENV=production`, dependencies installed with
  `npm ci --ignore-scripts` from `server2/tools/golden/package-lock.json`
  (express 4.13.4, i18n 0.8.3). Network was denied except task-owned loopback.
- Harness: the maintained legacy offline harness `test/offline/vc-weather-smoke.js` (and its
  `vc-synthetic.js` DST-aware body generator) loaded exactly as the S02 recorder does,
  with the real `/v000901`-`/v000903` DSF coordinate routers and i18n translation.
- Driver: the script below (sha256 `4c999ed74c2b436952c2a60cdf7d8a843965bd9ecffdc6cbb532bc9d8422a187`), run as
  `TZ=UTC NODE_ENV=production NODE_PATH=<deps>/node_modules node record-world.js <repo> <out.json.gz>`.
  It is retained here as documentation rather than as an executable repository tool,
  because a new server2-located script reading legacy source would be a new placement
  exception; the S02 recorder remains the only legacy-oracle path. Recording twice gives
  identical scenario content.
- Cross-check: the Tokyo recordings equal the S02 `world-v000901/2/3` and
  `world-locale-*` golden bodies byte for byte, and the London recordings equal the S02
  gateway world bodies after the gateway's geographic merge (asserted in tests).

## Content

37 scenarios, 190 route requests and 81 distinct provider/air bodies: recorded
Tokyo, London and New York Visual Crossing fixtures; legacy synthetic DST sequences (London
and New York fall-back, Auckland and Sydney spring-forward); +5:30, +5:45, +14, -11 and
-2:30 zones; negative coordinates; 0.02-degree cell boundaries around zero and Tokyo; date
line (+/-179.99 clamp) and both poles (+/-89.99 clamp, polar day/night); calm/clear,
missing fields, precipitation types, missing current conditions; malformed route inputs
(one or three parts, non-numeric, bad escape, empty, padded, exponent, hex, Infinity);
provider 500 with and without stored records (including the 2 s backoff), provider 401
(10 min provider-down 503), an unusable billed body (15 min backoff), a reply without
yesterday (no-yesterday marker), the daily record budget path (forecast fallback, stale
serving, 503), and WAQI air observations for every air unit (fresh, high, PM-only, stale,
too far, no PM).

Each request records its path, Accept-Language, status, content type, exact body and the
provider calls with the served body (by sha256) or the injected error.

## Transformations

- Visual Crossing echo fields (`latitude`, `longitude`, `resolvedAddress`, `address`) are
  set to the requested cell centre, as Visual Crossing echoes the request; the legacy
  converter does not read them. The original recorded fixtures echoed the precise
  pre-#2585 coordinate.
- The fixture requester emulates the real requester's rejection of a non-finite
  coordinate before HTTP (recorded as `invalid_coordinate`, never a provider call).
- The WAQI request token is redacted in recorded request URLs; WAQI bodies drop the
  fixture `_comment` field.

## Driver source

```js
/* S11 world oracle driver (task evidence, not a repository tool).
 * Executes the legacy /v00090X/dsf/coord routers through the maintained offline harness
 * (server/test/offline/vc-weather-smoke.js) exactly as the S02 recorder does, with recorded or
 * synthetic Visual Crossing bodies, a fixed clock and i18n, and records wire bodies plus every
 * provider body served. Run: TZ=UTC NODE_ENV=production NODE_PATH=<deps> node record-world.js <repo> <out.json>
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');
const crypto = require('crypto'), assert = require('assert'), http = require('http'), zlib = require('zlib');
const root = path.resolve(process.argv[2]);
const outFile = path.resolve(process.argv[3]);
const server = path.join(root, 'server');
if (process.version !== 'v16.20.2') throw new Error('Pinned oracle Node v16.20.2 required');
if (process.env.TZ !== 'UTC' || process.env.NODE_ENV !== 'production') throw new Error('TZ=UTC NODE_ENV=production required');
if (process.env.VC_SECRET_KEY || process.env.TW_VC_LIVE) throw new Error('Live hints forbidden');
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
const express = require('express'), i18n = require('i18n');
i18n.configure({locales: ['en', 'ko', 'ja', 'zh-CN', 'de', 'zh-TW'], cookie: 'twcookie', directory: path.join(server, 'locales'), register: global, updateFiles: false});
function translate() { return function (...args) { return i18n.__.apply(global, args); }; }
function harnessModule(file, extra, transform) {
    let code = fs.readFileSync(file, 'utf8');
    if (transform) code = transform(code);
    const m = {exports: {}}, req = Module.createRequire(file);
    const sandbox = {require: req, module: m, exports: m.exports, __dirname: path.dirname(file), __filename: file,
        process, console, Buffer, Date, URL, URLSearchParams, setTimeout, clearTimeout, setImmediate, ...extra};
    vm.runInNewContext('(function(require,module,exports,__filename,__dirname){' + code + '\n})', sandbox, {filename: file})(req, m, m.exports, file, path.dirname(file));
    m.exports.__realmError = vm.runInContext('Error', sandbox);
    return m.exports;
}
const W = harnessModule(path.join(server, 'test/offline/vc-weather-smoke.js'), {oracleTranslate: translate()},
    code => { assert(code.includes('__: s => s')); return code.replace('__: s => s', '__: oracleTranslate'); });
const synth = require(path.join(server, 'test/offline/vc-synthetic.js'));
const rawFixture = name => JSON.parse(fs.readFileSync(path.join(server, 'test/offline/fixtures', name + '.json'), 'utf8'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const RealDate = W.RealDate;

function appFor(router, mount) {
    const app = express();
    app.set('env', 'production');
    app.use(i18n.init);
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
                res.on('end', () => resolve({status: res.statusCode, contentType: res.headers['content-type'], raw: Buffer.concat(chunks)}));
            });
            req.setTimeout(15000, () => req.destroy(new Error('case timeout'))); req.on('error', reject); req.end();
        });
    } finally { for (const s of sockets) s.destroy(); await new Promise(ok => listener.close(ok)); allowedPorts.delete(port); }
}

const bodies = {};
function keep(text) { const h = sha(Buffer.from(text)); bodies[h] = text; return h; }
// Visual Crossing echoes the requested coordinate; the server requests the cell centre.
function echo(body, params) {
    const lat = Number(params.lat), lon = Number(params.lon);
    const out = {queryCost: body.queryCost, latitude: lat, longitude: lon, resolvedAddress: lat + ',' + lon, address: lat + ',' + lon};
    for (const k of Object.keys(body)) if (!['queryCost', 'latitude', 'longitude', 'resolvedAddress', 'address'].includes(k)) out[k] = body[k];
    return out;
}
const localDay = (zone, ms, shift) => {
    const day = synth.localParts(zone)(Math.floor(ms / 1000)).date;
    return new RealDate(Date.parse(day + 'T00:00:00Z') + (shift || 0) * 86400000).toISOString().slice(0, 10);
};
function synthetic(zone, options) {
    return (params, nowMs) => params.range === 'combined'
        ? synth.syntheticTimeline(zone, localDay(zone, nowMs, -2), 10, Object.assign({now: nowMs}, options))
        : params.range === 'recent'
            ? synth.syntheticTimeline(zone, localDay(zone, nowMs, -1), 9, Object.assign({now: nowMs}, options))
            : synth.syntheticTimeline(zone, localDay(zone, nowMs), 8, Object.assign({now: nowMs}, options));
}
function recorded(place) {
    return params => params.range === 'forecast' && place === 'tokyo' ? rawFixture('vc-tokyo-forecast')
        : params.range === 'recent' ? rawFixture('vc-' + place + '-combined') : synth.withDayBefore(rawFixture('vc-' + place + '-combined'));
}
const Q = {
    F: 'temperatureUnit=F&windSpeedUnit=mph',
    SI: 'temperatureUnit=C&windSpeedUnit=km%2Fh&pressureUnit=hPa&distanceUnit=km&precipitationUnit=mm&airUnit=airkorea',
    APP: 'temperatureUnit=F&windSpeedUnit=mph&pressureUnit=inHg&distanceUnit=mi&precipitationUnit=in&airUnit=aqicn&airForecastSource=kaq',
    MIX: 'temperatureUnit=C&windSpeedUnit=bft&pressureUnit=mmHg&distanceUnit=mi&precipitationUnit=in&airUnit=airnow',
    KT: 'temperatureUnit=F&windSpeedUnit=kt&pressureUnit=mb&distanceUnit=km&precipitationUnit=mm&airUnit=airkorea_who',
    MS: 'temperatureUnit=C&windSpeedUnit=m%2Fs',
    NULL: 'temperatureUnit=(null)&windSpeedUnit=m%2Fs&airUnit=(null)',
    ODD: 'temperatureUnit=K&windSpeedUnit=kr&pressureUnit=atm&distanceUnit=ft&precipitationUnit=cm&airUnit=other',
    EMPTY: 'temperatureUnit=&windSpeedUnit=&airUnit=',
    NONE: ''
};
const R = (version, loc, query, lang) => ({version, loc, query: query.split('&').map(x => Q[x] !== undefined ? Q[x] : x).filter(Boolean).join('&'), lang});
const both = (loc, lang) => [R('v000903', loc, 'MS', lang || 'en'), R('v000901', loc, 'F', lang || 'en')];

const scenarios = [];
function add(id, zone, provider, steps, options) { scenarios.push({id, zone, provider, steps, options: options || {}}); }
// S02 parity: recorded Tokyo/London/New York fixtures.
add('tokyo-recorded', 'Asia/Tokyo', recorded('tokyo'), [
    {at: '2026-09-26T07:04:30.000Z', requests: [R('v000901', '35.68,139.76', 'F'), R('v000902', '35.68,139.76', 'F'), R('v000903', '35.68,139.76', 'F'),
        ...['en', 'ko', 'ja', 'zh-CN', 'de', 'zh-TW'].map(l => R('v000903', '35.68,139.76', 'SI', l)),
        R('v000903', '35.68,139.76', 'NULL'), R('v000903', '35.68,139.76', 'ODD', 'ko-KR,ko;q=0.9'), R('v000903', '35.68,139.76', 'EMPTY', 'zh-cn'),
        R('v000902', '35.68,139.76', 'NONE', 'fr-FR,de;q=0.8'), R('v000901', '35.68,139.76', 'MIX', 'ja-JP'), R('v000902', '35.68,139.76', 'KT', 'zh-TW,zh;q=0.9')]},
    {at: '2026-09-26T07:24:30.000Z', requests: [R('v000903', '35.68,139.76', 'SI', 'ko'), R('v000901', '35.6801,139.7601', 'F', 'en')]}
]);
add('london-recorded', 'Europe/London', recorded('london'), [
    {at: '2026-09-26T07:04:30.000Z', requests: ['v000901', 'v000902', 'v000903'].map(v => R(v, '51.507,-0.128', 'APP', 'ko'))}
]);
add('newyork-recorded', 'America/New_York', recorded('newyork'), [
    {at: '2026-09-26T07:04:30.000Z', requests: [R('v000903', '40.7128,-74.006', 'MIX', 'en'), R('v000901', '40.7128,-74.006', 'F', 'de'), R('v000902', '40.7128,-74.006', 'KT', 'ja')]}
]);
// vc-weather-smoke synthetic scenarios (DST, half-hour zones, missing fields, stale fallback, polar day).
const v3v1 = (loc) => both(loc);
add('london-dst-end', 'Europe/London', synthetic('Europe/London'), ['2026-10-24T12:00:00Z', '2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z', '2026-10-25T10:00:00Z', '2026-10-25T22:00:00Z', '2026-10-26T00:30:00Z', '2026-10-26T02:00:00Z'].map(at => ({at, requests: v3v1('51.51,-0.13')})));
add('auckland-dst-start', 'Pacific/Auckland', synthetic('Pacific/Auckland'), ['2026-09-26T13:30:00Z', '2026-09-27T00:00:00Z', '2026-09-27T11:30:00Z', '2026-09-27T13:00:00Z'].map(at => ({at, requests: v3v1('-36.85,174.76')})));
add('newyork-dst-end', 'America/New_York', synthetic('America/New_York'), ['2026-11-01T03:00:00Z', '2026-11-02T04:30:00Z', '2026-11-02T05:10:00Z', '2026-11-02T06:10:00Z'].map(at => ({at, requests: v3v1('40.71,-74.01')})));
add('sydney-dst-start', 'Australia/Sydney', synthetic('Australia/Sydney'), ['2026-10-03T12:00:00Z', '2026-10-03T15:30:00Z', '2026-10-03T16:30:00Z', '2026-10-04T14:00:00Z'].map(at => ({at, requests: v3v1('-33.8688,151.2093')})));
add('santiago-negative', 'America/Santiago', synthetic('America/Santiago'), ['2026-09-26T07:04:30Z', '2026-09-26T07:30:00Z'].map(at => ({at, requests: [...v3v1('-33.4489,-70.6693'), R('v000902', '-33.4489,-70.6693', 'APP', 'ko')]})));
for (const [id, zone, loc] of [['delhi', 'Asia/Kolkata', '28.61,77.21'], ['kathmandu', 'Asia/Kathmandu', '27.72,85.32'], ['kiritimati', 'Pacific/Kiritimati', '1.87,-157.36'],
    ['pago-pago', 'Pacific/Pago_Pago', '-14.28,-170.7'], ['st-johns', 'America/St_Johns', '47.56,-52.71']]) {
    add(id, zone, synthetic(zone), [{at: '2026-09-26T07:04:30Z', requests: v3v1(loc)}, {at: '2026-09-26T07:24:30Z', requests: v3v1(loc)}]);
}
const berlin = ['Europe/Berlin', '52.52,13.4'];
add('calm-clear', berlin[0], synthetic(berlin[0], {hour: () => ({cloudcover: 0, windspeed: 0, winddir: 0, conditions: 'Clear', icon: 'clear-day'}),
    day: () => ({cloudcover: 0, windspeed: 0, winddir: 0, conditions: 'Clear', icon: 'clear-day'})}), [{at: '2026-09-26T07:04:30Z', requests: [...v3v1(berlin[1]), R('v000902', berlin[1], 'MIX', 'de')]}]);
add('missing-fields', berlin[0], synthetic(berlin[0], {hour: row => (row.datetimeEpoch / 3600) % 2 === 0 ? {pressure: null, winddir: null, humidity: null, visibility: null, feelslike: null, temp: null} : {},
    day: () => ({pressure: null, winddir: null, humidity: null}), current: {temp: 55, feelslike: null, pressure: null}}), [{at: '2026-09-26T07:04:30Z', requests: [...v3v1(berlin[1]), R('v000902', berlin[1], 'APP', 'ko')]}]);
add('precipitation-types', berlin[0], synthetic(berlin[0], {hour: row => {
    const h = Number(row.datetime.slice(0, 2));
    if (h === 2) return {preciptype: ['snow'], precip: 0.5, snow: 4, icon: 'snow', conditions: 'Snow'};
    if (h === 5) return {preciptype: ['ice'], precip: 0.05, icon: 'rain', conditions: 'Ice'};
    if (h === 8) return {visibility: 0.3, icon: 'fog', conditions: 'Fog'};
    if (h === 11) return {preciptype: ['rain'], precip: 0.2, icon: 'rain', conditions: 'Thunderstorm, Rain'};
    if (h === 14) return {preciptype: ['rain'], precip: 0.5, icon: 'rain', conditions: 'Rain'};
    if (h === 17) return {preciptype: null, icon: 'wind', conditions: 'Wind', windspeed: 30};
    if (h >= 20) return {preciptype: ['rain', 'snow'], precipprob: 70, precip: 0, icon: 'rain', conditions: 'Rain, Snow'};
    return {};
}, day: d => (d.datetime.endsWith('27') ? {preciptype: ['snow'], precip: 2.4, icon: 'snow', precipprob: 80} : d.datetime.endsWith('28') ? {preciptype: ['rain', 'snow'], precip: 0.4, icon: 'rain', precipprob: 60} : {})}),
[{at: '2026-09-26T07:04:30Z', requests: [...v3v1(berlin[1]), R('v000902', berlin[1], 'SI', 'zh-TW')]}, {at: '2026-09-26T21:30:00Z', requests: v3v1(berlin[1])}]);
add('missing-current-conditions', berlin[0], synthetic(berlin[0], {current: false}), [{at: '2026-09-26T07:04:30Z', requests: v3v1(berlin[1])}, {at: '2026-09-26T07:30:00Z', requests: v3v1('52.5201,13.4001')}]);
add('stale-fallback', berlin[0], synthetic(berlin[0]), [
    {at: '2026-09-26T07:04:30Z', requests: v3v1(berlin[1])},
    {at: '2026-09-26T08:04:30Z', fail: 500, requests: v3v1(berlin[1])},
    {at: '2026-09-26T08:04:31Z', requests: v3v1(berlin[1])},
    {at: '2026-09-26T21:50:00Z', requests: v3v1(berlin[1])},
    {at: '2026-09-26T22:30:00Z', fail: 500, requests: v3v1(berlin[1])},
    {at: '2026-09-26T22:40:00Z', requests: v3v1(berlin[1])}]);
add('polar-day', 'Arctic/Longyearbyen', synthetic('Arctic/Longyearbyen', {polar: true}), [{at: '2026-06-21T12:00:00Z', requests: v3v1('78.22,15.65')}]);
add('pole-north', 'Arctic/Longyearbyen', synthetic('Arctic/Longyearbyen', {polar: true}), [{at: '2026-12-21T12:00:00Z', requests: [...v3v1('89.999,10'), R('v000902', '90,10.005', 'SI', 'ko')]}]);
add('pole-south', 'Antarctica/McMurdo', synthetic('Antarctica/McMurdo', {polar: true}), [{at: '2026-12-21T12:00:00Z', requests: [...v3v1('-90,0'), R('v000902', '-89.999,-0.0001', 'APP', 'en')]}]);
add('dateline-east', 'Etc/GMT-12', synthetic('Etc/GMT-12'), [{at: '2026-09-26T07:04:30Z', requests: [...v3v1('10,179.995'), R('v000903', '10.001,180', 'SI', 'ja')]}, {at: '2026-09-26T11:59:00Z', requests: v3v1('10,179.999')}, {at: '2026-09-26T12:01:00Z', requests: v3v1('10,179.999')}]);
add('dateline-west', 'Etc/GMT+12', synthetic('Etc/GMT+12'), [{at: '2026-09-26T07:04:30Z', requests: [...v3v1('-16.5,-179.999'), R('v000903', '-16.5,-180', 'SI', 'de')]}, {at: '2026-09-26T12:01:00Z', requests: v3v1('-16.5,-179.981')}]);
add('cell-boundary', 'Africa/Abidjan', synthetic('Africa/Abidjan'), [
    {at: '2026-09-26T07:04:30Z', requests: [R('v000903', '-0.02,-0.02', 'MS', 'en'), R('v000903', '-0.0000001,-0.039999', 'MS', 'en'), R('v000903', '-0.0200001,-0.0200001', 'MS', 'en'),
        R('v000903', '0.019999,0.02', 'MS', 'en'), R('v000903', '0.0199999,0.0200004', 'MS', 'en'), R('v000901', '0.02,0.0000004', 'F', 'en')]},
    {at: '2026-09-26T07:05:30Z', requests: [R('v000903', '-0.0199999,-0.0199999', 'MS', 'ko'), R('v000903', '0.01,0.03', 'MS', 'ko')]}]);
add('cell-boundary-tokyo', 'Asia/Tokyo', synthetic('Asia/Tokyo'), [{at: '2026-09-26T07:04:30Z', requests: [R('v000903', '35.6799995,139.76', 'SI', 'ko'), R('v000903', '35.68,139.7600004', 'SI', 'ko'),
    R('v000903', '35.679999,139.76', 'SI', 'ko'), R('v000903', '35.7,139.7799999', 'SI', 'ko')]}]);
// Malformed route inputs (the gateway never forwards them; legacy route behavior is recorded).
add('invalid-input', 'Asia/Tokyo', synthetic('Asia/Tokyo'), [{at: '2026-09-26T07:04:30Z', requests: [
    R('v000903', 'abc', 'MS', 'en'), R('v000903', '1,2,3', 'MS', 'en'), R('v000903', 'abc,def', 'MS', 'en'),
    R('v000903', '%E0%A4%A', 'MS', 'en'), R('v000903', ',', 'MS', 'en'), R('v000901', '35.68,', 'F', 'en'),
    R('v000903', '%2035.68%20,%20139.76%20', 'SI', 'ko'), R('v000902', '1e1,2e1', 'MS', 'en'),
    R('v000903', 'Infinity,0', 'MS', 'en'), R('v000903', '0x10,10', 'MS', 'en')]}]);
// Errors and chain states.
add('provider-500-cold', 'Asia/Tokyo', synthetic('Asia/Tokyo'), [{at: '2026-09-26T07:04:30Z', fail: 500, requests: [R('v000903', '35.0,135.0', 'MS', 'en')]},
    {at: '2026-09-26T07:04:31Z', requests: [R('v000903', '35.0,135.0', 'MS', 'en')]}, {at: '2026-09-26T07:04:33Z', requests: [R('v000903', '35.0,135.0', 'MS', 'en')]}]);
add('provider-401', 'Asia/Tokyo', synthetic('Asia/Tokyo'), [
    {at: '2026-09-26T00:04:30Z', requests: [R('v000903', '34.7,135.5', 'MS', 'en')]},
    {at: '2026-09-26T07:04:30Z', fail: 401, requests: [R('v000903', '34.7,135.5', 'MS', 'en')]},
    {at: '2026-09-26T07:05:30Z', requests: [R('v000903', '34.7,135.5', 'MS', 'en'), R('v000903', '43.06,141.35', 'MS', 'en')]},
    {at: '2026-09-26T07:15:00Z', requests: [R('v000903', '34.7,135.5', 'MS', 'en')]}]);
add('unusable-body', 'Asia/Tokyo', (params, nowMs) => {
    const s = synthetic('Asia/Tokyo')(params, nowMs);
    return nowMs < Date.parse('2026-09-26T07:20:00Z') ? Object.assign({}, s, {days: s.days.slice(4)}) : s;
}, [{at: '2026-09-26T07:04:30Z', requests: [R('v000903', '33.59,130.4', 'MS', 'en')]}, {at: '2026-09-26T07:05:30Z', requests: [R('v000903', '33.59,130.4', 'MS', 'en')]},
    {at: '2026-09-26T07:20:30Z', requests: [R('v000903', '33.59,130.4', 'MS', 'en')]}]);
add('no-yesterday', 'Asia/Tokyo', (params, nowMs) => synth.syntheticTimeline('Asia/Tokyo', localDay('Asia/Tokyo', nowMs), 8, {now: nowMs}),
    [{at: '2026-09-26T07:04:30Z', requests: [R('v000903', '26.21,127.68', 'MS', 'en'), R('v000901', '26.21,127.68', 'F', 'en')]},
        {at: '2026-09-26T07:24:30Z', requests: [R('v000903', '26.21,127.68', 'MS', 'en')]}, {at: '2026-09-26T15:10:00Z', requests: [R('v000903', '26.21,127.68', 'MS', 'en')]}]);
add('budget', 'Asia/Tokyo', synthetic('Asia/Tokyo'), [
    {at: '2026-09-26T01:04:30Z', requests: [R('v000903', '38.27,140.87', 'MS', 'en')]},
    {at: '2026-09-26T01:24:30Z', requests: [R('v000903', '38.27,140.87', 'MS', 'en')]},
    {at: '2026-09-26T01:44:30Z', requests: [R('v000903', '38.27,140.87', 'MS', 'en')]},
    {at: '2026-09-26T08:44:30Z', requests: [R('v000903', '38.27,140.87', 'MS', 'en')]}], {dailyRecordLimit: 30});
// Air observations through the shared air service with only WAQI configured.
function waqi(observedMs, change) {
    const w = rawFixture('waqi-tokyo');
    delete w._comment;
    w.data.time = {iso: new RealDate(observedMs).toISOString().slice(0, 19) + 'Z'};
    if (change) change(w);
    return w;
}
const AIR_T = '2026-09-27T14:20:00.000Z', OBS = Date.parse('2026-09-27T14:00:00Z');
add('air-waqi', 'Asia/Tokyo', synthetic('Asia/Tokyo'), [{at: AIR_T, requests: [
    R('v000903', '35.68,139.76', 'SI', 'ko'), R('v000903', '35.68,139.76', 'MS&airUnit=airkorea_who', 'en'), R('v000902', '35.68,139.76', 'MS&airUnit=airnow', 'ja'),
    R('v000901', '35.68,139.76', 'APP', 'ko'), R('v000903', '35.68,139.76', 'APP', 'de'), R('v000903', '35.68,139.76', 'MS&airUnit=other', 'zh-CN')]}], {air: () => waqi(OBS)});
add('air-waqi-high', 'Asia/Tokyo', synthetic('Asia/Tokyo'), [{at: AIR_T, requests: [R('v000903', '35.68,139.76', 'SI', 'ko'), R('v000903', '35.68,139.76', 'MS&airUnit=airnow', 'en'),
    R('v000903', '35.68,139.76', 'MS&airUnit=airkorea_who', 'zh-TW'), R('v000901', '35.68,139.76', 'APP', 'en')]}],
{air: () => waqi(OBS, w => { w.data.iaqi.pm25 = {v: 168}; w.data.iaqi.pm10 = {v: 155}; w.data.iaqi.o3 = {v: 120}; w.data.iaqi.no2 = {v: 110}; w.data.city.name = 'Tokyo'; })});
add('air-waqi-pm-only', 'Asia/Tokyo', synthetic('Asia/Tokyo'), [{at: AIR_T, requests: [R('v000903', '35.68,139.76', 'SI', 'en'), R('v000901', '35.68,139.76', 'APP', 'ko')]}],
    {air: () => waqi(OBS, w => { for (const c of ['o3', 'no2', 'so2', 'co']) delete w.data.iaqi[c]; w.data.attributions = []; })});
add('air-waqi-stale', 'Asia/Tokyo', synthetic('Asia/Tokyo'), [{at: AIR_T, requests: [R('v000903', '35.68,139.76', 'SI', 'ko')]}], {air: () => waqi(OBS - 9 * 3600000)});
add('air-waqi-far', 'Asia/Tokyo', synthetic('Asia/Tokyo'), [{at: AIR_T, requests: [R('v000903', '35.68,139.76', 'SI', 'ko')]}], {air: () => waqi(OBS, w => { w.data.city.geo = [36.68, 139.76]; })});
add('air-waqi-no-pm', 'Asia/Tokyo', synthetic('Asia/Tokyo'), [{at: AIR_T, requests: [R('v000903', '35.68,139.76', 'SI', 'ko')]}], {air: () => waqi(OBS, w => { delete w.data.iaqi.pm10; delete w.data.iaqi.pm25; })});

async function run() {
    const out = [];
    for (const sc of scenarios) {
        let step, failing = 0;
        const served = [];
        let airBodies = [];
        const options = {};
        if (sc.options.dailyRecordLimit) options.dailyRecordLimit = sc.options.dailyRecordLimit;
        if (sc.options.air) {
            options.keyString = {aqi_keys: [{key: 'world-waqi-token-0001'}]};
            options.packages = {axios: {get: (url) => {
                assert(url.startsWith('https://api.waqi.info/feed/geo:'), 'WAQI only');
                const text = JSON.stringify(sc.options.air());
                const h = keep(text);
                airBodies.push({provider: 'aqicn', body_sha256: h, request: url.replace(/token=[^&]*/, 'token=<redacted>')});
                return Promise.resolve({status: 200, data: JSON.parse(text)});
            }, post: () => Promise.reject(new Error('no post'))}};
        }
        const h = W.createHarness(params => {
            if (failing) {
                const e = Object.assign(new W.__realmError('VC> HTTP ' + failing + ': synthetic'), {statusCode: failing});
                if (failing === 401) e.providerDown = true;
                served.push({range: params.range, lat: params.lat, lon: params.lon, error: {status: failing, provider_down: failing === 401}});
                return e;
            }
            // The real vcRequester rejects a non-finite coordinate before HTTP (no billed call).
            if (!isFinite(Number(params.lat)) || !isFinite(Number(params.lon))) {
                served.push({range: params.range, lat: String(params.lat), lon: String(params.lon), error: {status: 0, invalid_coordinate: true}});
                return new W.__realmError('VC> invalid coordinate');
            }
            const body = echo(sc.provider(params, W.getNow()), params);
            const text = JSON.stringify(body);
            served.push({range: params.range, lat: params.lat, lon: params.lon, body_sha256: keep(text)});
            return JSON.parse(text);
        }, options);
        const routers = {};
        for (const v of ['v000901', 'v000902', 'v000903']) {
            const file = v === 'v000901' ? 'route.dsf.coord.js' : 'route.dsf.coord.' + v + '.js';
            routers[v] = appFor(h.load(path.join(server, 'routes', v, file)), '/' + v + '/dsf/coord');
        }
        const steps = [];
        for (step of sc.steps) {
            W.setNow(Date.parse(step.at));
            failing = step.fail || 0;
            const requests = [];
            for (const r of step.requests) {
                served.length = 0; airBodies = [];
                const p = '/' + r.version + '/dsf/coord/' + r.loc + (r.query ? '?' + r.query : '');
                const res = await wire(routers[r.version], {path: p, headers: r.lang ? {'accept-language': r.lang} : {}});
                await new Promise(ok => setImmediate(ok));
                requests.push({version: r.version, loc: r.loc, query: r.query, lang: r.lang || null, status: res.status, content_type: res.contentType,
                    body: res.raw.toString('utf8'), body_sha256: sha(res.raw), calls: served.slice(), air: airBodies.slice()});
            }
            steps.push({at: new RealDate(Date.parse(step.at)).toISOString(), fail: step.fail || null, requests});
        }
        await new Promise(ok => setTimeout(ok, 5));
        out.push({id: sc.id, zone: sc.zone, options: {daily_record_limit: sc.options.dailyRecordLimit || null, air: sc.options.air ? 'aqicn' : null}, steps});
        process.stderr.write(sc.id + ' ' + steps.map(s => s.requests.map(r => r.status + ':' + r.calls.map(c => c.range + (c.error ? '!' + c.error.status : '')).join('+')).join(',')).join(' | ') + '\n');
    }
    const record = {schema: 1, oracle: {node: process.version, tz: process.env.TZ, harness: 'server/test/offline/vc-weather-smoke.js', i18n: require('i18n/package.json').version, express: require('express/package.json').version},
        source: {files: Object.fromEntries(Object.entries(sourceFiles).sort())}, bodies, scenarios: out};
    const text = JSON.stringify(record);
    fs.writeFileSync(outFile, zlib.gzipSync(Buffer.from(text), {level: 9}));
    console.log(JSON.stringify({scenarios: out.length, requests: out.reduce((n, s) => n + s.steps.reduce((m, t) => m + t.requests.length, 0), 0), bodies: Object.keys(bodies).length, bytes: text.length}));
}
run().catch(e => { console.error(e.stack); process.exit(1); });
```


## S20d retained widget supplement (2026-10-17)

`widget.json.gz` SHA-256 `f70690200e6d83ad20268f0702a544ef0bf97ceba585999241c9c4840b9c324e` contains 14 actual HTTP cases from the named S02 recorder `server/test/offline/golden-record.js --widget-only --output <new-dir>`, on pinned Node 16.20.2, UTC/production and the existing isolated S02 dependency lock. Legacy source revision 82f7a4838dda046be966ee9c25c9cb66561d099d and every source file read are recorded inside. This explicit export does not alter the historical 19 groups. It includes raw Tokyo and units metadata, Korean/Japanese/Chinese localization, HEAD/304, missing/malformed input, invalid version, initial provider 401, subsequent provider-down 503, and generic 500. Provider Errors are created in the maintained harness VM realm and 401 carries the actual requester providerDown flag; earlier setup attempts are retained separately. Native tests use the identical already-pinned S11 Tokyo provider body; no runtime legacy source or fixture is read. Session cookie, Date and connection/framing headers are excluded from transport comparison; status/body/functional headers remain exact.

The existing complete S02 baseline may refresh only source.oracle_sha256 after this recorder extension; all old case bodies, headers, inventory and dependency traces must compare equal before that explicit provenance update.
