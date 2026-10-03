'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const h = require('./harness');
const server = path.resolve(__dirname, '../..');
const versions = ['v000705', 'v000803', 'v000901', 'v000902', 'v000903'];
const expected = {
    v000705: ['/gather', '/town', '/daily', '/push'],
    v000803: ['/gather', '/town', '/daily', '/push', '/nation', '/test', '/geo'],
    v000901: ['/gather', '/daily', '/push', '/nation', '/kma/addr', '/dsf/coord', '/test', '/geo'],
    v000902: ['/gather', '/daily', '/push', '/push-list', '/nation', '/kma', '/dsf/coord', '/test', '/geo'],
    v000903: ['/gather', '/daily', '/push', '/push-list', '/nation', '/kma', '/dsf/coord', '/test', '/geo']
};
test('receipt implementation, obsolete live test and SDK are retired', () => {
    assert.equal(fs.existsSync(path.join(server, 'routes/v000705/receiptValidation.js')), false);
    assert.equal(fs.existsSync(path.join(server, 'test/e2e_local/test.receipt.validation.js')), false);
    assert.equal(require('../../package.json').dependencies['in-app-purchase'], undefined);
    const lock = require('../../package-lock.json');
    assert.equal(lock.packages[''].dependencies['in-app-purchase'], undefined);
    assert.equal(lock.dependencies['in-app-purchase'], undefined);
    assert.deepEqual(Object.keys(lock.packages).filter(p => p.includes('in-app-purchase')), []);
    // This root dependency has consumers unrelated to payment.
    assert.equal(typeof lock.packages['node_modules/jwt-simple'].version, 'string');
});
test('all exclusive platform secrets are ignored, adjacent API/push config survives', () => {
    const env = {APPLE_PASSWORD: 'obsolete', GOOGLE_PUBLIC_KEY: 'obsolete',
        PLAY_STORE_API_ACCESS_TOKEN: 'obsolete', PLAY_STORE_API_REFRESH_TOKEN: 'obsolete',
        PLAY_STORE_API_CLIENT_ID: 'obsolete', PLAY_STORE_API_CLIENT_SECRET: 'obsolete',
        GOOGLE_SECRET_KEY: 'offline-geocoder', GCM_ACCESS_KEY: 'offline-push'};
    const config = h.load('config/config.js', {}, {process: {env}});
    assert.equal(Object.hasOwn(config, 'platforms'), false);
    assert.equal(config.keyString.google_key, 'offline-geocoder');
    assert.equal(config.push.gcmAccessKey, 'offline-push');
});
for (const version of versions) {
    test(version + ' loads no billing module and preserves ordered adjacent mounts', () => {
        const mounts = [], deps = {};
        const filename = 'routes/' + version + '/index.js';
        const source = fs.readFileSync(path.join(server, filename), 'utf8');
        for (const match of source.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
            assert.doesNotMatch(match[1], /receiptValidation|in-app-purchase/);
            deps[match[1]] = function offlineRoute() {};
        }
        const router = {use: function (mount) {if (typeof mount === 'string') {mounts.push(mount);}}, get() {}, post() {}};
        deps.express = {Router: () => router}; deps.fs = {exists: (p, cb) => cb(false)};
        h.load(filename, deps, {log: h.logger([])});
        assert.deepEqual(mounts, expected[version]);
    });
}
