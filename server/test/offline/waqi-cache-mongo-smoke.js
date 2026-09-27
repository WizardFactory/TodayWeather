/* Real-Mongo smoke for the shared WAQI air cache (#2622).
 * Each "worker" is a separate Node process that loads the real waqiAirFallback module and cache
 * model, connects to one local mongodb-memory-server and calls a loopback fake WAQI feed over axios.
 * A second request from another process must be served from Mongo without calling WAQI.
 * The service's mongoose 5.1.2 driver cannot talk to mongod >= 5.1 (OP_QUERY removed), so like
 * vc-lock-mongo-smoke.js this runs with mongoose 5.13 (same 5.x model API) against mongod 7.0.14.
 * Run: TZ=UTC NODE_PATH=<mongoose@5.13.22, mongodb-memory-server-core@10.1.4, axios@0.18.1> \
 *      node server/test/offline/waqi-cache-mongo-smoke.js
 * Optional TW_SMOKE_OUTPUT_DIR selects artifact directory outside the checkout.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const assert = require('assert');
const {spawn} = require('child_process');
const root = path.resolve(__dirname, '../..');
const TOKEN = 'smoke-token';
const SEOUL = {lat: 37.5665, lon: 126.978};
const BUSAN = {lat: 35.1796, lon: 129.0756};
const T0 = Date.parse('2026-09-27T15:00:00.000Z');

async function worker(uri, port, nowMs, lat, lon) {
    const mongoose = require('mongoose');
    const log = {};
    ['info', 'warn', 'error', 'debug', 'verbose', 'silly'].forEach(k => { log[k] = () => {}; });
    global.log = log;
    await mongoose.connect(uri, {useNewUrlParser: true, useUnifiedTopology: true});
    const Model = require(path.join(root, 'models/waqi.air.cache.model.js'));
    await Model.init();
    const axios = require('axios').create();
    axios.interceptors.request.use(c => Object.assign(c, {url: c.url.replace('https://api.waqi.info', 'http://127.0.0.1:' + port)}));
    const RealDate = Date;
    class FixedDate extends RealDate {
        constructor(...args) { super(...(args.length ? args : [nowMs])); }
        static now() { return nowMs; }
    }
    const deps = {
        '../../config/config': {keyString: {aqi_keys: [{key: TOKEN}]}},
        '../aqi.converter': require(path.join(root, 'lib/aqi.converter.js')),
        './waqiStationName': require(path.join(root, 'lib/AQI/waqiStationName.js')),
        '../../models/waqi.air.cache.model': Model, axios
    };
    const module = {exports: {}};
    vm.runInNewContext(fs.readFileSync(path.join(root, 'lib/AQI/waqiAirFallback.js'), 'utf8'),
        {module, exports: module.exports, require: id => deps[id], log, Date: FixedDate, setImmediate, console},
        {filename: 'waqiAirFallback.js'});
    const result = await new Promise(resolve => module.exports.getArpltn({lat, lon}, new FixedDate(nowMs),
        (err, arpltn, reason) => resolve({err: err && err.message, arpltn, reason})));
    // The cache write is fire-and-forget; wait until this worker's row is visible before exiting.
    const cell = lat.toFixed(2) + ',' + lon.toFixed(2);
    for (let i = 0; i < 50; i++) {
        const row = await Model.findById(cell).lean();
        if (row && new Date(row.fetchedAt).getTime() <= nowMs && new Date(row.expireAt).getTime() > nowMs) { break; }
        await new Promise(r => setTimeout(r, 40));
    }
    await mongoose.disconnect();
    process.stdout.write(JSON.stringify(result));
}

function runWorker(uri, port, nowMs, point) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [__filename, '--worker', uri, String(port), String(nowMs), String(point.lat), String(point.lon)],
            {env: process.env, stdio: ['ignore', 'pipe', 'inherit']});
        let out = '';
        child.stdout.on('data', d => { out += d; });
        child.on('exit', code => code === 0 ? resolve(Object.assign(JSON.parse(out), {pid: child.pid})) : reject(new Error('worker exit ' + code)));
    });
}

async function main() {
    const {MongoMemoryServer} = require('mongodb-memory-server-core');
    const mongoose = require('mongoose');
    const outputDir = process.env.TW_SMOKE_OUTPUT_DIR || path.join(require('os').tmpdir(), 'waqi-cache-mongo-smoke-output');
    fs.mkdirSync(outputDir, {recursive: true});
    const feed = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'waqi-seoul.json'), 'utf8'));
    const provider = {mode: 'ok', requests: []};
    const server = http.createServer((req, res) => {
        provider.requests.push({path: req.url.replace(/token=.*/, 'token=<redacted>'), mode: provider.mode});
        const body = JSON.parse(JSON.stringify(feed));
        body.data.time = {iso: new Date(T0 + 9 * 3600000 - 3600000).toISOString().slice(0, 19) + '+09:00'};
        res.writeHead(provider.mode === 'http500' ? 500 : 200, {'content-type': 'application/json'});
        res.end(JSON.stringify(provider.mode === 'http500' ? {status: 'error'} : body));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const mongo = await MongoMemoryServer.create({binary: {version: '7.0.14'}, instance: {ip: '127.0.0.1'}});
    const uri = mongo.getUri('twsmoke');
    const steps = [];
    try {
        const count = () => provider.requests.length;
        const a = await runWorker(uri, port, T0, SEOUL);
        assert.equal(a.arpltn && a.arpltn.source, 'aqicn', 'worker A gets the WAQI observation');
        assert.equal(count(), 1);
        const b = await runWorker(uri, port, T0 + 60000, SEOUL);
        assert.equal(count(), 1, 'worker B (another process) is served from Mongo');
        assert.deepEqual(b.arpltn, a.arpltn);
        assert.notEqual(b.pid, a.pid);
        const c = await runWorker(uri, port, T0 + 31 * 60000, SEOUL);
        assert.equal(count(), 2, 'expired row (30 min) is refetched');
        assert.equal(c.arpltn.source, 'aqicn');
        provider.mode = 'http500';
        const d = await runWorker(uri, port, T0, BUSAN);
        assert.equal(d.arpltn, undefined); assert.equal(d.reason, 'http-500'); assert.equal(count(), 3);
        provider.mode = 'ok';
        const e = await runWorker(uri, port, T0 + 60000, BUSAN);
        assert.equal(e.reason, 'http-500', 'recent failure reused by another process'); assert.equal(count(), 3);
        const f = await runWorker(uri, port, T0 + 3 * 60000, BUSAN);
        assert.equal(count(), 4, 'failure row expires after 2 min');
        assert.equal(f.reason, 'too-far', 'Busan cell receives the Seoul fixture station, rejected by distance');
        steps.push({a, b, c, d, e, f});

        await mongoose.connect(uri, {useNewUrlParser: true, useUnifiedTopology: true});
        const Model = require(path.join(root, 'models/waqi.air.cache.model.js'));
        await Model.init();
        const indexes = await Model.collection.indexes();
        const ttl = indexes.find(i => i.key && i.key.expireAt === 1);
        assert(ttl && ttl.expireAfterSeconds === 0, 'TTL index on expireAt');
        assert.equal(Model.collection.collectionName, 'waqi.air.caches');
        const rows = await Model.find({}).lean();
        assert.deepEqual(rows.map(r => r._id).sort(), ['35.18,129.08', '37.57,126.98']);
        assert(!JSON.stringify(rows).includes(TOKEN), 'token not stored');
        const report = {createdAt: new Date().toISOString(), node: process.version, mongod: '7.0.14', mongoose: require('mongoose/package.json').version,
            axios: require('axios/package.json').version, outcome: 'passed', waqiRequests: provider.requests, indexes, rows, workers: steps[0]};
        fs.writeFileSync(path.join(outputDir, 'waqi-cache-mongo-evidence.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify({outcome: 'passed', waqiRequests: provider.requests.length, workers: 6,
            evidence: path.join(outputDir, 'waqi-cache-mongo-evidence.json')}, null, 2));
    }
    finally {
        await mongoose.disconnect().catch(() => {});
        await mongo.stop();
        server.close();
    }
}

if (process.argv[2] === '--worker') {
    const [uri, port, nowMs, lat, lon] = process.argv.slice(3);
    worker(uri, Number(port), Number(nowMs), Number(lat), Number(lon)).catch(err => { console.error(err.stack); process.exit(1); });
}
else {
    main().catch(err => { console.error(err.stack); process.exitCode = 1; });
}
