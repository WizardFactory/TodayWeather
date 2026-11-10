// The rollback hand-back (AN-17, #2896): a fallback Cordova build, shipped with a higher versionCode after the native
// app, prefers the state the native app handed back in the suite over its stale WebView storage, then claims the state
// so a later native start adopts what changes here. TwStorage and Monetization run in vm with a fake suite and storage.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const KEYS = ['cities', 'cityIndex', 'cityList', 'units', 'settingsInfo', 'pushData2', 'pushData', 'expandShortChart',
    'startVersion', 'appVersion', 'disableUpdateInfo', 'twAnalyticsConsentV1'];
const marker = (generation, writer = 'native', extra = {}) =>
    JSON.stringify(Object.assign({schema: 1, generation, writer, complete: true, keys: KEYS}, extra));

// The local cordova-plugin-app-preferences: a string comes back as stored; calls answer asynchronously. The fetch of a
// key in [failing] (a Set the test may empty later) fails.
function suiteOf(values, failing = new Set()) {
    const later = fn => Promise.resolve().then(fn);
    return {
        values,
        fetch(ok, fail, key) { later(() => failing.has(key) ? fail('unreadable') : ok(values.has(key) ? values.get(key) : null)); },
        store(ok, fail, key, value) { later(() => { values.set(key, typeof value === 'string' ? value : JSON.stringify(value)); if (ok) ok(); }); },
        remove(ok, fail, key) { later(() => { values.delete(key); if (ok) ok(); }); }
    };
}

// localStorage; a write of the key [full] ('*': of any key; the test may clear it later) throws as a full store does.
function storageOf(items, full) {
    const map = items instanceof Map ? items : new Map(Object.entries(items));
    return {
        map, full,
        getItem(k) { return map.has(k) ? map.get(k) : null; },
        setItem(k, v) { if (k === this.full || this.full === '*') throw new Error('QuotaExceededError'); map.set(k, String(v)); },
        removeItem(k) { map.delete(k); }
    };
}

function q() {
    return {
        defer() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; },
        all: list => Promise.all(list),
        when: v => Promise.resolve(v)
    };
}

// One start of the build, not awaited; [suite] and [local] may be the Maps of an earlier start. Its timers wait until
// the test fires them.
function launch({suite = {}, local = {}, failing = [], full} = {}) {
    let factory, settled = false;
    const values = suite instanceof Map ? suite : new Map(Object.entries(suite));
    const unreadable = new Set(failing);
    const suitePrefs = suiteOf(values, unreadable);
    const localStorage = storageOf(local, full);
    const timers = [];
    const calls = [];
    const legacy = suiteOf(new Map());
    const plugins = {appPreferences: {suite(name) {
        calls.push('suite:' + name);
        return name === 'net.wizardfactory.todayweather_preferences' ? legacy : suitePrefs;
    }}};
    vm.runInNewContext(read('www/js/service.storage.js'), {
        angular: {module() { return {factory(name, fn) { factory = fn; }}; }},
        clientConfig: {package: 'todayWeather'}, console: {info() {}, log() {}, error() {}},
        window: {plugins}, plugins, localStorage, ionic: {Platform: {isAndroid: () => true}}, JSON, Number, String, Math,
        setTimeout(fn, ms) { timers.push({fn, ms}); }
    });
    const rootScope = {};
    const Util = {ga: {trackEvent() {}, trackException() {}}};
    // TwStorage tells Monetization when the stored choice is final and whether it can be trusted; the call records both
    // and the choice it can read then.
    const Monetization = {storageReady(trusted) { calls.push(`storageReady:${trusted}:${localStorage.getItem('twAnalyticsConsentV1')}`); }};
    const storage = factory(rootScope, q(), Util, Monetization);
    const init = storage.init().then(() => { settled = true; });
    return {storage, localStorage, values, calls, timers, unreadable, init, settled: () => settled,
        fire() { timers.shift().fn(); }};
}

