'use strict';
var mongoose = require('mongoose');
var schema = new mongoose.Schema({
    _id: String,
    sd: String,
    sgg: String,
    date: String, // YYYYMMDD target date in KST, independent of host TZ / DB_DATA_VERSION.
    value: Number, // Percent, derived from the MFDS 0..1 risk.
    grade: Number,
    baseDate: String,
    publication: String,
    fetchedAt: Date,
    expireAt: Date
});
schema.index({sd: 1, sgg: 1, date: 1});
schema.index({expireAt: 1}, {expireAfterSeconds: 0});
module.exports = mongoose.model('FoodPoisoning', schema, 'mfds_food_poisoning');
