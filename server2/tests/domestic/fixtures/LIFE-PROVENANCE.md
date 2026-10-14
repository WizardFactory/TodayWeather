# S15b-3b life store oracle fixture

`life.json.gz` (sha256 `ce0a6ae7ad8df3d0cd85f90ca8c5fbf91991ae29375ead379f1e97402a29bfad`) holds pinned legacy-oracle results for the
S15b-3b tests (`server2/tests/domestic/life.rs`, `life_s3.rs`). It is test data only; the server2
runtime never reads it or any legacy file.

## Recording

- Legacy source: repository master `7ca6f002`; the sha256 of every legacy file loaded while
  recording is stored in `source.files` (16 files).
- Runtime and dependencies: the S15b-3a oracle (see `AIR-PROVENANCE.md`): Node.js `v16.20.2`,
  `TZ=UTC`, `NODE_ENV=production`, the S15 oracle `node_modules` and `mongoose` 5.1.2 over the
  in-memory collection double with the emulated 2d `$near`. `axios` is a deterministic Kakao
  address-search stub that answers `x`/`y` as strings, as Kakao did live on 2026-10-15.
- Inputs: synthetic, deterministic generators shaped like the live answers of 2026-10-15
  (`getUVIdxV5`, `get*PollenRiskIdxV3` with `twodaysaftertomorrow`, `getAreaRiseSetInfo`,
  `poisonmap.mfds.go.kr/api/risk.do`). The area numbers use the repository lists themselves. No
  live value is copied.
- Run: `run.sh record-life.js <out.json.gz> area,life,kasi,mfds`. Recording twice gives identical
  bytes (checked).

## What is recorded

- `area`: `utils/updateAreaNo.js`'s save of every geocoded 2016 line (3703 documents), then
  `utils/update.areano.to.db.js` run unchanged over the 2018 list (104 new towns
  asked Kakao; every one threw at `x.toFixed`, so none was stored); the final `areaNoList`
  documents, 6 `findAreaNo` answers and 5 `findNearAreaNo` answers.
- `life`: 61 UV and pollen acquisitions through the `taskUltrvV5`/`taskPollenV3` steps
  (`lastIssued` skip, `_removeOldData`, `convertUvItemsV5`, `convertPollenItemsV3`,
  `saveLifeIndex2`), the stored `lifeIndexKma2` documents (131) and
  21 `_fromLifeIndexDb2` answers at three instants between the runs.
- `kasi`: 108 area/day acquisitions through `updateAreaRiseSetFromApi` (a stored day is
  skipped), the `kasiRiseSet` documents (102) and 12
  `getRiseSetList` answers.
- `mfds`: 9 `foodPoisoning.collect` runs (one with an older publication), the stored
  rows (55) and 7 `append` reader queries.

## Driver source

### `record-life.js` (sha256 `7431afe5c2dbe258012d62fc472d65213ef39591098c610820053de16a8d6378`)

```js
/* S15b-3b life store oracle driver (task evidence, not a repository tool). No network.
 * Run: run.sh record-life.js <out.json.gz>
 */
'use strict';
const L = require('./legacy');
const fs = require('fs'), zlib = require('zlib'), assert = require('assert');
const mongoose = require('mongoose');
if (process.version !== 'v16.20.2') throw new Error('Pinned oracle Node v16.20.2 required');
if (process.env.TZ !== 'UTC') throw new Error('TZ=UTC required');
assert.strictEqual(require('mongoose/package.json').version, '5.1.2');
const out = {schema: 1, oracle: {node: process.version, tz: process.env.TZ, mongoose: '5.1.2'}};
const ej = L.fake.ejson;
(async () => {
    const sections = process.argv[3] ? process.argv[3].split(',') : ['life'];
    for (const s of sections) {
        const mod = require('./sections-' + s);
        Object.assign(out, {[s]: await mod[s](L, {mongoose, ej})});
    }
    out.source = {files: Object.fromEntries(Object.entries(L.sourceFiles).sort())};
    const json = JSON.stringify(out);
    fs.writeFileSync(process.argv[2], zlib.gzipSync(Buffer.from(json), {level: 9, mtime: 0}));
    console.log('recorded', sections.join(','), json.length);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

```

