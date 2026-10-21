/* S15b-3 oracle sections (task evidence): legacy AirKorea station list, real-time observation and
 * dust-forecast collectors (kecoRequester, airkoreaObservation) and the tw_svc readers
 * (kecoController.getArpLtnInfo, getDustFrcst) over the in-memory collection double. */
'use strict';
const path = require('path');
const F = require('./air-fixtures');

const RealDate = Date;
let NOW = RealDate.UTC(2026, 9, 15);
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
            stationRuns.push({fetched: a.fetched, parsed: parsed.length, error: saved.err ? String(saved.err.message).split(' for value')[0] : null});
        });
    }
    const stations = (await MsrStn.find({}, {_id: 0}).lean().exec());

    // 2. National observations, 3. queries interleaved in time.
    const base = RealDate.UTC(2026, 9, 15, 13, 0); // 14:00 KST
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

