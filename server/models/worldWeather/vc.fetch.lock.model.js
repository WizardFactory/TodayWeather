/**
 * Per-location fetch lock for Visual Crossing requests (#2585).
 * One document per location while one worker fetches; Mongo's TTL monitor removes
 * abandoned locks, and DsfController also takes over a lock whose expireAt has passed.
 */

var mongoose = require('mongoose');

var vcFetchLockSchema = new mongoose.Schema({
    _id: String,                                // "<lon>,<lat>" as stored in DsfForecast.geo
    expireAt: {type: Date, expires: 0}          // TTL index: removed once expireAt passes
}, {versionKey: false});

module.exports = mongoose.model('VcFetchLock', vcFetchLockSchema, 'vc.fetch.locks');
