/** Short-term forecast prose, independent from special-weather and push state. */
'use strict';
var mongoose = require('mongoose');
var schema = new mongoose.Schema({
    _id: String, // office:KST publication, immutable across workers
    stationId: Number,
    announcement: Date, // true UTC instant, unlike legacy KmaSpecial dates
    text: String
});
schema.index({stationId:1, announcement:-1});
module.exports = mongoose.model('KmaForecastNarrative', schema);
