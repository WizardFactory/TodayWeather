# S15b-3 air store oracle fixture

`air.json.gz` (sha256 `4067cdb5794e9ff6c6d0241104399b32718dce43c580e5ec75196e29de6bcca0`) holds pinned legacy-oracle results for the
S15b-3 AirKorea input tests (`server2/tests/domestic/air.rs`, `air_s3.rs`). It is test data only;
the server2 runtime never reads it or any legacy file.

## Recording

- Legacy source: repository master `05c06c67`; the sha256 of every legacy file loaded while
  recording is stored in `source.files` (20 files). The deployed service host's image
  pipeline files were compared by sha256 on 2026-10-14 (read-only) and are identical to master.
- Runtime and dependencies: the S15b-1 oracle (see `SOURCE-PROVENANCE.md`): Node.js `v16.20.2`,
  `TZ=UTC`, `NODE_ENV=production`, the S15 oracle `node_modules` and `mongoose` 5.1.2, with the
  same in-memory collection double. This recording adds a 2d `$near` (planar distance over
  `[lon, lat]`, `$maxDistance` inclusive, nearest first, natural order for equal distances) and the
  `$inc`/`$push` update operators that Mongoose `save()` emits. `$near` is an emulation of the
  MongoDB 2d index, not a recording of a MongoDB server. `get-pixels`, `aws-sdk` and `axios` are
  stubs that throw (loaded by `kecoRequester` but never called offline); a global `Date` stand-in
  fixes the clock of each collector run.
- Inputs: synthetic, deterministic generators (`air-fixtures.js`) shaped like the live answers of
  2026-10-14: `getMsrstnList`, `getCtprvnRltmMesureDnsty` with `sidoName=전국`, `numOfRows=1000`,
  `ver=1.3` (one row without `dataTime`, as 7 of 672 live rows had), and `getMinuDustFrcstDspth`
  `ver=1.1`. No live value is copied.
- Nationwide rows: legacy requested the 17 sido names and `parseRows` rejected a whole batch with a
  row without a valid `dataTime`; the driver passes only rows with a valid `dataTime` to
  `parseRows` (the server2 per-row rule) and records what legacy stores from them.
- Run: `run.sh record-air.js <out.json.gz>`. Recording twice gives identical bytes.

## What is recorded

- `stations`: two `getMsrstnList` acquisitions through `completeGeoMsrStnInfo` (geocoding stubbed to
  fail), `parseMsrstnList` and `saveMsrstnList`; `MsrStn.find({}, {_id: 0})` (15 documents).
- `observations`: 29 nationwide acquisitions through `parseRows` and
  `saveRLTMCtprvn`, with the raw `ArpltnKeco` documents (315).
- `arpltn`: 48 `KecoController.getArpLtnInfo(town, now)` answers for six towns at eight instants,
  interleaved with the acquisitions (an instant sees the acquisitions completed by it).
- `sorts`: the V8 order of the `getArpLtnInfo` station comparator for every list of 0-3 stations of
  five kinds (156 lists).
- `dust`: 13 `getMinuDustFrcstDspth` runs (`_checkDataTime`, `_parseFrcst`,
  `_saveFrcst`, `removeMinuDustFrcst`), the stored `MinuDustFrcst` documents and
  84 `getDustFrcst` answers over `manager.codeTable` from `region.csv`.

## Driver source

### `record-air.js` (sha256 `5b7461dbcc7303e6ae1e034aab157518b6849c746c47054606ae0e1547254f93`)

```js
/* S15b-3 air store oracle driver (task evidence, not a repository tool). Runs legacy AirKorea
 * collectors and readers with Mongoose 5.1.2 and the in-memory collection double. No network.
 * Run: run.sh record-air.js <out.json.gz>
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
    Object.assign(out, await require('./sections-air').air(L, {mongoose, ej}));
    out.source = {files: Object.fromEntries(Object.entries(L.sourceFiles).sort())};
    const json = JSON.stringify(out);
    fs.writeFileSync(process.argv[2], zlib.gzipSync(Buffer.from(json), {level: 9, mtime: 0}));
    console.log('recorded air', json.length);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

```

### `sections-air.js` (sha256 `c8834cd939e703391ac7c93ab8e967c21eb4a018f20ad7b9f69efce8a7ef5d81`)

