/**
 * Created by aleckim on 2018. 1. 4..
 */

'use strict';

var mongoose = require('mongoose');

var sidoArpltnSchema = new mongoose.Schema({
    sidocityName: String,   // 시도/시군구
    date: Date,
    sidoName: String,       //시도명
    cityName: String,       //시군구 명
    cityNameEng: String,
    dataTime: String,       //측정일시 2016-07-21 08:00
    so2Value: Number,       //아황산가스 평균농도(단위 : ppm)
    coValue: Number,        //일산화탄소 평균농도(단위 : ppm)
    o3Value: Number,        //오존 평균농도(단위 : ppm)
    no2Value: Number,       //이산화질소 평균농도(단위 : ppm)
    pm10Value: Number,      //미세먼지(PM10) 평균농도(단위 : ㎍/㎥)
    pm25Value: Number,      //미세먼지(PM2.5) 평균농도(단위 : ㎍/㎥)
    khaiValue: Number      //통합대기환경 평균수치
});

sidoArpltnSchema.index({cityName: 'text'}, { default_language: 'none' });
sidoArpltnSchema.index({sidocityName: 'hashed'});
sidoArpltnSchema.index({"date": -1});
sidoArpltnSchema.index({"cityName": 1, "date": -1});
sidoArpltnSchema.index({"sidocityName": 1, "date": 1});

sidoArpltnSchema.statics = {
    getKeyList: function () {
        return ['dataTime', 'sidoName', 'cityName', 'cityNameEng', 'so2Value', 'coValue', 'o3Value', 'no2Value',
            'pm10Value', 'pm25Value', 'khaiValue'];
    }
};

module.exports = mongoose.model('SidoArpltnKeco', sidoArpltnSchema);
