# S18a push registration oracle fixture

`push-oracle.json.gz` (sha256 `a5d08a3b12889e2f8885638cb94cdf51bfde8d63ae23ae1f01dc5387c52f0c60`) holds pinned legacy-oracle results for the S18a parity test (`server2/tests/state/parity.rs`). It is test data only; the server2 runtime never reads it or any legacy file. Every token, coordinate and name in it is synthetic.

## Recording

- Legacy source: repository revision `1d60f728e2bf4498da5ef82b3de6080f5cda9124`; the sha256 of every legacy file loaded while recording is stored in `source.files` (13 files).
- Runtime: Node.js `v16.20.2`, `TZ=UTC`, `NODE_ENV=production`; Express `4.13.4`, body-parser `1.20.6`, cors `2.8.5`, express-session `1.15.6`, async `2.6.2`, cookie-parser `1.3.5` and Mongoose `5.1.2` (driver 3.0.8, bson 1.0.9).
- The legacy app middleware order of `server/app.js` (cors, session, body-parser json and urlencoded, cookie-parser, `/v000705` and `/v000902` routers with their `decodeURI` middleware, 404 and the three-argument handlers). Other route modules are empty routers; network, provider and weather modules are stubs that throw.
- The real Mongoose models over an in-memory collection double (adapted from the S15b double): write results follow the MongoDB write-command reply core (`{n, upserted?, nModified, ok}`, delete `{n, ok}`); replica-set metadata is not modelled. `Date` and ObjectId generation are deterministic (seconds of the fixed clock, `a5a5a5a5a5`, a counter). The HTTP `date` header is not recorded.
- 9 scenarios, 115 requests; each step records the exact bytes sent, the status, raw headers, body and both collections after the request.
- Run: `run.sh <out.json>`, then `gzip -n -9`. Recording twice gives identical bytes (checked).

## What the fixture does not model

- MongoDB operator keys in request bodies (`$inc`, `{"$ne": ...}` query values): legacy passed them to MongoDB; server2 drops update operators and rejects operator query values as cast errors (deliberate, no operator injection).
- A request body `_id` that casts as an ObjectId (MongoDB refuses to change `_id`; server2 ignores it) and a `$set` naming a field and its sub-field together (MongoDB 3.4 error text, not recorded).
- Replica-set reply metadata (`opTime`, `electionId`, `$clusterTime`, `operationTime`) in write results.

## Driver source

### `package.json` (sha256 `ef7b17853f2407f1738cfa8691ee6851be2925122a5d6411e314085b44f7a728`)

```json
{
  "name": "server2-s18-push-oracle",
  "version": "1.0.0",
  "private": true,
  "description": "S18 offline legacy push oracle (task evidence)",
  "dependencies": {
    "async": "2.6.2",
    "express": "4.13.4",
    "express-session": "1.15.6",
    "body-parser": "1.20.6",
    "cookie-parser": "1.3.5",
    "cors": "2.8.5",
    "mongoose": "5.1.2"
  }
}
```

### `run.sh` (sha256 `ae8e52417cad8e8c22b19379f953cd986702ebc31b1753269c8520e95a79b878`)

```sh
#!/bin/bash
# Run the S18 push oracle with the pinned runtime. Usage: run.sh <out.json>
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$D/../../.." && pwd)"
export TW_REPO="$REPO" TW_REVISION="$(cd "$REPO" && git rev-parse HEAD)" TZ=UTC NODE_ENV=production NODE_PATH="$D/node_modules"
"$D/node-v16.20.2-darwin-arm64/bin/node" "$D/record.js" "$1" 2> "$D/stderr.log"
```

### `record.js` (sha256 `09fc3ca8646c5a3056933528550cd9d6aa5d74d5174b9f4cdf4cbfdb8e64ecb5`)

