# S18b-1 alarm delivery fixtures

Test data only; the server2 runtime never reads these files or any legacy file. Every token, coordinate, name and service account in them is synthetic.

- `alarm-oracle.json.gz` (sha256 `16615cac3e711482788b38e3c379b53e3413cf53bf09cd3fc041f553527fa00c`): pinned results of the legacy alarm worker for the S18b-1 parity test (`server2/tests/delivery/parity.rs`): 47 single deliveries (`ControllerPush.sendNotification`) and one scheduled minute (`ControllerPush.sendPush`) with 7 registrations.
- `rfc7515-a2-key.pkcs8.b64` (sha256 `57ea5536a0a770d015812a7c2bb2c82d829b8a7c564bdf64d82f93629a844149`): the public example RSA key of RFC 7515 Appendix A.2 (https://www.rfc-editor.org/rfc/rfc7515#appendix-A.2) as base64 PKCS#8 DER, extracted from the RFC text by `extract_jwk.py` and converted by `make-keys.js` below, which also checks that it reproduces the RFC A.2 signature. It signs the oracle and test service-account assertions; it is not a credential of any project.

## Recording

- Legacy source: repository revision `915978bb39f0dfa829b7af2aef14df4499c28997`; the sha256 of every legacy file loaded while recording is stored in `source.files` (97 files), including `server/controllers/controllerPush.js`.
- Runtime: Node.js `v16.20.2`, `TZ=UTC`, `NODE_ENV=production`; firebase-admin `5.13.1` (the legacy `server/package.json` pin), i18n `0.8.3`, async `2.6.2`, Mongoose `5.1.2` (models load; the store is a double).
- The real `ControllerPush` with the real firebase-admin over an `https.request` double that records every OAuth and FCM request (host, path, headers, body) and answers per case: JSON errors, a non-JSON 500 page, connection resets and a token-endpoint error. Weather and geocode requests (`request`) are a recording double answering with synthetic legacy-shaped bodies. The push store is a recording double. Every other network module throws. `Date` is a fixed clock (1 s per case; `advance` moves it past the cached access token).
- Two synthetic service accounts (`fcm-test-todayWeather.json`, `fcm-test-todayAir.json`, projects `tw-oracle`/`ta-oracle`) use the RFC 7515 key, so the RS256 assertions are deterministic and compared byte for byte.
- Run: `run-alarm.sh <out.json>`, then `gzip -n -9`. Recording twice gives identical bytes (checked).

## Differences the tests assert instead of the oracle

- `fcm-reset-*`: firebase-admin 5.13.1 retried a request once after a network error; server2 sends once and records an unknown outcome (D02). The test compares the first request only.
- OAuth: firebase-admin 5.13.1 used `https://accounts.google.com/o/oauth2/token` as token endpoint and assertion audience; server2 uses the endpoint Google documents (`https://oauth2.googleapis.com/token`). The test reproduces the oracle signature, replaces only the `aud` claim and re-signs with the same key.
- The scheduled minute: legacy sent concurrently in arrival order; the test compares FCM bodies and weather requests as multisets.

## Driver source

### `package.json` (sha256 `c971d073b4dd505a9bf3dfd5b6d0ed642e1a2d216a77c8a51565c8620bcb2a81`)

```json
{
  "name": "server2-s18-push-oracle",
  "version": "1.0.0",
  "private": true,
  "description": "S18 offline legacy push oracle (task evidence)",
  "dependencies": {
    "async": "2.6.2",
    "body-parser": "1.20.6",
    "cheerio": "0.20.0",
    "cookie-parser": "1.3.5",
    "cors": "2.8.5",
    "express": "4.13.4",
    "express-session": "1.15.6",
    "firebase-admin": "5.13.1",
    "i18n": "0.8.3",
    "mongoose": "5.1.2",
    "sprintf": "0.1.5",
    "xml2js": "0.4.19"
  }
}
```

### `run-alarm.sh` (sha256 `71e5d1eed0d32bd66577ba110fcd8ebd91c22195a2e2d6cb6936fee35b3c2800`)

```sh
#!/bin/bash
# Record the S18b-1 alarm oracle with the pinned runtime. Usage: run-alarm.sh <out.json>
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$D/../../.." && pwd)"
export TW_REPO="$REPO" TW_REVISION="$(cd "$REPO" && git merge-base HEAD origin/master)" TZ=UTC NODE_ENV=production NODE_PATH="$D/node_modules"
"$D/node-v16.20.2-darwin-arm64/bin/node" "$D/record-alarm.js" "$1" 2> "$D/stderr-alarm.log"
```

### `extract_jwk.py` (sha256 `1db7ce402a3b069b7643b958987a6b3cf78acb835ce067124006532e67ecdd4c`)

```python
import re, json, os
d = os.path.dirname(os.path.abspath(__file__))
t = open(os.path.join(d, 'rfc7515.txt')).read()
seg = t[t.index('"kty":"RSA",\n      "n":"ofgWCuLj'):]
seg = seg[:seg.index('}')]
jwk = {'kty': 'RSA'}
for k in ['n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi']:
    m = re.search(r'"%s":"([^"]+)"' % k, seg)
    jwk[k] = re.sub(r'\s+', '', m.group(1))
json.dump(jwk, open(os.path.join(d, 'rfc7515-a2.jwk.json'), 'w'))
print(len(jwk['n']))
```

### `make-keys.js` (sha256 `d2926c09c2737b175ac1bb5acbe4336c74d70a4333b97314242ca2e294a08f55`)

```js
'use strict';
// Test service accounts for the oracle, keyed with the public RFC 7515 A.2 example RSA key.
const crypto = require('crypto');
const fs = require('fs');
const jwk = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const key = crypto.createPrivateKey({key: jwk, format: 'jwk'});
const pem = key.export({type: 'pkcs8', format: 'pem'});
const input = 'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ';
const sig = crypto.sign('RSA-SHA256', Buffer.from(input), key).toString('base64url');
console.log('rfc signature prefix ok:', sig.startsWith('cC4hiUPoj9Eetdgtv3hF80EGrhuB__dzERat0XF9g2VtQgr9PJbu3XOiZj5RZmh7'));
for (const [name, project] of [['todayWeather', 'tw-oracle'], ['todayAir', 'ta-oracle']]) {
    fs.writeFileSync(__dirname + '/fcm-test-' + name + '.json', JSON.stringify({type: 'service_account', project_id: project,
        private_key_id: 'oracle', private_key: pem, client_email: 'oracle@' + project + '.iam.gserviceaccount.com'}));
}
fs.writeFileSync(__dirname + '/rfc7515-a2.pkcs8.b64', key.export({type: 'pkcs8', format: 'der'}).toString('base64'));
```

### `record-alarm.js` (sha256 `200389447f45ce5ba8adc9b1de778c7a02378c73d82f6d1bb7d00487947c2b07`)

```js
/* S18b-1 alarm worker oracle driver (task evidence, not a repository tool). Runs the legacy
 * `ControllerPush.sendNotification` and `sendPush` with firebase-admin 5.13.1 over an HTTPS double
 * and records weather requests, OAuth/FCM HTTP requests, store calls and outcomes. No network.
 * Run: node.sh record-alarm.js <out.json> */
'use strict';
const L = require('./legacy2');
const fs = require('fs');
const assert = require('assert');
if (process.version !== 'v16.20.2') throw new Error('Pinned oracle Node v16.20.2 required');
if (process.env.TZ !== 'UTC' || process.env.NODE_ENV !== 'production') throw new Error('TZ=UTC NODE_ENV=production required');
assert.strictEqual(require('firebase-admin/package.json').version, '5.13.1');
const S = require('./alarm-scenarios');
const ControllerPush = L.load('controllers/controllerPush.js');
const co = new ControllerPush();

const token = {status: 200, headers: {'content-type': 'application/json; charset=utf-8'},
    body: '{"access_token":"ya29.oracle-token","expires_in":3599,"token_type":"Bearer"}'};
const ok = {status: 200, headers: {'content-type': 'application/json; charset=UTF-8'}, body: '{"name":"projects/oracle/messages/1"}'};
const wrap = v => v === undefined ? {error: 'no response'} : (v.status !== undefined || v.error ? v : {status: 200, body: v});
const revive = rec => {
    const r = JSON.parse(JSON.stringify(rec));
    if (rec.updatedAt instanceof L.RealDate) r.updatedAt = new Date(rec.updatedAt.getTime());
    return r;
};
function route(c) {
    const fcm = (c.fcm || []).slice();
    L.ctl.http = url => {
        if (url.startsWith('http://api.test/geocode/')) return wrap(c.geo);
        if (url.includes('/kma/')) return wrap(c.kma);
        if (url.includes('/dsf/')) return wrap(c.dsf);
        return {error: 'unrouted'};
    };
    L.ctl.https = rec => rec.host === 'accounts.google.com' ? (c.token || token) : (fcm.shift() || ok);
}
const settle = () => new Promise(r => setTimeout(r, 30));
(async () => {
    const out = {schema: 1, oracle: {node: process.version, tz: process.env.TZ, 'firebase-admin': '5.13.1', mongoose: '5.1.2'},
        defaults: {token, fcm: ok}, cases: [], schedule: null};
    const base = L.RealDate.parse('2026-10-15T00:00:00.000Z');
    let i = 0;
    for (const [id, pushInfo, c] of S.cases) {
        L.clock.now = base + (++i) * 1000 + (c.advance || 0);
        L.ctl.calls.length = 0;
        route(c);
        const outcome = await new Promise(resolve => {
            co.sendNotification(revive(pushInfo), (err, result) => resolve(err ? {error: String(err.message || err)} : {result: result === undefined ? null : result}));
        });
        await settle();
        out.cases.push({id, at: new L.RealDate(L.clock.now).toISOString(), pushInfo: JSON.parse(JSON.stringify(pushInfo)),
            weather: {kma: c.kma === undefined ? null : wrap(c.kma), dsf: c.dsf === undefined ? null : wrap(c.dsf), geo: c.geo === undefined ? null : wrap(c.geo)},
            token: c.token || null, fcm: c.fcm || null, calls: JSON.parse(JSON.stringify(L.ctl.calls)), outcome});
    }
    // One scheduled minute.
    L.clock.now = L.RealDate.parse(S.schedule.now);
    L.ctl.calls.length = 0;
    route({kma: S.cases[0][2].kma, geo: {status: 200, body: {country: 'KR', kmaAddress: {name1: '서울특별시', name2: '중구'}, location: {lat: 37.56, long: 126.98}}}});
    L.ctl.store = {getAlarmsByTime: () => S.scheduled.map(revive), removeDuplicateAlarms: () => 'NONE'};
    const result = await new Promise(resolve => co.sendPush(S.schedule.time, (err, r) => resolve(err ? {error: String(err.message || err)} : {result: r})));
    await settle();
    out.schedule = {at: S.schedule.now, time: S.schedule.time, records: JSON.parse(JSON.stringify(S.scheduled)),
        weather: {kma: wrap(S.cases[0][2].kma)}, calls: JSON.parse(JSON.stringify(L.ctl.calls)), outcome: result};
    out.source = {revision: process.env.TW_REVISION || null, files: Object.fromEntries(Object.entries(L.sourceFiles).sort())};
    fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1) + '\n');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
```

### `legacy2.js` (sha256 `c88ff4e63b74c1c0d253b3f8b995b183dab1deeabc40871a7ae8ac15a9394c15`)

```js
/* Load the legacy alarm worker (controllerPush.js) offline for the S18b-1 oracle (task evidence,
 * not a repository tool). HTTP (`request`), Firebase, node-gcm and the push store are
 * controllable doubles that record every call; other network modules throw; `global.log` is
 * silent; Date is a fixed clock. Mongoose models load over the in-memory collection double. */
'use strict';
const Module = require('module');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const root = path.resolve(process.env.TW_REPO);
const server = path.join(root, 'server');
const sourceFiles = {};
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const RealDate = Date;
const clock = {now: RealDate.parse('2026-10-15T00:00:00.000Z')};
function FixedDate(...a) {
    if (!new.target) return RealDate();
    return a.length === 0 ? new RealDate(clock.now) : new RealDate(...a);
}
FixedDate.prototype = RealDate.prototype;
FixedDate.now = () => clock.now;
FixedDate.parse = RealDate.parse;
FixedDate.UTC = RealDate.UTC;
Object.defineProperty(FixedDate, 'name', {value: 'Date'});
global.Date = FixedDate;

// Per-case controls and recordings.
const ctl = {
    http: (url, options) => ({error: 'no response configured'}),
    // HTTPS (firebase-admin): returns {status, headers, body} | {error: code}
    https: rec => ({status: 200, headers: {'content-type': 'application/json'}, body: '{}'}),
    store: {},
    calls: [],
};
// firebase-admin reaches Google over https.request: route it to the per-case double.
const https = require('https');
const {EventEmitter} = require('events');
https.request = function (options, cb) {
    const req = new EventEmitter();
    const chunks = [];
    req.write = d => { chunks.push(Buffer.from(d)); };
    req.setTimeout = () => req;
    req.abort = () => { req.aborted = true; };
    req.end = d => {
        if (d) chunks.push(Buffer.from(d));
        const rec = {host: options.host || options.hostname, path: options.path, method: options.method,
            headers: options.headers || {}, body: Buffer.concat(chunks).toString()};
        ctl.calls.push(Object.assign({kind: 'https'}, rec));
        const r = ctl.https(rec);
        setImmediate(() => {
            if (r.error) {
                const e = new Error('socket hang up'); e.code = r.error; req.emit('error', e); return;
            }
            const res = new EventEmitter();
            res.statusCode = r.status; res.headers = r.headers || {};
            cb(res);
            res.emit('data', Buffer.from(r.body));
            res.emit('end');
        });
    };
    setImmediate(() => req.emit('socket', {setTimeout() {}, on() {}}));
    return req;
};
const noNetwork = () => { throw new Error('network access is not allowed in the oracle'); };
function request(options, cb) {
    const url = typeof options === 'string' ? options : options.url;
    ctl.calls.push({kind: 'http', url, headers: options.headers || null, json: !!options.json});
    const r = ctl.http(url, options);
    process.nextTick(() => {
        if (r.error) return cb(new Error(r.error));
        cb(null, {statusCode: r.status}, r.body);
    });
}
request.get = noNetwork; request.post = noNetwork; request.defaults = () => noNetwork;
const store = new Proxy({}, {get: (_, name) => function (...args) {
    const cb = args.pop();
    ctl.calls.push({kind: 'store', method: name, args: JSON.parse(JSON.stringify(args))});
    const r = ctl.store[name] ? ctl.store[name](...args) : {n: 1, ok: 1};
    process.nextTick(() => (r === 'NONE' ? cb(null) : cb(null, r)));
}});
const stubs = {
    request,
    dnscache: () => ({}),
    'node-gcm': {
        Sender: function () {
            this.send = (message, ids, retries, cb) => {
                ctl.calls.push({kind: 'gcm', retries, data: message.params ? message.params.data : null});
                process.nextTick(() => cb(new Error('gcm retired')));
            };
        },
        Message: function (o) { this.params = o; },
    },
    'get-pixels': noNetwork,
    'aws-sdk': {S3: function () { this.upload = noNetwork; this.listObjectsV2 = noNetwork; }, config: {update() {}}},
    axios: {get: noNetwork, post: noNetwork},
};
const rawLoad = Module._load;
Module._load = function (req, parent, isMain) {
    if (stubs[req]) return stubs[req];
    if (/lib\/log(\.js)?$/.test(req)) return function () { return global.log; };
    if (/config\/config(\.js)?$/.test(req)) {
        return {push: {gcmAccessKey: 'synthetic'}, serviceServer: {url: 'http://service.test'}, apiServer: {url: 'http://api.test'},
            db: {version: '2.0', path: '', options: {}}, keyString: {kakao_keys: '[]', daum_keys: '[]', google_key: 'x', normal: '', cert_key: '', aqi_keys: '[]', airkorea_keys: '[]'}, mode: 'push', gather: {},
            image: {airkorea_korea_image: {coordi: {}, size: {}, pixel_pos: {}}, kaq_korea_image: {coordi: {}, size: {}, pixel_pos: {}, so2_pixel_pos: {}},
                kaq_korea_modelimg_image: {coordi: {}, size: {}, pixel_pos: {}}}};
    }
    if (/lib\/pushProviders(\.js)?$/.test(req)) {
        // lib/pushProviders.js with the test service accounts instead of the private files.
        const firebase = rawLoad('firebase-admin', parent, false);
        const apps = {};
        return {firebase: product => {
            const name = product === 'todayAir' ? 'todayAir' : 'todayWeather';
            if (apps[name]) return apps[name];
            const credentials = JSON.parse(fs.readFileSync(path.join(__dirname, 'fcm-test-' + name + '.json'), 'utf8'));
            apps[name] = firebase.initializeApp({credential: firebase.credential.cert(credentials), projectId: credentials.project_id}, name);
            return apps[name];
        }};
    }
    if (/lib\/pushStore(\/index)?(\.js)?$/.test(req)) return {get: () => store};
    const resolved = Module._resolveFilename(req, parent, isMain);
    if (resolved.startsWith(server + path.sep) && resolved.endsWith('.js')) {
        sourceFiles[path.relative(root, resolved)] = hash(resolved);
    }
    return rawLoad.apply(this, arguments);
};
const silent = () => {};
global.log = {error: silent, warn: silent, info: silent, verbose: silent, debug: silent, silly: silent};

function load(rel) { return require(path.join(server, rel)); }
module.exports = {root, server, load, sourceFiles, clock, RealDate, ctl};
```

### `alarm-scenarios.js` (sha256 `876ca57b9e204216bdacb0f4c4839ad70bce237aca2932a2ac992793207d6f0b`)

```js
/* S18b-1 oracle scenarios for the legacy alarm worker (task evidence). Weather bodies start from
 * the S02 golden v000902 KMA and DSF responses; every token, name and coordinate is synthetic. */
'use strict';
const fs = require('fs');
const path = require('path');
const golden = JSON.parse(fs.readFileSync(path.join(process.env.TW_REPO, 'server2/tests/golden/records.json'), 'utf8'));
const body = id => JSON.parse(Buffer.from(golden.cases.find(c => c.id === id).body_base64, 'base64').toString());
const K0 = body('domestic-v000902');
const W0 = body('world-v000902');
const clone = v => JSON.parse(JSON.stringify(v));
const units = {temperatureUnit: 'C', windSpeedUnit: 'm/s', pressureUnit: 'hPa', distanceUnit: 'km',
    precipitationUnit: 'mm', airUnit: 'airkorea', airForecastSource: 'kaq'};
const day = (k, n) => k.midData.dailyData.find(d => d.fromToday === n);

function kma(mut) { const k = clone(K0); if (mut) mut(k); return k; }
function dsf(mut) { const w = clone(W0); if (mut) mut(w); return w; }
const evening = k => { k.current.dateObj = '2026.09.24 19:30'; };
const pollutants = {
    pm25: {daily: [{fromToday: 0, val: 20, grade: 2, str: '보통'}, {fromToday: 1, val: 45, grade: 3, str: '나쁨'}]},
    pm10: {daily: [{fromToday: 0, val: 40, grade: 2, str: '보통'}, {fromToday: 1, val: 25, grade: 1, str: '좋음'}]},
    o3: {daily: [{fromToday: 0, val: 0.03, grade: 1, str: '좋음'}, {fromToday: 1, val: 0.1, grade: 3, str: '나쁨'}]},
};
const ok = {status: 200, headers: {'content-type': 'application/json; charset=UTF-8'}, body: '{"name":"projects/oracle/messages/1"}'};
const fcmError = (status, code, fcm) => ({status, headers: {'content-type': 'application/json; charset=UTF-8'},
    body: JSON.stringify({error: {code: status, message: 'synthetic ' + code, status: code,
        details: fcm ? [{'@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: fcm}] : undefined}})});
const record = extra => Object.assign({type: 'ios', fcmToken: 'fcm-1', cityIndex: 1, id: 1, geo: [126.97, 37.56], source: 'KMA',
    name: '집', lang: 'ko', package: 'todayWeather', units: clone(units), pushTime: 79200, enable: true}, extra);

const cases = [
    ['kma-tw-morning', record(), {kma: kma()}],
    ['kma-tw-evening', record({lang: 'en'}), {kma: kma(evening)}],
    ['kma-tw-rain-dust', record(), {kma: kma(k => {
        evening(k);
        const d0 = day(k, 0), d1 = day(k, 1);
        Object.assign(d0, {skyAm: 'sun', skyPm: 'sun_bigcloud_rain', wfAm: '맑음', wfPm: '구름많고 비', tmn: 18, tmx: 24.6});
        Object.assign(d1, {skyAm: 'cloud_rain', skyPm: 'sun_smallcloud', wfAm: '흐리고 비', wfPm: '구름적고', tmn: 15.5, tmx: 21, pty: 1, pop: 70,
            dustForecast: {pm10Grade: 2, pm25Grade: 3, pm10Str: '보통', pm25Str: '나쁨', o3Str: '좋음'}});
    })}],
    ['kma-tw-current-rain', record(), {kma: kma(k => {
        Object.assign(k.current, {pty: 1, rn1: 2.5, skyIcon: 'Cloud_Rain', t1h: 0,
            arpltn: {pm10Grade: 3, pm10Str: '나쁨', pm25Grade: 3, pm25Str: '나쁨', khaiGrade: 2, khaiStr: '보통'}});
        Object.assign(day(k, 0), {pty: 1, pop: 60, dustForecast: {pm10Grade: 2, pm25Grade: 2, pm10Str: '보통', pm25Str: '보통'}});
    })}],
    ['kma-tw-aqi-order', record(), {kma: kma(k => {
        k.current.arpltn = {o3Grade: 3, o3Str: '나쁨', khaiGrade: 4, khaiStr: '매우나쁨'};
    })}],
    ['kma-tw-pollutants', record({lang: 'en'}), {kma: kma(k => {
        evening(k);
        k.airInfo.pollutants = {aqi: {daily: [{fromToday: 1, val: 50, grade: 2, str: 'Moderate'}]}, pm25: pollutants.pm25};
    })}],
    ['kma-tw-pollutants-pm10', record({lang: 'de'}), {kma: kma(k => {
        k.airInfo.pollutants = {pm25: {daily: [{fromToday: 1, val: 1}]}, pm10: pollutants.pm10, o3: pollutants.o3};
    })}],
    ['kma-ta-air', record({package: 'todayAir', lang: 'ja'}), {kma: kma(k => {
        k.current.summaryAir = '대기질은 보통입니다.';
        k.airInfo.pollutants = clone(pollutants);
    })}],
    ['kma-ta-air-evening', record({package: 'todayAir'}), {kma: kma(k => {
        evening(k);
        k.current.summaryAir = '대기질은 보통입니다.';
        k.airInfo.pollutants = clone(pollutants);
    })}],
    ['kma-ta-no-summary', record({package: 'todayAir'}), {kma: kma(k => { k.airInfo.pollutants = clone(pollutants); })}],
    ['kma-ta-max-index', record({package: 'todayAir', lang: 'zh-CN'}), {kma: kma(k => {
        k.current.summaryAir = 'x';
        k.airInfo.pollutants = {pm25: {daily: [{fromToday: 0, val: 10, grade: 1, str: '좋음'}]},
            o3: {daily: [{fromToday: 0, val: 0.2, grade: 3, str: '나쁨'}]}, aqi: {daily: [{fromToday: 0, val: 200, grade: 4}]}};
    })}],
    ['kma-ta-good', record({package: 'todayAir', lang: 'zh-TW'}), {kma: kma(k => {
        k.current.summaryAir = 'x';
        k.airInfo.pollutants = {pm25: {daily: [{fromToday: 0, val: 10, grade: 1, str: '좋음'}]}};
    })}],
    ['kma-ta-no-pollutants', record({package: 'todayAir'}), {kma: kma(k => { k.current.summaryAir = 'y'; })}],
    ['kma-missing-target', record(), {kma: kma(k => {
        evening(k);
        k.midData.dailyData = k.midData.dailyData.filter(d => d.fromToday !== 1);
    })}],
    ['kma-missing-wf', record(), {kma: kma(k => { delete day(k, 0).wfAm; day(k, 0).skyAm = 'sun'; day(k, 0).skyPm = 'sun'; })}],
    ['kma-town-only', record({geo: undefined, source: undefined, lang: 'zh-TW', units: {temperatureUnit: 'F', airUnit: 'aqicn'},
        town: {first: '서울특별시', second: '송파구', third: '잠실본동'}}), {kma: kma()}],
    ['kma-no-units-body', record({package: 'todayAir', units: undefined, lang: undefined}), {kma: kma(k => {
        delete k.units; k.current.summaryAir = 'z'; k.airInfo.pollutants = clone(pollutants);
    })}],
    ['kma-name-from-body', record({name: undefined}), {kma: kma()}],
    ['geo-kr', record({cityIndex: 0, id: 0, source: undefined, name: undefined}), {
        geo: {status: 200, body: {country: 'KR', kmaAddress: {name1: '서울특별시', name2: '중구', name3: '명동'}, location: {lat: 37.5636, long: 126.9869}}},
        kma: kma()}],
    ['geo-kr-short-name', record({cityIndex: 0, id: 0, source: 'KMA'}), {
        geo: {status: 200, body: {country: 'KR', kmaAddress: {name1: '서'}, location: {lat: 37.5, long: 127}}}, kma: kma()}],
    ['geo-foreign', record({cityIndex: 0, id: 0, name: 'Paris'}), {geo: {status: 200, body: {country: 'FR'}}, dsf: dsf()}],
    ['geo-500', record({cityIndex: 0, id: 0}), {geo: {status: 500, body: 'error'}}],
    ['geo-invalid', record({cityIndex: 0, id: 0}), {geo: {status: 200, body: {country: 'KR', kmaAddress: {name1: 'x'}}}}],
    ['source-vc', record({source: 'VC', name: 'Paris', lang: 'en', units: {temperatureUnit: 'F'}}), {dsf: dsf()}],
    ['dsf-evening-rain', record({source: 'DSF', name: 'Paris', lang: 'fr'}), {dsf: dsf(w => {
        Object.assign(w.thisTime[1], {dateObj: '2026.09.26 19:00', pty: 1, rn1: 1.2, skyIcon: 'cloud_rain',
            arpltn: {pm25Grade: 3, pm25Str: 'Unhealthy', pm10Grade: 2}});
    })}],
    ['dsf-morning-dry', record({source: 'VC', name: undefined, lang: 'ko'}), {dsf: dsf(w => {
        Object.assign(w.thisTime[1], {dateObj: '2026.09.26 08:00', t1h: 0});
    })}],
    ['dsf-ta-summary', record({source: 'VC', package: 'todayAir'}), {dsf: dsf(w => { w.thisTime[1].summaryAir = 'Air quality is moderate'; })}],
    ['dsf-ta-noair', record({source: 'VC', package: 'todayAir'}), {dsf: dsf(w => { delete w.airInfo; })}],
    ['unknown-source-geo', record({source: 'XX'}), {geo: {status: 200, body: {country: 'JP'}}, dsf: dsf()}],
    ['invalid', record({geo: undefined, source: undefined, town: undefined}), {}],
    ['weather-500', record(), {kma: {status: 500, body: 'oops'}}],
    ['weather-transport', record(), {kma: {error: 'ECONNREFUSED'}}],
    ['fcm-not-found', record({fcmToken: 'fcm-gone'}), {kma: kma(), fcm: [fcmError(404, 'NOT_FOUND', 'UNREGISTERED')]}],
    ['fcm-invalid-argument', record(), {kma: kma(), fcm: [fcmError(400, 'INVALID_ARGUMENT', 'INVALID_ARGUMENT')]}],
    ['fcm-quota', record(), {kma: kma(), fcm: [fcmError(429, 'RESOURCE_EXHAUSTED', 'QUOTA_EXCEEDED')]}],
    ['fcm-unavailable', record(), {kma: kma(), fcm: [fcmError(503, 'UNAVAILABLE', 'UNAVAILABLE')]}],
    ['fcm-html-500', record(), {kma: kma(), fcm: [{status: 500, headers: {'content-type': 'text/html'}, body: '<html>oops</html>'}]}],
    ['fcm-reset-then-ok', record(), {kma: kma(), fcm: [{error: 'ECONNRESET'}, ok]}],
    ['fcm-reset-twice', record(), {kma: kma(), fcm: [{error: 'ECONNRESET'}, {error: 'ECONNRESET'}]}],
    ['token-error', record(), {advance: 7200000, kma: kma(), token: {status: 400, headers: {'content-type': 'application/json'}, body: '{"error":"invalid_grant","error_description":"Invalid JWT"}'}}],
    ['after-token-error', record(), {advance: 7200000, kma: kma()}],
    ['ios-no-fcm', record({fcmToken: undefined, registrationId: 'reg-ios'}), {kma: kma()}],
    ['android-gcm', record({type: 'android', fcmToken: undefined, registrationId: 'reg-android'}), {kma: kma()}],
    ['android-no-reg', record({type: 'android', fcmToken: undefined}), {kma: kma()}],
    ['unknown-type', record({type: 'web', fcmToken: undefined}), {kma: kma()}],
    ['today-air-app', record({package: 'todayAir', fcmToken: 'fcm-ta'}), {kma: kma(k => { k.current.summaryAir = 'x'; })}],
    ['android-fcm', record({type: 'android', fcmToken: 'fcm-android', registrationId: 'reg-ignored', cityIndex: undefined}), {kma: kma()}],
];

// sendPush(time) at 2026-10-15T22:00:00Z (Thursday UTC; Friday 07:00 at UTC+9).
const days = (a) => a;
const at = iso => new Date(iso);
const scheduled = [
    record({fcmToken: 's-1', dayOfWeek: days([true, true, true, true, true, true, true]), timezoneOffset: 540, updatedAt: at('2026-10-10T00:00:00Z')}),
    record({fcmToken: 's-2', dayOfWeek: days([true, true, true, true, true, false, true]), timezoneOffset: 540, updatedAt: at('2026-10-10T00:00:00Z')}),
    record({fcmToken: 's-3', dayOfWeek: days([false, false, false, false, true, false, false]), timezoneOffset: -300, updatedAt: at('2026-10-10T00:00:00Z')}),
    record({fcmToken: 's-4', dayOfWeek: days([true, true]), updatedAt: at('2026-10-10T00:00:00Z')}),
    record({fcmToken: 's-5', dayOfWeek: [], updatedAt: at('2026-08-01T00:00:00Z')}),
    record({fcmToken: 's-6'}),
    record({fcmToken: 's-7', cityIndex: 0, id: 0, updatedAt: at('2026-08-15T21:59:59Z')}),
];
module.exports = {cases, scheduled, schedule: {now: '2026-10-15T22:00:00.000Z', time: 79200}};
```
