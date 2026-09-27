'use strict';
// Push delivery from the SQLite store (#2626). Runs the real alarm and alert controllers (with the locked service
// dependencies) on a temporary PUSH_DB_PATH. Weather comes from a loopback stub serving
// fixtures/push-kma-weather.json (a v000903 KMA response from the RSS response smoke, with rain in `current`).
// FCM is replaced at lib/pushProviders.js; other sockets than loopback are refused; mongoose.connect throws.
// Finally bin/push-worker is started as its own process and must run without a listener or MongoDB connection.
// Needs NODE_PATH with the service dependency tree (npm ci of server/package-lock.json). Node 10 compatible.
var assert = require('assert');
var child = require('child_process');
var fs = require('fs');
var http = require('http');
var net = require('net');
var os = require('os');
var path = require('path');
var h = require('./push-harness');

var serverRoot = h.serverRoot;
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-push-worker-'));
var fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'push-kma-weather.json'));

var guardFile = path.join(tmp, 'guard.js');
fs.writeFileSync(guardFile, [
    "'use strict';",
    "var net = require('net'); var http = require('http');",
    "function fail(what) { process.stderr.write('GUARD ' + what + '\\n'); throw new Error('push-worker must not ' + what); }",
    "var connect = net.Socket.prototype.connect;",
    "net.Socket.prototype.connect = function () {",
    "    var o = net._normalizeArgs(Array.prototype.slice.call(arguments))[0];",
    "    if (o.path || ['127.0.0.1', '::1', 'localhost'].indexOf(o.host || 'localhost') < 0) { fail('connect to ' + (o.host || o.path)); }",
    "    return connect.apply(this, arguments);",
    "};",
    "require('mongoose').connect = function () { fail('connect to MongoDB'); };",
    "http.Server.prototype.listen = function () { fail('listen'); };"
].join('\n'));
require(guardFile.replace(/\.js$/, ''));

var stub = http.createServer(function (req, res) {
    requests.push(req.url);
    if (/^\/v000902\/kma\/coord\//.test(req.url)) {
        res.writeHead(200, {'content-type': 'application/json'});
        return res.end(fixture);
    }
    res.writeHead(404);
    res.end();
});
var requests = [];
var sends = [];

function upsert(store, method, info) {
    return new Promise(function (resolve, reject) {
        store[method](info, function (err) { return err ? reject(err) : resolve(); });
    });
}

function base(token, cityIndex) {
    return {type: 'android', fcmToken: token, cityIndex: cityIndex, id: cityIndex, geo: [126.5312, 33.4996],
        name: 'Jeju', source: 'KMA', lang: 'ko', package: 'todayWeather', timezoneOffset: 540,
        units: {temperatureUnit: 'C', windSpeedUnit: 'm/s', pressureUnit: 'hPa', distanceUnit: 'km',
            precipitationUnit: 'mm', airUnit: 'airkorea'},
        updatedAt: new Date(), enable: true};
}