```js
/* S15b-3 oracle sections (task evidence): legacy AirKorea station list, real-time observation and
 * dust-forecast collectors (kecoRequester, airkoreaObservation) and the tw_svc readers
 * (kecoController.getArpLtnInfo, getDustFrcst) over the in-memory collection double. */
'use strict';
const path = require('path');
const F = require('./air-fixtures');

const RealDate = Date;
let NOW = RealDate.UTC(2026, 9, 14);
class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(NOW); }
    static now() { return NOW; }
}
function withClock(ms, fn) {
    const saved = global.Date;
    NOW = ms; global.Date = FakeDate;
    try { return fn(); } finally { global.Date = saved; }
}
async function withClockAsync(ms, fn) {
    const saved = global.Date;
    NOW = ms; global.Date = FakeDate;
    try { return await fn(); } finally { global.Date = saved; }
}
function extract(code, head) {
    const start = code.indexOf(head);
    if (start < 0) throw new Error('legacy boundary changed: ' + head);
    const end = code.indexOf('\n};', start);
    return code.slice(start, end + 3);
}
function codeTable(L) {
    const fs = require('fs');
    const code = fs.readFileSync(path.join(L.server, 'controllers/controllerManager.js'), 'utf8');
    const vm = require('vm');
    const sandbox = {fs, log: global.log, Manager: function () {}};
    sandbox.Manager.prototype = {};
    vm.runInNewContext(extract(code, 'Manager.prototype.makeRegIdTable = function') + '\n' +
        extract(code, 'Manager.prototype.leadingZeros = function'), sandbox);
    const cwd = process.cwd();
    process.chdir(L.server);
    const m = new sandbox.Manager();
    m.makeRegIdTable();
    process.chdir(cwd);
    return m;
}
function cb2p(fn) { return new Promise((resolve) => fn((err, v) => resolve({err, v}))); }
function body(pageJson) { return JSON.parse(pageJson).response.body; }

async function air(L, {ej}) {
    // Legacy modules (no network: the S3 archive is unconfigured, geocoding fails).
    const MsrStn = L.load('models/modelMsrStnInfo.js');
    const Arpltn = L.load('models/arpltnKeco.js');
    const Frcst = L.load('models/modelMinuDustFrcst.js');
    const stn = L.fake.attach(MsrStn), arp = L.fake.attach(Arpltn), frc = L.fake.attach(Frcst);
    const Keco = L.load('lib/kecoRequester.js');
    const obsApi = L.load('lib/airkoreaObservation.js');
    const K = L.load('controllers/kecoController.js');
    global.manager = codeTable(L);
    const keco = new Keco();
    keco.getGeoInfo = (address, cb) => cb(new Error('oracle: no geocoding'));

    // 1. Station lists (getAllMsrStnInfo after getMsrstnList): completeGeoMsrStnInfo, parseMsrstnList, saveMsrstnList.
    const stationRuns = [];
    for (const a of F.stationLists()) {
        const list = a.pages.map(p => body(p).items).reduce((x, y) => x.concat(y), []);
        await withClockAsync(a.fetched, async () => {
            const completed = await cb2p(cb => keco.completeGeoMsrStnInfo(JSON.parse(JSON.stringify(list)), cb));
            const parsed = keco.parseMsrstnList(completed.v);
            const saved = await cb2p(cb => keco.saveMsrstnList(parsed, cb));
            stationRuns.push({fetched: a.fetched, parsed: parsed.length, error: saved.err ? saved.err.message : null});
        });
    }
    const stations = (await MsrStn.find({}, {_id: 0}).lean().exec());

    // 2. National observations, 3. queries interleaved in time.
    const base = RealDate.UTC(2026, 9, 14, 5, 0); // 14:00 KST
    const obs = F.nationals(base);
    const towns = [
        {name: 'seoul-center', gCoord: {lat: 37.5657, lon: 126.9769}},
        {name: 'gangnam', gCoord: {lat: 37.5172, lon: 127.0473}},
        {name: 'chuncheon', gCoord: {lat: 37.8813, lon: 127.7298}},
        {name: 'far-sea', gCoord: {lat: 35.0, lon: 124.0}},
        {name: 'yongsan', gCoord: {lat: 37.5384, lon: 127.0049}},
        {name: 'deokjeok', gCoord: {lat: 37.2267, lon: 126.1522}},
    ];
    const queryTimes = [base - 30 * 3600000, base - 20 * 3600000, base - 3600000 + 30 * 60000, base - 3600000 + 55 * 60000,
        base + 10 * 60000, base + 25 * 60000, base + 9 * 3600000, base + 30 * 3600000];
    const answers = [];
    const runs = [];
    let next = 0;
    const answerAt = async (t) => {
        for (const town of towns) {
            const r = await cb2p(cb => K.getArpLtnInfo({town: {first: 'x'}, gCoord: town.gCoord}, new RealDate(t), cb));
            answers.push({town: town.name, gCoord: town.gCoord, now: t, error: r.err ? r.err.message : null, result: r.err ? null : ej(r.v)});
        }
    };
    for (const a of obs) {
        while (next < queryTimes.length && queryTimes[next] < a.fetched) await answerAt(queryTimes[next++]);
        const items = a.pages.map(p => body(p).items).reduce((x, y) => x.concat(y), []);
        // server2 skips rows without a valid data time (legacy would reject the province batch).
        const valid = items.filter(i => isFinite(obsApi.kstInstant(i.dataTime)));
        let rows, error = null;
        try { rows = obsApi.parseRows({list: valid}, obsApi.STATION, Arpltn.getKeyList()); }
        catch (e) { error = e.code || e.message; }
        if (rows) {
            const saved = await cb2p(cb => keco.saveRLTMCtprvn(rows, cb));
            if (saved.err) error = saved.err.code;
        }
        runs.push({fetched: a.fetched, rows: rows ? rows.length : 0, error});
    }
    while (next < queryTimes.length) await answerAt(queryTimes[next++]);

    // Comparator characterization: V8 sort of every 3-element pattern used by getArpLtnInfo.
    const kinds = [{khaiValue: 1, mangName: '도시대기'}, {khaiValue: 1, mangName: '도로변대기'}, {mangName: '도시대기'}, {mangName: '교외대기'}, {pm10Value: 3, mangName: '항만'}];
    const sorts = [];
    for (let n = 0; n <= 3; n++) {
        const combos = n === 0 ? [[]] : [];
        const rec = (prefix) => { if (prefix.length === n) { combos.push(prefix); return; } for (let k = 0; k < kinds.length; k++) rec(prefix.concat([k])); };
        if (n > 0) rec([]);
        for (const c of combos) {
            const list = c.map((k, i) => [Object.assign({id: i}, kinds[k])]);
            list.sort(function (a, b) {
                if (a[0].khaiValue == undefined && a[0].pm10Value == undefined) { return 1; }
                if (a[0].mangName === '도시대기') { return -1; }
                return 0;
            });
            sorts.push({kinds: c, order: list.map(x => x[0].id)});
        }
    }

    // 4. Dust forecasts: getMinuDustFrcstDspth runs (_checkDataTime, _parseFrcst, _saveFrcst, removeMinuDustFrcst).
    const frcRuns = [];
    for (const a of F.forecasts()) {
        await withClockAsync(a.fetched, async () => {
            const check = await cb2p(cb => keco._checkDataTime(cb));
            const expected = check.v.dataTime.dataDate + ' ' + check.v.dataTime.dataHours;
            if (check.v.isLatest) { frcRuns.push({fetched: a.fetched, expected, skipped: true}); return; }
            const items = a.pages.map(p => body(p).items).reduce((x, y) => x.concat(y), []);
            const parsed = keco._parseFrcst({list: JSON.parse(JSON.stringify(items))}, expected);
            const saved = await cb2p(cb => keco._saveFrcst(parsed, cb));
            await cb2p(cb => keco.removeMinuDustFrcst(cb));
            frcRuns.push({fetched: a.fetched, expected, parsed: parsed.length, error: saved.err ? saved.err.message : null});
        });
    }
    // Subdocument ObjectIds are random: the recording keeps region and grade (in stored order).
    const frcDocs = (await Frcst.find({}, {_id: 0}).lean().exec()).map(d => Object.assign({}, d, {
        informGrade: (d.informGrade || []).map(g => { const o = Object.assign({}, g); delete o._id; return o; })}));
    const dustQueries = [];
    const regions = [['서울특별시', '종로구'], ['강원도', '강릉시'], ['강원도', '춘천시'], ['강원도', '원주시'], ['경기도', '수원시장안구'],
        ['경기도', '의정부시'], ['경기도', '없는시'], ['제주특별자치도', '제주시'], ['전라남도', '목포시'], ['광주광역시', '동구'],
        ['강원특별자치도', '춘천시'], ['인천광역시', '중구'], ['세종특별자치시', ''], ['없는도', '어딘가']];
    for (const date of ['20261012', '20261013', '20261014', '20261015', '20261016', '20261017']) {
        for (const [region, city] of regions) {
            const r = await cb2p(cb => K.getDustFrcst({region, city}, date, cb));
            dustQueries.push({region, city, date, error: r.err ? r.err.message : null, result: r.err ? null : ej(r.v)});
        }
    }
    return {
        stations: {acquisitions: F.stationLists(), runs: stationRuns, docs: ej(stations)},
        observations: {acquisitions: obs, runs: runs, docs: ej(arp.docs.map(d => { const o = Object.assign({}, d); delete o._id; return o; }))},
        arpltn: answers,
        sorts,
        dust: {acquisitions: F.forecasts(), runs: frcRuns, docs: ej(frcDocs), queries: dustQueries},
        codeTable: global.manager.codeTable.length,
    };
}

module.exports = {air};

```

