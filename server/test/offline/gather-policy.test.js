'use strict';
// Gather runtime policy (#2588): env parsing, master defaults and the consumers
// that read it. Modules run in a VM with every dependency stubbed; no app, DB,
// provider, S3 or real timer is used.
// Usage: node server/test/offline/gather-policy.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const util = require('util');
const vm = require('vm');

const root = path.resolve(__dirname, '../..');
const gather = require('../../config/gather');

// Values observed on the production gather host (issue #2588; town retry per the #2604 hotfix).
const PRODUCTION_ENV = {
    GATHER_TOWN_RETRY: '10',
    GATHER_INVALID_CURRENT_RETRY: '40',
    GATHER_MID_RETRY: '2',
    GATHER_RETRY_DELAY_MS: '50',
    GATHER_PAST_ENABLED: 'false',
    GATHER_AIR_FORECAST_ENABLED: 'false',
    GATHER_PAST_CONDITION_RETRY_DIVISOR: '20',
    GATHER_KAQ_MIN_MODEL_IMAGES: '2'
};

function logger() {
    const log = {};
    ['debug', 'info', 'warn', 'error', 'verbose', 'silly'].forEach(level => {
        log[level] = function () { util.format.apply(util, arguments); };
    });
    return log;
}

// Load a module with every require stubbed as a throwing collaborator unless overridden.
function load(relative, overrides, globals) {
    const filename = path.join(root, relative);
    const code = fs.readFileSync(filename, 'utf8');
    const deps = {};
    for (const m of code.matchAll(/require\('([^']+)'\)/g)) {
        deps[m[1]] = function Unexpected() { throw new Error('Unexpected collaborator ' + m[1]); };
        // Constructed at module load; an inert instance is enough.
        if (/^\.\/kma\/kma\.town\.|midRssKmaRequester|kecoRequester|lifeIndexKmaRequester/.test(m[1])) {
            deps[m[1]] = function Inert() { this.remove = () => {}; };
        }
    }
    Object.assign(deps, overrides);
    const module = {exports: {}};
    const sandbox = Object.assign({
        module, exports: module.exports, Date, JSON, Math, Promise, Error,
        require: name => {
            if (!Object.prototype.hasOwnProperty.call(deps, name)) { throw new Error('Unstubbed dependency: ' + name); }
            return deps[name];
        },
        setTimeout: () => { throw new Error('Unexpected timer'); },
        log: logger()
    }, globals);
    vm.runInNewContext(code, sandbox, {filename});
    return module.exports;
}

function managerWith(policy, overrides, globals) {
    return load('controllers/controllerManager.js', Object.assign({
        '../config/config': {db: {version: '2.0'}, keyString: {dongnae_forecast_keys: '[]'}, history: {enabled: false}},
        '../config/gather': policy,
        async: require('async')
    }, overrides), globals);
}

const tests = [];
function test(name, fn) { tests.push({name, fn}); }

test('unset environment reproduces master literals', () => {
    const p = gather.load({});
    assert.deepStrictEqual(p.retry, {
        townShort: 70, townShortest: 70, townCurrent: 70, invalidCurrent: 50,
        midForecast: 70, midLand: 70, midTemp: 70, midSea: 70
    });
    assert.strictEqual(p.retryDelayMs, 0);
    assert.deepStrictEqual(p.tasks, {past: true, airForecast: true});
    assert.deepStrictEqual(p.pastCondition, {retryCount: 10, retryDivisor: 0});
    assert.strictEqual(p.kaqMinModelImages, 4);
    [0, 1, 19, 20, 400].forEach(n => assert.strictEqual(p.pastConditionRetryCount(n), 10));
    // Empty strings are treated as unset.
    assert.deepStrictEqual(gather.load({GATHER_TOWN_RETRY: '', GATHER_PAST_ENABLED: ' '}).retry, p.retry);
});

test('production environment yields the host policy', () => {
    const p = gather.load(PRODUCTION_ENV);
    assert.deepStrictEqual(p.retry, {
        townShort: 10, townShortest: 10, townCurrent: 10, invalidCurrent: 40,
        midForecast: 2, midLand: 2, midTemp: 2, midSea: 2
    });
    assert.strictEqual(p.retryDelayMs, 50);
    assert.deepStrictEqual(p.tasks, {past: false, airForecast: false});
    assert.strictEqual(p.kaqMinModelImages, 2);
});

