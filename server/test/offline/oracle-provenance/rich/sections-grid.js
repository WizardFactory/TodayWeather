/* Grid, RSS and mid oracle sections (task evidence). Pages are the JSON acquisitions server2
 * stores; legacy receives the same item values as XML through a stubbed `request.get`, so its own
 * xml2js parsing, page checks, organizers, publication checks and savers run unchanged. */
'use strict';
const Module = require('module');

let handler = null;
function installRequest() {
    const request = Module._load('request', module);
    request.get = (url, opts, cb) => {
        if (!handler) throw new Error('network access is not allowed in the oracle');
        const body = handler(url);
        setImmediate(() => cb(null, {statusCode: 200}, body));
        return {abort() {}};
    };
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
/** The XML form of one data.go.kr JSON page (same values, legacy dataType=XML layout). */
function toXml(json) {
    const page = JSON.parse(json), r = page.response;
    const head = '<header><resultCode>' + esc(r.header.resultCode) + '</resultCode><resultMsg>' + esc(r.header.resultMsg) + '</resultMsg></header>';
    if (!r.body) return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><response>' + head + '</response>';
    const items = r.body.items.item.map(item => '<item>' + Object.keys(item).map(k => '<' + k + '>' + esc(item[k]) + '</' + k + '>').join('') + '</item>').join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><response>' + head + '<body><dataType>XML</dataType><items>' + items +
        '</items><numOfRows>' + r.body.numOfRows + '</numOfRows><pageNo>' + r.body.pageNo + '</pageNo><totalCount>' + r.body.totalCount + '</totalCount></body></response>';
}
function pageOf(url) { const m = /[?&]pageNo=([0-9]+)/.exec(url); return m ? Number(m[1]) : 1; }
const wait = fn => new Promise((resolve, reject) => fn((err, v) => err ? reject(err) : resolve(v)));

function stamp(date, time) {
    return Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), +time.slice(0, 2), +time.slice(2, 4));
}

async function grid(L, {ej, coord: inputCoord = {mx: 60, my: 127}}) {
    installRequest();
    const CollectData = L.load('lib/collectTownForecast.js');
    const FGC = L.load('lib/forecastGridCollection.js');
    const C = {
        current: [new (L.load('controllers/kma/kma.town.current.controller.js'))(), L.load('models/kma/kma.town.current.model.js'), 'saveCurrent', 0],
        shortest: [new (L.load('controllers/kma/kma.town.shortest.controller.js'))(), L.load('models/kma/kma.town.shortest.model.js'), 'saveShortest', 1],
        short: [new (L.load('controllers/kma/kma.town.short.controller.js'))(), L.load('models/kma/kma.town.short.model.js'), 'saveShort', 2],
    };
    const publicationInstant = slot => new Date(stamp(slot.date, slot.time) - 9 * 3600000);
    const fixtures = require('./grid-fixtures');
    const out = [];
    for (const scenario of fixtures.scenarios) {
        const colls = {};
        for (const f of Object.keys(C)) colls[f] = L.fake.attach(C[f][1]);
        const runs = scenario.runs.slice().sort((a, b) => a.fetched_at - b.fetched_at);
        const outcomes = [];
        for (const run of runs) {
            const [ctrl, , save, dataType] = C[run.family];
            const coord = inputCoord;
            const collect = new CollectData();
            collect.srcList = [coord];
            collect.listCount = 1;
            collect.resetResult();
            collect.resultList[0].mCoord = coord;
            const product = run.family === 'current' ? undefined : run.family;
            const control = product ? {product, slot: run.slot, cancelled: false, httpAttempts: 0, pendingWrites: 0} : undefined;
            if (control) collect.validateForecastItems = items => FGC.rawItems(items, product, run.slot, coord);
            handler = url => toXml(run.pages[pageOf(url) - 1]);
            const url = collect.getUrl(dataType, 'k', run.slot.date, run.slot.time, coord);
            // Retention runs at the start of each collection run, anchored on its publication.
            await new Promise(resolve => { ctrl.remove(publicationInstant(run.slot)); setTimeout(resolve, 5); });
            const result = await new Promise(resolve => collect.getData(0, dataType, url, undefined, err => resolve(err ? err.message : null)));
            handler = null;
            const item = collect.resultList[0];
            let outcome = result || 'organized';
            if (item.isCompleted) {
                if (control) item.data = FGC.within(product, run.slot, item.data);
                if (control && !FGC.batch(product, run.slot, item.mCoord, item.data)) {
                    outcome = 'batch-rejected';
                } else {
                    if (control) item.data.forEach(row => { row.pubDate = FGC.canonical(product, row.pubDate); });
                    await new Promise((resolve, reject) => ctrl[save](item.data, err => err ? reject(err) : resolve(), control));
                    outcome = 'saved';
                }
            }
            outcomes.push({family: run.family, period: run.period, fetched_at: run.fetched_at, outcome});
        }
        // The run at the request instant: retention anchored on each family's latest run.
        const answers = {};
        for (const f of Object.keys(C)) {
            const mine = runs.filter(r => r.family === f);
            if (!mine.length) continue;
            const latest = mine.map(r => r.slot).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).pop();
            await new Promise(resolve => { C[f][0].remove(publicationInstant(latest)); setTimeout(resolve, 5); });
            const docs = await C[f][1].find({'mCoord.mx': inputCoord.mx, 'mCoord.my': inputCoord.my}, {_id: 0}).sort({fcsDate: 1}).lean().exec();
            answers[f] = ej(docs);
        }
        out.push({id: scenario.id, at: scenario.at, runs: scenario.runs, outcomes, answers});
    }
    return out;
}