### `air-fixtures.js` (sha256 `e5126ed5f8999d548a6e4cb4d2780f837cd958e7ca541fdaa6f4aa39a908e9a3`)

```js
/* Synthetic AirKorea B552584 inputs for the S15b-3 store oracle (task evidence). Shapes follow
 * the live answers of 2026-10-14 (getCtprvnRltmMesureDnsty sidoName=전국 numOfRows=1000 ver=1.3,
 * getMsrstnList, getMinuDustFrcstDspth ver=1.1); every value is generated, none is copied. */
'use strict';

const KST = 9 * 3600000;
function pad(n) { return (n < 10 ? '0' : '') + n; }
/** KST wall time "YYYY-MM-DD HH:00" of a UTC instant; hour 0 of the next day can be written as 24:00. */
function kst(ms, as24) {
    const d = new Date(ms + KST);
    if (as24 && d.getUTCHours() === 0) {
        const p = new Date(ms + KST - 86400000);
        return `${p.getUTCFullYear()}-${pad(p.getUTCMonth() + 1)}-${pad(p.getUTCDate())} 24:00`;
    }
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:00`;
}
function page(items, size) {
    return JSON.stringify({response: {header: {resultCode: '00', resultMsg: 'NORMAL_CODE'},
        body: {totalCount: items.length, items, pageNo: 1, numOfRows: size}}});
}

