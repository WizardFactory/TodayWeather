# S15b-1 store oracle fixture

`source.json.gz` (sha256 `44fa135690a69e28fecdeb938fae55f3b76a0c18ebb63ff9ab0c2fb6bf4099a9`) holds pinned legacy-oracle results for the
S15b-1 S3 input source tests (`server2/tests/domestic/source.rs`). It is test data only; the
server2 runtime never reads it or any legacy file.

## Recording

- Legacy source: repository master `1ce314d6` (the legacy files are unchanged since `8899b60a`); the
  sha256 of every legacy file loaded while recording is stored in `source.files` (32 files).
- Runtime: Node.js `v16.20.2` (the S15 oracle tarball, see `PROVENANCE.md`), `TZ=UTC`,
  `NODE_ENV=production`. Dependencies: the S15 oracle `node_modules` (`async` 2.6.2, `xml2js` 0.4.19,
  `express` 4.13.4) and `mongoose` 5.1.2 (the legacy `server/package.json` version) installed
  with `npm install --ignore-scripts mongoose@5.1.2` (`sha512-k9hssPMgBnUYG5e9NoUbx/2ERDyelDY0Vf6BwjtmoETUhVT7pQUe1o+oelLLuHF3ZVY2qgienK8pnrI5pdvlxA==`, the same integrity as
  `server/package-lock.json`). No network was used while recording; HTTP modules are stubs that
  throw, and `request.get` answers only the fixture page of the current run.
- Database: none. Mongoose models are attached to an in-memory collection double (`fakemongo.js`)
  that implements the driver calls the legacy savers make (`find` with sort/limit/projection,
  `update` with upsert/multi, `updateMany`, `remove`) with MongoDB < 5.0 field order (existing
  fields keep their position, new fields are appended in update order) and a BSON round trip
  (`undefined` becomes `null`; integral numbers lose `-0`). Mongoose itself casts every update
  (`strict`, `__v`, the `for...in` clone that copies organizer template defaults).
- Inputs: synthetic, deterministic generators below (data.go.kr JSON pages, KMA `queryDFS.jsp`
  XML, `getFcstZoneCd` pages). Legacy requested XML from data.go.kr; the driver gives legacy the
  same item values as XML through the stubbed `request.get`, so its own xml2js parsing, page
  checks, organizers, publication checks and savers run unchanged. server2 reads the JSON form.
- Run: `TZ=UTC NODE_ENV=production NODE_PATH=<mongoose node_modules>:<S15 oracle node_modules>
  TW_REPO=<repo> node record-source.js <out.json.gz>`. Recording twice gives identical bytes.

## What is recorded

- `towns`: the `towns` collection after `utils/initTownDataToMongo.js` (`part.csv`) and
  `utils/updateTownDataToMongo.js` (`base.csv`) ran against the double (4652
  documents; `find({}, {_id: 0})`), seven `town` lookups and 400 `coordinate2xy` points.
- `region`: `makeRegIdTable` and `getRegIdByTown` (extracted from `controllerManager.js` and
  evaluated unchanged) over every table row and edge case.
- `zones`: `KmaForecastZoneController.getFromKma` over five zone-list scenarios (single page,
  retirement and failed refreshes, two pages, a `03` end page, a duplicate across pages) and
  `findForecastZoneByName` answers; the run-time `retiredAt` is recorded as a marker.
- `grid`: `CollectData.getData` with the legacy page checks, `forecastGridCollection` rawItems,
  `within`, `batch` and `canonical`, the DB 2.0 savers and their `remove` runs for current,
  shortest and short scenarios, with the per-run outcome and the final
  `find({mCoord}, {_id: 0}).sort({fcsDate: 1})` answer.
- `rss`: `TownRss.checkPubDate`, `getData`/`parseShortRss`/`saveShortRssNewForm` and `remove`.
- `mid`: `checkPubDate`, `getData` with `organizeForecastData`/`midForecastPolicy.parse` and
  `saveMid` (`saveOnlyLastOne`), with `find({regId}).sort({pubDate: -1}).limit(1)` answers.

## Driver source

### `record-source.js` (sha256 `0e27f7cfbe49367caeb8028d1d8ca34624eecea5d98df5fbb88210e9f74574ff`)

```js
/* S15b store oracle driver (task evidence, not a repository tool). Runs legacy server code with
 * Mongoose 5.1.2 and an in-memory collection double, and records the documents and reader answers
 * the server2 S3 source must reproduce. No network, no database.
 * Run: TZ=UTC NODE_ENV=production NODE_PATH=<mongoose>:<deps> TW_REPO=<repo> node record-source.js <out.json.gz>
 */
'use strict';
const L = require('./legacy');
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib'), assert = require('assert');
const mongoose = require('mongoose');
if (process.version !== 'v16.20.2') throw new Error('Pinned oracle Node v16.20.2 required');
if (process.env.TZ !== 'UTC') throw new Error('TZ=UTC required');
assert.strictEqual(require('mongoose/package.json').version, '5.1.2');
const out = {schema: 1, oracle: {node: process.version, tz: process.env.TZ, mongoose: '5.1.2'}};
const ej = L.fake.ejson;
const only = process.argv[3] ? process.argv[3].split(',') : null;
const sections = Object.fromEntries(Object.entries(Object.assign({}, require('./sections'), require('./sections-grid')))
    .filter(([name]) => !only || only.includes(name)));
(async () => {
    for (const [name, run] of Object.entries(sections)) {
        out[name] = await run(L, {mongoose, ej, vm, fs, path, assert});
    }
    out.source = {files: Object.fromEntries(Object.entries(L.sourceFiles).sort())};
    const json = JSON.stringify(out);
    fs.writeFileSync(process.argv[2], zlib.gzipSync(Buffer.from(json), {level: 9, mtime: 0}));
    console.log('recorded', Object.keys(sections).join(','), json.length);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
```

### `legacy.js` (sha256 `0c8a65a5befcd1adf9cc5232ffd4b3c6abdb8131352f4a4ecdcf146dd7bccd00`)

```js
/* Load legacy server modules offline for the S15b store oracle (task evidence, not a repository
 * tool). Network modules are replaced by stubs that throw; `global.log` is silent; Mongoose 5.1.2
 * models get the in-memory collection double. */
'use strict';
const Module = require('module');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const fake = require('./fakemongo');

const root = path.resolve(process.env.TW_REPO || path.join(__dirname, '../../../..'));
const server = path.join(root, 'server');
const sourceFiles = {};
const rawRead = fs.readFileSync;
fs.readFileSync = function (file, ...args) {
    const out = rawRead.call(fs, file, ...args);
    const abs = path.resolve(String(file));
    if (abs.startsWith(server + path.sep)) {
        sourceFiles[path.relative(root, abs)] = crypto.createHash('sha256').update(rawRead.call(fs, abs)).digest('hex');
    }
    return out;
};
const noNetwork = () => { throw new Error('network access is not allowed in the oracle'); };
const stubs = {
    request: Object.assign(noNetwork, {get: noNetwork, post: noNetwork, defaults: () => noNetwork}),
    dnscache: () => ({}),
};
const rawLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (stubs[request]) return stubs[request];
    if (/config\/config(\.js)?$/.test(request)) {
        return {db: {version: '2.0', path: '', options: {}}, keyString: {}, mode: 'service', serviceServer: {}, gather: {}};
    }
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (resolved.startsWith(server + path.sep) && resolved.endsWith('.js')) {
        sourceFiles[path.relative(root, resolved)] = crypto.createHash('sha256').update(rawRead.call(fs, resolved)).digest('hex');
    }
    return rawLoad.apply(this, arguments);
};
const silent = () => {};
global.log = {error: silent, warn: silent, info: silent, verbose: silent, debug: silent, silly: silent};

function load(rel) { return require(path.join(server, rel)); }
module.exports = {root, server, load, fake, sourceFiles};
```

