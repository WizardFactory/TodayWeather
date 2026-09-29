/**
 * Current air observations from the provider chain, shared by all API workers for the domestic
 * air fallback (#2622, generalized in #2628). One document per 0.01° cell of the requesting
 * town's coordinate; Mongo's TTL monitor removes documents after expireAt, and readers ignore
 * documents whose expireAt has passed.
 */

var mongoose = require('mongoose');

var airObservationCacheSchema = new mongoose.Schema({
    _id: String,                                // "<lat>,<lon>" rounded to 0.01°
    outcome: String,                            // 'ok' (observation stored) or 'failed' (reason stored)
    provider: String,                           // adapter id that answered
    reason: String,
    observation: mongoose.Schema.Types.Mixed,   // normalized observation (lib/air/observation.js)
    fetchedAt: Date,
    expireAt: {type: Date, expires: 0}          // TTL index
}, {versionKey: false});

module.exports = mongoose.model('AirObservationCache', airObservationCacheSchema, 'air.observation.caches');