### `sections-area.js` (sha256 `9db457c9ba6f215954d37e9a62fa37d9d6f9e0a9ea0e6c79182831641b8231ab`)

```js
/* S15b-3b oracle section (task evidence): the legacy area-number collection. Base: the 2016
 * geocoded list (`utils/data/20160704_AreaNoResutl`) saved as `utils/updateAreaNo.js` saves a
 * town (`update({town}, {areaNo, town, geo}, {upsert})`); then `utils/update.areano.to.db.js`
 * runs unchanged over the 2018 list with a deterministic Kakao address-search stub. Readers:
 * `controllerTown.getLifeIndexKma` `findAreaNo` and `findNearAreaNo`. */
'use strict';
const path = require('path');
const fs = require('fs');
function cb2p(fn) { return new Promise(resolve => fn((err, v) => resolve({err, v}))); }

async function area(L, {mongoose, ej}) {
    const Area = L.load('models/modelAreaNo.js');
    const Town = L.load('models/town.js');
    const coll = L.fake.attach(Area);
    L.fake.attach(Town);
    // 2016 base: every geocoded result line, as updateAreaNo.js stores it.
    const lines = fs.readFileSync(path.join(L.server, 'utils/data/20160704_AreaNoResutl'), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
        const r = JSON.parse(line);
        if (!r.geocode) continue;
        const saved = {areaNo: r.areaNo, town: r.town, geo: [r.geocode.lon, r.geocode.lat]};
        await cb2p(cb => Area.update({town: saved.town}, saved, {upsert: true}, cb));
    }
    const base = coll.docs.length;
    // 2018 update with the Kakao stub: x/y derived from the address text.
    const geocoded = [];
    global.ORACLE_AXIOS_GET = (url) => {
        const q = decodeURIComponent(url.split('query=')[1] || '');
        let h = 0;
        for (const c of q) h = (h * 31 + c.codePointAt(0)) % 1000003;
        const x = 126 + (h % 30000) / 10000, y = 34 + ((h >> 3) % 40000) / 10000;
        geocoded.push({query: q, x, y});
        // Kakao answers x/y as strings (live 2026-10-15), as the legacy script receives them.
        return Promise.resolve({data: {meta: {total_count: 1}, documents: [{x: String(x), y: String(y)}]}});
    };
    const cwd = process.cwd();
    process.chdir(L.server);
    let finished;
    const done = new Promise(r => { finished = r; });
    const realInfo = console.info;
    console.info = (msg) => { if (msg === 'finish') setTimeout(finished, 200); };
    mongoose.connect = () => Promise.resolve();
    require(path.join(L.server, 'utils/update.areano.to.db.js'));
    await done;
    await new Promise(r => setTimeout(r, 500));
    console.info = realInfo;
    process.chdir(cwd);
    const docs = coll.docs.map(d => { const o = Object.assign({}, d); delete o._id; return o; });
    // Reader answers (find(...).limit(1) and $near maxDistance 0.3 limit 3), without _id.
    const strip = list => ej(list.map(d => { const o = Object.assign({}, d); delete o._id; return o; }));
    const towns = [['서울특별시', '종로구', '청운효자동'], ['서울특별시', '', ''], ['부산광역시', '강서구', '명지1동'],
        ['세종특별자치시', '세종특별자치시', '새롬동'], ['경기도', '수원시권선구', '금곡동'], ['없는도', '없는시', '없는동']];
    const byTown = [];
    for (const [f, s, t] of towns) {
        const r = await Area.find({'town.first': f, 'town.second': s, 'town.third': t}).limit(1).lean().exec();
        byTown.push({args: [f, s, t], result: strip(r)});
    }
    const points = [[126.978, 37.5665], [129.0756, 35.1796], [127.289, 36.48], [127.0, 37.27], [124.0, 33.0]];
    const near = [];
    for (const g of points) {
        const r = await Area.find({geo: {$near: g, $maxDistance: 0.3}}).limit(3).lean().exec();
        near.push({args: g, result: strip(r)});
    }
    return {base, geocoded, docs: ej(docs), byTown, near};
}
module.exports = {area};

```

