/* Full v000903 KMA coordinate router smoke for the current air summary (#2578).
 * Uses the rss-response-smoke harness: no HTTP socket, Mongo, provider calls or timers.
 * Run: TZ=UTC NODE_PATH=/tmp/tw-rss-smoke/node_modules node server/test/offline/air-summary-smoke.js
 * Optional TW_SMOKE_OUTPUT_DIR selects artifact directory outside the checkout.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {makeFixture, createHarness, locations} = require('./rss-response-smoke');
const outputDir = process.env.TW_SMOKE_OUTPUT_DIR || path.join(require('os').tmpdir(), 'air-summary-smoke-output');
fs.mkdirSync(outputDir, {recursive: true});

const freshAir = {stationName: '중구', mangName: '도시대기', dataTime: '2026-09-24 09:00',
    pm10Value: 20, pm10Grade: 1, pm25Value: 8, pm25Grade: 1, o3Value: 0.02, o3Grade: 1,
    no2Value: 0.01, no2Grade: 1, coValue: 0.3, coGrade: 1, so2Value: 0.003, so2Grade: 1};
// getKeco stores arpltnObj.arpltn as-is; undefined is what _mergeArpltnList returns without a fresh station.
const scenarios = [
    {id: 'missing-air', arpltnInfo: {arpltn: undefined, list: undefined, stnList: []}, expectAir: undefined},
    {id: 'empty-air', arpltnInfo: {arpltn: {}, list: [], stnList: []}, expectAir: undefined},
    {id: 'fresh-good-air', arpltnInfo: {arpltn: freshAir, list: [freshAir], stnList: [[freshAir]]}, expectAir: 'LOC_AIR_QUALITY_IS_GOOD'}
];

async function main() {
    const output = [];
    for (const version of ['1.0', '2.0']) for (const scenario of scenarios) {
        const fixture = makeFixture(locations[0], 'equal');
        fixture.arpltnInfo = scenario.arpltnInfo;
        const harness = createHarness(version, fixture);
        const result = await harness.request({windSpeedUnit: 'm/s', temperatureUnit: 'C'});
        const current = result.body.current;
        const label = version + '/' + scenario.id;
        assert.deepEqual(result.traces, harness.methods, label + ': all v000903 coordinate middleware execute');
        assert(current.wsdGrade > 0, label + ': fixture has weather grades that must not become air grades');
        if (scenario.expectAir === undefined) {
            // Installed app share text tests hasOwnProperty('summaryAir'); an empty string adds a blank line.
            assert.equal('summaryAir' in current, false, label + ': empty air summary is omitted');
        }
        else {
            assert.equal(current.summaryAir, scenario.expectAir, label + ': air summary');
        }
        assert.equal(typeof current.summary, 'string', label + ': combined summary');
        if (scenario.id === 'missing-air') {
            assert.equal(current.arpltn, undefined, label + ': no air observation in response');
            assert.equal(current.aqiGrade, undefined, label + ': no air grade written onto current');
        }
        const thrown = result.logs.filter(x => x.args.some(a => typeof a === 'string' && /TypeError|ReferenceError|AssertionError/.test(a)));
        assert.deepEqual(thrown, [], label + ': no swallowed programming exceptions');
        output.push({version, scenario: scenario.id, summaryAir: current.summaryAir, summary: current.summary,
            wsdGrade: current.wsdGrade, arpltnPresent: current.arpltn !== undefined});
    }
    const report = {createdAt: new Date().toISOString(), hostTimezone: process.env.TZ || 'system', outcome: 'passed', scenarioCount: output.length, scenarios: output};
    fs.writeFileSync(path.join(outputDir, 'air-summary-evidence.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
}
main().catch(err => { console.error(err.stack); process.exitCode = 1; });
