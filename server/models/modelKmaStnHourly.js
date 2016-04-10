/**
 * AWS and CityWeather의 시간별 날씨 정보
 * Created by aleckim on 2016. 4. 2..
 */


var mongoose = require("mongoose");
var kshwSchema = new mongoose.Schema({
    stnId: String,
    stnName: String, //unique
    pubDate: String, //YYYY.MM.DD.HH.ZZ
    hourlyData: [{
        date: String, //YYYY.MM.DD.HH.ZZ
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
        rns: Boolean, //rain,snow or not pty와 비슷하지만, on/off만 있음. property가 없으면, 동작하지 않거나, 정보 없음.
    }]
});

kshwSchema.index({stnId:1});

module.exports = mongoose.model('KmaStnHourly', kshwSchema);