### `sections-life.js` (sha256 `ce3e9f4b8cf5baede7a876a3e94a16b46fa3d695da1294583e439832af7fe478`)

```js
/* S15b-3b oracle section (task evidence): legacy life-index collection (lifeIndexKmaRequester
 * convertUvItemsV5 / convertPollenItemsV3, saveLifeIndex2, _removeOldData, the in-memory
 * lastIssued skip) and the tw_svc reader (lifeIndexKmaController._fromLifeIndexDb2) over the
 * in-memory collection double. */
'use strict';
const F = require('./life-fixtures');
const RealDate = Date;
let NOW = 0;
class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(NOW); }
    static now() { return NOW; }
}
async function withClock(ms, fn) {
    const saved = global.Date; NOW = ms; global.Date = FakeDate;
    try { return await fn(); } finally { global.Date = saved; }
}
function cb2p(fn) { return new Promise(resolve => fn((err, v) => resolve({err, v}))); }

async function life(L, {ej}) {
    const Model = L.load('models/kma/kma.lifeindex.model.js');
    const coll = L.fake.attach(Model);
    const Requester = L.load('lib/lifeIndexKmaRequester.js');
    const Controller = L.load('controllers/lifeIndexKmaController.js');
    const svc = new Requester();
    const base = RealDate.UTC(2026, 9, 14, 3, 0); // 12:00 KST
    // Acquisitions in completion order (UV every 3 hours, pollen twice a day per type).
    const runs = [];
    F.uv(base).forEach(a => runs.push(Object.assign({kind: 'ultrv'}, a)));
    ['flowerWoody', 'flowerPine', 'flowerWeeds'].forEach(t => F.pollen(base, t).forEach(a => runs.push(Object.assign({kind: t}, a))));
    runs.sort((a, b) => a.fetched - b.fetched || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
    const last = {};
    const outcomes = [];
    const queries = [];
    const queryTimes = [base - 50 * 3600000, base - 3600000, base + 3600000];
    let q = 0;
    const answer = async (t) => {
        for (const area of F.AREAS.concat(['9999999999'])) {
            const r = await withClock(t, () => cb2p(cb => Controller._fromLifeIndexDb2(parseInt(area), cb)));
            queries.push({now: t, areaNo: area, error: r.err ? r.err.message : null,
                result: r.err ? null : ej(r.v.map(d => { const o = Object.assign({}, d); delete o._id; return o; }))});
        }
    };
    for (const a of runs) {
        while (q < queryTimes.length && queryTimes[q] < a.fetched) await answer(queryTimes[q++]);
        await withClock(a.fetched, async () => {
            // taskUltrvV5 / taskPollenV3: skip an issuance not newer than the last saved one.
            if (last[a.kind] && a.issued <= last[a.kind]) { outcomes.push({kind: a.kind, issued: a.issued, skipped: true}); return; }
            if (a.kind === 'ultrv') svc._removeOldData();
            const rows = a.kind === 'ultrv' ? svc.convertUvItemsV5(a.items) : svc.convertPollenItemsV3(a.kind, a.items);
            if (!rows.length) { outcomes.push({kind: a.kind, issued: a.issued, rows: 0}); return; }
            const saved = await cb2p(cb => svc.saveLifeIndex2(a.kind, rows, cb));
            last[a.kind] = a.issued;
            outcomes.push({kind: a.kind, issued: a.issued, rows: rows.length, error: saved.err ? saved.err.message : null});
        });
    }
    while (q < queryTimes.length) await answer(queryTimes[q++]);
    return {runs: runs.map(r => ({kind: r.kind, fetched: r.fetched, issued: r.issued, items: r.items})), outcomes, queries,
        docs: ej(coll.docs.map(d => { const o = Object.assign({}, d); delete o._id; return o; }))};
}
module.exports = {life};

```