### `fakemongo.js` (sha256 `55994f3b41e46ad9109f6d3a34c33a34a37f8d838d4c421253a5f1941a44a60b`)

```js
/* In-memory MongoDB collection double for the S15b store oracle (task evidence, not a repository
 * tool). Implements the driver calls the legacy savers make through Mongoose 5.1.2 (find with
 * sort/limit/projection, update with upsert/multi, updateMany, remove) with MongoDB < 5.0 field
 * order (existing fields keep their position, new fields are appended in update order) and a
 * BSON round trip (undefined -> null, integral numbers in int32 lose -0). */
'use strict';
let nextId = 1;
function bson(v) {
    if (v === undefined) return null;
    if (v === null) return null;
    if (v instanceof Date) return new Date(v.getTime());
    if (typeof v === 'number') return Number.isInteger(v) && v >= -2147483648 && v <= 2147483647 ? (v === 0 ? 0 : v) : v;
    if (Array.isArray(v)) return v.map(bson);
    if (typeof v === 'object') {
        if (v._bsontype === 'ObjectID' || v._bsontype === 'ObjectId') return v;
        const o = {};
        for (const k of Object.keys(v)) o[k] = bson(v[k]);
        return o;
    }
    return v;
}
function get(doc, path) {
    let cur = doc;
    for (const p of path.split('.')) {
        if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
        cur = cur[p];
    }
    return cur;
}
function cmp(a, b) {
    const n = x => x instanceof Date ? x.getTime() : x;
    a = n(a); b = n(b);
    if (a === b) return 0;
    if (a === undefined || a === null) return -1;
    if (b === undefined || b === null) return 1;
    return a < b ? -1 : 1;
}
function eq(a, b) {
    if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
    if (a && typeof a === 'object' && b && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
    if ((a === undefined || a === null) && b === null) return true;
    return a === b;
}
function matchValue(v, cond) {
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond) &&
        Object.keys(cond).length && Object.keys(cond).every(k => k[0] === '$')) {
        return Object.keys(cond).every(op => {
            const c = cond[op];
            switch (op) {
                case '$lte': return v !== undefined && v !== null && cmp(v, c) <= 0;
                case '$lt': return v !== undefined && v !== null && cmp(v, c) < 0;
                case '$gte': return v !== undefined && v !== null && cmp(v, c) >= 0;
                case '$gt': return v !== undefined && v !== null && cmp(v, c) > 0;
                case '$ne': return !eq(v, c);
                case '$in': return c.some(x => eq(v, x));
                case '$nin': return !c.some(x => eq(v, x));
                default: throw new Error('fakemongo: unsupported operator ' + op);
            }
        });
    }
    return eq(v, cond);
}
function matches(doc, q) {
    return Object.keys(q || {}).every(k => {
        if (k === '$or') return q[k].some(sub => matches(doc, sub));
        if (k === '$and') return q[k].every(sub => matches(doc, sub));
        return matchValue(get(doc, k), q[k]);
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
function unsetPath(doc, path) {
    const parts = path.split('.');
    let cur = doc;
    for (let i = 0; i < parts.length - 1; i++) { cur = cur && cur[parts[i]]; }
    if (cur && typeof cur === 'object') delete cur[parts[parts.length - 1]];
}
function apply(doc, update, inserting) {
    for (const op of Object.keys(update)) {
        const body = update[op];
        if (op === '$set' || (op === '$setOnInsert' && inserting)) {
            for (const k of Object.keys(body)) setPath(doc, k, body[k]);
        } else if (op === '$unset') {
            for (const k of Object.keys(body)) unsetPath(doc, k);
        } else if (op === '$setOnInsert') {
            // not inserting
        } else if (op[0] === '$') {
            throw new Error('fakemongo: unsupported update ' + op);
        }
    }
}
function project(doc, projection) {
    const out = {};
    const excluded = Object.keys(projection || {}).filter(k => !projection[k]);
    const included = Object.keys(projection || {}).filter(k => projection[k] && k !== '_id');
    for (const k of Object.keys(doc)) {
        if (included.length ? !(included.includes(k) || (k === '_id' && projection._id !== 0)) : excluded.includes(k)) continue;
        out[k] = bson(doc[k]);
    }
    return out;
}
class FakeCollection {
    constructor(name) { this.name = name; this.docs = []; this.log = []; }
    find(query, options, cb) {
        if (typeof options === 'function') { cb = options; options = {}; }
        options = options || {};
        let list = this.docs.filter(d => matches(d, query));
        const sort = options.sort;
        if (sort) {
            const keys = Array.isArray(sort) ? sort : Object.keys(sort).map(k => [k, sort[k]]);
            list = list.slice().sort((a, b) => {
                for (const [k, dir] of keys) { const c = cmp(get(a, k), get(b, k)); if (c) return dir < 0 ? -c : c; }
                return 0;
            });
        }
        if (options.limit) list = list.slice(0, options.limit);
        const out = list.map(d => project(d, options.projection || options.fields));
        const cursor = {toArray: done => done(null, out)};
        if (cb) cb(null, cursor);
        return cursor;
    }
    _update(query, update, options, many) {
        options = options || {};
        const hits = this.docs.filter(d => matches(d, query));
        const targets = many ? hits : hits.slice(0, 1);
        for (const d of targets) apply(d, update, false);
        if (!targets.length && options.upsert) {
            const doc = {_id: 'oid' + (nextId++)};
            for (const k of Object.keys(query)) {
                if (k[0] === '$') continue;
                const v = query[k];
                if (v && typeof v === 'object' && !(v instanceof Date) && Object.keys(v).some(x => x[0] === '$')) continue;
                setPath(doc, k, v);
            }
            apply(doc, update, true);
            this.docs.push(doc);
            this.log.push({op: 'insert', query, update});
            return {result: {n: 1, nModified: 0, upserted: [doc._id]}, n: 1};
        }
        this.log.push({op: 'update', query, update, n: targets.length});
        return {result: {n: targets.length, nModified: targets.length}, n: targets.length, nModified: targets.length};
    }
    update(query, update, options, cb) {
        if (typeof options === 'function') { cb = options; options = {}; }
        const r = this._update(query, update, options, options && options.multi);
        if (cb) process.nextTick(() => cb(null, r));
        return Promise.resolve(r);
    }
    updateOne(q, u, o, cb) { if (typeof o === 'function') { cb = o; o = {}; } const r = this._update(q, u, o, false); if (cb) process.nextTick(() => cb(null, r)); return Promise.resolve(r); }
    updateMany(q, u, o, cb) { if (typeof o === 'function') { cb = o; o = {}; } const r = this._update(q, u, o, true); if (cb) process.nextTick(() => cb(null, r)); return Promise.resolve(r); }
    remove(query, options, cb) {
        if (typeof options === 'function') { cb = options; options = {}; }
        const before = this.docs.length;
        this.docs = this.docs.filter(d => !matches(d, query));
        const r = {result: {n: before - this.docs.length}};
        if (cb) process.nextTick(() => cb(null, r));
        return Promise.resolve(r);
    }
    deleteMany(q, o, cb) { return this.remove(q, o, cb); }
    ensureIndex(...args) { const cb = args.find(a => typeof a === 'function'); if (cb) process.nextTick(() => cb(null, 'idx')); }
    createIndex(...args) { return this.ensureIndex(...args); }
    insert(docs, options, cb) {
        if (typeof options === 'function') { cb = options; options = {}; }
        (Array.isArray(docs) ? docs : [docs]).forEach(d => this.docs.push(bson(d)));
        if (cb) process.nextTick(() => cb(null, {result: {n: 1}}));
    }
    insertOne(doc, options, cb) { return this.insert(doc, options, cb); }
    insertMany(docs, options, cb) { return this.insert(docs, options, cb); }
}
/** Attach a fake driver collection to a Mongoose model (no connection, no buffering). */
function attach(model) {
    const fake = new FakeCollection(model.collection.name);
    model.collection.buffer = false;
    model.collection.collection = fake;
    return fake;
}
function ejson(v) {
    if (v instanceof Date) return {$date: v.getTime()};
    if (Array.isArray(v)) return v.map(ejson);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = ejson(v[k]); return o; }
    if (typeof v === 'number' && !isFinite(v)) return {$number: String(v)};
    return v;
}
module.exports = {FakeCollection, attach, ejson, bson};
```

