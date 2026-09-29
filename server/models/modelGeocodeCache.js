/**
 * Geocoder cache for the gateway routes (#2606). Replaces the Lambda's DynamoDB
 * tables. Keys: `c:{lat3},{lon3},{lang}` for coordinates and `a:{address}` for
 * addresses. Documents expire 30 days after `updatedAt` (TTL index created by
 * lib/geocoder/cache.js once the connection is open).
 */
'use strict';

var mongoose = require('mongoose');

var geocodeCacheSchema = new mongoose.Schema({
    _id: String,
    kind: String,           ///< 'coord' or 'addr'
    lang: String,
    geoInfo: mongoose.Schema.Types.Mixed,   ///< provider result (internal geoinfo)
    updatedAt: Date
}, {versionKey: false, autoIndex: false});

module.exports = mongoose.model('GeocodeCache', geocodeCacheSchema, 'geocodecaches');
