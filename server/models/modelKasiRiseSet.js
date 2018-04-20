/**
 * Created by aleckim on 2017. 7. 2..
 */

/**
 * longitude=126.98&latitude=37.5636
 * "aste": 214934,
 "astm": "031603",
 "civile": 202627,
 "civilm": "043906",
 "latitude": 3734,
 "latitudeNum": 37.5666667,
 "location": "�쒖슱",
 "locdate": 20170616,
 "longitude": 12659,
 "longitudeNum": 126.9833333,
 "moonrise": "------",
 "moonset": 110526,
 "moontransit": "052441",
 "naute": 210527,
 "nautm": "040007",
 "sunrise": "051016",
 "sunset": 195516,
 "suntransit": 123243
 * @type {*|SchemaAttributesListType|DataSchema|t.exports.operations.CreateUserPool.input.members.Schema|{shape}|t.exports.operations.GetMLModel.output.members.Schema}
 */

var mongoose = require('mongoose');

var kasiRiseSetSchema = new mongoose.Schema({
    locdate: Date,
    geo: {                  // 동네별 위치
        type: [Number],     // [<longitude(dmY)>, <latitude(dmX)>]
        index: '2d'         // create the geospatial index
    },
    location: String,
    sunrise: Date,
    suntransit: Date,
    sunset: Date,
    moonrise: Date,
    moontransit: Date,
    moonset: Date,
    civilm: Date,
    civile: Date,
    nautm: Date,
    naute: Date,
    astm: Date,
    aste: Date
});

kasiRiseSetSchema.statics = {
    getDataPropertyList: function () {
        return ['sunrise', 'suntransit', 'sunset', 'moonrise', 'moontransit', 'moonset', 'civilm', 'civile',
            'nautm', 'naute', 'astm', 'aste'];
    },
    getAreaList: function () {
        return ['강릉', '강화도', '거제', '거창', '경산', '경주', '고성(강원)', '고양', '고흥', '광양', '광주', '광주(경기)', '구미',
            '군산', '김천', '김해', '남원', '남해', '대관령', '대구', '대덕', '대전', '독도', '동해', '마산', '목포', '무안', '밀양',
            '변산', '보령', '보성', '보현산', '부산', '부안', '부천', '사천', '삼척', '상주', '서귀포', '서산', '서울', '서천',
            '성산일출봉', '세종', '소백산', '속초', '수원', '순천', '승주', '시흥', '아산', '안동', '안산', '안양', '양양', '양평',
            '여수', '여수공항', '여주','영광', '영덕', '영월', '영주', '영천', '완도', '용인', '울릉도', '울산', '울진', '원주',
            '의성', '익산', '인천', '임실', '장수', '장흥', '전주', '정읍', '제주', '제주(레)', '제천', '주문진', '진도', '진주',
            '진해', '창원', '천안', '청주', '청주공항', '추풍령', '춘양', '춘천', '충주', '태백', '태안', '통영', '파주', '평택',
            '포항', '해남', '화성', '흑산도'];
    }
};

kasiRiseSetSchema.index({location: 'text'}, { default_language: 'none' });
kasiRiseSetSchema.index({locdate: 1, location: 1, date: -1});

module.exports = mongoose.model('kasiRiseSet', kasiRiseSetSchema);
