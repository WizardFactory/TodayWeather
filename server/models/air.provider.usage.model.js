/**
 * Shared counters and markers of the air quality provider chain (#2628), one document per
 * provider and window, so all API workers see the same free-tier usage:
 *   "<provider>:m:<YYYY-MM>"        free calls this UTC month
 *   "<provider>:min:<YYYY-MM-DDTHH:mm>"  calls this minute (OpenWeather rate limit)
 *   "<provider>:paid:m:<YYYY-MM>"   paid calls this UTC month
 *   "<provider>:down"               provider marked unavailable until expireAt
 * Query: db.air.provider.usage.find().sort({_id: 1})
 */

var mongoose = require('mongoose');

var airProviderUsageSchema = new mongoose.Schema({
    _id: String,
    calls: {type: Number, default: 0},          // provider requests, including failed ones
    failures: {type: Number, default: 0},
    records: {type: Number, default: 0},        // Visual Crossing query cost (also counted in vc.usage)
    reason: String,                             // down marker: auth | quota
    expireAt: {type: Date, expires: 0}          // TTL index
}, {versionKey: false});

module.exports = mongoose.model('AirProviderUsage', airProviderUsageSchema, 'air.provider.usage');
