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

// The local cordova-plugin-app-preferences: a string comes back as stored; calls answer asynchronously. A [failing]
// key's fetch fails.
function suiteOf(values, failing) {
    const later = fn => Promise.resolve().then(fn);
    return {
        values,
        fetch(ok, fail, key) { later(() => key === failing ? fail('unreadable') : ok(values.has(key) ? values.get(key) : null)); },
        store(ok, fail, key, value) { later(() => { values.set(key, typeof value === 'string' ? value : JSON.stringify(value)); if (ok) ok(); }); },
        remove(ok, fail, key) { later(() => { values.delete(key); if (ok) ok(); }); }
    };
}

function storageOf(items) {
    const map = new Map(Object.entries(items));
    return {
        map,
        getItem(k) { return map.has(k) ? map.get(k) : null; },
        setItem(k, v) { map.set(k, String(v)); },
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

async function start({suite = {}, local = {}, failing} = {}) {
    let factory;
    const values = new Map(Object.entries(suite));
    const suitePrefs = suiteOf(values, failing);
    const localStorage = storageOf(local);
    const calls = [];
    const plugins = {appPreferences: {suite(name) { calls.push('suite:' + name); return suitePrefs; }}};
    vm.runInNewContext(read('www/js/service.storage.js'), {
        angular: {module() { return {factory(name, fn) { factory = fn; }}; }},
        clientConfig: {package: 'todayWeather'}, console: {info() {}, log() {}, error() {}},
        window: {plugins}, plugins, localStorage, ionic: {Platform: {isAndroid: () => true}}, JSON, Number, String
    });
    const rootScope = {};
    const Util = {ga: {trackEvent() {}, trackException() {}}};
    // TwStorage tells Monetization when the stored choice is final; the call records the choice it can read then.
    const Monetization = {storageReady() { calls.push('storageReady:' + localStorage.getItem('twAnalyticsConsentV1')); }};
    const storage = factory(rootScope, q(), Util, Monetization);
    await storage.init();
    await new Promise(r => setTimeout(r, 0));
    return {storage, localStorage, values, calls};
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
    assert.deepEqual(calls.filter(c => c.startsWith('storageReady')), ['storageReady:false'], 'Monetization reads the handed-back consent');
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
        assert.deepEqual(run.calls.filter(c => c.startsWith('storageReady')), ['storageReady:true'], 'the stored choice applies as before');
    }
});

test('an incomplete, unknown or unreadable marker is ignored', async () => {
    for (const bad of [marker(3, 'native', {complete: false}), marker(3, 'native', {schema: 2}), '{broken', marker(3, 'other'),
        JSON.stringify({schema: 1, writer: 'native', complete: true, keys: KEYS})]) {
        const {localStorage} = await start({suite: Object.assign({_twHandBack: bad}, nativeState), local: staleWebView});
        assert.equal(localStorage.getItem('cityIndex'), '2', bad);
        assert.equal(localStorage.getItem('pushData'), staleWebView.pushData, bad);
    }
});

test('a hand-back the build cannot read whole: the WebView state stays, and this build claims it', async () => {
    // Its mirror below and its later writes replace suite keys; under the native marker a later start would apply
    // that mix of both builds' texts.
    const {localStorage, values, calls} = await start({suite: Object.assign({_twHandBack: marker(3)}, nativeState), local: staleWebView,
        failing: 'units'});
    assert.equal(localStorage.getItem('cityIndex'), '2');
    assert.equal(localStorage.getItem('pushData'), staleWebView.pushData);
    assert.equal(localStorage.getItem('twHandBackApplied'), null);
    const claim = JSON.parse(values.get('_twHandBack'));
    assert.deepEqual([claim.writer, claim.generation, claim.complete], ['cordova', 4, true]);
    assert.deepEqual(calls.filter(c => c.startsWith('storageReady')), ['storageReady:true']);
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
function monetization({stored, flag = true} = {}) {
    let factory;
    const applied = [], mirrored = new Map(), screens = [];
    const localStorage = storageOf(stored === undefined ? {} : {twAnalyticsConsentV1: stored});
    const window = {
        console: {info() {}, warn() {}}, setTimeout() { return 1; }, clearTimeout() {}, localStorage,
        plugins: {appPreferences: {suite() { return {store(ok, fail, k, v) { mirrored.set(k, v); }, remove(ok, fail, k) { mirrored.delete(k); }}; }}},
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
    m.storageReady();
    assert.equal(m.getCollectionChoice(), false);
    assert.deepEqual(applied, [false]);
    assert.deepEqual(screens, []);
});

test('without a hand-back the stored choice applies once both are ready, in either order', () => {
    const late = monetization({stored: 'true'});
    late.m.init();
    late.m.screen('start');
    late.m.storageReady();
    late.m.storageReady();
    assert.deepEqual(late.applied, [false, true], 'once');
    assert.deepEqual(late.screens, ['start'], 'the screen shown before is measured after the grant applied');
    const early = monetization({stored: 'true'});
    early.m.storageReady();
    early.m.init();
    assert.deepEqual(early.applied, [false, true]);
});

test('a handed-back grant still needs the SDK flag', () => {
    const granted = monetization({stored: 'false', flag: true});
    granted.m.init();
    granted.localStorage.setItem('twAnalyticsConsentV1', 'true');
    granted.m.storageReady();
    assert.equal(granted.m.getCollectionChoice(), true);
    assert.deepEqual(granted.applied, [false, true]);
    const refused = monetization({stored: 'false', flag: false});
    refused.m.init();
    refused.localStorage.setItem('twAnalyticsConsentV1', 'true');
    refused.m.storageReady();
    assert.equal(refused.m.getCollectionChoice(), false, 'the SDK flag withdrew it');
    assert.deepEqual(refused.applied, [false]);
    assert.equal(refused.localStorage.getItem('twAnalyticsConsentV1'), 'false');
});

test('a choice made in the fallback build is mirrored into the suite', () => {
    const {m, mirrored} = monetization({stored: 'true'});
    m.storageReady();
    m.init();
    m.setCollectionEnabled(false);
    assert.equal(mirrored.get('twAnalyticsConsentV1'), 'false');
    m.setCollectionEnabled(true);
    assert.equal(mirrored.get('twAnalyticsConsentV1'), 'true');
});
