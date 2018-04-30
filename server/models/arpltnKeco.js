/**
 * Created by aleckim on 2015. 10. 24..
 */

'use strict';

var mongoose = require('mongoose');

var aSchema = new mongoose.Schema({
    date: Date,
    stationName: String,    //unique 측정소 이름
    mangName: String,       //측정망 정보 (국가배경, 교외대기, 도시대기, 도로변대기)
    dataTime: String,       //오염도 측정 연-월-일 시간 : 분
    so2Value: Number,       //아황산가스 농도(단위 : ppm)
    coValue: Number,        //일산화탄소 농도(단위 : ppm)
    o3Value: Number,        //오존 농도(단위 : ppm)
    no2Value: Number,       //이산화질소 농도(단위 : ppm)
    pm10Value: Number,      //미세먼지(PM10) 농도 (단위 : ㎍/㎥)
    pm10Value24: Number,    //미세먼지(PM10)24시간예측이동농도(단위 : ㎍/㎥)
    pm25Value: Number,      //미세먼지(PM2.5) 농도(단위 : ㎍/㎥)
    pm25Value24: Number,    //미세먼지(PM2.5) 24시간예측이동농도(단위 : ㎍/㎥)
    khaiValue: Number,      //통합대기환경수치
    khaiGrade: Number,      //통합대기환경지수
    so2Grade: Number,       //아황산가스 지수
    coGrade: Number,        //일산화탄소 지수
    o3Grade: Number,        //오존 지수
    no2Grade: Number,       //이산화질소 지수
    pm10Grade: Number,      //미세먼지(PM10) 1시간 등급자료 from pm10Grade1h
    pm25Grade: Number,      //미세먼지(PM2.5) 1시간 등급자료 from pm25Grade1h
    pm10Grade24: Number,    //미세먼지(PM10) 24시간 등급자료 from pm10Grade
    pm25Grade24: Number     //미세먼지(PM2.5) 24시간 등급자료 from pm25Grade
});

aSchema.index({stationName: 'text'}, { default_language: 'none' });
aSchema.index({stationName: 1, date: -1});
aSchema.index({stationName: 1, date: 1});
aSchema.index({dataTime: -1});

aSchema.statics = {
    getKeyList: function () {
        return ['stationName', 'mangName', 'dataTime', 'so2Value', 'coValue', 'o3Value', 'no2Value', 'pm10Value',
            'pm10Value24', 'pm25Value', 'pm25Value24', 'khaiValue', 'khaiGrade', 'so2Grade', 'coGrade', 'o3Grade',
            'no2Grade', 'pm10Grade', 'pm25Grade', 'pm10Grade1h', 'pm25Grade1h'];

    }
};

module.exports = mongoose.model('ArpltnKeco', aSchema);
