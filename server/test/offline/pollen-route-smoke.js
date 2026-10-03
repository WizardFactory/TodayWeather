'use strict';
// Run the production v000903 KMA middleware with isolated stores/providers.
process.env.TW_SMOKE_NOW = '2026-09-24T00:10:00Z';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.env.TW_REPO = path.resolve(__dirname, '../../..');
const route = require('./rss-response-smoke');
const en = require('../../locales/en.json');
async function main() {
    const captured = {};
    for (const [scenario, grades, maximum] of [
        ['spring', {flowerWoody: 2, flowerPine: 1}, 2],
        ['autumn', {flowerWeeds: 1}, 1], ['low', {flowerWeeds: 0}, 0], ['missing', {}, undefined]
    ]) {
        const f = route.makeFixture(route.locations[0], 'newer');
        f.dailySource = {pubDate: f.basePub, rows: f.short};
        f.areaNoRows = [{town: f.place.town, areaNo: 1100000000, geo: [126.978, 37.5665]}];
        f.lifeIndexRows = Object.entries(grades).map(([indexType, index]) => ({
            areaNo: 1100000000, indexType, index, date: new Date('2026-09-24T00:00:00Z'),
            lastUpdateDate: '2026092406'
        }));
        const harness = route.createHarness('2.0', f, {translate: key => en[key] || key});
        const result = await harness.request({});
        assert.deepEqual(result.traces, harness.methods);
        const today = result.body.midData.dailyData.find(day => day.date === '20260924');
        assert.ok(today);
        for (const row of [today, result.body.current]) {
            assert.equal(row.pollenGrade, maximum);
            assert.equal(row.pollenStr, maximum === undefined ? undefined : ['Low', 'Normal', 'High'][maximum]);
            for (const type of ['flowerWoody', 'flowerPine', 'flowerWeeds']) {
                assert.equal(type in row, type in grades);
                assert.equal(type + 'Str' in row, type in grades);
            }
        }
        assert.ok(result.body.midData.dailyData.filter(day => day.date !== '20260924')
            .every(day => !('pollenGrade' in day)));
        captured[scenario] = result.body;
    }
    if (process.env.POLLEN_CAPTURE) fs.writeFileSync(process.env.POLLEN_CAPTURE, JSON.stringify(captured, null, 2));
    console.log('PASS v000903 pollen: spring, autumn, zero and no data; production middleware with offline stores.');
}
main().catch(err => {console.error(err); process.exitCode = 1;});
