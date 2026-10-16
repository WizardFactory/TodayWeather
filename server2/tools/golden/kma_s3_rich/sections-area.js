/* S15b-3b oracle section (task evidence): the legacy area-number collection. Base: the 2016
 * geocoded list (`utils/data/20160704_AreaNoResutl`) saved as `utils/updateAreaNo.js` saves a
 * town (`update({town}, {areaNo, town, geo}, {upsert})`); then `utils/update.areano.to.db.js`
 * runs unchanged over the 2018 list with a deterministic Kakao address-search stub. Readers:
 * `controllerTown.getLifeIndexKma` `findAreaNo` and `findNearAreaNo`. */
'use strict';
const path = require('path');
const fs = require('fs');
function cb2p(fn) { return new Promise(resolve => fn((err, v) => resolve({err, v}))); }

async function area(L, {mongoose, ej}) {
    const Area = L.load('models/modelAreaNo.js');
    const Town = L.load('models/town.js');
    const coll = L.fake.attach(Area);
    L.fake.attach(Town);
    // 2016 base: every geocoded result line, as updateAreaNo.js stores it.
    const lines = fs.readFileSync(path.join(L.server, 'utils/data/20160704_AreaNoResutl'), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
        const r = JSON.parse(line);
        if (!r.geocode) continue;
        const saved = {areaNo: r.areaNo, town: r.town, geo: [r.geocode.lon, r.geocode.lat]};
        await cb2p(cb => Area.update({town: saved.town}, saved, {upsert: true}, cb));
    }
    const base = coll.docs.length;
    // 2018 update with the Kakao stub: x/y derived from the address text.
    const geocoded = [];
    global.ORACLE_AXIOS_GET = (url) => {
        const q = decodeURIComponent(url.split('query=')[1] || '');
        let h = 0;
        for (const c of q) h = (h * 31 + c.codePointAt(0)) % 1000003;
        const x = 126 + (h % 30000) / 10000, y = 34 + ((h >> 3) % 40000) / 10000;
        geocoded.push({query: q, x, y});
        // Kakao answers x/y as strings (live 2026-10-15), as the legacy script receives them.
        return Promise.resolve({data: {meta: {total_count: 1}, documents: [{x: String(x), y: String(y)}]}});
    };
    const cwd = process.cwd();
    process.chdir(L.server);
    let finished;
    const done = new Promise(r => { finished = r; });
    const realInfo = console.info;
    console.info = (msg) => { if (msg === 'finish') setTimeout(finished, 200); };
    mongoose.connect = () => Promise.resolve();
    require(path.join(L.server, 'utils/update.areano.to.db.js'));
    await done;
    await new Promise(r => setTimeout(r, 500));
    console.info = realInfo;
    process.chdir(cwd);
    const docs = coll.docs.map(d => { const o = Object.assign({}, d); delete o._id; return o; });
    // Reader answers (find(...).limit(1) and $near maxDistance 0.3 limit 3), without _id.
    const strip = list => ej(list.map(d => { const o = Object.assign({}, d); delete o._id; return o; }));
    const towns = [['서울특별시', '종로구', '청운효자동'], ['서울특별시', '', ''], ['부산광역시', '강서구', '명지1동'],
        ['세종특별자치시', '세종특별자치시', '새롬동'], ['경기도', '수원시권선구', '금곡동'], ['없는도', '없는시', '없는동']];
    const byTown = [];
    for (const [f, s, t] of towns) {
        const r = await Area.find({'town.first': f, 'town.second': s, 'town.third': t}).limit(1).lean().exec();
        byTown.push({args: [f, s, t], result: strip(r)});
    }
    const points = [[126.978, 37.5665], [129.0756, 35.1796], [127.289, 36.48], [127.0, 37.27], [124.0, 33.0]];
    const near = [];
    for (const g of points) {
        const r = await Area.find({geo: {$near: g, $maxDistance: 0.3}}).limit(3).lean().exec();
        near.push({args: g, result: strip(r)});
    }
    return {base, geocoded, docs: ej(docs), byTown, near};
}
module.exports = {area};

