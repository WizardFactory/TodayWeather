/**
 * Created by aleckim on 2017. 6. 10..
 */

var mongoose = require("mongoose");
var kshwSchema2 = new mongoose.Schema({
    stnId: Number,
    stnName: String, //unique
    date: Date, //YYYY.MM.DD.HH.ZZ
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
    rs1h: Number, //it just rain, not for snow from KMA AWS, 도시별날씨의 일적설과,일강수가 다름.
    rs1d: Number, //it just rain, not for snow from KMA AWS
    rns: Boolean //rain,snow or not pty와 비슷하지만, on/off만 있음. property가 없으면, 동작하지 않거나, 정보 없음.
});

kshwSchema2.index({stnId: 1});
kshwSchema2.index({date: 1});

module.exports = mongoose.model('KmaStnHourly2', kshwSchema2);
