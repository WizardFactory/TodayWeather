'use strict';
// Push registrations in SQLite on tw-svc (#2626): real routers and controllers with PUSH_STORE=sqlite, the SQLite
// store's selection rules, and the Mongo store's query shapes (fake models, child process). Node 10 compatible.
var assert = require('assert');
var child = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var h = require('./push-harness');

if (process.argv[2] === 'mongo') {
    mongoChild();
    return;
}

var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-push-store-'));
var file = path.join(tmp, 'push.sqlite');
process.env.PUSH_STORE = 'sqlite';
process.env.PUSH_DB_PATH = file;
global.log = h.logger();
h.stubModules(h.controllerStubs({i18n: {configure: function () {}}}));

var express = require('express');
var bodyParser = require('body-parser');
var pushStore = require('../../lib/pushStore');

var app = express();
app.use(bodyParser.json());
app.use('/v000902/push', require('../../routes/v000705/routePushNotification'));
app.use('/v000902/push-list', require('../../routes/v000902/route.push.update.list'));

function units() {
    return {temperatureUnit: 'C', windSpeedUnit: 'm/s', pressureUnit: 'hPa', distanceUnit: 'km',
        precipitationUnit: 'mm', airUnit: 'airkorea'};
}

function alarm(token, cityIndex, pushTime) {
    return {type: 'android', fcmToken: token, cityIndex: cityIndex, id: cityIndex, category: 'alarm', enable: true,
        name: 'city' + cityIndex, location: {lat: 37.5, long: 127.0}, source: 'KMA', units: units(),
        timezoneOffset: 540, pushTime: pushTime, dayOfWeek: [true, true, true, true, true, true, true],
        package: 'todayWeather', uuid: 'device-1', appVersion: '1.1.0'};
}

function alert(token, cityIndex, startTime, endTime) {
    return {type: 'android', fcmToken: token, cityIndex: cityIndex, id: cityIndex, category: 'alert', enable: true,
        name: 'city' + cityIndex, location: {lat: 37.5, long: 127.0}, source: 'KMA', units: units(),
        timezoneOffset: 540, startTime: startTime, endTime: endTime, airAlertsBreakPoint: 4,
        package: 'todayWeather', uuid: 'device-1', appVersion: '1.1.0'};
}

var SQL = null;
function rows(table) {
    var db = new SQL.Database(fs.readFileSync(file));
    try {
        var result = db.exec('SELECT id, doc FROM ' + table + ' ORDER BY id');
        return result.length ? result[0].values.map(function (v) {
            var doc = JSON.parse(v[1]);
            doc._id = v[0];
            return doc;
        }) : [];
    }
    finally {
        db.close();
    }
}

function call(method) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve, reject) {
        var store = pushStore.get();
        store[method].apply(store, args.concat([function (err, result) { return err ? reject(err) : resolve(result); }]));
    });
}

var t = h.runner();
var server;
var port;
function send(method, urlPath, body) {
    return h.send(port, method, urlPath, body, {'Accept-Language': 'ko-KR,ko;q=0.9'});
}

t.test('push-list stores alarms and alerts in the SQLite file', function () {
    return send('POST', '/v000902/push-list', [alarm('tokA', 0, 3600), alarm('tokA', 1, 7200), alert('tokA', 1, 0, 86340)])
        .then(function (res) {
            assert.strictEqual(res.status, 200, res.body);
            assert.strictEqual(JSON.parse(res.body).length, 3);
            var alarms = rows('alarms');
            var alerts = rows('alerts');
            assert.deepStrictEqual(alarms.map(function (a) { return [a.fcmToken, a.cityIndex, a.pushTime]; }),
                [['tokA', 0, 3600], ['tokA', 1, 7200]]);
            assert.strictEqual(alerts.length, 1);
            assert.deepStrictEqual(alarms[0].geo, [127.0, 37.5]);
            assert.strictEqual(alarms[0].lang, 'ko');
            assert.strictEqual(alarms[0].updatedBy, 'user');
            assert.strictEqual(alarms[0].category, undefined, 'fields outside the former model are not stored');
            assert.strictEqual(alerts[0].reverseTime, false);
            assert.strictEqual(fs.statSync(file).mode & 511, 384, 'file mode 0600');
            var db = new SQL.Database(fs.readFileSync(file));
            assert.strictEqual(db.exec('PRAGMA user_version')[0].values[0][0], 1);
            db.close();
        });
});