### `sections.js` (sha256 `da8d4826a6bee5553aef38525448da227c1969113adf5b79d72f76ff95969902`)

```js
/* Oracle sections for record-source.js (task evidence). Each section runs legacy code and returns
 * plain JSON (Dates as {"$date": ms}). */
'use strict';
const path = require('path');

function extract(code, head) {
    const start = code.indexOf(head);
    if (start < 0) throw new Error('legacy boundary changed: ' + head);
    // The function ends at the first "\n};" after its head.
    const end = code.indexOf('\n};', start);
    return code.slice(start, end + 3);
}
function once(fn) { let p; return () => p || (p = fn()); }

async function towns(L, {mongoose, ej}) {
    const tDoc = L.load('models/town');
    const coll = L.fake.attach(tDoc);
    const cwd = process.cwd();
    process.chdir(L.server);
    let finished;
    mongoose.connect = () => Promise.resolve();
    const run = file => new Promise(resolve => {
        finished = resolve;
        mongoose.disconnect = () => { const f = finished; finished = null; if (f) setTimeout(f, 10); };
        require(path.join(L.server, file));
    });
    await run('utils/initTownDataToMongo.js');
    const afterPart = coll.docs.length;
    await run('utils/updateTownDataToMongo.js');
    process.chdir(cwd);
    const list = await tDoc.find({}, {_id: 0}).lean().exec();
    const probes = [['서울특별시', '종로구', '청운효자동'], ['강원도', '', ''], ['경기도', '성남시분당구', '구미1동'],
        ['제주특별자치도', '제주시', '일도1동'], ['부산광역시', '중구', '중앙동'], ['서울특별시', '', ''], ['없는도', '없는시', '없는동']];
    const town = [];
    for (const [f, s, t] of probes) {
        const r = await tDoc.find({'town.first': f, 'town.second': s, 'town.third': t}, {_id: 0}).limit(1).lean().exec();
        town.push({args: [f, s, t], result: ej(r)});
    }
    // coordinate2xy on extra points (grid edges, rounding boundaries).
    const Convert = L.load('utils/coordinate2xy.js');
    const points = [];
    for (let i = 0; i < 400; i++) {
        const lat = 32.5 + (i * 7.919) % 6.5, lon = 124 + (i * 13.37) % 8;
        const c = new Convert({lat, lon}, {}).toLocation().getLocation();
        points.push([lat, lon, c.x, c.y]);
    }
    return {part_rows: afterPart, list: ej(list), town, points};
}

async function region(L) {
    const fs = require('fs');
    const code = fs.readFileSync(path.join(L.server, 'controllers/controllerManager.js'), 'utf8');
    const vm = require('vm');
    const sandbox = {fs, log: global.log, Manager: function () {}};
    sandbox.Manager.prototype = {};
    vm.runInNewContext(extract(code, 'Manager.prototype.getRegIdByTown = function') + '\n' +
        extract(code, 'Manager.prototype.makeRegIdTable = function'), sandbox);
    const cwd = process.cwd();
    process.chdir(L.server);
    const m = new sandbox.Manager();
    m.makeRegIdTable();
    process.chdir(cwd);
    const table = m.codeTable.map(r => Object.assign({}, r));
    const firsts = Array.from(new Set(table.map(r => r.first)));
    const cases = [];
    const push = (r, c) => m.getRegIdByTown(r, c, (err, v) => cases.push({args: [r, c], error: err ? err.message : undefined, result: err ? undefined : Object.assign({}, v)}));
    table.forEach(r => { push(r.first, r.second); push(r.first, r.second + '구'); });
    firsts.forEach(f => { push(f, ''); push(f, '없는시'); push(f, '서'); });
    [['서울특별시', '종로구'], ['부산광역시', '해운대구'], ['경기도', '수원시장안구'], ['경기도', '성남시분당구'], ['강원도', '강릉시'],
     ['강원특별자치도', '강릉시'], ['전라북도', '전주시완산구'], ['전북특별자치도', '전주시'], ['이어도', ''], ['없는도', '어딘가']].forEach(([r, c]) => push(r, c));
    return {table, cases};
}

async function zones(L, {ej}) {
    const Model = L.load('models/kma/kma.forecast.zone.model.js');
    const Controller = L.load('controllers/kma/kma.forecast.zone.controller.js');
    const fixtures = require('./zone-fixtures');
    const runs = [];
    for (const scenario of fixtures.scenarios) {
        const coll = L.fake.attach(Model);
        const steps = [];
        for (const acquisition of scenario.acquisitions) {
            const c = new Controller(['k']);
            let page = 0;
            c._request = () => {
                const body = acquisition.pages[page++];
                if (body === undefined) return Promise.reject(new Error('oracle: no more pages'));
                return Promise.resolve(JSON.parse(body));
            };
            let error = null;
            try { await c.getFromKma(); } catch (e) { error = e.message; }
            steps.push({error, pages_read: page});
        }
        const queries = [];
        for (const [r, ci] of scenario.queries) {
            const c = new Controller(['k']);
            const res = await new Promise(resolve => c.findForecastZoneByName(r, ci).exec((e, v) => resolve(e ? {error: e.message} : {result: ej(v)})));
            queries.push(Object.assign({args: [r, ci]}, res));
        }
        // retiredAt is the wall clock of the retiring run: recorded as a marker.
        const docs = coll.docs.map(d => { const o = Object.assign({}, d); delete o._id; if (o.retiredAt) o.retiredAt = 'run-time'; return ej(o); });
        runs.push({id: scenario.id, steps, queries, docs, acquisitions: scenario.acquisitions});
    }
    return {land: Array.from(Controller.landZoneIds()), runs};
}

module.exports = {towns, region, zones};
```

