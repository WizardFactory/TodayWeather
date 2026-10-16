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

