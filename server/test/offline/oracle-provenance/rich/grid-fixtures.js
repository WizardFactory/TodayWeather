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