t.test('posting the list again updates the same records', function () {
    var ids = rows('alarms').map(function (a) { return a._id; });
    return send('POST', '/v000902/push-list', [alarm('tokA', 1, 9000)]).then(function (res) {
        assert.strictEqual(res.status, 200, res.body);
        var alarms = rows('alarms');
        assert.deepStrictEqual(alarms.map(function (a) { return a._id; }), ids);
        assert.strictEqual(alarms[1].pushTime, 9000);
        assert.strictEqual(alarms[1].name, 'city1');
    });
});

t.test('PUT {newToken, oldToken} moves every alarm and alert of the old token', function () {
    return send('PUT', '/v000902/push', {newToken: 'tokB', oldToken: 'tokA'}).then(function (res) {
        assert.strictEqual(res.status, 200, res.body);
        var all = rows('alarms').concat(rows('alerts'));
        assert.strictEqual(all.length, 3);
        all.forEach(function (doc) { assert.strictEqual(doc.fcmToken, 'tokB'); });
    });
});

t.test('a token change that collides keeps the more recently updated record', function () {
    return send('POST', '/v000902/push-list', [alarm('old5', 5, 100)])
        .then(function () { return new Promise(function (resolve) { setTimeout(resolve, 5); }); })
        .then(function () { return send('POST', '/v000902/push-list', [alarm('new5', 5, 200)]); })
        .then(function () { return send('PUT', '/v000902/push', {newToken: 'new5', oldToken: 'old5'}); })
        .then(function (res) {
            assert.strictEqual(res.status, 200, res.body);
            var city5 = rows('alarms').filter(function (a) { return a.cityIndex === 5; });
            assert.deepStrictEqual(city5.map(function (a) { return [a.fcmToken, a.pushTime]; }), [['new5', 200]]);
        });
});

t.test('DELETE with cityIndex 0 removes only city 0', function () {
    return send('DELETE', '/v000902/push', {fcmToken: 'tokB', cityIndex: 0}).then(function (res) {
        assert.strictEqual(res.status, 200, res.body);
        assert.deepStrictEqual(rows('alarms').filter(function (a) { return a.fcmToken === 'tokB'; })
            .map(function (a) { return a.cityIndex; }), [1]);
        assert.strictEqual(rows('alerts').length, 1);
    });
});

t.test('unknown category returns 403 and leaves the file unchanged', function () {
    var before = fs.readFileSync(file);
    var bad = alarm('tokB', 2, 3600);
    bad.category = 'weather';
    return send('POST', '/v000902/push-list', [bad]).then(function (res) {
        assert.strictEqual(res.status, 403);
        return send('DELETE', '/v000902/push', {fcmToken: 'tokB', category: 'weather'});
    }).then(function (res) {
        assert.strictEqual(res.status, 403);
        assert.strictEqual(res.body, 'invalid push info category');
        assert.ok(fs.readFileSync(file).equals(before));
    });
});

