'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const h = require('./harness');
const server = path.resolve(__dirname, '../..');

function pushHarness(options = {}) {
    const events = {providers: [], apps: [], sends: [], credentials: []};
    const config = {serviceServer: {url: 'http://offline.invalid'}, push: Object.assign({
        gcmAccessKey: 'OFFLINE', apnKeyPath: 'config/offline.p8',
        apnKeyId: 'OFFLINEKEY', apnTeamId: 'OFFLINETEAM', apnTopic: 'test.offline'
    }, options.push)};
    const apn = {
        Provider: function (settings) {
            events.providers.push(settings);
            this.send = (note, token) => {
                events.sends.push({note, token});
                if (options.apnThrow) { throw options.apnThrow; }
                return options.apnResult || Promise.resolve({sent: [{device: token}], failed: []});
            };
        },
        Notification: function () {}
    };
    const admin = {
        apps: [],
        credential: {cert: value => { events.credentials.push(value); return {}; }},
        initializeApp: function (settings, name) {
            const app = {name, messaging: () => ({send: message => {
                events.sends.push({name, message});
                return options.fcmResult || Promise.resolve('offline-message-id');
            }})};
            this.apps.push(app); events.apps.push(name); return app;
        }
    };
    const credentials = {'../config/admob-app-id-6159460161-firebase-adminsdk-r2shn-9e77fbe119.json': {project_id: 'weather-offline'},
        '../config/todayair-74958-firebase-adminsdk-2n8hn-68ad361049.json': {project_id: 'air-offline'}};
    const globals = {log: h.logger([]), console: {log() {}, info() {}},
        process: {env: {NODE_ENV: options.production ? 'production' : 'test'}},
        __dirname: path.join(server, 'lib'), Buffer, Promise};
    let providers;
    if (fs.existsSync(path.join(server, 'lib/pushProviders.js'))) {
        providers = h.load('lib/pushProviders.js', Object.assign({apn, 'firebase-admin': admin,
            path, '../config/config': config}, credentials), globals);
    }
    const code = fs.readFileSync(path.join(server, 'controllers/controllerPush.js'), 'utf8');
    const deps = {};
    for (const match of code.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
        deps[match[1]] = function UnexpectedCollaborator() {};
    }
    Object.assign(deps, credentials, {apn, 'firebase-admin': admin, '../lib/pushProviders': providers,
        'node-gcm': {Sender: function () {}}, '../config/config': config,
        dnscache: () => {}, async: {}, request: {}, i18n: {}});
    const Controller = h.load('controllers/controllerPush.js', deps, globals);
    const controller = new Controller();
    return {events, config, controller};
}

function send(controller, method, info) {
    return new Promise(resolve => controller[method](info, {title: 'Offline title', text: 'Offline body'},
        (error, result) => resolve({error, result})));
}

