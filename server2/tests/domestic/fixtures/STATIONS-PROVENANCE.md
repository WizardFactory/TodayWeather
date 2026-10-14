# S15b-2 station and ASOS oracle fixtures

`stations.json.gz` (sha256 `e00e98d1759ecc4aa9eae5331b63316d080cade0ae38c2c2bcb782ba213f185a`) holds pinned legacy-oracle results for the S15b-2 station
and ASOS tests (`server2/tests/domestic/stations.rs`, `server2/tests/domestic/asos.rs`).
`kmastninfos.jsonl` is a synthetic, provenance-labelled `mongoexport`-shaped sample of the legacy
`kmastninfos` collection (three invented stations; the field forms of relaxed and canonical
Extended JSON) for the station-seed converter and importer tests. Both are test data only; the
server2 runtime never reads them or any legacy file.

## Recording

- Legacy source: repository master `f49921b6` (merged into the S15b-2 branch); the sha256 of every
  legacy file loaded while recording is stored in `source.files` (19 files). Recording twice gives
  identical bytes.
- Runtime: Node.js `v16.20.2` (the S15 oracle tarball, see `PROVENANCE.md`), `TZ=UTC`,
  `NODE_ENV=production`, the S15 oracle `node_modules` (`cheerio` 0.20.0, the legacy
  `server/package.json` version, and `iconv-lite`) and `mongoose` 5.1.2 (see
  `SOURCE-PROVENANCE.md`). The native `iconv` module is replaced by `iconv-lite`'s EUC-KR decoder;
  inputs use KS X 1001 text only, where both agree. No network was used while recording: HTTP
  modules are stubs that throw, the ASOS provider gets a scripted in-process transport and station
  geocoding a fixed table.
- Database: none. Models are attached to the in-memory collection double (`fakemongo.js`, with the
  2d `$near` order: planar distance in degrees, `$maxDistance` inclusive, ties in natural order);
  `lib/history/store.js` gets a native-collection double with `$exists` and upsert.
- Inputs: synthetic AWS minute/hourly pages (EUC-KR) and city observation pages built by
  `station-fixtures.js`, two committed page fixtures, and for ASOS the live 2026-10-14 station-108
  range bodies (`AsosHourlyInfoService` 168 items, `AsosDalyInfoService` 7 items; observation
  values only, no key) with listed edits (missing humidity, a QC flag, a foreign station, a
  repeated hour, rain and cloud edits, an inverted daily range), synthetic December bodies and
  provider rejections.
- Run: `TZ=UTC NODE_ENV=production NODE_PATH=<mongoose node_modules>:<S15 oracle node_modules>
  TW_REPO=<repo> node record-stations.js <out.json.gz>`.

## What is recorded

- `pages`: `KmaScraper._parseStnMinInfo` (cheerio over the decoded AWS page) and
  `_decodeKmaHtml`/`_parseCityWeatherHtml` results, or the legacy error, per page.
- `merge`: `_mergeAWSandCity` of an AWS and a city page.
- `stn`: five scenarios replaying hourly runs (`_saveStnInfo` per row, serialized in page order,
  then `_saveStnHourly2`; city-unavailable runs keep `isCityWeather`) and minute pages
  (`_saveKmaStnMinute2List`), the resulting `KmaStnInfo`, `KmaStnHourly2` and `KmaStnMinute2`
  documents, and `controllerKmaStnWeather.getStnHourlyAndMinRns`/`getCityHourlyList` answers at a
  fixed clock for each town.
- `asos`: `lib/history/Recovery.run` with the real `Provider` (paging and checks) and `Store`
  over successive runs: the provider requests with their bodies, the recovery report, the
  `asos_history` documents and the `Store.read` answers of the window.

## Driver source

The scripts below are retained as documentation rather than as executable repository tools (a
server2-located script reading legacy source would be a placement exception; S11/S15 precedent).

### `record-stations.js` (sha256 `9b01bf4f324af8a43bd8d635b1b903ba7845cef1ada9286f7e7df71ba651c253`)

```js
/* S15b-2 station oracle driver (task evidence). Run: TZ=UTC NODE_PATH=... TW_REPO=<repo> node record-stations.js <out.json.gz> */
'use strict';
const L = require('./legacy');
const fs = require('fs'), zlib = require('zlib');
const S = require('./sections-stations');
const extra = Object.assign({}, require('./sections-stn'), require('./sections-asos'));
(async () => {
    const out = {schema: 1, oracle: {node: process.version, tz: process.env.TZ, cheerio: require('cheerio/package.json').version, mongoose: require('mongoose/package.json').version}};
    out.pages = await S.pages(L);
    out.merge = await S.merge(L);
    for (const [name, run] of Object.entries(extra)) out[name] = await run(L);
    out.source = {files: Object.fromEntries(Object.entries(L.sourceFiles).sort())};
    fs.writeFileSync(process.argv[2], zlib.gzipSync(Buffer.from(JSON.stringify(out)), {level: 9, mtime: 0}));
    for (const p of out.pages) console.log(p.id, p.result.error || (p.result.pubDate + ' rows=' + p.result.rows.length));
    for (const m of out.merge) console.log(m.id, m.merged.length);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
```

