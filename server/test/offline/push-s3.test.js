'use strict';
var assert = require('assert');
var runner = require('./push-harness').runner();
function feature(name) {
    try {
        return require('../../lib/pushCoordinator/' + name);
    } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND' && err.message.indexOf(name) !== -1) {
            return {};
        }
        throw err;
    }
}
function memory() {
    var data = new Map();
    return {
        data: data,
        writes: 0,
        get: async function (key) {
            return data.has(key) ? JSON.parse(data.get(key)) : null;
        },
        put: async function (key, value) {
            this.writes++;
            data.set(key, JSON.stringify(value));
        },
        list: async function (prefix) {
            return Array.from(data.keys()).filter(function (k) {
                return k.indexOf(prefix) === 0;
            });
        }
    };
}
function record(overrides) {
    return Object.assign(
        {
            uuid: 'device1',
            package: 'todayWeather',
            type: 'ios',
            fcmToken: 'token1',
            cityIndex: 0,
            id: 1,
            category: 'alert',
            enable: true,
            location: { lat: 37, long: 127 },
            source: 'KMA',
            lang: 'ko',
            startTime: 0,
            endTime: 86399,
            timezoneOffset: 540,
            dayOfWeek: [true, true, true, true, true, true, true]
        },
        overrides || {}
    );
}
async function registry(storage, resolve) {
    var Registry = feature('registry').Registry;
    assert.equal(typeof Registry, 'function', 'S3 registry feature must exist');
    var r = new Registry({
        storage: storage || memory(),
        resolve:
            resolve ||
            async function (loc) {
                return { weatherKey: String(loc.lat), zones: [String(loc.lat)], town: loc.town };
            }
    });
    await r.init();
    return r;
}
runner.test(
    'partial city POST preserves other settings and zero identifiers delete narrowly',
    async function () {
        var r = await registry();
        await r.upsert([record(), record({ cityIndex: 1, id: 0 })]);
        await r.settled();
        await r.upsert([record({ name: 'changed' })]);
        assert.equal(r.records.size, 2);
        await r.remove({ fcmToken: 'token1', cityIndex: 0, id: 1 });
        assert.equal(r.records.size, 1);
        assert.equal(Array.from(r.records.values())[0].cityIndex, 1);
    }
);
runner.test(
    'latest location has no age expiry and reverse-order geocoding cannot overwrite it',
    async function () {
        var pending = [];
        var r = await registry(null, function (loc) {
            return new Promise(function (resolve) {
                pending.push({ loc: loc, resolve: resolve });
            });
        });
        await r.upsert([record()]);
        await r.upsert([record({ location: { lat: 38, long: 128 } })]);
        pending[1].resolve({ weatherKey: 'B', zones: ['B'] });
        await new Promise(setImmediate);
        pending[0].resolve({ weatherKey: 'A', zones: ['A'] });
        await r.settled();
        assert.equal(r.warningRefs(['A']).length, 0);
        assert.equal(r.warningRefs(['B']).length, 1);
        assert.equal(r.get(r.warningRefs(['B'])[0]).location.lat, 38);
    }
);
runner.test(
    'durable put failure does not publish new position and restart rebuilds indexes',
    async function () {
        var s = memory(),
            r = await registry(s);
        await r.upsert([record()]);
        await r.settled();
        var put = s.put;
        s.put = async function () {
            throw new Error('unavailable');
        };
        await assert.rejects(r.upsert([record({ location: { lat: 38, long: 128 } })]));
        assert.equal(r.warningRefs(['37']).length, 0, 'uncertain device is fenced');
        s.put = put;
        var restored = await registry(s);
        assert.equal(restored.warningRefs(['37']).length, 1);
    }
);
runner.test('token collision merge retains other cities and highest accepted settings', async function () {
    var s = memory(),
        r = await registry(s);
    await r.upsert([record({ uuid: 'one', cityIndex: 1, name: 'old' })]);
    await r.upsert([
        record({ uuid: 'two', fcmToken: 'token2', cityIndex: 1, name: 'new' }),
        record({ uuid: 'two', fcmToken: 'token2', cityIndex: 2 })
    ]);
    await r.rotate('token1', 'token2');
    await r.settled();
    assert.equal(r.records.size, 2);
    assert(
        Array.from(r.records.values()).every(function (x) {
            return x.fcmToken === 'token2';
        })
    );
    assert.equal(
        Array.from(r.records.values()).find(function (x) {
            return x.cityIndex === 1;
        }).name,
        'new'
    );
    var restored = await registry(s);
    assert.equal(restored.records.size, 2);
});
runner.test('registration validation rejects unknown category and impossible coordinates', async function () {
    var r = await registry();
    await assert.rejects(r.upsert([record({ category: 'unknown' })]));
    await assert.rejects(r.upsert([record({ location: { lat: 91, long: 127 } })]));
});
runner.test('scheduled slots retain UTC and local weekday semantics', async function () {
    var r = await registry();
    await r.upsert([
        record({
            category: 'alarm',
            pushTime: 79200,
            dayOfWeek: [false, true, false, false, false, false, false]
        })
    ]);
    await r.settled();
    assert.equal(r.alarmRefs(new Date('2026-09-27T22:00:00Z')).length, 1);
    assert.equal(r.alarmRefs(new Date('2026-09-28T22:00:00Z')).length, 0);
});
runner.test('warning audience respects enabled regional alerts and their time windows', async function () {
    var r = await registry();
    await r.upsert([
        record({ category: 'alarm', id: 2, pushTime: 0 }),
        record({ id: 3, enable: false }),
        record({ startTime: 3600, endTime: 7200 })
    ]);
    await r.settled();
    assert.equal(r.warningRefs(['37'], new Date('2026-09-28T01:30:00Z')).length, 1);
    assert.equal(r.warningRefs(['37'], new Date('2026-09-28T03:00:00Z')).length, 0);
});
runner.test(
    'priority sender admits warnings before normal queue drains, with bounded concurrency',
    async function () {
        var Dispatcher = feature('dispatcher').Dispatcher;
        assert.equal(typeof Dispatcher, 'function');
        var order = [],
            active = 0,
            peak = 0;
        var d = new Dispatcher({
            concurrency: 10,
            rate: 10000,
            send: async function (job) {
                active++;
                peak = Math.max(peak, active);
                order.push(job.id);
                await new Promise(function (r) {
                    setTimeout(r, 5);
                });
                active--;
            }
        });
        var jobs = [];
        for (var i = 0; i < 100; i++) jobs.push(d.enqueue({ id: 'n' + i, priority: 'normal', project: 'p' }));
        jobs.push(d.enqueue({ id: 'urgent', priority: 'warning', project: 'p' }));
        await Promise.all(jobs);
        d.close();
        assert(order.indexOf('urgent') < 20);
        assert(peak <= 10);
    }
);
runner.test(
    'final guard is checked after async preparation and stale jobs never reach transport',
    async function () {
        var Dispatcher = feature('dispatcher').Dispatcher;
        assert.equal(typeof Dispatcher, 'function');
        var valid = true,
            sent = 0;
        var d = new Dispatcher({
            send: async function () {
                sent++;
            },
            concurrency: 2,
            rate: 1000
        });
        var result = await d.enqueue({
            id: 'a',
            guard: function () {
                return valid;
            },
            prepare: async function () {
                valid = false;
                return {};
            }
        });
        d.close();
        assert.equal(result.status, 'superseded');
        assert.equal(sent, 0);
    }
);
runner.test('429 retry respects delay and expired work is not submitted', async function () {
    var Dispatcher = feature('dispatcher').Dispatcher;
    assert.equal(typeof Dispatcher, 'function');
    var n = 0,
        times = [];
    var d = new Dispatcher({
        concurrency: 2,
        rate: 1000,
        retryFloorMs: 20,
        send: async function () {
            times.push(Date.now());
            if (n++ === 0) {
                var e = new Error('rate');
                e.statusCode = 429;
                e.retryAfterMs = 40;
                throw e;
            }
        }
    });
    assert.equal((await d.enqueue({ deadline: Date.now() + 2000 })).status, 'accepted');
    assert(times[1] - times[0] >= 40);
    assert.equal((await d.enqueue({ deadline: Date.now() - 1 })).status, 'expired');
    d.close();
});
runner.test('warning feed deduplicates replay and applies release over earlier issue', async function () {
    var Feed = feature('warningFeed').Feed;
    assert.equal(typeof Feed, 'function');
    var s = memory();
    var f = new Feed({ storage: s });
    var row = { areaCode: 'A', warnVar: 2, warnStress: 0, command: '1', tmFc: 202609280700, tmSeq: 1 };
    await f.publish([row], { bootstrap: true });
    var head = await s.get('warning-feed/head.json');
    assert.equal(head.events.length, 0);
    row.tmSeq = 2;
    await f.publish([row], { bootstrap: false });
    await f.publish([row], { bootstrap: false });
    head = await s.get('warning-feed/head.json');
    assert.equal(head.events.length, 1);
    await f.publish([Object.assign({}, row, { command: '2', tmSeq: 3 })], { bootstrap: false });
    head = await s.get('warning-feed/head.json');
    assert.equal(head.events.length, 2);
});
runner.test('merged UUID remains a usable alias when it re-registers with a new token', async function () {
    var r = await registry();
    await r.upsert([record({ uuid: 'one' })]);
    await r.upsert([record({ uuid: 'two', fcmToken: 'two' })]);
    await r.rotate('token1', 'two');
    var loser = Array.from(r.devices.values()).find(function (d) {
        return d.supersededBy;
    });
    var uuid = loser.key === feature('registry').hash(['todayWeather', 'ios', 'uuid', 'one']) ? 'one' : 'two';
    await r.upsert([record({ uuid: uuid, fcmToken: 'three' })]);
    await r.settled();
    assert.equal(r.find('three').length, 1);
    assert(r.warningRefs(['37']).length > 0);
});
runner.test('physical transport concurrency remains bounded after watchdog timeout', async function () {
    var active = 0,
        peak = 0,
        releases = [],
        d = new (feature('dispatcher').Dispatcher)({
            concurrency: 2,
            timeoutMs: 10,
            rate: 10000,
            send: function () {
                active++;
                peak = Math.max(peak, active);
                return new Promise(function (resolve) {
                    releases.push(function () {
                        active--;
                        resolve();
                    });
                });
            }
        });
    var jobs = [];
    for (var i = 0; i < 8; i++) jobs.push(d.enqueue({ priority: 'warning' }));
    await new Promise(function (r) {
        setTimeout(r, 60);
    });
    assert(peak <= 2);
    d.close();
    await Promise.all(jobs);
    releases.forEach(function (f) {
        f();
    });
});
runner.test('rate is charged after a simultaneous preparation gate opens', async function () {
    var open,
        gate = new Promise(function (r) {
            open = r;
        }),
        times = [],
        d = new (feature('dispatcher').Dispatcher)({
            rate: 100,
            concurrency: 128,
            send: async function () {
                times.push(Date.now());
            }
        });
    var jobs = [];
    for (var i = 0; i < 40; i++)
        jobs.push(
            d.enqueue({
                priority: 'warning',
                prepare: async function () {
                    await gate;
                    return {};
                }
            })
        );
    await new Promise(function (r) {
        setTimeout(r, 260);
    });
    open();
    await Promise.all(jobs);
    d.close();
    assert(
        times.filter(function (t) {
            return t - times[0] < 5;
        }).length <= 11,
        '100/s allows a burst of 10 plus accrued time'
    );
});
runner.test('close settles delayed retries and warning queue capacity is reserved', async function () {
    var retry = new (feature('dispatcher').Dispatcher)({
        retryFloorMs: 100,
        send: async function () {
            var e = new Error();
            e.statusCode = 503;
            throw e;
        }
    });
    var waiting = retry.enqueue({});
    await new Promise(function (r) {
        setTimeout(r, 25);
    });
    retry.close();
    assert.equal((await waiting).status, 'failed');
    assert.equal(retry.total, 0);
    var d = new (feature('dispatcher').Dispatcher)({ maxQueue: 10, send: async function () {} }),
        jobs = [];
    for (var i = 0; i < 8; i++) jobs.push(d.enqueue({ priority: 'normal' }));
    await assert.rejects(d.enqueue({ priority: 'normal' }));
    jobs.push(d.enqueue({ priority: 'warning' }));
    await Promise.all(jobs);
    d.close();
});
runner.test(
    'late historical warning is state-only and feed bodies are cached between polls',
    async function () {
        var s = memory(),
            now = Date.parse('2026-09-28T08:01:00Z'),
            f = new (feature('warningFeed').Feed)({
                storage: s,
                now: function () {
                    return now;
                }
            });
        await f.publish([], { bootstrap: true });
        await f.publish(
            [{ areaCode: 'A', warnVar: 2, warnStress: 0, command: 1, tmFc: 202609270700, tmSeq: 1 }],
            {}
        );
        var items = await f.read();
        assert.equal(items[0].notify, false);
        var get = s.get,
            n = 0;
        s.get = async function (k) {
            n++;
            return get.call(s, k);
        };
        await f.read();
        assert.equal(n, 1);
    }
);
runner.test(
    'warning campaign uses latest matching city, persists completion, and honors release on recovery',
    async function () {
        var s = memory(),
            r = await registry(s),
            now = Date.parse('2026-09-28T08:01:00Z');
        await r.upsert([record(), record({ cityIndex: 1, id: 2 })]);
        await r.settled();
        var sent = [];
        var d = new (feature('dispatcher').Dispatcher)({
            now: function () {
                return now;
            },
            send: async function (p) {
                sent.push(p.record.cityIndex);
            }
        });
        var f = new (feature('warningFeed').Feed)({
            storage: s,
            now: function () {
                return now;
            }
        });
        await f.publish([], { bootstrap: true });
        var E = feature('engine').Engine,
            engine = new E({
                registry: r,
                storage: s,
                dispatcher: d,
                feed: f,
                warnings: true,
                now: function () {
                    return now;
                },
                runtime: {
                    warning: function () {
                        return {};
                    }
                }
            });
        await engine.init();
        var event = { areaCode: '37', warnVar: 2, warnStress: 0, command: 1, tmFc: 202609281701, tmSeq: 1 };
        await f.publish([event], {});
        await engine.pollWarnings();
        await r.upsert([record({ location: { lat: 38, long: 128 } })]);
        await r.settled();
        await engine.tick();
        await d.idle();
        assert.deepEqual(sent, [1]);
        await engine.flush();
        await f.publish([Object.assign({}, event, { command: 2, tmSeq: 2 })], {});
        var recovered = new E({
            registry: r,
            storage: s,
            dispatcher: d,
            feed: f,
            warnings: true,
            now: function () {
                return now;
            },
            runtime: {
                warning: function () {
                    return {};
                }
            }
        });
        await recovered.init();
        await recovered.tick();
        await d.idle();
        assert.equal(sent.length, 1);
        d.close();
    }
);
runner.test('POST collision merges UUID settings even if the token PUT was missed', async function () {
    var r = await registry();
    await r.upsert([record({ uuid: 'a', cityIndex: 1, fcmToken: 'a' })]);
    await r.upsert([record({ uuid: 'b', cityIndex: 2, fcmToken: 'b' })]);
    await r.upsert([record({ uuid: 'a', cityIndex: 0, fcmToken: 'b' })]);
    await r.settled();
    assert.equal(r.find('a').length, 0);
    assert.equal(r.records.size, 3);
    assert(
        Array.from(r.records.values()).every(function (x) {
            return x.fcmToken === 'b';
        })
    );
});
runner.test('cold restore bounds geocoding and fails readiness when resolution fails', async function () {
    var s = memory(),
        r = await registry(s),
        active = 0,
        peak = 0;
    for (var i = 0; i < 24; i++)
        await r.upsert([record({ uuid: 'r' + i, fcmToken: 'r' + i, location: { lat: i, long: 127 } })]);
    await r.settled();
    var restored = await registry(s, async function (loc) {
        active++;
        peak = Math.max(peak, active);
        await new Promise(function (r) {
            setTimeout(r, 5);
        });
        active--;
        return { zones: [String(loc.lat)] };
    });
    assert(restored.ready);
    assert(peak <= 8);
    await assert.rejects(
        registry(s, async function () {
            throw new Error('geocoder down');
        })
    );
});
runner.test(
    'late region row expands an existing warning without resending old recipients',
    async function () {
        var s = memory(),
            r = await registry(s),
            now = Date.parse('2026-09-28T08:01:00Z'),
            sent = [];
        await r.upsert([
            record({ uuid: 'a', fcmToken: 'a' }),
            record({ uuid: 'b', fcmToken: 'b', location: { lat: 38, long: 128 } })
        ]);
        await r.settled();
        var d = new (feature('dispatcher').Dispatcher)({
            now: function () {
                return now;
            },
            send: async function (p) {
                sent.push(p.record.fcmToken);
            }
        });
        var f = new (feature('warningFeed').Feed)({
            storage: s,
            now: function () {
                return now;
            }
        });
        await f.publish([], { bootstrap: true });
        var e = new (feature('engine').Engine)({
            registry: r,
            storage: s,
            dispatcher: d,
            feed: f,
            warnings: true,
            now: function () {
                return now;
            },
            runtime: {
                warning: function () {
                    return {};
                }
            }
        });
        await e.init();
        var row = { areaCode: '37', warnVar: 2, warnStress: 1, command: 1, tmFc: 202609281701, tmSeq: 1 };
        await f.publish([row], {});
        await e.pollWarnings();
        await e.tick();
        await d.idle();
        await f.publish([Object.assign({}, row, { areaCode: '38' })], {});
        await e.pollWarnings();
        await e.tick();
        await d.idle();
        d.close();
        assert.deepEqual(sent, ['a', 'b']);
    }
);
runner.test('review R2: continuing backfill does not reset the durable feed baseline', async function () {
    var f = new (feature('warningFeed').Feed)({
        storage: memory(),
        now: function () {
            return Date.parse('2026-09-28T08:01:00Z');
        }
    });
    await f.publish([], { bootstrap: true });
    await f.publish(
        [{ areaCode: '37', warnVar: 2, warnStress: 1, command: 1, tmFc: 202609281701, tmSeq: 1 }],
        { bootstrap: true }
    );
    assert.equal(
        (await f.read()).filter(function (x) {
            return x.notify;
        }).length,
        1
    );
});
runner.test(
    'review R3: project cooldown also holds fresh queued work and other projects proceed',
    async function () {
        var now = 0,
            calls = [];
        var d = new (feature('dispatcher').Dispatcher)({
            concurrency: 1,
            rate: 100,
            retryFloorMs: 0,
            now: function () {
                return now;
            },
            send: async function (p) {
                calls.push(p.project);
                if (p.project === 'limited') {
                    var e = new Error('quota');
                    e.statusCode = 429;
                    e.retryAfterMs = 500;
                    throw e;
                }
            }
        });
        try {
            d.enqueue({ project: 'limited', deadline: 100 }); // expires instead of retry; still cool down project
            await new Promise(function (r) {
                setTimeout(r, 25);
            });
            d.enqueue({ project: 'limited' });
            d.enqueue({ project: 'other' });
            await new Promise(function (r) {
                setTimeout(r, 30);
            });
            assert.deepEqual(calls, ['limited', 'other']);
            now = 501;
            await new Promise(function (r) {
                setTimeout(r, 30);
            });
            assert.equal(
                calls.filter(function (x) {
                    return x === 'limited';
                }).length,
                2
            );
        } finally {
            d.close();
        }
    }
);
runner.test('review R5: sustained warnings cannot consume normal project token reserve', async function () {
    var now = 0,
        d = new (feature('dispatcher').Dispatcher)({
            rate: 100,
            now: function () {
                return now;
            }
        });
    try {
        for (var step = 0; step < 10; step++) {
            now += 100;
            var warnings = 0;
            while (d.budget('project', 'warning') === true) warnings++;
            assert(warnings > 0);
            assert.equal(d.budget('project', 'normal'), true, 'normal rate share survives warning pressure');
        }
    } finally {
        d.close();
    }
});
runner.test(
    'review R1: uncertain registration remains fenced even when immediate GET reads old data',
    async function () {
        var s = memory(),
            r = await registry(s);
        await r.upsert([record()]);
        await r.settled();
        var ref = Array.from(r.records.keys())[0];
        s.put = async function () {
            throw new Error('timeout');
        };
        await assert.rejects(r.upsert([record({ location: { lat: 38, long: 128 } })]));
        assert.equal(r.get(ref), null, 'old read is not proof that the timed-out write cannot arrive later');
    }
);

