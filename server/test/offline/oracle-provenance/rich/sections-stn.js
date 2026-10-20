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
    const hour = (h, rows, city) => ({kind: 'hourly', requested: '2026.10.15.' + h + ':00', aws: page('2026.10.15.' + h + ':00', rows), city: city && cityPage('2026.10.15.' + h + ':00', city), city_type: 'text/html;charset=UTF-8'});
    const minute = (m, rows) => ({kind: 'minute', aws: page('2026.10.15.' + m, rows)});
    const base = [R('108', '서울'), R('400', '강남', {19: '서울특별시 강남구 일원동'}), R('410', '중구', {19: '서울특별시 중구 명동'}), R('112', '인천', {19: '인천광역시 중구 전동'}), R('119', '수원', {19: '경기도 수원시 권선구'}), R('999', '주소없음', {19: '-'})];
    const city = [['108', '서울', '맑음', '3', '18.0', '60', '남서', '2.0'], ['112', '인천', '약한비계속', '9', '15.0', '90', '북', '5.0'], ['102', '백령도', '흐림', '10', '14.0', '80', '서', '7.0']];
    const rain = (id, rns, rs15) => ({3: rns ? '<font color=blue>●</font>' : '<font color=red>○</font>', 4: rs15});
    return [
        {id: 'city-and-minute', now: Date.UTC(2026, 9, 15, 13, 5), date_time: '202610152205', towns: [SEOUL, INCHEON, FAR], runs: [
            hour('20', base, city), hour('21', base, city), hour('22', base.map(r => r[0] === '108' ? R('108', '서울', {10: '19.9'}) : r), city),
            hour('22', base, null),
            minute('21:44', base), minute('21:50', base.map(r => r[0] === '108' ? R('108', '서울', rain('108', true, '0.5')) : r)),
            minute('22:04', base.map(r => r[0] === '400' ? R('400', '강남', Object.assign({19: '서울특별시 강남구 일원동'}, rain('400', false, '1.0'))) : r)),
            minute('22:05', base.map(r => r[0] === '410' ? R('410', '중구', Object.assign({19: '서울특별시 중구 명동'}, rain('410', true, '0'))) : r))
        ]},
        {id: 'hourly-missing', now: Date.UTC(2026, 9, 15, 13, 5), date_time: '202610152205', towns: [SEOUL], runs: [
            hour('18', base, city), minute('22:01', base)
        ]},
        {id: 'no-minute', now: Date.UTC(2026, 9, 15, 13, 5), date_time: '202610152205', towns: [SEOUL], runs: [
            hour('21', base, city), minute('21:30', base)
        ]},
        {id: 'local-rain', now: Date.UTC(2026, 9, 15, 13, 5), date_time: '202610152205', towns: [SEOUL], runs: [
            hour('21', base.concat([R('420', '대관령', {19: '강원도 평창군 대관령면 (산간)'})]), city),
            hour('22', base.map(r => r[0] === '108' ? R('108', '서울', {4: '0.5'}) : r), city),
            minute('21:55', base),
            minute('22:02', base.map(r => r[0] === '410' ? R('410', '중구', Object.assign({19: '서울특별시 중구 명동'}, rain('410', true, '0'))) :
                r[0] === '400' ? R('400', '강남', Object.assign({19: '서울특별시 강남구 일원동'}, rain('400', false, '0.5'))) : r)),
            minute('22:04', base.map(r => r[0] === '108' ? R('108', '서울', rain('108', false, '1.0')) : r))
        ]},
        {id: 'city-change', now: Date.UTC(2026, 9, 15, 13, 30), date_time: '202610152230', towns: [SEOUL, INCHEON], runs: [
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
    for (const sc of scenarios().slice(0, 1)) {
        const colls = {};
        for (const [k, m] of Object.entries(models)) colls[k] = L.fake.attach(m);
        colls.KmaStnInfo.docs.push(...(global.ORACLE_STATION_SEED || []));
        s._recursiveConvertGeoCode = (addr, n, cb) => GEO[addr] ? cb(undefined, {lat: GEO[addr][1], lon: GEO[addr][0]}) : cb(new Error('no geo'));
        s._convertGeoCodeByApiServer = (addr, cb) => cb(new Error('no api'));
        for (const [runIndex, run] of sc.runs.entries()) {
            // Capture a chosen deterministic acquisition clock BEFORE executing the actual
            // collector saver. The manifest records this same observed clock and save order;
            // it never infers completion order from native output.
            const restoreAcquisitionClock = installFakeDate(sc.now - (sc.runs.length - 1 - runIndex));
            run.fetched_at = Date.now();
            run.collector_save_order = runIndex;
            const writeStart = colls.KmaStnHourly2.log.length;
            const beforeRows = ej(colls.KmaStnHourly2.docs);
            try {
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
            // Low-level collection arguments are AFTER real Mongoose schema casting and
            // $set wrapping, and the double applies only the resulting Mongo operators.
            run.mongo_hourly_writes = ej(colls.KmaStnHourly2.log.slice(writeStart));
            run.hourly_before = beforeRows;
            run.hourly_after = ej(colls.KmaStnHourly2.docs);
            } finally { restoreAcquisitionClock(); }
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
