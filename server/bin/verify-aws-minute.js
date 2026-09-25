#!/usr/bin/env node
'use strict';
// Read-only operator sample, no models/index creation/provider calls/application startup.
(async function () {
    var mongoose;
    try {
        if (process.argv.length !== 2) throw new Error('AWS_MINUTE_VERIFY_ARGUMENTS');
        if (!process.env.AWS_MINUTE_MONGODB_URI) throw new Error('AWS_MINUTE_MONGODB_URI_REQUIRED');
        mongoose = require('mongoose');
        await mongoose.connect(process.env.AWS_MINUTE_MONGODB_URI, {
            autoIndex: false,
            connectTimeoutMS: 5000,
            socketTimeoutMS: 6000,
            bufferMaxEntries: 0,
        });
        var store = require('../lib/awsMinute/store').create(),
            now = Date.now();
        for (var station of ['108', '159', '184']) {
            var row = await store.latest(station, now);
            console.log(
                JSON.stringify({
                    stationId: station,
                    checkedAt: new Date(now).toISOString(),
                    observation: row || null,
                }),
            );
        }
    } catch (e) {
        console.error(
            /^AWS_MINUTE_[A-Z_]+$/.test(e.message) ? e.message : 'AWS_MINUTE_VERIFY_FAILED',
        );
        process.exitCode = 1;
    } finally {
        if (mongoose) await mongoose.disconnect();
    }
})();
