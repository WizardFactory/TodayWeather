/**
 * Created by Peter on 2017. 10. 7..
 */
var mongoose = require("mongoose");

var townShortSchema = new mongoose.Schema({
    mCoord :{
        mx : Number,
        my : Number
    },
    pubDate : Date,
    fcsDate : Date, // forecast Date, 아래 날씨 데이터의 date, time와 동일한 date object 값.
    shortData : {
        date : String, //fcstDate
        time : String, //fcstTime
        mx : {type : Number, default : -1},
        my : {type : Number, default : -1},
        pop: {type : Number, default : -1},
        pty: {type : Number, default : -1},
        r06: {type : Number, default : -1},
        reh: {type : Number, default : -1},
        s06: {type : Number, default : -1},
        sky: {type : Number, default : -1},
        t3h: {type : Number, default : -50},
        tmn: {type : Number, default : -50},
        tmx: {type : Number, default : -50},
        uuu: {type : Number, default : -100},
        vvv: {type : Number, default : -100},
        wav: {type : Number, default : -1},
        vec: {type : Number, default : -1},
        wsd: {type : Number, default : -1}
    }
});

townShortSchema.index({fcsDate:1});
townShortSchema.index({"mCoord.mx" : 1, "mCoord.my" : 1, "fcsDate" : 1});
townShortSchema.index({"mCoord.mx" : 1, "mCoord.my" : 1, "pubDate" : 1});

module.exports = mongoose.model('kma.town.short', townShortSchema);
