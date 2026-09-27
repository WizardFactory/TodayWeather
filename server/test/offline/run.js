'use strict';
// Resolve dependencies through normal Node resolution (including NODE_PATH).
// Explicit selection keeps legacy provider/database suites out of this command.
var path = require('path');
var spawnSync = require('child_process').spawnSync;
var commands = [
    [path.join(__dirname, 'env-startup.test.js')],
    [require.resolve('mocha/bin/_mocha'), path.join(__dirname, 'gather-code-drift.test.js')],
    [path.join(__dirname, 'gather-smoke.js')],
    [path.join(__dirname, 'gather-policy.test.js')],
    [path.join(__dirname, 'daily-forecast.test.js')],
    [path.join(__dirname, 'daily-review.test.js')],
    [path.join(__dirname, 'short-rss-daily.test.js')],
    [path.join(__dirname, 'rss-wind.test.js')],
    [path.join(__dirname, 'history-observations.test.js')],
    [path.join(__dirname, 'history-recovery.test.js')],
    [path.join(__dirname, 'test.minute.scrape.js')],
    [path.join(__dirname, 'test.hourly.scrape.js')],
    [path.join(__dirname, 'test.city.parser.js')],
    [path.join(__dirname, 'test.minute.merge.js')],
    [path.join(__dirname, 'weather-desc.test.js')],
    [path.join(__dirname, 'air-summary.test.js')],
    [path.join(__dirname, 'riseset-uv.test.js')],
    [path.join(__dirname, 'precipitation.test.js')],
    [path.join(__dirname, 'vc-weather.test.js')]
];
commands.forEach(function (args) {
    var result = spawnSync(process.execPath, args, {stdio: 'inherit'});
    if (result.error) { throw result.error; }
    if (result.status !== 0) { process.exit(result.status || 1); }
});