### `sections-stations.js` (sha256 `426032acabfc7d8ed1ec81729e38bf0958cb2e532fef7565416463e4c440f18c`)

```js
/* S15b-2 station oracle sections (task evidence). Runs legacy KmaScraper parsers with cheerio
 * 0.20.0 (the S15 oracle dependency) over page inputs. `iconv` (a native legacy dependency) is
 * replaced by iconv-lite's EUC-KR decoder; inputs use KS X 1001 text only, where both agree. */
'use strict';
const Module = require('module');
const fs = require('fs');
const path = require('path');

function installIconv() {
    const lite = Module._load('iconv-lite', module);
    const rawLoad = Module._load;
    Module._load = function (request) {
        if (request === 'iconv') {
            return {Iconv: function () { this.convert = buf => Buffer.from(lite.decode(buf, 'euc-kr'), 'utf8'); }};
        }
        return rawLoad.apply(this, arguments);
    };
}
function scraper(L) {
    installIconv();
    const Scraper = L.load('lib/kmaScraper.js');
    return new Scraper();
}
const cheerio = () => Module._load('cheerio', module);

function ej(v) {
    if (v instanceof Date) return {$date: v.getTime()};
    if (Array.isArray(v)) return v.map(ej);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = ej(v[k]); return o; }
    if (typeof v === 'number' && !isFinite(v)) return {$number: String(v)};
    return v;
}
/** Legacy AWS page parse: getAWSWeather decoding then _parseStnMinInfo. */
function parseAws(s, bytes, requested) {
    const lite = Module._load('iconv-lite', module);
    const text = Buffer.from(lite.decode(bytes, 'euc-kr'), 'utf8').toString();
    const $ = cheerio().load(text);
    let out;
    s._parseStnMinInfo(requested, $, (err, res) => { out = err ? {error: err.state || err.message} : {pubDate: res.pubDate, rows: ej(res.stnList)}; });
    return out;
}
function parseCity(s, bytes, contentType, requested) {
    const text = s._decodeKmaHtml(bytes, {headers: {'content-type': contentType}});
    const res = s._parseCityWeatherHtml(text, requested);
    if (res instanceof Error) return {error: res.message.split('=')[0]};
    return {pubDate: res.pubDate, rows: ej(res.cityList)};
}

async function pages(L) {
    const s = scraper(L);
    const fx = require('./station-fixtures');
    const out = [];
    for (const c of fx.pages()) {
        const bytes = Buffer.from(c.base64, 'base64');
        const result = c.kind === 'aws' ? parseAws(s, bytes, c.requested) : parseCity(s, bytes, c.content_type || '', c.requested);
        out.push(Object.assign({}, c, {result}));
    }
    // Merge of the first hourly AWS page with the first city page.
    return out;
}
async function merge(L) {
    const s = scraper(L);
    const fx = require('./station-fixtures');
    const out = [];
    for (const c of fx.merges()) {
        const aws = parseAws(s, Buffer.from(c.aws, 'base64'), c.requested);
        const city = parseCity(s, Buffer.from(c.city, 'base64'), c.city_type || '', c.requested);
        // Re-parse to get live objects (Dates) for the merge itself.
        const lite = Module._load('iconv-lite', module);
        let awsList;
        s._parseStnMinInfo(c.requested, cheerio().load(Buffer.from(lite.decode(Buffer.from(c.aws, 'base64'), 'euc-kr'), 'utf8').toString()), (e, r) => { awsList = r.stnList; });
        const cityList = s._parseCityWeatherHtml(s._decodeKmaHtml(Buffer.from(c.city, 'base64'), {headers: {'content-type': c.city_type || ''}}), c.requested).cityList;
        out.push({id: c.id, aws_id: c.aws_id, city_id: c.city_id, aws: aws.pubDate, city: city.pubDate, merged: ej(s._mergeAWSandCity(awsList, cityList))});
    }
    return out;
}
module.exports = {pages, merge, parseAws, parseCity, scraper, ej};
```

### `sections-stn.js` (sha256 `2cd2be565249fe27895907c6f9764d6fa0484c3629383e12d437775b687bfb1e`)