```js
/* S18 push registration oracle driver (task evidence, not a repository tool). Runs the legacy
 * push routes (routePushNotification.js, route.push.update.list.js) behind the legacy app
 * middleware order with Mongoose 5.1.2 over the in-memory collection double. No network.
 * Run: TW_REPO=<repo> TZ=UTC NODE_ENV=production node record.js <out.json> */
'use strict';
const L = require('./legacy');
const fake = require('./fakemongo');
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
if (process.version !== 'v16.20.2') throw new Error('Pinned oracle Node v16.20.2 required');
if (process.env.TZ !== 'UTC' || process.env.NODE_ENV !== 'production') throw new Error('TZ=UTC NODE_ENV=production required');
const mongoose = require('mongoose');
assert.strictEqual(require('mongoose/package.json').version, '5.1.2');
const express = require('express');
assert.strictEqual(require('express/package.json').version, '4.13.4');
const bson = require('bson');

// Deterministic ObjectIds: 4-byte seconds of the fixed clock, 5 fixed bytes, 3-byte counter.
let counter = 0;
bson.ObjectID.prototype.generate = function (time) {
    if (typeof time !== 'number') time = Math.floor(L.clock.now / 1000);
    counter = (counter + 1) % 0xffffff;
    const b = Buffer.alloc(12);
    b.writeUInt32BE(time >>> 0, 0);
    b.write('a5a5a5a5a5', 4, 'hex');
    b.writeUIntBE(counter, 9, 3);
    return b;
};
fake.setIdSource(() => new mongoose.Types.ObjectId());

// Legacy route modules other than push are empty routers (they never match these paths).
const Module = require('module');
const pushFiles = new Set(['routes/v000705/routePushNotification.js', 'routes/v000902/route.push.update.list.js',
    'routes/v000705/index.js', 'routes/v000902/index.js']);
const rawLoad = Module._load;
Module._load = function (request, parent, isMain) {
    let resolved;
    try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return rawLoad.apply(this, arguments); }
    const rel = path.relative(L.server, resolved);
    if (rel.startsWith('routes/') && !pushFiles.has(rel)) return express.Router();
    return rawLoad.apply(this, arguments);
};

const PushInfo = L.load('models/modelPush.js');
const AlertPush = L.load('models/alert.push.model.js');
let alarms = fake.attach(PushInfo);
let alerts = fake.attach(AlertPush);

function appFor() {
    const app = express();
    app.use(require('cors')());
    app.use(require('express-session')({secret: 'wizard factory', resave: false, saveUninitialized: true,
        cookie: {maxAge: 60000}, genid: () => 'oracle-session'}));
    const bodyParser = require('body-parser');
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({extended: false}));
    app.use(require('cookie-parser')());
    app.use('/v000705', L.load('routes/v000705/index.js'));
    app.use('/v000902', L.load('routes/v000902/index.js'));
    app.use(function (req, res, next) {
        const err = new Error('Not Found url=' + req.originalUrl);
        err.status = 404;
        next(err);
    });
    // app.js "error handlers" take three parameters: Express treats them as ordinary middleware.
    app.use(function (err, req, res) { res.status(500); res.end('unreachable'); });
    return app;
}

function send(port, step) {
    return new Promise((resolve, reject) => {
        const headers = Object.assign({}, step.headers || {});
        let body = null;
        if (step.raw !== undefined) body = Buffer.from(step.raw, 'utf8');
        else if (step.json !== undefined) { body = Buffer.from(JSON.stringify(step.json), 'utf8'); headers['content-type'] = headers['content-type'] || 'application/json'; }
        if (body && step.gzip) body = zlib.gzipSync(body);
        if (body) headers['content-length'] = String(body.length);
        step.sent = {headers, body_base64: body ? body.toString('base64') : null};
        const req = http.request({host: '127.0.0.1', port, method: step.method, path: step.path, headers}, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const raw = [];
                for (let i = 0; i < res.rawHeaders.length; i += 2) { const k = res.rawHeaders[i].toLowerCase(); raw.push([k, k === 'date' ? '(transport date, not recorded)' : res.rawHeaders[i + 1]]); }
                resolve({status: res.statusCode, headers: raw, body_base64: Buffer.concat(chunks).toString('base64')});
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

const S = require('./scenarios');
(async () => {
    const app = appFor();
    const srv = http.createServer(app);
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const out = {schema: 1, oracle: {node: process.version, tz: process.env.TZ, node_env: process.env.NODE_ENV,
        mongoose: '5.1.2', express: '4.13.4', 'body-parser': require('body-parser/package.json').version,
        cors: require('cors/package.json').version, 'express-session': require('express-session/package.json').version},
        start: new L.RealDate(L.clock.now).toISOString(), scenarios: []};
    const base = L.clock.now;
    for (const sc of S.scenarios) {
        counter = 0;
        alarms.docs = []; alerts.docs = []; alarms.calls = []; alerts.calls = [];
        for (const d of sc.seed && sc.seed.pushes || []) alarms.docs.push(fake.bson(revive(d)));
        for (const d of sc.seed && sc.seed.alertpushes || []) alerts.docs.push(fake.bson(revive(d)));
        const steps = [];
        for (let i = 0; i < sc.steps.length; i++) {
            L.clock.now = base + (i + 1) * 1000;
            const step = sc.steps[i];
            const r = await send(port, step);
            // Let fire-and-forget store callbacks settle before the next request.
            await new Promise(res => setTimeout(res, 20));
            const sent = step.sent;
            delete step.sent;
            steps.push(Object.assign({at: new L.RealDate(L.clock.now).toISOString(), request: step, sent}, r,
                {collections: {pushes: alarms.docs.map(fake.ejson), alertpushes: alerts.docs.map(fake.ejson)}}));
        }
        out.scenarios.push({id: sc.id, note: sc.note, seed: sc.seed || null, steps});
        L.clock.now = base;
    }
    srv.close();
    out.source = {revision: process.env.TW_REVISION, files: Object.fromEntries(Object.entries(L.sourceFiles).sort())};
    fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1) + '\n');
})().catch(e => { console.error(e); process.exit(1); });

function revive(v) {
    if (Array.isArray(v)) return v.map(revive);
    if (v && typeof v === 'object') {
        if (v.$oid) return new mongoose.Types.ObjectId(v.$oid);
        if (v.$date) return new L.RealDate(v.$date);
        const o = {};
        for (const k of Object.keys(v)) o[k] = revive(v[k]);
        return o;
    }
    return v;
}
```

