'use strict';
// Full production router/serialization and exact installed-app chart block; isolated stored forecasts.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
process.env.TW_REPO = path.resolve(__dirname, '../../..');
const {makeFixture, createHarness, locations} = require('./rss-response-smoke');
const {observation} = require('./air-freshness-harness');
// Execute the app's actual hourly chart-data assembly without Ionic/device initialization.
function clientChart(info, code) {
    const source = fs.readFileSync(path.join(process.env.TW_REPO, 'client/www/js/controller.air.js'), 'utf8');
    const start = source.indexOf('var index = pollutant.hourly.findIndex');
    const end = source.indexOf('console.info({code:pollutant.code', start);
    assert(start >= 0 && end > start, 'client chart code block must exist');
    const context = {aqiCode: code, pollutant: info.pollutants[code], latestAirInfo: info.last,
        $scope: {aqiMaxValue: {[code]: 200}}, console: {log() {}}};
    vm.runInNewContext(source.slice(start, end), context, {filename: 'controller.air.js chart data'});
    return JSON.parse(JSON.stringify(context.$scope.airChart));
}
function forecasts(value) {
    return ['pm10','pm25'].flatMap(code => Array.from({length:24}, (_, i) => {
        const d = new Date(Date.UTC(2026,8,24,10+i));
        return {code, val: value, dataTime: d.toISOString().slice(0,16).replace('T',' '), pubDate: '2026-09-24 08:00'};
    }));
}
async function main() {
    const outcomes = [];
    for (const version of ['1.0','2.0']) {
        for (const scenario of ['fallback','valid-kaq','neither','kaq-error','explicit-airkorea']) {
            const fixture = makeFixture(locations[0], 'equal');
            const obs = observation('2026-09-24 09:00', '중구');
            fixture.arpltnInfo = {arpltn: obs, list: [obs], stnList: [[obs]]};
            fixture.airkoreaForecasts = scenario === 'neither' ? [] : forecasts(35);
            fixture.kaqForecasts = scenario === 'valid-kaq' ? forecasts(22) : [{code:'pm10',val:99,dataTime:'2019-01-01 10:00',pubDate:'2019-01-01 00:00'}];
            fixture.kaqForecastError = scenario === 'kaq-error' ? 'KAQ store read failure' : undefined;
            const h = createHarness(version, fixture);
            const result = await h.request({airForecastSource: scenario === 'explicit-airkorea' ? 'airkorea' : 'kaq'});
            assert.deepEqual(result.traces, h.methods);
            const info = result.body.airInfoList[0];
            assert.equal(info.source, 'airkorea');
            assert.equal(info.last.pm10Value, obs.pm10Value);
            assert.equal(info.last.pm25Value, obs.pm25Value);
            assert.equal(info.last.dataTime, obs.dataTime);
            const chart = clientChart(info, 'pm10');
            const future = chart.data.filter(r => r.date > obs.dataTime && r.val !== undefined);
            const reads = result.queries.filter(q => q.forecastSource);
            assert(reads.every(q => q.stationName === obs.stationName));
            if (scenario === 'neither') {
                assert.equal(future.length, 0);
                assert.equal(info.forecastSource, undefined);
                assert.equal(info.forecastPubDate, undefined);
            } else {
                assert.equal(info.forecastSource, scenario === 'valid-kaq' ? 'kaq' : 'airkorea');
                assert.equal(info.forecastPubDate, '2026-09-24 08:00');
                for (const code of ['pm10','pm25','aqi']) {
                    const rows = info.pollutants[code].hourly.filter(r => r.date > obs.dataTime);
                    assert.equal(rows.length, 24, code + ' future hourly values');
                    assert(rows.every(r => Number.isFinite(r.val) && r.val >= 0));
                    if (code !== 'aqi') {
                        assert(rows.every(r => r.val === (scenario === 'valid-kaq' ? 22 : 35)));
                        assert(rows.every(r => r.pubDate === info.forecastPubDate));
                    }
                }
                assert.equal(future.length, 11, 'future values fill installed app chart slots');
                if (scenario === 'valid-kaq' || scenario === 'explicit-airkorea') assert.equal(reads.length, 1);
                else assert.deepEqual(reads.map(q => q.forecastSource), ['kaq','airkorea']);
            }
            assert(!result.logs.some(x => x.args.some(a => /TypeError|ReferenceError/.test(String(a)))));
            outcomes.push({version, scenario, source: info.forecastSource || null, publication: info.forecastPubDate || null,
                futureChartSlots: future.length, station: info.last.stationName, middleware: result.traces.length});
        }
    }
    console.log(JSON.stringify({outcome: 'passed', scenarios: outcomes}, null, 2));
}
module.exports = {clientChart};
if (require.main === module) main().catch(err => {console.error(err); process.exitCode = 1;});
