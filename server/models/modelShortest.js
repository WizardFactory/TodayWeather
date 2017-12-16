/**
 * Created by Peter on 2015. 11. 29..
 */

var mongoose = require('mongoose');

var shortestSchema = new mongoose.Schema({
    mCoord:{
        mx:Number,
        my:Number
    },
    pubDate : String, //YYYYMMDDHHMM baseDate+baseTime
    shortestData:[{
        date: String,   //fcstDate
        time: String,   //fcstTime
        mx: {type:Number, default:-1},
        my: {type:Number, default:-1},
        pty: {type:Number, default:-1},
        rn1: {type:Number, default:-1},
        sky: {type:Number, default:-1},
        lgt: {type:Number, default:-1},
        t1h: {type:Number, default:-50},
        reh: {type:Number, default:-1},
        uuu: {type:Number, default:-100},
        vvv: {type:Number, default:-100},
        vec: {type:Number, default:-1},
        wsd: {type:Number, default:-1}
    }]
});

shortestSchema.index({mCoord:1});
shortestSchema.index({"mCoord.mx" : 1, "mCoord.my" : 1});

module.exports = mongoose.model('shortest', shortestSchema);