```js
/* S15b-2 station-store oracle (task evidence): legacy KmaScraper savers and
 * controllerKmaStnWeather readers over the in-memory Mongo double with 2d $near. */
'use strict';
const Module = require('module');
const S = require('./sections-stations');
const fx = require('./station-fixtures');

function installFakeDate(nowMs) {
    const Real = Date;
    // Real Date instances (prototype shared, so `instanceof Date` keeps holding for stored values).
    function FakeDate(...a) {
        if (!new.target) return new Real(nowMs).toString();
        return a.length === 0 ? new Real(nowMs) : new Real(...a);
    }
    FakeDate.prototype = Real.prototype;
    FakeDate.UTC = Real.UTC;
    FakeDate.parse = Real.parse;
    FakeDate.now = () => nowMs;
    global.Date = FakeDate;
    return () => { global.Date = Real; };
}
/** EJSON with `undefined` kept as {$undefined: true} (the port's Doc encoding). */
function ej(v) {
    if (v === undefined) return {$undefined: true};
    if (v instanceof Date) return {$date: v.getTime()};
    if (Array.isArray(v)) return v.map(ej);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = ej(v[k]); return o; }
    if (typeof v === 'number' && !isFinite(v)) return {$number: String(v)};
    return v;
}
const wait = fn => new Promise(resolve => fn((err, v) => resolve({err, v})));
const pause = ms => new Promise(r => setTimeout(r, ms));
const page = (pub, rows, opts) => fx.euc(fx.awsPage(pub, rows, opts));
const R = (id, name, extra) => Object.assign([id, name, '12m', '<font color=red>○</font>', '0', '0.5', '0', '0', '0', '0', '18.4', '270.1', 'W', '1.2', '265.0', 'WSW', '1.4', '61', '1013.2', '서울특별시 종로구 송월동'], extra || {});
function cityPage(pub, rows) {
    return fx.utf('<html><head><meta charset="utf-8"></head><body><div class="cmp-table-topinfo"><strong>기상실황표</strong>' + pub +
        '</div><table id="weather_table"><thead><tr id="table_header2"><th>이름</th><th>현재일기</th><th>운량<br/>1/10</th><th>현재<br/>기온</th><th>습도<br/>%</th><th>풍향</th><th>풍속</th></tr></thead><tbody>' +
        rows.map(r => '<tr><td><a href="city-obs.do?stn=' + r[0] + '">' + r[1] + '</a></td>' + r.slice(2).map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') +
        '</tbody></table></body></html>');
}
const GEO = {
    '서울특별시종로구송월동': ['126.9658', '37.5714'],
    '서울특별시강남구일원동': ['127.0870', '37.4932'],
    '서울특별시중구명동': ['126.9850', '37.5636'],
    '인천광역시중구전동': ['126.6249', '37.4776'],
    '경기도수원시권선구': ['126.9853', '37.2723'],
    '강원도평창군대관령면 ': ['128.7189', '37.6771']
};
const SEOUL = {name: 'Seoul', town: {first: '서울특별시', second: '종로구', third: '청운효자동'}, mCoord: {mx: 60, my: 127}, gCoord: {lat: 37.5665, lon: 126.978}};
const INCHEON = {name: 'Incheon', town: {first: '인천광역시', second: '중구', third: '신포동'}, mCoord: {mx: 54, my: 125}, gCoord: {lat: 37.47, lon: 126.62}};
const FAR = {name: 'Far', town: {first: '제주특별자치도', second: '제주시', third: '일도1동'}, mCoord: {mx: 53, my: 38}, gCoord: {lat: 33.5, lon: 126.53}};

function scenarios() {
    const hour = (h, rows, city) => ({kind: 'hourly', requested: '2026.10.14.' + h + ':00', aws: page('2026.10.14.' + h + ':00', rows), city: city && cityPage('2026.10.14.' + h + ':00', city), city_type: 'text/html;charset=UTF-8'});
    const minute = (m, rows) => ({kind: 'minute', aws: page('2026.10.14.' + m, rows)});
    const base = [R('108', '서울'), R('400', '강남', {19: '서울특별시 강남구 일원동'}), R('410', '중구', {19: '서울특별시 중구 명동'}), R('112', '인천', {19: '인천광역시 중구 전동'}), R('119', '수원', {19: '경기도 수원시 권선구'}), R('999', '주소없음', {19: '-'})];
    const city = [['108', '서울', '맑음', '3', '18.0', '60', '남서', '2.0'], ['112', '인천', '약한비계속', '9', '15.0', '90', '북', '5.0'], ['102', '백령도', '흐림', '10', '14.0', '80', '서', '7.0']];
    const rain = (id, rns, rs15) => ({3: rns ? '<font color=blue>●</font>' : '<font color=red>○</font>', 4: rs15});
    return [
        {id: 'city-and-minute', now: Date.UTC(2026, 9, 14, 13, 5), date_time: '202610142205', towns: [SEOUL, INCHEON, FAR], runs: [
            hour('20', base, city), hour('21', base, city), hour('22', base.map(r => r[0] === '108' ? R('108', '서울', {10: '19.9'}) : r), city),
            hour('22', base, null),
            minute('21:44', base), minute('21:50', base.map(r => r[0] === '108' ? R('108', '서울', rain('108', true, '0.5')) : r)),
            minute('22:04', base.map(r => r[0] === '400' ? R('400', '강남', Object.assign({19: '서울특별시 강남구 일원동'}, rain('400', false, '1.0'))) : r)),
            minute('22:05', base.map(r => r[0] === '410' ? R('410', '중구', Object.assign({19: '서울특별시 중구 명동'}, rain('410', true, '0'))) : r))
        ]},
        {id: 'hourly-missing', now: Date.UTC(2026, 9, 14, 13, 5), date_time: '202610142205', towns: [SEOUL], runs: [
            hour('18', base, city), minute('22:01', base)
        ]},
        {id: 'no-minute', now: Date.UTC(2026, 9, 14, 13, 5), date_time: '202610142205', towns: [SEOUL], runs: [
            hour('21', base, city), minute('21:30', base)
        ]},
        {id: 'local-rain', now: Date.UTC(2026, 9, 14, 13, 5), date_time: '202610142205', towns: [SEOUL], runs: [
            hour('21', base.concat([R('420', '대관령', {19: '강원도 평창군 대관령면 (산간)'})]), city),
            hour('22', base.map(r => r[0] === '108' ? R('108', '서울', {4: '0.5'}) : r), city),
            minute('21:55', base),
            minute('22:02', base.map(r => r[0] === '410' ? R('410', '중구', Object.assign({19: '서울특별시 중구 명동'}, rain('410', true, '0'))) :
                r[0] === '400' ? R('400', '강남', Object.assign({19: '서울특별시 강남구 일원동'}, rain('400', false, '0.5'))) : r)),
            minute('22:04', base.map(r => r[0] === '108' ? R('108', '서울', rain('108', false, '1.0')) : r))
        ]},
        {id: 'city-change', now: Date.UTC(2026, 9, 14, 13, 30), date_time: '202610142230', towns: [SEOUL, INCHEON], runs: [
            hour('21', base, city.filter(c => c[0] !== '112')), hour('22', base, city), minute('22:28', base)
        ]}
    ];
}

async function stn(L) {
    const s = S.scraper(L);
    const models = {
        KmaStnInfo: L.load('models/modelKmaStnInfo.js'),
        KmaStnHourly2: L.load('models/modelKmaStnHourly2.js'),
        KmaStnMinute2: L.load('models/modelKmaStnMinute2.js')
    };
    const ctrl = L.load('controllers/controllerKmaStnWeather.js');
    global.manager = global.manager || {leadingZeros: (n, d) => String(n).padStart(d, '0')};
    const lite = Module._load('iconv-lite', module);
    const cheerio = Module._load('cheerio', module);
    const out = [];
    for (const sc of scenarios()) {
        const colls = {};
        for (const [k, m] of Object.entries(models)) colls[k] = L.fake.attach(m);
        s._recursiveConvertGeoCode = (addr, n, cb) => GEO[addr] ? cb(undefined, {lat: GEO[addr][1], lon: GEO[addr][0]}) : cb(new Error('no geo'));
        s._convertGeoCodeByApiServer = (addr, cb) => cb(new Error('no api'));
        for (const run of sc.runs) {
            let awsList;
            const text = Buffer.from(lite.decode(Buffer.from(run.aws, 'base64'), 'euc-kr'), 'utf8').toString();
            s._parseStnMinInfo(run.requested, cheerio.load(text), (e, r) => { awsList = r; });
            if (run.kind === 'minute') {
                await wait(cb => s._saveKmaStnMinute2List(awsList, cb));
            } else {
                let list;
                if (run.city) {
                    const cityList = s._parseCityWeatherHtml(s._decodeKmaHtml(Buffer.from(run.city, 'base64'), {headers: {'content-type': run.city_type}}), run.requested).cityList;
                    list = {pubDate: awsList.pubDate, stnList: s._mergeAWSandCity(awsList.stnList, cityList)};
                } else {
                    list = {pubDate: awsList.pubDate, stnList: awsList.stnList, cityUnavailable: true};
                }
                // Station registration runs per row in parallel in legacy; serialize it here so the
                // registry insertion order follows the page order (the port's documented order).
                for (const info of list.stnList) {
                    const input = list.cityUnavailable ? Object.assign({}, info, {keepCityWeather: true}) : info;
                    await wait(cb => s._saveStnInfo(input, cb));
                    await pause(1);
                }
                await wait(cb => s._saveStnHourly2Rows ? s._saveStnHourly2Rows(list, cb) : (function (done) {
                    let n = list.stnList.length; if (!n) return done();
                    list.stnList.forEach(info => s._saveStnHourly2(info, list.pubDate, () => { if (--n === 0) done(); }));
                })(cb));
            }
            await pause(5);
        }
        const restore = installFakeDate(sc.now);
        const answers = [];
        try {
            for (const town of sc.towns) {
                const a = await wait(cb => ctrl.getStnHourlyAndMinRns(JSON.parse(JSON.stringify(town)), sc.date_time, {}, cb));
                const c = await wait(cb => ctrl.getCityHourlyList(JSON.parse(JSON.stringify(town)), cb));
                answers.push({town: town.name, stn: a.err ? {error: a.err.message} : ej(a.v), city: c.err ? {error: c.err.message} : ej(c.v)});
            }
        } finally { restore(); }
        const strip = d => { const o = Object.assign({}, d); delete o._id; return ej(o); };
        out.push({id: sc.id, now: sc.now, date_time: sc.date_time, towns: sc.towns, geo: GEO,
            runs: sc.runs, registry: colls.KmaStnInfo.docs.map(strip), hourly: colls.KmaStnHourly2.docs.map(strip),
            minute: colls.KmaStnMinute2.docs.map(strip), answers});
    }
    return out;
}
module.exports = {stn};
```

