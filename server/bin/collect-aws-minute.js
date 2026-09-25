#!/usr/bin/env node
'use strict';
// Headless, explicit operator entry point; never loads app/gather/scraper/S3.
var cli = require('../lib/awsMinute/cli'),
    options;
try {
    options = cli.parse(process.argv.slice(2), process.env);
} catch (e) {
    console.error(e.message);
    process.exitCode = 2;
}
if (options && !options.enabled && !options.dryRun) {
    console.log(JSON.stringify({ disabled: true }));
} else if (options) {
    var mongoose;
    cli.run(options, {
        fetch: require('../lib/awsMinute/http').fetch,
        openStore: async function () {
            var uri = process.env.AWS_MINUTE_MONGODB_URI;
            if (!uri) throw new Error('AWS_MINUTE_MONGODB_URI_REQUIRED');
            mongoose = require('mongoose');
            await mongoose.connect(uri, {
                autoIndex: false,
                connectTimeoutMS: 5000,
                socketTimeoutMS: 6000,
                bufferMaxEntries: 0,
            });
            return require('../lib/awsMinute/store').create();
        },
        closeStore: async function () {
            if (mongoose) await mongoose.disconnect();
        },
        log: function (report) {
            console.log(JSON.stringify(report));
        },
        onStop: function (stop) {
            var stopping = false;
            function shutdown() {
                if (stopping) return;
                stopping = true;
                stop().catch(function () {
                    console.error('AWS_MINUTE_STOP_FAILED');
                    process.exitCode = 1;
                });
            }
            process.once('SIGTERM', shutdown);
            process.once('SIGINT', shutdown);
        },
    }).then(
        function (result) {
            if (result && result.ok === false && options.once) process.exitCode = 1;
        },
        function (e) {
            console.error(
                /^AWS_MINUTE_[A-Z_]+$/.test(e.message) ? e.message : 'AWS_MINUTE_START_FAILED',
            );
            process.exitCode = 1;
        },
    );
}