### `life-fixtures.js` (sha256 `d412c121a7cb3959f9cebbc21c5eee6a04a6efcda854389d13bb4f55104bcf1c`)

```js
/* Synthetic life-index inputs for the S15b-3b store oracle (task evidence). Shapes follow the
 * data.go.kr getUVIdxV5 / get*PollenRiskIdxV3 JSON items (areaNo, date YYYYMMDDHH, h0..h78 or
 * today..twodaysaftertomorrow); every value is generated. */
'use strict';
const AREAS = ['1100000000', '1111051500', '1111053000', '2611051000', '4113555000', '5013025300'];
function pad(n) { return (n < 10 ? '0' : '') + n; }
function issuance(ms) {
    const d = new Date(ms + 9 * 3600000);
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}`;
}
function uvItem(area, issued, k) {
    const it = {code: 'A07_2', areaNo: area, date: issued};
    for (let n = 0; n <= 78; n += 3) {
        const v = (area.length + n + k * 7) % 13;
        it['h' + n] = n % 33 === 30 ? '' : String(v);
    }
    if (k % 3 === 1) it.h12 = '-1';
    return it;
}
function pollenItem(area, issued, k, type) {
    const g = (s) => String((area.charCodeAt(4) + s + k + type.length) % 5);
    // The real V3 item carries day+3 as `twodaysaftertomorrow` (live 2026-10-15); legacy reads
    // `todaysaftertomorrow`, which a few synthetic items also carry.
    const it = {code: 'D07', areaNo: area, date: issued, today: g(0), tomorrow: g(1),
        dayaftertomorrow: g(2), twodaysaftertomorrow: g(3)};
    if (k % 5 === 0) it.todaysaftertomorrow = g(5);
    if (k % 2 === 1) { delete it.dayaftertomorrow; it.theDayAfterTomorrow = g(4); }
    if (k % 3 === 2) it.today = '';
    return it;
}
/** UV acquisitions every 3 hours from base - 4 days through base (issuance order, one skipped repeat). */
function uv(base) {
    const out = [];
    for (let h = -96; h <= 0; h += 3) {
        const ms = base + h * 3600000;
        const issued = issuance(ms);
        out.push({fetched: ms + 40 * 60000, issued, items: AREAS.map((a, i) => uvItem(a, issued, i + h))});
    }
    out.push(Object.assign({}, out[out.length - 2], {fetched: base + 50 * 60000}));
    return out;
}
function pollen(base, type) {
    const out = [];
    for (let d = -4; d <= 0; d++) {
        [6, 18].forEach(hh => {
            // KST midnight of the base day, plus d days and the publication hour.
            const kstMidnight = Math.floor((base + 9 * 3600000) / 86400000) * 86400000 - 9 * 3600000;
            const ms = kstMidnight + d * 86400000 + hh * 3600000;
            if (ms > base) return;
            const issued = issuance(ms);
            out.push({fetched: ms + 10 * 60000, issued, type,
                items: AREAS.slice(0, type === 'flowerPine' ? 3 : 6).map((a, i) => pollenItem(a, issued, i + d, type))});
        });
    }
    return out;
}
module.exports = {AREAS, uv, pollen, issuance};

