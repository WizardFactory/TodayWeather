'use strict';
// #2604: data.go.kr quota/auth rejections stop the forecast walk and rotate keys.
// All provider data is SYNTHETIC. The collector and the Manager run in a VM with
// every dependency stubbed; HTTP is an in-memory stub, no timer or network is used.
// Usage: node server/test/offline/gather-quota.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const util = require('util');
const vm = require('vm');
const h = require('./harness');
const gather = require('../../config/gather');

const root = path.resolve(__dirname, '../..');
const KEY_A = 'OFFLINE_KEY_A_2604_xxxxxxxxxxxx';
const KEY_B = 'OFFLINE_KEY_B_2604_yyyyyyyyyyyy';
const QUOTA_BODY = '<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg>' +
    '<returnAuthMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</returnAuthMsg>' +
    '<returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>';
const AUTH_BODY = QUOTA_BODY.replace('LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR', 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR')
    .replace('<returnReasonCode>22<', '<returnReasonCode>30<');
const NO_DATA_BODY = '<response><header><resultCode>03</resultCode><resultMsg>NO_DATA</resultMsg></header></response>';
const OK_BODY = h.xml(h.response(h.shortItems()));

function leveled(lines) {
    const log = {};
    ['debug', 'info', 'warn', 'error', 'verbose', 'silly'].forEach(level => {
        log[level] = function () { lines.push({level, text: util.format.apply(util, arguments)}); };
    });
    return log;
}

// Collector with an HTTP stub that queues requests until the test answers them.
function deferredCollector() {
    const pending = [];
    const lines = [];
    const stats = {requests: 0, maxInFlight: 0};
    const Collector = h.load('lib/collectTownForecast.js', {
        './midForecastPolicy': require('../../lib/midForecastPolicy'),
        './kmaPrecipitation': h.optional('../../lib/kmaPrecipitation'),
        './dataGoKrRejection': h.optional('../../lib/dataGoKrRejection'),
        events: require('events'), xml2js: require('xml2js'), dnscache: function () {},
        request: {get: function (url, options, callback) {
            stats.requests++;
            pending.push({url, callback});
            stats.maxInFlight = Math.max(stats.maxInFlight, pending.length);
        }}
    }, {log: leveled(lines)});
    const c = new Collector();
    function answer(entry, status, body, error) {
        pending.splice(pending.indexOf(entry), 1);
        entry.callback(error || null, status === null ? undefined : {statusCode: status}, body);
    }
    return {c, pending, lines, stats, answer};
}

function grids(n) { return Array.from({length: n}, (v, i) => ({mx: 60 + (i % 100), my: 100 + Math.floor(i / 100)})); }

function run(t, list, respond) {
    let calls = 0, failed, results;
    t.c.requestData(list, t.c.DATA_TYPE.TOWN_SHORT, KEY_A, '20260926', '0800', function (err, res) {
        calls++; failed = err; results = res;
    });
    while (t.pending.length) {
        const batch = t.pending.slice();
        batch.forEach((entry, i) => respond(entry, i));
    }
    return {calls, failed, results};
}

const tests = [];
function test(name, fn) { tests.push({name, fn}); }

// ---- AC1: bounded walk over the whole list ----

test('AC1 walks 2,032 grids in one pass with at most 101 requests in flight', () => {
    const t = deferredCollector();
    const r = run(t, grids(2032), entry => t.answer(entry, 200, OK_BODY));
    assert.strictEqual(r.calls, 1);
    assert.strictEqual(r.failed, false);
    assert.strictEqual(t.stats.requests, 2032);
    assert.strictEqual(t.stats.maxInFlight, 101);
    assert.strictEqual(r.results.filter(item => item.isCompleted).length, 2032);
});

test('AC1 honours a configured concurrency', () => {
    const t = deferredCollector();
    t.c.concurrency = 5;
    const r = run(t, grids(40), entry => t.answer(entry, 200, OK_BODY));
    assert.strictEqual(r.calls, 1);
    assert.strictEqual(t.stats.requests, 40);
    assert.strictEqual(t.stats.maxInFlight, 5);
});

test('AC1 synchronous responses complete 2,032 grids without deep recursion', () => {
    let requests = 0, calls = 0, results;
    const c = h.collector({get: function (url, options, callback) { requests++; callback(null, {statusCode: 200}, OK_BODY); }});
    c.requestData(grids(2032), c.DATA_TYPE.TOWN_SHORT, KEY_A, '20260926', '0800', function (err, res) {
        calls++; results = res; assert.strictEqual(err, false);
    });
    assert.strictEqual(calls, 1);
    assert.strictEqual(requests, 2032);
    assert.strictEqual(results.filter(item => item.isCompleted).length, 2032);
});

// ---- AC2: quota/auth stop ----

[
    ['HTTP 429 quota body', 429, QUOTA_BODY, 'quota'],
    ['HTTP 200 code 22 body', 200, QUOTA_BODY, 'quota'],
    ['HTTP 200 API resultCode 22', 200, '<response><header><resultCode>22</resultCode></header></response>', 'quota'],
    ['HTTP 401', 401, 'Unauthorized', 'auth'],
    ['HTTP 403 code 30 body', 403, AUTH_BODY, 'auth'],
    ['HTTP 200 code 30 body', 200, AUTH_BODY, 'auth']
].forEach(([name, status, body, reason]) => {
    test('AC2 ' + name + ' stops new requests and settles in-flight ones (' + reason + ')', () => {
        const t = deferredCollector();
        let first = true;
        const r = run(t, grids(2032), entry => {
            if (first) { first = false; return t.answer(entry, status, body); }
            t.answer(entry, 200, OK_BODY);
        });
        assert.strictEqual(r.calls, 1, 'completion callback exactly once');
        assert.strictEqual(r.failed, true);
        assert.strictEqual(t.stats.requests, 101, 'no request after the rejection');
        assert.strictEqual(t.c.stopReason, reason);
        assert.strictEqual(r.results.filter(item => item.isCompleted).length, 100);
        assert.strictEqual(r.results.length, 2032);
        const warns = t.lines.filter(line => line.level === 'warn');
        assert.strictEqual(warns.length, 0, 'no per-request warning for ' + reason);
        assert(!t.lines.some(line => line.text.includes(KEY_A)));
    });
});

test('AC2 a rejection on a continuation page also stops the walk', () => {
    const t = deferredCollector();
    t.c.concurrency = 1;
    const big = h.shortProduct();
    let answered = 0;
    const r = run(t, grids(3), entry => {
        answered++;
        const page = Number(new URL(entry.url).searchParams.get('pageNo'));
        if (page === 2) { return t.answer(entry, 429, QUOTA_BODY); }
        const size = Number(new URL(entry.url).searchParams.get('numOfRows'));
        const res = h.response(big.slice((page - 1) * size, page * size));
        res.response.body[0].totalCount = [String(big.length)];
        t.answer(entry, 200, h.xml(res));
    });
    assert.strictEqual(r.calls, 1);
    assert.strictEqual(t.c.stopReason, 'quota');
    assert.strictEqual(answered, 2, 'page 1 and page 2 of the first grid only');
    assert.strictEqual(r.results.filter(item => item.isCompleted).length, 0);
});

test('AC2 a collector retry scheduled before a stop fails at once instead of requesting (PR review 5329215929)', () => {
    const timers = [];
    const pending = [];
    let requests = 0;
    const Collector = h.load('lib/collectTownForecast.js', {
        './midForecastPolicy': require('../../lib/midForecastPolicy'),
        './kmaPrecipitation': h.optional('../../lib/kmaPrecipitation'),
        './dataGoKrRejection': h.optional('../../lib/dataGoKrRejection'),
        events: require('events'), xml2js: require('xml2js'), dnscache: function () {},
        request: {get: function (url, options, callback) { requests++; pending.push(callback); }}
    }, {log: leveled([]), setTimeout: fn => { timers.push(fn); }});
    const c = new Collector({retryCount: 1});
    let calls = 0, results;
    c.requestData(grids(2), c.DATA_TYPE.TOWN_SHORT, KEY_A, '20260926', '0800', (err, res) => { calls++; results = res; });
    assert.strictEqual(requests, 2);
    pending.shift()(null, {statusCode: 500}, OK_BODY);
    assert.strictEqual(timers.length, 1, 'collector-level retry scheduled for grid 0');
    pending.shift()(null, {statusCode: 429}, QUOTA_BODY);
    assert.strictEqual(c.stopReason, 'quota');
    assert.strictEqual(calls, 0, 'grid 0 is still pending on its retry timer');
    timers.shift()();
    assert.strictEqual(requests, 2, 'no request with the rejected key after the stop');
    assert.strictEqual(calls, 1);
    assert.strictEqual(results.filter(item => item.isCompleted).length, 0);
});

// ---- AC4: other failures keep their behaviour ----

[
    ['HTTP 500', 500, OK_BODY, null, false],
    ['resultCode 03', 200, NO_DATA_BODY, null, false],
    ['transport error', null, '', Object.assign(new Error('socket hang up ?serviceKey=' + KEY_A), {code: 'ECONNRESET'}), false],
    ['invalid XML', 200, '<response><', null, false],
    ['HTTP 400', 400, 'Bad Request', null, true],
    ['HTTP 404', 404, 'Not Found', null, true]
].forEach(([name, status, body, error, rejected]) => {
    test('AC4 ' + name + ' does not stop the walk' + (rejected ? ' and is not retryable' : ' and stays retryable'), () => {
        const t = deferredCollector();
        t.c.concurrency = 2;
        const r = run(t, grids(6), (entry, i) => {
            if (entry.url.includes('nx=60&')) { return t.answer(entry, status, body, error); }
            t.answer(entry, 200, OK_BODY);
        });
        assert.strictEqual(r.calls, 1);
        assert.strictEqual(r.failed, true);
        assert.strictEqual(t.stats.requests, 6);
        assert.strictEqual(t.c.stopReason, undefined);
        assert.strictEqual(r.results[0].isCompleted, false);
        assert.strictEqual(!!r.results[0].rejected, rejected);
        assert.strictEqual(r.results.filter(item => item.isCompleted).length, 5);
        assert.strictEqual(t.lines.filter(line => line.level === 'warn').length, 1, 'one warning for the failed grid');
        assert(!t.lines.some(line => line.text.includes(KEY_A)));
    });
});

// ---- Shared classification (R1) ----

test('R1 shared classifier keeps the warning requester precedence', () => {
    const rejection = require('../../lib/dataGoKrRejection');
    assert.strictEqual(rejection.code(QUOTA_BODY), '22');
    assert.strictEqual(rejection.code('<response><header><resultCode>00</resultCode></header></response>'), '00');
    assert.strictEqual(rejection.code('plain text'), undefined);
    assert.strictEqual(rejection.code(undefined), undefined);
    assert.strictEqual(rejection.isQuota(429, undefined), true);
    assert.strictEqual(rejection.isQuota(200, '22'), true);
    assert.strictEqual(rejection.isQuota(200, '03'), false);
    ['20', '30', '31', '32'].forEach(code => assert.strictEqual(rejection.isAuth(200, code), true, code));
    assert.strictEqual(rejection.isAuth(401, undefined), true);
    assert.strictEqual(rejection.isAuth(403, '22'), true, 'both flags can hold, as in kmaWarningRequester');
    assert.strictEqual(rejection.isAuth(500, '01'), false);
});

// ---- AC3/AC5: Manager rotation ----

function loadManager(keys, policy, lines, RealCollector) {
    const filename = path.join(root, 'controllers/controllerManager.js');
    const code = fs.readFileSync(filename, 'utf8');
    const deps = {};
    for (const m of code.matchAll(/require\('([^']+)'\)/g)) {
        deps[m[1]] = function Unexpected() { throw new Error('Unexpected collaborator ' + m[1]); };
        if (/^\.\/kma\/kma\.town\.|midRssKmaRequester|kecoRequester|lifeIndexKmaRequester/.test(m[1])) {
            deps[m[1]] = function Inert() { this.remove = () => {}; };
        }
    }
    const calls = [];
    function Collector() { calls.push({collector: this}); }
    Collector.prototype.requestData = function (list, type, key, date, time, cb) {
        const call = calls[calls.length - 1];
        Object.assign(call, {list, type, key, concurrency: this.concurrency});
        const outcome = Collector.behaviour(key, list, calls.length);
        this.stopReason = outcome.stopReason;
        cb(true, list.map((mCoord, i) => ({
            mCoord, isCompleted: outcome.completed(i), rejected: outcome.rejected ? outcome.rejected(i) : undefined, data: [{mCoord}]
        })));
    };
    Object.assign(deps, {
        '../config/config': {db: {version: '2.0'}, keyString: {dongnae_forecast_keys: JSON.stringify(keys)}, history: {enabled: false}},
        '../config/gather': policy, async: require('async'), '../lib/collectTownForecast': RealCollector || Collector,
        '../lib/forecastTraffic': require('../../lib/forecastTraffic')
    });
    const module = {exports: {}};
    vm.runInNewContext(code, Object.assign({
        module, exports: module.exports, Date, JSON, Math, Promise, Error,
        require: name => {
            if (/(?:^|\/)dataGoKrKeys$/.test(name)) return require('../../lib/dataGoKrKeys');
            if (/(?:^|\/)dataGoKrRejection$/.test(name)) return require('../../lib/dataGoKrRejection');
            if (!Object.prototype.hasOwnProperty.call(deps, name)) { throw new Error('Unstubbed dependency: ' + name); }
            return deps[name];
        },
        setTimeout: fn => fn(),
        log: leveled(lines)
    }), {filename});
    const Manager = module.exports;
    const m = Object.create(Manager.prototype);
    m.getDataTypeName = type => 'TYPE' + type;
    m.saved = [];
    m.getSaveFunc = () => function (data, cb) { m.saved.push(data[0].mCoord); cb(); };
    return {m, calls, Collector};
}

function cycle(env, type, list) {
    let result, count = 0;
    env.m._recursiveRequestData(list, type, 'passed-key', {date: '20260926', time: '0800'}, 3, undefined, function (err) {
        count++; result = err;
    });
    assert.strictEqual(count, 1, 'cycle callback exactly once');
    return result;
}

const TOWN_SHORTEST = 1;
const MID_LAND = 4;

test('AC3 a quota stop on the first key re-requests only uncollected grids with the second key', () => {
    const lines = [];
    const env = loadManager([KEY_A, KEY_B], gather.load({}), lines);
    env.Collector.behaviour = key => key === KEY_A
        ? {stopReason: 'quota', completed: i => i < 3}
        : {completed: () => true};
    const list = grids(10);
    const err = cycle(env, TOWN_SHORTEST, list);
    assert.ifError(err);
    assert.deepStrictEqual(env.calls.map(c => c.key), [KEY_A, KEY_B]);
    assert.deepStrictEqual(Array.from(env.calls[1].list), list.slice(3));
    assert.strictEqual(env.m.saved.length, 10);
    assert.strictEqual(env.calls[0].concurrency, 101);
    const warns = lines.filter(line => line.level === 'warn');
    assert.strictEqual(warns.length, 1);
    assert.match(warns[0].text, /reason=quota/);
    assert.match(warns[0].text, /pending=7/);
    assert.match(warns[0].text, /keyIndex=0/);
    assert(!lines.some(line => line.text.includes(KEY_A) || line.text.includes(KEY_B)));
    // The choice sticks for the next cycle of the same service; the mid service keeps its own key.
    env.Collector.behaviour = () => ({completed: () => true});
    assert.ifError(cycle(env, TOWN_SHORTEST, grids(2)));
    assert.strictEqual(env.calls[2].key, KEY_B);
    assert.ifError(cycle(env, MID_LAND, [{code: '11B00000'}]));
    assert.strictEqual(env.calls[3].key, KEY_A);
});

test('AC3 every key rejected ends the cycle with an error and no retry pass', () => {
    const lines = [];
    const env = loadManager([KEY_A, KEY_B], gather.load({}), lines);
    env.Collector.behaviour = key => ({stopReason: key === KEY_A ? 'quota' : 'auth', completed: () => false});
    const err = cycle(env, TOWN_SHORTEST, grids(10));
    assert(err instanceof Error);
    assert.match(err.message, /auth/);
    assert.deepStrictEqual(env.calls.map(c => c.key), [KEY_A, KEY_B]);
    assert.strictEqual(lines.filter(line => line.level === 'warn').length, 2, 'one summary per stop');
});

test('AC2 one key: a quota stop ends the cycle after one request pass', () => {
    const lines = [];
    const env = loadManager([KEY_A], gather.load({GATHER_TOWN_RETRY: '180'}), lines);
    env.Collector.behaviour = () => ({stopReason: 'quota', completed: i => i === 0});
    const err = cycle(env, TOWN_SHORTEST, grids(2032));
    assert.match(err.message, /quota/);
    assert.strictEqual(env.calls.length, 1);
    assert.strictEqual(env.m.saved.length, 1);
});

test('AC4 rejected grids are not retried; other failures are', () => {
    const lines = [];
    const env = loadManager([KEY_A], gather.load({}), lines);
    env.Collector.behaviour = (key, list, n) => n === 1
        ? {completed: i => i > 1, rejected: i => i === 0}
        : {completed: () => true};
    const list = grids(5);
    assert.ifError(cycle(env, TOWN_SHORTEST, list));
    assert.strictEqual(env.calls.length, 2);
    assert.deepStrictEqual(Array.from(env.calls[1].list), [list[1]]);
    assert(lines.some(line => line.level === 'warn' && /rejected=1/.test(line.text)));
});

test('AC5 retry passes log one line per pass instead of one line per grid', () => {
    const lines = [];
    const env = loadManager([KEY_A], gather.load({}), lines);
    env.Collector.behaviour = (key, list, n) => ({completed: () => n > 1});
    assert.ifError(cycle(env, TOWN_SHORTEST, grids(50)));
    assert.strictEqual(lines.filter(line => line.level === 'verbose').length, 1);
});

// Independent verification F1: a failure on every grid that is not a quota/key rejection
// (e.g. resultCode 03 before publication) must not multiply the request volume.
function realCollectorClass(respond, counter) {
    return h.load('lib/collectTownForecast.js', {
        './midForecastPolicy': require('../../lib/midForecastPolicy'),
        './kmaPrecipitation': h.optional('../../lib/kmaPrecipitation'),
        './dataGoKrRejection': h.optional('../../lib/dataGoKrRejection'),
        events: require('events'), xml2js: require('xml2js'), dnscache: function () {},
        request: {get: function (url, options, callback) { counter.requests++; respond(url, callback, counter.requests); }}
    }, {log: leveled([])});
}

[['70', 70], ['180', 180]].forEach(([env, retry]) => {
    test('F1 persistent resultCode 03 on 2,032 grids sends at most N + (retry - 1) x 101 requests (retry ' + retry + ')', () => {
        const counter = {requests: 0};
        const Real = realCollectorClass((url, cb) => cb(null, {statusCode: 200}, NO_DATA_BODY), counter);
        const env2 = loadManager([KEY_A, KEY_B], gather.load({GATHER_TOWN_RETRY: env}), [], Real);
        env2.m.getSaveFunc = () => (data, cb) => cb();
        let result, calls = 0;
        env2.m._recursiveRequestData(grids(2032), TOWN_SHORTEST, 'k', {date: '20260926', time: '0800'}, retry, undefined,
            err => { calls++; result = err; });
        assert.strictEqual(calls, 1);
        assert.match(result.message, /retryCount is zero/);
        assert.strictEqual(counter.requests, 2032 + (retry - 1) * 101);
        assert(counter.requests <= retry * 101 + 2032, 'bounded near the former retry x 101');
    });
});

test('F1 transient failures are still retried to full coverage in bounded passes', () => {
    const counter = {requests: 0};
    // The first 300 requests answer 03 (not yet published), later ones succeed.
    const Real = realCollectorClass((url, cb, n) => cb(null, {statusCode: 200}, n <= 300 ? NO_DATA_BODY : OK_BODY), counter);
    const env2 = loadManager([KEY_A], gather.load({}), [], Real);
    const saved = [];
    env2.m.getSaveFunc = () => (data, cb) => { saved.push(data); cb(); };
    let result = 'pending';
    env2.m._recursiveRequestData(grids(2032), 2 /* TOWN_SHORT */, 'k', {date: '20260926', time: '0800'}, 4, undefined,
        err => { result = err; });
    assert.notStrictEqual(result, 'pending');
    assert.ifError(result);
    assert.strictEqual(saved.length, 2032);
    assert.strictEqual(counter.requests, 2032 + 300);
});

test('R6 GATHER_REQUEST_CONCURRENCY reaches the collector', () => {
    const p = gather.load({GATHER_REQUEST_CONCURRENCY: '21'});
    assert.strictEqual(p.requestConcurrency, 21);
    assert.strictEqual(gather.load({}).requestConcurrency, 101);
    assert.throws(() => gather.load({GATHER_REQUEST_CONCURRENCY: '0'}), /GATHER_REQUEST_CONCURRENCY/);
    const env = loadManager([KEY_A], p, []);
    env.Collector.behaviour = () => ({completed: () => true});
    assert.ifError(cycle(env, TOWN_SHORTEST, grids(1)));
    assert.strictEqual(env.calls[0].concurrency, 21);
});

// Actual gather entrypoints, distinct from the scheduled-cycle helper.
test('R2618-2 direct-grid forecast rotates configured keys, terminates exhaustion/empty list', () => {
    for (const kind of ['current', 'shortest', 'short']) {
        for (const list of [[KEY_A, KEY_B], []]) {
            for (const rejectAll of [false, true]) {
                const env = loadManager(list, gather.load({}), []);
                Object.assign(env.Collector.prototype, {
                    DATA_TYPE: {TOWN_CURRENT: 2, TOWN_SHORTEST: 1, TOWN_SHORT: 0},
                    resetResult() {this.resultList = [{data: [{mCoord: this.srcList[0], pubDate: '202609260800'}]}];},
                    getUrl(type, key) {this.testKey = key; return 'synthetic';},
                    getData(index, type, url, options, cb) {
                        env.calls[env.calls.length - 1].key = this.testKey;
                        this.stopReason = rejectAll || this.testKey === KEY_A ? 'quota' : undefined;
                        cb(this.stopReason ? new Error('quota') : null);
                    }
                });
                for (const fn of ['getCurrentQueryTime','getShortestQueryTime','getShortQueryTime']) env.m[fn] = () => ({date:'20260926',time:'0800'});
                let callbacks = 0, error;
                env.m.getKmaData(kind, {mx:60,my:127}, 'ignored-key', err => {callbacks++; error=err;});
                assert.equal(callbacks,1);
                assert.equal(!!error, rejectAll || !list.length);
                assert.deepStrictEqual(env.calls.filter(c => c.key).map(c => c.key), list);
            }
        }
    }
});
test('R2618-2 past base-time request rotates once and update-list reports exhausted keys', () => {
    for (const list of [[KEY_A, KEY_B], []]) {
        for (const rejectAll of [false, true]) {
            const env = loadManager(list, gather.load({}), []);
            env.Collector.prototype.requestDataByBaseTimeList = function (coord,type,key,times,cb) {
                env.calls[env.calls.length-1].key=key;
                this.stopReason = rejectAll || key === KEY_A ? 'quota' : undefined;
                cb(!!this.stopReason, times.map(t => ({isCompleted:!this.stopReason, options:t, data:[{mCoord:coord}]})));
            };
            let callbacks=0,error;
            env.m.requestDataByUpdateList(2, 'ignored-key', [{mCoord:{mx:60,my:127},baseTimeList:[{date:'20260926',time:'0800'}]}], 3, err => {callbacks++;error=err;});
            assert.equal(callbacks,1);assert.equal(!!error,rejectAll || !list.length);
            assert.deepStrictEqual(env.calls.filter(c=>c.key).map(c=>c.key),list);
        }
    }
});

test('R2618-2 non-key failures never rotate direct-grid or past requests', () => {
    const env = loadManager([KEY_A, KEY_B], gather.load({}), []);
    Object.assign(env.Collector.prototype, {
        DATA_TYPE: {TOWN_CURRENT: 2}, resetResult() {this.resultList=[];},
        getUrl(type,key) {this.testKey=key;return 'synthetic';},
        getData(i,type,url,opts,cb) {env.calls[env.calls.length-1].key=this.testKey;cb(new Error('transport'));},
        requestDataByBaseTimeList(coord,type,key,times,cb) {
            env.calls[env.calls.length-1].key=key;
            cb(true,times.map(t=>({isCompleted:false,options:t})));
        }
    });
    env.m.getCurrentQueryTime=()=>({date:'20260926',time:'0800'});
    let directError,pastError;
    env.m.getKmaData('current',{mx:60,my:127},KEY_B,err=>{directError=err;});
    assert(directError);assert.deepStrictEqual(env.calls.filter(c=>c.key).map(c=>c.key),[KEY_A]);
    env.calls.length=0;
    env.m._recursiveRequestDataByBaseTimList(2,KEY_B,{mx:60,my:127},[{date:'20260926',time:'0800'}],3,err=>{pastError=err;});
    assert(pastError);assert.deepStrictEqual(env.calls.filter(c=>c.key).map(c=>c.key),[KEY_A,KEY_A,KEY_A]);
});


// Review 5399434418: real past collector scheduling and mixed storage/key failures.
test('R2618-3 past DB save errors take priority over quota and never rotate', () => {
    const env = loadManager([KEY_A, KEY_B], gather.load({}), []);
    const storageError = new Error('synthetic storage failure');
    env.Collector.prototype.requestDataByBaseTimeList = function (coord, type, key, times, cb) {
        env.calls[env.calls.length - 1].key = key;
        this.stopReason = 'quota';
        if (!times.length) { return cb(new Error('There is no baseTime list')); }
        cb(true, [{isCompleted: true, data: [{mCoord: coord}]}, {isCompleted: false, options: times[1]}]);
    };
    env.m.getSaveFunc = () => function (data, cb) { cb(storageError); };
    let callbacks = 0, error;
    env.m._recursiveRequestDataByBaseTimList(2, 'ignored', grids(1)[0],
        [{date: '20260926', time: '0800'}, {date: '20260926', time: '0900'}], 3, err => { callbacks++; error = err; });
    assert.equal(callbacks, 1);
    assert.strictEqual(error, storageError);
    assert.deepStrictEqual(env.calls.filter(c => c.key).map(c => c.key), [KEY_A]);
});

test('R2618-3 past collector errors without results complete once without saving or rotating', () => {
    const env = loadManager([KEY_A, KEY_B], gather.load({}), []);
    const collectorError = new Error('synthetic URL setup failure');
    env.Collector.prototype.requestDataByBaseTimeList = function (coord, type, key, times, cb) {
        env.calls[env.calls.length - 1].key = key;
        cb(collectorError);
    };
    let callbacks = 0, error;
    env.m._recursiveRequestDataByBaseTimList(2, 'ignored', grids(1)[0],
        [{date: '20260926', time: '0800'}], 3, err => { callbacks++; error = err; });
    assert.equal(callbacks, 1); assert.strictEqual(error, collectorError);
    assert.equal(env.m.saved.length, 0);
    assert.deepStrictEqual(env.calls.filter(c => c.key).map(c => c.key), [KEY_A]);
});

test('R2618-3 empty past work completes once without constructing a collector or HTTP', () => {
    const env = loadManager([KEY_A, KEY_B], gather.load({}), []);
    let callbacks = 0, error;
    env.m._recursiveRequestDataByBaseTimList(2, 'ignored', grids(1)[0], [], 3, err => { callbacks++; error = err; });
    assert.equal(callbacks, 1); assert.ifError(error); assert.equal(env.calls.length, 0);
});

test('R2618-4 past collector stops synchronous quota/auth dispatch and retains all unfinished times', () => {
    for (const reason of ['quota', 'auth']) {
        const t = deferredCollector(); let sent = 0, callbacks = 0, results;
        t.c.getData = function (i) {
            sent++; this.stopReason = reason; this.resultList[i].rejected = true;
            this.emit('recvFail', i);
        };
        const times = Array.from({length: 5}, (_, i) => ({date: '20260926', time: '0' + i + '00'}));
        t.c.requestDataByBaseTimeList(grids(1)[0], t.c.DATA_TYPE.TOWN_SHORT, KEY_A, times,
            (err, data) => { callbacks++; assert(err); results = data; });
        assert.equal(sent, 1); assert.equal(callbacks, 1);
        assert.equal(results.length, times.length);
        assert(results.every(item => !item.isCompleted && item.options.date && item.options.time));
    }
});

test('R2618-4 past walk bounds in-flight requests, settles them and counts unsent work once', () => {
    const t = deferredCollector(); t.c.concurrency = 2;
    let callbacks = 0, results;
    const times = Array.from({length: 205}, (_, i) => ({date: '20260926', time: String(i)}));
    t.c.requestDataByBaseTimeList(grids(1)[0], t.c.DATA_TYPE.TOWN_SHORT, KEY_A, times,
        (err, data) => { callbacks++; assert(err); results = data; });
    assert.equal(t.stats.requests, 2);
    t.answer(t.pending[0], 429, QUOTA_BODY);
    assert.equal(callbacks, 0); assert.equal(t.stats.requests, 2);
    t.answer(t.pending[0], 200, OK_BODY);
    assert.equal(callbacks, 1); assert.equal(t.stats.requests, 2);
    assert.equal(results.filter(item => item.isCompleted).length, 1);
    assert.equal(results.filter(item => !item.isCompleted).length, 204);
    assert.equal(t.c.receivedCount, 205);
});

test('R2618-5 past requests retain the successful key across sequential coordinates', () => {
    const env = loadManager([KEY_A, KEY_B], gather.load({}), []);
    env.Collector.prototype.requestDataByBaseTimeList = function (coord, type, key, times, cb) {
        Object.assign(env.calls[env.calls.length - 1], {key, coord});
        this.stopReason = key === KEY_A ? 'quota' : undefined;
        cb(!!this.stopReason, times.map(t => ({isCompleted: !this.stopReason, options: t, data: [{mCoord: coord}]})));
    };
    for (const coord of grids(2)) {
        let callbacks = 0;
        env.m._recursiveRequestDataByBaseTimList(2, 'ignored', coord,
            [{date: '20260926', time: '0800'}], 3, err => { assert.ifError(err); callbacks++; });
        assert.equal(callbacks, 1);
    }
    assert.deepStrictEqual(env.calls.filter(c => c.key).map(c => c.key), [KEY_A, KEY_B, KEY_B]);
});

(async () => {
    let failed = 0;
    for (const t of tests) {
        try {
            await t.fn();
            console.log('ok - ' + t.name);
        }
        catch (err) {
            failed++;
            console.log('not ok - ' + t.name + '\n  ' + String(err && err.message));
        }
    }
    console.log(tests.length - failed + '/' + tests.length + ' gather quota tests passed');
    if (failed) { process.exit(1); }
})();
