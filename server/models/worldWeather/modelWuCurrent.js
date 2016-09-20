/**
 * Created by Peter on 2016. 6. 11..
 */

var mongoose = require("mongoose");

var wuCurrentSchema = new mongoose.Schema({
    geocode: {lat: Number, lon: Number},
    address: {country:String, city:String, zipcode:Number, postcode:Number},
    date: Number,                                       // GMT time YYYYMMDDHHMM
    dateObj: {type: Object, default: Date},             // UTC time
    dataList:[{
        dateObj:    {type: Object, default: Date},      // UTC time
        date:       {type:Number, default:-100},        // YYYYMMDDHHMM
        desc:       {type:String, default:''},
        code:       {type:Number, default:-100},
        temp:       {type:Number, default:-100},
        ftemp:      {type:Number, default:-100},        // 체감온도
        humid:      {type:Number, default:-100},        // 습도
        windspd:    {type:Number, default:-100},        // meters per second, 풍속
        winddir:    {type:Number, default:-100},        // degree, 풍향
        cloud:      {type:Number, default:-100},        // percent, 구름량
        vis:        {type:Number, default:-100},        // kilometers, 가시거리
        slp:        {type:Number, default:-100},        // millibars, 기압
        dewpoint:   {type:Number, default:-100}         // celcius, 이슬점
    }]
});

wuCurrentSchema.index({"geocode.lat" : 1, "geocode.lon" : 1});

module.exports = mongoose.model('wuCurrent', wuCurrentSchema);
