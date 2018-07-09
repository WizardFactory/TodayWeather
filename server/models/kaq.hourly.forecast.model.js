/**
 * Created by aleckim on 2018. 1. 24..
 */

"use strict";

var mongoose = require('mongoose');

var kaqHourlyForecastSchema = new mongoose.Schema({
    stationName: String, //unique
    date: Date,
    code: String, //'pm10', 'pm25', 'o3', 'no2', 'co', 'so2'
    mapCase: String, //'modelimg', 'modelimg_CASE2', 'modelimg_CASE4', 'modelimg_CASE5'
    val: Number, //
    dataTime: String,
    pubDate: String,
});

kaqHourlyForecastSchema.index({stationName: 'hashed'});
kaqHourlyForecastSchema.index({mapCase: 'hashed'});
kaqHourlyForecastSchema.index({date: 1});
kaqHourlyForecastSchema.index({"mapCase": 1, "stationName": 1, "date": 1});
kaqHourlyForecastSchema.index({"mapCase": 1, "stationName": 1, "pubDate": 1, "code":1});

module.exports = mongoose.model('KaqHourlyForecast', kaqHourlyForecastSchema);
