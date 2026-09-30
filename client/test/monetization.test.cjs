const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

function harness({enabled = true, absent = false, config, debug = false} = {}) {
    let factory;
    const events = [], logs = [], timers = [];
    let nativeEnabled = enabled;
    const window = {
        console: {info: x => logs.push(x), warn: x => logs.push(x)},
        setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
        FirebasexAnalytics: absent ? undefined : {
            isAnalyticsCollectionEnabled(done) { done(enabled); },
            setAnalyticsCollectionEnabled(value, done) { nativeEnabled = value; done(); },
            logEvent(name, params, done) {
                // Native Firebase owns persisted collection/consent, independently of its wrapper's query API.
                if (nativeEnabled !== false && nativeEnabled !== 0) { events.push({name, params: JSON.parse(JSON.stringify(params))}); }
                done();
            }
        },
        FirebasexConfig: config
    };
    vm.runInNewContext(read('www/js/service.monetization.js'), {
        angular: {module() { return {factory(name, fn) { factory = fn; }}; }},
        clientConfig: {debug, releaseAds: !debug}, window
    });
    return {m: factory(window), events, logs, timers, window};
}

function remote(values, {offline = false, pending = false} = {}) {
    const calls = [];
    return {
        calls,
        setDefaults(v, done) { calls.push('defaults'); done(); },
        setConfigSettings(timeout, interval, done) { calls.push([timeout, interval]); done(); },
        getAll(done) { done(values); },
        fetchAndActivate(done, fail) { calls.push('fetch'); if (!pending) offline ? fail('secret URL') : done(true); }
    };
}

test('safe schema drops arbitrary payloads and rejects reserved manual revenue', () => {
    const {m, events} = harness(); m.init();
    m.track('weather_load', {outcome: 'success', duration_ms: 123, address: 'Seoul', token: 'secret'});
    m.track('ad_impression', {value: 5, currency: 'USD'});
    m.track('anything', {label: 'secret'});
    for (const name of ['constructor', '__proto__', 'toString']) {
        assert.equal(m.track(name, {label: 'secret'}), false);
    }
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {name: 'weather_load', params: {outcome: 'success', duration_ms: 123, measurement_version: 1, traffic_type: 'production'}});
    assert.equal(m.track('weather_load', {outcome: 'secret', duration_ms: -1}), false);
});

test('screen transitions deduplicate, but returning to a screen is counted', () => {
    const {m, events} = harness(); m.init();
    m.screen('tab.forecast'); m.screen('tab.forecast'); m.screen('tab.air'); m.screen('tab.forecast'); m.screen('https://secret');
    assert.deepEqual(events.map(e => e.params.screen_name), ['tab.forecast', 'tab.air', 'tab.forecast']);
});

test('missing SDK, disabled collection and thrown bridge errors never break app operations', () => {
    for (const options of [{absent: true}, {enabled: false}]) {
        const {m, events} = harness(options); m.init(); m.screen('start'); m.track('favorite_change', {action: 'add'});
        assert.equal(events.length, 0);
    }
    const h = harness(); h.m.init(); h.window.FirebasexAnalytics.logEvent = () => { throw Error('secret'); };
    assert.doesNotThrow(() => h.m.screen('start'));
    assert.doesNotMatch(JSON.stringify(h.logs), /secret/);
});

test('disabling collection stops events immediately and clearing restores screen measurement', () => {
    const {m, events} = harness(); m.init(); m.screen('start');
    m.setCollectionEnabled(false); m.screen('tab.air');
    assert.equal(events.length, 1);
    m.setCollectionEnabled(true); m.screen('start'); assert.equal(events.length, 2);
});

test('config values are validated atomically, bounded and idempotent init does not refetch', () => {
    const c = remote({tw_banner_enabled: 'false', tw_banner_delay_seconds: '30'});
    const {m} = harness({config: c}); let updates = 0;
    m.init(); m.loadConfig(() => updates++); m.loadConfig(() => updates++);
    assert.deepEqual(JSON.parse(JSON.stringify(m.bannerPolicy())), {enabled: false, delaySeconds: 30});
    assert.equal(c.calls.filter(x => x === 'fetch').length, 1);
    assert.ok(updates >= 1);
    for (const bad of ['-1', '121', 'NaN', '', 'Infinity', '3.5']) {
        const h = harness({config: remote({tw_banner_enabled: 'false', tw_banner_delay_seconds: bad})});
        h.m.loadConfig(() => {});
        assert.deepEqual(JSON.parse(JSON.stringify(h.m.bannerPolicy())), {enabled: true, delaySeconds: 0});
    }
});

