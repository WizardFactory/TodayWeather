/**
 * Created by aleckim on 2015. 10. 18..
 */

var mongoose = require('mongoose');

/**
 * kma life index schema
 */
var lSchema = new mongoose.Schema({
    town: {
        first: String,
        second: String,
        third: String
    },
    mCoord: {
        mx: Number,
        my: Number
    },
    areaNo: String,
    fsn: {
        lastUpdateDate: String,
        data: [ {date: String, value: Number} ] //daily
    },
    ultrv: {
        lastUpdateDate: String,
        data: [ {date: String, value: Number}] //daily
    },
    rot: {
        lastUpdateDate: String,
        data: [ {date: String, time: String, value: Number} ] // 3hours
    },
    sensorytem: {
        lastUpdateDate: String,
        data: [ {date: String, time: String, value: Number} ] // 3hours
    },
    frostbite: {
        lastUpdateDate: String,
        data: [ {date: String, time: String, value: Number} ] //3hours
    },
    heat: {
        lastUpdateDate: String,
        data: [ {date: String, time: String, value: Number} ] //3hours
    },
    dspls: {
        lastUpdateDate: String,
        data: [ {date: String, time: String, value: Number} ] //3hours
    },
    winter: {
        lastUpdateDate: String,
        data: [ {date: String, time: String, value: Number} ] //3hours
    },
    airpollution: {
        lastUpdateDate: String,
        data: [ {date: String, time: String, value: Number}] //3hours
    }
});

module.exports = mongoose.model('LifeIndexKma', lSchema);

