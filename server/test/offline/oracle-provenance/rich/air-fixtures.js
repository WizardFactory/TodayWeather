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
    // A coordinate that does not cast: Mongoose rejects that update, the stored station stays.
    second.push(Object.assign(stationItem(STATIONS[1], 1, 2), {dmX: '-', mangName: '도로변대기'}));
    second.splice(1, 1);
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

