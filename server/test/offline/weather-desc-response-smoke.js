/* v000903 KMA coordinate route smoke for current weather text and summaries (#2576).
 * Reuses the rss-response-smoke harness: real router/middleware/controllers, synthetic
 * Mongo/geocode/provider boundaries, no HTTP socket, startup, timers or production calls.
 * Run: TZ=UTC NODE_PATH=<isolated deps> node server/test/offline/weather-desc-response-smoke.js
 */
'use strict';
const assert = require('assert');
const {makeFixture, createHarness, locations} = require('./rss-response-smoke');

// res.__ is identity in the harness, so labels appear as LOC keys; text '' means no weather item.
const cases = [
  {name: 'observed-rain-stopped', weather: '비끝', type: 28, text: 'LOC_RAIN_STOPPED'},
  {name: 'observed-continuous-light-rain', weather: '약한비연속적', type: 19, text: 'LOC_LIGHT_RAIN'},
  {name: 'unmapped-falls-back-to-sky', weather: '없는날씨', type: 0, text: 'LOC_CLEAR'},
  // -1 with a pty>=1 fallback: station text containing 비 sets pty 1.
  {name: 'unmapped-rain-text-falls-back-to-pty', weather: '비조금', type: 65, text: 'LOC_RAIN'},
  // -1 with stored nowcast PTY 5 (빗방울) that station text does not rewrite.
  {name: 'unmapped-with-nowcast-pty5', weather: '빗방울', pty: 5, type: 19, text: 'LOC_LIGHT_RAIN'},
  // No station text (city page blank, or hourly rows missing since #2573) with nowcast PTY 5.
  {name: 'no-station-text-with-nowcast-pty5', stnWeather: {hourlyMissing: true}, pty: 5, type: 19, text: 'LOC_LIGHT_RAIN'},
  // -1 with no usable sky: text stays empty and both summaries omit the weather item.
  {name: 'unmapped-with-invalid-sky', weather: '없는날씨', sky: -1, type: -1, text: ''},
];

async function main() {
  assert.equal(new Date().getTimezoneOffset(), 0, 'Harness collector path requires TZ=UTC');
  const results = [];
  for (const version of ['1.0', '2.0']) for (const c of cases) {
    const fixture = makeFixture(locations[0], 'newer');
    for (const row of fixture.current) {
      if (c.pty !== undefined) row.pty = c.pty;
      if (c.sky !== undefined) row.sky = c.sky;
    }
    if (c.sky !== undefined) for (const row of fixture.shortest) row.sky = c.sky;
    fixture.stnWeather = c.stnWeather || {weather: c.weather};
    const env = createHarness(version, fixture);
    const {body, logs} = await env.request({temperatureUnit: 'C', windSpeedUnit: 'm/s'});
    const cur = body.current;
    const label = version + '/' + c.name;
    const thrown = logs.filter(x => x.args.some(a => typeof a === 'string' && /TypeError|ReferenceError|AssertionError/.test(a)));
    assert.deepEqual(thrown, [], label + ' swallowed programming exception');
    assert.equal(cur.weatherType, c.type, label + ' weatherType');
    assert.equal(cur.weather, c.text, label + ' weather');
    for (const key of ['summary', 'summaryWeather']) {
      assert.equal(typeof cur[key], 'string', label + ' ' + key);
      assert(cur[key].length > 0, label + ' ' + key + ' empty');
      assert(!/undefined/.test(cur[key]), label + ' ' + key + ' contains undefined: ' + cur[key]);
      assert(!/^\s*,|,\s*$|,\s*,/.test(cur[key]), label + ' ' + key + ' has empty item: ' + cur[key]);
      if (c.text) assert(cur[key].includes(c.text), label + ' ' + key + ' includes weather text: ' + cur[key]);
    }
    results.push({version, scenario: c.name, weather: c.weather, pty: cur.pty, sky: cur.sky, weatherType: cur.weatherType,
      text: cur.weather, summary: cur.summary, summaryWeather: cur.summaryWeather});
  }
  console.log(JSON.stringify({outcome: 'passed', scenarioCount: results.length, results}, null, 2));
}
main().catch(err => { console.error(err.stack); process.exitCode = 1; });
