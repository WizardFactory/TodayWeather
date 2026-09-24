'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const h = require('./harness');
const server = path.resolve(__dirname, '../..');

function pushHarness(options = {}) {
    const events = {apps: [], sends: [], credentials: [], gcm: []};
    const config = {serviceServer: {url: 'http://offline.invalid'}, push: {gcmAccessKey: 'OFFLINE'}};
    const admin = {
        apps: [],
        credential: {cert: value => { events.credentials.push(value); return {}; }},
        initializeApp: function (settings, name) {
            if (options.initError) { throw options.initError; }
            const app = {name, messaging: () => ({send: message => {
                events.sends.push({name, message});
                if (options.sendError) { throw options.sendError; }
                return options.fcmResult || Promise.resolve('offline-message-id');
            }})};
            this.apps.push(app); events.apps.push(name); return app;
        }
    };
    const credentials = {'../config/admob-app-id-6159460161-firebase-adminsdk-r2shn-9e77fbe119.json': {project_id: 'weather-offline'},
        '../config/todayair-74958-firebase-adminsdk-2n8hn-68ad361049.json': {project_id: 'air-offline'}};
    const globals = {log: h.logger([]), console: {log() {}, info() {}},
        process: {env: {NODE_ENV: 'test'}}, __dirname: path.join(server, 'lib'), Buffer, Promise};
    const providers = h.load('lib/pushProviders.js', Object.assign({'firebase-admin': admin}, credentials), globals);
    function dependencies(relative) {
        const deps = {};
        for (const match of fs.readFileSync(path.join(server, relative), 'utf8').matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
            deps[match[1]] = function UnexpectedCollaborator() {};
        }
        return deps;
    }
    const deps = Object.assign(dependencies('controllers/controllerPush.js'), credentials,
        {'../lib/pushProviders': providers,
        'node-gcm': {Sender: function () {}}, '../config/config': config,
        dnscache: () => {}, async: {}, request: {}, i18n: {}});
    const Controller = h.load('controllers/controllerPush.js', deps, globals);
    Controller.prototype.requestDailySummary = (info, callback) => callback(null, {title: 'Offline title', text: 'Offline body'});
    Controller.prototype.sendAndroidNotification = (info, notification, callback) => {
        events.gcm.push(info.registrationId); callback(null, 'legacy-gcm-result');
    };
    const Alert = h.load('controllers/alert.push.controller.js', Object.assign(
        dependencies('controllers/alert.push.controller.js'), {'./controllerPush': Controller, '../config/config': config}), globals);
    return {events, controller: new Controller(), alert: new Alert()};
}

function send(controller, method, info) {
    return new Promise(resolve => controller[method](info, {title: 'Offline title', text: 'Offline body'},
        (error, result) => resolve({error, result})));
}

async function dispatch(fixture, mode, info) {
    let calls = 0;
    const result = await new Promise(resolve => {
        const callback = (error, value) => { calls++; resolve({error, value}); };
        if (mode === 'alarm') { fixture.controller.sendNotification(info, callback); }
        else { fixture.alert._sendNotification(info, {title: 'Offline title', text: 'Offline body'}, callback); }
    });
    await new Promise(setImmediate);
    assert.equal(calls, 1);
    return result;
}

test('service startup has no New Relic import or configuration requirement', () => {
    const source = fs.readFileSync(path.join(server, 'app.js'), 'utf8');
    assert.doesNotMatch(source, /require\(['"]newrelic['"]\)/);
    const config = h.load('config/config.js', {}, {process: {env: {}}});
    assert.equal(Object.hasOwn(config.keyString, 'newrelic'), false);
    assert.equal(fs.existsSync(path.join(server, 'newrelic.js')), false);
    assert.equal(require('../../package.json').dependencies.newrelic, undefined);
});

test('retired direct APNs needs no package, settings or startup feedback hook', () => {
    const config = h.load('config/config.js', {}, {process: {env: {APN_KEY_PATH: 'obsolete', APN_CERT_PATH: 'obsolete'}}});
    assert.deepEqual(Object.keys(config.push).filter(key => /^apn/i.test(key)), []);
    assert.equal(require('../../package.json').dependencies.apn, undefined);
    assert.doesNotMatch(fs.readFileSync(path.join(server, 'app.js'), 'utf8'), /apnFeedback/);
});

test('constructing a push router/controller does not initialize Firebase or read credentials', () => {
    const fixture = pushHarness();
    assert.equal(fixture.events.apps.length, 0);
    assert.equal(fixture.events.credentials.length, 0);
});

for (const mode of ['alarm', 'alert']) {
    test(mode + ': legacy iOS registration without FCM fails explicitly without sending', async () => {
        const fixture = pushHarness();
        const result = await dispatch(fixture, mode, {type: 'ios', registrationId: 'private-legacy-device', cityIndex: 0});
        assert(result.error);
        assert.match(result.error.message, /FCM token is required for iOS/);
        assert.doesNotMatch(result.error.message, /private-legacy-device/);
        assert.equal(result.value, undefined);
        assert.equal(fixture.events.sends.length, 0);
        assert.equal(fixture.events.gcm.length, 0);
        assert.equal(fixture.events.credentials.length, 0);
    });
    test(mode + ': FCM takes priority for iOS and Android, including a legacy registration ID', async () => {
        const fixture = pushHarness();
        for (const type of ['ios', 'android']) {
            const result = await dispatch(fixture, mode, {type, registrationId: 'legacy', fcmToken: 'offline-token', cityIndex: 0});
            assert.ifError(result.error);
            assert.equal(result.value, 'offline-message-id');
        }
        assert.equal(fixture.events.sends.length, 2);
        assert.equal(fixture.events.gcm.length, 0);
        assert.equal(fixture.events.sends[0].message.data.cityIndex, '0');
    });
    test(mode + ': legacy Android dispatch is preserved', async () => {
        const fixture = pushHarness();
        const result = await dispatch(fixture, mode, {type: 'android', registrationId: 'legacy'});
        assert.ifError(result.error);
        assert.equal(result.value, 'legacy-gcm-result');
        assert.deepEqual(fixture.events.gcm, ['legacy']);
    });
}

test('FCM selects the correct app lazily and preserves message data', async () => {
    const fixture = pushHarness();
    for (const product of ['todayWeather', 'todayAir', 'todayAir']) {
        const result = await send(fixture.controller, 'sendFcmNotification', {package: product, cityIndex: 0, fcmToken: 'offline-token'});
        assert.ifError(result.error);
        const sent = fixture.events.sends[fixture.events.sends.length - 1];
        assert.equal(sent.name, product);
        assert.equal(sent.message.data.cityIndex, '0');
        assert.equal(sent.message.notification.body, 'Offline body');
    }
    assert.deepEqual(fixture.events.apps, ['todayWeather', 'todayAir']);
});

test('FCM propagates rejected sends and synchronous initialization/SDK errors', async () => {
    const rejected = Promise.reject(new Error('Offline FCM rejection')); rejected.catch(() => {});
    for (const options of [{fcmResult: rejected}, {initError: new Error('Offline FCM initialization')}, {sendError: new Error('Offline FCM send')}]) {
        const fixture = pushHarness(options);
        const result = await send(fixture.controller, 'sendFcmNotification', {fcmToken: 'offline-token'});
        assert.match(result.error.message, /Offline FCM/);
    }
});
