/**
 * Created by aleckim on 2016. 4. 2..
 */

var mongoose = require("mongoose");
var ksdwSchema = new mongoose.Schema({
    stnId: String,
    stnName: String, //unique
    pubDate: String,
    dailyData: [{
        wdmx: Number,           //최대순간풍향
        wdmxStr: String,        //시각
        wsmx: Number,           //최대순간풍속
        wsmxTime: String,
        tmn: Number,            //최저온도
        tmnTime: String,
        tmx: Number,            //최고온도
        tmnTime: String,
        rs1d: Number,           //일 강우량 (눈,비)
        rs1dTime: String,       //??
        rmn: Number,            //최저습도
        rmnTime: String,
        rmx: Number,            //최고습도
        rmxTime: String,
        pmn: Number,            //최저기압
        pmnTime: String,
        pmx: Number,            //최고기압
        pmxTime: String
    }]
});

ksdwSchema.index({stnId: 'text'});

module.exports = mongoose.model('KmaStnDaily', ksdwSchema);
