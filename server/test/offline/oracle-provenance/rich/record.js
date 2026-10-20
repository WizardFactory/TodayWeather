/* S15b4b3 independent legacy HTTP recorder. Ported from S15 documented driver;
 * collector conversion and response code remain legacy, network/DB boundaries are isolated.
 * Executes the legacy /v000903/kma router through the maintained offline harness
 * (server/test/offline/rss-response-smoke.js) exactly as the S02 recorder does, and records,
 * for every request, the response plus each dependency answer at the legacy store-read
 * boundary (model reads and controller dependency calls) in the server2 KmaStore vocabulary.
 * Run: TZ=UTC NODE_ENV=production NODE_PATH=<deps>/node_modules node record-kma.js <repo> <out.json.gz>
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');
const crypto = require('crypto'), assert = require('assert'), http = require('http'), zlib = require('zlib');
const root = path.resolve(process.argv[2]);
const outFile = path.resolve(process.argv[3]);
const server = path.join(root, 'server');
if (outFile.startsWith(path.join(root, 'server2/tests/domestic/fixtures') + path.sep)) throw new Error('record output cannot overwrite committed fixture directory');
process.env.TW_REPO = root;
if (process.version !== 'v16.20.2') throw new Error('Pinned oracle Node v16.20.2 required');
if (process.env.TZ !== 'UTC' || process.env.NODE_ENV !== 'production') throw new Error('TZ=UTC NODE_ENV=production required');
const sourceFiles = {}, rawRead = fs.readFileSync;
fs.readFileSync = function (file, ...args) {
    if (typeof file === 'string') {
        const resolved = path.resolve(file);
        if (/\.(?:pem|env)$/.test(resolved) || resolved === path.join(server, 'config/config.js')) throw new Error('private input forbidden');
    }
    const bytes = rawRead.call(this, file, ...args);
    if (typeof file === 'string') {
        const resolved = path.resolve(file);
        if (resolved.startsWith(server + path.sep)) sourceFiles[path.relative(root, resolved)] = crypto.createHash('sha256').update(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)).digest('hex');
    }
    return bytes;
};
const allowedPorts = new Set();
const net = require('net'), connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
    let a = args[0]; if (Array.isArray(a)) a = a[0];
    const host = typeof a === 'object' ? a.host : args[1];
    const port = typeof a === 'object' ? Number(a.port) : Number(a);
    if (host !== '127.0.0.1' || !allowedPorts.has(port)) throw new Error('Oracle network denied');
    return connect.apply(this, args);
};
for (const method of ['request', 'get']) require('https')[method] = () => { throw new Error('Oracle HTTPS denied'); };
const realGetPixels = require('get-pixels');
global.ORACLE_IMAGE_CONFIG = {airkorea_korea_image:{coordi:{top_lat:'39.3769',bottom_lat:'32.6942',left_lon:'123.9523',right_lon:'130.6741'},size:{width:'820',height:'820'},pixel_pos:{left:'77',right:'663',top:'75',bottom:'794'}}};
const express = require('express'), session = require('express-session'), i18n = require('i18n');
const bodyParser = require('body-parser'), cookieParser = require('cookie-parser'), cors = require('cors');
i18n.configure({locales: ['en', 'ko', 'ja', 'zh-CN', 'de', 'zh-TW'], cookie: 'twcookie', directory: path.join(server, 'locales'), register: global, updateFiles: false});
function translate() { return function (...args) { return i18n.__.apply(global, args); }; }
const RealDate = Date;
let now = '2026-09-24T00:10:00.000Z';
class FixedDate extends RealDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return RealDate.parse(now); } }
global.Date = FixedDate;
const clone = v => require('v8').deserialize(require('v8').serialize(v));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

// ---- recording ----
let calls = null, suppress = 0, overrides = {}, thrown = [], responded = false;
let regionResolver;
function isDate(v) { return v !== null && typeof v === 'object' && Object.prototype.toString.call(v) === '[object Date]'; }
function enc(v) {
    if (isDate(v)) return {$date: v.getTime()};
    if (v === undefined) return {$undefined: true};
    if (typeof v === 'number' && !isFinite(v)) throw new Error('non-finite number in a recorded answer');
    if (Array.isArray(v)) return v.map(enc);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = enc(v[k]); return o; }
    return v;
}
function record(m, args, result, error) {
    if (!calls || suppress > 0) return;
    const entry = {m, args: enc(args)};
    // Legacy async.map keeps calling after an error ends the chain and the reply is sent.
    if (responded) entry.after_response = true;
    if (error !== undefined && error !== null) entry.error = String(error && error.message || error);
    else entry.result = enc(result === undefined ? null : result);
    calls.push(entry);
}
const TOWN = {'kma.town.short.model': 'Short', 'kma.town.current.model': 'Current', 'kma.town.shortest.model': 'Shortest', 'kma.town.short.rss.model': 'ShortRss',
    modelShort: 'Short', modelCurrent: 'Current', modelShortest: 'Shortest', modelShortRss: 'ShortRss'};
const MID = {'kma.town.mid.forecast.model': 'Forecast', 'kma.town.mid.land.model': 'Land', 'kma.town.mid.temp.model': 'Temp',
    modelMidForecast: 'Forecast', modelMidLand: 'Land', modelMidTemp: 'Temp'};
function modelCall(name, query, result, error) {
    const q = query || {};
    if (name === 'town') {
        if (!Object.keys(q).length) return record('towns', [], result, error);
        return record('town', [q['town.first'], q['town.second'], q['town.third']], result, error);
    }
    if (TOWN[name]) return record('town_model', [TOWN[name], q['mCoord.mx'], q['mCoord.my']], result, error);
    if (MID[name]) return record('mid_model', [MID[name], q.regId], result, error);
    if (name === 'modelAreaNo') {
        if (q.geo) return record('area_no_near', [q.geo.$near], result, error);
        return record('area_no', [q['town.first'], q['town.second'], q['town.third']], result, error);
    }
    if (name === 'kma.lifeindex.model') return record('life_index', [q.areaNo], result, error);
    if (name === 'modelFoodPoisoning') return record('food_poisoning', [q.sd, q.sgg.$in[0], q.date.$gte, q.date.$lte], result, error);
    if (name === 'modelKmaSpecialWeatherZone') return record('special_zones', [q.areaCode.$in], result, error);
    return record('unknown_model:' + name, [q], result, error);
}
function answer(key, original, args, done) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
        const o = overrides[key];
        if (o && typeof o.reader === 'function') return o.reader(...args, done);
        const value = typeof o === 'function' ? o(...args) : clone(o);
        if (value && value.__error) return done(new Error(value.__error));
        return done(null, value);
    }
    suppress++;
    let finished = false;
    try {
        original((err, value, ...rest) => {
            if (finished) return; finished = true;
            suppress--;
            done(err, value, ...rest);
        });
    } catch (e) {
        if (!finished) { finished = true; suppress--; }
        thrown.push({key, message: String(e && e.message)});
        // The legacy caller catches this synchronous failure: no dependency answer is used.
        if (key === 'air_fallback') calls && calls.push({m: 'air_fallback', args: enc(args), result: null, legacy_exception: String(e && e.message).split('\n')[0]});
        throw e;
    }
}
function instrument(id, m) {
    const base = path.basename(String(id)).replace(/\.js$/, '');
    if (!m || m.__instrumented) return m;
    let w = m;
    if (base === 'kecoController') {
        w = Object.create(m);
        w.getArpLtnInfo = (town, date, cb) => { const at = enc([town, date]); answer('arpltn', c => m.getArpLtnInfo(town, date, c), [town, date], (e, v) => { record('arpltn', at, v, e); cb(e, v); }); };
        w.getDustFrcst = (town, date, cb) => { const at = enc([town.region, town.city, date]); answer('dust_forecast', c => m.getDustFrcst(town, date, c), [town, date], (e, v) => { record('dust_forecast', at, v, e); cb(e, v); }); };
    } else if (base === 'controllerKmaStnWeather') {
        w = Object.create(m);
        w.getStnHourlyAndMinRns = (town, dt, cur, cb) => { const at = enc([town, dt, cur]); answer('stn', c => m.getStnHourlyAndMinRns(town, dt, cur, c), [town, dt, cur], (e, v) => { record('stn_hourly_and_min_rns', at, v, e); cb(e, v); }); };
        w.getCityHourlyList = (town, cb) => { const at = enc([town]); answer('city_hourly', c => m.getCityHourlyList(town, c), [town], (e, v) => { record('city_hourly', at, v, e); cb(e, v); }); };
    } else if (base === 'service' && /history[\\/]service$/.test(String(id))) {
        // S15b-2: the ASOS history read (config.history.readEnabled) at the store boundary.
        w = Object.create(m);
        w.loadForTown = (town, cb) => { const at = enc([town]); answer('history', c => m.loadForTown(town, c), [town], (e, v) => { record('history', at, v, e); cb(e, v); }); };
    } else if (base === 'kasi.riseset.controller') {
        w = Object.create(m);
        w.getRiseSetList = (geo, dates, cb) => { const at = enc([geo, dates]); answer('rise_set', c => m.getRiseSetList(geo, dates, c), [geo, dates], (e, v) => { record('rise_set', at, v, e); cb(e, v); }); };
    } else if (base === 'airkorea.hourly.forecast.controller' || base === 'kaq.hourly.forecast.controller') {
        const source = base.startsWith('kaq') ? 'kaq' : 'airkorea';
        w = function () {
            const inner = new m();
            this.getForecast = (stn, cb) => { const at = enc([source, stn]); answer('air_forecast_' + source, c => inner.getForecast(stn, c), [stn], (e, v) => { record('air_forecast', at, v, e); cb(e, v); }); };
        };
    } else if (base === 'airFallback') {
        w = Object.create(m);
        w.getArpltn = (g, t, cb) => { const at = enc([g, t]); answer('air_fallback', c => m.getArpltn(g, t, c), [g, t], (e, v, reason) => { record('air_fallback', at, v || null, e); cb(e, v, reason); }); };
    } else if (base === 'kma.forecast.zone.controller') {
        w = function () {
            const inner = new m();
            this.findForecastZoneByName = (r, c) => ({exec: cb => { const at = enc([r, c]); answer('forecast_zone', k => inner.findForecastZoneByName(r, c).exec(k), [r, c], (e, v) => { record('forecast_zone', at, v, e); cb(e, v); }); }});
        };
    } else {
        return m;
    }
    w.__instrumented = true;
    return w;
}

function harnessModule(file, extra, transform) {
    let code = fs.readFileSync(file, 'utf8');
    if (transform) code = transform(code);
    const m = {exports: {}}, req = Module.createRequire(file);
    const sandbox = {require: req, module: m, exports: m.exports, __dirname: path.dirname(file), __filename: file,
        process, console, Buffer, Date: FixedDate, URL, URLSearchParams, setTimeout, clearTimeout, setImmediate, ...extra};
    vm.runInNewContext('(function(require,module,exports,__filename,__dirname){' + code + '\n})', sandbox, {filename: file})(req, m, m.exports, file, path.dirname(file));
    return m.exports;
}
function swap(code, from, to) { assert(code.includes(from), 'harness boundary changed: ' + from.slice(0, 60)); return code.replace(from, to); }
function makeDomesticHarness() {
    return harnessModule(path.join(server, 'test/offline/rss-response-smoke.js'), {__modelCall: modelCall, __record: record, __instrument: instrument, __region:(r,c,cb)=>regionResolver(r,c,(e,v)=>{record("region_code",[r,c],v,e);cb(e,v);})}, code => {
        code = swap(code, 'const data=()=>clone(modelData(name));', 'const data=()=>{const d=clone(modelData(name));__modelCall(name,query,d);return clone(d);};');
        code = swap(code, 'exec(callback){if(failure)return callback(new Error(failure));callback(null,data());}',
            'exec(callback){if(failure){__modelCall(name,query,undefined,failure);return callback(new Error(failure));}callback(null,data());}');
        code = swap(code, "current:'202609240900'", "current:fixture.currentPub||'202609240900'");
        // D4 (AK, 2026-10-14): the deployed manager keeps 192 current slots (controllerManager.js).
        code = swap(code, 'MAX_CURRENT_COUNT:200', 'MAX_CURRENT_COUNT:192');
        code = swap(code, '  function modelData(name) {', '  function modelData(name) { if (fixture.docRows && Object.hasOwn(fixture.docRows, name)) return fixture.docRows[name];');
        code = swap(code, "getRegIdByTown:(r,c,cb)=>cb(null,{pointNumber:'109',cityCode:'11B10101'})",
            "getRegIdByTown:__region");
        code = swap(code, '  function localRequire(id) {', '  function localRequire(id) { return __instrument(id, __innerRequire(id)); }\n  function __innerRequire(id) {');
        const marker = '  // Exercise real XML parsing and collector conversion';
        assert(code.includes(marker));
        return code.slice(0, code.indexOf(marker)) + `
  const router=load(historyOptions.oracleRoute);
  return {router,logs,queries,load};
}
module.exports={makeFixture,createHarness,locations};`;
    });
}
function appFor(router, mount) {
    const app = express(); app.set('env', 'production');
    app.use(cors());
    app.use(session({secret: 'wizard factory', resave: false, saveUninitialized: true, genid: () => 'golden-session-fixed', cookie: {maxAge: 60000}}));
    app.use(bodyParser.json()); app.use(bodyParser.urlencoded({extended: false})); app.use(cookieParser()); app.use(i18n.init);
    app.use((req, res, next) => { req.version = (req.url.match(/^\/(v\d+)/) || [])[1]; next(); });
    app.use((req, res, next) => { const json = res.json, send = res.send; res.json = function (...a) { responded = true; return json.apply(this, a); };
        res.send = function (...a) { responded = true; return send.apply(this, a); }; next(); });
    app.use(mount, router);
    return app;
}
async function wire(app, input) {
    const listener = http.createServer(app), sockets = new Set();
    listener.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    await new Promise((ok, bad) => { listener.once('error', bad); listener.listen(0, '127.0.0.1', ok); });
    const port = listener.address().port; allowedPorts.add(port);
    try {
        return await new Promise((resolve, reject) => {
            const req = http.request({host: '127.0.0.1', port, path: input.path, method: input.method || 'GET', headers: {connection: 'close', ...input.headers}, agent: false}, res => {
                const chunks = []; res.on('data', c => chunks.push(c));
                res.on('end', () => resolve({status: res.statusCode, headers: res.headers, contentType: res.headers['content-type'], etag: res.headers.etag, raw: Buffer.concat(chunks)}));
            });
            req.setTimeout(15000, () => req.destroy(new Error('case timeout'))); req.on('error', reject); req.end();
        });
    } finally { for (const s of sockets) s.destroy(); await new Promise(ok => listener.close(ok)); allowedPorts.delete(port); }
}


// Offline collector/document and response composition. No native values enter this oracle.
function decode(v) {
    if (v && typeof v === 'object' && Object.keys(v).length === 1 && '$date' in v) return new RealDate(v.$date);
    if (v && typeof v === 'object' && Object.keys(v).length === 1 && Object.keys(v)[0].startsWith('$number')) return Number(Object.values(v)[0]);
    if (Array.isArray(v)) return v.map(decode);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]));
    return v;
}
async function runS3Oracle() {
    now = '2026-10-15T13:05:00.000Z';
    process.env.TW_SMOKE_NOW = now;
    // Mongoose5 schema construction recognizes the real Date constructor; the response VM
    // still receives FixedDate explicitly. Collector times below are explicit fixture times.
    global.Date = RealDate;
    const L = require('./legacy');
    const mongoose = require('mongoose');
    assert.strictEqual(require('mongoose/package.json').version, '5.1.2');
    const context = {mongoose, ej: L.fake.ejson, vm, fs, path, assert};
    const sg = require('./sections-grid');
    const gf = require('./grid-fixtures');
    const {shiftRaw} = require('./shift-raw');
    gf.scenarios.splice(0,gf.scenarios.length,...shiftRaw(gf.scenarios,21));
    gf.scenarios.splice(0, gf.scenarios.length, ...gf.scenarios.filter(s => ['current', 'shortest', 'short'].includes(s.id)));
    // This public source corpus contains intentionally malformed/old cases. The initial whole-
    // response workload uses the documented successful current/forecast acquisitions only.
    const gridBase = JSON.parse(JSON.stringify(gf.scenarios));
    const grid = [];
    for (const coord of [{mx:60,my:127},{mx:54,my:125},{mx:53,my:38}]) {
        const scenarios = JSON.parse(JSON.stringify(gridBase));
        for (const scenario of scenarios) for (const run of scenario.runs) {
            run.grid = {nx:coord.mx,ny:coord.my};
            run.pages = run.pages.map(body => { const page=JSON.parse(body);
                for(const row of page.response.body?.items?.item || []) {row.nx=coord.mx;row.ny=coord.my;}
                return JSON.stringify(page); });
        }
        gf.scenarios.splice(0,gf.scenarios.length,...scenarios);
        grid.push(...await sg.grid(L,{...context,coord}));
    }
    regionResolver = require('./sections').regionResolver(L);

    const rf = require('./rss-fixtures'); rf.scenarios.splice(0,rf.scenarios.length,...shiftRaw(rf.scenarios,21)); rf.scenarios.splice(1);
    const rss = (await sg.rss(L, context))[0];
    const mf = require('./mid-fixtures'); mf.scenarios.splice(0,mf.scenarios.length,...shiftRaw(mf.scenarios,21)); mf.scenarios[0].runs = mf.scenarios[0].runs.filter(r => r.fetched_at <= Date.parse(now));
    const mid = (await sg.mid(L, context))[0];
    const originalLog = console.log; console.log = () => {};
    let townSection; try { townSection = await require('./sections').towns(L, context); } finally { console.log = originalLog; }
    const town = decode(townSection.list.find(t => t.town.first === '서울특별시' && t.town.second === '종로구' && t.town.third === '청운효자동'));
    assert(town, 'canonical town fixture absent');
    const docRows = {town: decode(townSection.list)};
    const names = {current: 'kma.town.current.model', shortest: 'kma.town.shortest.model', short: 'kma.town.short.model'};
    const raw = [];
    for (const scenario of grid) {
        docRows[names[scenario.id]] = (docRows[names[scenario.id]] || []).concat(decode(scenario.answers[scenario.id]));
        for (const run of scenario.runs) {
            const outcome = scenario.outcomes.find(o => o.period === run.period && o.fetched_at === run.fetched_at);
            if (outcome && outcome.outcome === 'saved') raw.push({family: run.family, grid:run.grid, slot: run.slot, period: run.period, fetched_at: run.fetched_at, pages: run.pages});
        }
    }
    // Unseeded collections are empty, as their legacy DB reads would be. A static town list is
    // shared metadata; no synthetic current/forecast/air/station response is supplied here.
    docRows['kma.town.short.rss.model'] = decode(rss.answer);
    for (const run of rss.runs) if (rss.outcomes.some(o => o.fetched_at === run.fetched_at && o.outcome === 'saved')) raw.push({family:'rss',fetched_at:run.fetched_at,xml:run.xml});
    for (const k of ['forecast', 'land', 'temp']) docRows['kma.town.mid.' + k + '.model'] = decode(mid.answers.filter(a => a.kind === k).flatMap(a => a.result));
    for (const run of mid.runs) if (mid.outcomes.some(o => o.fetched_at === run.fetched_at && o.outcome === 'saved')) raw.push({family:'mid-'+run.kind,code:run.code,slot:{date:run.tmfc.slice(0,8),time:run.tmfc.slice(8)},fetched_at:run.fetched_at,pages:run.pages});
    const fixture = {place: town, docRows, current: [], shortest: [], short: [], rss: [], zoneRows: []};
    const seedRows = fs.readFileSync(path.join(root, 'server2/src/domestic/kma/source/data/kmastninfos.seed.jsonl'), 'utf8').trim().split('\n').slice(1).map(s => decode(JSON.parse(s)));
    const rich = await require('./collect-rich').collectRich(L, context, RealDate.parse(now), seedRows);
    rich.images = await require('./sections-rich-images').images(L, context, RealDate.parse(now), realGetPixels);
    // KAQ has no supplied raw archive in this corpus. Its actual reader sees empty
    // DB collections, then current legacy applies the stored AirKorea fallback.
    for(const file of ['models/kaq.map.case.model.js','models/kaq.hourly.forecast.model.js']) L.fake.attach(L.load(file));
    const models = {};
    const richRaw = require('./rich-raw').richRaw(rich, RealDate.parse(now));
    const sourceModels = Object.assign({}, docRows, {
        modelAreaNo: decode(rich.area.docs),
        'kma.lifeindex.model': decode(rich.life.docs),
        modelFoodPoisoning: decode(rich.mfds.docs),
        modelKasiRiseSet: decode(rich.kasi.docs)
    });
    for (const [name, docs] of Object.entries(sourceModels)) {
        const file = ['town','modelAreaNo','modelFoodPoisoning','modelKasiRiseSet'].includes(name) ? 'models/'+name+'.js' : 'models/kma/'+name+'.js';
        const Model = L.load(file); L.fake.attach(Model).docs.push(...docs); models[name] = Model;
    }
    const reader = (file,method) => ({reader:(...args)=>L.load(file)[method](...args)});
    function actualReaders() {
        return {stn: reader('controllers/controllerKmaStnWeather.js','getStnHourlyAndMinRns'),
            city_hourly: reader('controllers/controllerKmaStnWeather.js','getCityHourlyList'),
            arpltn: reader('controllers/kecoController.js','getArpLtnInfo'),
            dust_forecast: reader('controllers/kecoController.js','getDustFrcst'),
            rise_set: reader('controllers/kasi.riseset.controller.js','getRiseSetList'),
            history: reader('lib/history/service.js','loadForTown'),
            air_forecast_airkorea: {reader:(stn,cb)=>(new (L.load('controllers/airkorea.hourly.forecast.controller.js'))()).getForecast(stn,cb)},
            air_forecast_kaq: {reader:(stn,cb)=>(new (L.load('controllers/kaq.hourly.forecast.controller.js'))()).getForecast(stn,cb)},
            air_fallback: reader('lib/AQI/airFallback.js','getArpltn'), forecast_zone: []};
    }
    // Keep RealDate's prototype for the Mongoose boundary double's instanceof
    // checks while fixing current time. VM assembly still receives FixedDate.
    function NativeFixedDate(...args) { return new RealDate(...(args.length ? args : [now])); }
    Object.defineProperty(NativeFixedDate, 'name', {value: 'Date'});
    NativeFixedDate.prototype = RealDate.prototype;
    NativeFixedDate.now = () => RealDate.parse(now); NativeFixedDate.UTC = RealDate.UTC; NativeFixedDate.parse = RealDate.parse;
    global.Date = NativeFixedDate;
    // Independently execute current legacy provider parser, budget, cache write and reader
    // from public raw only. The native recovery phase receives its canonical raw record.
    const fallbackBody=JSON.parse(fs.readFileSync(path.join(root,'server2/tests/air/fixtures/google-seoul.json')));
    fallbackBody.dateTime='2026-10-15T13:00:00Z';
    let fallbackProviderCalls=0;
    global.ORACLE_AXIOS_POST=async(url)=>{assert(String(url).startsWith('https://airquality.googleapis.com/v1/currentConditions:lookup?key='));fallbackProviderCalls++;return {status:200,data:fallbackBody};};
    let fallbackCache;
    for(const file of ['models/air.observation.cache.model.js','models/air.provider.usage.model.js','models/worldWeather/vc.usage.model.js','models/worldWeather/vc.fetch.lock.model.js']) {
        const coll=L.fake.attach(L.load(file));if(file.includes('observation.cache'))fallbackCache=coll;
    }
    const fallbackTown=decode(townSection.list.find(t=>t.town.first==='제주특별자치도'&&t.town.second==='제주시'&&t.town.third==='일도1동'));
    await new Promise((resolve,reject)=>L.load('lib/AQI/airFallback.js').getArpltn(fallbackTown.gCoord,new Date(),(err,air)=>err?reject(err):air?resolve():reject(new Error('legacy fallback raw not usable'))));
    assert.strictEqual(fallbackProviderCalls,1);
    const fallbackRaw={provider:'google',lat:fallbackTown.gCoord.lat,lon:fallbackTown.gCoord.lon,fetched_at:RealDate.parse(now),body:JSON.stringify(fallbackBody)};
    overrides=actualReaders();

    const requests = [];
    const base = '/addr/' + [town.town.first, town.town.second, town.town.third].map(encodeURIComponent).join('/');
    const routes = [
        {version:'v000903',file:'routes/v000903/route.kma.v000903.js',mount:'/v000903/kma',suffix:base},
        {version:'v000901',file:'routes/v000901/route.kma.addr.js',mount:'/v000901/kma/addr',suffix:base.slice(5)},
        {version:'v000803',file:'routes/v000803/routeTownForecast.js',mount:'/v000803/town',suffix:base.slice(5)},
        {version:'v000705',file:'routes/v000705/routeTownForecast.js',mount:'/v000705/town',suffix:base.slice(5)}
    ];
    const jobs = [];
    for(const route of routes) for(const lang of ['en','ko']) {
        const variants = route.version==='v000903' ? ['airForecastSource=kaq', 'airForecastSource=kaq&temperatureUnit=F&windSpeedUnit=mph', 'airForecastSource=airkorea', 'airForecastSource=airkorea&temperatureUnit=F&windSpeedUnit=mph'] : [''];
        for(const query of variants) jobs.push({route,lang,query,place:town,id:route.version+'-'+lang+(query.includes('temperatureUnit')?'-units':'')+(query.includes('airForecastSource=airkorea')?'-airkorea':'')});
    }
    for(const [region,city,third,label] of [['인천광역시','중구','신포동','incheon'],['제주특별자치도','제주시','일도1동','jeju']]) {
        const place=decode(townSection.list.find(t=>t.town.first===region&&t.town.second===city&&t.town.third===third));
        assert(place,'regional canonical town '+label);
        for(const lang of ['en','ko']) jobs.push({route:routes[0],lang,query:'airForecastSource=kaq',place,id:'v000903-'+label+'-'+lang});
    }
    for (const job of jobs) {
        const {route,lang,query,place,id} = job;
        const regionalBase='/addr/'+[place.town.first,place.town.second,place.town.third].map(encodeURIComponent).join('/');
        const suffix=route.version==='v000903'?regionalBase:regionalBase.slice(5);
        const harness=makeDomesticHarness();
        const h=harness.createHarness('2.0',{...fixture,place},{oracleRoute:path.join(server,route.file),translate:translate(),config:{readEnabled:true},airModels:models});
        overrides=actualReaders(); calls=[];responded=false;
        const input={path:route.mount+suffix+(query?'?'+query:''),headers:{'accept-language':lang}};
        const res=await wire(appFor(h.router,route.mount),input);
        const recorded=calls;calls=null;
        requests.push({id,path:input.path,lang,status:res.status,headers:Object.fromEntries(Object.entries(res.headers).filter(([k])=>!['date','connection','set-cookie'].includes(k))),body_base64:res.raw.toString('base64'),body_sha256:sha(res.raw),dependency_trace:recorded.map(c=>({method:c.m,args:c.args,error:c.error,result_sha256:sha(Buffer.from(JSON.stringify(c.result===undefined?null:c.result)))}))});
        process.stderr.write('whole-response '+id+' '+res.status+' '+res.raw.length+'\n');
    }
    for (const route of [routes[0],routes[3]]) {
        const prior = requests.find(c => c.id === route.version + '-en');
        for (const method of route.version==='v000903'?['HEAD','conditional']:['HEAD']) {
            if (method === 'conditional' && !prior.headers.etag) continue;
            const harness = makeDomesticHarness();
            const h = harness.createHarness('2.0', fixture, {oracleRoute:path.join(server,route.file),translate:translate(),config:{readEnabled:true},airModels:models});
            calls=[]; responded=false;
            const headers={'accept-language':'en'}; if(method==='conditional') headers['if-none-match']=prior.headers.etag;
            const res=await wire(appFor(h.router,route.mount),{path:prior.path,method:method==='HEAD'?'HEAD':'GET',headers});
            const recorded=calls;calls=null;
            requests.push({id:route.version+'-'+method.toLowerCase(),path:prior.path,lang:'en',method:method==='HEAD'?'HEAD':'GET',if_none_match:method==='conditional'?prior.headers.etag:undefined,status:res.status,
                headers:Object.fromEntries(Object.entries(res.headers).filter(([k])=>!['date','connection','set-cookie'].includes(k))),body_base64:res.raw.toString('base64'),body_sha256:sha(res.raw),dependency_trace:recorded.map(c=>({method:c.m,args:c.args,error:c.error,result_sha256:sha(Buffer.from(JSON.stringify(c.result===undefined?null:c.result)))}))});
        }
    }
    const coordRaw = JSON.parse(fs.readFileSync(path.join(root,'server2/tests/gateway/fixtures/providers.json')))["kakao.coord.seoul"];
    const coordPlace = decode(townSection.list.find(t=>t.town.first==='서울특별시'&&t.town.second==='중구'&&t.town.third==='명동'));
    assert(coordPlace,'coordinate address canonical town');
    const legacyCoordBackends=[];
    for(const query of ['', 'temperatureUnit=F&windSpeedUnit=mph']) {
        const harness=makeDomesticHarness();
        const h=harness.createHarness('2.0',{...fixture,place:coordPlace},{oracleRoute:path.join(server,routes[0].file),translate:translate(),config:{readEnabled:true},airModels:models});
        overrides=actualReaders();calls=null;
        const coordPath='/v000903/kma/coord/37.5663,126.9779'+(query?'?'+query:'');
        const backend=await wire(appFor(h.router,'/v000903/kma'),{path:coordPath,headers:{'accept-language':'ko'}});
        legacyCoordBackends.push({path:coordPath,status:backend.status,body_sha256:sha(backend.raw)});
        let providerCalls=0;
        const geocoder=L.load('lib/geocoder/index.js').createGeocoder({kakaoKeys:['synthetic-offline-kakao'],random:()=>0,now:()=>RealDate.parse(now),
            transport:{getJson:async()=>{providerCalls++;return {status:200,json:true,body:coordRaw};}},log:global.log});
        const gateway=L.load('routes/gateway.js').createGatewayRouter({geocoder:()=>geocoder,log:global.log,
            loopback:async(path,headers)=>{const response=await wire(appFor(h.router,'/v000903/kma'),{path,headers});
                const isJson=String(response.headers['content-type']).includes('application/json');
                return {status:response.status,json:isJson,body:isJson?JSON.parse(response.raw):response.raw.toString()};}});
        const app=express();app.use(cors());app.use(gateway);
        calls=[];responded=false;
        const gatewayPath='/weather/v000903/coord/37.5663,126.9779'+(query?'?'+query:'');
        const response=await wire(app,{path:gatewayPath,headers:{'accept-language':'ko'}});const recorded=calls;calls=null;
        assert.strictEqual(providerCalls,1,'fresh coordinate geocoder reaches one scripted Kakao response');
        requests.push({id:'gateway-v000903-coord-ko'+(query?'-units':''),path:gatewayPath,lang:'ko',coord_provider:true,status:response.status,
            headers:Object.fromEntries(Object.entries(response.headers).filter(([k])=>!['date','connection','set-cookie'].includes(k))),
            body_base64:response.raw.toString('base64'),body_sha256:sha(response.raw),
            legacy_coord_backend:legacyCoordBackends[legacyCoordBackends.length-1],logical_geocoder_lookups:1,scripted_kakao_responses:providerCalls,
            dependency_trace:recorded.map(c=>({method:c.m,args:c.args,error:c.error,result_sha256:sha(Buffer.from(JSON.stringify(c.result===undefined?null:c.result)))}))});
        process.stderr.write('whole-response gateway coord '+response.status+' '+response.raw.length+'\n');
    }
    const helperFiles = Object.fromEntries(fs.readdirSync(__dirname).filter(f => f.endsWith('.js')).sort().map(f => ['server2/tools/golden/kma_s3_rich/' + f, sha(rawRead(path.join(__dirname, f)))]));
    const dependencyFiles = Object.fromEntries(['express','express-session','i18n','body-parser','cookie-parser','cors','mongoose','async','cheerio','iconv-lite','get-pixels','omggif','xml2js'].map(name => [name, sha(rawRead(require.resolve(name + '/package.json')))]));
    const staticSeed = 'server2/src/domestic/kma/source/data/kmastninfos.seed.jsonl';
    const result = {schema: 1, clock: now, rich_inputs: rich, rich_raw: richRaw, coord_provider_raw:coordRaw, air_fallback_raw:fallbackRaw, legacy_air_fallback:{scripted_provider_calls:fallbackProviderCalls,cache_docs:L.fake.ejson(fallbackCache.docs)}, oracle: {node: process.version, mongoose: '5.1.2', express: require('express/package.json').version, tz: process.env.TZ},
        limitations: ['Public synthetic provider bodies processed by current pinned legacy collectors/readers/gateway; no live provider/DB/AWS/Lambda execution.', '23 unique whole-response cases include four direct versions and two actual gateway coordinates; original98 dependency-oracle cases remain separate assembly-only.', 'ASOS deliberately incomplete after QC:173accepted,3rejected; no claim of complete historical coverage.', 'KAQ raw archive absent: explicit kaq requests exercise current legacy stored-AirKorea fallback; valid KAQ rows remain original assembly coverage.'],
        ignored_transport_headers: ['date','connection','set-cookie'], source: {files: Object.fromEntries(Object.entries(sourceFiles).sort()), helper_files: helperFiles, dependency_packages: dependencyFiles, static_inputs: Object.fromEntries([staticSeed,'server2/tools/golden/kma_s3_rich/adaptations.json','server2/tools/golden/kma_s3_rich/package.json','server2/tools/golden/kma_s3_rich/package-lock.json','server2/tests/gateway/fixtures/providers.json','server2/tests/air/fixtures/google-seoul.json','server2/tests/domestic/fixtures/stations.json.gz','server2/tests/domestic/fixtures/air_forecast.json.gz'].map(p=>[p,sha(rawRead(path.join(root,p)))]))}, raw, requests};
    fs.writeFileSync(outFile, zlib.gzipSync(Buffer.from(JSON.stringify(result)), {level: 9, mtime: 0}));
    process.stdout.write(JSON.stringify({requests: requests.length, raw_groups: raw.length, bytes: fs.statSync(outFile).size}) + '\n');
}
runS3Oracle().then(() => process.exit(0), e => { console.error(e.stack); process.exit(1); });