### `sections-grid.js` (sha256 `69e49062b5353f0175609e4492216ba99f3760649b117e16a7d8ca86d653f573`)

```js
/* Grid, RSS and mid oracle sections (task evidence). Pages are the JSON acquisitions server2
 * stores; legacy receives the same item values as XML through a stubbed `request.get`, so its own
 * xml2js parsing, page checks, organizers, publication checks and savers run unchanged. */
'use strict';
const Module = require('module');

let handler = null;
function installRequest() {
    const request = Module._load('request', module);
    request.get = (url, opts, cb) => {
        if (!handler) throw new Error('network access is not allowed in the oracle');
        const body = handler(url);
        setImmediate(() => cb(null, {statusCode: 200}, body));
        return {abort() {}};
    };
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
/** The XML form of one data.go.kr JSON page (same values, legacy dataType=XML layout). */
function toXml(json) {
    const page = JSON.parse(json), r = page.response;
    const head = '<header><resultCode>' + esc(r.header.resultCode) + '</resultCode><resultMsg>' + esc(r.header.resultMsg) + '</resultMsg></header>';
    if (!r.body) return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><response>' + head + '</response>';
    const items = r.body.items.item.map(item => '<item>' + Object.keys(item).map(k => '<' + k + '>' + esc(item[k]) + '</' + k + '>').join('') + '</item>').join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><response>' + head + '<body><dataType>XML</dataType><items>' + items +
        '</items><numOfRows>' + r.body.numOfRows + '</numOfRows><pageNo>' + r.body.pageNo + '</pageNo><totalCount>' + r.body.totalCount + '</totalCount></body></response>';
}
function pageOf(url) { const m = /[?&]pageNo=([0-9]+)/.exec(url); return m ? Number(m[1]) : 1; }
const wait = fn => new Promise((resolve, reject) => fn((err, v) => err ? reject(err) : resolve(v)));

function stamp(date, time) {
    return Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), +time.slice(0, 2), +time.slice(2, 4));
}

async function grid(L, {ej}) {
    installRequest();
    const CollectData = L.load('lib/collectTownForecast.js');
    const FGC = L.load('lib/forecastGridCollection.js');
    const C = {
        current: [new (L.load('controllers/kma/kma.town.current.controller.js'))(), L.load('models/kma/kma.town.current.model.js'), 'saveCurrent', 0],
        shortest: [new (L.load('controllers/kma/kma.town.shortest.controller.js'))(), L.load('models/kma/kma.town.shortest.model.js'), 'saveShortest', 1],
        short: [new (L.load('controllers/kma/kma.town.short.controller.js'))(), L.load('models/kma/kma.town.short.model.js'), 'saveShort', 2],
    };
    const publicationInstant = slot => new Date(stamp(slot.date, slot.time) - 9 * 3600000);
    const fixtures = require('./grid-fixtures');
    const out = [];
    for (const scenario of fixtures.scenarios) {
        const colls = {};
        for (const f of Object.keys(C)) colls[f] = L.fake.attach(C[f][1]);
        const runs = scenario.runs.slice().sort((a, b) => a.fetched_at - b.fetched_at);
        const outcomes = [];
        for (const run of runs) {
            const [ctrl, , save, dataType] = C[run.family];
            const coord = {mx: 60, my: 127};
            const collect = new CollectData();
            collect.srcList = [coord];
            collect.listCount = 1;
            collect.resetResult();
            collect.resultList[0].mCoord = coord;
            const product = run.family === 'current' ? undefined : run.family;
            const control = product ? {product, slot: run.slot, cancelled: false, httpAttempts: 0, pendingWrites: 0} : undefined;
            if (control) collect.validateForecastItems = items => FGC.rawItems(items, product, run.slot, coord);
            handler = url => toXml(run.pages[pageOf(url) - 1]);
            const url = collect.getUrl(dataType, 'k', run.slot.date, run.slot.time, coord);
            // Retention runs at the start of each collection run, anchored on its publication.
            await new Promise(resolve => { ctrl.remove(publicationInstant(run.slot)); setTimeout(resolve, 5); });
            const result = await new Promise(resolve => collect.getData(0, dataType, url, undefined, err => resolve(err ? err.message : null)));
            handler = null;
            const item = collect.resultList[0];
            let outcome = result || 'organized';
            if (item.isCompleted) {
                if (control) item.data = FGC.within(product, run.slot, item.data);
                if (control && !FGC.batch(product, run.slot, item.mCoord, item.data)) {
                    outcome = 'batch-rejected';
                } else {
                    if (control) item.data.forEach(row => { row.pubDate = FGC.canonical(product, row.pubDate); });
                    await new Promise((resolve, reject) => ctrl[save](item.data, err => err ? reject(err) : resolve(), control));
                    outcome = 'saved';
                }
            }
            outcomes.push({family: run.family, period: run.period, fetched_at: run.fetched_at, outcome});
        }
        // The run at the request instant: retention anchored on each family's latest run.
        const answers = {};
        for (const f of Object.keys(C)) {
            const mine = runs.filter(r => r.family === f);
            if (!mine.length) continue;
            const latest = mine.map(r => r.slot).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).pop();
            await new Promise(resolve => { C[f][0].remove(publicationInstant(latest)); setTimeout(resolve, 5); });
            const docs = await C[f][1].find({'mCoord.mx': 60, 'mCoord.my': 127}, {_id: 0}).sort({fcsDate: 1}).lean().exec();
            answers[f] = ej(docs);
        }
        out.push({id: scenario.id, at: scenario.at, runs: scenario.runs, outcomes, answers});
    }
    return out;
}

async function rss(L, {ej}) {
    installRequest();
    const TownRss = L.load('controllers/kma/kma.town.short.rss.controller.js');
    const model = L.load('models/kma/kma.town.short.rss.model.js');
    const fixtures = require('./rss-fixtures');
    const out = [];
    for (const scenario of fixtures.scenarios) {
        const coll = L.fake.attach(model);
        const outcomes = [];
        const runs = scenario.runs.slice().sort((a, b) => a.fetched_at - b.fetched_at);
        for (const run of runs) {
            const t = new TownRss();
            const item = {mCoord: {mx: 60, my: 127}};
            // mainTask: retention at the run's wall clock, then the publication skip, then fetch/parse/save.
            await new Promise(resolve => { t.remove(new Date(run.fetched_at)); setTimeout(resolve, 5); });
            const skipped = await new Promise(resolve => t.checkPubDate(item, run.expected, 0, err => resolve(!!err)));
            if (skipped) { outcomes.push({fetched_at: run.fetched_at, outcome: 'skipped'}); continue; }
            handler = () => run.xml;
            const res = await new Promise(resolve => t.getData(0, item, err => resolve(err)));
            handler = null;
            outcomes.push({fetched_at: run.fetched_at, outcome: res ? 'failed:' + res : 'saved'});
        }
        await new Promise(resolve => { new TownRss().remove(new Date(scenario.last_run)); setTimeout(resolve, 5); });
        const docs = await model.find({'mCoord.mx': 60, 'mCoord.my': 127}, {_id: 0}).sort({fcsDate: 1}).lean().exec();
        out.push({id: scenario.id, at: scenario.at, last_run: scenario.last_run, runs: scenario.runs, outcomes, answer: ej(docs), stored: coll.docs.length});
    }
    return out;
}

async function mid(L, {ej}) {
    installRequest();
    const CollectData = L.load('lib/collectTownForecast.js');
    const Mid = L.load('controllers/kma/kma.town.mid.controller.js');
    const models = {
        modelMidForecast: L.load('models/kma/kma.town.mid.forecast.model.js'),
        modelMidLand: L.load('models/kma/kma.town.mid.land.model.js'),
        modelMidTemp: L.load('models/kma/kma.town.mid.temp.model.js'),
    };
    const types = {forecast: ['modelMidForecast', 3], land: ['modelMidLand', 4], temp: ['modelMidTemp', 5]};
    const fixtures = require('./mid-fixtures');
    const out = [];
    for (const scenario of fixtures.scenarios) {
        for (const m of Object.values(models)) L.fake.attach(m);
        const ctrl = new Mid();
        const outcomes = [];
        const runs = scenario.runs.slice().sort((a, b) => a.fetched_at - b.fetched_at);
        for (const run of runs) {
            const [type, dataType] = types[run.kind];
            const dateString = {date: run.tmfc.slice(0, 8), time: run.tmfc.slice(8)};
            const due = await wait(cb => ctrl.checkPubDate(type, [{code: run.code}], dateString, cb));
            if (!due.length) { outcomes.push({fetched_at: run.fetched_at, outcome: 'skipped'}); continue; }
            const collect = new CollectData();
            collect.srcList = [{code: run.code}];
            collect.listCount = 1;
            collect.resetResult();
            handler = url => toXml(run.pages[pageOf(url) - 1]);
            const url = collect.getUrl(dataType, 'k', dateString.date, dateString.time, {code: run.code});
            const options = {date: dateString.date, time: dateString.time, code: run.code};
            const res = await new Promise(resolve => collect.getData(0, dataType, url, options, err => resolve(err ? err.message : null)));
            handler = null;
            const item = collect.resultList[0];
            if (!item.isCompleted) { outcomes.push({fetched_at: run.fetched_at, outcome: 'failed:' + res}); continue; }
            await new Promise((resolve, reject) => ctrl.saveMid(type, item.data[0], true, err => err ? reject(err) : resolve()));
            await new Promise(resolve => setTimeout(resolve, 5));
            outcomes.push({fetched_at: run.fetched_at, outcome: 'saved'});
        }
        const answers = [];
        for (const [kind, regId] of scenario.queries) {
            const r = await models[types[kind][0]].find({regId}, {_id: 0}).sort({pubDate: -1}).limit(1).lean().exec();
            answers.push({kind, regId, result: ej(r)});
        }
        out.push({id: scenario.id, runs: scenario.runs, outcomes, answers});
    }
    return out;
}

module.exports = {grid, rss, mid};
```

