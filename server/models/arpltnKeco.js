/**
 * Created by aleckim on 2015. 10. 24..
 */

var mongoose = require('mongoose');

var aSchema = new mongoose.Schema({
    stationName: String, //unique
    dataTime: String,
    so2Value: Number,
    coValue: Number,
    o3Value: Number,
    no2Value: Number,
    pm10Value: Number,
    khaiValue: Number,
    khaiGrade: Number,
    so2Grade: Number,
    coGrade: Number,
    o3Grade: Number,
    no2Grade: Number,
    pm10Grade: Number
});

module.exports = mongoose.model('ArpltnKeco', aSchema);