```

### `sections-kasi.js` (sha256 `dcf55d824016d2200a2399325cd83a5a116cd1a8144a4f1300c4b6b88f40ccb5`)

```js
/* S15b-3b oracle section (task evidence): the legacy KASI rise/set collection
 * (`gatherAreaRiseSetFromApi` -> `updateAreaRiseSetFromApi`: skip a stored area/day,
 * `_apiRaw2modelKasiRiseSet`, `_updateKasiRiseSet`) and the tw_svc reader
 * `getRiseSetList(geocode, dates)` over the in-memory collection double. Items follow the live
 * `getAreaRiseSetInfo` JSON (strings with trailing spaces, `------` for a missing moon event). */
'use strict';
function cb2p(fn) { return new Promise(resolve => fn((err, v) => resolve({err, v}))); }
function pad(n) { return (n < 10 ? '0' : '') + n; }
const AREAS = [['서울', 37.56, 126.98], ['인천', 37.47, 126.62], ['수원', 37.26, 127.03], ['부산', 35.1, 129.03],
    ['제주', 33.5, 126.52], ['울릉도', 37.48, 130.9]];
function hhmm(min) { return pad(Math.floor(min / 60)) + pad(min % 60) + '  '; }
function item(area, day, k) {
    const [loc, lat, lon] = area;
    const base = 380 + (k * 7 + day.charCodeAt(7)) % 30;
    return {aste: hhmm(base + 800), astm: hhmm(base - 90), civile: hhmm(base + 690), civilm: hhmm(base - 30),
        latitude: String(Math.round(lat * 100)), latitudeNum: lat.toFixed(7), location: loc, locdate: Number(day),
        longitude: String(Math.round(lon * 100)), longitudeNum: k % 3 === 0 ? lon : lon.toFixed(7),
        moonrise: k % 4 === 0 ? '------' : hhmm(base + 300), moonset: hhmm(base + 100), moontransit: k % 5 === 0 ? '------' : hhmm(base + 1000),
        naute: hhmm(base + 760), nautm: hhmm(base - 60), sunrise: hhmm(base), sunset: hhmm(base + 720), suntransit: hhmm(base + 360)};
}
function days(from, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
        const d = new Date(Date.UTC(2026, 9, from + i));
        out.push(`${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`);
    }
    return out;
}
async function kasi(L, {ej}) {
    const Model = L.load('models/modelKasiRiseSet.js');
    const coll = L.fake.attach(Model);
    const K = L.load('controllers/kasi.riseset.controller.js');
    // kmaTimeLib formatting uses the Manager's leadingZeros (a global in the legacy process).
    global.manager = global.manager || {leadingZeros: (n, digits) => { n = n.toString(); return n.length < digits ? '0'.repeat(digits - n.length) + n : n; }};
    const runs = [];
    let k = 0;
    // Area acquisitions: each area for 10-08..10-24, a repeated day (already saved: skipped).
    for (const area of AREAS) {
        for (const day of days(8, 17).concat(['20261010'])) {
            const raw = item(area, day, k++);
            const found = await cb2p(cb => K._findKasiRiseSet(area[0], new Date(Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8))), cb));
            if (found.v && found.v.length) { runs.push({area: area[0], day, raw, skipped: true}); continue; }
            const model = await cb2p(cb => K._apiRaw2modelKasiRiseSet(raw, cb));
            const saved = model.err ? model : await cb2p(cb => K._updateKasiRiseSet(model.v, cb));
            runs.push({area: area[0], day, raw, error: saved.err ? saved.err.message : null});
        }
    }
    const queries = [];
    const geos = [{lat: 37.5665, lon: 126.978}, {lat: 37.3, lon: 127.0}, {lat: 33.0, lon: 124.0}, {lat: 38.5, lon: 132.0}];
    const lists = [days(10, 18), days(20, 10), days(1, 3)];
    for (const g of geos) {
        for (const dates of lists) {
            const r = await cb2p(cb => K.getRiseSetList(g, dates, cb));
            queries.push({geocode: g, dates, error: r.err ? r.err.message : null, result: r.err ? null : ej(r.v)});
        }
    }
    return {runs, queries, docs: ej(coll.docs.map(d => { const o = Object.assign({}, d); delete o._id; return o; }))};
}
module.exports = {kasi};

