/**
 * Created by aleckim on 2017. 6. 6..
 */

var mongoose = require("mongoose");
var ksmwSchema2 = new mongoose.Schema({
    stnId: Number,
    stnName: String, //unique
    date: Date, //YYYY.MM.DD.HH.ZZ is the same as pubDate
    weather: String,
    visibility: Number, //km
    cloud: Number, //1/10
    heavyCloud: Number,
    t1h: Number,
    dpt: Number,
    sensoryTem: Number, //체감온도
    dspls: Number, //불쾌지수
    r1d: Number,
    s1d: Number,
    reh: Number,
    wdd: String, //ESE, SW, ..
    vec: Number, //143.7
    wsd: Number,
    hPa: Number,
    rs1h: Number, //rain or snow or rain/snow from AWS
    rs1d: Number,
    rs15m: Number,
    rns: Boolean //rain,snow or not pty와 비슷하지만, on/off만 있음. property가 없으면, 동작하지 않거나, 정보 없음.
});

ksmwSchema2.index({stnId: 1});
ksmwSchema2.index({stnId: 1, date: -1});
ksmwSchema2.index({stnId: 1, date: 1});

module.exports = mongoose.model('KmaStnMinute2', ksmwSchema2);