### `legacy.js` (sha256 `d7ecd6a95ad63e8e35e73a14c2d2e6cd96f611f21c9b0e41c8d331ea8905dbd5`)

```js
/* Load the legacy push routes offline for the S18 oracle (task evidence, not a repository tool).
 * Network, provider and weather modules are stubs that throw; `global.log` is silent; the real
 * Mongoose 5.1.2 models get the in-memory collection double; Date and ObjectId generation are
 * deterministic. */
'use strict';
const Module = require('module');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const root = path.resolve(process.env.TW_REPO);
const server = path.join(root, 'server');
const sourceFiles = {};
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// Deterministic clock: `new Date()` and Date.now() read `clock.now`.
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

const noNetwork = () => { throw new Error('network access is not allowed in the oracle'); };
const stubs = {
    request: Object.assign(noNetwork, {get: noNetwork, post: noNetwork, defaults: () => noNetwork}),
    dnscache: () => ({}),
    'node-gcm': {Sender: function () { this.send = noNetwork; }, Message: function () {}},
    'firebase-admin': {initializeApp: noNetwork, apps: []},
    i18n: {configure() {}, __: k => k, init: (q, s, n) => n()},
    sprintf: noNetwork,
};
const rawLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (stubs[request]) return stubs[request];
    if (/config\/config(\.js)?$/.test(request)) {
        return {push: {gcmAccessKey: 'synthetic'}, serviceServer: {url: 'http://unused.invalid'}, db: {version: '2.0'}};
    }
    if (/lib\/pushProviders(\.js)?$/.test(request)) return {firebase: noNetwork};
    if (/controllerTown24h(\.js)?$/.test(request)) return function () {};
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (resolved.startsWith(server + path.sep) && resolved.endsWith('.js')) {
        sourceFiles[path.relative(root, resolved)] = hash(resolved);
    }
    return rawLoad.apply(this, arguments);
};
const silent = () => {};
global.log = {error: silent, warn: silent, info: silent, verbose: silent, debug: silent, silly: silent};

function load(rel) { return require(path.join(server, rel)); }
module.exports = {root, server, load, sourceFiles, clock, RealDate};
```

### `fakemongo.js` (sha256 `4b19e6aa5915483d91ed374f1b7e1dac35f74544e237160a4191bec417d60e70`)