### `zone-fixtures.js` (sha256 `d7c4621a9154cac3da030bd1148c4c7bc3a87a8fb9547bec888062b9f0797fc0`)

```js
/* Synthetic getFcstZoneCd JSON pages (data.go.kr envelope) for the S15b zone oracle. */
'use strict';
const ROWS = 1000;
function page(items, pageNo, extra) {
    return JSON.stringify(Object.assign({response: {header: {resultCode: '00', resultMsg: 'NORMAL_SERVICE'},
        body: {dataType: 'JSON', items: {item: items}, pageNo, numOfRows: ROWS, totalCount: items.length}}}, extra || {}));
}
function zone(regId, regName, regSp, extra) {
    return Object.assign({regId, tmSt: '201601010000', tmEd: '210012310000', regSp, regName, regEn: regName + ' en',
        regUp: regId.slice(0, 4) + '0000', ht: '12.5', stnWn: '108', stnF3: '108', stnFd: '108', stnFw: '108', seq: 3,
        lat: '37.5', lon: '127.0'}, extra || {});
}
const base = [
    zone('11B10101', '서울', 'C'), zone('11B20201', '인천', 'C', {lat: 37.45, lon: 126.7}), zone('11B20101', '강화', 'C'),
    zone('11F20501', '광주', 'C'), zone('11B20702', '광주', 'C', {ht: 50}), zone('11H10701', '대구', 'C'),
    zone('11H10707', '군위', 'C'), zone('11E00102', '울릉도', 'C', {lat: null, lon: null}), zone('11D20402', '고성', 'C'),
    zone('11H20404', '고성', 'C'), zone('11B20601', '수원', 'C'), zone('11D10301', '춘천', 'C', {tmEd: 210012310000}),
    zone('11D20501', '강릉', 'C', {lat: '0', lon: '0'}), zone('11G00201', '제주', 'C'), zone('11H20201', '부산', 'C'),
    zone('11B00000', '서울.인천.경기도', 'A'), zone('12A20100', '서해중부앞바다', 'H', {regSp: 'H'}),
    zone('11C20401', '대전', 'C'), zone('11C10301', '청주', 'C'), zone('11F10201', '전주', 'C'), zone('11H10501', '안동', 'C'),
    zone('11B20605', '성남', 'C'), zone('11A00101', '백령도', 'C'), zone('11G00800', '이어도', 'C'), zone('11B20305', '고양', 'C')
];
const filler = [];
for (let i = 0; filler.length + base.length < ROWS; i++) {
    filler.push(zone('99Z' + String(i).padStart(5, '0'), '구역' + i, i % 3 ? 'C' : 'A'));
}
const full = base.concat(filler);
module.exports = {scenarios: [
    {id: 'single-page', acquisitions: [{pages: [page(base, 1)]}], queries: [
        ['서울특별시', '종로구'], ['인천광역시', '강화군'], ['인천광역시', '남동구'], ['광주광역시', '북구'], ['경기도', '광주시'],
        ['대구광역시', '군위군'], ['대구광역시', '수성구'], ['경상북도', '울릉군'], ['강원도', '고성군'], ['경상남도', '고성군'],
        ['강원특별자치도', '고성군'], ['경기도', '수원시장안구'], ['경기도', '성남시분당구'], ['강원도', '춘천시'], ['강원도', '강릉시'],
        ['제주특별자치도', '제주시'], ['부산광역시', '해운대구'], ['이어도', ''], ['대전광역시', '유성구'], ['충청북도', '청주시상당구'],
        ['전라북도', '전주시완산구'], ['경상북도', '안동시'], ['세종특별자치시', '세종시'], ['경기도', '고양시덕양구'], ['서울특별시', '']]},
    {id: 'retire-and-fail', acquisitions: [
        {pages: [page(base, 1)]},
        {pages: [page(base.filter(z => z.regId !== '11B20601' && z.regId !== '11H10707').map(z => z.regId === '11B10101' ? Object.assign({}, z, {regEn: 'Seoul2', ht: undefined}) : z), 1)]},
        {pages: [page(base.concat([zone('11Z99999', '', 'C')]), 1)]},
        {pages: [JSON.stringify({response: {header: {resultCode: '99', resultMsg: 'ERR'}}})]}
    ], queries: [['경기도', '수원시장안구'], ['대구광역시', '군위군'], ['서울특별시', '중구'], ['경기도', '고양시일산동구']]},
    {id: 'two-pages', acquisitions: [{pages: [page(full, 1), page([zone('11B20610', '오산', 'C'), zone('11B10101', '서울', 'C')].slice(0, 1), 2)]}],
        queries: [['경기도', '오산시'], ['서울특별시', '종로구'], ['경기도', '구역5']]},
    {id: 'two-pages-03-end', acquisitions: [{pages: [page(full, 1), JSON.stringify({response: {header: {resultCode: '03', resultMsg: 'NO_DATA'}}})]}],
        queries: [['서울특별시', '종로구']]},
    {id: 'duplicate-across-pages', acquisitions: [{pages: [page(full, 1), page([zone('11B10101', '서울', 'C')], 2)]}],
        queries: [['서울특별시', '종로구']]}
]};
```