// Stations near Seoul / Gyeonggi / Gangwon, plus one swapped (dmX > 100) and one without coordinates.
const STATIONS = [
    ['중구', 37.564263, 126.974676, '도시대기'],
    ['종로구', 37.572016, 127.005007, '도시대기'],
    ['용산구', 37.540033, 127.004850, '도시대기'],
    ['한강대로', 37.549389, 126.971519, '도로변대기'],
    ['청계천로', 37.568476, 126.998188, '도로변대기'],
    ['서대문구', 37.593742, 126.949679, '도시대기'],
    ['마포구', 37.555580, 126.905597, '도시대기'],
    ['동작구', 37.480917, 126.971481, '교외대기'],
    ['강남구', 37.517528, 127.047470, '도시대기'],
    ['수원', 37.272375, 126.985916, '도시대기'],
    ['춘천', 37.880740, 127.731362, '도시대기'],
    ['덕적도', 37.226700, 126.152200, '국가배경'],
];
function stationItem(s, i, variant) {
    const [name, lat, lon, mang] = s;
    const item = {stationName: name, addr: `서울 어딘가 ${i}`, dmX: String(lat), dmY: String(lon),
        item: 'SO2, CO, O3, NO2, PM10, PM2.5', mangName: mang, year: String(1990 + i),
        map: '', oper: '연구원', photo: ''};
    if (name === '동작구') { item.dmX = String(lon); item.dmY = String(lat); } // swapped by legacy
    if (variant === 2 && name === '마포구') { item.mangName = '도로변대기'; }
    return item;
}
function stationLists() {
    const first = STATIONS.slice(0, 10).map((s, i) => stationItem(s, i, 1));
    first.push({stationName: '이동측정', addr: '강원 평창군 대관령면 솔봉로 325이동차량', dmX: '', dmY: '',
        item: 'PM10', mangName: '도시대기', year: '2020'});
    const second = STATIONS.map((s, i) => stationItem(s, i, 2));
    // Live-shape variants: numeric coordinates, absent optional fields, null addr, a non-string item.
    second.push({stationName: '숫자좌표', dmX: 37.6, dmY: 126.95, item: null, mangName: '도시대기', addr: null});
    second.push({stationName: '빈항목', dmX: '37.61', dmY: '126.96', item: 'PM10', year: 2001});
    second.push({stationName: '영좌표', dmX: '0', dmY: '126.9', item: 'PM10', mangName: '도시대기'});
    return [{fetched: Date.UTC(2026, 9, 12, 0, 5), pages: [page(first, 100)]},
        {fetched: Date.UTC(2026, 9, 13, 0, 5), pages: [page(second, 100)]}];
}

