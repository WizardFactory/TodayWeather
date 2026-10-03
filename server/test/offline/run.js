'use strict';
// Resolve dependencies through normal Node resolution (including NODE_PATH).
// Explicit selection keeps legacy provider/database suites out of this command.
var path = require('path');
var spawnSync = require('child_process').spawnSync;
var commands = [
    [path.join(__dirname, 'payment-removal.test.js')],
    [path.join(__dirname, 'payment-removal-smoke.js')],
    [path.join(__dirname, 'payment-removal-smoke.js'), 'production'],
    [path.join(__dirname, 'data-go-kr-keys.test.js')],
    [path.join(__dirname, 'env-startup.test.js')],
    [require.resolve('mocha/bin/_mocha'), path.join(__dirname, 'gather-code-drift.test.js')],
    [path.join(__dirname, 'gather-smoke.js')],
    [path.join(__dirname, 'gather-policy.test.js')],
    [path.join(__dirname, 'gather-quota.test.js')],
    [path.join(__dirname, 'forecast-grid-collection.test.js')],
    [path.join(__dirname, 'forecast-manager.test.js')],
    [path.join(__dirname, 'forecast-lifecycle.test.js')],
    [path.join(__dirname, 'current-grid-collection.test.js')],
    [path.join(__dirname, 'current-lifecycle.test.js')],
    [path.join(__dirname, 'current-writer-cancellation.test.js')],
    [path.join(__dirname, 'current-manager.test.js')],
    [path.join(__dirname, 'current-quota-memory.test.js')],
    [path.join(__dirname, 'forecast-traffic.test.js')],
    [path.join(__dirname, 'daily-forecast.test.js')],
    [path.join(__dirname, 'daily-review.test.js')],
    [path.join(__dirname, 'short-rss-daily.test.js')],
    [path.join(__dirname, 'rss-wind.test.js')],
    [path.join(__dirname, 'history-observations.test.js')],
    [path.join(__dirname, 'history-recovery.test.js')],
    [path.join(__dirname, 'historical-fallback.test.js')],
    [path.join(__dirname, 'history-read-cache.test.js')],
    [path.join(__dirname, 'test.minute.scrape.js')],
    [path.join(__dirname, 'test.hourly.scrape.js')],
    [path.join(__dirname, 'test.city.parser.js')],
    [path.join(__dirname, 'test.minute.merge.js')],
    [path.join(__dirname, 'weather-desc.test.js')],
    [path.join(__dirname, 'air-summary.test.js')],
    [path.join(__dirname, 'air-freshness.test.js')],
    [path.join(__dirname, 'airkorea-collection.test.js')],
    [path.join(__dirname, 'nation-air.test.js')],
    [path.join(__dirname, 'air-freshness-route.test.js')],
    [path.join(__dirname, 'air-chain.test.js')],
    [path.join(__dirname, 'air-fallback.test.js')],
    [path.join(__dirname, 'world-air.test.js')],
    [path.join(__dirname, 'riseset-uv.test.js')],
    [path.join(__dirname, 'life-index-2650.test.js')],
    [path.join(__dirname, 'food-poisoning.test.js')],
    [path.join(__dirname, 'food-poisoning-route.test.js')],
    [path.join(__dirname, 'precipitation.test.js')],
    [path.join(__dirname, 'vc-weather.test.js')],
    [path.join(__dirname, 'overseas-uv.test.js')],
    [path.join(__dirname, 'gateway-geocoder.test.js')],
    [path.join(__dirname, 'gateway-route.test.js')],
    [path.join(__dirname, 'weather-unavailable-smoke.js')],
    [path.join(__dirname, 'gateway-callers.test.js')],
    [path.join(__dirname, 'kma-warning.test.js')],
    [path.join(__dirname, 'push-store.test.js')],
    [path.join(__dirname, 'push-s3.test.js')]
];
commands.forEach(function (args) {
    var result = spawnSync(process.execPath, args, {stdio: 'inherit'});
    if (result.error) { throw result.error; }
    if (result.status !== 0) { process.exit(result.status || 1); }
});
