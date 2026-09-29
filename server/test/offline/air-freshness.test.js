'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {harness, observation} = require('./air-freshness-harness');

if (!process.env.TW_FRESHNESS_TZ_CHILD) {
    for (const zone of ['UTC', 'Asia/Seoul', 'America/Los_Angeles']) {
        test('AirKorea freshness under ' + zone, () => {
            const run = spawnSync(process.execPath, [__filename], {
                env: Object.assign({}, process.env, {TZ: zone, TW_FRESHNESS_TZ_CHILD: '1'}), encoding: 'utf8'
            });
            assert.equal(run.status, 0, run.stdout + run.stderr);
        });
    }
} else {
    test('KST ordinary and 24:00 timestamps use elapsed eight hours without mutating request time', () => {
        const {keco} = harness('2026-09-29T05:00:00Z');
        for (const [stamp, instant] of [
            ['2026-09-29 00:00', '2026-09-28T15:00:00Z'],
            ['2026-09-28 24:00', '2026-09-28T15:00:00Z'],
            ['2026-12-31 24:00', '2026-12-31T15:00:00Z'],
            ['2024-02-29 24:00', '2024-02-29T15:00:00Z'],
            ['2026-03-08 17:00', '2026-03-08T08:00:00Z'], // LA spring DST boundary
            ['2026-11-01 16:00', '2026-11-01T07:00:00Z']  // LA autumn DST boundary
        ]) {
            for (const [hours, expected] of [[7, true], [8, false], [9, false]]) {
                const now = new Date(Date.parse(instant) + hours * 3600000);
                const before = now.getTime();
                assert.equal(keco._checkDateTime(observation(stamp), now), expected, stamp + ' age=' + hours);
                assert.equal(now.getTime(), before);
            }
        }
        for (const value of [undefined, null, {}, {dataTime: 12}, observation('bad'), observation('2026-02-30 12:00'),
            observation('2026-09-28 24:01'), observation('2026-13-01 00:00')]) {
            assert.equal(keco._checkDateTime(value, new Date()), false);
        }
        assert.equal(keco._mergeArpltnList([[], [observation('2026-09-29 05:00', 'old')],
            [observation('2026-09-29 07:00', 'fresh')]], new Date('2026-09-29T05:00:00Z')).stationName, 'fresh');
    });

    test('detail middleware omits stale station values and handles empty station lists', () => {
        const {detail} = harness('2026-09-29T05:00:00Z'); // 14:00 KST
        const old = observation('2026-09-29 05:00', 'old');
        const fresh = observation('2026-09-29 07:00');
        const req = {params: {}, query: {}, arpltnList: [fresh, old], arpltnStnList: [[], [old], [fresh, old]]};
        let next = 0;
        detail.makeAirInfo(req, {}, () => next++);
        detail.makeAirInfoList(req, {}, () => next++);
        assert.equal(next, 2);
        assert.equal(req.airInfo.last.stationName, 'fresh');
        assert.equal(req.airInfoList.length, 1);
        for (const air of [req.airInfo, ...req.airInfoList]) {
            const values = air.pollutants.pm10.hourly.filter(x => x.val !== undefined);
            assert.equal(values.length, 1, JSON.stringify(air.pollutants.pm10.hourly));
            assert.equal(values[0].date, '2026-09-29 07:00');
        }
        const empty = {params: {}, query: {}, arpltnList: [old], arpltnStnList: [[old], []]};
        detail.makeAirInfo(empty, {}, () => {});
        detail.makeAirInfoList(empty, {}, () => {});
        assert.equal(empty.airInfo, undefined);
        assert.equal(empty.airInfoList, undefined);
    });

    test('getKeco asynchronous error without arpltnObj calls next once', async () => {
        const {keco, town} = harness('2026-09-29T05:00:00Z');
        town._getTownInfo = (r, c, t, cb) => setImmediate(() => cb(null, {gCoord: {lat: 37.5665, lon: 126.978}}));
        keco.getArpLtnInfo = (info, date, cb) => setImmediate(() => cb(new Error('synthetic DB failure')));
        let count = 0;
        const req = {params: {}, current: {}};
        await new Promise(resolve => town.getKeco(req, {}, () => { count++; setImmediate(resolve); }));
        assert.equal(count, 1);
        assert.equal(req.current.arpltn, undefined);
    });
}