/** Deterministic value generator. */
function value(seed, k, scale, dec) {
    const v = ((seed * 9301 + k * 49297) % 233280) / 233280 * scale;
    return dec ? v.toFixed(dec) : String(Math.round(v));
}
function observation(name, mang, ms, h, opts) {
    opts = opts || {};
    const seed = name.length * 31 + (h + 100) * 7 + (opts.rev || 0);
    const it = {stationName: name, sidoName: name === '춘천' ? '강원' : name === '수원' ? '경기' : '서울',
        mangName: mang, dataTime: kst(ms, opts.as24),
        so2Value: value(seed, 1, 0.01, 4), so2Flag: null, so2Grade: '1',
        coValue: value(seed, 2, 1.0, 2), coFlag: null, coGrade: '1',
        o3Value: value(seed, 3, 0.09, 4), o3Flag: null, o3Grade: String(1 + seed % 3),
        no2Value: value(seed, 4, 0.05, 4), no2Flag: null, no2Grade: '1',
        pm10Value: value(seed, 5, 120), pm10Flag: null, pm10Value24: value(seed, 6, 90),
        pm25Value: value(seed, 7, 60), pm25Flag: null, pm25Value24: value(seed, 8, 45),
        khaiValue: value(seed, 9, 150), khaiGrade: String(1 + seed % 4),
        pm10Grade: String(1 + (seed + 1) % 4), pm25Grade: String(1 + (seed + 2) % 4),
        pm10Grade1h: String(1 + (seed + 3) % 4), pm25Grade1h: String(1 + seed % 4)};
    if (opts.dash) { ['pm10Value', 'pm25Value', 'khaiValue', 'pm10Grade1h', 'pm25Grade1h', 'khaiGrade'].forEach(k => { it[k] = '-'; }); }
    if (opts.nokhai) { it.khaiValue = '-'; it.khaiGrade = null; it.pm10Value = '-'; it.pm10Grade1h = null; }
    if (opts.empty) { ['so2Value', 'coValue', 'o3Value', 'no2Value', 'pm10Value', 'pm10Value24', 'pm25Value', 'pm25Value24', 'khaiValue'].forEach(k => { it[k] = '-'; }); }
    if (opts.badGrade) { it.o3Grade = '5'; it.no2Grade = '0'; it.coGrade = '1.5'; }
    return it;
}

/**
 * National hourly datasets: hours relative to the base instant. Each acquisition holds every
 * station's row of one hour (some stations lag or miss hours). Rows without dataTime are part of
 * the live shape (7 of 672 on 2026-10-14 23:00 KST); server2 skips them per row.
 */
function nationals(base) {
    const out = [];
    for (let h = -27; h <= 0; h++) {
        const ms = base + h * 3600000;
        const items = [];
        STATIONS.forEach(([name, , , mang], i) => {
            if (name === '덕적도' && h > -12) return; // stopped reporting 12 h ago
            if (name === '용산구' && h % 5 === 0) return; // missing hours
            if (name === '청계천로' && h > -3) { items.push(observation(name, mang, ms - 3600000 * (h + 3), h, {})); return; } // lagging 3 h (same old row)
            const opts = {dash: name === '종로구' && h === 0, nokhai: name === '한강대로', badGrade: name === '마포구' && h === -1,
                empty: name === '강남구' && h === 0, as24: true};
            items.push(observation(name, mang, ms, h, opts));
        });
        items.push({stationName: '점검중', sidoName: '서울', mangName: '도시대기', dataTime: null, pm10Value: '-'});
        out.push({fetched: ms + 20 * 60000, pages: [page(items, 1000)]});
        if (h === -1) {
            // A later fetch of the same hour revises values (legacy upsert by station and date).
            const rev = STATIONS.map(([name, , , mang]) => observation(name, mang, ms, h, {rev: 5}))
                .filter(it => it.stationName !== '용산구' && it.stationName !== '덕적도');
            out.push({fetched: ms + 50 * 60000, pages: [page(rev, 1000)]});
        }
    }
    return out;
}