runner.test(
    'review R5: warning backlog leaves normal admission even with one physical slot',
    async function () {
        var sent = [],
            d = new (feature('dispatcher').Dispatcher)({
                concurrency: 1,
                rate: 100,
                send: async function (p) {
                    sent.push(p.priority);
                }
            });
        try {
            for (var i = 0; i < 30; i++) d.enqueue({ priority: 'warning' });
            var normal = d.enqueue({ priority: 'normal' });
            var result = await Promise.race([
                normal,
                new Promise(function (r) {
                    setTimeout(function () {
                        r({ status: 'timeout' });
                    }, 150);
                })
            ]);
            assert.equal(result.status, 'accepted');
            assert(sent.indexOf('normal') < 10, 'normal is admitted while warnings remain queued');
        } finally {
            d.close();
        }
    }
);
async function reviewConditional(runtime) {
    var s = memory(),
        r = await registry(s);
    await r.upsert([record()]);
    await r.settled();
    var e = new (feature('engine').Engine)({
        storage: s,
        registry: r,
        runtime: runtime,
        now: function () {
            return Date.parse('2026-09-28T08:01:00Z');
        }
    });
    return { r: r, e: e, ref: Array.from(r.records.keys())[0] };
}
runner.test(
    'review R4: no-send conditional result cannot write state after position changes',
    async function () {
        var release,
            x = await reviewConditional({
                conditional: function () {
                    return new Promise(function (r) {
                        release = r;
                    });
                }
            });
        var work = x.e.prepare({ kind: 'conditional' }, {}, x.r.get(x.ref));
        await x.r.upsert([record({ location: { lat: 38, long: 128 } })]);
        await x.r.settled();
        release({ state: { precipAlerts: { lastState: 1, pushTime: new Date() } }, notification: null });
        await work;
        assert.equal(x.e.state[x.ref], undefined);
    }
);
runner.test(
    'review R4: accepted old-generation send cannot checkpoint onto rotated token',
    async function () {
        var release,
            handed = false;
        var x = await reviewConditional({
            conditional: async function () {
                return {
                    state: { precipAlerts: { lastState: 1, pushTime: new Date() } },
                    notification: { title: 'old' }
                };
            }
        });
        var d = new (feature('dispatcher').Dispatcher)({
            now: x.e.now,
            send: function () {
                handed = true;
                return new Promise(function (r) {
                    release = r;
                });
            }
        });
        x.e.dispatcher = d;
        var c = {
            kind: 'conditional',
            id: 'review',
            deadline: x.e.now() + 300000,
            jobs: [{ ref: x.ref, status: 'pending' }],
            inflight: new Set()
        };
        try {
            await x.e.admit(c);
            for (var i = 0; i < 100 && !handed; i++)
                await new Promise(function (r) {
                    setTimeout(r, 5);
                });
            assert(handed, 'send must reach the transport');
            await x.r.rotate('token1', 'new-token');
            await x.r.settled();
            release();
            await d.idle();
            assert.equal(x.e.state[x.ref], undefined);
        } finally {
            if (release) release();
            d.close();
        }
    }
);

if (require.main === module)
    runner.run().then(function (failed) {
        process.exitCode = failed ? 1 : 0;
    });
module.exports = { memory: memory, record: record, registry: registry };