```js
/* In-memory MongoDB collection double for the S18 push oracle (task evidence, not a repository
 * tool). Adapted from the S15b oracle double. Implements the driver calls the legacy push store
 * makes through Mongoose 5.1.2: find, update (upsert/multi), insertOne, remove. Results follow the
 * MongoDB write-command reply core: update `{n, upserted?, nModified, ok}`, delete `{n, ok}`
 * (replica-set metadata is not modelled). MongoDB < 5.0 field order (existing fields keep their
 * position, new fields are appended in update order; an upsert starts with _id and the query's
 * equality fields) and a BSON round trip (undefined -> null). nModified counts documents whose
 * stored value changed. Upserted ids come from the patched ObjectId generator. */
'use strict';
function bson(v) {
    if (v === undefined || v === null) return null;
    if (v instanceof Date) return new Date(v.getTime());
    if (Array.isArray(v)) return v.map(bson);
    if (typeof v === 'object') {
        if (v._bsontype === 'ObjectID' || v._bsontype === 'ObjectId') return v;
        const o = {};
        for (const k of Object.keys(v)) o[k] = bson(v[k]);
        return o;
    }
    if (typeof v === 'number' && Object.is(v, -0) ) return v;
    return v;
}
function same(a, b) { return JSON.stringify(ejson(a)) === JSON.stringify(ejson(b)); }
function get(doc, path) {
    let cur = doc;
    for (const p of path.split('.')) {
        if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
        cur = cur[p];
    }
    return cur;
}
function eq(a, b) {
    if (a && a._bsontype) a = a.toHexString();
    if (b && b._bsontype) b = b.toHexString();
    if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
    if ((a === undefined || a === null) && b === null) return true;
    if (Array.isArray(a) && !Array.isArray(b)) return a.some(x => eq(x, b));
    if (a && typeof a === 'object' && b && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
    return a === b;
}
function matches(doc, q) {
    return Object.keys(q || {}).every(k => {
        const c = q[k];
        if (c && typeof c === 'object' && !Array.isArray(c) && !(c instanceof Date) && !c._bsontype &&
            Object.keys(c).some(x => x[0] === '$')) {
            if (Object.keys(c).length === 1 && Array.isArray(c.$in)) return c.$in.some(x => eq(get(doc, k), x));
            throw new Error('fakemongo: unsupported operator in ' + k);
        }
        return eq(get(doc, k), c);
    });
}
function setPath(doc, path, value) {
    const parts = path.split('.');
    let cur = doc;
    for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] === undefined || cur[parts[i]] === null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
        cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = bson(value);
}
function apply(doc, update, inserting) {
    for (const op of Object.keys(update)) {
        const body = update[op];
        if (op === '$set' || (op === '$setOnInsert' && inserting)) {
            for (const k of Object.keys(body)) setPath(doc, k, body[k]);
        } else if (op === '$setOnInsert') {
            // not inserting
        } else {
            throw new Error('fakemongo: unsupported update ' + op);
        }
    }
}
let newId = null;
class FakeCollection {
    constructor(name) { this.name = name; this.docs = []; this.calls = []; }
    find(query, options, cb) {
        if (typeof options === 'function') { cb = options; options = {}; }
        const out = this.docs.filter(d => matches(d, query)).map(d => bson(d));
        this.calls.push({op: 'find', query: ejson(query), found: out.length});
        const cursor = {toArray: done => done(null, out)};
        if (cb) cb(null, cursor);
        return cursor;
    }
    update(query, update, options, cb) {
        if (typeof options === 'function') { cb = options; options = {}; }
        options = options || {};
        this.calls.push({op: 'update', query: ejson(query), update: ejson(update), options: {upsert: !!options.upsert, multi: !!options.multi}});
        const hits = this.docs.filter(d => matches(d, query));
        const targets = options.multi ? hits : hits.slice(0, 1);
        let modified = 0;
        for (const d of targets) {
            const before = bson(d);
            apply(d, update, false);
            if (!same(before, d)) modified++;
        }
        let result;
        if (!targets.length && options.upsert) {
            const doc = {_id: newId()};
            for (const k of Object.keys(query)) {
                if (k[0] === '$' || k === '_id') continue;
                setPath(doc, k, query[k]);
            }
            apply(doc, update, true);
            this.docs.push(doc);
            result = {n: 1, upserted: [{index: 0, _id: doc._id}], nModified: 0, ok: 1};
        } else {
            result = {n: targets.length, nModified: modified, ok: 1};
        }
        process.nextTick(() => cb(null, {result}));
    }
    insertOne(doc, options, cb) {
        if (typeof options === 'function') { cb = options; options = {}; }
        this.calls.push({op: 'insertOne', doc: ejson(doc)});
        this.docs.push(bson(doc));
        process.nextTick(() => cb(null, {result: {n: 1, ok: 1}, insertedCount: 1}));
    }
    remove(query, options, cb) {
        if (typeof options === 'function') { cb = options; options = {}; }
        this.calls.push({op: 'remove', query: ejson(query)});
        const before = this.docs.length;
        this.docs = this.docs.filter(d => !matches(d, query));
        const result = {n: before - this.docs.length, ok: 1};
        process.nextTick(() => cb(null, {result}));
    }
    ensureIndex(...args) { const cb = args.find(a => typeof a === 'function'); if (cb) process.nextTick(() => cb(null, 'idx')); }
    createIndex(...args) { return this.ensureIndex(...args); }
}
function attach(model) {
    const fake = new FakeCollection(model.collection.name);
    model.collection.buffer = false;
    model.collection.collection = fake;
    return fake;
}
function ejson(v) {
    if (v === undefined) return {$undefined: true};
    if (v instanceof Date) return {$date: v.toISOString()};
    if (v && v._bsontype) return {$oid: v.toHexString()};
    if (Array.isArray(v)) return v.map(ejson);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = ejson(v[k]); return o; }
    if (typeof v === 'number' && !isFinite(v)) return {$numberDouble: String(v)};
    return v;
}
module.exports = {FakeCollection, attach, ejson, bson, setIdSource: f => { newId = f; }};
```

