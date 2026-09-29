'use strict';
// Synthetic asynchronous transport at 200 ms, not live FCM throughput.
var assert = require('assert');
var Dispatcher = require('../../lib/pushCoordinator/dispatcher').Dispatcher;
var n = 10000,
    normal = 100000,
    latency = 200;
var active = 0,
    peak = 0,
    first = 0,
    started = 0,
    finished = [],
    lag = 0,
    lags = [],
    last = Date.now();
var probe = setInterval(function () {
    var now = Date.now();
    lags.push(Math.max(0, now - last - 10));
    lag = Math.max(lag, now - last - 10);
    last = now;
}, 10);
var dispatcher = new Dispatcher({
    concurrency: 256,
    rate: 1000,
    maxQueue: 150000,
    send: function (payload, job) {
        active++;
        peak = Math.max(peak, active);
        if (job.priority === 'warning' && !first) first = Date.now();
        return new Promise(function (resolve) {
            setTimeout(function () {
                active--;
                resolve();
            }, latency);
        });
    }
});
async function main() {
    var normalJobs = [];
    for (var i = 0; i < normal; i++) {
        normalJobs.push(dispatcher.enqueue({ id: 'n' + i, priority: 'normal', project: 'test' }));
        if (i % 256 === 255) await new Promise(setImmediate);
    }
    await new Promise(function (r) {
        setTimeout(r, 100);
    });
    started = Date.now();
    var jobs = [];
    for (var j = 0; j < n; j++)
        jobs.push(
            dispatcher
                .enqueue({ id: 'w' + j, priority: 'warning', project: 'test', deadline: started + 30000 })
                .then(function (r) {
                    assert.equal(r.status, 'accepted');
                    finished.push(Date.now() - started);
                })
        );
    await Promise.all(jobs);
    var elapsed = Date.now() - started;
    dispatcher.close();
    await Promise.all(normalJobs);
    clearInterval(probe);
    finished.sort(function (a, b) {
        return a - b;
    });
    lags.sort(function (a, b) {
        return a - b;
    });
    var report = {
        recipients: n,
        normalBacklog: normal,
        syntheticLatencyMs: latency,
        firstAdmissionMs: first - started,
        p50Ms: finished[Math.floor(n * 0.5)],
        p95Ms: finished[Math.floor(n * 0.95)],
        p99Ms: finished[Math.floor(n * 0.99)],
        lastMs: elapsed,
        peakConcurrency: peak,
        eventLoopMaxLagMs: lag,
        eventLoopP99LagMs: lags[Math.floor(lags.length * 0.99)],
        rssBytes: process.memoryUsage().rss,
        transport: 'synthetic timer; no live FCM'
    };
    console.log(JSON.stringify(report));
    assert(elapsed <= 30000);
    assert(first - started <= 1000);
    assert(peak <= 256);
}
main().catch(function (e) {
    clearInterval(probe);
    dispatcher.close();
    console.error(e.stack);
    process.exitCode = 1;
});