### `sections-asos.js` (sha256 `3a036c3835dd61c312732b1a07d567f205ca80346ea548451efd33d4dc38250e`)

```js
/* S15b-2 ASOS history oracle (task evidence): legacy lib/history Recovery + Provider + Store over
 * an in-memory native collection and a scripted HTTPS transport (no network). Records, per run,
 * the provider requests with their page bodies and the stored asos_history documents. */
'use strict';
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const LIVE = path.join(__dirname, '..', 'live');
function liveItems(name) {
    return JSON.parse(fs.readFileSync(path.join(LIVE, name))).response.body.items.item;
}
// Native collection double: find(range on _id).sort({key:1}).maxTimeMS().toArray(), updateOne
// with upsert/$setOnInsert/$set and `$exists`, deleteOne. MongoDB < 5.0 field order.
function collection() {
    const docs = [];
    const get = (d, p) => p.split('.').reduce((c, k) => (c === undefined || c === null ? undefined : c[k]), d);
    function match(d, q) {
        return Object.keys(q).every(k => {
            const c = q[k], v = get(d, k);
            if (c && typeof c === 'object' && !(c instanceof Date)) {
                return Object.keys(c).every(op => {
                    if (op === '$gte') return v !== undefined && v >= c[op];
                    if (op === '$lte') return v !== undefined && (v instanceof Date ? +v <= +c[op] : v <= c[op]);
                    if (op === '$exists') return (v !== undefined) === c[op];
                    throw new Error('op ' + op);
                });
            }
            return v === c;
        });
    }
    function setPath(d, p, v) {
        const parts = p.split('.');
        let c = d;
        for (let i = 0; i < parts.length - 1; i++) { if (typeof c[parts[i]] !== 'object' || c[parts[i]] === null) c[parts[i]] = {}; c = c[parts[i]]; }
        c[parts[parts.length - 1]] = v instanceof Date ? new Date(+v) : (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);
    }
    return {
        docs,
        find(q) {
            let list = docs.filter(d => match(d, q));
            const cursor = {
                sort(s) { const k = Object.keys(s)[0]; list = list.slice().sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0)); return cursor; },
                maxTimeMS() { return cursor; },
                toArray() { return Promise.resolve(list.map(d => JSON.parse(JSON.stringify(d), (k, v) => (k === 'date' || k === 'fetchedAt' || k === 'expiresAt') && typeof v === 'string' ? new Date(v) : v))); }
            };
            return cursor;
        },
        async updateOne(q, u, o) {
            const hit = docs.find(d => match(d, q));
            if (hit) { if (u.$set) for (const k of Object.keys(u.$set)) setPath(hit, k, u.$set[k]); return {matchedCount: 1}; }
            if (o && o.upsert) {
                const d = {};
                for (const k of Object.keys(q)) { const c = q[k]; if (!(c && typeof c === 'object' && !(c instanceof Date))) setPath(d, k, c); }
                for (const op of ['$setOnInsert', '$set']) if (u[op]) for (const k of Object.keys(u[op])) setPath(d, k, u[op][k]);
                if (docs.some(x => x._id === d._id)) { const e = new Error('dup'); e.code = 11000; throw e; }
                docs.push(d);
                return {upsertedCount: 1};
            }
            return {matchedCount: 0};
        },
        async deleteOne(q) { const i = docs.findIndex(d => match(d, q)); if (i >= 0) docs.splice(i, 1); return {}; }
    };
}
// Scripted data.go.kr transport: `script(kind, params)` returns {status, items} or {status, body}.
function transport(script, log) {
    return {
        get(url, cb) {
            const u = new URL(url);
            const params = Object.fromEntries(u.searchParams.entries());
            const kind = u.pathname.includes('Hourly') ? 'hourly' : 'daily';
            const answer = script(kind, params);
            const page = +params.pageNo, size = +params.numOfRows;
            let body;
            if (answer.body !== undefined) body = answer.body;
            else if (answer.code) body = JSON.stringify({response: {header: {resultCode: answer.code, resultMsg: answer.msg || 'NO_DATA'}}});
            else {
                const slice = answer.items.slice((page - 1) * size, page * size);
                body = JSON.stringify({response: {header: {resultCode: '00', resultMsg: 'NORMAL_SERVICE'},
                    body: {dataType: 'JSON', items: {item: slice}, pageNo: page, numOfRows: size, totalCount: answer.items.length}}});
            }
            const q = Object.assign({}, params); delete q.serviceKey;
            log.push({kind, query: q, status: answer.status || 200, body});
            const req = new EventEmitter();
            req.destroy = () => {};
            setImmediate(() => {
                const res = new EventEmitter();
                res.statusCode = answer.status || 200;
                res.destroy = () => {};
                cb(res);
                res.emit('data', Buffer.from(body));
                res.emit('end');
            });
            return req;
        }
    };
}
const clone = v => JSON.parse(JSON.stringify(v));
function hourlyItem(tm, values) {
    return Object.assign({tm, rnum: '1', stnId: '108', stnNm: '서울', ta: '', taQcflg: '', rn: '', rnQcflg: '', ws: '', wsQcflg: '', wd: '', wdQcflg: '', hm: '', hmQcflg: '', dc10Tca: ''}, values);
}
function scenarios() {
    const hourly108 = liveItems('asos-hourly-108-range.body');
    const daily108 = liveItems('asos-daily-108-range.body');
    const first = clone(hourly108);
    first.find(i => i.tm === '2026-10-09 05:00').hm = '';
    first.find(i => i.tm === '2026-10-10 12:00').taQcflg = '1';
    first.find(i => i.tm === '2026-10-11 03:00').stnId = '109';
    first.push(Object.assign(clone(first.find(i => i.tm === '2026-10-12 00:00')), {ta: '30.0'}));
    first.find(i => i.tm === '2026-10-12 01:00').rn = '1.5';
    first.find(i => i.tm === '2026-10-12 02:00').rn = '0.0';
    first.find(i => i.tm === '2026-10-12 03:00').dc10Tca = '11';
    first.find(i => i.tm === '2026-10-12 04:00').ws = '-1';
    const dailyFirst = clone(daily108);
    dailyFirst.find(i => i.tm === '2026-10-08').minTa = '30.1';
    const fourteenth = [];
    for (let h = 0; h < 24; h++) fourteenth.push(hourlyItem('2026-10-14 ' + String(h).padStart(2, '0') + ':00', {ta: String(15 + h / 10), hm: String(60 + h), ws: h % 4 ? '1.5' : '', wd: '180', rn: h === 7 ? '2' : '', dc10Tca: String(h % 11)}));
    const winter = [];
    for (let d = 1; d <= 7; d++) for (let h = 0; h < 24; h++) {
        const tm = '2026-12-0' + d + ' ' + String(h).padStart(2, '0') + (h === 5 ? '' : ':00');
        winter.push(hourlyItem(tm, {ta: String(-3 + h / 4), hm: String(40 + d), rn: '0.5', ws: '2', wsQcflg: h === 9 ? '9' : '', wd: '360', taQcflag: h === 10 ? '1' : '0', dc10Tca: h === 11 ? '' : String(d)}));
    }
    const winterDaily = [];
    for (let d = 1; d <= 7; d++) winterDaily.push({stnId: '108', stnNm: '서울', tm: '2026-12-0' + d, minTa: String(-5 - d), maxTa: d === 3 ? '' : String(3 + d), avgTa: '-1.0', avgRhm: '45', sumRn: d === 2 ? '3.5' : '', avgWs: '2.2'});
    return [
        {id: 'october-108', station: '108', runs: [
            {now: Date.parse('2026-10-14T01:00:00Z'), script: (kind) => kind === 'hourly' ? {items: first} : {items: dailyFirst}},
            {now: Date.parse('2026-10-14T02:00:00Z'), script: (kind, p) => {
                if (kind === 'daily') return {items: [Object.assign(clone(daily108[1]), {minTa: '11.1'})]};
                if (p.startDt === '20261011') return {code: '03'};
                const tm = p.startDt.slice(0, 4) + '-' + p.startDt.slice(4, 6) + '-' + p.startDt.slice(6) + ' ' + p.startHh + ':00';
                return {items: [hourlyItem(tm, {ta: '16.5', hm: '71', ws: '1.1', wd: '90', dc10Tca: '3'})]};
            }},
            {now: Date.parse('2026-10-15T01:00:00Z'), script: (kind, p) => {
                if (kind === 'daily') return {items: [{stnId: '108', stnNm: '서울', tm: '2026-10-14', minTa: '12.0', maxTa: '21.5', avgTa: '16.4', avgRhm: '61.0', sumRn: '2.0', avgWs: '1.9'}]};
                if (p.startDt === '20261011') return {items: [hourlyItem('2026-10-11 03:00', {ta: '14.0', hm: '80'})]};
                return {items: fourteenth};
            }}
        ]},
        {id: 'winter-108', station: '108', runs: [
            {now: Date.parse('2026-12-08T03:00:00Z'), script: (kind) => kind === 'hourly' ? {items: winter} : {items: winterDaily}}
        ]},
        {id: 'provider-rejections', station: '108', runs: [
            {now: Date.parse('2026-10-14T01:00:00Z'), script: (kind) => kind === 'hourly' ? {code: '22', msg: 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR'} : {body: '<OpenAPI_ServiceResponse>'}}
        ]}
    ];
}

async function asos(L) {
    const policy = L.load('lib/history/policy.js');
    const Store = L.load('lib/history/store.js');
    const Provider = L.load('lib/history/provider.js');
    const Recovery = L.load('lib/history/recovery.js');
    const RealNow = Date.now;
    const out = [];
    for (const sc of scenarios()) {
        const records = collection(), leases = collection();
        const store = new Store(records, leases);
        const runs = [];
        for (const run of sc.runs) {
            const log = [];
            const provider = new Provider({key: 'oracle-key', transport: transport(run.script, log), sleep: () => Promise.resolve()});
            Date.now = () => run.now;
            let report;
            try {
                const w = policy.window(run.now);
                report = await new Recovery(store, provider).run(sc.station, w.start, w.end, run.now);
                const hourly = await store.read('hourly', sc.station, w.start + '0000', w.end + '2300');
                const daily = await store.read('daily', sc.station, w.start, w.end);
                const enc = v => JSON.parse(JSON.stringify(v, function (k, x) { return this[k] instanceof Date ? {$date: +this[k]} : x; }));
                runs.push({now: run.now, window: w, requests: log, report: enc(report), store: enc(records.docs.slice().sort((a, b) => (a._id < b._id ? -1 : 1))),
                    read: {hourly: enc(hourly), daily: enc(daily)}});
            } finally { Date.now = RealNow; }
        }
        out.push({id: sc.id, station: sc.station, runs});
    }
    return out;
}
module.exports = {asos};
```