const tick = () => new Promise(r => setImmediate(r));

// One start of the build, awaited. Fails when init does not settle.
async function start(options) {
    const run = launch(options);
    await Promise.race([run.init, new Promise((_, no) => setTimeout(() => no(new Error('init did not settle')), 500))]);
    await tick();
    return run;
}

const nativeState = {
    cities: '[{"currentPosition":true,"disable":true,"address":null,"location":null},{"name":"명동","currentPosition":false,"disable":false}]',
    cityIndex: '1', cityList: '{"cityList":[{"name":"명동","index":1}]}',
    units: '{"temperatureUnit":"C","windSpeedUnit":"m/s","pressureUnit":"hPa","distanceUnit":"km","precipitationUnit":"mm","airUnit":"airkorea"}',
    settingsInfo: '{"startupPage":"0","refreshInterval":"0","theme":"light"}',
    pushData2: '{"registrationId":null,"type":"android","category":"","fcmToken":"token-a","pushList":[]}',
    expandShortChart: 'false', startVersion: '1', twAnalyticsConsentV1: 'false'
};
const staleWebView = {
    cities: '[{"currentPosition":true,"disable":true},{"name":"명동"},{"name":"London"}]', cityIndex: '2',
    pushData2: '{"pushList":[{"cityIndex":2,"id":2,"category":"alarm"}]}', pushData: '{"alarmList":[{"cityIndex":2}]}',
    disableUpdateInfo: 'true', twAnalyticsConsentV1: 'true', settingsInfo: '{"startupPage":"1","refreshInterval":"30","theme":"dark"}'
};

test('a newer native hand-back replaces the stale WebView state, removals included', async () => {
    const {localStorage, values, calls} = await start({suite: Object.assign({_twHandBack: marker(3)}, nativeState), local: staleWebView});
    for (const key of Object.keys(nativeState)) assert.equal(localStorage.getItem(key), nativeState[key], key);
    assert.equal(localStorage.getItem('pushData'), null, 'legacy alarms of a deleted place do not come back');
    assert.equal(localStorage.getItem('disableUpdateInfo'), null, 'a key the native state lacks is removed');
    assert.equal(localStorage.getItem('twHandBackApplied'), '3');
    assert.deepEqual(calls.filter(c => c.startsWith('storageReady')), ['storageReady:true:false'], 'Monetization reads the handed-back consent');
    const claim = JSON.parse(values.get('_twHandBack'));
    assert.deepEqual([claim.schema, claim.generation, claim.writer, claim.complete], [1, 4, 'cordova', true]);
    // The existing mirror then copies the (now native) WebView values back into the suite.
    assert.equal(values.get('cityIndex'), '1');
});

test('a hand-back already applied, a claim, or no marker leaves the WebView state', async () => {
    const applied = await start({suite: Object.assign({_twHandBack: marker(3)}, nativeState), local: Object.assign({twHandBackApplied: '3'}, staleWebView)});
    assert.equal(applied.localStorage.getItem('cityIndex'), '2');
    assert.equal(JSON.parse(applied.values.get('_twHandBack')).generation, 4, 'the build claims the state it shows');
    const claimed = await start({suite: Object.assign({_twHandBack: marker(4, 'cordova')}, nativeState), local: staleWebView});
    assert.equal(claimed.localStorage.getItem('cityIndex'), '2');
    assert.equal(JSON.parse(claimed.values.get('_twHandBack')).generation, 4, 'its own claim is not renewed');
    const none = await start({local: staleWebView});
    assert.equal(none.localStorage.getItem('cityIndex'), '2');
    assert.deepEqual(JSON.parse(none.values.get('_twHandBack')), {schema: 1, generation: 1, writer: 'cordova', complete: true, keys: KEYS});
    for (const run of [applied, claimed, none]) {
        assert.deepEqual(run.calls.filter(c => c.startsWith('storageReady')), ['storageReady:true:true'], 'the stored choice applies as before');
    }
});

