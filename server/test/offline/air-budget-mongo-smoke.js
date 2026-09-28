/* Real-Mongo smoke for the shared air provider budgets, breaker and observation cache (#2628, #2622).
 * Each "worker" is a separate Node process that loads the real budget/chain/fallback modules and
 * models, connects to one local mongodb-memory-server and, where a provider is called, talks to a
 * loopback fake WAQI over axios. Counters, down markers and cached observations must be visible
 * to the next process. The paid race (D20) starts independent worker processes at one instant, each
 * running concurrent chain requests whose only candidate is paid OpenWeather on a loopback server;
 * the server must see no more requests than the shared monthly paid cap.
 * The service's mongoose 5.1.2 driver cannot talk to mongod >= 5.1 (OP_QUERY removed), so like
 * vc-lock-mongo-smoke.js this runs with mongoose 5.13 (same 5.x model API) against mongod 7.0.14.
 * Run: TZ=UTC NODE_PATH=<mongoose@5.13.22, mongodb-memory-server-core@10.1.4, axios@0.18.1> \
 *      node server/test/offline/air-budget-mongo-smoke.js
 * Optional TW_SMOKE_OUTPUT_DIR selects artifact directory outside the checkout.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');
const {spawn} = require('child_process');
const {createLoader, fixture} = require('./air-harness');
const root = path.resolve(__dirname, '../..');
const TOKEN = 'smoke-token-0000001';
const OWM_KEY = 'smoke-owm-key-00001';
const PAID_CAP = 5, RACE_WORKERS = 6, RACE_PER_WORKER = 4;
const SEOUL = {lat: 37.5665, lon: 126.978};
const T0 = Date.parse('2026-09-27T15:00:00.000Z');

async function worker(args) {
    const [uri, port, nowMs, task, startAt] = [args[0], Number(args[1]), Number(args[2]), args[3], Number(args[4] || 0)];
    const mongoose = require('mongoose');
    const lines = [];
    const log = {};
    ['info', 'warn', 'error', 'debug', 'verbose', 'silly'].forEach(k => { log[k] = (...a) => lines.push(k + ' ' + a.join(' ')); });
    await mongoose.connect(uri, {useNewUrlParser: true, useUnifiedTopology: true});
    const models = {
        'models/air.provider.usage.model.js': require(path.join(root, 'models/air.provider.usage.model.js')),
        'models/air.observation.cache.model.js': require(path.join(root, 'models/air.observation.cache.model.js')),
        'models/worldWeather/vc.usage.model.js': require(path.join(root, 'models/worldWeather/vc.usage.model.js')),
        'models/worldWeather/vc.fetch.lock.model.js': require(path.join(root, 'models/worldWeather/vc.fetch.lock.model.js'))
    };
    for (const m of Object.values(models)) { await m.init(); }
    const axios = require('axios').create();
    axios.interceptors.request.use(c => Object.assign(c, {url: c.url.replace('https://api.waqi.info', 'http://127.0.0.1:' + port)
        .replace('https://api.openweathermap.org', 'http://127.0.0.1:' + port)}));
    const keyString = task === 'paid-race' ? {owm_keys: [{key: OWM_KEY}]} : {aqi_keys: [{key: TOKEN}]};
    const RealDate = Date;
    class FixedDate extends RealDate {
        constructor(...args) { super(...(args.length ? args : [nowMs])); }
        static now() { return nowMs; }
    }
    const l = createLoader({log, globals: {Date: FixedDate}, overrides: Object.assign({
        'config/config.js': {keyString, vc: {dailyRecordLimit: 0}},
        axios
    }, models)});
    const policy = l.load('config/air.js');
    const config = Object.assign({}, policy, {googleMonthlyCap: 4, owmMinuteCap: 60});
    const budget = l.load('lib/air/providerBudget.js').createBudget({config});
    const result = {task};
    const check = (id, phase) => new Promise(r => budget.check(id, phase, 1, r));
    const record = (id, phase, opts) => new Promise(r => budget.record(id, phase, opts || {}, r));
    if (task === 'owm-30') {
        for (let i = 0; i < 30; i++) { await record('openweather', 'free'); }
        result.check = await check('openweather', 'free');
    }
    else if (task === 'owm-check') {
        result.check = await check('openweather', 'free');
    }
    else if (task === 'google-2') {
        for (let i = 0; i < 2; i++) { await record('google', 'free'); }
        result.check = await check('google', 'free');
    }
    else if (task === 'google-check') {
        result.check = await check('google', 'free');
    }
    else if (task === 'google-down') {
        await new Promise(r => budget.markDown('google', 'auth', r));
        result.check = await check('google', 'free');
    }
    else if (task === 'paid-race') {
        // free OpenWeather blocked by a zero cap: every request's only candidate is the paid phase
        const paidConfig = Object.assign({}, config, {paidProvidersEnabled: true, paidMonthlyCallCap: PAID_CAP, owmMonthlyCap: 0, owmMinuteCap: 1000});
        const paidBudget = l.load('lib/air/providerBudget.js').createBudget({config: paidConfig});
        const providers = l.load('lib/air/providers/index.js').byId;
        const chain = l.load('lib/air/providerChain.js').createChain({providers, budget: paidBudget, config: paidConfig, keyString, axios});
        while (RealDate.now() < startAt) { await new Promise(r => setTimeout(r, 5)); }
        result.startedAt = RealDate.now();
        const runs = await Promise.all(Array.from({length: RACE_PER_WORKER}, () => new Promise(r => chain.fetch(SEOUL, new FixedDate(nowMs), r))));
        result.finishedAt = RealDate.now();
        result.runs = runs.map(r => ({outcome: r.outcome, provider: r.provider, attempts: r.attempts, skipped: r.skipped}));
    }
    else if (task === 'fetch') {
        const fallback = l.load('lib/AQI/airFallback.js');
        result.fetch = await new Promise(resolve => fallback.getArpltn(SEOUL, new FixedDate(nowMs), (err, arpltn, reason) => resolve({err: err && err.message, arpltn, reason})));
    }
    result.warnings = lines.filter(x => /^(warn|error)/.test(x));
    await mongoose.disconnect();
    process.stdout.write(JSON.stringify(result));
}

function runWorker(uri, port, nowMs, task, startAt) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [__filename, '--worker', uri, String(port), String(nowMs), task, String(startAt || 0)], {env: process.env, stdio: ['ignore', 'pipe', 'inherit']});
        let out = '';
        child.stdout.on('data', d => { out += d; });
        child.on('exit', code => code === 0 ? resolve(Object.assign(JSON.parse(out), {pid: child.pid})) : reject(new Error('worker exit ' + code + ' task ' + task)));
    });
}

async function main() {
    const {MongoMemoryServer} = require('mongodb-memory-server-core');
    const mongoose = require('mongoose');
    const outputDir = process.env.TW_SMOKE_OUTPUT_DIR || path.join(require('os').tmpdir(), 'air-budget-mongo-smoke-output');
    fs.mkdirSync(outputDir, {recursive: true});
    const feed = fixture('waqi-seoul');
    const requests = [];
    const paidRequests = [];
    const owmFeed = fixture('air/openweather-seoul');
    const server = http.createServer((req, res) => {
        if (req.url.indexOf('/data/2.5/air_pollution') === 0) {
            paidRequests.push(req.url.replace(/appid=.*/, 'appid=<redacted>'));
            res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify(owmFeed));
            return;
        }
        requests.push(req.url.replace(/token=.*/, 'token=<redacted>'));
        const b = JSON.parse(JSON.stringify(feed));
        b.data.time = {iso: new Date(T0 + 9 * 3600000 - 3600000).toISOString().slice(0, 19) + '+09:00'};
        res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify(b));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const mongo = await MongoMemoryServer.create({binary: {version: '7.0.14'}, instance: {ip: '127.0.0.1'}});
    const uri = mongo.getUri('twairsmoke');
    const steps = {};
    try {
        // M2 (AC4): OpenWeather minute cap across processes — 30 + 30 recorded, the 61st is blocked elsewhere.
        steps.owmA = await runWorker(uri, port, T0, 'owm-30');
        assert.deepEqual(steps.owmA.check, {allowed: true}, 'after 30 calls');
        steps.owmB = await runWorker(uri, port, T0 + 5000, 'owm-30');
        assert.deepEqual(steps.owmB.check, {allowed: false, reason: 'minute-cap'}, 'after 60 calls in the minute');
        assert.notEqual(steps.owmA.pid, steps.owmB.pid);
        steps.owmC = await runWorker(uri, port, T0 + 70000, 'owm-check');
        assert.deepEqual(steps.owmC.check, {allowed: true}, 'next minute');
        // M1 (AC4): month counter shared — cap 4 with 5 % reserve: 2 + 2 recorded → blocked in a third process.
        steps.g1 = await runWorker(uri, port, T0, 'google-2');
        assert.deepEqual(steps.g1.check, {allowed: true});
        steps.g2 = await runWorker(uri, port, T0, 'google-2');
        assert.deepEqual(steps.g2.check, {allowed: false, reason: 'free-cap'});
        steps.g3 = await runWorker(uri, port, T0, 'google-check');
        assert.deepEqual(steps.g3.check, {allowed: false, reason: 'free-cap'}, 'third process sees the shared count');
        // M3 (AC5): down marker visible to another process and expired after ten minutes.
        steps.downA = await runWorker(uri, port, T0 + 3600000, 'google-down');   // next hour: month counter irrelevant? no — same month; use paid check below
        assert.deepEqual(steps.downA.check, {allowed: false, reason: 'down'});
        steps.downB = await runWorker(uri, port, T0 + 3600000 + 60000, 'google-check');
        assert.deepEqual(steps.downB.check, {allowed: false, reason: 'down'}, 'another process sees the marker');
        steps.downC = await runWorker(uri, port, T0 + 3600000 + 11 * 60000, 'google-check');
        assert.deepEqual(steps.downC.check, {allowed: false, reason: 'free-cap'}, 'marker expired; the month cap still applies');
        // M4 (AC7/#2622): observation cache across processes.
        steps.fetchA = await runWorker(uri, port, T0, 'fetch');
        assert.equal(steps.fetchA.fetch.arpltn && steps.fetchA.fetch.arpltn.source, 'aqicn', JSON.stringify(steps.fetchA));
        assert.equal(requests.length, 1);
        steps.fetchB = await runWorker(uri, port, T0 + 60000, 'fetch');
        assert.equal(requests.length, 1, 'second process served from Mongo');
        assert.deepEqual(steps.fetchB.fetch.arpltn, steps.fetchA.fetch.arpltn);
        steps.fetchC = await runWorker(uri, port, T0 + 31 * 60000, 'fetch');
        assert.equal(requests.length, 2, 'expired row refetched');
        // M5 (D20): independent workers race for the shared paid monthly cap at one instant.
        const tRace = T0 + 10 * 60000;
        const startAt = Date.now() + 4000;
        const race = await Promise.all(Array.from({length: RACE_WORKERS}, () => runWorker(uri, port, tRace, 'paid-race', startAt)));
        steps.paidRace = race;
        assert.equal(new Set(race.map(w => w.pid)).size, RACE_WORKERS, 'independent processes');
        race.forEach(w => assert(w.startedAt >= startAt, 'worker waited for the start barrier'));
        const runs = [].concat(...race.map(w => w.runs));
        assert.equal(runs.length, RACE_WORKERS * RACE_PER_WORKER);
        const admitted = runs.filter(r => r.attempts.some(a => a.provider === 'openweather' && a.phase === 'paid'));
        const denied = runs.filter(r => r.skipped.some(x => x.provider === 'openweather' && x.phase === 'paid' && x.reason === 'paid-cap'));
        assert(paidRequests.length <= PAID_CAP, 'paid HTTP requests ' + paidRequests.length + ' exceed cap ' + PAID_CAP);
        assert.equal(paidRequests.length, PAID_CAP, 'the whole allowance is used when contenders exceed it');
        assert.equal(admitted.length, paidRequests.length, 'every admitted request made exactly one HTTP call');
        assert.equal(denied.length, runs.length - admitted.length, 'every other request was denied by the paid cap');
        admitted.forEach(r => assert.equal(r.provider, 'openweather', JSON.stringify(r)));
        assert(race.filter(w => w.startedAt < Math.min(...race.map(x => x.finishedAt))).length === RACE_WORKERS, 'all workers started before any finished');

        await mongoose.connect(uri, {useNewUrlParser: true, useUnifiedTopology: true});
        const Usage = require(path.join(root, 'models/air.provider.usage.model.js'));
        const Cache = require(path.join(root, 'models/air.observation.cache.model.js'));
        await Usage.init(); await Cache.init();
        for (const M of [Usage, Cache]) {
            const ttl = (await M.collection.indexes()).find(i => i.key && i.key.expireAt === 1);
            assert(ttl && ttl.expireAfterSeconds === 0, 'TTL index on ' + M.collection.collectionName);
        }
        assert.equal(Usage.collection.collectionName, 'air.provider.usage'); assert.equal(Cache.collection.collectionName, 'air.observation.caches');
        const usageRows = await Usage.find({}).lean();
        const ids = usageRows.map(r => r._id).sort();
        // owm-check in the next minute only reads, so no 15:01 minute document exists
        assert.deepEqual(ids, ['aqicn:m:2026-09', 'google:down', 'google:m:2026-09', 'openweather:m:2026-09', 'openweather:min:2026-09-27T15:00',
            'openweather:min:2026-09-27T15:10', 'openweather:paid:m:2026-09'].sort(), JSON.stringify(ids));
        const paidRow = usageRows.find(r => r._id === 'openweather:paid:m:2026-09');
        assert.equal(paidRow.calls, PAID_CAP, 'reservations only, no double count'); assert.equal(paidRow.failures || 0, 0);
        assert.equal(new Date(paidRow.expireAt).toISOString(), '2026-11-01T00:00:00.000Z');
        assert.equal(usageRows.find(r => r._id === 'openweather:min:2026-09-27T15:10').calls, PAID_CAP);
        assert.equal(usageRows.find(r => r._id === 'openweather:m:2026-09').calls, 60);
        assert.equal(usageRows.find(r => r._id === 'google:m:2026-09').calls, 4);
        const cacheRows = await Cache.find({}).lean();
        assert(!JSON.stringify(cacheRows).includes(TOKEN) && !JSON.stringify(usageRows).includes(TOKEN), 'token not stored');
        assert(![JSON.stringify(steps), JSON.stringify(usageRows)].some(t => t.includes(OWM_KEY)), 'paid key not stored');
        const report = {createdAt: new Date().toISOString(), node: process.version, mongod: '7.0.14', mongoose: require('mongoose/package.json').version,
            axios: require('axios/package.json').version, outcome: 'passed', waqiRequests: requests, paidRace: {cap: PAID_CAP, workers: RACE_WORKERS,
                perWorker: RACE_PER_WORKER, paidRequests: paidRequests.length, admitted: admitted.length, denied: denied.length}, usageRows, cacheRows, steps};
        fs.writeFileSync(path.join(outputDir, 'air-budget-mongo-evidence.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify({outcome: 'passed', workers: Object.keys(steps).length - 1 + RACE_WORKERS, waqiRequests: requests.length,
            paidRace: {cap: PAID_CAP, contenders: runs.length, paidRequests: paidRequests.length, admitted: admitted.length, denied: denied.length}, evidence: path.join(outputDir, 'air-budget-mongo-evidence.json')}, null, 2));
    }
    finally {
        await mongoose.disconnect().catch(() => {});
        await mongo.stop();
        server.close();
    }
}

if (process.argv[2] === '--worker') {
    worker(process.argv.slice(3)).catch(err => { console.error(err.stack); process.exit(1); });
}
else {
    main().catch(err => { console.error(err.stack); process.exitCode = 1; });
}
