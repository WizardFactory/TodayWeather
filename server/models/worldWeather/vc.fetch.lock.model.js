/**
 * Per-location fetch lock for Visual Crossing requests (#2585).
 * One document per location while one worker fetches (plus "~provider" while the provider is
 * marked down); Mongo's TTL monitor removes
 * abandoned locks, and DsfController also takes over a lock whose expireAt has passed.
 */

var mongoose = require('mongoose');

var vcFetchLockSchema = new mongoose.Schema({
    _id: String,                                // "<lon>,<lat>" as stored in DsfForecast.geo
    expireAt: {type: Date, expires: 0},         // TTL index: removed once expireAt passes
    failed: Boolean                             // set by the holder after a failed fetch (backoff)
}, {versionKey: false});

module.exports = mongoose.model('VcFetchLock', vcFetchLockSchema, 'vc.fetch.locks');
