'use strict';
// Execute the existing TodayWeather Push factory unchanged. Only browser/native services
// are adapters; $http sends real loopback HTTP to the mounted production routers.
var fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
var send = require('./push-harness').send;
module.exports = function (port) {
    var push, pending = [], timers = [], saved = {}, requests = [], failures = [];
    var cities = [
        { name: 'Current', source: 'KMA', location: { lat: 37, long: 127 } },
        { name: 'Fixed', source: 'KMA', location: { lat: 38, long: 128 } }
    ];
    function http(options) {
        var success, error;
        var url = new URL(options.url);
        assert.equal(url.hostname, '127.0.0.1');
        assert.equal(Number(url.port), port);
        requests.push(JSON.parse(JSON.stringify(options)));
        pending.push(send(port, options.method, url.pathname, options.data, options.headers).then(function (res) {
            if (res.status >= 400) { if (error) error(res.body, res.status); }
            else if (success) success(res.body);
            return res;
        }));
        return { success: function (fn) { success = fn; return this; }, error: function (fn) { error = fn; return this; } };
    }
    var storage = {
        get: function (key) { return saved[key] && JSON.parse(JSON.stringify(saved[key])); },
        set: function (key, value) { saved[key] = JSON.parse(JSON.stringify(value)); }
    };
    var util = { uuid: 'smoke', version: 'client-smoke', language: 'ko', ga: {
        trackEvent: function () {}, trackException: function (err) { failures.push(err); }
    } };
    var context = {
        angular: { module: function () { return { factory: function (name, factory) {
            push = factory(http, storage, util, {}, { getCityOfIndex: function (index) { return cities[index]; } },
                { getAllUnits: function () { return { airUnit: 'airkorea' }; } }, {}, {});
        } }; } },
        clientConfig: { serverUrl: 'http://127.0.0.1:' + port, package: 'todayWeather' },
        Date: Date, console: { log: function () {}, error: function () {} },
        setTimeout: function (fn, delay) { timers.push({ fn: fn, delay: delay }); }
    };
    var filename = path.resolve(__dirname, '../../../client/www/js/service.push.js');
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename: filename });
    async function flush(status) {
        assert.equal(failures.length, 0, 'client factory must not swallow an exception');
        var batch = pending.splice(0);
        assert(batch.length > 0, 'client must issue a request');
        var results = await Promise.all(batch);
        results.forEach(function (res) { assert.equal(res.status, status || 200); });
        return results;
    }
    return {
        push: push, cities: cities, storage: storage, requests: requests, flush: flush,
        reopen: function () {
            push.loadPushInfo();
            assert.equal(timers.length, 1);
            assert.equal(timers[0].delay, 3000, 'existing startup re-registration delay');
            timers.shift().fn(); // deterministic timer only; do not change client implementation
        }
    };
};
