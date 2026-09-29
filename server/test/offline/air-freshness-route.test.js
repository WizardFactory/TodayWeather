'use strict';
// Full v000903 route serialization with isolated Mongo/provider boundaries.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.TW_REPO = require('node:path').resolve(__dirname, '../../..');
const {makeFixture, createHarness, locations} = require('./rss-response-smoke');
const {observation} = require('./air-freshness-harness');
const now = '2026-09-24 09:00';
for (const version of ['1.0', '2.0']) {
    for (const fresh of [true, false]) {
        test('v000903 DB ' + version + ' omits stale detail; fresh=' + fresh, async () => {
            const fixture = makeFixture(locations[0], 'newer');
            const old = observation('2026-09-23 23:00', 'old');
            const rows = fresh ? [observation(now), old] : [old];
            fixture.arpltnInfo = {arpltn: fresh ? rows[0] : undefined, list: rows, stnList: [[], [old], rows]};
            const result = await createHarness(version, fixture).request({});
            const body = result.body;
            if (!fresh) {
                assert(!body.airInfoList || body.airInfoList.length === 0);
                assert(!body.airInfo || !body.airInfo.last);
            } else {
                assert.equal(body.airInfoList.length, 1);
                assert.equal(body.airInfoList[0].last.stationName, 'fresh');
                const rows = body.airInfoList[0].pollutants.pm10.hourly.filter(x => x.val !== undefined);
                assert.equal(rows.length, 1);
                assert.equal(rows[0].date, now);
            }
        });
    }
}
