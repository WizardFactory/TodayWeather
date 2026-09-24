'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var root = process.cwd();
var envPath = path.join(root, 'server/.env');
var expected = require('dotenv').parse(fs.readFileSync(envPath));
// This is the real bootstrap and real config, with no provider/app imports.
require(path.join(root, 'server/config/env'));
var config = require(path.join(root, 'server/config/config'));
var passed = Object.keys(expected).every(function (key) { return process.env[key] === expected[key]; });
if (!passed || config.mode !== 'gather' || config.db.version !== '2.0' || config.port !== '3000') {
    throw new Error('Uploaded configuration smoke failed (values suppressed)');
}
['daum_keys', 'dongnae_forecast_keys', 'airkorea_keys'].forEach(function (key) {
    var parsed = JSON.parse(config.keyString[key]);
    if (!Array.isArray(parsed) || !parsed.every(function (value) { return typeof value === 'string'; })) {
        throw new Error('Configuration array validation failed (values suppressed)');
    }
});
if (config.db.path !== expected.MONGOLAB_MONGODB_URL ||
    config.keyString.newrelic !== expected.NEW_RELIC_LICENSE_KEY) {
    throw new Error('Configuration mapping failed (values suppressed)');
}
console.log('PASS real uploaded-file bootstrap/config smoke: 31 settings, mode, DB version, port, arrays and selected mappings; no app/provider/DB execution.');