test('an incomplete, unknown or unreadable marker is ignored', async () => {
    for (const bad of [marker(3, 'native', {complete: false}), marker(3, 'native', {schema: 2}), '{broken', marker(3, 'other'),
        JSON.stringify({schema: 1, writer: 'native', complete: true, keys: KEYS})]) {
        const {localStorage, calls} = await start({suite: Object.assign({_twHandBack: bad}, nativeState), local: staleWebView});
        assert.equal(localStorage.getItem('cityIndex'), '2', bad);
        assert.equal(localStorage.getItem('pushData'), staleWebView.pushData, bad);
        assert.deepEqual(calls.filter(c => c.startsWith('storageReady')), ['storageReady:false:true'], 'a hand-back it cannot use: the WebView choice is not trusted');
    }
});

// A start that cannot read the whole hand-back, or whose localStorage refuses its texts, waits and tries again with
// growing delays. Until then app.js does not go on (it waits for init: no view, so the splash stays; no cities, no push
// registration, no edit), nothing is claimed or written into the suite and Monetization hears nothing. Once the failure
// clears, the hand-back applies.
async function waitsThenApplies(options, clear, local = staleWebView) {
    const run = launch(Object.assign({suite: Object.assign({_twHandBack: marker(3)}, nativeState), local}, options));
    const before = new Map(run.values);
    for (const delay of [1000, 2000, 4000]) {
        await tick();
        assert.equal(run.settled(), false, 'the start waits');
        assert.deepEqual(run.timers.map(t => t.ms), [delay], 'and tries again with a growing delay');
        assert.deepEqual([...run.values.entries()], [...before.entries()], 'nothing written into the suite');
        assert.equal(run.localStorage.getItem('twHandBackApplied'), null);
        assert.deepEqual(run.calls.filter(c => c.startsWith('storageReady')), []);
        if (delay < 4000) run.fire();
    }
    clear(run);
    run.fire();
    await run.init;
    await tick();
    for (const key of Object.keys(nativeState)) assert.equal(run.localStorage.getItem(key), nativeState[key], key);
    assert.equal(run.localStorage.getItem('pushData'), null, 'the stale alarms are gone');
    assert.equal(run.localStorage.getItem('twHandBackApplied'), '3');
    assert.equal(JSON.parse(run.values.get('_twHandBack')).writer, 'cordova');
    assert.deepEqual(run.calls.filter(c => c.startsWith('storageReady')), ['storageReady:true:false']);
}

test('a marker the build cannot read: the start waits, then applies the hand-back', () =>
    waitsThenApplies({failing: ['_twHandBack']}, run => run.unreadable.clear()));

test('a key the build cannot read: the start waits, then applies the hand-back', () =>
    waitsThenApplies({failing: ['units']}, run => run.unreadable.clear()));

test('a localStorage that refuses a text: the start waits, then applies the hand-back', () =>
    waitsThenApplies({full: 'units'}, run => { run.localStorage.full = null; }));

test('an emptied store that refuses every write: the start waits, then applies the hand-back', () =>
    waitsThenApplies({full: '*'}, run => { run.localStorage.full = null; }, {}));

test('the delays stop growing at 30 s', async () => {
    const run = launch({suite: Object.assign({_twHandBack: marker(3)}, nativeState), local: staleWebView, failing: ['_twHandBack']});
    const delays = [];
    for (let i = 0; i < 8; i++) {
        await tick();
        delays.push(run.timers[0].ms);
        run.fire();
    }
    assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    assert.equal(run.settled(), false);
});

