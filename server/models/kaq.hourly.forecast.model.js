/**
 * Created by aleckim on 2018. 1. 24..
 */

'use strict';

var mongoose = require('mongoose');

var kaqHourlyForecastSchema = new mongoose.Schema({
    stationName: String, //unique
    date: Date,
    code: String, //'pm10', 'pm25', 'o3', 'no2', 'co', 'so2'
    val: Number, //
    dataTime: String,
    pubDate: String,
});

kaqHourlyForecastSchema.index({stationName: 'hashed'});
kaqHourlyForecastSchema.index({date: 1});

module.exports = mongoose.model('KaqHourlyForecast', kaqHourlyForecastSchema);
