/**
 * Created by aleckim on 2016. 5. 2..
 */

var mongoose = require("mongoose");

var pushSchema = new mongoose.Schema({
    registrationId: String,
    pushTime: Number, //UTChours*60*60 + UTCMinutes*60
    cityIndex: Number, //index of city in client
    type: String, //ios, android, windows, amazon ..
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
        airUnit: String //airkorea, airkorea_who, airnow, aqicn
    }
});

pushSchema.index({alarmTime:1});
pushSchema.index({cityIndex:1});
pushSchema.index({registrationId: 'text'}, { default_language: 'none' });

module.exports = mongoose.model('push', pushSchema);