### `grid-fixtures.js` (sha256 `bae43763ca21c4a43b7a76166298d038f2053c9250483ffdf4c4d08a050dfb2d`)

```js
/* Synthetic VilageFcstInfoService_2.0 JSON pages (data.go.kr envelope) for the S15b grid oracle.
 * Deterministic: a small LCG drives the values. Each run is one complete acquisition. */
'use strict';
const HOUR = 3600000;
let seed = 2742;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
function pick(list) { return list[Math.floor(rnd() * list.length)]; }
// KST wall clock as UTC components (the legacy stamp convention).
function stamp(date, time) {
    return Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), +time.slice(0, 2), +time.slice(2, 4));
}
function parts(t) { const s = new Date(t).toISOString(); return {date: s.slice(0, 10).replace(/-/g, ''), time: s.slice(11, 13) + s.slice(14, 16)}; }
function instant(date, time) { return stamp(date, time) - 9 * HOUR; }
function envelope(items, pageNo, rows, total) {
    return JSON.stringify({response: {header: {resultCode: '00', resultMsg: 'NORMAL_SERVICE'},
        body: {dataType: 'JSON', items: {item: items}, pageNo, numOfRows: rows, totalCount: total}}});
}
function paginate(items, rows) {
    rows = rows || 999;
    const pages = [];
    for (let i = 0; i < items.length; i += rows) pages.push(envelope(items.slice(i, i + rows), pages.length + 1, rows, items.length));
    return pages;
}
const GRID = {nx: 60, ny: 127};
function current(date, time, over) {
    over = over || {};
    const values = Object.assign({PTY: pick(['0', '0', '1', '3']), REH: String(40 + Math.floor(rnd() * 50)), RN1: pick(['0', '0', '0.5', '3']),
        T1H: (10 + rnd() * 15).toFixed(1), UUU: (rnd() * 6 - 3).toFixed(1), VEC: String(Math.floor(rnd() * 360)),
        VVV: (rnd() * 6 - 3).toFixed(1), WSD: (rnd() * 8).toFixed(1)}, over);
    const items = Object.keys(values).filter(c => values[c] !== null).map(c =>
        ({baseDate: date, baseTime: time, category: c, nx: GRID.nx, ny: GRID.ny, obsrValue: values[c]}));
    return {family: 'current', slot: {date, time}, period: date + '-' + time, pages: paginate(items, 999)};
}
function shortestCats(pub) { const c = ['LGT', 'PTY', 'RN1', 'SKY', 'T1H', 'REH', 'UUU', 'VVV', 'VEC', 'WSD']; if (pub >= '202606231100') c.push('POP'); return c; }
function shortest(date, time, opts) {
    opts = opts || {};
    const echo = opts.echo || time; // provider base time echo (HH30 request answered as HH00 or HH30)
    const base = stamp(date, time.slice(0, 2) + '00');
    const items = [];
    for (let h = 1; h <= 6; h++) {
        const at = parts(base + h * HOUR);
        for (const c of shortestCats(date + time)) {
            let v;
            switch (c) {
                case 'LGT': v = '0'; break;
                case 'PTY': v = pick(['0', '0', '1']); break;
                case 'RN1': v = pick(['강수없음', '강수없음', '1mm 미만', '2.0mm', '30.0~50.0mm', '50.0mm 이상']); break;
                case 'SKY': v = pick(['1', '3', '4']); break;
                case 'T1H': v = String(Math.round(10 + rnd() * 15)); break;
                case 'REH': v = String(40 + Math.floor(rnd() * 50)); break;
                case 'UUU': case 'VVV': v = (rnd() * 6 - 3).toFixed(1); break;
                case 'VEC': v = String(Math.floor(rnd() * 360)); break;
                case 'WSD': v = String(Math.floor(rnd() * 8)); break;
                case 'POP': v = pick(['0', '10', '30', '60']); break;
            }
            if (opts.mutate) v = opts.mutate(c, at, v);
            if (v !== null) items.push({baseDate: date, baseTime: echo, category: c, fcstDate: at.date, fcstTime: at.time, fcstValue: v, nx: GRID.nx, ny: GRID.ny});
        }
    }
    return {family: 'shortest', slot: {date, time}, period: date + '-' + time.slice(0, 2) + '00', pages: paginate(items, 999)};
}
function shortTimes(date, time) {
    const start = stamp(date, time), DAY = 24 * HOUR, times = [];
    const midnight = Math.floor(start / DAY) * DAY, extension = midnight + (+time.slice(0, 2) >= 17 ? 4 : 3) * DAY;
    for (let t = start + HOUR; t < extension; t += HOUR) times.push(parts(t));
    for (let t = extension; t < extension + DAY; t += 3 * HOUR) times.push(parts(t));
    return times;
}
function short(date, time, opts) {
    opts = opts || {};
    const items = [];
    for (const at of shortTimes(date, time)) {
        const cats = ['TMP', 'UUU', 'VVV', 'VEC', 'WSD', 'SKY', 'PTY', 'POP', 'WAV', 'PCP', 'REH', 'SNO'];
        if (at.time === '0600') cats.push('TMN');
        if (at.time === '1500') cats.push('TMX');
        for (const c of cats) {
            let v;
            switch (c) {
                case 'TMP': v = String(Math.round(5 + rnd() * 20)); break;
                case 'UUU': case 'VVV': v = (rnd() * 6 - 3).toFixed(1); break;
                case 'VEC': v = String(Math.floor(rnd() * 360)); break;
                case 'WSD': v = (rnd() * 8).toFixed(1); break;
                case 'SKY': v = pick(['1', '3', '4']); break;
                case 'PTY': v = pick(['0', '0', '1', '2', '3', '4']); break;
                case 'POP': v = pick(['0', '20', '60', '90']); break;
                case 'WAV': v = rnd() < 0.5 ? null : (rnd() * 2).toFixed(1); break;
                case 'PCP': v = pick(['강수없음', '강수없음', '1mm 미만', '1.0mm', '30.0~50.0mm', '50.0mm 이상']); break;
                case 'REH': v = String(40 + Math.floor(rnd() * 50)); break;
                case 'SNO': v = pick(['적설없음', '적설없음', '1cm 미만', '1.0cm']); break;
                case 'TMN': v = String(Math.round(rnd() * 10)); break;
                case 'TMX': v = String(Math.round(15 + rnd() * 10)); break;
            }
            if (opts.mutate) v = opts.mutate(c, at, v);
            if (v !== null) items.push({baseDate: date, baseTime: time, category: c, fcstDate: at.date, fcstTime: at.time, fcstValue: v, nx: GRID.nx, ny: GRID.ny});
        }
    }
    return {family: 'short', slot: {date, time}, period: date + '-' + time, pages: paginate(items, opts.rows || 999)};
}
function at(run, minutes) { run.fetched_at = instant(run.slot.date, run.slot.time) + minutes * 60000; return run; }

const scenarios = [];
// Current: merge of a refetch, a deleted negative field, rejects, retention over 216 h.
{
    const runs = [];
    let t = stamp('20260915', '0000');
    for (let i = 0; i < 230; i += 7) { const p = parts(t + i * HOUR); runs.push(at(current(p.date, p.time), 40)); }
    runs.push(at(current('20260924', '0800', {REH: '-1', PTY: '-1'}), 40));
    runs.push(at(current('20260924', '0800', {RN1: '1.5', T1H: '+18.2'}), 52));
    runs.push(at(current('20260924', '0900', {T1H: '-50'}), 40));          // t1h equals template: rejected
    runs.push(at(current('20260924', '0900', {RN1: null}), 41));          // rn1 missing: rejected
    runs.push(at(current('20260924', '0900', {WSD: 'abc'}), 42));         // NaN: rejected
    runs.push(at(current('20260924', '0900', {UUU: ' 1.5', VEC: '1e2'}), 50));
    runs.push(at(current('20260924', '1000', {T1H: '-101'}), 40));        // TW-401 reject
    runs.push(at(current('20260924', '1000', {REH: '55.5', SKY: '3'}), 45)); // SKY delivered
    scenarios.push({id: 'current', at: instant('20260924', '1050'), runs});
}
// Shortest: fence, tie, older backfill, echo forms, rejects, text precipitation.
{
    const runs = [];
    runs.push(at(shortest('20260924', '0730'), 45));
    runs.push(at(shortest('20260924', '0830', {echo: '0800'}), 45));
    runs.push(at(shortest('20260924', '0830'), 55));                       // same publication refetched: later wins
    runs.push(at(shortest('20260924', '0630'), 120));                      // older backfill after newer: fenced
    runs.push(at(shortest('20260924', '0930', {mutate: (c, a, v) => c === 'T1H' && a.time === '1200' ? '1.2.3' : v}), 45)); // rawItems reject
    runs.push(at(shortest('20260924', '0930', {mutate: (c, a, v) => c === 'LGT' && a.time === '1100' ? null : v}), 47));   // missing category
    runs.push(at(shortest('20260924', '0930', {echo: '0730'}), 49));      // other publication: reject
    runs.push(at(shortest('20260924', '0930', {mutate: (c, a, v) => c === 'POP' && a.time === '1300' ? '120' : v}), 50)); // pop -1: complete() fails
    runs.push(at(shortest('20260924', '0930', {mutate: (c, a, v) => c === 'RN1' ? '1mm 미만' : v}), 52));
    scenarios.push({id: 'shortest', at: instant('20260924', '1030'), runs});
}
// Short: overlapping publications, an older publication applied later, a two-page set, rejects.
{
    const runs = [];
    runs.push(at(short('20260922', '2300'), 12));
    runs.push(at(short('20260923', '0500'), 12));
    runs.push(at(short('20260923', '0200'), 300));                         // older, applied later
    runs.push(at(short('20260923', '0800', {mutate: (c, a, v) => c === 'TMP' && a.time === '1000' ? '-' : v}), 12)); // reject
    runs.push(at(short('20260923', '0800', {mutate: (c, a, v) => c === 'WAV' ? null : v}), 15));
    runs.push(at(short('20260923', '1100', {mutate: (c, a, v) => c === 'TMX' && a.date === '20260923' ? null : v}), 12));
    runs.push(at(short('20260923', '1400', {mutate: (c, a, v) => c === 'PCP' && a.time === '1800' ? '많음' : v}), 12)); // rawItems reject
    scenarios.push({id: 'short', at: instant('20260923', '1530'), runs});
}
// Retention: short rows older than 216 h before the anchor are dropped.
{
    const runs = [at(short('20260913', '0500'), 12), at(short('20260923', '0500'), 12)];
    scenarios.push({id: 'short-retention', at: instant('20260923', '0600'), runs});
}
module.exports = {scenarios, instant, stamp, parts};
```

