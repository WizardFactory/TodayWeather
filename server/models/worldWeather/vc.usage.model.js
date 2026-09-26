/**
 * Daily Visual Crossing usage per UTC day (#2585), for cost control and the launch-plan
 * switch triggers: the service host's console logs only errors, so counters live in Mongo.
 * Query: db.vc.usage.find().sort({_id: -1}).limit(7)
 */

var mongoose = require('mongoose');

var vcUsageSchema = new mongoose.Schema({
    _id: String,                        // UTC day "YYYY-MM-DD"
    calls: {type: Number, default: 0},  // provider requests (a retried request counts once)
    records: {type: Number, default: 0},// sum of queryCost
    failures: {type: Number, default: 0},
    http429: {type: Number, default: 0},
    slow: {type: Number, default: 0}    // calls that took longer than the response budget
}, {versionKey: false});

module.exports = mongoose.model('VcUsage', vcUsageSchema, 'vc.usage');
