'use strict';
// End-to-end synthetic warning fan-out, including restore/index selection/campaign persistence.
var assert = require('assert'),
    fixture = require('./push-s3.test'),
    Registry = require('../../lib/pushCoordinator/registry');
var Dispatcher = require('../../lib/pushCoordinator/dispatcher').Dispatcher,
    Engine = require('../../lib/pushCoordinator/engine').Engine,
    Feed = require('../../lib/pushCoordinator/warningFeed').Feed;
async function main() {
    var storage = fixture.memory(),
        count = 10000,
        reads = 0,
        readKeys = [],
        put = storage.put,
        get = storage.get;
    storage.get = async function (k) {
        reads++;
        readKeys.push(k);
        return get.call(storage, k);
    };
    for (var i = 0; i < count; i++) {
        var r = fixture.record({ uuid: 'capacity-' + i, fcmToken: 'synthetic-' + i }),
            key = Registry.hash(r.uuid),
            doc = {
                schemaVersion: 2,
                key: key,
                product: r.package,
                platform: r.type,
                uuid: true,
                revision: 1,
                acceptedSequence: i + 1,
                endpoint: { fcmToken: r.fcmToken, generation: 1 },
                currentLocation: { version: 1, value: r.location, acceptedSequence: i + 1 },
                registrations: { alert: r }
            };
        await storage.put(Registry.keyOf(doc), doc);
    }
    storage.put = async function (k, v) {
        await new Promise(function (r) {
            setTimeout(r, 3);
        });
        return put.call(storage, k, v);
    };
    var begin = Date.now(),
        registry = await fixture.registry(storage),
        restore = Date.now() - begin,
        completed = [],
        first,
        started,
        lags = [],
        last = Date.now();
    var probe = setInterval(function () {
        var now = Date.now();
        lags.push(Math.max(0, now - last - 10));
        last = now;
    }, 10);
    // Force a minute rollover while keeping wall-clock throughput measurements real.
    var clockOrigin = Date.now(),
        clockEpoch = Date.UTC(2026, 8, 28, 15, 18, 54);
    function logicalNow() {
        return clockEpoch + Date.now() - clockOrigin;
    }
    var dispatcher = new Dispatcher({
        now: logicalNow,
        concurrency: 128,
        rate: 500,
        send: async function (payload, job) {
            if (job.priority === 'warning' && !first) first = Date.now();
            await new Promise(function (r) {
                setTimeout(r, 200);
            });
            if (job.priority === 'warning') completed.push(Date.now() - started);
        }
    });
    var normals = [];
    for (i = 0; i < 100000; i++) {
        normals.push(dispatcher.enqueue({ priority: 'normal', project: 'todayWeather' }));
        if (i % 256 === 255) await new Promise(setImmediate);
    }
    var feed = new Feed({ storage: storage, now: logicalNow });
    await feed.publish([], { bootstrap: true });
    var engine = new Engine({
        registry: registry,
        storage: storage,
        dispatcher: dispatcher,
        feed: feed,
        warnings: true,
        now: logicalNow,
        runtime: {
            warning: function () {
                return { title: 'Synthetic' };
            }
        }
    });
    await engine.init();
    var kst = new Date(logicalNow() + 9 * 3600000).toISOString().replace(/[-:T]/g, '').slice(0, 12);
    await feed.publish(
        [{ areaCode: '37', warnVar: 2, warnStress: 1, command: '1', tmFc: Number(kst), tmSeq: 1 }],
        {}
    );
    started = Date.now();
    var readsBefore = reads;
    await engine.pollWarnings();
    await engine.tick();
    var initialReads = reads - readsBefore;
    var campaign = Array.from(engine.campaigns.values()).find(function (c) {
        return c.kind === 'warning';
    });
    assert.equal(campaign.jobs.length, count);
    while (completed.length < count && Date.now() - started < 31000) {
        await new Promise(function (r) {
            setTimeout(r, 50);
        });
        await engine.tick();
    }
    var elapsed = Date.now() - started;
    dispatcher.close();
    await Promise.all(normals);
    clearInterval(probe);
    await engine.flush();
    completed.sort(function (a, b) {
        return a - b;
    });
    lags.sort(function (a, b) {
        return a - b;
    });
    var result = {
        recipients: count,
        accepted: completed.length,
        normalBacklog: 100000,
        syntheticTransportMs: 200,
        syntheticObjectPutMs: 3,
        concurrency: 128,
        ratePerProject: 500,
        restoreMs: restore,
        firstAdmissionMs: first - started,
        p50Ms: completed[5000],
        p95Ms: completed[9500],
        p99Ms: completed[9900],
        lastMs: elapsed,
        eventLoopP99LagMs: lags[Math.floor(lags.length * 0.99)],
        rssBytes: process.memoryUsage().rss,
        campaignStartupReads: initialReads,
        readsDuringDispatch: reads - readsBefore - initialReads,
        recipientReadsDuringDispatch: readKeys.slice(readsBefore + initialReads).filter(function (key) {
            return !/^campaigns\/[^/]+\/[^/]+\/manifest\.json$/.test(key);
        }).length
    };
    console.log(JSON.stringify(result));
    assert.equal(completed.length, count);
    assert(elapsed <= 30000);
    assert(first - started <= 1000);
    assert.equal(result.recipientReadsDuringDispatch, 0);
    // A single new minute causes one scheduler-manifest lookup; it is not a recipient read.
    assert.equal(result.readsDuringDispatch, 1);
}
main().catch(function (e) {
    console.error(e.stack);
    process.exitCode = 1;
});