// listen is blocked for the worker; the stub server was created before, so bind through the original method.
var originalListen = net.Server.prototype.listen;
originalListen.call(stub, 0, '127.0.0.1', function () {
    var port = stub.address().port;
    process.env.PUSH_STORE = 'sqlite';
    process.env.PUSH_DB_PATH = path.join(tmp, 'push.sqlite');
    process.env.SERVICE_SERVER = 'http://127.0.0.1:' + port;
    process.env.API_SERVER = 'http://127.0.0.1:' + port;
    var logs = [];
    global.log = h.logger(logs);
    h.stubModules({'lib/pushProviders.js': {firebase: function (product) {
        return {messaging: function () {
            return {send: function (message) {
                sends.push({product: product, token: message.token, title: message.notification.title,
                    body: message.notification.body, cityIndex: message.data.cityIndex});
                if (message.token === 'dead') {
                    var err = new Error('Requested entity was not found.');
                    err.code = 'messaging/registration-token-not-registered';
                    err.errorInfo = {code: err.code};
                    return Promise.reject(err);
                }
                return Promise.resolve('projects/offline/messages/' + sends.length);
            }};
        }};
    }}});

    var store = require('../../lib/pushStore').get();
    // As in bin/push-worker and app.js (PM2 runs it with cwd server/; Manager reads utils/data relative to it).
    process.chdir(serverRoot);
    global.manager = new (require('../../controllers/controllerManager'))();
    var ControllerPush = require('../../controllers/controllerPush');
    var AlertPush = require('../../controllers/alert.push.controller');
    var now = new Date();
    var slot = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60;
    var noDay = [false, false, false, false, false, false, false];
    var everyDay = [true, true, true, true, true, true, true];

    Promise.all([
        upsert(store, 'upsertAlarm', Object.assign(base('live', 1), {pushTime: slot, dayOfWeek: everyDay})),
        upsert(store, 'upsertAlarm', Object.assign(base('skipday', 2), {pushTime: slot, dayOfWeek: noDay})),
        upsert(store, 'upsertAlarm', Object.assign(base('dead', 3), {pushTime: slot, dayOfWeek: everyDay})),
        upsert(store, 'upsertAlarm', Object.assign(base('later', 4), {pushTime: (slot + 60) % 86400,
            dayOfWeek: everyDay})),
        upsert(store, 'upsertAlert', Object.assign(base('alert', 5), {startTime: 0, endTime: 86340,
            reverseTime: false, airAlertsBreakPoint: 4}))
    ]).then(function () {
        return new Promise(function (resolve) { new ControllerPush().sendPush(slot, resolve); });
    }).then(function () {
        var alarmSends = sends.map(function (s) { return s.token; }).sort();
        assert.deepStrictEqual(alarmSends, ['dead', 'live'], JSON.stringify(sends) + '\n' + logs.slice(-20).join('\n'));
        var live = sends.filter(function (s) { return s.token === 'live'; })[0];
        assert.ok(live.title && live.body, 'alarm has a title and body');
        assert.strictEqual(live.cityIndex, '1');
        // Disabling runs after the send callback; poll the store for up to 2 s.
        var deadline = Date.now() + 2000;
        return (function poll() {
            return new Promise(function (resolve, reject) {
                store.getAlarmsByTime(slot, function (err, list) { return err ? reject(err) : resolve(list); });
            }).then(function (list) {
                var disabled = list.every(function (a) { return a.fcmToken !== 'dead'; });
                if (disabled || Date.now() > deadline) {
                    return list;
                }
                return new Promise(function (resolve) { setTimeout(resolve, 50); }).then(poll);
            });
        })();
    }).then(function (list) {
        assert.deepStrictEqual(list.map(function (a) { return a.fcmToken; }).sort(), ['live', 'skipday'],
            'the unregistered token was disabled');
        console.log('PASS alarm slot ' + slot + ': sent to live (skipday filtered by weekday, later not due), ' +
            'unregistered token disabled; title "' + sends[0].title + '"');
        sends.length = 0;
        return new Promise(function (resolve) { new AlertPush().sendAlertPushList(slot, resolve); });
    }).then(function () {
        return new Promise(function (resolve) { setTimeout(resolve, 300); });
    }).then(function () {
        assert.deepStrictEqual(sends.map(function (s) { return s.token; }), ['alert'],
            JSON.stringify(sends) + '\n' + logs.slice(-30).join('\n'));
        sends.length = 0;
        return new Promise(function (resolve) { new AlertPush().sendAlertPushList(slot, resolve); });
    }).then(function () {
        assert.deepStrictEqual(sends, [], 'no second alert within 6 hours');
        assert.ok(requests.length >= 3, 'weather requested from SERVICE_SERVER');
        console.log('PASS alert window: one rain alert sent, none again within 6 hours; ' + requests.length +
            ' weather requests to the loopback stub');
        return workerProcess(port);
    }).then(function () {
        stub.close();
        process.exit(0);
    }).catch(function (err) {
        console.error(err.stack || err);
        process.exit(1);
    });
});

function workerProcess(port) {
    return new Promise(function (resolve, reject) {
        var env = Object.assign({}, process.env, {PUSH_STORE: 'sqlite', PUSH_DB_PATH: path.join(tmp, 'push.sqlite'),
            SERVICE_SERVER: 'http://127.0.0.1:' + port, NODE_ENV: 'test'});
        var p = child.spawn(process.execPath, ['-r', guardFile, path.join(serverRoot, 'bin', 'push-worker')],
            {cwd: serverRoot, env: env, stdio: ['ignore', 'pipe', 'pipe']});
        var out = '';
        var timer = setTimeout(function () {
            p.kill();
            reject(new Error('push-worker did not start: ' + out));
        }, 20000);
        function check(chunk) {
            out += chunk;
            if (/GUARD /.test(out)) {
                clearTimeout(timer);
                p.kill();
                return reject(new Error(out));
            }
            if (/push-worker started store=sqlite/.test(out)) {
                clearTimeout(timer);
                setTimeout(function () {
                    p.kill();
                    assert.ok(!/GUARD /.test(out), out);
                    console.log('PASS bin/push-worker runs on the SQLite store without a listener or MongoDB connection');
                    resolve();
                }, 1500);
            }
        }
        p.stdout.on('data', check);
        p.stderr.on('data', check);
        p.on('exit', function (code, signal) {
            if (!signal) {
                clearTimeout(timer);
                reject(new Error('push-worker exited ' + code + ': ' + out));
            }
        });
    });
}
