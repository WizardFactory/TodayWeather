'use strict';

// Real CommonJS dependency graph and SDK imports, no app startup. Only loopback
// HTTP is permitted. Requires the server dependencies (including native modules).
var assert = require('assert');
var child = require('child_process');
var http = require('http');
var net = require('net');
var Module = require('module');
var fs = require('fs');
var mode = process.argv[2];

if (!mode) {
    ['unset', 'removed', 'invalid', 'configured'].forEach(function (scenario) {
        // Never inherit provider credentials or deployment settings.
        var env = {PATH: process.env.PATH, NODE_PATH: process.env.NODE_PATH, SERVER_MODE: 'gather'};
        if (scenario === 'invalid') { env.KAKAO_SECRET_KEYS = 'invalid-SYNTHETIC_SECRET'; }
        if (scenario === 'configured') { env.KAKAO_SECRET_KEYS = '["first","second"]'; }
        var result = child.spawnSync(process.execPath, [__filename, scenario], {
            env: env, encoding: 'utf8', timeout: 15000
        });
        assert.ifError(result.error);
        assert.strictEqual(result.status, 0, scenario + '\n' + result.stdout + result.stderr);
        process.stdout.write(result.stdout);
    });
} else {
    var connect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function () {
        var options = net._normalizeArgs(Array.from(arguments))[0];
        assert.ok(!options.path && ['127.0.0.1', '::1', 'localhost'].includes(options.host || options.hostname || 'localhost'),
            'external network forbidden');
        return connect.apply(this, arguments);
    };
    var read = fs.readFileSync;
    fs.readFileSync = function (file) {
        assert.ok(!/firebase-adminsdk|\.(pem|p12|p8)$/i.test(String(file)), 'credential file read forbidden');
        return read.apply(this, arguments);
    };
    var load = Module._load;
    Module._load = function (name) {
        assert.ok(name !== 'apn' && !/firebase-adminsdk|\.(pem|p12|p8)$/i.test(name), 'credential module read forbidden');
        return load.apply(this, arguments);
    };
    var warnings = [];
    global.log = {info: function () {}, debug: function () {}, error: function () {},
        warn: function (message) { warnings.push(message); }};
    var firebase = require('firebase-admin');
    firebase.initializeApp = function () { throw new Error('Firebase initialization forbidden'); };
    var config = require('../../config/config');
    if (mode === 'removed') { delete config.keyString.kakao_keys; }
    var Geo = require('../../controllers/geo.controller');
    var Push = require('../../controllers/controllerPush');
    assert.ok(new Push());
    assert.strictEqual(firebase.apps.length, 0);
    assert.strictEqual(warnings.length, 0);

    async function run() {
        var geo = new Geo(37.5, 127, 'ko');
        if (mode !== 'configured') {
            var callbacks = 0;
            geo.axios = {get: function () { throw new Error('No provider request expected'); }};
            geo.location2address({params: {}, query: {}}, {}, function (err) {
                callbacks++;
                assert.ok(err instanceof Error && /Kakao.*KAKAO_SECRET_KEYS/.test(err.message));
            });
            assert.strictEqual(callbacks, 1);
            new Geo()._getAddressFromKakao(function (err) { assert.ok(err instanceof Error); });
            assert.strictEqual(warnings.length, 1);
            assert.ok(!warnings[0].includes('SYNTHETIC_SECRET'));
        } else {
            var received = [];
            var peer = http.createServer(function (req, res) {
                received.push(req.headers.authorization);
                var url = new URL(req.url, 'http://localhost');
                assert.strictEqual(url.searchParams.get('x'), '127');
                assert.strictEqual(url.searchParams.get('y'), '37.5');
                res.setHeader('content-type', 'application/json');
                if (received.length === 1) { res.statusCode = 503; res.end('{}'); return; }
                res.end(JSON.stringify({meta: {total_count: 2}, documents: [{
                    region_type: 'H', address_name: 'Synthetic address', region_1depth_name: 'Region',
                    region_2depth_name: 'City', region_3depth_name: 'Town', region_4depth_name: ''
                }]}));
            });
            await new Promise(function (resolve, reject) {
                peer.once('error', reject);
                peer.listen(0, '127.0.0.1', resolve);
            });
            try {
                var axios = geo.axios;
                geo.axios = {get: function (url, options) {
                    assert.ok(url.startsWith('https://dapi.kakao.com/'));
                    return axios.get('http://127.0.0.1:' + peer.address().port + new URL(url).search,
                        Object.assign({}, options, {proxy: false}));
                }};
                var req = {params: {}, query: {}};
                await new Promise(function (resolve, reject) {
                    geo.location2address(req, {}, function (err) { if (err) { reject(err); } else { resolve(); } });
                });
                assert.strictEqual(req.country, 'KR');
                assert.strictEqual(req.params.region, 'Region');
                assert.strictEqual(req.params.city, 'City');
                assert.strictEqual(req.params.town, 'Town');
                assert.deepStrictEqual(received, ['KakaoAK first', 'KakaoAK second']);
                assert.strictEqual(warnings.length, 0);
            } finally {
                await new Promise(function (resolve) { peer.close(resolve); });
            }
        }
        // Address conversion executes the real request/XML/coordinate pipeline.
        // Missing Kakao keys must reach Google directly; transport stays loopback.
        var addressRequests = [];
        var addressPeer = http.createServer(function (req, res) {
            if (req.url.startsWith('/google')) {
                addressRequests.push('google');
                res.setHeader('content-type', 'application/xml');
                res.end('<GeocodeResponse><status>OK</status><result><geometry><location>' +
                    '<lat>37.5</lat><lng>127</lng></location></geometry></result></GeocodeResponse>');
            } else {
                addressRequests.push(req.headers.authorization);
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({meta: {total_count: 1}, documents: [{x: '127', y: '37.5'}]}));
            }
        });
        await new Promise(function (resolve, reject) {
            addressPeer.once('error', reject); addressPeer.listen(0, '127.0.0.1', resolve);
        });
        var request = require('request'), realGet = request.get;
        var addressAxios = require('axios'), realAxiosGet = addressAxios.get;
        var local = 'http://127.0.0.1:' + addressPeer.address().port;
        request.get = function (url, options, callback) {
            assert.ok(url.startsWith('https://maps.googleapis.com/'));
            return realGet(local + '/google', {proxy: null}, callback);
        };
        addressAxios.get = function (url, options) {
            assert.strictEqual(mode, 'configured', 'no Kakao request without configured keys');
            assert.ok(url.startsWith('https://dapi.kakao.com/'));
            return realAxiosGet(local + '/kakao', Object.assign({}, options, {proxy: false}));
        };
        global.log.silly = function () {};
        try {
            var convertAddress = require('../../utils/convertGeocode');
            for (var i = 0; i < 2; i++) {
                var coord = await new Promise(function (resolve, reject) {
                    convertAddress('Region', 'City', 'Town', function (err, result) {
                        if (err) { reject(err); } else { resolve(result); }
                    });
                });
                assert.strictEqual(Number(coord.lat), 37.5);
                assert.strictEqual(Number(coord.lon), 127);
                assert.ok(Number.isFinite(coord.mx) && Number.isFinite(coord.my));
            }
            if (mode !== 'configured') {
                assert.deepStrictEqual(addressRequests, ['google', 'google']);
                assert.strictEqual(warnings.length, 2, 'one warning per Geo/address module');
                assert.ok(warnings.every(function (message) { return !message.includes('SYNTHETIC_SECRET'); }));
            } else {
                assert.strictEqual(addressRequests.length, 2);
                assert.ok(addressRequests.every(function (key) { return ['KakaoAK first', 'KakaoAK second'].includes(key); }));
                assert.strictEqual(warnings.length, 0);
            }
        } finally {
            request.get = realGet; addressAxios.get = realAxiosGet;
            await new Promise(function (resolve) { addressPeer.close(resolve); });
        }
        assert.strictEqual(firebase.apps.length, 0);
        console.log('PASS real controller loads without push credentials; Kakao ' + mode);
    }
    run().catch(function (err) { console.error(err); process.exitCode = 1; });
}
