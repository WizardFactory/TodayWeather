'use strict';

// Complete modules with synthetic configuration and explicit provider boundaries.
var assert = require('assert');
var h = require('./harness');
var async = require('async');

function geo(value) {
    var warnings = [];
    var config = {keyString: {daum_keys: '[]', kakao_keys: value}};
    var Controller = h.load('controllers/geo.controller.js', {
        axios: {get: function () { throw new Error('Unexpected provider request'); }},
        async: async, request: function () { throw new Error('Unexpected HTTP'); },
        dnscache: function () {}, '../config/config': config
    }, {log: {info: function () {}, debug: function () {}, warn: function (message) { warnings.push(message); }}});
    return {Controller: Controller, config: config, warnings: warnings};
}

function call(controller) {
    return new Promise(function (resolve) {
        controller._getAddressFromKakao(function (err, result) { resolve({err: err, result: result}); });
    });
}

async function run() {
    var invalid = [undefined, '', 'not-json-SYNTHETIC_SECRET', 'null', '{}', '"key"', '[]',
        '[null, 42, "", "   "]'];
    for (var value of invalid) {
        var f = geo(value);
        assert.strictEqual(f.warnings.length, 0, 'configuration must be read lazily');
        for (var country of [undefined, 'KR']) {
            var controller = new f.Controller(37.5, 127, 'ko', country);
            var result = await call(controller);
            assert.ok(result.err && /Kakao.*KAKAO_SECRET_KEYS/.test(result.err.message));
            await new Promise(function (resolve) {
                controller.location2address({params: {}, query: {}}, {}, function (err) {
                    assert.ok(err && /Kakao.*KAKAO_SECRET_KEYS/.test(err.message), 'preserve the provider error');
                    resolve();
                });
            });
        }
        assert.strictEqual(f.warnings.length, 1, 'warn once across calls and instances');
        assert.ok(!f.warnings[0].includes('SYNTHETIC_SECRET'), 'no raw credential text');
    }
    console.log('PASS missing/invalid Kakao keys load lazily, warn once and return clear errors');

    var valid = geo('not-json');
    // Configure after require, before first use: proves this is lazy initialization.
    valid.config.keyString.kakao_keys = '[null,"","   ","first","second"]';
    var controller = new valid.Controller(37.5, 127, 'ko');
    var attempts = [];
    var body = {meta: {total_count: 2}, documents: []};
    controller.axios = {get: function (url, options) {
        attempts.push(options.headers.Authorization);
        var parsed = new URL(url);
        assert.strictEqual(parsed.searchParams.get('x'), '127');
        assert.strictEqual(parsed.searchParams.get('y'), '37.5');
        return attempts.length === 1 ? Promise.reject(new Error('synthetic provider failure')) :
            Promise.resolve({data: body});
    }};
    var result = await call(controller);
    assert.ifError(result.err);
    assert.strictEqual(result.result, body);
    assert.deepStrictEqual(attempts, ['KakaoAK first', 'KakaoAK second']);
    assert.strictEqual(valid.warnings.length, 0);
    console.log('PASS configured key order, retries and longitude/latitude order');

    var exhausted = geo('["first","second"]');
    controller = new exhausted.Controller(37.5, 127, 'ko');
    var error = new Error('synthetic provider failure');
    var count = 0;
    controller.axios = {get: function () { count++; return Promise.reject(error); }};
    result = await call(controller);
    assert.strictEqual(result.err, error);
    assert.strictEqual(count, 2);
    console.log('PASS provider failure after exhausting configured keys');

    var config = h.load('config/config.js', {}, {process: {env: {}}});
    assert.ok(!config.keyString.kakao_keys || config.keyString.kakao_keys === '[]', 'no example keys by default');

    // The actual pushProviders module must not require Firebase JSON or initialize an app.
    var providers = h.load('lib/pushProviders.js', {'firebase-admin': {
        initializeApp: function () { throw new Error('Unexpected Firebase initialization'); }
    }});
    var Push = h.load('controllers/controllerPush.js', {
        '../lib/pushProviders': providers, 'node-gcm': {Sender: function () {}},
        '../config/config': config, '../lib/pushStore': {}, async: async, request: {},
        './controllerTown24h': function () {}, '../lib/unitConverter': {}, '../lib/aqi.converter': {},
        '../lib/kmaTimeLib': {}, dnscache: function () {}, i18n: {}
    });
    assert.ok(new Push());
    console.log('PASS push controller loads and constructs without APNs/Firebase credentials');
}

run().catch(function (err) { console.error(err); process.exitCode = 1; });
