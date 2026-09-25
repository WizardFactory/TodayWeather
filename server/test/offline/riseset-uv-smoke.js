/* Full v000903 KMA coordinate router smoke for daily sunrise/sunset and UV (#2587).
 * Uses the rss-response-smoke harness: no HTTP socket, Mongo, provider calls or timers.
 * The real KASI rise/set and life index controllers read synthetic store rows.
 * Run: TZ=UTC NODE_PATH=/tmp/tw-rss-smoke/node_modules node server/test/offline/riseset-uv-smoke.js
 * Optional TW_SMOKE_OUTPUT_DIR selects artifact directory outside the checkout.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {makeFixture, createHarness, locations} = require('./rss-response-smoke');
const sunRiseSet = require('../../lib/sunRiseSet');
const outputDir = process.env.TW_SMOKE_OUTPUT_DIR || path.join(require('os').tmpdir(), 'riseset-uv-smoke-output');
fs.mkdirSync(outputDir, {recursive: true});

const place = locations[0];
const areaNoRows = [{areaNo: '1111051500', geo: [place.gCoord.lon, place.gCoord.lat],
    town: {first: place.town.first, second: place.town.second, third: place.town.third}}];
// Stored dates follow kmaTimeLib.convertStringToDate on the UTC service host.
const day = (ymd, hh, mm) => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), hh || 0, mm || 0));
const kasiRow = (ymd, rise, set) => ({locdate: day(ymd), location: '서울', geo: [126.98, 37.56],
    sunrise: day(ymd, rise[0], rise[1]), sunset: day(ymd, set[0], set[1])});
const kasiRows = [kasiRow('20260924', [6, 11], [18, 31]), kasiRow('20260925', [6, 12], [18, 29])];
const lifeIndexRows = [
    {areaNo: 1111051500, date: day('20260924'), indexType: 'ultrv', index: 6, lastUpdateDate: '2026092406'},
    {areaNo: 1111051500, date: day('20260925'), indexType: 'ultrv', index: 3, lastUpdateDate: '2026092406'}
];
const RISE_SET_KEYS = ['sunrise', 'suntransit', 'sunset', 'moonrise', 'moontransit', 'moonset', 'civilm', 'civile',
    'nautm', 'naute', 'astm', 'aste', 'locationName', 'locationGeo'];
const UV_KEYS = ['ultrv', 'ultrvGrade', 'ultrvStr'];

const scenarios = [
    {id: 'stores-present', kasiRows, areaNoRows, lifeIndexRows},
    {id: 'stores-empty', kasiRows: [], areaNoRows: [], lifeIndexRows: []},
    {id: 'stores-fail', kasiRows: [], areaNoRows,
        modelErrors: {modelKasiRiseSet: 'synthetic kasi store failure', 'kma.lifeindex.model': 'synthetic life index failure'}}
];

function withoutRiseSetUv(dailyData) {
    return dailyData.map(row => {
        const copy = Object.assign({}, row);
        for (const key of RISE_SET_KEYS.concat(UV_KEYS)) delete copy[key];
        return copy;
    });
}

async function main() {
    const output = [];
    for (const version of ['1.0', '2.0']) {
        const bodies = {};
        for (const scenario of scenarios) {
            const fixture = makeFixture(place, 'equal');
            Object.assign(fixture, {kasiRows: scenario.kasiRows, areaNoRows: scenario.areaNoRows,
                lifeIndexRows: scenario.lifeIndexRows, modelErrors: scenario.modelErrors});
            const harness = createHarness(version, fixture);
            const result = await harness.request({windSpeedUnit: 'm/s', temperatureUnit: 'C'});
            const label = version + '/' + scenario.id;
            const daily = result.body.midData.dailyData;
            bodies[scenario.id] = result.body;
            assert.deepEqual(result.traces, harness.methods, label + ': all v000903 coordinate middleware execute');
            assert(daily.length >= 17, label + ': daily rows');
            for (const row of daily) {
                assert.match(row.sunrise, /^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}$/, label + ' ' + row.date + ': sunrise');
                assert.match(row.sunset, /^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}$/, label + ' ' + row.date + ': sunset');
                assert.equal(row.sunrise.slice(0, 10).replace(/\./g, ''), row.date, label + ': sunrise on its own date');
            }
            const computed = date => sunRiseSet.compute(place.gCoord.lat, place.gCoord.lon, date);
            const today = daily.find(row => row.date === '20260924');
            const tomorrow = daily.find(row => row.date === '20260925');
            const later = daily.find(row => row.date === '20260930');
            assert.deepEqual([later.sunrise, later.sunset], [computed('20260930').sunrise, computed('20260930').sunset], label + ': computed day');
            if (scenario.id === 'stores-present') {
                assert.deepEqual([today.sunrise, today.sunset], ['2026.09.24 06:11', '2026.09.24 18:31'], label + ': KASI row kept');
                assert.equal(tomorrow.sunrise, '2026.09.25 06:12', label + ': KASI row kept');
                assert.equal(today.ultrv, 6, label + ': today UV');
                assert.equal(today.ultrvGrade, 2, label + ': today UV grade');
                assert.equal(today.ultrvStr, 'LOC_HIGH', label + ': today UV text');
                assert.equal(tomorrow.ultrv, 3, label + ': tomorrow UV');
            }
            else {
                assert.deepEqual([today.sunrise, today.sunset], [computed('20260924').sunrise, computed('20260924').sunset], label + ': computed today');
                for (const row of daily) for (const key of UV_KEYS) assert.equal(key in row, false, label + ': no ' + key);
            }
            const thrown = result.logs.filter(x => x.args.some(a => typeof a === 'string' && /TypeError|ReferenceError|AssertionError/.test(a)));
            assert.deepEqual(thrown, [], label + ': no swallowed programming exceptions');
            if (scenario.id === 'stores-fail') {
                const failures = result.logs.filter(x => x.args.some(a => /synthetic (kasi store|life index) failure/.test(String(a && a.message || a))));
                assert(failures.length >= 2, label + ': both store failures logged');
            }
            output.push({version, scenario: scenario.id, days: daily.length,
                today: {sunrise: today.sunrise, sunset: today.sunset, ultrv: today.ultrv, ultrvStr: today.ultrvStr},
                warnings: result.logs.map(x => x.method + '/' + x.level + ': ' + String(x.args[0] && x.args[0].message || x.args[0]).split('\n')[0].slice(0, 120))});
        }
        const base = withoutRiseSetUv(bodies['stores-empty'].midData.dailyData);
        assert.deepEqual(withoutRiseSetUv(bodies['stores-fail'].midData.dailyData), base, version + ': failures leave other daily fields unchanged');
        assert.deepEqual(withoutRiseSetUv(bodies['stores-present'].midData.dailyData), base, version + ': stored values change only rise/set and UV fields');
    }
    const report = {createdAt: new Date().toISOString(), hostTimezone: process.env.TZ || 'system', outcome: 'passed', scenarioCount: output.length, scenarios: output};
    fs.writeFileSync(path.join(outputDir, 'riseset-uv-evidence.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
}
main().catch(err => { console.error(err.stack); process.exitCode = 1; });
