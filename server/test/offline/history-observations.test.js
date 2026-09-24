'use strict';
const assert = require('node:assert/strict');
const dh = require('./daily-harness');
const e = dh.environment();
const row = (date, time, reh = 60) => ({ date, time, reh, t1h: 20, sky: 1, pty: 0, lgt: 0, rn1: 0, wsd: 1 });
let failures = 0,
    passed = 0;
function check(name, fn) {
    try {
        fn();
        passed++;
        console.log('PASS ' + name);
    } catch (err) {
        failures++;
        console.error('FAIL ' + name + '\n' + err.stack);
    }
}
check('historical temperatures survive missing humidity', () => {
    const out = e.town._getDaySummaryList([row('20260923', '0000', -1), row('20260923', '1200', -1)]);
    assert(out.some((r) => r.date === '20260923' && r.taMin === 20 && r.taMax === 20));
});
check('sparse first observation is not discarded', () => {
    const out = e.town._getDaySummaryList([row('20260923', '1200')]);
    assert.equal(out.length, 1);
});
check('daily aggregation does not mutate hourly timestamp', () => {
    const input = [row('20260923', '0100'), row('20260924', '0000')];
    e.town._getDaySummaryList(input);
    assert.equal(input[1].date, '20260924');
    assert.equal(input[1].time, '0000');
});
const p = require('../../lib/history/policy');
const now = Date.parse('2026-09-24T07:27:00Z');
const raw = {
    stnId: '108',
    tm: '2026-09-23 12:00',
    ta: '21',
    hm: '70',
    rn: '',
    ws: '2',
    wd: '0',
    dc10Tca: '4'
};
const keys = new Set(p.range('hourly', '20260917', '20260923', now));
check('seven complete KST dates and 168 hourly slots include yesterday', () => {
    assert.equal(keys.size, 168);
    assert(keys.has('202609230000'));
    assert(keys.has('202609232300'));
    assert.equal(p.instant('202609231200'), Date.parse('2026-09-23T03:00:00Z'));
});
check('KST month/year/leap-date boundaries are host independent', () => {
    assert.equal(p.addDays('20270101', -1), '20261231');
    assert.equal(p.addDays('20260301', -1), '20260228');
    assert(Number.isNaN(p.instant('202602300000')));
    assert.equal(p.slot({ date: '20261231', time: '2400' }), '202701010000');
});
check('normalization keeps zero and rejects empty rain, QC failure and nonfinite fields', () => {
    const n = p.normalize('hourly', raw, '108', keys, now);
    assert.equal(n.values.vec, 0);
    assert.equal(n.values.rn1, undefined);
    assert.equal(n.date.toISOString(), '2026-09-23T03:00:00.000Z');
    const invalid = p.normalize(
        'hourly',
        { ...raw, taQcflag: '1', hm: 'Infinity', ws: 'null', rn: '-1' },
        '108',
        keys,
        now
    );
    assert.equal(invalid.values.t1h, undefined);
    assert.equal(invalid.values.reh, undefined);
    assert.equal(invalid.values.wsd, undefined);
    assert.equal(invalid.values.rn1, undefined);
});
check('wrong station/date/minute/calendar are rejected', () => {
    for (const patch of [
        { stnId: '159' },
        { tm: '2026-09-24 12:00' },
        { tm: '2026-09-23 12:30' },
        { tm: '2026-09-31 12:00' }
    ])
        assert.equal(p.normalize('hourly', { ...raw, ...patch }, '108', keys, now), undefined);
});
check('daily timestamp stays its own KST date; inverted extrema rejected', () => {
    const allowed = new Set(['20260923']);
    const n = p.normalize(
        'daily',
        { stnId: 108, tm: '2026-09-23', minTa: '12', maxTa: '25', sumRn: '' },
        '108',
        allowed,
        now
    );
    assert.equal(n.key, '20260923');
    assert.equal(n.values.rn1, undefined);
    assert.equal(
        p.normalize('daily', { stnId: 108, tm: '2026-09-23', minTa: '25', maxTa: '12' }, '108', allowed, now),
        undefined
    );
});
check('stored explicit source keys fill humidity and preserve valid temperature', () => {
    const target = { date: '20260923', time: '1200', t1h: 15, reh: -1 };
    p.mergeHourly({ currentList: [target] }, [p.normalize('hourly', raw, '108', keys, now)]);
    assert.equal(target.t1h, 15);
    assert.equal(target.reh, 70);
    assert.equal(target.historyObservation.fields.includes('t1h'), false);
});
check('daily-only data survives absent hourly history without manufacturing hours', () => {
    const req = { currentList: [], midData: { dailyData: [] } };
    const n = p.normalize(
        'daily',
        { stnId: 108, tm: '2026-09-23', minTa: '12', maxTa: '25' },
        '108',
        new Set(['20260923']),
        now
    );
    p.mergeDaily(req, [n], now);
    const status = p.status(req, now);
    assert.equal(req.currentList.length, 0);
    assert.equal(req.midData.dailyData[0].date, '20260923');
    assert.equal(status.missingHourlySlots.length, 168);
    assert.equal(status.missingDailyDates.length, 6);
});
check('daily repair preserves valid existing daily and forecast extrema', () => {
    const req = {
        midData: {
            dailyData: [
                { date: '20260923', taMin: 1, taMax: 2 },
                { date: '20260925', taMin: 3, taMax: 4 }
            ]
        }
    };
    const n = p.normalize(
        'daily',
        { stnId: 108, tm: '2026-09-23', minTa: '12', maxTa: '25' },
        '108',
        new Set(['20260923']),
        now
    );
    p.mergeDaily(req, [n], now);
    assert.equal(req.midData.dailyData[0].taMin, 1);
    assert.equal(req.midData.dailyData[1].taMin, 3);
});
check('partial hourly aggregate yields to valid official daily measurement', () => {
    const req = {
        midData: {
            dailyData: [
                {
                    date: '20260923',
                    taMin: 20,
                    taMax: 20,
                    observationType: 'hourly-summary',
                    observationHours: 1,
                    rn1: 0
                }
            ]
        }
    };
    const n = p.normalize(
        'daily',
        { stnId: 108, tm: '2026-09-23', minTa: '12', maxTa: '25' },
        '108',
        new Set(['20260923']),
        now
    );
    p.mergeDaily(req, [n], now);
    assert.equal(req.midData.dailyData[0].taMin, 12);
    assert.equal(req.midData.dailyData[0].rn1, undefined);
});
check('station mapping is deterministic, distance bounded and ASOS city-only', () => {
    const town = { gCoord: { lat: 37.57, lon: 126.97 } };
    const st = [
        { stnId: '108', stnName: 'Seoul', isCityWeather: true, geo: [126.96, 37.57] },
        { stnId: '159', isCityWeather: true, geo: [129.03, 35.1] }
    ];
    assert.equal(p.nearest(town, st, 100).stationId, '108');
    assert.equal(p.nearest(town, [st[1]], 100), undefined);
    assert.equal(p.nearest(town, [{ ...st[0], isCityWeather: false }], 100), undefined);
});
check('missing ranges do not include already complete slots', () => {
    assert.deepEqual(p.ranges('hourly', ['202609231100', '202609231300', '202609231400']), [
        { start: '202609231100', end: '202609231100' },
        { start: '202609231300', end: '202609231400' }
    ]);
});
check('operator command rejects unbounded range, current day and extra flags', () => {
    const cli = require('../../lib/history/cli');
    assert.throws(() => cli.parse(['--station', '108', '--start', '20260901', '--end', '20260923'], now));
    assert.throws(() => cli.parse(['--station', '108', '--start', '20260924', '--end', '20260924'], now));
    assert.throws(() => cli.parse(['--all', 'true'], now));
    assert.equal(
        cli.parse(['--station', '108', '--start', '20260917', '--end', '20260923'], now).station,
        '108'
    );
});
check('ASOS missing rain cannot become zero in three-hour aggregation', () => {
    const rows = ['1000', '1100', '1200'].map((time) => ({
        ...row('20260923', time),
        rn1: -1,
        pty: -1,
        lgt: -1,
        historyObservation: { source: 'KMA_ASOS', stationId: '108' }
    }));
    const out = e.town._convert1Hto3H(rows, true);
    assert.equal(out[0].rn1, -1);
    assert.equal(out[0].pty, -1);
    assert.equal(out[0].lgt, -1);
});
check('configured startup and hourly scheduling queue recovery; disabled mode does not', () => {
    for (const enabled of [false, true]) {
        const env = dh.environment('2.0', '2026-09-24T07:02:00Z');
        const Manager = env.load('controllers/controllerManager.js', {
            '../config/config': {
                db: { version: '2.0' },
                keyString: { dongnae_forecast_keys: '[]' },
                history: { enabled }
            }
        });
        const manager = Object.create(Manager.prototype),
            names = [];
        manager.asyncTasks = { length: 0, push: (fn) => names.push(fn.name) };
        manager._requestApi = (name, callback) => callback();
        manager.checkTimeAndRequestTask(false);
        assert.equal(names.includes('AsosHistory'), enabled);
    }
});
check('winter ASOS rain is not relabeled as a one-hour accumulation', () => {
    for (const month of ['01', '03', '11', '12']) {
        const key = '2026' + month + '151200';
        const normalized = p.normalize(
            'hourly',
            { ...raw, tm: '2026-' + month + '-15 12:00', rn: '2.4' },
            '108',
            new Set([key]),
            now
        );
        assert.equal(normalized.values.rn1, undefined);
        assert.equal(normalized.values.t1h, 21);
    }
    const summer = p.normalize('hourly', { ...raw, rn: '2.4' }, '108', keys, now);
    assert.equal(summer.values.rn1, 2.4);
    const daily = p.normalize(
        'daily',
        { stnId: '108', tm: '2026-01-15', minTa: '-2', maxTa: '3', sumRn: '2.4' },
        '108',
        new Set(['20260115']),
        now
    );
    assert.equal(daily.values.rn1, 2.4);
});
check('recovered response omits rain sentinels for existing client charts', () => {
    const original = {
        date: '20260923',
        historyObservation: [{ source: 'KMA_ASOS' }],
        rn1: -1,
        rn1Str: '-1mm',
        r06: -1,
        s06: -1
    };
    const valid = { historyObservation: original.historyObservation, rn1: 0, r06: 2.4 };
    const legacy = { rn1: -1 };
    const output = p.hourlyResponse([original, valid, legacy]);
    assert.equal(output[0].rn1, undefined);
    assert.equal(output[0].rn1Str, undefined);
    assert.equal(output[0].r06, undefined);
    assert.equal(output[0].s06, undefined);
    assert.equal(output[1].rn1, 0);
    assert.equal(output[1].r06, 2.4);
    assert.equal(output[2], legacy);
    assert.equal(original.rn1, -1);
});
console.log(JSON.stringify({ passed, failures }));
if (failures) process.exitCode = 1;
