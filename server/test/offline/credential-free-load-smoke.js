'use strict';
// Real modules with the locked dependency tree (#2589): the geo and push controllers and the
// service app must load with no Kakao/Daum keys, Firebase JSON or APNs files.
// Each scenario runs in a fresh child process; outbound sockets are refused; Mongo connect is stubbed.
const assert = require('assert');
const path = require('path');
const child = require('child_process');
const net = require('net');
const serverRoot = path.resolve(__dirname, '../..');
const scenarios = {
    unset: undefined,
    'not-json': 'SMOKE-NOT-JSON',
    'not-array': '{"key":"SMOKE-OBJECT"}'
};
const scenario = process.argv[2];

if (!scenario) {
    for (const name of Object.keys(scenarios)) {
        const run = child.spawnSync(process.execPath, [__filename, name], {stdio: 'inherit', env: process.env, timeout: 30000});
        if (run.error) { throw run.error; }
        if (run.status !== 0) { process.exit(run.status || 1); }
    }
    process.exit(0);
}

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
    const settings = net._normalizeArgs(args)[0];
    if (settings.path || !['127.0.0.1', '::1', 'localhost'].includes(settings.host || 'localhost')) {
        throw new Error('External network connection forbidden in credential-free load smoke');
    }
    return originalConnect.apply(this, args);
};

async function main() {
    process.chdir(serverRoot);
    process.env.SERVER_MODE = 'service'; process.env.NODE_ENV = 'test';
    for (const name of ['KAKAO_SECRET_KEYS', 'DAUM_SECRET_KEYS', 'GOOGLE_APPLICATION_CREDENTIALS']) { delete process.env[name]; }
    const config = require('../../config/config');
    config.logToken = {};
    // Gather-host shape: the edited host config.js has no key entry (or an unusable value).
    if (scenarios[scenario] === undefined) {
        delete config.keyString.kakao_keys; delete config.keyString.daum_keys;
    } else {
        config.keyString.kakao_keys = scenarios[scenario]; config.keyString.daum_keys = scenarios[scenario];
    }
    const Logger = require('../../lib/log');
    global.log = new Logger();
    const warnings = [];
    const warn = global.log.warn;
    global.log.warn = function () { warnings.push(Array.prototype.join.call(arguments, ' ')); return warn.apply(this, arguments); };
    for (const file of ['admob-app-id-6159460161-firebase-adminsdk-r2shn-9e77fbe119.json',
        'todayair-74958-firebase-adminsdk-2n8hn-68ad361049.json']) {
        assert.throws(() => require.resolve('../../config/' + file), {code: 'MODULE_NOT_FOUND'}, 'no Firebase credentials present');
    }
    assert.throws(() => require.resolve('apn'), {code: 'MODULE_NOT_FOUND'});

    const ControllerPush = require('../../controllers/controllerPush');
    const AlertPush = require('../../controllers/alert.push.controller');
    const GeoController = require('../../controllers/geo.controller');
    assert.ok(new ControllerPush() && new AlertPush(), 'push controllers construct');
    assert.equal(require('firebase-admin').apps.length, 0, 'no Firebase app at load');

    const geo = new GeoController(37.495, 127.033, 'ko');
    geo.axios = {get: () => { throw new Error('Unexpected Kakao request'); }};
    const err = await new Promise(resolve => geo._getAddressFromKakao(resolve));
    assert.match(err && err.message, /Kakao API key is not configured \(kakao_keys\)/);
    const req = {params: {lat: 37.495, lon: 127.033}, query: {}};
    const next = await new Promise(resolve => new GeoController(37.495, 127.033, 'ko').location2address(req, {}, resolve));
    assert.match(next && next.message, /Kakao API key is not configured \(kakao_keys\)/);
    assert.equal(warnings.filter(line => /kakao_keys/.test(line)).length, 1);
    assert.equal(warnings.some(line => /SMOKE-/.test(line)), false, 'key values are not logged');

    const mongoose = require('mongoose');
    mongoose.connect = function (url, options, callback) { callback(null, {name: 'offline-only'}); };
    const app = require('../../app');
    const http = require('http');
    const listener = http.createServer(app);
    try {
        await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
        const response = await new Promise((resolve, reject) => {
            http.get({host: '127.0.0.1', port: listener.address().port, path: '/health'}, res => {
                let body = ''; res.on('data', data => { body += data; });
                res.on('end', () => resolve({status: res.statusCode, body}));
            }).on('error', reject);
        });
        assert.deepEqual(response, {status: 200, body: 'OK'});
    } finally { await new Promise(resolve => listener.close(resolve)); }
    assert.equal(require('firebase-admin').apps.length, 0);
    console.log(`PASS ${scenario}: controllerPush, alert.push, geo.controller and service app load; ` +
        'Kakao call and location2address return the missing-key error; /health OK; no Firebase app');
}

main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
