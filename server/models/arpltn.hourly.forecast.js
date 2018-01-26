/**
 * Created by aleckim on 2018. 1. 24..
 */

'use strict';

var mongoose = require('mongoose');

var arpltnHourlyForecastSchema = new mongoose.Schema({
    stationName: String, //unique
    date: Date,
    code: String, //'pm10', 'pm25', 'o3'
    val: Number, //
    dataTime: String,
    pubDate: String,
});

arpltnHourlyForecastSchema.index({stationName: 'hashed'});
arpltnHourlyForecastSchema.index({date: 1});

module.exports = mongoose.model('ArpltnHourlyForecast', arpltnHourlyForecastSchema);
