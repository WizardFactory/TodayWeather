/**
 * Created by Peter on 2018. 2. 10..
 */

'use strict';

var mongoose = require('mongoose');

var timezoneSchema = new mongoose.Schema({
    updatedAt: Date,
    timezone: String,
    timezoneOffset: Number,
    geo: {
        type: [Number],     // [<longitude(dmY)>, <latitude(dmX)>]
        index: '2d'         // create the geospatial index
    }
});

timezoneSchema.index({timezone:'hashed'});

module.exports = mongoose.model('timezone', timezoneSchema);
