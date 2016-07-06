/**
 * Created by aleckim on 2016. 4. 2..
 */

var mongoose = require("mongoose");
var ksiSchema = new mongoose.Schema({
    stnId: String,
    stnName: String, //unique
    addr: String,
    isCityWeather: Boolean,
    altitude: Number,
    geo: {
        type: [Number],     // [<longitude(dmY)>, <latitude(dmX)>]
        index: '2d'         // create the geospatial index
    },
    rnsHitRate: Number,
});

ksiSchema.index({stnName:'text'}, {default_language: 'none'});
ksiSchema.index({stnId: 1});
ksiSchema.index({isCityWeather:1});

module.exports = mongoose.model('KmaStnInfo', ksiSchema);

