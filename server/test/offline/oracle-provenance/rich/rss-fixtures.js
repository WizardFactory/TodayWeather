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
