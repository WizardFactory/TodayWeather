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
                objects.set(key, body);
                res.setHeader('ETag', '"local"');
                return res.end();
            }
            if (req.method === 'GET') {
                gets++;
                if (!objects.has(key)) {
                    res.statusCode = 404;
                    return res.end('<Error><Code>NoSuchKey</Code></Error>');
                }
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
        assert.equal(
            (
                await h.send(port, 'POST', '/v000902/push-list', [
                    row,
                    Object.assign({}, row, { cityIndex: 1, id: 2, location: { lat: 38, long: 128 } })
                ])
            ).status,
            200
        );
        await registry.settled();
        assert.equal(registry.records.size, 2);
        assert.equal(
            (
                await h.send(port, 'POST', '/v000902/push-list', [
                    Object.assign({}, row, { location: { lat: 39, long: 129 } })
                ])
            ).status,
            200
        );
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
        assert.equal(
            (
                await h.send(port, 'PUT', '/v000902/push', {
                    oldToken: 'synthetic-token',
                    newToken: 'rotated-token'
                })
            ).status,
            200
        );
        await registry.settled();
        assert(
            Array.from(registry.records.values()).every(function (r) {
                return r.fcmToken === 'rotated-token';
            })
        );
        fail = true;
        assert.equal(
            (
                await h.send(port, 'POST', '/v000902/push-list', [
                    Object.assign({}, row, { fcmToken: 'rotated-token', name: 'not-stored' })
                ])
            ).status,
            503
        );
        fail = false;
        var restored = new Registry({ storage: storage, resolve: resolve });
        await restored.init();
        assert.equal(restored.records.size, 2);
        assert.equal(
            (await h.send(port, 'DELETE', '/v000902/push', { fcmToken: 'rotated-token', cityIndex: 0 }))
                .status,
            200
        );
        assert.equal(registry.records.size, 1);
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
        console.log(
            JSON.stringify({
                result: 'PASS',
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
                    'city zero deletion'
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
