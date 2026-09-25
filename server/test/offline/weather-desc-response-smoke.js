/* v000903 KMA coordinate route smoke for current weather text and summaries (#2576).
 * Reuses the rss-response-smoke harness: real router/middleware/controllers, synthetic
 * Mongo/geocode/provider boundaries, no HTTP socket, startup, timers or production calls.
 * Run: TZ=UTC NODE_PATH=<isolated deps> node server/test/offline/weather-desc-response-smoke.js
 */
'use strict';
const assert = require('assert');
const {makeFixture, createHarness, locations} = require('./rss-response-smoke');

// res.__ is identity in the harness, so labels appear as LOC keys.
const cases = [
  {name: 'observed-rain-stopped', weather: '비끝', type: 28, text: 'LOC_RAIN_STOPPED'},
  {name: 'observed-continuous-light-rain', weather: '약한비연속적', type: 19, text: 'LOC_LIGHT_RAIN'},
  {name: 'unmapped-falls-back-to-sky', weather: '없는날씨', type: 0, text: 'LOC_CLEAR'},
];

async function main() {
  assert.equal(new Date().getTimezoneOffset(), 0, 'Harness collector path requires TZ=UTC');
  const results = [];
  for (const version of ['1.0', '2.0']) for (const c of cases) {
    const fixture = makeFixture(locations[0], 'newer');
    fixture.stnWeather = {weather: c.weather};
    const env = createHarness(version, fixture);
    const {body} = await env.request({temperatureUnit: 'C', windSpeedUnit: 'm/s'});
    const cur = body.current;
    const label = version + '/' + c.name;
    assert.equal(cur.weatherType, c.type, label + ' weatherType');
    assert.equal(cur.weather, c.text, label + ' weather');
    for (const key of ['summary', 'summaryWeather']) {
      assert.equal(typeof cur[key], 'string', label + ' ' + key);
      assert(!/undefined/.test(cur[key]), label + ' ' + key + ' contains undefined: ' + cur[key]);
      assert(!/,\s*$/.test(cur[key]) && !/,\s*,/.test(cur[key]), label + ' ' + key + ' has empty item: ' + cur[key]);
      assert(cur[key].includes(c.text), label + ' ' + key + ' includes weather text: ' + cur[key]);
    }
    results.push({version, scenario: c.name, weather: c.weather, weatherType: cur.weatherType,
      text: cur.weather, summary: cur.summary, summaryWeather: cur.summaryWeather});
  }
  console.log(JSON.stringify({outcome: 'passed', scenarioCount: results.length, results}, null, 2));
}
main().catch(err => { console.error(err.stack); process.exitCode = 1; });