test('divisor retry equals the host updateList.length/20 when integral, else rounds up', () => {
    const p = gather.load({GATHER_PAST_CONDITION_RETRY_DIVISOR: '20'});
    assert.strictEqual(p.pastConditionRetryCount(40), 2);
    assert.strictEqual(p.pastConditionRetryCount(400), 20);
    // Host value 2.25 never reaches zero when decremented; ceil keeps it finite.
    assert.strictEqual(p.pastConditionRetryCount(45), 3);
    assert.strictEqual(p.pastConditionRetryCount(5), 1);
    assert.strictEqual(p.pastConditionRetryCount(0), 1);
});

test('invalid values fail at load instead of silently reverting to defaults', () => {
    [
        ['GATHER_TOWN_RETRY', '0'], ['GATHER_TOWN_RETRY', 'abc'], ['GATHER_TOWN_RETRY', '1.5'],
        ['GATHER_MID_RETRY', '-1'], ['GATHER_INVALID_CURRENT_RETRY', '1e3'],
        ['GATHER_RETRY_DELAY_MS', '-5'], ['GATHER_PAST_CONDITION_RETRY', '0'],
        ['GATHER_PAST_CONDITION_RETRY_DIVISOR', 'x'],
        ['GATHER_KAQ_MIN_MODEL_IMAGES', '0'], ['GATHER_KAQ_MIN_MODEL_IMAGES', '5'],
        ['GATHER_PAST_ENABLED', 'yes'], ['GATHER_AIR_FORECAST_ENABLED', '0']
    ].forEach(([name, value]) => {
        assert.throws(() => gather.load({[name]: value}), new RegExp('Invalid ' + name));
    });
});

test('town collectors pass the configured retry counts', () => {
    [gather.load({}), gather.load(PRODUCTION_ENV)].forEach(policy => {
        const Manager = managerWith(policy, {'../models/town': {getCoord: cb => cb(null, [{mx: 60, my: 127}])}});
        const m = Object.create(Manager.prototype);
        m.DATA_TYPE = {TOWN_SHORT: 's', TOWN_SHORTEST: 'st', TOWN_CURRENT: 'c'};
        const seen = {};
        m._recursiveRequestData = (list, type, key, date, retry) => { seen[type] = retry; };
        m.getTownShortData(9, 'k');
        m.getTownShortestData(9, 'k');
        m.getTownCurrentData(9, 'k');
        assert.deepStrictEqual(seen, {s: policy.retry.townShort, st: policy.retry.townShortest, c: policy.retry.townCurrent});
    });
});