### `rss-fixtures.js` (sha256 `3cfd7f3f9e4ca30426a9a5589f9661dfb2874f14148f60d950a17b3381b6e9f8`)

```js
/* Synthetic KMA queryDFS.jsp XML (root wid) for the S15b RSS oracle. */
'use strict';
const HOUR = 3600000;
function kst(ms) { const s = new Date(ms + 9 * HOUR).toISOString(); return s.slice(0, 4) + s.slice(5, 7) + s.slice(8, 10) + s.slice(11, 13) + s.slice(14, 16); }
/** Legacy TownRss.lastestPubDate at a wall-clock instant. */
function expected(ms) {
    const t = kst(ms), hour = +t.slice(8, 10);
    if (hour <= 2) return kst(ms - 24 * HOUR).slice(0, 8) + '2300';
    return t.slice(0, 8) + String((Math.floor(hour / 3) - 1) * 3 + 2).padStart(2, '0') + '00';
}
function xml(tm, rows) {
    const data = rows.map((r, i) => '<data seq="' + i + '">' + Object.keys(r).map(k => '<' + k + '>' + r[k] + '</' + k + '>').join('') + '</data>').join('\n');
    return '<?xml version="1.0" encoding="UTF-8" ?>\n<wid>\n<header>\n<tm>' + tm + '</tm>\n<ts>3</ts>\n<x>60</x>\n<y>127</y>\n</header>\n<body>\n' + data + '\n</body>\n</wid>\n';
}
function row(hour, day, over) {
    return Object.assign({hour, day, temp: '17.0', tmx: '-999.0', tmn: '-999.0', sky: '1', pty: '0', wfKor: '맑음', wfEn: 'Clear', pop: '0',
        r12: '0.0', s12: '0.0', ws: '1.8', wd: '6', wdKor: '서', wdEn: 'W', reh: '55', r06: '0.0', s06: '0.0'}, over || {});
}
function rows(tm, n, f) {
    const startHour = (+tm.slice(8, 10) + 4) - ((+tm.slice(8, 10) + 4) % 3);
    const out = [];
    for (let i = 0; i < n; i++) { const h = startHour + i * 3; out.push(f ? f(row(h % 24, Math.floor(h / 24)), i) : row(h % 24, Math.floor(h / 24))); }
    return out;
}
const scenarios = [];
{
    const t1 = Date.UTC(2026, 8, 24, 2, 2);  // 11:02 KST -> expected 0800
    const t2 = Date.UTC(2026, 8, 24, 5, 2);  // 14:02 KST -> expected 1100
    const t3 = Date.UTC(2026, 8, 24, 5, 30); // same publication again: skipped
    const p1 = expected(t1), p2 = expected(t2);
    const runs = [
        {fetched_at: t1, expected: p1, xml: xml(p1, rows(p1, 12, (r, i) => Object.assign(r, {temp: String(15 + i) + '.0', ws: i === 2 ? '1.23456' : r.ws,
            wfKor: i === 3 ? '구름조금' : i === 4 ? '구름 많음' : r.wfKor, wfEn: i === 4 ? 'Mostly Cloudy' : r.wfEn})))},
        {fetched_at: t2, expected: p2, xml: xml(p2, rows(p2, 12, (r, i) => {
            if (i === 1) delete r.wdEn;
            if (i === 5) r.temp = '';
            if (i === 6) Object.assign(r, {wfKor: '비', wfEn: 'Rain', pty: '1', pop: '80', r06: '5.0', wdKor: '남동', wdEn: 'SE'});
            return r;
        }))},
        {fetched_at: t3, expected: p2, xml: xml(p2, rows(p2, 12, r => Object.assign(r, {temp: '99.0'})))}
    ];
    scenarios.push({id: 'rss', at: t3 + 60000, last_run: Date.UTC(2026, 8, 24, 5, 2), runs});
}
{
    // Retention: rows older than 216 h before the last hourly run are dropped.
    const t0 = Date.UTC(2026, 8, 14, 23, 2), t1 = Date.UTC(2026, 8, 24, 2, 2);
    const p0 = expected(t0), p1 = expected(t1);
    const runs = [{fetched_at: t0, expected: p0, xml: xml(p0, rows(p0, 15))}, {fetched_at: t1, expected: p1, xml: xml(p1, rows(p1, 10))}];
    scenarios.push({id: 'rss-retention', at: t1 + 60000, last_run: t1, runs});
}
module.exports = {scenarios, expected};
```