// TwStorage with the real Monetization: after a native withdrawal, a start that cannot use the hand-back never turns
// collection on from the WebView's stale grant, whatever platformReady's order (the plugin's own flag is still on).
async function collectionAfter(options, platformFirst) {
    let storageFactory, monetizationFactory;
    const values = new Map(Object.entries(Object.assign({_twHandBack: marker(3)}, nativeState, options.suite || {})));
    const localStorage = storageOf(staleWebView, options.full);
    const legacy = suiteOf(new Map());
    const unreadable = new Set(options.failing || []);
    const suitePrefs = suiteOf(values, unreadable);
    const timers = [];
    const plugins = {appPreferences: {suite(name) { return name === 'net.wizardfactory.todayweather_preferences' ? legacy : suitePrefs; }}};
    const applied = [], events = [];
    const window = {
        console: {info() {}, warn() {}}, setTimeout() { return 1; }, clearTimeout() {}, localStorage, plugins,
        FirebasexAnalytics: {
            setAnalyticsConsentMode(c, done) { done(); },
            isAnalyticsCollectionEnabled(done) { done(1); },
            setAnalyticsCollectionEnabled(value, done) { applied.push(value); done(); },
            logEvent(n, p, done) { events.push(n); done(); }
        }
    };
    vm.runInNewContext(read('www/js/service.monetization.js'), {
        angular: {module() { return {factory(name, fn) { monetizationFactory = fn; }}; }}, clientConfig: {debug: true, package: 'todayWeather'}, window
    });
    const m = monetizationFactory(window);
    vm.runInNewContext(read('www/js/service.storage.js'), {
        angular: {module() { return {factory(name, fn) { storageFactory = fn; }}; }},
        clientConfig: {package: 'todayWeather'}, console: {info() {}, log() {}, error() {}},
        window: {plugins}, plugins, localStorage, ionic: {Platform: {isAndroid: () => true}}, JSON, Number, String, Math,
        setTimeout(fn, ms) { timers.push(fn); }
    });
    const storage = storageFactory({}, q(), {ga: {trackEvent() {}, trackException() {}}}, m);
    if (platformFirst) m.init();
    let settled = false;
    const init = storage.init().then(() => { settled = true; });
    for (let i = 0; i < 3 && !settled; i++) {
        await tick();
        if (!settled && timers.length) timers.shift()();
    }
    // A start still waiting has told Monetization nothing; then the failure clears.
    const waiting = {applied: [...applied], settled};
    unreadable.clear();
    localStorage.full = null;
    while (!settled) {
        await tick();
        if (!settled && timers.length) timers.shift()();
    }
    await init;
    await tick();
    if (!platformFirst) m.init();
    m.screen('start');
    return {applied, events, choice: m.getCollectionChoice(), waiting};
}

test('a native withdrawal holds whatever the start meets', async () => {
    const cases = {'unreadable marker': {failing: ['_twHandBack']}, 'unreadable key': {failing: ['units']}, 'full store': {full: 'units'},
        'unknown schema': {suite: {_twHandBack: marker(3, 'native', {schema: 2})}}, 'applied': {}};
    for (const [name, options] of Object.entries(cases)) {
        for (const platformFirst of [true, false]) {
            const label = `${name}, platformReady ${platformFirst ? 'first' : 'last'}`;
            const {applied, events, choice, waiting} = await collectionAfter(options, platformFirst);
            if (!waiting.settled) assert.deepEqual(waiting.applied, [], `${label}: nothing applied while the start waits`);
            assert.equal(applied.includes(true), false, `${label}: ${applied}`);
            assert.deepEqual(events, [], label);
            assert.equal(choice, false, label);
        }
    }
});

test('an emptied WebView store restores the native hand-back as well', async () => {
    const {localStorage} = await start({suite: Object.assign({_twHandBack: marker(2)}, nativeState)});
    assert.equal(localStorage.getItem('cities'), nativeState.cities);
    assert.equal(localStorage.getItem('twHandBackApplied'), '2');
});

test('switching again: each newer native hand-back applies once', async () => {
    const first = await start({suite: Object.assign({_twHandBack: marker(5)}, nativeState), local: Object.assign({twHandBackApplied: '3'}, staleWebView)});
    assert.equal(first.localStorage.getItem('cityIndex'), '1');
    assert.equal(first.localStorage.getItem('twHandBackApplied'), '5');
    assert.equal(JSON.parse(first.values.get('_twHandBack')).generation, 6);
});

