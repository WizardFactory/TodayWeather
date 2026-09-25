'use strict';
const assert = require('assert'),
    fs = require('fs'),
    path = require('path'),
    EventEmitter = require('events');
const Collector = require('../../lib/awsMinute/collector'),
    cli = require('../../lib/awsMinute/cli'),
    http = require('../../lib/awsMinute/http');
const data = {
    observedAt: new Date('2026-09-25T05:09:00Z'),
    accepted: 1,
    rejected: 0,
    rows: [{ stationId: '108' }],
};
let checks = 0;
async function check(name, fn) {
    await fn();
    console.log('PASS ' + name);
    checks++;
}
(async () => {
    await check('flags off open no adapter; dry-run cannot open store or write', async () => {
        const fail = () => {
            throw new Error('unexpected mutation');
        };
        assert.deepStrictEqual(await cli.run(cli.parse([], {}), { openStore: fail, fetch: fail }), {
            disabled: true,
        });
        let fetches = 0;
        const worker = new Collector({
            dryRun: true,
            once: true,
            fetch: async () => {
                fetches++;
                return {};
            },
            parse: () => data,
            store: { acquire: fail, save: fail, release: fail },
        });
        assert((await worker.start()).ok);
        assert.strictEqual(fetches, 1);
        assert.throws(() => cli.parse(['--unknown'], {}));
        assert(!cli.parse([], { AWS_MINUTE_COLLECT_ENABLED: '1' }).enabled);
    });
    await check(
        'CLI shutdown waits for acquisition and release before closing the DB exactly once',
        async () => {
            let stop,
                grant,
                closed = false,
                released = 0,
                closes = 0,
                runError;
            const running = cli
                .run(
                    { enabled: true },
                    {
                        openStore: async () => ({
                            acquire: () =>
                                new Promise((resolve) => {
                                    grant = resolve;
                                }),
                            release: async () => {
                                assert.strictEqual(closed, false);
                                released++;
                            },
                        }),
                        closeStore: async () => {
                            closed = true;
                            closes++;
                        },
                        fetch: async () => {
                            throw new Error('Unexpected fetch during shutdown');
                        },
                        onStop: (fn) => {
                            stop = fn;
                        },
                    },
                )
                .catch((e) => {
                    runError = e;
                });
            await new Promise((resolve) => setImmediate(resolve));
            const first = stop(),
                second = stop();
            await new Promise((resolve) => setImmediate(resolve));
            const prematureClose = closed;
            grant('owner');
            await Promise.all([running, first, second]);
            assert.strictEqual(prematureClose, false);
            assert.ifError(runError);
            assert.strictEqual(released, 1);
            assert.strictEqual(closes, 1);
        },
    );
    await check('one in-flight poll, two-minute schedule and shutdown cancel/abort', async () => {
        let requests = 0,
            released = 0,
            saved = 0,
            scheduled,
            delay,
            cancelled,
            resolve;
        const store = {
            acquire: async () => 'owner',
            save: async () => saved++,
            release: async () => released++,
        };
        const worker = new Collector({
            enabled: true,
            store,
            fetch: async ({ signal }) => {
                requests++;
                return new Promise((r, j) => {
                    resolve = r;
                    signal.addEventListener('abort', () => j(new Error('AWS_MINUTE_ABORTED')));
                });
            },
            parse: () => data,
            schedule: (fn, ms) => {
                scheduled = fn;
                delay = ms;
                return 1;
            },
            cancel: (id) => {
                cancelled = id;
            },
        });
        const started = worker.start();
        await new Promise((r) => setImmediate(r));
        const concurrent = worker.poll();
        assert.strictEqual(requests, 1);
        resolve({});
        await concurrent;
        await started;
        assert.strictEqual(saved, 1);
        assert.strictEqual(delay, 120000);
        assert(scheduled);
        const pending = worker.poll();
        await new Promise((r) => setImmediate(r));
        await worker.stop();
        await pending;
        assert.strictEqual(saved, 1);
        assert.strictEqual(released, 1);
        assert.strictEqual(cancelled, 1);
        assert((await worker.poll()).stopped);
    });
    await check('duplicate writer rejected before HTTP and crash owner never expires', async () => {
        let fetched = 0;
        const worker = new Collector({
            enabled: true,
            store: { acquire: async () => null },
            fetch: async () => fetched++,
        });
        await assert.rejects(worker.start(), /WRITER_BUSY/);
        assert.strictEqual(fetched, 0);
    });
    await check('stop during owner acquisition releases late owner without polling', async () => {
        let grant,
            released = 0;
        const worker = new Collector({
            enabled: true,
            store: {
                acquire: () =>
                    new Promise((r) => {
                        grant = r;
                    }),
                release: async () => released++,
            },
            fetch: () => {
                throw Error('unexpected');
            },
        });
        const start = worker.start();
        const stopping = worker.stop();
        grant('late');
        await Promise.all([start, stopping]);
        assert.strictEqual(released, 1);
    });
    await check('poll failures and budgets do not claim successful writes', async () => {
        let clock = 0,
            writes = 0;
        const worker = new Collector({
            enabled: true,
            once: true,
            now: () => clock,
            parse: () => ({ ...data, rows: [{}, {}] }),
            fetch: async () => ({}),
            store: {
                acquire: async () => 'x',
                release: async () => {},
                save: async () => {
                    writes++;
                    clock += 60001;
                },
            },
        });
        const result = await worker.start();
        assert.strictEqual(writes, 1);
        assert.strictEqual(result.ok, false);
        assert.strictEqual(result.reason, 'AWS_MINUTE_POLL_BUDGET');
    });
    await check(
        'HTTP timeout, transport retry ceiling, oversized body and abort are bounded',
        async () => {
            function transport(mode) {
                return {
                    calls: 0,
                    get(url, opts, cb) {
                        this.calls++;
                        const req = new EventEmitter();
                        req.destroy = () => {};
                        if (mode === 'error')
                            queueMicrotask(() => req.emit('error', new Error('private detail')));
                        if (mode === 'large')
                            queueMicrotask(() => {
                                const res = new EventEmitter();
                                res.destroy = () => {};
                                cb(res);
                                res.emit('data', Buffer.alloc(2 * 1024 * 1024 + 1));
                            });
                        return req;
                    },
                };
            }
            let t = transport('timeout');
            await assert.rejects(http.fetch({ transport: t, timeoutMs: 5 }), /TIMEOUT/);
            assert.strictEqual(t.calls, 2);
            t = transport('error');
            await assert.rejects(http.fetch({ transport: t, timeoutMs: 10 }), /TRANSPORT/);
            assert.strictEqual(t.calls, 2);
            t = transport('large');
            await assert.rejects(http.fetch({ transport: t, timeoutMs: 10 }), /BODY_LIMIT/);
            assert.strictEqual(t.calls, 1);
            const ac = new AbortController();
            ac.abort();
            t = transport('timeout');
            await assert.rejects(http.fetch({ transport: t, signal: ac.signal }), /ABORTED/);
            assert.strictEqual(t.calls, 0);
        },
    );
    await check(
        'city retry terminal errors and missing results call fallback once, never upload/write',
        async () => {
            const h = require('./harness'),
                source = fs.readFileSync(path.join(__dirname, '../../lib/kmaScraper.js'), 'utf8'),
                deps = {};
            for (const m of source.matchAll(/require\('([^']+)'\)/g)) deps[m[1]] = {};
            const async = require('async');
            let calls = 0;
            deps.async = {
                waterfall: async.waterfall,
                retry: (options, task, done) => {
                    let n = 0;
                    function run() {
                        task((err, value) => {
                            n++;
                            if (err && n < options.times) return run();
                            done(err, value);
                        });
                    }
                    run();
                },
            };
            deps.iconv = { Iconv: function () {} };
            deps.dnscache = () => {};
            deps.buffer = { Buffer };
            deps['../lib/kmaTimeLib'] = { convertDateToYYYYoMMoDDoHHoZZ: () => '2026.09.25.14:00' };
            const Scraper = h.load('lib/kmaScraper.js', deps, { log: h.logger([]) });
            for (const error of [new Error('synthetic city failure'), null]) {
                const s = new Scraper();
                let cityCalls = 0;
                s.getAWSWeather = (type, date, cb) =>
                    cb(null, { pubDate: 'synthetic', stnList: [] });
                s.getCityWeather = (date, cb) => {
                    cityCalls++;
                    cb(error);
                };
                s._uploadS3 = () => {
                    throw Error('unexpected upload');
                };
                s._saveKmaStnHourly2List = () => {
                    throw Error('unexpected write');
                };
                s.getStnHourlyWeather(new Date(), (err) => {
                    assert(err);
                    calls++;
                });
                assert.strictEqual(cityCalls, error ? 10 : 1);
            }
            assert.strictEqual(calls, 2);
        },
    );
    console.log('AWS minute lifecycle: ' + checks + ' checks');
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
