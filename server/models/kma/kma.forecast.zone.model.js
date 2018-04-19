/**
 * Created by aleckim on 2018. 4. 4..
 */

"use strict";

var mongoose = require('mongoose');

var kmaForecastZoneCodeSchema = new mongoose.Schema({
    regId: String,      //예보구역코드 11A00101
    tmEd: String,       //종료시각 210012310900
    tmSt: String,       //시작시각 201004300900
    regName: String,    //예보구역명(한글) 백령도
    regEn: String,      //예보구역명(영문) Baengnyeongdo
    regSp: String,      //지역특성 A% : 육상광역, B% : 육상국지, C% : 도시, D% : 산악, E% : 고속도로, H% : 해상광역, I% : 해상국지, J% : 연안바다, K% : 해수욕장, L% : 연안항로, M% : 먼항로
    regUp: String,      //상위구역코드
    ht: Number,         //해발고도(m)
    stnWn: String,      //특보발표관서
    stnF3: String,      //3시간예보관서
    stnFd: String,      //단기예보관서
    stnFw: String,      //주간예보관서
    seq: Number,         //순번
    geo: {
        type: [Number],     // [<longitude(dmY)>, <latitude(dmX)>]
        index: '2d'         // create the geospatial index
    }
});

kmaForecastZoneCodeSchema.index({regId: "hashed"});
kmaForecastZoneCodeSchema.index({regName: "hashed"});

module.exports = mongoose.model('KmaForecastZoneCode', kmaForecastZoneCodeSchema);
