'use strict';
// Shared helpers for the push store checks (#2626). Real routers, controllers and stores are loaded through
// Node's module system; only modules named in `stubs` (by request name or by path suffix such as
// 'models/modelPush.js') are replaced. Node 10 compatible: no node:test, no optional chaining.
var Module = require('module');
var path = require('path');
var http = require('http');
var util = require('util');

var serverRoot = path.resolve(__dirname, '../..');

function stubModules(stubs) {
    var load = Module._load;
    Module._load = function (request, parent) {
        if (Object.prototype.hasOwnProperty.call(stubs, request)) {
            return stubs[request];
        }
        var resolved = null;
        try {
            resolved = Module._resolveFilename(request, parent);
        }
        catch (err) {
            return load.apply(this, arguments);
        }
        var keys = Object.keys(stubs);
        for (var i = 0; i < keys.length; i++) {
            if (keys[i].indexOf('/') >= 0 && resolved.slice(-keys[i].length) === keys[i]) {
                return stubs[keys[i]];
            }
        }
        return load.apply(this, arguments);
    };
}

function logger(lines) {
    var log = {};
    ['debug', 'info', 'warn', 'error', 'verbose', 'silly'].forEach(function (level) {
        log[level] = function () {
            if (lines) {
                lines.push(level + ' ' + util.format.apply(util, arguments));
            }
        };
    });
    return log;
}

/** Stubs for modules the push controllers load but these checks do not exercise. */
function controllerStubs(extra) {
    var base = {
        'node-gcm': {Sender: function () {}},
        dnscache: function () { return {}; },
        request: function () { throw new Error('Unexpected HTTP from request()'); },
        'controllers/controllerTown24h.js': function ControllerTown24h() {},
        'lib/pushProviders.js': {firebase: function () { throw new Error('Unexpected FCM send'); }}
    };
    return Object.assign(base, extra || {});
}

function send(port, method, urlPath, body, headers) {
    return new Promise(function (resolve, reject) {
        var payload = body === undefined ? '' : JSON.stringify(body);
        var req = http.request({host: '127.0.0.1', port: port, method: method, path: urlPath,
            headers: Object.assign({'content-type': 'application/json', 'content-length': Buffer.byteLength(payload)},
                headers || {})}, function (res) {
            var data = '';
            res.on('data', function (chunk) { data += chunk; });
            res.on('end', function () { resolve({status: res.statusCode, body: data}); });
        });
        req.setTimeout(5000, function () { req.abort(); reject(new Error(method + ' ' + urlPath + ' timed out')); });
        req.on('error', reject);
        req.end(payload);
    });
}

/** Minimal sequential runner that prints TAP-like lines and exits non-zero on failure. */
function runner() {
    var tests = [];
    return {
        test: function (name, fn) { tests.push({name: name, fn: fn}); },
        run: function () {
            var failed = 0;
            var index = 0;
            return tests.reduce(function (chain, t) {
                return chain.then(function () {
                    index++;
                    return Promise.resolve().then(t.fn).then(function () {
                        console.log('ok ' + index + ' - ' + t.name);
                    }, function (err) {
                        failed++;
                        console.log('not ok ' + index + ' - ' + t.name);
                        console.log('  ' + String(err && err.stack || err).split('\n').slice(0, 6).join('\n  '));
                    });
                });
            }, Promise.resolve()).then(function () {
                console.log('# pass ' + (tests.length - failed));
                console.log('# fail ' + failed);
                return failed;
            });
        }
    };
}

module.exports = {
    serverRoot: serverRoot,
    stubModules: stubModules,
    logger: logger,
    controllerStubs: controllerStubs,
    send: send,
    runner: runner
};
