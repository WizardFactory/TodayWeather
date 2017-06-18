/**
 *
 * Created by aleckim on 2017. 6. 18..
 */

var mongoose = require("mongoose");
var kmaSpecialWeatherSituationSchema = new mongoose.Schema({
    announcement: Date, //YYYY.MM.DD.HH.ZZ is the same as pubDate
    special : {
        imageUrl: String,
        situationList: [{
            weather: Number,
            weatherStr: String,
            level: Number,
            levelStr: String,
            location: String
        }],
        comment: String
    },
    preliminarySpecial : {
        imageUrl: String,
        situationList: [{
            weather: Number,
            weatherStr: String,
            level: Number,
            levelStr: String,
            location: String
        }],
        comment: String
    }
});

kmaSpecialWeatherSituationSchema.index({announcement: 1});

function parseSituationType (str) {
    var t;

    if (str.indexOf("강풍") != -1) {
        t = {weather: 1, weatherStr: "강풍"};
    }
    else if (str.indexOf("풍랑") != -1) {
        t = {weather: 2, weatherStr: "풍랑"};
    }
    else if (str.indexOf("호우") != -1) {
        t = {weather: 3, weatherStr: "호우"};
    }
    else if (str.indexOf("대설") != -1) {
        t = {weather: 4, weatherStr: "대설"};
    }
    else if (str.indexOf("건조") != -1) {
        t = {weather: 5, weatherStr: "건조"};
    }
    else if (str.indexOf("해일") != -1) {
        t = {weather: 6, weatherStr: "해일"};
    }
    else if (str.indexOf("폭풍해일") != -1) {
        t = {weather: 7, weatherStr: "폭풍해일"};
    }
    else if (str.indexOf("지진해일") != -1) {
        t = {weather: 8, weatherStr: "지진해일"};
    }
    else if (str.indexOf("한파") != -1) {
        t = {weather: 9, weatherStr: "한파"};
    }
    else if (str.indexOf("태풍") != -1) {
        t = {weather: 10, weatherStr: "태풍"};
    }
    else if (str.indexOf("황사") != -1) {
        t = {weather: 11, weatherStr: "황사"};
    }
    else if (str.indexOf("폭염") != -1) {
        t = {weather: 12, weatherStr: "폭염"};
    }
    else {
        t = {weather: 0, weatherStr: ""};
    }

    return t;
}

/**
 * type Strong Wind(강풍), Wind Wave(풍랑), Heavy Rain(호우), Heavy Snow(대설), Dry air(건조), Surge(해일), Storm surge(폭풍해일),
 * Earthquake surge(지진해일), Cold Wave(한파), Typhoon(태풍), Asian Dust(황사), Heat Wave(폭염)
 * level Advisory(주의보), Warning(경보)
 * @param strArray
 * @returns {Array}
 */
kmaSpecialWeatherSituationSchema.statics = {
    strArray2SituationList: function (strArray) {
        var situationList = [];
        strArray.forEach(function (str) {
            if (str.length == undefined || str.length == 0) {
                return;
            }

            var sArray = str.split(':');
            var tStr = sArray[0];
            var location  = sArray[1];

            var situation = {weather:0, weatherStr:"", level: 0, levelStr:"", location: location};
            if (tStr.indexOf('주의보') != -1) {
                situation.level = 1;
                situation.levelStr = '주의보';
            }
            else if (tStr.indexOf('경보') != -1) {
                situation.level = 2;
                situation.levelStr = '경보';
            }
            else if (tStr.indexOf('없음') != -1) {
                situation.level = 0;
                situation.levelStr = '';
                situation.weather = 0;
                situation.weatherStr = '없음';
            }
            else {
                log.error('Fail to parse situation str='+tStr);
                situation.level = -1;
                situation.levelStr = '';
                situation.weather = -1;
                situation.weatherStr = tStr;
            }

            if (situation.level > 0) {
                var situationType = parseSituationType(tStr);
                situation.weather = situationType.weather;
                situation.weatherStr = situationType.weatherStr;
            }

            situationList.push(situation);
        });

        return situationList;
    }
};

module.exports = mongoose.model('KmaSpecial', kmaSpecialWeatherSituationSchema);