// Monetization: a stored choice applies once TwStorage has read the hand-back; the choice is mirrored into the suite for
// the native app.
// A suite whose writes wait until the test runs or fails them, in any order.
function heldSuite() {
    const values = new Map(), pending = [];
    return {
        values, pending,
        store(ok, fail, k, v) { pending.push({run() { values.set(k, v); if (ok) ok(); }, fail() { if (fail) fail('failed'); }}); },
        remove(ok, fail, k) { pending.push({run() { values.delete(k); if (ok) ok(); }, fail() { if (fail) fail('failed'); }}); }
    };
}

// cordova-plugin-app-preferences on Android: a removal of a key the suite does not hold answers NO_RESULT, so neither
// callback runs; stores answer.
function pluginSuite() {
    const values = new Map(), pending = [];
    return {
        values, pending,
        runAll() { while (pending.length) pending.shift()(); },
        store(ok, fail, k, v) { pending.push(() => { values.set(k, v); if (ok) ok(); }); },
        remove(ok, fail, k) { pending.push(() => { if (values.has(k)) { values.delete(k); if (ok) ok(); } }); }
    };
}

function immediateSuite(values) {
    return {
        store(ok, fail, k, v) { values.set(k, v); if (ok) ok(); },
        remove(ok, fail, k) { values.delete(k); if (ok) ok(); }
    };
}

function monetization({stored, flag = true, suite, full} = {}) {
    let factory;
    const applied = [], mirrored = suite ? suite.values : new Map(), screens = [];
    const localStorage = storageOf(stored === undefined ? {} : {twAnalyticsConsentV1: stored}, full);
    const window = {
        console: {info() {}, warn() {}}, setTimeout() { return 1; }, clearTimeout() {}, localStorage,
        plugins: {appPreferences: {suite() { return suite || immediateSuite(mirrored); }}},
        FirebasexAnalytics: {
            setAnalyticsConsentMode(c, done) { done(); },
            isAnalyticsCollectionEnabled(done) { done(flag); },
            setAnalyticsCollectionEnabled(value, done) { applied.push(value); done(); },
            logEvent(n, p, done) { if (n === 'screen_view') { screens.push(p.screen_name); } done(); }
        }
    };
    vm.runInNewContext(read('www/js/service.monetization.js'), {
        angular: {module() { return {factory(name, fn) { factory = fn; }}; }}, clientConfig: {debug: true, package: 'todayWeather'}, window
    });
    return {m: factory(window), applied, localStorage, mirrored, screens};
}

test('a stale WebView grant is never applied before the storage is read', () => {
    // platformReady can come first: the grant the WebView still holds waits, and the handed-back withdrawal applies.
    // applyCollection stops collection first, then sets the consent mode, then starts it for a grant.
    const {m, applied, localStorage, screens} = monetization({stored: 'true'});
    m.init();
    m.screen('start');
    assert.deepEqual(applied, [], 'nothing applied yet');
    localStorage.setItem('twAnalyticsConsentV1', 'false');
    m.storageReady(true);
    assert.equal(m.getCollectionChoice(), false);
    assert.deepEqual(applied, [false]);
    assert.deepEqual(screens, []);
});

test('without a hand-back the stored choice applies once both are ready, in either order', () => {
    const late = monetization({stored: 'true'});
    late.m.init();
    late.m.screen('start');
    late.m.storageReady(true);
    late.m.storageReady(true);
    assert.deepEqual(late.applied, [false, true], 'once');
    assert.deepEqual(late.screens, ['start'], 'the screen shown before is measured after the grant applied');
    const early = monetization({stored: 'true'});
    early.m.storageReady(true);
    early.m.init();
    assert.deepEqual(early.applied, [false, true]);
});