test('service startup has no New Relic import or configuration requirement', () => {
    const source = fs.readFileSync(path.join(server, 'app.js'), 'utf8');
    assert.doesNotMatch(source, /require\(['"]newrelic['"]\)/);
    const config = h.load('config/config.js', {}, {process: {env: {}}});
    assert.equal(Object.hasOwn(config.keyString, 'newrelic'), false);
    assert.equal(fs.existsSync(path.join(server, 'newrelic.js')), false);
    assert.equal(require('../../package.json').dependencies.newrelic, undefined);
});

test('APNs key path, key ID and team ID read independent environment variables', () => {
    const config = h.load('config/config.js', {}, {process: {env: {
        APN_KEY_PATH: 'keys/offline.p8', APN_KEY_ID: 'KEYID', APN_TEAM_ID: 'TEAMID', APN_TOPIC: 'test.bundle'
    }}});
    assert.equal(config.push.apnKeyPath, 'keys/offline.p8');
    assert.equal(config.push.apnKeyId, 'KEYID');
    assert.equal(config.push.apnTeamId, 'TEAMID');
    assert.equal(config.push.apnTopic, 'test.bundle');
});

test('constructing a push router/controller does not initialize providers or read credentials', () => {
    const h = pushHarness();
    assert.equal(h.events.providers.length, 0);
    assert.equal(h.events.apps.length, 0);
    assert.equal(h.events.credentials.length, 0);
});

test('APNs awaits acceptance, preserves payload and reuses the provider', async () => {
    let release;
    const h = pushHarness({production: true, apnResult: new Promise(resolve => { release = resolve; })});
    let calls = 0;
    h.controller.sendIOSNotification({registrationId: 'offline-token', cityIndex: 0},
        {title: 'Title', text: 'Body'}, () => { calls++; });
    assert.equal(calls, 0);
    const settings = h.events.providers[0];
    assert.equal(settings.production, true);
    assert.equal(settings.token.key, path.join(server, 'config/offline.p8'));
    assert.equal(h.events.sends[0].note.alert, 'Title\nBody');
    assert.equal(h.events.sends[0].note.payload.cityIndex, 0);
    assert.equal(h.events.sends[0].note.topic, 'test.offline');
    release({sent: [{device: 'offline-token'}], failed: []});
    await new Promise(setImmediate);
    assert.equal(calls, 1);
    await send(h.controller, 'sendIOSNotification', {registrationId: 'offline-token', cityIndex: 1});
    assert.equal(h.events.providers.length, 1);
});

test('APNs fulfilled failure array reports rejection rather than success', async () => {
    const h = pushHarness({apnResult: Promise.resolve({sent: [], failed: [{status: '400', response: {reason: 'BadDeviceToken'}}]})});
    const result = await send(h.controller, 'sendIOSNotification', {registrationId: 'offline-token'});
    assert(result.error);
    assert.match(result.error.message, /BadDeviceToken/);
    assert.equal(result.result, undefined);
});

test('APNs rejected promise and synchronous SDK errors reach the callback', async () => {
    const rejected = Promise.reject(new Error('Offline transport failure'));
    rejected.catch(() => {});
    for (const options of [{apnResult: rejected}, {apnThrow: new Error('Offline transport failure')}]) {
        const h = pushHarness(options);
        const result = await send(h.controller, 'sendIOSNotification', {registrationId: 'offline-token'});
        assert.match(result.error.message, /Offline transport failure/);
    }
});

test('partial token configuration fails without silently selecting certificates', async () => {
    const h = pushHarness({push: {apnTeamId: ''}});
    const result = await send(h.controller, 'sendIOSNotification', {registrationId: 'offline-token'});
    assert(result.error);
    assert.equal(h.events.providers.length, 0);
});

test('token authentication requires a topic before submission', async () => {
    const h = pushHarness({push: {apnTopic: ''}});
    const result = await send(h.controller, 'sendIOSNotification', {registrationId: 'offline-token'});
    assert(result.error);
    assert.equal(h.events.sends.length, 0);
});

test('legacy certificate paths remain server-relative and use production selection', async () => {
    const h = pushHarness({production: true, push: {apnKeyPath: '', apnKeyId: '', apnTeamId: '', apnTopic: '',
        apnCertPath: 'config/aps_cert.pem', apnCertKeyPath: 'config/aps_key.pem'}});
    const result = await send(h.controller, 'sendIOSNotification', {registrationId: 'offline-token'});
    assert.ifError(result.error);
    assert.equal(h.events.providers[0].cert, path.join(server, 'config/aps_cert.pem'));
    assert.equal(h.events.providers[0].key, path.join(server, 'config/aps_key.pem'));
    assert.equal(h.events.providers[0].production, true);
    assert.equal(h.events.providers[0].token, undefined);
});

test('FCM selects the correct app lazily and preserves message data', async () => {
    const h = pushHarness();
    for (const product of ['todayWeather', 'todayAir', 'todayAir']) {
        const result = await send(h.controller, 'sendFcmNotification', {package: product, cityIndex: 0, fcmToken: 'offline-token'});
        assert.ifError(result.error);
        const sent = h.events.sends[h.events.sends.length - 1];
        assert.equal(sent.name, product);
        assert.equal(sent.message.data.cityIndex, '0');
        assert.equal(sent.message.notification.body, 'Offline body');
    }
    assert.deepEqual(h.events.apps, ['todayWeather', 'todayAir']);
});

test('FCM propagates rejection', async () => {
    const rejected = Promise.reject(new Error('Offline FCM rejection')); rejected.catch(() => {});
    const h = pushHarness({fcmResult: rejected});
    const result = await send(h.controller, 'sendFcmNotification', {fcmToken: 'offline-token'});
    assert.match(result.error.message, /Offline FCM rejection/);
});
