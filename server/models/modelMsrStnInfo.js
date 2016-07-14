/**
 * Created by aleckim on 2016. 3. 26..
 */

var mongoose = require('mongoose');

/**
 *   GET: http://openapi.airkorea.or.kr/openapi/services/rest/MsrstnInfoInqireSvc/getMsrstnList?
 *          pageNo=1&numOfRows=999&ServiceKey=[SERVICE_KEY]&_returnType=json
    {
        "_returnType": "xml",
        "addr": "경남 창원시 의창구 두대동145번지 시설관리공단 내 실내수영장 앞(원이대로 480)",
        "districtNum": "",
        "dmX": "35.232222", 위도 latitude
        "dmY": "128.671389", 경도 longitude
        "item": "SO2, CO, O3, NO2, PM10",
        "mangName": "도로변대기",
        "map": "http://www.airkorea.or.kr/airkorea/station_map/238145.gif",
        "numOfRows": "10",
        "oper": "경상남도보건환경연구원",
        "pageNo": "1",
        "photo": "http://www.airkorea.or.kr/airkorea/station_photo/NAMIS/station_images/238145/INSIDE_OTHER_1.jpg",
        "resultCode": "",
        "resultMsg": "",
        "rnum": 0,
        "serviceKey": "",
        "sggName": "",
        "sidoName": "",
        "stationCode": "",
        "stationName": "반송로",
        "tm": 0,
        "tmX": "",
        "tmY": "",
        "totalCount": "",
        "umdName": "",
        "vrml": "",
        "year": "2008"
    }
 */
var msSchema = new mongoose.Schema({
    addr: String,
    stationName: String, //unique
    geo: {
        type: [Number],     // [<longitude(dmY)>, <latitude(dmX)>]
        index: '2d'         // create the geospatial index
    },
    item: [],
    mangName: String,
    map: String, //url
    oper: String,
    photo: String, //url
    year: String
});

msSchema.index({stationName: 'text'}, {default_language: 'none'});

module.exports = mongoose.model('MsrStnInfo', msSchema);
