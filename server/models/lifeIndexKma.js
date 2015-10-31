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
    fsn: { /* 식중독 food poisoning */
        lastUpdateDate: String,
        data: [ {date: String, value: Number} ] //daily
    },
    ultrv: { /*자외선 ultraviolet rays*/
        lastUpdateDate: String,
        data: [ {date: String, value: Number}] //daily
    },
    rot: { /* 부패 rot */
        lastUpdateDate: String,
        data: [ {date: String, time: String, value: Number} ] // 3hours
    },
    sensorytem: { /* feels like temperature */
        lastUpdateDate: String,
        data: [ {date: String, time: String, value: Number} ] // 3hours
    },
    frostbite: { /* 동상 */
        lastUpdateDate: String,
        data: [ {date: String, time: String, value: Number} ] //3hours
    },
    heat: { /* 열 */
        lastUpdateDate: String,
        data: [ {date: String, time: String, value: Number} ] //3hours
    },
    dspls: { /* 불쾌 displeasure */
        lastUpdateDate: String,
        data: [ {date: String, time: String, value: Number} ] //3hours
    },
    winter: {  /* 동파 */
        lastUpdateDate: String,
        data: [ {date: String, time: String, value: Number} ] //3hours
    },
    airpollution: { /* 확산 */
        lastUpdateDate: String,
        data: [ {date: String, time: String, value: Number}] //3hours
    }
});

module.exports = mongoose.model('LifeIndexKma', lSchema);

