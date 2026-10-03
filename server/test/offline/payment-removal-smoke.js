'use strict';
// Real app.js, Express, five version indexes, gateway, push validation and v903
// geo redirect; DB/controllers/providers are explicit offline collaborators.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const h = require('./harness');
const root = path.resolve(__dirname, '../..');
const express = require('express');
const versions = ['v000705', 'v000803', 'v000901', 'v000902', 'v000903'];
const env = {SERVER_MODE: 'service', NODE_ENV: process.argv[2] || 'test', DB_DATA_VERSION: '2.0'};
const globals = {process: {env}, __dirname: root, console, Buffer, global: {}};
const logger = h.logger([]);
const config = h.load('config/config.js', {}, globals);
const calls = {db: 0, billing: 0, collection: 0, geo: 0};
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function () {
    const options = net._normalizeArgs(arguments)[0];
    assert(!options.path && ['127.0.0.1', '::1', 'localhost'].includes(options.host || 'localhost'), 'External network forbidden');
    return originalConnect.apply(this, arguments);
};
const passthrough = (req, res, next) => next();
function dependencies(file) {
    const deps = {};
    for (const match of fs.readFileSync(path.join(root, file), 'utf8').matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
        if (/receiptValidation|in-app-purchase/.test(match[1])) { calls.billing++; throw new Error('Billing import: ' + match[1]); }
        deps[match[1]] = passthrough;
    }
    deps.express = express;
    return deps;
}
function load(file, overrides) {return h.load(file, Object.assign(dependencies(file), overrides), Object.assign({}, globals, {log: logger}));}
function noBackground() {calls.collection++; throw new Error('Collection forbidden');}
function Manager() {}
Manager.prototype.startManager = Manager.prototype.startScrape = Manager.prototype.start = noBackground;
const push = load('routes/v000705/routePushNotification.js', {
    async: require('async'), '../../config/config': config,
    '../../controllers/controllerPush': Manager, '../../controllers/alert.push.controller': Manager
});
const geo = load('routes/v000903/route.geo.v000903.js', {
    '../../config/config': config, async: require('async'), request: (url, options, cb) => {
        calls.geo++; assert(url.includes('/geocode/v000903/coord/37.5,127.1'));
        cb(null, {statusCode: 200}, {country: 'KR', kmaAddress: {name1: 'Seoul', name2: 'Songpa', name3: 'Jamsil'}});
    }
});
const gateway = require('../../routes/gateway').createGatewayRouter({
    geocoder: {coord: () => {throw new Error('Unexpected provider request');}}
});
const routers = {};
for (const version of versions) {
    const overrides = {'../v000705/routePushNotification': push, './routePushNotification': push,
        fs: {exists: (file, cb) => cb(false)},
        jsonwebtoken: {sign: () => 'offline-token', decode: () => ({id: 'todayweather', app: 'TodayWeather'})}};
    if (version === 'v000903') {overrides['./route.geo.v000903'] = geo;}
    routers['./routes/' + version] = load('routes/' + version + '/index.js', overrides);
}
const app = load('app.js', Object.assign(routers, {
    './config/env': {}, cors: require('cors'), path,
    'serve-favicon': () => passthrough, 'cookie-parser': () => passthrough,
    'body-parser': require('body-parser'), 'express-session': require('express-session'),
    mongoose: {connect: (url, options, cb) => {calls.db++; cb(null, {name: 'offline'});}},
    './config/config': config, './lib/log': function () {return logger;},
    './controllers/controllerManager': Manager, './controllers/kma/kma.town.short.rss.controller': Manager,
    './routes/gateway': gateway, i18n: {configure() {}, init: passthrough}
}));
app.set('env', env.NODE_ENV);
// Render auth responses without filesystem templates; 404 still uses Express.
app.engine('jade', (file, options, callback) => callback(null, options.message || options.title));
async function request(listener, url, method, headers, payload) {
    return new Promise((resolve, reject) => {
        const data = (method === 'POST') ? JSON.stringify(payload || {}) : '';
        const req = http.request({host: '127.0.0.1', port: listener.address().port, path: url,
            method: method || 'GET', headers: Object.assign({'content-type': 'application/json', 'content-length': Buffer.byteLength(data)}, headers)}, res => {
            let body = ''; res.on('data', data => {body += data;});
            res.on('end', () => resolve({status: res.statusCode, body, headers: res.headers}));
        });
        req.on('error', reject); req.setTimeout(3000, () => req.destroy(new Error('HTTP timeout')));
        req.end(data);
    });
}
(async () => {
    const listener = http.createServer(app);
    try {
        await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
        assert.equal(calls.db, 1); assert.equal(calls.billing, 0); assert.equal(calls.collection, 0);
        const health = await request(listener, '/health'); assert.equal(health.status, 200); assert.equal(health.body, 'OK');
        const auth = await request(listener, '/v000803', 'POST', {}, {id: 'todayweather', password: 'wizard'});
        assert.equal(auth.status, 200); assert.equal(auth.body, 'offline-token');
        for (const version of versions) {
            for (const method of ['GET', 'POST']) {
                const headers = version === 'v000803' && method === 'POST' ? {bearertoken: 'offline-token'} : {};
                const retired = '/' + version + '/check-purchase', unknown = '/' + version + '/not-a-route';
                const response = await request(listener, retired, method, headers, {type: 'ios', receipt: 'synthetic'});
                const control = await request(listener, unknown, method, headers);
                assert.equal(response.status, 404); assert.equal(response.status, control.status);
                assert.match(response.headers['content-type'], /text\/html/);
                assert.equal(response.body.split(retired).join('/UNKNOWN'), control.body.split(unknown).join('/UNKNOWN'));
                console.log('PASS ' + env.NODE_ENV + ' ' + method + ' ' + retired + ': existing unmatched 404 HTML');
            }
            const preflight = await request(listener, '/' + version + '/check-purchase', 'OPTIONS', {'origin': 'https://offline.invalid', 'access-control-request-method': 'POST'});
            assert.equal(preflight.status, 204); assert.equal(preflight.headers['access-control-allow-origin'], '*');
            const invalidPush = await request(listener, '/' + version + '/push', 'POST', version === 'v000803' ? {bearertoken: 'offline-token'} : {});
            assert.equal(invalidPush.status, 403); assert.equal(invalidPush.body, 'invalid push info registrationId and fcmToken');
        }
        const unauth = await request(listener, '/v000803/check-purchase', 'POST');
        const unknownAuth = await request(listener, '/v000803/not-a-route', 'POST');
        assert.equal(unauth.status, 500); assert.equal(unauth.body, 'Not found id.'); assert.equal(unauth.body, unknownAuth.body);
        for (const prefix of ['/weather', '/weather/v000903', '/geocode/v000903']) {
            const invalid = await request(listener, prefix + '/coord/0,0'); assert.equal(invalid.status, 404);
            assert.equal(invalid.headers['access-control-allow-origin'], '*'); assert.equal(invalid.headers['set-cookie'], undefined);
        }
        const redirect = await request(listener, '/v000903/geo/37.5,127.1');
        assert.equal(redirect.status, 302); assert.equal(redirect.headers.location, '../kma/addr/Seoul/Songpa/Jamsil');
        assert.equal(calls.geo, 1); assert.equal(calls.billing, 0); assert.equal(calls.collection, 0);
        console.log('PASS health, CORS preflight, five real push validation routes, gateway weather/geocode boundaries, geo redirect and v000803 auth; explicit offline collaborators, no external calls');
    } finally {await new Promise(resolve => listener.close(resolve)); net.Socket.prototype.connect = originalConnect;}
})().catch(error => {console.error(error); process.exitCode = 1;});
