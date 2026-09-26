/* Real-MongoDB smoke for the Visual Crossing fetch lock and records (#2585).
 * Real DsfForecast, VcFetchLock and VcUsage models and the real DsfController, converter and
 * _parseData against a mongod; the Visual Crossing requester serves recorded fixtures slowly.
 * The service's mongoose 5.1.2 driver cannot talk to mongod >= 5.1 (OP_QUERY removed), so this
 * runs with mongoose 5.13 (same 5.x model API); a 5.1.2 run needs a mongod <= 5.0.
 * Run: NODE_PATH=<mongoose@5.13.22, async, mongodb-memory-server-core@10.1.4> TZ=UTC \
 *      node server/test/offline/vc-lock-mongo-smoke.js
 * TW_MONGO_URL selects an existing mongod; otherwise mongodb-memory-server starts one
 * (MONGOMS_SYSTEM_BINARY can point it at a local binary).
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const mongoose = require('mongoose');
const server = path.resolve(__dirname, '../..');
const CAPTURED = Date.parse('2026-09-26T07:04:30Z');
let now = CAPTURED;
// Returns real Date instances: mongoose stores a Date subclass in a Mixed path as a number,
// which production (plain Date) never does.
const RealDate = Date;
function Clock(...a) { return a.length ? new RealDate(...a) : new RealDate(now); }
Clock.now = () => now; Clock.parse = RealDate.parse; Clock.UTC = RealDate.UTC; Clock.prototype = RealDate.prototype;
const logs = [];
global.log = Object.fromEntries(['info', 'warn', 'error', 'debug', 'verbose', 'silly'].map(k => [k, (...a) => logs.push(k + ' ' + a.map(String).join(' '))]));
const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'vc-' + name + '.json'), 'utf8'));
const places = {'35.68': 'tokyo', '51.51': 'london', '40.71': 'newyork'};
const calls = [];
let failNext = null;
function SlowRequester() {}
SlowRequester.isValidKey = () => true;
SlowRequester.prototype.getTimeline = function (params, key, cb) {
    calls.push(params.range + ':' + params.lat);
    if (failNext) { const e = failNext; failNext = null; return setTimeout(() => cb(e, undefined, {status: e.statusCode, cost: 0, ms: 5}), 5); }
    const body = fixture(places[String(Number(params.lat))] + '-combined');
    setTimeout(() => cb(null, body, {status: 200, cost: body.queryCost, ms: 300}), 300);
};
const dsfModel = require(path.join(server, 'models/worldWeather/dsf.model'));
const lockModel = require(path.join(server, 'models/worldWeather/vc.fetch.lock.model'));
const usageModel = require(path.join(server, 'models/worldWeather/vc.usage.model'));
function loadController() {
    const module = {exports: {}};
    const deps = {
        'async': require('async'), '../../config/config': {keyString: {vc_key: 'SMOKESYNTHETICKEY0123456789'}, vc: {dailyRecordLimit: 0}},
        '../../models/worldWeather/dsf.model': dsfModel, '../../models/worldWeather/vc.fetch.lock.model': lockModel,
        '../../models/worldWeather/vc.usage.model': usageModel,
        '../../lib/VC/vcRequester': SlowRequester, '../../lib/VC/vcConverter': require(path.join(server, 'lib/VC/vcConverter')),
        '../../lib/kmaTimeLib': require(path.join(server, 'lib/kmaTimeLib'))
    };
    vm.runInNewContext(fs.readFileSync(path.join(server, 'controllers/worldWeather/dsf.controller.js'), 'utf8'),
        {module, exports: module.exports, require: n => { if (!(n in deps)) throw new Error('dep ' + n); return deps[n]; },
            log: global.log, Date: Clock, Intl, setTimeout, clearTimeout, setImmediate, console}, {filename: 'dsf.controller.js'});
    return module.exports;
}
const get = (Controller, gcode, options) => new Promise(resolve => {
    const [lat, lon] = gcode.split(',');   // strings, as getCode() passes them
    const c = new Controller();
    Object.assign(c, options || {});
    c.getDsfData({geocode: {lat, lon}, sessionID: 'mongo-smoke'}, new Clock(), (err, res) => resolve({err, res}));
});
const pause = ms => new Promise(res => setTimeout(res, ms));

(async () => {
    let mms, url = process.env.TW_MONGO_URL;
    if (!url) {
        const {MongoMemoryServer} = require('mongodb-memory-server-core');
        mms = await MongoMemoryServer.create();
        url = mms.getUri();
    }
    const checks = [];
    try {
        await mongoose.connect(url.replace(/\/?$/, '/') + 'vc2585smoke', {useNewUrlParser: true, useUnifiedTopology: true});
        await mongoose.connection.db.dropDatabase();
        await dsfModel.createIndexes(); await lockModel.createIndexes(); await usageModel.createIndexes();
        const ttl = (await mongoose.connection.db.collection('vc.fetch.locks').indexes()).find(i => i.key.expireAt === 1);
        assert(ttl && ttl.expireAfterSeconds === 0, 'TTL index on vc.fetch.locks.expireAt');
        checks.push('ttl index');
        const readIndex = (await mongoose.connection.db.collection(dsfModel.collection.collectionName).indexes()).find(i => i.key.geo === 1 && i.key.dateObj === 1);
        assert(readIndex, 'per-location read index {geo: 1, dateObj: 1}');
        const plan = await dsfModel.find({geo: [139.76, 35.68], dateObj: {$gte: new RealDate(now - 3 * 86400000)}}).explain();
        assert(JSON.stringify(plan).includes('"geo_1_dateObj_1"'), 'the read uses the index');
        checks.push('read index');
        const A = loadController(), B = loadController();

        // Three concurrent requests from two "workers" for one location: one provider call.
        const r = await Promise.all([get(A, '35.68,139.76'), get(B, '35.68,139.76'), get(B, '35.68,139.76')]);
        r.forEach(x => { assert.ifError(x.err); assert.equal(x.res.data.length, 3); });
        assert.deepEqual(calls, ['combined:35.68']);
        await pause(50);
        assert.equal(await lockModel.countDocuments(), 0, 'lock released');
        const stored = await dsfModel.find({geo: ['139.76', '35.68'], dateObj: {$gte: new RealDate(now - 3 * 86400000)}}).lean();
        assert.equal(stored.length, 3, 'string coordinates and the bounded read match the stored numeric geo');
        assert.deepEqual(stored[0].geo, [139.76, 35.68]);
        assert(stored.every(d => d.timeOffset === 540 && d.address.country === 'Asia/Tokyo' && d.dateObj instanceof RealDate));
        const usage = await usageModel.findById(new RealDate(now).toISOString().slice(0, 10)).lean();
        assert.equal(usage.calls, 1); assert.equal(usage.records, 25);
        checks.push('single flight', 'geo cast + bounded read', 'usage counter');

        // Fresh cache: no call. 20 minutes later: forecast only.
        assert.ifError((await get(A, '35.68,139.76')).err);
        assert.equal(calls.length, 1, 'fresh cache');
        now += 20 * 60000;
        assert.ifError((await get(A, '35.68,139.76')).err);
        assert.deepEqual(calls, ['combined:35.68', 'forecast:35.68']);
        checks.push('fresh / forecast refresh');

        // An expired lock left by a crashed worker is taken over.
        await lockModel.create({_id: '-0.13,51.51', expireAt: new RealDate(now - 1000)});
        assert.ifError((await get(A, '51.51,-0.13')).err);
        assert.equal(calls[2], 'combined:51.51');
        await pause(50);
        assert.equal(await lockModel.countDocuments({_id: '-0.13,51.51'}), 0);
        checks.push('takeover');

        // A live lock held elsewhere: the waiter reads nothing and fails without a call.
        await lockModel.create({_id: '-74.01,40.71', expireAt: new RealDate(now + 60000)});
        const waiter = await get(loadController(), '40.71,-74.01', {waitMs: 300, pollMs: 50});
        assert(waiter.err && /in progress/.test(waiter.err.message));
        assert.equal(calls.length, 3, 'no provider call while another worker holds the lock');
        // The holder flags failure: the waiter stops at once.
        await lockModel.updateOne({_id: '-74.01,40.71'}, {$set: {failed: true}});
        const t0 = RealDate.now();
        const early = await get(loadController(), '40.71,-74.01', {waitMs: 3000, pollMs: 50});
        assert(early.err && /failed/.test(early.err.message) && RealDate.now() - t0 < 1000, 'failed flag ends the wait');
        await lockModel.deleteOne({_id: '-74.01,40.71'});
        checks.push('held lock', 'failed flag');

        // A late release by a superseded holder keeps the new holder's lock.
        const X = new (loadController())(), Y = new (loadController())();
        const tokenX = await new Promise(res => X._acquireLock('f3', (e, t) => res(t)));
        now += 11000;
        const tokenY = await new Promise(res => Y._acquireLock('f3', (e, t) => res(t)));
        assert(tokenX && tokenY, 'both acquisitions (second by takeover)');
        X._releaseLock('f3', tokenX);
        await pause(100);
        assert.equal(await lockModel.countDocuments({_id: 'f3'}), 1, 'late release keeps the new holder lock');
        Y._releaseLock('f3', tokenY);
        await pause(100);
        assert.equal(await lockModel.countDocuments({_id: 'f3'}), 0, 'owner release deletes');
        checks.push('owner-token release');

        // A daily-limit failure: backoff flag on the location, provider marked down, no further call.
        failNext = Object.assign(new Error('VC> HTTP 429: daily limit'), {statusCode: 429, providerDown: true});
        now += 60 * 60000;
        const down = await get(A, '40.71,-74.01');
        assert(down.err, 'nothing stored for New York');
        await pause(100);
        const lock = await lockModel.findById('-74.01,40.71').lean();
        assert(lock && lock.failed === true && lock.expireAt.getTime() - now <= 2000 && lock.expireAt.getTime() - now >= 1900, 'backoff: failed flag, 2 s');
        const marker = await lockModel.findById('~provider').lean();
        assert(marker && marker.expireAt.getTime() - now > 9 * 60000, 'provider marked down for 10 min');
        const before = calls.length;
        now += 60000;
        const tokyo = await get(A, '35.68,139.76');
        assert.ifError(tokyo.err, 'stale Tokyo current (1 h 1 min old) served while the provider is down');
        assert.equal(calls.length, before, 'no provider call while marked down');
        // A waiter behind a live lock is served the stored stale Tokyo records.
        await lockModel.create({_id: '139.76,35.68', expireAt: new RealDate(now + 60000)});
        const staleWaiter = await get(loadController(), '35.68,139.76', {waitMs: 200, pollMs: 50});
        assert.ifError(staleWaiter.err, 'waiter served stale data');
        await lockModel.deleteOne({_id: '139.76,35.68'});
        checks.push('backoff', 'provider marker', 'stale fallback', 'stale waiter');

        const evidence = {createdAt: new RealDate().toISOString(), mongoose: require('mongoose/package.json').version,
            server: (await mongoose.connection.db.admin().serverInfo()).version, outcome: 'passed', checks, providerCalls: calls,
            warnings: logs.filter(l => /^(warn|error)/.test(l)).map(l => l.slice(0, 160))};
        console.log(JSON.stringify(evidence, null, 2));
    }
    finally {
        await mongoose.disconnect();
        if (mms) await mms.stop();
    }
})().catch(e => { console.error(logs.filter(l => /^(warn|error)/.test(l)).slice(-8).join('\n')); console.error(e.stack); process.exitCode = 1; });
