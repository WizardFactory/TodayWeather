/* S15b-3b oracle section (task evidence): legacy life-index collection (lifeIndexKmaRequester
 * convertUvItemsV5 / convertPollenItemsV3, saveLifeIndex2, _removeOldData, the in-memory
 * lastIssued skip) and the tw_svc reader (lifeIndexKmaController._fromLifeIndexDb2) over the
 * in-memory collection double. */
'use strict';
const F = require('./life-fixtures');
const RealDate = Date;
let NOW = 0;
class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(NOW); }
    static now() { return NOW; }
}
async function withClock(ms, fn) {
    const saved = global.Date; NOW = ms; global.Date = FakeDate;
    try { return await fn(); } finally { global.Date = saved; }
}
function cb2p(fn) { return new Promise(resolve => fn((err, v) => resolve({err, v}))); }

async function life(L, {ej}) {
    const Model = L.load('models/kma/kma.lifeindex.model.js');
    const coll = L.fake.attach(Model);
    const Requester = L.load('lib/lifeIndexKmaRequester.js');
    const Controller = L.load('controllers/lifeIndexKmaController.js');
    const svc = new Requester();
    const base = RealDate.UTC(2026, 9, 15, 3, 0); // 12:00 KST
    // Acquisitions in completion order (UV every 3 hours, pollen twice a day per type).
    const runs = [];
    F.uv(base).forEach(a => runs.push(Object.assign({kind: 'ultrv'}, a)));
    ['flowerWoody', 'flowerPine', 'flowerWeeds'].forEach(t => F.pollen(base, t).forEach(a => runs.push(Object.assign({kind: t}, a))));
    runs.sort((a, b) => a.fetched - b.fetched || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
    const last = {};
    const outcomes = [];
    const queries = [];
    const queryTimes = [base - 11 * 86400000, base - 50 * 3600000, base - 3600000, base + 3600000];
    let q = 0;
    const answer = async (t) => {
        for (const area of F.AREAS.concat(['9999999999'])) {
            const r = await withClock(t, () => cb2p(cb => Controller._fromLifeIndexDb2(parseInt(area), cb)));
            queries.push({now: t, areaNo: area, error: r.err ? r.err.message : null,
                result: r.err ? null : ej(r.v.map(d => { const o = Object.assign({}, d); delete o._id; return o; }))});
        }
    };
    for (const a of runs) {
        while (q < queryTimes.length && queryTimes[q] < a.fetched) await answer(queryTimes[q++]);
        await withClock(a.fetched, async () => {
            // taskLifeIndex2 removes old documents before it runs the UV task; taskUltrvV5 /
            // taskPollenV3 then skip an issuance not newer than the last saved one.
            if (a.kind === 'ultrv') svc._removeOldData();
            if (last[a.kind] && a.issued <= last[a.kind]) { outcomes.push({kind: a.kind, issued: a.issued, skipped: true}); return; }
            const rows = a.kind === 'ultrv' ? svc.convertUvItemsV5(a.items) : svc.convertPollenItemsV3(a.kind, a.items);
            if (!rows.length) { outcomes.push({kind: a.kind, issued: a.issued, rows: 0}); return; }
            const saved = await cb2p(cb => svc.saveLifeIndex2(a.kind, rows, cb));
            last[a.kind] = a.issued;
            outcomes.push({kind: a.kind, issued: a.issued, rows: rows.length, error: saved.err ? saved.err.message : null});
        });
    }
    while (q < queryTimes.length) await answer(queryTimes[q++]);
    return {runs: runs.map(r => ({kind: r.kind, fetched: r.fetched, issued: r.issued, items: r.items})), outcomes, queries,
        docs: ej(coll.docs.map(d => { const o = Object.assign({}, d); delete o._id; return o; }))};
}
module.exports = {life};