test('offline fetch preserves previously activated config and timeout ignores late callbacks', () => {
    const h = harness({config: remote({tw_banner_enabled: 'false', tw_banner_delay_seconds: '10'}, {offline: true})});
    h.m.loadConfig(() => {}); assert.equal(h.m.bannerPolicy().enabled, false);
    assert.doesNotMatch(JSON.stringify(h.logs), /secret URL/);
    let late;
    const c = remote({tw_banner_enabled: 'true', tw_banner_delay_seconds: '0'});
    c.getAll = done => { late = done; };
    const t = harness({config: c}); t.m.loadConfig(() => {}); t.timers[0]();
    late({tw_banner_enabled: 'false', tw_banner_delay_seconds: '30'});
    assert.equal(t.m.bannerPolicy().enabled, true);
});

test('legacy bridge sends permission/status only and never raw city/error labels or device IDs', () => {
    const h = harness(); h.m.init();
    let factory;
    vm.runInNewContext(read('www/js/service.util.js'), {
        angular: {noop() {}, module() { return {factory(n, fn) { factory = fn; }}; }},
        clientConfig: {}, window: {}, console: {log() {}}, ionic: {Platform: {}}
    });
    const util = factory({}, h.m);
    util.ga.trackView('tab.air');
    util.ga.trackEvent('position', 'status', 'authorized', 0);
    util.ga.trackEvent('weather', 'get', 'Secret address (1)', 120);
    util.ga.trackException('secret access token', false); util.ga.setUserId('device-uuid');
    assert.deepEqual(h.events.map(e => e.name), ['screen_view', 'location_permission']);
    assert.doesNotMatch(JSON.stringify(h.events), /Secret|secret|uuid/);
});

function adsHarness(policy) {
    let factory, ready, configChanged, bannerLoaded;
    const calls = [], timers = new Map(); let now = 0, nextId = 0;
    const context = {
        angular: {module() { return {factory(n, fn) { factory = fn; }}; }},
        ionic: {Platform: {isIOS: () => false, isAndroid: () => true}}, clientConfig: {},
        console: {log() {}}, screen: {orientation: {type: 'portrait'}},
        Date: {now: () => now},
        window: {addEventListener() {}, setTimeout(fn, ms) { const id = ++nextId; timers.set(id, {fn, at: now + ms}); return id; }, clearTimeout(id) { timers.delete(id); }}
    };
    const mon = {bannerPolicy: () => policy, track(n, p) { calls.push([n, p]); }, loadConfig(fn) { configChanged = fn; fn(policy); }};
    const adapter = {init(o, done) { ready = done; }, createBannerView(done) { bannerLoaded = done; },
        showBannerAd(show, done) { calls.push(show ? 'show' : 'hide'); done(); }, destroyBannerView(done) { done(); }};
    const deps = {Util: {ga: {trackException() {}}}, Monetization: mon, admobClean: {init() {}}, admobPro: {init() {}}, admobEmi: adapter};
    vm.runInNewContext(read('www/js/service.twads.js'), context);
    const args = factory.toString().match(/function\s*\(([^)]*)\)/)[1].split(',').map(s => deps[s.trim()]);
    const ads = factory(...args); ads.init(); ready();
    return {ads, calls, loaded: () => bannerLoaded(), change(p) { policy = p; configChanged(p); },
        advance(ms) { now += ms; for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); } }};
}

test('banner delay respects guide hide and config kill switch/rollback without a new ad format', () => {
    const h = adsHarness({enabled: true, delaySeconds: 30});
    h.ads.setShowAds(true); h.loaded();
    assert.equal(h.calls.includes('show'), false);
    h.ads.setShowAds(false); h.advance(30000);
    assert.equal(h.calls.includes('show'), false);
    h.ads.setShowAds(true); assert.equal(h.calls.filter(c => c === 'show').length, 1);
    h.change({enabled: false, delaySeconds: 0}); assert.equal(h.calls.at(-1), 'hide');
    h.change({enabled: true, delaySeconds: 0}); assert.equal(h.calls.at(-1), 'show');
    assert.equal(h.calls.filter(c => Array.isArray(c) && c[0] === 'ad_policy_exposure').length, 1);
});

