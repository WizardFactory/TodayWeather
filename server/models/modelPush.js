/**
 * Created by aleckim on 2016. 5. 2..
 */

var mongoose = require("mongoose");

var pushSchema = new mongoose.Schema({
    type: String, //ios, android, windows, amazon ..
    registrationId: String,
    cityIndex: Number, //index of city in client
    id: Number,         //이미 등록된 요청은 id가 없음 18.2.14, city안의 id임
    pushTime: Number, //UTChours*60*60 + UTCMinutes*60
    enable: {type: Boolean, default: true},        //이미 등록된 요청은 없음, 도시가 유지된 채, 알람만 제거하면 false가 됨.
    town: {first: String, second: String, third: String},
    geo: {
        type: [Number],     // [<longitude(dmY)>, <latitude(dmX)>]
        index: '2d'         // create the geospatial index
    },
    lang: String,       //ko, ja, zh-CN, zh-TW, ...
    name: String,       //name of location
    source: String,     //KMA, DSF
    units: {
        temperatureUnit: String, //C, F
        windSpeedUnit: String,  //m/s mph ..
        pressureUnit: String,   //hPa, mbar, ..
        distanceUnit: String,   //km, miles
        precipitationUnit: String, //mm, inches
        airUnit: String, //airkorea, airkorea_who, airnow, aqicn
        airForecastSource: String //airkorea, kaq, aqicn, ...
    },
    updatedAt: Date,
    timezoneOffset: Number, //mins +9h -> +540
    dayOfWeek: [Boolean], // Sunday - Saturday : 0 - 6 [false, true, true, true, true, true, false]
});

pushSchema.index({alarmTime:1});
pushSchema.index({cityIndex:1});
pushSchema.index({registrationId: "hashed"});

module.exports = mongoose.model('push', pushSchema);
