/* Oracle sections for record-source.js (task evidence). Each section runs legacy code and returns
 * plain JSON (Dates as {"$date": ms}). */
'use strict';
const path = require('path');

function extract(code, head) {
    const start = code.indexOf(head);
    if (start < 0) throw new Error('legacy boundary changed: ' + head);
    // The function ends at the first "\n};" after its head.
    const end = code.indexOf('\n};', start);
    return code.slice(start, end + 3);
}
function once(fn) { let p; return () => p || (p = fn()); }

async function towns(L, {mongoose, ej}) {
    const tDoc = L.load('models/town');
    const coll = L.fake.attach(tDoc);
    const cwd = process.cwd();
    process.chdir(L.server);
    let finished;
    mongoose.connect = () => Promise.resolve();
    const run = file => new Promise(resolve => {
        finished = resolve;
        mongoose.disconnect = () => { const f = finished; finished = null; if (f) setTimeout(f, 10); };
        require(path.join(L.server, file));
    });
    await run('utils/initTownDataToMongo.js');
    const afterPart = coll.docs.length;
    await run('utils/updateTownDataToMongo.js');
    process.chdir(cwd);
    const list = await tDoc.find({}, {_id: 0}).lean().exec();
    const probes = [['서울특별시', '종로구', '청운효자동'], ['강원도', '', ''], ['경기도', '성남시분당구', '구미1동'],
        ['제주특별자치도', '제주시', '일도1동'], ['부산광역시', '중구', '중앙동'], ['서울특별시', '', ''], ['없는도', '없는시', '없는동']];
    const town = [];
    for (const [f, s, t] of probes) {
        const r = await tDoc.find({'town.first': f, 'town.second': s, 'town.third': t}, {_id: 0}).limit(1).lean().exec();
        town.push({args: [f, s, t], result: ej(r)});
    }
    // coordinate2xy on extra points (grid edges, rounding boundaries).
    const Convert = L.load('utils/coordinate2xy.js');
    const points = [];
    for (let i = 0; i < 400; i++) {
        const lat = 32.5 + (i * 7.919) % 6.5, lon = 124 + (i * 13.37) % 8;
        const c = new Convert({lat, lon}, {}).toLocation().getLocation();
        points.push([lat, lon, c.x, c.y]);
    }
    return {part_rows: afterPart, list: ej(list), town, points};
}

async function region(L) {
    const fs = require('fs');
    const code = fs.readFileSync(path.join(L.server, 'controllers/controllerManager.js'), 'utf8');
    const vm = require('vm');
    const sandbox = {fs, log: global.log, Manager: function () {}};
    sandbox.Manager.prototype = {};
    vm.runInNewContext(extract(code, 'Manager.prototype.getRegIdByTown = function') + '\n' +
        extract(code, 'Manager.prototype.makeRegIdTable = function'), sandbox);
    const cwd = process.cwd();
    process.chdir(L.server);
    const m = new sandbox.Manager();
    m.makeRegIdTable();
    process.chdir(cwd);
    const table = m.codeTable.map(r => Object.assign({}, r));
    const firsts = Array.from(new Set(table.map(r => r.first)));
    const cases = [];
    const push = (r, c) => m.getRegIdByTown(r, c, (err, v) => cases.push({args: [r, c], error: err ? err.message : undefined, result: err ? undefined : Object.assign({}, v)}));
    table.forEach(r => { push(r.first, r.second); push(r.first, r.second + '구'); });
    firsts.forEach(f => { push(f, ''); push(f, '없는시'); push(f, '서'); });
    [['서울특별시', '종로구'], ['부산광역시', '해운대구'], ['경기도', '수원시장안구'], ['경기도', '성남시분당구'], ['강원도', '강릉시'],
     ['강원특별자치도', '강릉시'], ['전라북도', '전주시완산구'], ['전북특별자치도', '전주시'], ['이어도', ''], ['없는도', '어딘가']].forEach(([r, c]) => push(r, c));
    return {table, cases};
}

async function zones(L, {ej}) {
    const Model = L.load('models/kma/kma.forecast.zone.model.js');
    const Controller = L.load('controllers/kma/kma.forecast.zone.controller.js');
    const fixtures = require('./zone-fixtures');
    const runs = [];
    for (const scenario of fixtures.scenarios) {
        const coll = L.fake.attach(Model);
        const steps = [];
        for (const acquisition of scenario.acquisitions) {
            const c = new Controller(['k']);
            let page = 0;
            c._request = () => {
                const body = acquisition.pages[page++];
                if (body === undefined) return Promise.reject(new Error('oracle: no more pages'));
                return Promise.resolve(JSON.parse(body));
            };
            let error = null;
            try { await c.getFromKma(); } catch (e) { error = e.message; }
            steps.push({error, pages_read: page});
        }
        const queries = [];
        for (const [r, ci] of scenario.queries) {
            const c = new Controller(['k']);
            const res = await new Promise(resolve => c.findForecastZoneByName(r, ci).exec((e, v) => resolve(e ? {error: e.message} : {result: ej(v)})));
            queries.push(Object.assign({args: [r, ci]}, res));
        }
        // retiredAt is the wall clock of the retiring run: recorded as a marker.
        const docs = coll.docs.map(d => { const o = Object.assign({}, d); delete o._id; if (o.retiredAt) o.retiredAt = 'run-time'; return ej(o); });
        runs.push({id: scenario.id, steps, queries, docs, acquisitions: scenario.acquisitions});
    }
    return {land: Array.from(Controller.landZoneIds()), runs};
}

module.exports = {towns, region, zones};