t.test('alarm selection: exact UTC slot, enable !== false, Date fields', function () {
    var base = {type: 'ios', cityIndex: 7, id: 7, geo: [127, 37.5], pushTime: 600, updatedAt: new Date(), lang: 'en'};
    return call('upsertAlarm', Object.assign({fcmToken: 'sel1'}, base))
        .then(function () { return call('upsertAlarm', Object.assign({fcmToken: 'sel2', enable: false}, base)); })
        .then(function () { return call('upsertAlarm', Object.assign({fcmToken: 'sel3', enable: true}, base, {pushTime: 660})); })
        .then(function () { return call('getAlarmsByTime', 600); })
        .then(function (list) {
            assert.deepStrictEqual(list.map(function (a) { return a.fcmToken; }), ['sel1']);
            assert.ok(list[0].updatedAt instanceof Date);
            assert.strictEqual(typeof list[0]._id, 'number');
        });
});

t.test('FCM disabling applies to every alarm and alert of the token', function () {
    return call('disableAlarmsByFcm', 'tokB')
        .then(function () { return call('disableAlertsByFcm', 'tokB'); })
        .then(function () {
            rows('alarms').concat(rows('alerts')).filter(function (d) { return d.fcmToken === 'tokB'; })
                .forEach(function (d) {
                    assert.strictEqual(d.enable, false);
                    assert.strictEqual(d.updatedBy, 'push');
                });
        });
});

t.test('alert selection: window, reversed window and the 6-hour repeat guard', function () {
    var hour = 3600 * 1000;
    function a(token, start, end) {
        return {type: 'android', fcmToken: token, cityIndex: 3, id: 3, geo: [127, 37.5], startTime: start,
            endTime: end, reverseTime: start > end, updatedAt: new Date()};
    }
    var ids = {};
    return call('upsertAlert', a('win', 3600, 7200))
        .then(function () { return call('upsertAlert', a('rev', 80000, 3000)); })
        .then(function () { return call('upsertAlert', a('out', 10000, 20000)); })
        .then(function () { return call('upsertAlert', a('recent', 3600, 7200)); })
        .then(function () { return call('upsertAlert', a('older', 3600, 7200)); })
        .then(function () { return call('upsertAlert', Object.assign(a('off', 3600, 7200), {enable: false})); })
        .then(function () { return call('getAlertsByTime', 5000); })
        .then(function (list) {
            list.forEach(function (x) { ids[x.fcmToken] = x; });
            return call('updateAlertState', {_id: ids.recent._id, precipAlerts: {lastState: 1,
                pushTime: new Date(Date.now() - hour)}, airAlerts: undefined});
        })
        .then(function () {
            return call('updateAlertState', {_id: ids.older._id, precipAlerts: {lastState: 1,
                pushTime: new Date(Date.now() - 7 * hour)}});
        })
        .then(function () { return call('getAlertsByTime', 5000); })
        .then(function (list) {
            assert.deepStrictEqual(list.map(function (x) { return x.fcmToken; }).sort(), ['older', 'win']);
            var older = list.filter(function (x) { return x.fcmToken === 'older'; })[0];
            assert.ok(older.precipAlerts.pushTime instanceof Date);
            return call('getAlertsByTime', 1000);
        })
        .then(function (list) {
            assert.deepStrictEqual(list.map(function (x) { return x.fcmToken; }), ['rev']);
        });
});

t.test('a corrupt file keeps the last good copy for reads and is never overwritten', function () {
    var good = fs.readFileSync(file);
    return call('getAlarmsByTime', 600).then(function () {
        var garbage = Buffer.from('this is not a sqlite database, and it is longer than one hundred bytes ' +
            'so that sql.js has to parse a page header that does not exist...............');
        fs.writeFileSync(file, garbage);
        return call('getAlarmsByTime', 600).then(function (list) {
            assert.deepStrictEqual(list.map(function (a) { return a.fcmToken; }), ['sel1']);
            return call('upsertAlarm', {type: 'ios', fcmToken: 'x', cityIndex: 1, id: 1, pushTime: 1}).then(
                function () { throw new Error('write on a corrupt file succeeded'); },
                function () { assert.ok(fs.readFileSync(file).equals(garbage)); });
        }).then(function () { fs.writeFileSync(file, good); });
    });
});

