'use strict';
const assert = require('assert'),
    fs = require('fs'),
    path = require('path');
const p = require('../../lib/awsMinute/policy'),
    service = require('../../lib/awsMinute/service'),
    dh = require('./daily-harness');
const now = Date.parse('2026-09-25T05:10:00Z');
const mapping = {
    stationId: '108',
    stationName: 'Seoul',
    method: 'city-planar-1deg',
    distanceDegrees: 0.01,
};
const row = {
    stationId: '108',
    observedAt: new Date(now - 60000),
    source: 'KMA_AWS_MINUTE',
    timeBasis: 'UTC',
    values: { t1h: 22, reh: 70, vec: 0, wsd: 0 },
};
const base = {
    date: '20260925',
    time: '1400',
    t1h: 23.5,
    reh: 60,
    vec: 90,
    wsd: 3,
    rn1: 0,
    sky: 3,
    pty: 0,
};
function request() {
    const req = {
        params: { region: 'Seoul', city: 'Seoul', town: 'sample' },
        query: {},
        current: { ...base },
        currentList: [{ ...base }],
        short: [{ date: '20260925', time: '1500', t3h: 24 }],
        shortestList: [{ date: '20260925', time: '1500', t1h: 24 }],
    };
    p.capture(req, base, req.current);
    return req;
}
function response() {
    return {
        headers: {},
        setHeader(k, v) {
            this.headers[k] = v;
        },
        __(v) {
            return v;
        },
    };
}
function invoke(fn, req, res) {
    return new Promise((resolve, reject) => {
        try {
            fn(req, res, (e) => (e ? reject(e) : resolve()));
        } catch (e) {
            reject(e);
        }
    });
}
let count = 0;
async function check(name, fn) {
    await fn();
    console.log('PASS ' + name);
    count++;
}
(async () => {
    await check(
        'service fallback on disabled, missing mapping, stale, missing and failed store',
        async () => {
            for (const mode of ['disabled', 'no-station', 'stale', 'missing', 'failure']) {
                const req = request(),
                    before = JSON.stringify(req),
                    res = response();
                let calls = 0;
                const store = {
                    mapping: async () => {
                        calls++;
                        if (mode === 'failure') throw Error('synthetic');
                        return mode === 'no-station' ? null : mapping;
                    },
                    latest: async () =>
                        mode === 'missing'
                            ? null
                            : {
                                  ...row,
                                  observedAt: new Date(
                                      mode === 'stale' ? now - 1200000 : now - 60000,
                                  ),
                              },
                };
                await invoke(
                    (q, r, n) =>
                        service.enrich(q, r, n, {
                            enabled: mode !== 'disabled',
                            store,
                            town: {},
                            now: () => now,
                        }),
                    req,
                    res,
                );
                assert.strictEqual(JSON.stringify(req), before);
                if (mode === 'disabled') assert.strictEqual(calls, 0);
            }
        },
    );
    await check('read timeout completes once and late data cannot mutate fallback', async () => {
        const req = request(),
            before = JSON.stringify(req),
            res = response();
        let timeout,
            resolve,
            calls = 0;
        service.enrich(req, res, () => calls++, {
            enabled: true,
            now: () => now,
            schedule: (fn) => {
                timeout = fn;
                return 1;
            },
            cancel: () => {},
            store: {
                mapping: async () => mapping,
                latest: () =>
                    new Promise((r) => {
                        resolve = r;
                    }),
            },
        });
        await new Promise((r) => setImmediate(r));
        timeout();
        assert.strictEqual(calls, 1);
        resolve(row);
        await new Promise((r) => setImmediate(r));
        assert.strictEqual(calls, 1);
        assert.strictEqual(JSON.stringify(req), before);
    });
    await check(
        'shared middleware independent of hourly/city; exact-hour arrays remain unchanged in DB1/DB2',
        async () => {
            for (const version of ['1.0', '2.0']) {
                const e = dh.environment(version),
                    store = {
                        mapping: async () => mapping,
                        latest: async () => ({
                            ...row,
                            observedAt: new Date('2026-09-25T05:00:00Z'),
                        }),
                    };
                const Town = e.load(
                    'controllers/controllerTown.js',
                    {
                        '../config/config': { db: { version }, awsMinute: { enrichEnabled: true } },
                        '../lib/awsMinute/service': {
                            enrich: (q, r, n, o) =>
                                service.enrich(q, r, n, { ...o, store, now: () => now }),
                        },
                        '../lib/awsMinute/policy': p,
                        '../controllers/controllerKmaStnWeather': {
                            getStnHourlyAndMinRns: (town, time, current, cb) =>
                                cb(new Error('synthetic missing hourly')),
                        },
                    },
                    { setTimeout, clearTimeout },
                );
                const town = new Town();
                town._getTownInfo = (region, city, name, cb) =>
                    cb(null, { gCoord: { lon: 126.97, lat: 37.56 } });
                const req = request();
                p.fields.forEach((f) => {
                    req._awsMinuteSources[f].observedAt = '2026-09-25T04:50:00Z';
                });
                const arrays = JSON.stringify([req.currentList, req.short, req.shortestList]);
                await invoke(town.getKmaStnMinuteWeather, req, response()); // ordinary fallback continues after missing legacy hourly data
                const res = response();
                await invoke(town.enrichCurrentByAwsMinute, req, res);
                assert.strictEqual(req.current.t1h, 22);
                assert.strictEqual(req.current.liveTime, '1400');
                assert.strictEqual(
                    JSON.stringify([req.currentList, req.short, req.shortestList]),
                    arrays,
                );
                assert.strictEqual(res.headers['Cache-Control'], 'max-age=120');
            }
        },
    );
    await check('expired mapping cannot admit another database read', async () => {
        const req = request();
        let timeout,
            mappingDone,
            reads = 0,
            calls = 0;
        service.enrich(req, response(), () => calls++, {
            enabled: true,
            now: () => now,
            schedule: (fn) => {
                timeout = fn;
                return 1;
            },
            cancel: () => {},
            store: {
                mapping: () =>
                    new Promise((r) => {
                        mappingDone = r;
                    }),
                latest: async () => {
                    reads++;
                    return row;
                },
            },
        });
        await new Promise((resolve) => setImmediate(resolve));
        timeout();
        mappingDone(mapping);
        await new Promise((resolve) => setImmediate(resolve));
        assert.strictEqual(reads, 0);
        assert.strictEqual(calls, 1);
        assert.strictEqual(req.current.t1h, 23.5);
    });
    await check(
        'getCurrent captures row time rather than outer publication in DB1/DB2',
        async () => {
            for (const version of ['1.0', '2.0']) {
                const e = dh.environment(version);
                const read = (model, coord, req, cb) =>
                    cb(null, { ret: [{ ...base }], pubDate: '202609251410' });
                function Current() {
                    this.getCurrentFromDB = read;
                }
                const Town = e.load('controllers/controllerTown.js', {
                    '../config/config': { db: { version }, awsMinute: { enrichEnabled: true } },
                    '../lib/awsMinute/policy': p,
                    './kma/kma.town.current.controller.js': Current,
                });
                const town = new Town();
                town._getCoord = (region, city, name, cb) => cb(null, { mx: 60, my: 127 });
                town._getCurrentTimeValue = () => ({ date: '20260925', time: '1400' });
                town._getTownDataFromDB = read;
                const req = { params: {}, query: {} };
                await invoke(town.getCurrent, req, response());
                assert.strictEqual(
                    req._awsMinuteSources.t1h.observedAt,
                    '2026-09-25T05:00:00.000Z',
                );
                assert.strictEqual(
                    p.overlay(req.current, row, mapping, req._awsMinuteSources, now).t1h,
                    22,
                );
            }
        },
    );
    await check(
        'actual indices, unit conversion and temperature summary use the effective current',
        async () => {
            const e = dh.environment(),
                life = e.load('controllers/lifeIndexKmaController.js');
            const Town = e.load('controllers/controllerTown.js', {
                '../controllers/lifeIndexKmaController': life,
            });
            const town = new Town(),
                req = request(),
                res = response();
            await invoke(
                (q, r, n) =>
                    service.enrich(q, r, n, {
                        enabled: true,
                        store: { mapping: async () => mapping, latest: async () => row },
                        now: () => now,
                    }),
                req,
                res,
            );
            req.short = [];
            await invoke(town.insertIndex, req, res);
            assert.strictEqual(req.current.dspls, life.getDiscomfortIndex(22, 70));
            assert.strictEqual(req.current.heatIndex, life.getHeatIndex(22, 70));
            assert(Number.isFinite(req.current.sensorytem));
            const Unit = require('../../lib/unitConverter');
            const Town24 = e.load('controllers/controllerTown24h.js', {
                '../controllers/controllerTown': Town,
                '../lib/unitConverter': Unit,
            });
            const current = req.current;
            Town24.prototype._convertWeatherData.call({}, current, {
                temperatureUnit: 'F',
                windSpeedUnit: 'm/s',
                precipitationUnit: 'mm',
                pressureUnit: 'hPa',
                distanceUnit: 'km',
            });
            assert.strictEqual(current.t1h, 71); // existing API floors Fahrenheit
            assert.strictEqual(
                town._diffTodayYesterday(
                    current,
                    { t1h: 68 },
                    { __: (key) => (key === 'LOC_THAN_YESTERDAY' ? '%s warmer' : 'same') },
                ).grade,
                3,
            );
        },
    );
    await check(
        'unknown or changed field provenance stays unchanged; humidity-only refresh cannot relabel temperature',
        () => {
            const req = request();
            req.current.t1h = 25;
            const output = p.overlay(req.current, row, mapping, req._awsMinuteSources, now);
            assert.strictEqual(output.t1h, 25);
            assert.strictEqual(output.reh, 70);
            assert.strictEqual(output.liveTime, undefined);
            assert(!output.minuteObservation.fields.t1h);
        },
    );
    await check('midnight provenance has actual KST date without shifting history dates', () => {
        const req = request(),
            clock = Date.parse('2026-09-24T15:02:00Z');
        req.current.date = '20260924';
        req.current.time = '2300';
        p.fields.forEach((f) => {
            req._awsMinuteSources[f].observedAt = '2026-09-24T14:00:00Z';
        });
        const out = p.overlay(
            req.current,
            { ...row, observedAt: new Date(clock - 60000) },
            mapping,
            req._awsMinuteSources,
            clock,
        );
        assert.strictEqual(out.liveDate, '20260925');
        assert.strictEqual(out.liveTime, '0001');
        assert.strictEqual(out.date, '20260924');
    });
    await check(
        'all active KMA routers place overlay after history/forecast and before indices/units',
        () => {
            for (const file of [
                'v000901/route.kma.addr.js',
                'v000902/route.kma.v000902.js',
                'v000903/route.kma.v000903.js',
            ]) {
                const src = fs.readFileSync(path.join(__dirname, '../../routes', file), 'utf8');
                assert(
                    src.indexOf('cTown.enrichCurrentByAwsMinute') >
                        src.indexOf('cTown.mergeShortWithCurrentList'),
                );
                assert(
                    src.indexOf('cTown.enrichCurrentByAwsMinute') <
                        src.indexOf('cTown.insertIndex'),
                );
                assert(src.indexOf('cTown.insertIndex') < src.indexOf('cTown.convertUnits'));
            }
        },
    );
    console.log('AWS minute service: ' + count + ' checks');
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