test('late banner load cannot undo kill switch and orientation respects delay', () => {
    const h = adsHarness({enabled: true, delaySeconds: 30});
    h.ads.setShowAds(true); h.change({enabled: false, delaySeconds: 0}); h.loaded(); h.advance(30000);
    assert.equal(h.calls.includes('show'), false);
    h.change({enabled: true, delaySeconds: 0}); assert.equal(h.calls.at(-1), 'show');
});

test('native persisted opt-out and explicit runtime opt-out are never reset at init', () => {
    const h = harness(); let readEnabled = () => {};
    h.window.FirebasexAnalytics.isAnalyticsCollectionEnabled = done => { readEnabled = done; };
    h.m.init(); h.m.setCollectionEnabled(false); readEnabled(true);
    h.m.track('favorite_change', {action: 'add'});
    assert.equal(h.events.length, 0);
});

test('common weather request reports once and preserves response/rejection without leaking location', async () => {
    let factory, fail = false;
    const events = [], response = {data: {current: {t1h: 20}}};
    const q = {defer() { let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {resolve, reject, promise}; }, all: p => Promise.all(p), reject: e => Promise.reject(e)};
    vm.runInNewContext(read('www/js/service.weatherutil.js'), {
        angular: {module() { return {factory(n, fn) { factory = fn; }}; }},
        window: {setTimeout, clearTimeout}, setTimeout, clearTimeout,
        clientConfig: {serverUrl: 'http://fixture'}, console: {log() {}, error() {}, warn() {}},
        ionic: {Platform: {isIOS: () => false, isAndroid: () => true}}
    });
    const http = options => ({success(fn) { if (!fail) fn(response.data); return this; }, error(fn) { if (fail) fn('secret address error', 503); return this; }});
    const m = {track(n, p) { events.push({n, p: JSON.parse(JSON.stringify(p))}); }};
    const util = factory(q, http, {ga: {trackEvent() {}}}, {getAllUnits: () => ({})}, m);
    const result = await util.getWeatherByGeoInfo({location: {lat: 37, long: 127}, address: 'secret'});
    assert.equal(result[0].data, response.data);
    assert.equal(events.length, 1); assert.equal(events[0].n, 'weather_fetch'); assert.equal(events[0].p.outcome, 'success');
    await assert.rejects(util.getWeatherByGeoInfo({}), /Need location/);
    assert.equal(events.length, 2); assert.equal(events[1].p.outcome, 'invalid_input');
    fail = true;
    await assert.rejects(util.getWeatherByGeoInfo({location: {lat: 37, long: 127}}), e => e.code === 503);
    assert.equal(events.length, 3); assert.equal(events[2].p.outcome, 'network_error');
    assert.doesNotMatch(JSON.stringify(events), /secret|address|127/);
});

test('only latest whitelisted pre-ready screen is emitted at platform readiness', () => {
    const h = harness();
    h.m.screen('start'); h.m.screen('tab.air'); h.m.track('favorite_change', {action: 'add'});
    h.m.init();
    assert.equal(h.events.length, 1); assert.equal(h.events[0].params.screen_name, 'tab.air');
});

test('SDK still receives events when wrapper query returns its incorrect default false', () => {
    const h = harness();
    h.window.FirebasexAnalytics.isAnalyticsCollectionEnabled = done => done(false);
    h.m.init(); h.m.screen('start');
    assert.equal(h.events.length, 1);
});

test('favorite counters exclude duplicates, current position and invalid removals', () => {
    let factory; const events = [];
    vm.runInNewContext(read('www/js/service.weatherinfo.js'), {
        angular: {module() { return {factory(n, fn) {factory = fn;}}; }},
        window: {weatherPhotos: {}}, console: {log() {}}
    });
    const info = factory({}, {findWeatherPhoto: () => null}, {}, {}, {track(n, p) {events.push({n, p});}});
    info.saveCities = () => {};
    const city = {address: 'secret', name: 'secret'};
    assert.equal(info.addCity(city), true); assert.equal(info.addCity(city), false);
    info.addCity({currentPosition: true}); info.removeCity(999); info.removeCity(-1);
    info.removeCity(0); info.removeCity(0);
    assert.deepEqual(events.map(e => e.p.action), ['add', 'remove']);
    assert.doesNotMatch(JSON.stringify(events), /secret/);
});
