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
    for (const day of [13, 14, 15]) {
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

