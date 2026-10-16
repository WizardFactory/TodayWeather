const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the real Firebase adapter and Push factory through native SDK callbacks.
function harness({token = 'token-A', savedAlarms = false} = {}) {
    const factories = {}, requests = [], writes = [], timers = [];
    let refreshed, refreshError;
    let saved = {fcmToken: token, type: 'ios', pushList: savedAlarms ? [{
        category: 'alarm', id: 1, cityIndex: 1, enable: true,
        time: '2026-10-16T07:40:00Z', dayOfWeek: [true, true, true, true, true, true, true],
        name: 'Test city', source: 'KMA', location: {lat: 37, long: 127}
    }] : []};
    const copy = value => JSON.parse(JSON.stringify(value));
    const context = {
        angular: {module() { return {factory(name, fn) { factories[name] = fn; }}; }},
        window: {FirebasexMessaging: {
            onTokenRefresh(fn, fail) { refreshed = fn; refreshError = fail; },
            onMessageReceived() {}
        }},
        clientConfig: {serverUrl: 'https://example.invalid', package: 'todayWeather'},
        ionic: {Platform: {isIOS: () => true, isAndroid: () => false}},
        console: {log() {}, error() {}}, Date,
        setTimeout(fn, delay) { timers.push({fn, delay}); }
    };
    for (const name of ['service.firebase.js', 'service.push.js']) {
        const file = path.join(__dirname, '../www/js', name);
        vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, {filename: file});
    }
    const firebase = factories.Firebase({track() {}, screen() {}});
    const storage = {
        get(key) { return key === 'pushData2' ? copy(saved) : null; },
        set(key, value) { writes.push({key, value: copy(value)}); saved = copy(value); }
    };
    const http = options => {
        requests.push(copy(options));
        return {success() { return this; }, error() { return this; }};
    };
    const util = {uuid: 'test-device', version: 'test', ga: {trackEvent() {}, trackException() {}}};
    const push = factories.Push(http, storage, util, {}, {},
        {getAllUnits: () => ({airUnit: 'airkorea'})}, {$broadcast() {}}, firebase);
    push.init();
    assert.equal(typeof refreshed, 'function', 'real native refresh callback must be registered');
    return {
        push, requests, writes, timers,
        emit(value) { refreshed(value); },
        error(error) { refreshError(error); },
        saved: () => copy(saved)
    };
}

const invalid = [null, undefined, '', '  \t\n', false, 0, {}, []];

test('invalid SDK token callbacks preserve registered token, settings and storage', () => {
    const h = harness({savedAlarms: true});
    const settings = JSON.stringify(h.push.pushData.pushList);
    const saved = h.saved();
    for (const value of invalid) {
        h.emit(value);
        assert.equal(h.push.pushData.fcmToken, 'token-A');
        assert.equal(JSON.stringify(h.push.pushData.pushList), settings);
        assert.deepEqual(h.saved(), saved);
        assert.equal(h.requests.length, 0);
        assert.equal(h.writes.length, 0);
    }
    assert.equal(h.timers.length, 1, 'existing startup re-registration remains scheduled');
});

test('A to invalid callbacks to B makes exactly one complete replacement PUT', () => {
    const h = harness({savedAlarms: true});
    for (const value of invalid) h.emit(value);
    h.emit('token-B');
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].method, 'PUT');
    assert.deepEqual(h.requests[0].data, {newToken: 'token-B', oldToken: 'token-A'});
    assert.equal(h.push.pushData.fcmToken, 'token-B');
    assert.equal(h.push.pushData.pushList.length, 1);
    assert.equal(h.writes.length, 0, 'replacement persistence behavior is unchanged');
    h.emit('token-B');
    assert.equal(h.requests.length, 1, 'same-token callback cannot duplicate PUT');
});

test('invalid callbacks before first token do not register or save pending alarms', () => {
    const h = harness({token: null, savedAlarms: true});
    const saved = h.saved();
    for (const value of invalid) {
        h.emit(value);
        assert.equal(h.push.pushData.fcmToken, null);
        assert.equal(h.requests.length, 0);
        assert.equal(h.writes.length, 0);
        assert.deepEqual(h.saved(), saved);
    }
});

test('first valid token still posts and persists pending alarms once', () => {
    const h = harness({token: null, savedAlarms: true});
    h.emit(null);
    h.emit('token-first');
    assert.deepEqual(h.requests.map(r => r.method), ['PUT', 'POST']);
    assert.deepEqual(h.requests[0].data, {newToken: 'token-first', oldToken: null});
    assert.equal(h.requests[1].data.length, 1);
    assert.equal(h.requests[1].data[0].fcmToken, 'token-first');
    assert.equal(h.writes.length, 1);
    assert.equal(h.saved().fcmToken, 'token-first');
    h.emit('token-first');
    assert.equal(h.requests.length, 2);
    assert.equal(h.writes.length, 1);
});

test('valid opaque token bytes are passed through unchanged', () => {
    const h = harness();
    h.emit(' token-B ');
    assert.deepEqual(h.requests[0].data, {newToken: ' token-B ', oldToken: 'token-A'});
    assert.equal(h.push.pushData.fcmToken, ' token-B ');
});

test('native callback errors preserve A and do not block a later valid B', () => {
    const h = harness({savedAlarms: true});
    h.error('temporary native failure');
    assert.equal(h.push.pushData.fcmToken, 'token-A');
    assert.equal(h.requests.length, 0);
    assert.equal(h.writes.length, 0);
    h.emit('token-B');
    assert.deepEqual(h.requests[0].data, {newToken: 'token-B', oldToken: 'token-A'});
});
