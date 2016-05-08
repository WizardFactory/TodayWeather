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
    }
});

pushSchema.index({alarmTime:1});
pushSchema.index({cityIndex:1});
pushSchema.index({registrationId: 'text'}, { default_language: 'none' });

module.exports = mongoose.model('push', pushSchema);
