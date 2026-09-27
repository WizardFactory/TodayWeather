/**
 * WAQI geo-feed results shared by all API workers for the domestic air fallback (#2622).
 * One document per 0.01° cell of the requesting town's coordinate; Mongo's TTL monitor
 * removes documents after expireAt, and readers ignore documents whose expireAt has passed.
 */

var mongoose = require('mongoose');

var waqiAirCacheSchema = new mongoose.Schema({
    _id: String,                                // "<lat>,<lon>" rounded to 0.01°
    outcome: String,                            // 'ok' (feed stored) or 'failed' (reason stored)
    reason: String,
    feed: mongoose.Schema.Types.Mixed,          // {name, geo: [lat, lon], time: ISO string, iaqi: {code: value}}
    fetchedAt: Date,
    expireAt: {type: Date, expires: 0}          // TTL index
}, {versionKey: false});

module.exports = mongoose.model('WaqiAirCache', waqiAirCacheSchema, 'waqi.air.caches');