test('invalid-current and mid collectors read their policy field', () => {
    // These call sites sit behind DB/publication checks; map each literal-free call to its field.
    const src = fs.readFileSync(path.join(root, 'controllers/controllerManager.js'), 'utf8');
    const fields = [...src.matchAll(/self\._recursiveRequestData\(\w+, self\.DATA_TYPE\.(\w+), key, dateString, ([^,]+),/g)]
        .map(m => m[1] + '>' + m[2].replace(/^gatherPolicy\.retry\./, ''));
    assert.deepStrictEqual(fields, [
        'TOWN_SHORT>townShort', 'TOWN_SHORTEST>townShortest', 'TOWN_CURRENT>townCurrent', 'TOWN_CURRENT>invalidCurrent',
        'MID_FORECAST>midForecast', 'MID_LAND>midLand', 'MID_TEMP>midTemp', 'MID_TEMP>midTemp', 'MID_SEA>midSea'
    ]);
});

function runRecursive(policy) {
    const delays = [];
    let requests = 0;
    function Collector() {}
    Collector.prototype.requestData = (list, type, key, date, time, cb) => {
        requests++;
        cb(new Error('synthetic failure'), list.map(mCoord => ({isCompleted: false, mCoord})));
    };
    const Manager = managerWith(policy, {'../lib/collectTownForecast': Collector},
        {setTimeout: (fn, ms) => { delays.push(ms); fn(); }});
    const m = Object.create(Manager.prototype);
    m.getDataTypeName = () => 'TOWN_SHORT';
    let result;
    m._recursiveRequestData([{mx: 60, my: 127}], 's', 'k', {date: '20260926', time: '0800'},
        policy.retry.townShort, undefined, err => { result = err; });
    return {delays, requests, result};
}

test('persistent failure retries exactly the configured count with the configured delay', () => {
    const base = runRecursive(gather.load({}));
    assert.strictEqual(base.requests, 70);
    assert.deepStrictEqual([...new Set(base.delays)], [0]);
    assert.match(base.result.message, /retryCount is zero/);
    const prod = runRecursive(gather.load(PRODUCTION_ENV));
    assert.strictEqual(prod.requests, 10);
    // One timer per failed pass, including the pass that then hits the zero-count stop.
    assert.strictEqual(prod.delays.length, 10);
    assert.deepStrictEqual([...new Set(prod.delays)], [50]);
});

function queuedTasks(policy, iso) {
    class Clock extends Date { constructor(...a) { super(...(a.length ? a : [iso])); } }
    const Manager = managerWith(policy, {}, {Date: Clock});
    const m = Object.create(Manager.prototype);
    m.asyncTasks = [];
    m._requestApi = (name, cb) => cb();
    m.checkTimeAndRequestTask(false);
    return m.asyncTasks.map(fn => fn.name);
}

test('past and air-forecast task flags gate only their own jobs', () => {
    const def = gather.load({});
    const prod = gather.load(PRODUCTION_ENV);
    const minute2 = '2026-09-26T08:02:00Z';
    const minute7 = '2026-09-26T08:07:00Z';
    assert(queuedTasks(def, minute2).includes('Past'));
    assert(queuedTasks(def, minute7).includes('getKaqHourlyForecast'));
    const prod2 = queuedTasks(prod, minute2);
    assert(!prod2.includes('Past'));
    assert.deepStrictEqual(prod2, queuedTasks(def, minute2).filter(n => n !== 'Past'));
    assert.deepStrictEqual(queuedTasks(prod, minute7), []);
    assert(queuedTasks(gather.load({GATHER_PAST_ENABLED: 'false'}), minute7).includes('getKaqHourlyForecast'));
});

test('PastConditionGather passes the configured retry count', () => {
    [[{}, 45, 10], [{GATHER_PAST_CONDITION_RETRY: '3'}, 45, 3], [PRODUCTION_ENV, 40, 2], [PRODUCTION_ENV, 45, 3]]
        .forEach(([env, length, expected]) => {
            let passed;
            const manager = {DATA_TYPE: {TOWN_CURRENT: 'c'},
                requestDataByUpdateList: (type, key, list, retry, cb) => { passed = retry; cb(); }};
            const Past = load('lib/PastConditionGather.js', {
                async: require('async'), '../config/config': {db: {version: '2.0'}}, '../config/gather': gather.load(env)
            }, {manager});
            const p = Object.create(Past.prototype);
            p.makePubDateList = () => [];
            p.getCoordList = cb => cb();
            p._checkBaseTimeByCoord2 = cb => { p.updateList = new Array(length).fill({}); cb(); };
            let done;
            p.start(1, 'k', err => { done = true; assert.ifError(err); });
            assert(done);
            assert.strictEqual(passed, expected);
        });
});

async function kaqAccepts(policy, count) {
    function Base() {}
    const Kaq = load('controllers/kaq.hourly.forecast.controller.js', {
        '../config/config': {image: {kaq_korea_image: {}}}, '../config/gather': policy,
        './img.hourly.forecast.controller': Base
    });
    const Contents = Array.from({length: count}, (v, i) => ({Key: 'f/' + i + '_PM2_5.09KM.gif'}));
    const self = {s3: {ls: () => Promise.resolve({Contents})}};
    return new Promise(resolve => {
        Kaq.prototype._existAllModelimg.call(self, [{folderName: 'f'}], err => resolve(err ? err.message : 'ok'));
    });
}

test('KAQ minimum model-image count follows policy; more than four still fails', async () => {
    const def = gather.load({});
    const prod = gather.load(PRODUCTION_ENV);
    assert.deepStrictEqual(await Promise.all([1, 2, 3, 4, 5].map(n => kaqAccepts(def, n))),
        ['It is not get all modelimg yet', 'It is not get all modelimg yet', 'It is not get all modelimg yet', 'ok', 'Maybe found new modelimg!!!']);
    assert.deepStrictEqual(await Promise.all([1, 2, 3, 4, 5].map(n => kaqAccepts(prod, n))),
        ['It is not get all modelimg yet', 'ok', 'ok', 'ok', 'Maybe found new modelimg!!!']);
});

(async () => {
    for (const t of tests) {
        await t.fn();
        console.log('ok - ' + t.name);
    }
    console.log(tests.length + ' gather policy tests passed');
})().catch(err => { console.error(err); process.exit(1); });
