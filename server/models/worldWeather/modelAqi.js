/**
 * Created by Peter on 2017. 6. 3..
 */

var mongoose = require("mongoose");

/*
 pm25: "PM<sub>2.5</sub>",
 pm10: "PM<sub>10</sub>",
 o3: "Ozone",
 no2: "Nitrogen Dioxide",
 so2: "Sulphur Dioxide",
 co: "Carbon Monoxyde",
 t: "Temperature",
 w: "Wind",
 r: "Rain (precipitation)",
 h: "Relative Humidity",
 d: "Dew",
 p: "Atmostpheric Pressure"
 */
var aqiSchema = new mongoose.Schema({
    geo: {
        type: [Number],     // [<longitude(dmY)>, <latitude(dmX)>]
        index: '2d'         // create the geospatial index
    },
    address: {country:String, city:String, zipcode:Number, postcode:Number},
    date:    {type: Number, default: 0},   // GMT time YYYYMMDDHHMM
    dateObj: {type: Object, default: Date},// UTC time
    timeOffset: {type: Number, default: 0},

    aqi: Number,
    idx: Number,
    co: Number,
    h: Number,
    no2: Number,
    o3: Number,
    p: Number,
    pm10: Number,
    pm25: Number,
    so2: Number,
    t: Number,
    mTime: String,      // measuring time
    mCity: String       // measuring city
});

aqiSchema.index({"geocode.lat" : 1, "geocode.lon" : 1});
aqiSchema.index({aqi: 1});
aqiSchema.index({idx:1});



module.exports = mongoose.model('aqi', aqiSchema);
