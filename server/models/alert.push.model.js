/**
 * Created by aleckim on 2018. 2. 7..
 * client 업데이트를 용이하기 위해서 Schema를 두개로 쪼갤까도 생각했지만, remove시에 같이 지워지게 고려가 필요해 그냥 하나로 함.
 */

var mongoose = require("mongoose");

var alertPushSchema = new mongoose.Schema({
    type: String, //ios, android, windows, amazon ..
    registrationId: String,
    fcmToken: String,
    cityIndex: Number, //index of city in client
    id: Number,                 //city안의 id임
    startTime: Number,          //UTChours*60*60 + UTCMinutes*60
    endTime: Number,            //UTChours*60*60 + UTCMinutes*60
    reverseTime: {type: Boolean, default: false}, //true when startTime > endTime
    enable: {type: Boolean, default: true},
    town: {first: String, second: String, third: String},
    geo: {
        type: [Number],     // [<longitude(dmY)>, <latitude(dmX)>]
        index: '2d'         // create the geospatial index
    },
    lang: String,       //ko, ja, zh-CN, zh-TW, ...
    name: String,       //name of location
    source: String,     //KMA, DSF
    units: {
        temperatureUnit: String, //C, F
        windSpeedUnit: String,  //m/s mph ..
        pressureUnit: String,   //hPa, mbar, ..
        distanceUnit: String,   //km, miles
        precipitationUnit: String, //mm, inches
        airUnit: String, //airkorea, airkorea_who, airnow, aqicn,
        airForecastSource: String //airkorea, kaq, aqicn, ...
    },
    package: String, //todayWeather, todayAir
    uuid: String,
    appVersion: String,
    updatedAt: Date,
    timezoneOffset: Number, //mins +9h -> +540 for filtering day of week
    dayOfWeek: [Boolean], // Sunday - Saturday : 0 - 6 [false, true, true, true, true, true, false]
    airAlertsBreakPoint: Number, //사용자 설정한 기준값 민감군주의, 나쁨, 매우나쁨,...기본 나쁨
    precipAlerts: {
        lastState: Number, //start time에 갱신, 폴링시 체크때마다 갱신
        pushTime: Date
    },
    airAlerts: {           //aqi, pm10, pm2.5 모두 같이 사용
        lastGrade: Number, //grade
        lastCode: String, //aqi, pm10, pm25
        pushTime: Date
    }
});

alertPushSchema.index({startTime:1});
alertPushSchema.index({endTime:1});
alertPushSchema.index({cityIndex:1});
alertPushSchema.index({registrationId: "hashed"});

module.exports = mongoose.model('AlertPush', alertPushSchema);