t.test('a file with another user_version is refused', function () {
    var other = path.join(tmp, 'v2.sqlite');
    var db = new SQL.Database();
    db.exec('PRAGMA user_version = 2');
    fs.writeFileSync(other, Buffer.from(db.export()));
    db.close();
    var store = require('../../lib/pushStore/sqlite').create(other);
    return new Promise(function (resolve) {
        store.upsertAlarm({type: 'ios', fcmToken: 'x', cityIndex: 1, id: 1}, function (err) { resolve(err); });
    }).then(function (err) {
        assert.ok(err && /user_version 2/.test(err.message), err && err.message);
    });
});

t.test('Mongo store: token change and FCM disabling use multi; cityIndex 0 narrows removal', function () {
    var run = child.spawnSync(process.execPath, [__filename, 'mongo'], {encoding: 'utf8', timeout: 20000,
        env: Object.assign({}, process.env, {PUSH_STORE: ''})});
    assert.strictEqual(run.status, 0, run.stderr || run.stdout);
    var calls = JSON.parse(run.stdout.trim().split('\n').pop());
    var updates = calls.filter(function (c) { return c.op === 'update'; });
    assert.strictEqual(updates.length, 5, JSON.stringify(calls));
    updates.forEach(function (c) { assert.strictEqual(c.options && c.options.multi, true, JSON.stringify(c)); });
    var removes = calls.filter(function (c) { return c.op === 'remove'; });
    assert.deepStrictEqual(removes.map(function (c) { return [c.model, c.query]; }), [
        ['push', {fcmToken: 't0', cityIndex: 0}],
        ['alertpush', {fcmToken: 't0', cityIndex: 0, id: 0}]]);
});

function mongoChild() {
    global.log = h.logger();
    var calls = [];
    function fakeModel(name) {
        return {
            update: function (query, update, options, callback) {
                if (typeof options === 'function') {
                    callback = options;
                    options = undefined;
                }
                calls.push({model: name, op: 'update', query: query, options: options || null});
                callback(null, {n: 1});
            },
            remove: function (query, callback) {
                calls.push({model: name, op: 'remove', query: query});
                callback(null, {n: 1});
            }
        };
    }
    h.stubModules(h.controllerStubs({i18n: {configure: function () {}},
        'models/modelPush.js': fakeModel('push'), 'models/alert.push.model.js': fakeModel('alertpush')}));
    var ControllerPush = require('../../controllers/controllerPush');
    var AlertPush = require('../../controllers/alert.push.controller');
    var alarm = new ControllerPush();
    var alerts = new AlertPush();
    var steps = [
        function (cb) { alarm.updateFcmToken('new', 'old', cb); },
        function (cb) { alerts.updateFcmToken('new', 'old', cb); },
        function (cb) { alarm.updateRegistrationId('newReg', 'oldReg', cb); },
        function (cb) { alarm.disableByFcm('dead', cb); },
        function (cb) { alerts._disableByFcm('dead', cb); },
        function (cb) { alarm.removePushInfo({fcmToken: 't0', cityIndex: 0}, cb); },
        function (cb) { alerts.removeAlertPush({fcmToken: 't0', cityIndex: 0, id: 0}, cb); }
    ];
    (function next(i) {
        if (i === steps.length) {
            console.log(JSON.stringify(calls));
            return;
        }
        steps[i](function (err) {
            if (err) {
                console.error(err);
                process.exit(1);
            }
            next(i + 1);
        });
    })(0);
}

require('sql.js')().then(function (loaded) {
    SQL = loaded;
    return new Promise(function (resolve) {
        server = app.listen(0, '127.0.0.1', function () {
            port = server.address().port;
            resolve();
        });
    });
}).then(function () {
    return t.run();
}).then(function (failed) {
    server.close();
    process.exit(failed ? 1 : 0);
}, function (err) {
    console.error(err);
    process.exit(1);
});
