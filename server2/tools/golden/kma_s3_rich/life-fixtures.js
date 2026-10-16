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
/** UV acquisitions every 3 hours from base - 12 days through base (issuance order, one skipped repeat):
 * the run that saves base-2 days removes the documents dated before base-12 days. */
function uv(base) {
    const out = [];
    for (let h = -288; h <= 0; h += 3) {
        const ms = base + h * 3600000;
        const issued = issuance(ms);
        out.push({fetched: ms + 40 * 60000, issued, items: AREAS.map((a, i) => uvItem(a, issued, i + h))});
    }
    out.push(Object.assign({}, out[out.length - 2], {fetched: base + 50 * 60000}));
    return out;
}
function pollen(base, type) {
    const out = [];
    for (let d = -12; d <= 0; d++) {
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

