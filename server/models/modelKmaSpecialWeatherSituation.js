/**
 *
 * Created by aleckim on 2017. 6. 18..
 * 1 special(기상특보 현황), 2 preliminarySpecial(예비 기상특보 현황), 3 weatherInformation(기상정보)
 * Since #2609 the documents come from the data.go.kr WthrWrnInfoService (lib/kmaWarningCollector.js).
 */

var mongoose = require("mongoose");

/**
 * o 폭염주의보 : 서울
 *
 * (1) 호우 예비특보
 * o 06월 29일 저녁 : 제주도(제주도산지)
 * o 06월 29일 밤 : 제주도(제주도남부)
 * weatherFlash : 기상속보
 */
var kmaSpecialWeatherSituationSchema = new mongoose.Schema({
    announcement: Date, //YYYY.MM.DD.HH.ZZ is the same as pubDate
    type : Number, //1 special, 2 preliminarySpecial, 3 weatherInformation, 4 weatherFlash
    imageUrl: String,
    situationList: [{
        weather: Number,            //refer parseSituationType
        weatherStr: String,         //refer parseSituationType
        level: Number,              //refer strArray2SituationList
        levelStr: String,           //refer strArray2SituationList
        info: [{
            timeStr: String, //6월20일아침
            location: String //제주도(제주도산지)
        }]
    }],
    comment: String, //<, o, *, -, ※ 에서 줄변경해야 함 (<br> or \n)
    bulletin: {         //type 1 only: latest getWthrWrnMsg item (#2609)
        title: String,          //t1
        areas: String,          //t2
        effectiveTimes: String, //t3
        releaseOutlook: String  //t4
    }
});

kmaSpecialWeatherSituationSchema.index({announcement: 1});
kmaSpecialWeatherSituationSchema.index({type: 1});

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
    // 폭풍해일 and 지진해일 contain 해일, so they are tested first (#2609).
    else if (str.indexOf("폭풍해일") != -1) {
        t = {weather: 7, weatherStr: "폭풍해일"};
    }
    else if (str.indexOf("지진해일") != -1) {
        t = {weather: 8, weatherStr: "지진해일"};
    }
    else if (str.indexOf("해일") != -1) {
        t = {weather: 6, weatherStr: "해일"};
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
    else if (str.indexOf("열대야") != -1) {
        t = {weather: 13, weatherStr: "열대야"};
    }
    else {
        t = {weather: 0, weatherStr: ""};
    }

    return t;
}

/**
 * @param tStr 폭염주의보, 호우중대경보, 풍랑예비특보, 없음
 * @param info [{timeStr?, location}]
 * @returns {{weather, weatherStr, level, levelStr, info}}
 */
function makeSituation(tStr, info) {
    var situation = {weather:0, weatherStr:"", level: 0, levelStr:"", info: info};
    if (tStr.indexOf('주의보') != -1) {
        situation.level = 1;
        situation.levelStr = '주의보';
    }
    else if (tStr.indexOf('중대경보') != -1) {
        situation.level = 4;
        situation.levelStr = '중대경보';
    }
    else if (tStr.indexOf('경보') != -1) {
        situation.level = 2;
        situation.levelStr = '경보';
    }
    else if (tStr.indexOf('예비특보') != -1) {
        situation.level = 3;
        situation.levelStr = '예비특보';
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
    return situation;
}

/**
 * Bullet lines "o <name> : <areas>" (t6) or "o <time> : <areas>" (preliminary). "o 없 음" has no colon.
 * @param text
 * @returns {Array} [{head, body}]
 */
function splitBullets(text) {
    return String(text || '').replace(/\r/g, '').split(/(?:^|\s+)o\s+/).filter(function (part) {
        return part.trim().length > 0;
    }).map(function (part) {
        var index = part.indexOf(':');
        if (index < 0) {
            return {head: part.trim(), body: ''};
        }
        return {head: part.slice(0, index).trim(), body: part.slice(index+1).replace(/\s+/g, ' ').trim()};
    });
}

/**
 * type Strong Wind(강풍), Wind Wave(풍랑), Heavy Rain(호우), Heavy Snow(대설), Dry air(건조), Surge(해일), Storm surge(폭풍해일),
 * Earthquake surge(지진해일), Cold Wave(한파), Typhoon(태풍), Asian Dust(황사), Heat Wave(폭염)
 * level Advisory(주의보), Warning(경보), Preliminary(예비특보), Severe warning(중대경보)
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

            //폭염주의보:서울
            //풍량예비특보:0620일아침-제주도남쪽먼바다
            //호우예비특보:06월29일저녁-제주도(제주도산지):06월29일밤-제주도(제주도남부)
            var sArray = str.split(':');
            var tStr = sArray[0];

            var info = [];
            for (var i=1; i<sArray.length; i++) {
                //서울 or [06월29일저녁,제주도(제주도산지)]
                var infoArray = sArray[i].split('-');
                if (infoArray.length == 1) {
                    info.push({location: infoArray[0]});
                }
                else if (infoArray.length == 2) {
                    info.push({timeStr:infoArray[0], location: infoArray[1]});
                }
            }

            var situation = makeSituation(tStr, info);
            situationList.push(situation);
        });

        return situationList;
    },
    /**
     * WthrWrnInfoService t6 (getPwnStatus/getWthrWrnMsg): "o 호우경보 : 제주도(제주도산지, 제주시중산간)\r\no ..."
     * @param text
     * @returns {Array} situationList
     */
    parseSpecialText: function (text) {
        return splitBullets(text).map(function (bullet) {
            var name = bullet.head.replace(/\s+/g, '');
            return makeSituation(name, bullet.body ? [{location: bullet.body}] : []);
        });
    },
    /**
     * WthrWrnInfoService pwn (getWthrPwn) or t7: "(1) 풍랑 예비특보\r\no 06월 07일 아침 : 동해중부앞바다\r\n(2) ..."
     * @param text
     * @returns {Array} situationList
     */
    parsePreliminaryText: function (text) {
        var blocks = String(text || '').replace(/\r/g, '').split(/\(\d+\)/).filter(function (block) {
            return block.trim().length > 0;
        });
        var list = [];
        blocks.forEach(function (block) {
            var bullets = splitBullets(block);
            if (/^o\s/.test(block.trim())) {
                // No numbered heading, e.g. "o 없음"
                bullets.forEach(function (bullet) {
                    list.push(makeSituation(bullet.head.replace(/\s+/g, ''), []));
                });
                return;
            }
            var info = bullets.slice(1).map(function (bullet) {
                return {timeStr: bullet.head.replace(/\s+/g, ' '), location: bullet.body};
            });
            list.push(makeSituation(bullets[0].head.replace(/\s+/g, ''), info));
        });
        return list;
    },
    type2str: function (type) {
        switch (type) {
            case 1:
                return 'special';
            case 2:
                return 'preliminarySpecial';
            case 3:
                return 'weatherInformation';
            case 4:
                return 'weatherFlash';
            default:
                return '';
        }
    },
    TYPE_SPECIAL: 1,
    TYPE_PRELIMINARY_SPECIAL: 2,
    TYPE_WEATHER_INFORMATION: 3,
    TYPE_WEATHER_FLASH: 4
};

module.exports = mongoose.model('KmaSpecial', kmaSpecialWeatherSituationSchema);
