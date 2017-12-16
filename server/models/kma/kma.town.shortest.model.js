/**
 * Created by Peter on 2017. 10. 9..
 */

var mongoose = require('mongoose');

var townShortestSchema = new mongoose.Schema({
    mCoord:{
        mx:Number,
        my:Number
    },
    pubDate : Date,
    fcsDate : Date, // forecast Date, 아래 날씨 데이터의 date, time와 동일한 date object 값.
    shortestData:{
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
    }
});

townShortestSchema.index({mCoord:1});
townShortestSchema.index({"mCoord.mx" : 1, "mCoord.my" : 1});

module.exports = mongoose.model('kma.town.shortest', townShortestSchema);