### `station-fixtures.js` (sha256 `ecfc6c5a6272fbd5a02d5d807b45d1f5ef7c799924d19c62e946a3b87ea61a35`)

```js
/* S15b-2 station page inputs: committed server2 fixtures, synthetic edge pages and (with
 * S15B_LIVE=1) the local live captures, which are never committed. */
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const FIX = path.join(process.env.TW_REPO, 'server2/tests/providers/fixtures');
const LIVE = path.join(__dirname, '../live');
const lite = () => Module._load('iconv-lite', module);
const euc = s => lite().encode(s, 'euc-kr').toString('base64');
const utf = s => Buffer.from(s, 'utf8').toString('base64');
const file = f => fs.readFileSync(f).toString('base64');

function awsPage(pub, rows, opts) {
    opts = opts || {};
    const header = '<tr bgcolor=#AAE3FF align=center class=name><td colspan=3 nowrap>AWS 지점 / 고도</td><td>강수</td><td>강수15</td><td>강수60</td><td>강수3H</td><td>강수6H</td><td>강수12H</td><td>일강수</td><td width=40>기온</td><td colspan=2 width=60>풍향1</td><td>풍속1(m/s)</td><td colspan=2 width=60>풍향10</td><td>풍속10(m/s)</td><td>습도</td><td>해면기압</td><td>위치</td></tr>\n';
    const body = rows.map(r => '<tr align=center class=text>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>\n').join('');
    return '<HTML><HEAD><META http-equiv="Content-Type" content="text/html; charset=euc-kr"></HEAD><BODY>\n' +
        (opts.noHead ? '' : '<span class=ehead>[ 매분관측자료 ] ' + pub + '</span>\n') +
        '<table border=0 cellspacing=0 cellpadding=0>\n<tr><td bgcolor=#999999>\n<table border=0 cellspacing=1 cellpadding=1>\n' +
        header + body + '</table>\n</td></tr></table>\n' + (opts.tail || '') + '</BODY></HTML>\n';
}
const R = (id, name, extra) => Object.assign([id, name, '12m', '<font color=red>○</font>', '0', '0', '0', '0', '0', '0', '18.4', '270.1', 'W', '1.2', '265.0', 'WSW', '1.4', '61', '1013.2', '서울특별시 종로구 송월동'], extra || {});

function pages() {
    const out = [
        {id: 'aws-committed-synthetic', kind: 'aws', base64: file(path.join(FIX, 'aws-minute-euckr.html'))},
        {id: 'city-committed-real-2026-09-25', kind: 'city', content_type: 'text/html;charset=UTF-8', base64: file(path.join(FIX, 'city-obs-2026-09-25.html')), requested: '2026.09.25.19:00'},
        {id: 'city-committed-real-no-ct', kind: 'city', content_type: '', base64: file(path.join(FIX, 'city-obs-2026-09-25.html'))},
        {id: 'city-committed-real-stale', kind: 'city', content_type: 'text/html;charset=UTF-8', base64: file(path.join(FIX, 'city-obs-2026-09-25.html')), requested: '2026.09.25.20:00'},
        {id: 'city-committed-euckr', kind: 'city', content_type: 'text/html', base64: file(path.join(FIX, 'city-obs-euckr.html'))},
        {id: 'aws-edge', kind: 'aws', requested: '2026.10.14.22:00', base64: euc(awsPage('2026.10.14.22:00', [
            R('108', '서울'),
            R('112', '인천', {3: '<font color=blue>●</font>', 4: '1.5', 5: '2.0', 10: '.', 18: '-'}),
            R('113', '0값', {10: '0', 11: '0', 14: '0', 16: '0'}),
            R('114', ' 공백 \n 이름 ', {2: ' 5 m', 17: '&nbsp;77'}),
            R('115', '항목많음').concat(['extra']),
            R('116', '숫자앞', {10: '12.3도', 11: '-.5', 13: 'abc', 18: '1e3'}),
            R('117', '빈칸', {3: '', 4: ' ', 19: ''}),
            R('118', '엔티티&amp;확인', {19: '서울 &lt;중구&gt;'})
        ]))},
        {id: 'aws-minute-latest', kind: 'aws', base64: euc(awsPage('2026.10.14.23:54', [R('108', '서울'), R('400', '강남', {3: '●'})]))},
        {id: 'aws-no-head', kind: 'aws', base64: euc(awsPage('', [R('108', '서울')], {noHead: true}))},
        {id: 'aws-short-pub', kind: 'aws', base64: euc(awsPage('2026.10.14', [R('108', '서울')]))},
        {id: 'aws-stale', kind: 'aws', requested: '2026.10.14.23:00', base64: euc(awsPage('2026.10.14.22:00', [R('108', '서울')]))},
        {id: 'aws-legend-table', kind: 'aws', base64: euc(awsPage('2026.10.14.22:00', [R('108', '서울')],
            {tail: '<table><tr><td>관서용</td><td>방재용</td></tr></table>\n'}))},
        {id: 'city-legacy-layout', kind: 'city', content_type: 'text/html', base64: euc(
            '<html><head><meta http-equiv="Content-Type" content="text/html; charset=euc-kr"></head><body>\n' +
            '<div class="table_topinfo">기상실황표 2026.10.14.22:00</div>\n<table class="table_develop3"><thead>' +
            '<tr id="table_header2"><th>지점</th><th>현재일기</th><th>시정<br>km</th><th>운량<br>1/10</th><th>현재<br>기온</th><th>습도<br>%</th>' +
            '<th>풍향</th><th>풍속<br>m/s<script>x()</script></th><th>새항목</th><th>적설<br>cm</th></tr></thead><tbody>\n' +
            '<tr><td><a href="?stn=108&amp;x=1">서울</a></td><td>맑음</td><td>20 이상</td><td>&nbsp;</td><td>18.4</td><td>61</td><td>남남서</td><td><script>writeWindSpeed(\'1.1\', false)</script></td><td>?</td><td>0.5</td></tr>\n' +
            '<tr><td><a href="x.do?tm=1&stn=102">백령도</a></td><td></td><td>9</td><td>3</td><td>-1.2</td><td></td><td>북</td><td>2.5</td><td>-</td><td></td></tr>\n' +
            '<tr><td>지점없음</td><td>흐림</td><td>1</td><td>1</td><td>1</td><td>1</td><td>동</td><td>1</td><td>1</td><td>1</td></tr>\n' +
            '</tbody></table></body></html>\n')},
        {id: 'city-input-tm', kind: 'city', content_type: 'text/html; charset=utf-8', base64: utf(
            '<html><body><form><input type="hidden" name="tm" value=" 2026.10.14.21:00 "></form>\n' +
            '<table id="weather_table"><thead><tr id="table_header2"><th>이름</th><th>현재기온</th><th>풍속</th><th>해면<br/>기압</th></tr></thead>' +
            '<tbody><tr><td><a href="city-obs.do?stn=133">대전</a></td><td>15.0</td><td></td><td>1015.1</td></tr></tbody></table></body></html>\n')},
        {id: 'city-no-header', kind: 'city', content_type: 'text/html; charset=utf-8', base64: utf(
            '<html><body><div class="cmp-table-topinfo"><strong>기상실황표</strong>2026.10.14.21:00</div><table id="weather_table"><tbody><tr><td>x</td></tr></tbody></table></body></html>')},
        {id: 'city-bad-pub', kind: 'city', content_type: 'text/html; charset=utf-8', base64: utf(
            '<html><body><div class="cmp-table-topinfo">기상실황표 2026-10-14 21:00</div></body></html>')}
    ];
    if (process.env.S15B_LIVE) {
        out.push({id: 'live-aws-minute', local: true, kind: 'aws', base64: file(path.join(LIVE, 'aws-minute.body'))});
        out.push({id: 'live-aws-hourly', local: true, kind: 'aws', base64: file(path.join(LIVE, 'aws-hourly.body'))});
        out.push({id: 'live-city', local: true, kind: 'city', content_type: 'text/html;charset=UTF-8', base64: file(path.join(LIVE, 'city-obs.body'))});
    }
    return out;
}
function merges() {
    const page = pages();
    const by = id => page.find(p => p.id === id);
    const out = [{id: 'merge-edge', aws_id: 'aws-edge', city_id: 'city-legacy-layout', aws: by('aws-edge').base64, city: by('city-legacy-layout').base64, city_type: 'text/html', requested: '2026.10.14.22:00'}];
    if (process.env.S15B_LIVE) {
        out.push({id: 'merge-live', aws_id: 'live-aws-hourly', city_id: 'live-city', local: true, aws: by('live-aws-hourly').base64, city: by('live-city').base64, city_type: 'text/html;charset=UTF-8'});
    }
    return out;
}
module.exports = {pages, merges, awsPage, euc, utf};
```