async function rss(L, {ej}) {
    installRequest();
    const TownRss = L.load('controllers/kma/kma.town.short.rss.controller.js');
    const model = L.load('models/kma/kma.town.short.rss.model.js');
    const fixtures = require('./rss-fixtures');
    const out = [];
    for (const scenario of fixtures.scenarios) {
        const coll = L.fake.attach(model);
        const outcomes = [];
        const runs = scenario.runs.slice().sort((a, b) => a.fetched_at - b.fetched_at);
        for (const run of runs) {
            const t = new TownRss();
            const item = {mCoord: {mx: 60, my: 127}};
            // mainTask: retention at the run's wall clock, then the publication skip, then fetch/parse/save.
            await new Promise(resolve => { t.remove(new Date(run.fetched_at)); setTimeout(resolve, 5); });
            const skipped = await new Promise(resolve => t.checkPubDate(item, run.expected, 0, err => resolve(!!err)));
            if (skipped) { outcomes.push({fetched_at: run.fetched_at, outcome: 'skipped'}); continue; }
            handler = () => run.xml;
            const res = await new Promise(resolve => t.getData(0, item, err => resolve(err)));
            handler = null;
            outcomes.push({fetched_at: run.fetched_at, outcome: res ? 'failed:' + res : 'saved'});
        }
        await new Promise(resolve => { new TownRss().remove(new Date(scenario.last_run)); setTimeout(resolve, 5); });
        const docs = await model.find({'mCoord.mx': 60, 'mCoord.my': 127}, {_id: 0}).sort({fcsDate: 1}).lean().exec();
        out.push({id: scenario.id, at: scenario.at, last_run: scenario.last_run, runs: scenario.runs, outcomes, answer: ej(docs), stored: coll.docs.length});
    }
    return out;
}

async function mid(L, {ej}) {
    installRequest();
    const CollectData = L.load('lib/collectTownForecast.js');
    const Mid = L.load('controllers/kma/kma.town.mid.controller.js');
    const models = {
        modelMidForecast: L.load('models/kma/kma.town.mid.forecast.model.js'),
        modelMidLand: L.load('models/kma/kma.town.mid.land.model.js'),
        modelMidTemp: L.load('models/kma/kma.town.mid.temp.model.js'),
    };
    const types = {forecast: ['modelMidForecast', 3], land: ['modelMidLand', 4], temp: ['modelMidTemp', 5]};
    const fixtures = require('./mid-fixtures');
    const out = [];
    for (const scenario of fixtures.scenarios) {
        for (const m of Object.values(models)) L.fake.attach(m);
        const ctrl = new Mid();
        const outcomes = [];
        const runs = scenario.runs.slice().sort((a, b) => a.fetched_at - b.fetched_at);
        for (const run of runs) {
            const [type, dataType] = types[run.kind];
            const dateString = {date: run.tmfc.slice(0, 8), time: run.tmfc.slice(8)};
            const due = await wait(cb => ctrl.checkPubDate(type, [{code: run.code}], dateString, cb));
            if (!due.length) { outcomes.push({fetched_at: run.fetched_at, outcome: 'skipped'}); continue; }
            const collect = new CollectData();
            collect.srcList = [{code: run.code}];
            collect.listCount = 1;
            collect.resetResult();
            handler = url => toXml(run.pages[pageOf(url) - 1]);
            const url = collect.getUrl(dataType, 'k', dateString.date, dateString.time, {code: run.code});
            const options = {date: dateString.date, time: dateString.time, code: run.code};
            const res = await new Promise(resolve => collect.getData(0, dataType, url, options, err => resolve(err ? err.message : null)));
            handler = null;
            const item = collect.resultList[0];
            if (!item.isCompleted) { outcomes.push({fetched_at: run.fetched_at, outcome: 'failed:' + res}); continue; }
            await new Promise((resolve, reject) => ctrl.saveMid(type, item.data[0], true, err => err ? reject(err) : resolve()));
            await new Promise(resolve => setTimeout(resolve, 5));
            outcomes.push({fetched_at: run.fetched_at, outcome: 'saved'});
        }
        const answers = [];
        for (const [kind, regId] of scenario.queries) {
            const r = await models[types[kind][0]].find({regId}, {_id: 0}).sort({pubDate: -1}).limit(1).lean().exec();
            answers.push({kind, regId, result: ej(r)});
        }
        out.push({id: scenario.id, runs: scenario.runs, outcomes, answers});
    }
    return out;
}

module.exports = {grid, rss, mid};
