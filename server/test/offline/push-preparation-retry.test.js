'use strict';
// Scheduled alarm preparation retry (#2677): transient weather failures are retried before FCM
// submission within the campaign deadline; results are persisted without sensitive data.
var assert = require('assert');
var runner = require('./push-harness').runner();
var base = require('./push-s3.test');
var memory = base.memory,
    record = base.record,
    registry = base.registry;
function feature(name) {
    try {
        return require('../../lib/pushCoordinator/' + name);
    } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND' && err.message.indexOf(name) !== -1) return {};
        throw err;
    }
}
function sleep(ms) {
    return new Promise(function (r) {
        setTimeout(r, ms);
    });
}
function transient(code) {
    var PreparationError = feature('errors').PreparationError;
    return new PreparationError(code || 'weather-timeout', true);
}
function dispatcher(options) {
    var D = feature('dispatcher').Dispatcher;
    assert.equal(typeof D, 'function');
    return new D(Object.assign({ concurrency: 4, rate: 10000, retryFloorMs: 5, prepareRetryMs: 10 }, options));
}
// ---- Dispatcher -------------------------------------------------------------------------------
runner.test('transient preparation failure is retried once and sent exactly once', async function () {
    var prepared = 0,
        sent = 0;
    var d = dispatcher({
        send: async function () {
            sent++;
        }
    });
    var r = await d.enqueue({
        deadline: Date.now() + 60000,
        prepare: async function () {
            if (prepared++ === 0) throw transient();
            return {};
        }
    });
    d.close();
    assert.equal(r.status, 'accepted');
    assert.equal(prepared, 2);
    assert.equal(sent, 1);
    assert.equal(r.attempts, 1);
    assert.equal(r.preparationAttempts, 2);
});
runner.test('persistent preparation failure stops at the attempt bound before any send', async function () {
    var prepared = 0,
        sent = 0;
    var d = dispatcher({
        prepareAttempts: 3,
        send: async function () {
            sent++;
        }
    });
    var r = await d.enqueue({
        deadline: Date.now() + 60000,
        prepare: async function () {
            prepared++;
            throw transient('weather-timeout');
        }
    });
    d.close();
    assert.equal(r.status, 'failed');
    assert.equal(r.stage, 'preparation');
    assert.equal(r.error, 'weather-timeout');
    assert.equal(prepared, 3);
    assert.equal(r.preparationAttempts, 3);
    assert.equal(r.attempts, 0);
    assert.equal(sent, 0);
});
runner.test('preparation retry never runs past the campaign deadline', async function () {
    var prepared = 0;
    var d = dispatcher({ prepareRetryMs: 5000, send: async function () {} });
    var r = await d.enqueue({
        deadline: Date.now() + 100,
        prepare: async function () {
            prepared++;
            throw transient();
        }
    });
    d.close();
    assert.equal(r.status, 'expired');
    assert.equal(r.stage, 'preparation');
    assert.equal(prepared, 1);
});
runner.test('unclassified preparation error stays terminal with a generic reason', async function () {
    var prepared = 0;
    var d = dispatcher({ send: async function () {} });
    var r = await d.enqueue({
        deadline: Date.now() + 60000,
        prepare: async function () {
            prepared++;
            throw new Error('boom token=secret-token lat=37.5665');
        }
    });
    d.close();
    assert.equal(r.status, 'failed');
    assert.equal(r.stage, 'preparation');
    assert.equal(r.error, 'preparation-error');
    assert.equal(prepared, 1);
    assert.equal(JSON.stringify(r).indexOf('secret-token'), -1);
});
runner.test('a non-retryable typed error is not retried', async function () {
    var PreparationError = feature('errors').PreparationError;
    var prepared = 0;
    var d = dispatcher({ send: async function () {} });
    var r = await d.enqueue({
        deadline: Date.now() + 60000,
        prepare: async function () {
            prepared++;
            throw new PreparationError('weather-rejected', false);
        }
    });
    d.close();
    assert.equal(r.status, 'failed');
    assert.equal(r.error, 'weather-rejected');
    assert.equal(prepared, 1);
});
runner.test('registration change during preparation backoff blocks the send', async function () {
    var valid = true,
        prepared = 0,
        sent = 0;
    var d = dispatcher({
        prepareRetryMs: 30,
        send: async function () {
            sent++;
        }
    });
    var r = await d.enqueue({
        deadline: Date.now() + 60000,
        guard: function () {
            return valid;
        },
        prepare: async function () {
            prepared++;
            setTimeout(function () {
                valid = false;
            }, 5);
            throw transient();
        }
    });
    d.close();
    assert.equal(r.status, 'superseded');
    assert.equal(prepared, 1);
    assert.equal(sent, 0);
});
runner.test('ambiguous FCM send after a recovered preparation is not resent', async function () {
    var prepared = 0,
        sent = 0;
    var d = dispatcher({
        timeoutMs: 30,
        send: function () {
            sent++;
            return new Promise(function (resolve) {
                setTimeout(resolve, 120);
            });
        }
    });
    var r = await d.enqueue({
        deadline: Date.now() + 60000,
        prepare: async function () {
            if (prepared++ === 0) throw transient();
            return {};
        }
    });
    await sleep(150);
    d.close();
    assert.equal(r.status, 'failed');
    assert.equal(r.stage, 'transport');
    assert.equal(r.error, 'transport-timeout-ambiguous');
    assert.equal(sent, 1);
});
runner.test('send error without a retryable status is a transport failure, never resent', async function () {
    var sent = 0;
    var d = dispatcher({
        send: async function () {
            sent++;
            throw new Error('socket hang up for token secret-token');
        }
    });
    var r = await d.enqueue({ deadline: Date.now() + 60000, prepare: async function () { return {}; } });
    d.close();
    assert.equal(r.status, 'failed');
    assert.equal(r.stage, 'transport');
    assert.equal(r.error, 'transport-error');
    assert.equal(sent, 1);
    assert.equal(r.preparationAttempts, 1);
    assert.equal(JSON.stringify(r).indexOf('secret-token'), -1);
});
runner.test('FCM rejection keeps its code and unsafe codes are replaced', async function () {
    var d = dispatcher({
        send: async function (p) {
            var e = new Error('rejected');
            e.code = p.code;
            e.statusCode = 400;
            throw e;
        }
    });
    var a = await d.enqueue({ prepare: async function () { return { code: 'messaging/invalid-argument' }; } });
    var b = await d.enqueue({ prepare: async function () { return { code: 'token abc 37.5,127' }; } });
    d.close();
    assert.equal(a.stage, 'transport');
    assert.equal(a.error, 'messaging/invalid-argument');
    assert.equal(b.error, 'unknown');
});
runner.test('preparation attempts carried by the job count toward the bound', async function () {
    var prepared = 0;
    var d = dispatcher({ prepareAttempts: 4, send: async function () {} });
    var r = await d.enqueue({
        deadline: Date.now() + 60000,
        preparationAttempts: 3,
        prepare: async function () {
            prepared++;
            throw transient();
        }
    });
    d.close();
    assert.equal(r.status, 'failed');
    assert.equal(prepared, 1);
    assert.equal(r.preparationAttempts, 4);
});
// ---- Weather source ---------------------------------------------------------------------------
function source(request, options) {
    var create = feature('weatherSource').create;
    assert.equal(typeof create, 'function', 'weatherSource must exist');
    return create(Object.assign({ request: request, concurrency: 3, timeoutMs: 5000 }, options));
}
runner.test('weather source bounds origin concurrency and shares identical requests', async function () {
    var active = 0,
        peak = 0,
        calls = 0;
    var s = source(function (opts, cb) {
        calls++;
        active++;
        peak = Math.max(peak, active);
        setTimeout(function () {
            active--;
            cb(null, { statusCode: 200 }, { url: opts.url });
        }, 5);
    });
    var jobs = [];
    for (var i = 0; i < 30; i++) jobs.push(s.get('http://origin/town' + (i % 12), 'ko'));
    var bodies = await Promise.all(jobs);
    assert.equal(bodies.length, 30);
    assert.equal(calls, 12);
    assert(peak <= 3, 'peak ' + peak);
});
runner.test('weather source classifies failures without leaking request details', async function () {
    var PreparationError = feature('errors').PreparationError;
    var url = 'http://origin/addr/37.5665,126.9780?token=secret-token';
    function failing(err, res, body) {
        return source(function (opts, cb) {
            cb(err, res, body);
        });
    }
    var cases = [
        [{ code: 'ESOCKETTIMEDOUT' }, undefined, undefined, 'weather-timeout', true],
        [{ code: 'ETIMEDOUT' }, undefined, undefined, 'weather-timeout', true],
        [{ code: 'ECONNRESET' }, undefined, undefined, 'weather-unavailable', true],
        [null, { statusCode: 503 }, {}, 'weather-unavailable', true],
        [null, { statusCode: 429 }, {}, 'weather-unavailable', true],
        [null, { statusCode: 200 }, undefined, 'weather-unavailable', true],
        [null, { statusCode: 404 }, { error: 'x' }, 'weather-rejected', false]
    ];
    for (var c of cases) {
        var error = null;
        try {
            await failing(c[0], c[1], c[2]).get(url, 'ko');
        } catch (e) {
            error = e;
        }
        assert(error instanceof PreparationError, String(c[3]));
        assert.equal(error.code, c[3]);
        assert.equal(error.retryable, c[4]);
        assert.equal(error.stage, 'preparation');
        assert.equal((error.message + JSON.stringify(error)).indexOf('secret-token'), -1);
        assert.equal((error.message + JSON.stringify(error)).indexOf('37.5665'), -1);
    }
});
runner.test('weather source does not cache a failure and recovers on the next call', async function () {
    var calls = 0;
    var s = source(function (opts, cb) {
        if (calls++ === 0) return cb({ code: 'ESOCKETTIMEDOUT' });
        cb(null, { statusCode: 200 }, { ok: true });
    });
    await assert.rejects(s.get('http://origin/a', 'ko'));
    assert.deepEqual(await s.get('http://origin/a', 'ko'), { ok: true });
    assert.deepEqual(await s.get('http://origin/a', 'ko'), { ok: true });
    assert.equal(calls, 2);
});
runner.test('weather timeout is measured from the request, not from queue admission', async function () {
    var seen = [];
    var s = source(
        function (opts, cb) {
            seen.push(opts.timeout);
            setTimeout(function () {
                cb(null, { statusCode: 200 }, {});
            }, 10);
        },
        { concurrency: 1, timeoutMs: 1234 }
    );
    await Promise.all([s.get('http://origin/a', 'ko'), s.get('http://origin/b', 'ko')]);
    assert.deepEqual(seen, [1234, 1234]);
});
// ---- Engine: scheduled alarm batch ------------------------------------------------------------
var SLOT = Date.parse('2026-09-27T22:00:00Z');
async function alarmFixture(options) {
    options = options || {};
    var s = memory(),
        r = await registry(s),
        count = options.count || 24,
        towns = options.towns || 6,
        records = [];
    for (var i = 0; i < count; i++)
        records.push(
            record({
                uuid: 'device' + i,
                fcmToken: 'token-secret-' + i,
                category: 'alarm',
                pushTime: 79200,
                location: { lat: 30 + (i % towns) + 0.5665, long: 126.978 },
                dayOfWeek: [true, true, true, true, true, true, true]
            })
        );
    await r.upsert(records);
    await r.settled();
    var start = Date.now(),
        now = function () {
            return SLOT + 1000 + (Date.now() - start);
        };
    var sent = [];
    var d = dispatcher({
        now: now,
        concurrency: 16,
        prepareRetryMs: options.prepareRetryMs || 20,
        prepareAttempts: options.prepareAttempts,
        send:
            options.send ||
            async function (p) {
                sent.push({ token: p.record.fcmToken, at: now() });
            }
    });
    var E = feature('engine').Engine;
    var e = new E({ registry: r, storage: s, dispatcher: d, now: now, runtime: options.runtime });
    return { s: s, r: r, d: d, e: e, sent: sent, now: now };
}
async function runCampaign(x) {
    await x.e.tick();
    await x.d.idle();
    await x.e.flush();
}
function stored(s) {
    var parts = [],
        manifest;
    s.data.forEach(function (value, key) {
        if (/campaigns\/.*\/parts\//.test(key)) parts = parts.concat(JSON.parse(value));
        if (/campaigns\/.*manifest\.json$/.test(key)) manifest = JSON.parse(value);
    });
    return { parts: parts, manifest: manifest };
}
runner.test('scheduled alarm batch recovers from a weather outage and submits each alarm once', async function () {
    var origin = { calls: 0, active: 0, peak: 0, failed: new Set() };
    var src = source(
        function (opts, cb) {
            origin.calls++;
            origin.active++;
            origin.peak = Math.max(origin.peak, origin.active);
            setTimeout(function () {
                origin.active--;
                if (!origin.failed.has(opts.url)) {
                    origin.failed.add(opts.url);
                    return cb({ code: 'ESOCKETTIMEDOUT' });
                }
                cb(null, { statusCode: 200 }, { ok: true });
            }, 5);
        },
        { concurrency: 3 }
    );
    var x = await alarmFixture({
        runtime: {
            alarm: async function (r) {
                await src.get('http://origin/' + r.location.lat, 'ko');
                return { title: 't', text: 'w' };
            }
        }
    });
    await runCampaign(x);
    x.d.close();
    var tokens = x.sent.map(function (s) {
        return s.token;
    });
    assert.equal(tokens.length, 24);
    assert.equal(new Set(tokens).size, 24, 'each alarm is submitted exactly once');
    x.sent.forEach(function (s) {
        assert(s.at < SLOT + 300000, 'submitted before the campaign deadline');
    });
    assert(origin.peak <= 3, 'origin concurrency ' + origin.peak);
    assert(origin.calls <= 6 * 2, 'shared requests stay bounded: ' + origin.calls);
    var out = stored(x.s);
    assert.equal(out.parts.length, 24);
    var retried = 0;
    out.parts.forEach(function (j) {
        assert.equal(j.status, 'accepted');
        assert.equal(j.attempts, 1);
        assert(j.preparationAttempts <= 2, 'one outage needs at most one retry');
        if (j.preparationAttempts === 2) retried++;
    });
    assert(retried >= 6, 'at least one recipient per town recovered through a retry: ' + retried);
    assert.equal(out.manifest.summary.status.accepted, 24);
});
runner.test('persistent weather outage ends at the attempt bound and reads back as preparation failure', async function () {
    var calls = 0;
    var x = await alarmFixture({
        count: 4,
        towns: 2,
        prepareAttempts: 3,
        runtime: {
            alarm: async function () {
                calls++;
                throw transient('weather-timeout');
            }
        }
    });
    await runCampaign(x);
    x.d.close();
    assert.equal(x.sent.length, 0);
    assert.equal(calls, 12);
    var out = stored(x.s);
    out.parts.forEach(function (j) {
        assert.equal(j.status, 'failed');
        assert.equal(j.stage, 'preparation');
        assert.equal(j.reason, 'weather-timeout');
        assert.equal(j.preparationAttempts, 3);
        assert.equal(j.attempts, 0);
    });
    assert.equal(out.manifest.summary.failures['preparation:weather-timeout'], 4);
    assert.equal(out.manifest.summary.preparationAttempts, 12);
    assert.equal(out.manifest.summary.transportAttempts, 0);
});
runner.test('campaign readback separates preparation failure from FCM rejection without sensitive data', async function () {
    var x = await alarmFixture({
        count: 3,
        towns: 3,
        prepareAttempts: 2,
        send: async function (p) {
            var e = new Error('FCM rejected ' + p.record.fcmToken + ' at 37.5665,126.978 body={"secret":"provider-payload"}');
            e.code = 'messaging/invalid-argument';
            e.statusCode = 400;
            e.response = { body: 'provider-payload', authorization: 'Bearer AIza-secret-credential' };
            throw e;
        },
        runtime: {
            alarm: async function (r) {
                if (r.uuid === 'device0') {
                    var e = transient('weather-timeout');
                    e.message = 'weather failed ' + r.fcmToken + ' http://origin/37.5665,126.978';
                    e.url = 'http://origin/37.5665,126.978';
                    e.body = 'provider-payload';
                    throw e;
                }
                return { title: 't', text: 'w' };
            }
        }
    });
    await runCampaign(x);
    x.d.close();
    var out = stored(x.s);
    var by = {};
    out.parts.forEach(function (j) {
        by[j.stage + ':' + j.reason] = (by[j.stage + ':' + j.reason] || 0) + 1;
    });
    assert.deepEqual(by, { 'preparation:weather-timeout': 1, 'transport:messaging/invalid-argument': 2 });
    assert.deepEqual(out.manifest.summary.failures, {
        'preparation:weather-timeout': 1,
        'transport:messaging/invalid-argument': 2
    });
    assert.equal(out.manifest.summary.preparationAttempts, 2 + 1 + 1);
    assert.equal(out.manifest.summary.transportAttempts, 2);
    var dump = Array.from(x.s.data.keys())
        .filter(function (k) {
            return k.indexOf('campaigns/') === 0;
        })
        .map(function (k) {
            return k + x.s.data.get(k);
        })
        .join('\n');
    assert(dump.length > 0);
    ['token-secret', '37.5665', '126.978', 'provider-payload', 'AIza', 'Bearer', 'http://origin'].forEach(function (needle) {
        assert.equal(dump.indexOf(needle), -1, 'campaign data must not contain ' + needle);
    });
});
runner.test('registration disabled during preparation backoff is not sent', async function () {
    var calls = {};
    var x;
    x = await alarmFixture({
        count: 2,
        towns: 2,
        prepareRetryMs: 40,
        runtime: {
            alarm: async function (r) {
                calls[r.uuid] = (calls[r.uuid] || 0) + 1;
                if (calls[r.uuid] === 1) {
                    if (r.uuid === 'device0')
                        setTimeout(function () {
                            var fresh = x.r.get(r.ref);
                            x.e.setState(r.ref, { disabled: true, generation: fresh.generation });
                        }, 10);
                    throw transient();
                }
                return { title: 't', text: 'w' };
            }
        }
    });
    await runCampaign(x);
    await x.e.tick();
    await x.d.idle();
    x.d.close();
    assert.deepEqual(
        x.sent.map(function (s) {
            return s.token;
        }),
        ['token-secret-1']
    );
});
runner.test('location change during backoff sends once with the new registration', async function () {
    var seen = [];
    var x;
    var changed = false;
    x = await alarmFixture({
        count: 1,
        towns: 1,
        prepareRetryMs: 40,
        runtime: {
            alarm: async function (r) {
                seen.push(r.location.lat);
                if (!changed) {
                    changed = true;
                    setTimeout(function () {
                        x.r.upsert([
                            record({
                                uuid: 'device0',
                                fcmToken: 'token-secret-0',
                                category: 'alarm',
                                pushTime: 79200,
                                location: { lat: 38.5, long: 127 }
                            })
                        ]);
                    }, 5);
                    throw transient();
                }
                return { title: 't', text: 'w' };
            }
        }
    });
    await runCampaign(x);
    await x.r.settled();
    await x.e.tick();
    await x.d.idle();
    x.d.close();
    assert.equal(x.sent.length, 1);
    assert.equal(seen[seen.length - 1], 38.5);
});
// ---- Review findings (PR #2680) ---------------------------------------------------------------
runner.test('review F1: carried preparation count at the bound prepares nothing more', async function () {
    var prepared = 0;
    var d = dispatcher({ prepareAttempts: 4, send: async function () { throw new Error('must not send'); } });
    var r = await d.enqueue({
        deadline: Date.now() + 60000,
        preparationAttempts: 4,
        prepare: async function () {
            prepared++;
            return {};
        }
    });
    d.close();
    assert.equal(r.status, 'failed');
    assert.equal(r.stage, 'preparation');
    assert.equal(r.error, 'preparation-attempts-exhausted');
    assert.equal(r.preparationAttempts, 4);
    assert.equal(prepared, 0);
});
runner.test('review F2: an in-flight preparation count survives checkpoint and restart', async function () {
    var calls = 0,
        contexts = [];
    var runtime = {
        alarm: async function (r, context) {
            calls++;
            contexts.push(context);
            throw transient('weather-timeout');
        }
    };
    var x = await alarmFixture({ count: 1, towns: 1, prepareAttempts: 2, prepareRetryMs: 300, runtime: runtime });
    await x.e.tick();
    await sleep(60);
    await x.e.flush();
    var mid = stored(x.s);
    assert.equal(mid.parts[0].status, 'sending');
    assert.equal(mid.parts[0].preparationAttempts, 1, 'checkpoint carries the attempt in progress');
    assert.equal(mid.manifest.summary.preparationAttempts, 1);
    x.d.close();
    var d2 = dispatcher({ now: x.now, prepareRetryMs: 10, prepareAttempts: 2, send: async function () { throw new Error('must not send'); } });
    var e2 = new (feature('engine').Engine)({ registry: x.r, storage: x.s, dispatcher: d2, now: x.now, runtime: runtime });
    await e2.init();
    await e2.tick();
    await d2.idle();
    await e2.flush();
    d2.close();
    assert.equal(calls, 2, 'the bound holds across restart');
    var end = stored(x.s);
    assert.equal(end.parts[0].status, 'failed');
    assert.equal(end.parts[0].preparationAttempts, 2);
    contexts.forEach(function (c) {
        assert.equal(c.deadline, SLOT + 300000, 'campaign deadline reaches the weather source');
    });
});
runner.test('review F3: manifest summary is derived from the part snapshot it accompanies', async function () {
    var x = await alarmFixture({
        count: 1,
        towns: 1,
        runtime: {
            alarm: function () {
                return new Promise(function () {});
            }
        }
    });
    await x.e.tick();
    await sleep(30);
    var campaign = Array.from(x.e.campaigns.values())[0];
    var put = x.s.put;
    x.s.put = async function (key, value) {
        if (/parts\//.test(key)) {
            await sleep(40);
            // The dispatcher result arrives while the part PUT is in flight.
            Object.assign(campaign.jobs[0], {
                status: 'failed',
                stage: 'preparation',
                reason: 'weather-timeout',
                preparationAttempts: 4
            });
        }
        return put.call(this, key, value);
    };
    campaign.dirty = true;
    await x.e.flush();
    x.s.put = put;
    x.d.close();
    var out = stored(x.s);
    assert.equal(out.parts[0].status, 'sending');
    assert.deepEqual(out.manifest.summary.status, { sending: 1 });
    assert.deepEqual(out.manifest.summary.failures, {});
    assert.equal(out.manifest.summary.preparationAttempts, out.parts[0].preparationAttempts || 0);
});
runner.test('review F4: only closed-list reasons are persisted, credential-like codes are not', async function () {
    var safeReason = feature('errors').safeReason;
    assert.equal(typeof safeReason, 'function');
    ['AIza-secret-credential', 'token-secret-1', '37.5665', 'http://origin/37.5665,126.978', 'x'.repeat(65), 'messaging/AIza-secret'].forEach(
        function (value) {
            assert.equal(safeReason(value), 'unknown', value);
        }
    );
    ['weather-timeout', 'messaging/invalid-argument', 'transport-timeout-ambiguous', 503, '400'].forEach(function (value) {
        assert.equal(safeReason(value), String(value));
    });
    var x = await alarmFixture({
        count: 1,
        towns: 1,
        send: async function () {
            var e = new Error('rejected');
            e.code = 'AIza-secret-credential';
            throw e;
        },
        runtime: {
            alarm: async function () {
                return { title: 't', text: 'w' };
            }
        }
    });
    await runCampaign(x);
    x.d.close();
    var out = stored(x.s);
    assert.equal(out.parts[0].stage, 'transport');
    assert.equal(out.parts[0].reason, 'unknown');
    var dump = JSON.stringify(out);
    assert.equal(dump.indexOf('AIza'), -1);
});
runner.test('review F5: a request queued behind the concurrency gate does not start after its deadline', async function () {
    var PreparationError = feature('errors').PreparationError;
    var clock = 0,
        started = [],
        releaseFirst;
    var s = source(
        function (opts, cb) {
            started.push(opts.url);
            if (started.length === 1)
                releaseFirst = function () {
                    cb(null, { statusCode: 200 }, {});
                };
            else cb(null, { statusCode: 200 }, {});
        },
        {
            concurrency: 1,
            now: function () {
                return clock;
            }
        }
    );
    var first = s.get('http://origin/a', 'ko', 50);
    var second = s.get('http://origin/b', 'ko', 50);
    await sleep(5);
    clock = 100;
    releaseFirst();
    await first;
    var error = null;
    try {
        await second;
    } catch (e) {
        error = e;
    }
    assert(error instanceof PreparationError);
    assert.equal(error.code, 'weather-deadline');
    assert.equal(error.retryable, true);
    assert.deepEqual(started, ['http://origin/a'], 'the expired request never reached the origin');
    assert.deepEqual(await s.get('http://origin/b', 'ko', 500), {}, 'the gate is released and later work proceeds');
});
if (require.main === module)
    runner.run().then(function (failed) {
        process.exitCode = failed ? 1 : 0;
    });