### `fakemongo.js` (sha256 `7059459679eae9e65b40455aa6ddb21b7258d3c1c44606b53ffb6b09d56166a0`)

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
        let near = null;
        if (query && query.geo && query.geo.$near) {
            near = query.geo;
            query = Object.assign({}, query);
            delete query.geo;
        }
        let list = this.docs.filter(d => matches(d, query));
        if (near) {
            // 2d index $near: planar distance in coordinate units, nearest first, ties in natural order.
            const [x, y] = near.$near;
            const dist = d => Array.isArray(d.geo) ? Math.sqrt(Math.pow(d.geo[0] - x, 2) + Math.pow(d.geo[1] - y, 2)) : Infinity;
            list = list.filter(d => isFinite(dist(d)) && (near.$maxDistance === undefined || dist(d) <= near.$maxDistance));
            list = list.map((d, i) => [dist(d), i, d]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(e => e[2]);
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

### `legacy.js` (sha256 `63a131d3cefb4e9cc01cc508f196c56078d6795daca9f0fe2ea70fb05268ddad`)

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
    axios: Object.assign(noNetwork, {get: noNetwork, post: noNetwork, create: () => ({get: noNetwork})}),
    'aws-sdk': {S3: function () {}, config: {update() {}}, CloudFront: function () {}},
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