### `scenarios.js` (sha256 `fcf97fe99842f86263fedd357f72752b4c3c3793a7165ed1c812559a532bb326`)

```js
/* S18 oracle scenarios (task evidence). Synthetic tokens and coordinates only. */
'use strict';
const units = {temperatureUnit: 'C', windSpeedUnit: 'm/s', pressureUnit: 'hPa', distanceUnit: 'km',
    precipitationUnit: 'mm', airUnit: 'airkorea', airForecastSource: 'kaq'};
const town = {first: '서울특별시', second: '송파구', third: '잠실본동'};
const loc = {lat: 37.5, long: 127.1};
function alarm(token, cityIndex, id, extra) {
    return Object.assign({type: 'ios', cityIndex, id, category: 'alarm', enable: true, name: '잠실본동', location: loc,
        town, source: 'KMA', units, timezoneOffset: 540, package: 'todayWeather', uuid: 'uuid-1', appVersion: '1.1.0',
        fcmToken: token, pushTime: 79200, dayOfWeek: [false, true, true, true, true, true, false]}, extra || {});
}
function alert(token, cityIndex, id, extra) {
    return Object.assign({type: 'ios', cityIndex, id, category: 'alert', enable: true, name: '잠실본동', location: loc,
        town, source: 'KMA', units, timezoneOffset: 540, package: 'todayWeather', uuid: 'uuid-1', appVersion: '1.1.0',
        fcmToken: token, startTime: 82800, endTime: 46800, airAlertsBreakPoint: 3}, extra || {});
}
const ko = {'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8', 'device-id': 'uuid-1'};
const json = 'application/json';
const P = (path, body, headers) => ({method: 'POST', path, json: body, headers});
const U = (body, headers) => ({method: 'PUT', path: '/v000902/push', json: body, headers});
const D = (body, headers) => ({method: 'DELETE', path: '/v000902/push', json: body, headers});
const L = (body, headers) => P('/v000902/push-list', body, headers || ko);
const oid = n => ({$oid: '6a0000000000000000' + String(n).padStart(6, '0')});
const at = s => ({$date: s});

const scenarios = [
    {id: 'client-lifecycle', note: 'current client: first PUT without old token, list, refresh, rotate, delete city and all',
        steps: [
            U({newToken: 'tok-1', oldToken: null}),
            L([alarm('tok-1', 0, 1), alert('tok-1', 0, 0)]),
            L([alarm('tok-1', 0, 1), alert('tok-1', 0, 0)]),
            L([alarm('tok-1', 1, 2, {name: 'Paris', location: {lat: 48.85, long: 2.35}, town: undefined, source: 'VC'}),
                alert('tok-1', 1, 3, {source: 'VC', town: undefined, units: Object.assign({}, units, {airUnit: 'aqicn'}), airAlertsBreakPoint: 4})]),
            U({newToken: 'tok-2', oldToken: 'tok-1'}),
            U({newToken: 'tok-2', oldToken: 'tok-2'}),
            D({cityIndex: 1, fcmToken: 'tok-2'}),
            D({fcmToken: 'tok-2', category: 'alert'}),
            D({fcmToken: 'tok-2'}),
            D({fcmToken: 'tok-2'}),
        ]},
    {id: 'push-list-validation', note: 'request validation precedes every store call',
        steps: [
            L({}), L('not-an-array-but-json-string'), L([]), L([null]), L([5]), L(['abc']), L([{}]),
            L([{type: ''}]), L([{type: 'ios'}]), L([{type: 'ios', fcmToken: ''}]),
            L([{type: 'ios', fcmToken: '', registrationId: ''}]), L([{type: 'ios', fcmToken: 't'}]),
            L([{type: 'ios', fcmToken: 't', town: null, category: 'bogus'}]),
            L([{type: 'ios', fcmToken: 't', location: null, category: null}]),
            L([alarm('t', 0, 1), {type: 'ios'}]),
            L([{type: 'ios', fcmToken: null, location: loc}]),
            L([{type: 5, fcmToken: 7, location: loc, cityIndex: 0}]),
            L([{type: 'ios', registrationId: 'r', fcmToken: '', location: loc}]),
            L([{hasOwnProperty: 1, type: 'ios'}]),
        ]},
    {id: 'push-list-items', note: 'per-item store outcomes inside one 200 array, defaults and casting',
        steps: [
            L([alarm('t1', 0, 1, {location: {lat: 37.5}}), alarm('t1', 2, 2, {location: undefined, town: {first: ''}}),
                alarm('t1', 3, 3, {location: undefined}), alert('t1', 4, 4, {location: undefined, town: {second: 'x'}})], {}),
            L([{type: 'android', fcmToken: 't2', location: loc, cityIndex: 0}], {'accept-language': 'de-DE'}),
            L([{type: 'android', fcmToken: 't2', location: loc, cityIndex: 0, category: 'alarm', units: {airUnit: 'airnow', extra: 1}, junk: {a: 1}}], {'accept-language': 'zh-TW'}),
            L([{type: 'android', fcmToken: 't3', location: loc, cityIndex: '2', id: '5', pushTime: '3600', enable: 'false', dayOfWeek: [1, 0, 'true']}], {'accept-language': ''}),
            L([{type: 'android', fcmToken: 't3', location: loc, cityIndex: 'abc'}], {'accept-language': 'fr-FR,fr;q=0.9'}),
            L([alert('t4', 0, 0, {startTime: 3600, endTime: 7200}), alert('t4', 1, 1, {startTime: 7200, endTime: 3600})], {'accept-language': 'ja'}),
            L([alert('t4', 0, 0, {startTime: 100, endTime: 50, airAlertsBreakPoint: 4})], {'accept-language': 'ja'}),
            L([alert('t5', 0, 0, {startTime: '10', endTime: '9'}), alert('t5', 1, 1, {startTime: '10', endTime: 9}),
                alert('t5', 2, 2, {startTime: null, endTime: undefined})]),
            L([alarm('t6', 0, 1), alarm('t6', 1, 2, {town: null, location: undefined}), alarm('t6', 2, 3)]),
            L([alarm('t7', 0, 1), alarm('t7', 1, 2, {units: 'x'}), alarm('t7', 2, 3)]),
            L([alarm('t8', 0, 1, {geo: 'ab', location: undefined})]),
            L([alarm('t9', 0, 1, {location: {lat: 'a', long: 'b'}})]),
        ]},
    {id: 'v000705-post', note: 'old client POST /v000705/push stores alarms only',
        steps: [
            P('/v000705/push', {type: 'android', registrationId: 'reg-1', town, pushTime: 3600, cityIndex: 0}, {'accept-language': 'en-US,en'}),
            P('/v000705/push', {type: 'android', registrationId: 'reg-1', town, pushTime: 7200, cityIndex: 0}, {}),
            P('/v000705/push', {type: 'android', registrationId: 'reg-1', location: loc, cityIndex: 1, category: 'alert', startTime: 1}),
            P('/v000705/push', {type: 'android', location: loc}),
            P('/v000705/push', {type: 'android', registrationId: 'reg-1'}),
            P('/v000705/push', {type: 'android', registrationId: 'reg-1', location: {lat: 'x', long: 1}}),
            P('/v000705/push', {type: 'android', registrationId: 'reg-1', town: null}),
            P('/v000705/push', {type: 'android', registrationId: 'reg-1', town: {first: 'x'}, cityIndex: 'abc'}),
            P('/v000705/push', {registrationId: 'reg-2', town: {first: 'x'}}),
            P('/v000705/push', [1, 2]),
            {method: 'POST', path: '/v000705/push', raw: '{"type":"android","registrationId":"reg-3","town":{"first":"y"},"cityIndex":0,"id":4}', headers: {'content-type': 'application/json; charset=UTF-8'}},
        ]},
    {id: 'put-variants', note: 'token rename in both collections',
        seed: {
            pushes: [
                {_id: oid(1), type: 'ios', fcmToken: 'old', cityIndex: 0, id: 1, updatedAt: at('2026-01-01T00:00:00.000Z')},
                {_id: oid(2), type: 'ios', fcmToken: 'old', cityIndex: 1, id: 2},
                {_id: oid(3), type: 'android', registrationId: 'rid', cityIndex: 0, id: 0},
            ],
            alertpushes: [{_id: oid(4), type: 'ios', fcmToken: 'old', cityIndex: 0, id: 0}],
        },
        steps: [
            U({}), U({newToken: 'new'}), U({newToken: '', oldToken: 'old'}), U({newToken: 'new', oldToken: 'none'}),
            U({newToken: 'new', oldToken: 'old'}),
            U({newRegId: 'rid2', oldRegId: 'rid'}),
            U({newToken: 'new', oldToken: 'old', newRegId: 'x', oldRegId: 'y'}),
            {method: 'PUT', path: '/v000902/push', raw: 'newToken=new2&oldToken=new', headers: {'content-type': 'application/x-www-form-urlencoded'}},
            {method: 'PUT', path: '/v000902/push', raw: 'newToken=a&oldToken=b', headers: {'content-type': 'text/plain'}},
            U({newToken: 7, oldToken: 'new2'}),
            U({newToken: {a: 1}, oldToken: '7'}),
        ]},
    {id: 'delete-variants', note: 'removal selectors (cityIndex and id narrow, 0 included)',
        seed: {
            pushes: [
                {_id: oid(1), type: 'ios', fcmToken: 'tok', cityIndex: 0, id: 1},
                {_id: oid(2), type: 'ios', fcmToken: 'tok', cityIndex: 0, id: 2},
                {_id: oid(3), type: 'ios', fcmToken: 'tok', cityIndex: 1, id: 3},
                {_id: oid(4), type: 'ios', fcmToken: 'other', cityIndex: 0, id: 1},
                {_id: oid(5), type: 'android', registrationId: 'rid', cityIndex: 0, id: 0},
            ],
            alertpushes: [
                {_id: oid(6), type: 'ios', fcmToken: 'tok', cityIndex: 0, id: 0},
                {_id: oid(7), type: 'ios', fcmToken: 'tok', cityIndex: 1, id: 1},
            ],
        },
        steps: [
            D({}), D({fcmToken: ''}), D({fcmToken: 'tok', category: 'other'}), D({fcmToken: 0}),
            D({fcmToken: 'tok', cityIndex: 0, id: 2, category: 'alarm'}),
            D({fcmToken: 'tok', cityIndex: 0, id: null}),
            D({fcmToken: '', registrationId: 'rid', cityIndex: 0, id: 0}),
            D({fcmToken: 'tok', cityIndex: '1'}),
            D({fcmToken: 'tok'}),
            D({registrationId: 'none', category: 'alarm'}),
        ]},
    {id: 'casts', note: 'Mongoose casting through POST /v000705/push (visible messages) and push-list alerts',
        steps: [
            P('/v000705/push', {type: 'a', registrationId: 'c1', location: loc, cityIndex: 0, pushTime: 'abc'}),
            P('/v000705/push', {type: 'a', registrationId: 'c1', location: loc, cityIndex: 0, enable: 'maybe'}),
            P('/v000705/push', {type: 'a', registrationId: 'c1', location: loc, cityIndex: 0, dayOfWeek: ['x']}),
            P('/v000705/push', {type: 'a', registrationId: 'c1', location: loc, cityIndex: 0, dayOfWeek: [true, 'no', 1, 'x']}),
            P('/v000705/push', {type: 'a', registrationId: 'c1', location: loc, cityIndex: 0, name: {a: 1}}),
            P('/v000705/push', {type: 'a', registrationId: 'c1', location: loc, cityIndex: 0, __v: 'x'}),
            P('/v000705/push', {type: 'a', registrationId: 'c1', location: loc, cityIndex: 0, dayOfWeek: 'true', units: 'x', town: 'y', geo: [1, 2, 3]}),
            P('/v000705/push', {type: 'a', registrationId: 'c2', location: loc, cityIndex: {_id: 5}, id: 1.5, pushTime: 1e21, timezoneOffset: '0x10', name: 7, source: true}),
            P('/v000705/push', {type: 'a', registrationId: 'c3', location: loc, cityIndex: -0, id: ' ', pushTime: '', enable: 'no', units: {airUnit: 5, zz: 1}, town: {first: 1, zz: 2}}),
            P('/v000705/push', {type: 'a', fcmToken: {_id: 'tok-obj'}, location: loc, cityIndex: 0}),
            P('/v000705/push', {type: 'a', registrationId: 'c4', location: loc, cityIndex: 0, _id: 'abc'}),
            P('/v000705/push', {type: 'a', registrationId: 'c4', location: loc, cityIndex: 0, 'units.airUnit': 'zz', 'town.first': 7}),
            P('/v000705/push', {type: ['a', 'b'], registrationId: 'c5', location: loc, cityIndex: [1, 2]}),
            P('/v000705/push', {type: 'a', registrationId: 'c6', location: loc, cityIndex: 0, updatedAt: 'x', lang: 9}),
            L([alert('k1', 0, 0, {startTime: 'abc'}), alert('k1', 1, 1, {units: 'x'}), alert('k1', 2, 2, {town: 'x'}),
                alert('k1', 3, 3, {dayOfWeek: ['x']}), alert('k1', 4, 4, {dayOfWeek: 'true', name: 5, cityIndex: '4'}),
                alert('k1', 5, 5, {precipAlerts: {lastState: 1, pushTime: '2026-10-01T00:00:00.000Z'}, airAlerts: {lastGrade: 'x'}})]),
            L([alert('k1', 4, 4, {startTime: 'abc'}), alert('k1', 4, 4, {name: 'again', endTime: 1}), alert('k1', 4, 4, {cityIndex: 'x'})]),
            L([alarm('k1', 4, 4, {pushTime: 'x'}), alarm('k1', 5, 5)]),
            L([alarm('k2', 0, 1, {geo: [], location: {lat: 1, long: 2}}), alarm('k2', 1, 2, {dayOfWeek: []})]),
        ]},
    {id: 'duplicates', note: 'duplicate alert keys update the first match only; form bodies',
        seed: {
            alertpushes: [
                {_id: oid(1), type: 'ios', fcmToken: 'dup', cityIndex: 0, id: 0, name: 'first'},
                {_id: oid(2), type: 'ios', fcmToken: 'dup', cityIndex: 0, id: 0, name: 'second'},
            ],
        },
        steps: [
            L([alert('dup', 0, 0, {name: 'updated'})]),
            {method: 'POST', path: '/v000902/push-list', raw: 'type=ios&fcmToken=x', headers: {'content-type': 'application/x-www-form-urlencoded'}},
            {method: 'POST', path: '/v000705/push', raw: 'type=ios&fcmToken=x&town=y', headers: {'content-type': 'application/x-www-form-urlencoded'}},
            {method: 'PUT', path: '/v000902/push', raw: 'newToken=a&newToken=b&oldToken=dup', headers: {'content-type': 'application/x-www-form-urlencoded'}},
            D({fcmToken: ['a,b', 'zzz'], cityIndex: 0}),
            {method: 'DELETE', path: '/v000902/push', raw: '', headers: {'content-type': 'application/x-www-form-urlencoded', 'content-length': '0'}},
        ]},
    {id: 'transport-and-routing', note: 'body parser, CORS preflight and unmatched routes',
        steps: [
            {method: 'PUT', path: '/v000902/push', raw: '{bad json', headers: {'content-type': json}},
            {method: 'PUT', path: '/v000902/push', raw: '"text"', headers: {'content-type': json}},
            {method: 'PUT', path: '/v000902/push', raw: '', headers: {'content-type': json}},
            {method: 'PUT', path: '/v000902/push', raw: '{"newToken":"a","oldToken":"b"}', headers: {'content-type': 'application/json; charset=latin1'}},
            {method: 'PUT', path: '/v000902/push', raw: '{"newToken":"a","oldToken":"b"}', headers: {'content-type': json, 'content-encoding': 'gzip'}, gzip: true},
            {method: 'PUT', path: '/v000902/push', raw: 'x'.repeat(102401), headers: {'content-type': json}},
            {method: 'PUT', path: '/v000902/push', raw: '{"newToken":"a","oldToken":"b"}'},
            {method: 'GET', path: '/v000902/push'},
            {method: 'HEAD', path: '/v000902/push'},
            {method: 'PUT', path: '/v000902/push-list', json: {}},
            {method: 'POST', path: '/v000902/push/extra', json: {}},
            {method: 'PUT', path: '/V000902/PUSH/', json: {newToken: 'a', oldToken: 'b'}},
            {method: 'POST', path: '/v000902/push-list/', json: []},
            {method: 'POST', path: '/v000902/push-list?x=1', json: []},
            {method: 'PUT', path: '/v000902/push?%E0%A4%A', json: {newToken: 'a', oldToken: 'b'}},
            {method: 'OPTIONS', path: '/v000902/push-list', headers: {origin: 'https://example.invalid', 'access-control-request-method': 'POST'}},
            {method: 'OPTIONS', path: '/v000705/push', headers: {'access-control-request-headers': 'content-type'}},
            {method: 'DELETE', path: '/v000902/push', raw: 'fcmToken=t&cityIndex=0', headers: {'content-type': 'application/x-www-form-urlencoded'}},
        ]},
];
module.exports = {scenarios};
```