```

### `sections-mfds.js` (sha256 `7718738f68413a82051763da83fe25b6f87bef408b4a44d734539ca0adf9eb1f`)

```js
/* S15b-3b oracle section (task evidence): legacy MFDS food-poisoning collection
 * (`lib/foodPoisoning.create().collect`: slot, `parse`, `updateOne({_id, publication <= }, $set,
 * upsert)`) and the reader query of `append` over the in-memory collection double. Bodies follow
 * the live `https://poisonmap.mfds.go.kr/api/risk.do` shape of 2026-10-15 (generated values). */
'use strict';
const RealDate = Date;
function cb2p(fn) { return new Promise(resolve => fn((err, v) => resolve({err, v}))); }
function pad(n) { return (n < 10 ? '0' : '') + n; }
const SD = [['서울특별시', null], ['서울특별시', '종로구'], ['서울특별시', '중구'], ['부산광역시', null], ['부산광역시', '해운대구'],
    ['경기도', '수원시장안구'], ['광주광역시', null], ['광주광역시', '동구'], ['전라남도', '목포시'], ['강원특별자치도', '춘천시'],
    ['전북특별자치도', '전주시완산구']];
function body(baseDate, reg, k) {
    return {success: true, data: SD.map(([sd, sgg], i) => {
        const r = (x) => Math.round(((i * 37 + k * 11 + x * 7) % 100) / 100 * 1000) / 1000;
        const row = {locationId: i + 1, sd, sgg, todayRisk: r(0), tomorrowRisk: r(1), afterTomorrowRisk: r(2),
            baseDate, regDatetime: reg, todayRisk2: r(0) * 100, tomorrowRisk2: r(1) * 100, afterTomorrowRisk2: r(2) * 100};
        if ((i + k) % 7 === 3) row.afterTomorrowRisk = null;
        if ((i + k) % 9 === 4) row.tomorrowRisk = 1.5;
        return row;
    })};
}
async function mfds(L, {ej}) {
    const Model = L.load('models/modelFoodPoisoning.js');
    const coll = L.fake.attach(Model);
    const FP = L.load('lib/foodPoisoning.js');
    const runs = [];
    // Slots 08:20, 12:20 and 17:20 KST over three days; the provider publishes at 07/11/17 KST.
    let k = 0;
    for (const day of [12, 13, 14]) {
        for (const [hh, pub] of [[8, '0700'], [12, '1100'], [17, '1700']]) {
            const now = RealDate.UTC(2026, 9, day, hh - 9, 20 + k % 3);
            const baseDate = `202610${pad(day)}`;
            const reg = `2026-10-${pad(day)}${pub}`;
            const b = k === 4 ? body(baseDate, `2026-10-${pad(day)}0700`, k - 1) : body(baseDate, reg, k);
            const service = FP.create({fetch: cb => cb(null, JSON.parse(JSON.stringify(b))), now: () => new RealDate(now),
                store: Model});
            const r = await cb2p(cb => service.collect(new RealDate(now), cb));
            runs.push({now, body: b, saved: r.v || 0, error: r.err ? r.err.message : null});
            k++;
        }
    }
    const queries = [];
    for (const [sd, sgg, start, end] of [['서울특별시', '종로구', '20261014', '20261016'], ['서울특별시', '없는구', '20261014', '20261016'],
        ['부산광역시', '해운대구', '20261013', '20261015'], ['광주광역시', '동구', '20261014', '20261016'], ['전라남도', '목포시', '20261012', '20261014'],
        ['강원특별자치도', '춘천시', '20261014', '20261016'], ['없는도', '', '20261014', '20261016']]) {
        const rows = await Model.find({sd, sgg: {$in: [sgg, '']}, date: {$gte: start, $lte: end}}).lean().exec();
        queries.push({args: [sd, sgg, start, end], result: ej(rows)});
    }
    return {runs, queries, docs: ej(coll.docs)};
}
module.exports = {mfds};