### `mid-fixtures.js` (sha256 `863597b811fca42d6611df347f99aebf17b7acf412934a70a7cc4933ddcac76c`)

```js
/* Synthetic MidFcstInfoService JSON pages for the S15b mid oracle. */
'use strict';
function envelope(items) {
    return JSON.stringify({response: {header: {resultCode: '00', resultMsg: 'NORMAL_SERVICE'},
        body: {dataType: 'JSON', items: {item: items}, pageNo: 1, numOfRows: 999, totalCount: items.length}}});
}
function land(regId, over) {
    const item = {regId};
    for (let d = 3; d <= 10; d++) {
        (d <= 7 ? ['Am', 'Pm'] : ['']).forEach(h => {
            item['rnSt' + d + h] = 20 + d;
            item['wf' + d + h] = d % 2 ? '맑음' : '구름많고 비';
        });
    }
    return Object.assign(item, over || {});
}
function temp(regId, over) {
    const item = {regId};
    for (let d = 3; d <= 10; d++) {
        item['taMin' + d] = 10 + d; item['taMin' + d + 'Low'] = 0; item['taMin' + d + 'High'] = 0;
        item['taMax' + d] = 20 + d; item['taMax' + d + 'Low'] = 0; item['taMax' + d + 'High'] = 0;
    }
    return Object.assign(item, over || {});
}
const H = 3600000;
const at = (tmfc, minutes) => Date.UTC(+tmfc.slice(0, 4), +tmfc.slice(4, 6) - 1, +tmfc.slice(6, 8), +tmfc.slice(8, 10) - 9) + minutes * 60000;
const run = (kind, code, tmfc, minutes, items) => ({kind, code, tmfc, fetched_at: at(tmfc, minutes), pages: [envelope(items)]});
module.exports = {scenarios: [{
    id: 'mid',
    runs: [
        run('forecast', '109', '202609240600', 122, [{wfSv: '○ (강수) 25일(목) 오전까지 비가 오겠습니다.'}]),
        run('forecast', '109', '202609240600', 182, [{wfSv: 'refetch of the same publication is skipped'}]),
        run('forecast', '109', '202609241800', 122, [{wfSv: '○ (기온) 평년보다 높겠습니다.'}]),
        run('forecast', '108', '202609241800', 122, [{wfSv: ' '}]),
        run('land', '11B00000', '202609240600', 122, [land('11B00000', {wf5Am: '알수없음', rnSt6Pm: 120, wf8: ' 흐림 '})]),
        run('land', '11B00000', '202609241800', 122, [land('11B00000', {wf3Am: 'x', wf3Pm: 'x', wf4Am: 'x', wf4Pm: 'x', wf5Am: 'x', wf5Pm: 'x', wf6Am: 'x', wf6Pm: 'x',
            wf7Am: 'x', wf7Pm: 'x', wf8: 'x', wf9: 'x', wf10: 'x'})]),
        run('temp', '11B10101', '202609240600', 122, [temp('11B10101', {taMin4: -55, taMax9: '27.5'})]),
        run('temp', '11B10101', '202609241800', 122, [temp('11B10101', Object.fromEntries([3, 4, 5, 6, 7, 8, 9, 10].flatMap(d => [['taMin' + d, 99], ['taMax' + d, 99]])))]),
        run('temp', '11D20501', '202609241800', 122, [temp('11D20501')])
    ],
    queries: [['forecast', '109'], ['forecast', '108'], ['land', '11B00000'], ['temp', '11B10101'], ['temp', '11D20501'], ['land', '11D10000']]
}]};
```