test('a handed-back grant still needs the SDK flag', () => {
    const granted = monetization({stored: 'false', flag: true});
    granted.m.init();
    granted.localStorage.setItem('twAnalyticsConsentV1', 'true');
    granted.m.storageReady(true);
    assert.equal(granted.m.getCollectionChoice(), true);
    assert.deepEqual(granted.applied, [false, true]);
    const refused = monetization({stored: 'false', flag: false});
    refused.m.init();
    refused.localStorage.setItem('twAnalyticsConsentV1', 'true');
    refused.m.storageReady(true);
    assert.equal(refused.m.getCollectionChoice(), false, 'the SDK flag withdrew it');
    assert.deepEqual(refused.applied, [false]);
    assert.equal(refused.localStorage.getItem('twAnalyticsConsentV1'), 'false');
});

test('choices reach the suite in the order they were made, whatever order the plugin finishes in', () => {
    // The plugin runs each call on a thread pool: a grant's write finishing after the withdrawal's would leave the grant.
    const suite = heldSuite();
    const {m} = monetization({stored: 'true', suite});
    m.storageReady(true);
    m.init();
    const results = [];
    m.setCollectionEnabled(true, ok => results.push(['grant', ok]));
    m.setCollectionEnabled(false, ok => results.push(['withdraw', ok]));
    assert.equal(suite.pending.length, 1, 'one write at a time');
    suite.pending.shift().run();
    assert.equal(suite.pending.length, 1);
    suite.pending.shift().run();
    assert.equal(suite.values.get('twAnalyticsConsentV1'), 'false');
    assert.deepEqual(results, [['grant', true], ['withdraw', true]]);
});

test('a choice the suite does not take is written there as a withdrawal and reported as not saved', () => {
    const suite = heldSuite();
    suite.values.set('twAnalyticsConsentV1', 'true');
    const {m} = monetization({stored: 'true', suite});
    m.storageReady(true);
    m.init();
    let result;
    m.setCollectionEnabled(false, ok => { result = ok; });
    suite.pending.shift().fail();
    suite.pending.shift().run();
    assert.equal(suite.values.get('twAnalyticsConsentV1'), 'false', 'no older grant stays there');
    assert.equal(result, false, 'the menu reports LOC_PRIVACY_SAVE_FAILED');
    assert.equal(m.getCollectionChoice(), false);
});

test('a choice this build cannot keep is reported, and later choices still reach the suite', () => {
    // The plugin never answers the removal of a key it does not hold.
    const suite = pluginSuite();
    const {m, localStorage} = monetization({suite, full: 'twAnalyticsConsentV1'});
    m.storageReady(true);
    m.init();
    let first;
    m.setCollectionEnabled(true, ok => { first = ok; });
    suite.runAll();
    assert.equal(first, false, 'LOC_PRIVACY_SAVE_FAILED');
    assert.equal(suite.values.get('twAnalyticsConsentV1'), 'false');
    localStorage.setItem = function (k, v) { this.map.set(k, String(v)); };
    let second;
    m.setCollectionEnabled(true, ok => { second = ok; });
    suite.runAll();
    assert.equal(second, true);
    assert.equal(suite.values.get('twAnalyticsConsentV1'), 'true');
});

test('a stored grant this build cannot trust is not applied, while a choice made then is', () => {
    const {m, applied} = monetization({stored: 'true'});
    m.init();
    m.storageReady(false);
    assert.equal(m.getCollectionChoice(), false);
    assert.deepEqual(applied, [false]);
    m.setCollectionEnabled(true);
    assert.equal(m.getCollectionChoice(), true);
    assert.deepEqual(applied, [false, false, true]);
});

test('a choice made in the fallback build is mirrored into the suite', () => {
    const {m, mirrored} = monetization({stored: 'true'});
    m.storageReady(true);
    m.init();
    m.setCollectionEnabled(false);
    assert.equal(mirrored.get('twAnalyticsConsentV1'), 'false');
    m.setCollectionEnabled(true);
    assert.equal(mirrored.get('twAnalyticsConsentV1'), 'true');
});