```

### `legacy.js` (sha256 `f585045807afaa3ac01ed9c47bc29891f9f41d217b5fe38e2c5388309fc4466a`)

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
    // S15b-3: image and AWS modules are loaded by kecoRequester but never used offline.
    'get-pixels': noNetwork,
    'aws-sdk': {S3: function () { this.upload = noNetwork; this.listObjectsV2 = noNetwork; }, config: {update() {}}},
    // S15b-3b: a section may answer GETs deterministically (the Kakao address-search stub).
    axios: {get: (...a) => global.ORACLE_AXIOS_GET ? global.ORACLE_AXIOS_GET(...a) : noNetwork(), post: noNetwork},
};
const rawLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (stubs[request]) return stubs[request];
    // The utilities create a Winston/Logentries logger that writes files: use the silent log.
    if (/lib\/log(\.js)?$/.test(request)) {
        return function () { return global.log; };
    }
    if (/config\/config(\.js)?$/.test(request)) {
        return {db: {version: '2.0', path: '', options: {}}, keyString: {kakao_keys: '["oracle-kakao-key"]'}, mode: 'service', serviceServer: {}, gather: {},
            image: global.ORACLE_IMAGE_CONFIG || {airkorea_korea_image: {coordi: {}, size: {}, pixel_pos: {}},
                kaq_korea_image: {coordi: {}, size: {}, pixel_pos: {}, so2_pixel_pos: {}},
                kaq_korea_modelimg_image: {coordi: {}, size: {}, pixel_pos: {}}}};
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

### `fakemongo.js` (sha256 `af919f3cc3c934edb3963eefde7f04dfac68a2aeaaf399be0a482bd680e78ad8`)

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
        } else if (op === '$inc') {
            for (const k of Object.keys(body)) setPath(doc, k, (get(doc, k) || 0) + body[k]);
        } else if (op === '$push' || op === '$pushAll') {
            for (const k of Object.keys(body)) {
                const v = body[k];
                const add = op === '$pushAll' ? v : (v && typeof v === 'object' && v.$each ? v.$each : [v]);
                const cur = get(doc, k);
                setPath(doc, k, (Array.isArray(cur) ? cur : []).concat(add));
            }
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
        // 2d `$near` (S15b-3): planar distance over [lon, lat], `$maxDistance` inclusive, ascending
        // distance, natural order for ties; the remaining conditions filter as usual.
        let near = null;
        query = Object.assign({}, query || {});
        for (const k of Object.keys(query)) {
            const c = query[k];
            if (c && typeof c === 'object' && !Array.isArray(c) && c.$near) { near = {k, c}; delete query[k]; }
        }
        let list = this.docs.filter(d => matches(d, query));
        if (near) {
            const [x0, y0] = near.c.$near;
            const dist = d => { const g = get(d, near.k); return Array.isArray(g) ? Math.hypot(g[0] - x0, g[1] - y0) : Infinity; };
            list = list.map((d, i) => ({d, i, r: dist(d)}))
                .filter(e => e.r <= (near.c.$maxDistance === undefined ? Infinity : near.c.$maxDistance))
                .sort((a, b) => a.r - b.r || a.i - b.i).map(e => e.d);
        }
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
            // S15b-3b: an upsert whose query names an existing _id is a duplicate key (E11000).
            if (query && query._id !== undefined && this.docs.some(d => d._id === query._id)) {
                const err = new Error('E11000 duplicate key error collection: ' + this.name);
                err.code = 11000;
                return {error: err};
            }
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
    updateOne(q, u, o, cb) { if (typeof o === 'function') { cb = o; o = {}; } const r = this._update(q, u, o, false); if (cb) process.nextTick(() => r.error ? cb(r.error) : cb(null, r)); return r.error ? Promise.reject(r.error) : Promise.resolve(r); }
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
