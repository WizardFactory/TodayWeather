/**
 * Created by aleckim on 2015. 10. 27..
 */

var mongoose = require('mongoose');

var aTownSchema = new mongoose.Schema({
    town: {
        first: String,
        second: String,
        third: String
    },
    mCoord: {
        mx: Number,
        my: Number
    },
    arpltn: {
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
    }
});

module.exports = mongoose.model('ArpLtnTown', aTownSchema);

