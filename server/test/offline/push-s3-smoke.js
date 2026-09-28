'use strict';
// Real routers, IPC, Registry, Engine and AWS SDK against local protocol peers. No module stubs.
var assert = require('assert'),
    http = require('http'),
    fs = require('fs'),
    os = require('os'),
    path = require('path');
var express = require('express'),
    bodyParser = require('body-parser'),
    AWS = require('aws-sdk');
var Registry = require('../../lib/pushCoordinator/registry').Registry,
    Dispatcher = require('../../lib/pushCoordinator/dispatcher').Dispatcher;
var Engine = require('../../lib/pushCoordinator/engine').Engine,
    Feed = require('../../lib/pushCoordinator/warningFeed').Feed;
var storageFactory = require('../../lib/pushCoordinator/storage'),
    ipc = require('../../lib/pushCoordinator/ipc');
var h = require('./push-harness');
global.log = h.logger();
process.env.PUSH_STORE = 's3';
function serve(server) {
    return new Promise(function (resolve) {
        server.listen(0, '127.0.0.1', function () {
            resolve(server.address().port);
        });
    });
}
function close(server) {
    return new Promise(function (resolve) {
        server.close(resolve);
    });
}
async function main() {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-s3-smoke-')),
        socket = path.join(dir, 'coordinator.sock');
    process.env.PUSH_SOCKET_PATH = socket;
    var objects = new Map(),
        puts = 0,
        gets = 0,
        fail = false,
        delayNextPut = false,
        delayedPut,
        sends = [],
        providerStatus = 200;
    var peer = http.createServer(function (req, res) {
        var url = new URL(req.url, 'http://localhost'),
            key = decodeURIComponent(url.pathname).replace(/^\/bucket\//, ''),
            body = '';
        if (req.method === 'GET' && url.searchParams.has('list-type')) {
            var prefix = url.searchParams.get('prefix') || '',
                keys = Array.from(objects.keys()).filter(function (k) {
                    return k.indexOf(prefix) === 0;
                });
            res.setHeader('content-type', 'application/xml');
            return res.end(
                '<ListBucketResult><IsTruncated>false</IsTruncated>' +
                    keys
                        .map(function (k) {
                            return '<Contents><Key>' + k + '</Key></Contents>';
                        })
                        .join('') +
                    '</ListBucketResult>'
            );
        }
        req.on('data', function (c) {
            body += c;
        });
        req.on('end', function () {
            if (req.method === 'PUT') {
                puts++;
                if (fail) {
                    res.statusCode = 503;
                    return res.end('<Error><Code>ServiceUnavailable</Code></Error>');
                }
                function commit() {
                    var previous = objects.get(key);
                    var etag =
                        previous === undefined
                            ? null
                            : '"' + require('crypto').createHash('md5').update(previous).digest('hex') + '"';
                    if (
                        (req.headers['if-none-match'] === '*' && previous !== undefined) ||
                        (req.headers['if-match'] && req.headers['if-match'] !== etag)
                    )
                        return false;
                    if (key.indexOf('/registrations/') >= 0)
                        assert(
                            req.headers['if-match'] || req.headers['if-none-match'],
                            'registration writes must be conditional'
                        );
                    objects.set(key, body);
                    return true;
                }
                if (delayNextPut) {
                    delayNextPut = false;
                    delayedPut = commit;
                    res.statusCode = 503; // ambiguous response; server-side operation can finish later
                    return res.end('<Error><Code>ServiceUnavailable</Code></Error>');
                }
                if (!commit()) {
                    res.statusCode = 412;
                    return res.end('<Error><Code>PreconditionFailed</Code></Error>');
                }
                res.setHeader(
                    'ETag',
                    '"' + require('crypto').createHash('md5').update(body).digest('hex') + '"'
                );
                return res.end();
            }
            if (req.method === 'GET') {
                gets++;
                if (!objects.has(key)) {
                    res.statusCode = 404;
                    return res.end('<Error><Code>NoSuchKey</Code></Error>');
                }
                res.setHeader(
                    'ETag',
                    '"' + require('crypto').createHash('md5').update(objects.get(key)).digest('hex') + '"'
                );
                return res.end(objects.get(key));
            }
            res.statusCode = 405;
            res.end();
        });
    });
    var provider = http.createServer(function (req, res) {
        var data = '';
        req.on('data', function (c) {
            data += c;
        });
        req.on('end', function () {
            sends.push(JSON.parse(data));
            res.setHeader('content-type', 'application/json');
            res.statusCode = providerStatus;
            if (providerStatus === 429) res.setHeader('retry-after', '1');
            res.end(
                providerStatus === 200
                    ? '{"name":"local-message"}'
                    : JSON.stringify({
                          error: {
                              details: [
                                  {
                                      '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
                                      errorCode: 'UNREGISTERED'
                                  }
                              ]
                          }
                      })
            );
        });
    });
    var peerPort = await serve(peer),
        sendPort = await serve(provider);
    var sdk = new AWS.S3({
        endpoint: 'http://127.0.0.1:' + peerPort,
        s3ForcePathStyle: true,
        region: 'us-east-1',
        maxRetries: 0,
        credentials: { accessKeyId: 'synthetic', secretAccessKey: 'synthetic' }
    });
    var storage = storageFactory.create({ bucket: 'bucket', prefix: 'test', client: sdk });
    var resolve = async function (loc) {
        return { zones: [String(loc.lat)], weatherKey: String(loc.lat) };
    };
    var registry = new Registry({ storage: storage, resolve: resolve });
    await registry.init();
    var socketServer = await ipc.listen(socket, registry);
    var app = express();
    app.use(bodyParser.json());
    app.use('/v000902/push-list', require('../../routes/v000902/route.push.update.list'));
    app.use('/v000902/push', require('../../routes/v000705/routePushNotification'));
    var api = http.createServer(app),
        port = await serve(api);
    var transport = require('../../lib/pushCoordinator/transport').create({
        endpoint: 'http://127.0.0.1:' + sendPort
    });
    var runtime = {
        authorize: async function () {
            return { projectId: 'synthetic-project', token: 'synthetic-access-token' };
        },
        warning: function () {
            return { title: 'Test warning', text: 'Test zone' };
        },
        alarm: async function () {
            return { title: 'Test alarm', text: 'Test' };
        },
        send: transport.send
    };
    var dispatcher = new Dispatcher({
            send: runtime.send,
            rate: 1000,
            concurrency: 16,
            now: function () {
                return now;
            }
        }),
        now = Date.parse('2026-09-28T08:01:00Z');
    var feed = new Feed({
        storage: storage,
        now: function () {
            return now;
        }
    });
    var engine = new Engine({
        registry: registry,
        storage: storage,
        dispatcher: dispatcher,
        runtime: runtime,
        feed: feed,
        warnings: true,
        now: function () {
            return now;
        }
    });
    var client = process.argv.indexOf('--client') >= 0 ? require('./push-client-harness')(port) : null;
    try {
        var row = {
            uuid: 'smoke',
            package: 'todayWeather',
            type: 'ios',
            fcmToken: 'synthetic-token',
            id: 1,
            cityIndex: 0,
            category: 'alert',
            enable: true,
            location: { lat: 37, long: 127 },
            startTime: 0,
            endTime: 86399,
            source: 'KMA',
            lang: 'ko'
        };
        if (client) {
            client.push.pushData.type = 'ios';
            client.push.pushData.fcmToken = 'synthetic-token';
            client.push.updatePushListByCityIndex([client.push.newPushAlert(1, 0, 0, 23)], 0);
            await client.flush();
            client.push.updatePushListByCityIndex([client.push.newPushAlert(2, 1, 0, 23)], 1);
            await client.flush();
            client.reopen();
            await client.flush();
            assert.equal(client.requests[2].data.length, 2, 'app reopening resubmits both cities');
            assert.equal(client.requests[2].headers['Device-Id'], 'smoke');
        } else {
            assert.equal(
                (
                    await h.send(port, 'POST', '/v000902/push-list', [
                        row,
                        Object.assign({}, row, { cityIndex: 1, id: 2, location: { lat: 38, long: 128 } })
                    ])
                ).status,
                200
            );
        }
        await registry.settled();
        assert.equal(registry.records.size, 2);
        if (client) {
            client.cities[0].location = { lat: 39, long: 129 };
            client.push.updateCityInfo(0);
            await client.flush();
        } else {
            assert.equal(
                (
                    await h.send(port, 'POST', '/v000902/push-list', [
                        Object.assign({}, row, { location: { lat: 39, long: 129 } })
                    ])
                ).status,
                200
            );
        }
        await registry.settled();
        assert.equal(registry.warningRefs(['37']).length, 0);
        assert.equal(registry.warningRefs(['39']).length, 1);
        await feed.publish([], { bootstrap: true });
        await engine.init();
        var event = { areaCode: '39', warnVar: 2, warnStress: 1, command: '1', tmFc: 202609281701, tmSeq: 1 };
        await feed.publish([event], { bootstrap: false });
        await engine.pollWarnings();
        var beforeGets = gets;
        await engine.tick();
        await dispatcher.idle();
        assert.equal(sends.length, 1);
        assert.equal(sends[0].message.data.cityIndex, '0');
        assert.equal(gets - beforeGets, 1, 'one scheduled-campaign lookup, no per-recipient S3 reads');
        await engine.flush();
        await feed.publish([Object.assign({}, event, { command: '2', tmSeq: 2 })], { bootstrap: false });
        await engine.pollWarnings();
        await engine.tick();
        await dispatcher.idle();
        assert.equal(sends.length, 1);
        if (client) {
            client.push._updateFcmToken('rotated-token');
            await client.flush();
        } else {
            assert.equal(
                (
                    await h.send(port, 'PUT', '/v000902/push', {
                        oldToken: 'synthetic-token',
                        newToken: 'rotated-token'
                    })
                ).status,
                200
            );
        }
        await registry.settled();
        assert(
            Array.from(registry.records.values()).every(function (r) {
                return r.fcmToken === 'rotated-token';
            })
        );
        fail = true;
        if (client) {
            client.push.updatePushListByCityIndex(client.push.getPushListByCityIndex(0), 0);
            await client.flush(503);
        } else {
            assert.equal(
                (
                    await h.send(port, 'POST', '/v000902/push-list', [
                        Object.assign({}, row, { fcmToken: 'rotated-token', name: 'not-stored' })
                    ])
                ).status,
                503
            );
        }
        fail = false;
        var restored = new Registry({ storage: storage, resolve: resolve });
        await restored.init();
        assert.equal(restored.records.size, 2);
        if (client) {
            client.push.removePushListByCityIndex(0);
            await client.flush();
        } else {
            assert.equal(
                (await h.send(port, 'DELETE', '/v000902/push', { fcmToken: 'rotated-token', cityIndex: 0 }))
                    .status,
                200
            );
        }
        assert.equal(registry.records.size, 1);
        if (client) {
            var alarm = client.push.newPushAlarm(3, 1, 8 * 3600, [true, true, true, true, true, true, true]);
            client.push.updatePushListByCityIndex(client.push.getPushListByCityIndex(1).concat([alarm]), 1);
            await client.flush();
            await registry.settled();
            var alarmRecord = Array.from(registry.records.values()).filter(function (r) {
                return r.category === 'alarm';
            })[0];
            assert(alarmRecord && alarmRecord.enable);
            assert.equal(alarmRecord.pushTime, client.push.date2utcSecs(alarm.time));
            assert.equal(alarmRecord.fcmToken, 'rotated-token');
            alarm.enable = false;
            client.push.updatePushListByCityIndex(client.push.getPushListByCityIndex(1), 1);
            await client.flush();
            assert.equal(
                Array.from(registry.records.values()).filter(function (r) {
                    return r.category === 'alarm';
                })[0].enable,
                false
            );
        }
        providerStatus = 429;
        var error;
        try {
            await transport.send({
                record: row,
                notification: { title: 'Test' },
                eventId: 'error-test',
                authorization: { projectId: 'synthetic', token: 'synthetic' }
            });
        } catch (e) {
            error = e;
        }
        assert.equal(error.statusCode, 429);
        assert.equal(error.retryAfterMs, 1000);
        assert.equal(sends.length, 2, 'no transport-internal retry');
        // R1: a failed response followed by a late conditional commit must never
        // overwrite a later acknowledged registration, including across restoration.
        var lateRow = Object.assign({}, row, { uuid: 'late-write', fcmToken: 'late-token' });
        var isolated = new Registry({ storage: storage, resolve: resolve });
        await isolated.init();
        await isolated.upsert([lateRow]);
        await isolated.settled();
        var lateRef = Array.from(isolated.records.values()).find(function (r) {
            return r.fcmToken === 'late-token';
        }).ref;
        delayNextPut = true;
        await assert.rejects(
            isolated.upsert([Object.assign({}, lateRow, { location: { lat: 38, long: 128 } })])
        );
        assert.equal(isolated.get(lateRef), null);
        await isolated.upsert([Object.assign({}, lateRow, { location: { lat: 39, long: 129 } })]);
        assert.equal(delayedPut(), false, 'late old PUT rejected by ETag after acknowledged new PUT');
        await isolated.settled();
        assert.equal(isolated.get(lateRef).location.lat, 39);
        delayNextPut = true;
        await assert.rejects(
            isolated.upsert([Object.assign({}, lateRow, { location: { lat: 40, long: 130 } })])
        );
        var restartStorage = storageFactory.create({ bucket: 'bucket', prefix: 'test', client: sdk });
        var restarted = new Registry({ storage: restartStorage, resolve: resolve });
        await restarted.init();
        assert.equal(
            delayedPut(),
            false,
            'restore reseal rejects outstanding writes before enabling delivery'
        );
        assert.equal(restarted.get(lateRef).location.lat, 39);
        console.log(
            JSON.stringify({
                result: 'PASS',
                clientFactory: client
                    ? 'actual service.push.js: register, reopen, location, rotate, delete, alarm, disable'
                    : 'not exercised',
                checks: [
                    'real HTTP routers',
                    'Unix socket',
                    'AWS SDK S3 PUT/GET/LIST',
                    'latest location',
                    'warning dispatch',
                    'release',
                    'token rotation',
                    '503 persistence failure',
                    'restart',
                    'city zero deletion',
                    'conditional ETag late PUT and restart fencing'
                ],
                puts: puts,
                gets: gets,
                providerSubmissions: sends.length
            })
        );
    } finally {
        transport.close();
        dispatcher.close();
        await close(api);
        await close(socketServer);
        await close(peer);
        await close(provider);
        try {
            fs.unlinkSync(socket);
        } catch (e) {}
        fs.rmdirSync(dir);
    }
}
main().catch(function (e) {
    console.error(e.stack);
    process.exitCode = 1;
});
