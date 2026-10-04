'use strict';
// Scheduled alarm batch through the real runtime weather path (#2677): a loopback origin fails the first
// request of every town, then recovers. FCM is a counting stub; no external connection is allowed.
var assert = require('assert'),
    http = require('http'),
    fs = require('fs'),
    path = require('path'),
    net = require('net'),
    h = require('./push-harness'),
    base = require('./push-s3.test');
var connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function () {
    var o = net._normalizeArgs(Array.prototype.slice.call(arguments))[0];
    if (['127.0.0.1', 'localhost', '::1'].indexOf(o.host || 'localhost') < 0)
        throw new Error('Nonlocal test connection');
    return connect.apply(this, arguments);
};
var fixture = fs.readFileSync(path.join(__dirname, 'fixtures/push-kma-weather.json')),
    seen = new Set(),
    requests = 0,
    failures = 0,
    active = 0,
    peak = 0;
var server = http.createServer(function (req, res) {
    requests++;
    active++;
    peak = Math.max(peak, active);
    setTimeout(function () {
        active--;
        if (!seen.has(req.url)) {
            seen.add(req.url);
            failures++;
            res.statusCode = 503;
            return res.end('{}');
        }
        res.setHeader('content-type', 'application/json');
        res.end(fixture);
    }, 15);
});
server.listen(0, '127.0.0.1', async function () {
    var runtime, dispatcher;
    try {
        process.env.SERVICE_SERVER = process.env.API_SERVER = 'http://127.0.0.1:' + server.address().port;
        process.env.PUSH_WEATHER_CONCURRENCY = '2';
        global.log = h.logger();
        global.manager = {
            leadingZeros: function (n, d) {
                return String(n).padStart(d, '0');
            }
        };
        require('mongoose').connect = function () {
            throw new Error('Unexpected MongoDB connection');
        };
        h.stubModules({
            'lib/pushProviders.js': {
                firebase: function () {
                    return {
                        options: {
                            projectId: 'synthetic-project',
                            credential: {
                                getAccessToken: async function () {
                                    return { access_token: 'synthetic-token', expires_in: 3600 };
                                }
                            }
                        }
                    };
                }
            }
        });
        runtime = require('../../lib/pushCoordinator/runtime').create();
        var storage = base.memory(),
            towns = ['삼성동', '역삼동', '논현동', '청담동', '대치동'],
            registry = await base.registry(storage, async function (loc, r) {
                var town = { first: '서울특별시', second: '강남구', third: towns[Math.round(loc.lat) % 5] };
                return { country: 'KR', town: town, zones: [], weatherKey: JSON.stringify(town) };
            }),
            records = [];
        for (var i = 0; i < 20; i++)
            records.push(
                base.record({
                    uuid: 'smoke' + i,
                    fcmToken: 'smoke-token-' + i,
                    category: 'alarm',
                    pushTime: 79200,
                    name: 'Seoul',
                    location: { lat: 30 + (i % 5), long: 127 },
                    dayOfWeek: [true, true, true, true, true, true, true]
                })
            );
        await registry.upsert(records);
        await registry.settled();
        var slot = Date.parse('2026-09-27T22:00:00Z'),
            start = Date.now(),
            now = function () {
                return slot + 1000 + (Date.now() - start);
            },
            sent = [];
        var Dispatcher = require('../../lib/pushCoordinator/dispatcher').Dispatcher,
            Engine = require('../../lib/pushCoordinator/engine').Engine;
        dispatcher = new Dispatcher({
            now: now,
            prepareRetryMs: 25,
            send: async function (p) {
                sent.push(p.record.fcmToken);
            }
        });
        var engine = new Engine({ registry: registry, storage: storage, dispatcher: dispatcher, runtime: runtime, now: now });
        await engine.tick();
        await dispatcher.idle();
        await engine.flush();
        assert.equal(sent.length, 20);
        assert.equal(new Set(sent).size, 20, 'each alarm submitted exactly once');
        assert(failures >= 5, 'every town saw an origin failure');
        assert(peak <= 2, 'origin concurrency stayed bounded: ' + peak);
        assert(requests <= 5 * 3, 'shared requests stayed bounded: ' + requests);
        var manifest;
        storage.data.forEach(function (value, key) {
            if (/campaigns\/.*manifest\.json$/.test(key)) manifest = JSON.parse(value);
        });
        assert.equal(manifest.summary.status.accepted, 20);
        assert(manifest.summary.preparationAttempts > 20, 'retries are visible in the readback');
        assert.equal(manifest.summary.transportAttempts, 20);
        assert.deepEqual(manifest.summary.failures, {});
        console.log(
            JSON.stringify({
                result: 'PASS',
                checks: ['loopback origin outage', 'bounded weather concurrency', 'exact-once submission', 'campaign summary'],
                requests: requests,
                originFailures: failures,
                peakOriginConcurrency: peak,
                preparationAttempts: manifest.summary.preparationAttempts
            })
        );
    } catch (e) {
        console.error(e.stack);
        process.exitCode = 1;
    } finally {
        if (dispatcher) dispatcher.close();
        if (runtime) runtime.close();
        server.close();
    }
});
