#!/usr/bin/env node
'use strict';
// Explicit operator command. Does not import app.js, start collectors or expose a route.
var args;
try {
    args = require('../lib/history/cli').parse(process.argv.slice(2));
} catch (e) {
    console.error(e.message);
    process.exit(2);
}
var config = require('../config/config');
if (!config.history.key || config.history.stations.indexOf(args.station) < 0) {
    console.error('Set ASOS_HISTORY_SERVICE_KEY and include station in ASOS_HISTORY_STATIONS');
    process.exit(2);
}
var mongoose = require('mongoose');
var Store = require('../lib/history/store'),
    Provider = require('../lib/history/provider'),
    Recovery = require('../lib/history/recovery');
(async function () {
    try {
        var options = { connectTimeoutMS: 10000, socketTimeoutMS: 30000, bufferMaxEntries: 0 };
        if (config.db.path.indexOf('srv') >= 0) options.dbName = config.db.database;
        await mongoose.connect(config.db.path, options);
        var report = await new Recovery(Store.create(), new Provider({ key: config.history.key })).run(
            args.station,
            args.start,
            args.end
        );
        console.log(JSON.stringify(report, null, 2));
        if (!report.complete) process.exitCode = 1;
    } catch (e) {
        console.error('HISTORY_BACKFILL_FAILED');
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
})();