const REGIONS_A = ['서울', '제주', '전남', '전북', '광주', '경남', '경북', '울산', '대구', '부산', '충남', '충북', '세종', '대전', '영동', '영서', '경기남부', '경기북부', '인천'];
const GRADES = ['좋음', '보통', '나쁨', '매우나쁨', '예보없음'];
function forecastItems(announce, day0, k) {
    const items = [];
    ['PM10', 'PM25'].forEach((code, ci) => {
        for (let d = 0; d < 3; d++) {
            const date = new Date(Date.UTC(day0[0], day0[1] - 1, day0[2] + d));
            const informData = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
            let grade = REGIONS_A.map((r, ri) => `${r} : ${GRADES[(ri + d + ci + k) % (d === 2 ? 5 : 4)]}`).join(',');
            if ((k + d) % 3 === 0) grade += ',';          // trailing comma: an empty region entry
            if ((k + d) % 4 === 1) grade += ',새지역 : 보통'; // a region the stored document lacks
            if ((k + d) % 5 === 2) grade = grade.replace('대구 : ', '대구 :');  // malformed separator
            const it = {dataTime: announce, informCode: code, informData, informGrade: grade,
                informCause: `원인 ${k}`, informOverall: `개황 ${k}`, actionKnack: null};
            for (let n = 1; n <= 9; n++) it['imageUrl' + n] = `https://www.airkorea.or.kr/img/${k}/${code}/${n}.gif`;
            items.push(it);
        }
    });
    items.push({dataTime: announce, informCode: 'O3', informData: '2026-10-13', informGrade: REGIONS_A.map(r => r + ' : 좋음').join(','),
        informCause: 'o3', informOverall: 'o3', actionKnack: 'x'});
    return items;
}
/** Dust-forecast acquisitions (search date pages) in fetch order. */
function forecasts() {
    const acq = [];
    const days = [[2026, 10, 12], [2026, 10, 13], [2026, 10, 14]];
    let k = 0;
    days.forEach((day, di) => {
        [5, 11, 17, 23].forEach(hh => {
            const date = `${day[0]}-${pad(day[1])}-${pad(day[2])}`;
            const announce = `${date} ${pad(hh)}시 발표`;
            // Each search-date page holds that day's announcements so far, newest first.
            const items = [];
            [5, 11, 17, 23].filter(x => x <= hh).reverse().forEach((x, xi) => {
                forecastItems(`${date} ${pad(x)}시 발표`, day, k - xi).forEach(i => items.push(i));
            });
            const fetched = Date.UTC(day[0], day[1] - 1, day[2], hh - 9, 30 + di);
            acq.push({fetched, search: date, announce, pages: [page(items, 100)]});
            k++;
        });
    });
    // A fetch before the 05시 announcement exists (01:00 KST): legacy expects the previous day's 23시.
    acq.splice(4, 0, {fetched: Date.UTC(2026, 9, 12, 16, 0), search: '2026-10-12', announce: '2026-10-12 23시 발표 (again)', pages: [acq[3].pages[0]]});
    return acq;
}

module.exports = {stationLists, nationals, forecasts, kst, STATIONS};

```

### `legacy.js` (sha256 `f8f936899f49903354f193acdf1f1fa1af669903103bf994c99411c55c2a6c40`)

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
    axios: {get: noNetwork, post: noNetwork},
};
const rawLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (stubs[request]) return stubs[request];
    if (/config\/config(\.js)?$/.test(request)) {
        return {db: {version: '2.0', path: '', options: {}}, keyString: {}, mode: 'service', serviceServer: {}, gather: {},
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

### `fakemongo.js` (sha256 `0b8e9beffcd351460d9663d208c7899d156b99795e9694ee00ddf70e63ef2a3e`)

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
