/**
 * Created by aleckim on 2016. 4. 4..
 * code 상태가 엉망임.
 */

'use strict';

var async = require('async');

var KmaStnDaily = require('../models/modelKmaStnDaily');
var KmaStnHourly = require('../models/modelKmaStnHourly');
var KmaStnHourly2 = require('../models/modelKmaStnHourly2');
var KmaStnMinute = require('../models/modelKmaStnMinute');
var KmaStnMinute2 = require('../models/modelKmaStnMinute2');
var KmaStnInfo = require('../models/modelKmaStnInfo');
var kmaTimeLib = require('../lib/kmaTimeLib');
var ControllerWeatherDesc = require('./controller.weather.desc');

function controllerKmaStnWeather() {

}

controllerKmaStnWeather.updateWeather = function (current) {
    if (current.pty >= 1) {
        if (current.weatherType == undefined) {
            log.warn('weather type is undefined so set by pty');
            current.weatherType = 0;
        }

        switch (current.weatherType) {
           case 0:
           case 1:
           case 2:
           case 3:
           case 4:
           case 5:
           case 6:
           case 7:
           case 8:
           case 9:
           case 10:
           case 11:
           case 12:
               if (current.pty == 1) {
                   current.weather = '비';
                   current.weatherType = 65;
               }
               else if (current.pty == 2) {
                   current.weather = '진눈깨비';
                   current.weatherType = 64;
               }
               else if (current.pty == 3) {
                   current.weather = '눈';
                   current.weatherType = 66;
               }
               break;
           case 17:
               current.weatherType = 15;
               current.weather = '보통이슬비';
               break;
           case 27:
               current.weatherType = 24;
               current.weather = '약한소나기';
               break;
           case 28:
               current.weatherType = 20;
               current.weather = '보통비단속';
               break;
           case 31:
               current.weatherType = 64;
               current.weather = '진눈깨비';
               break;
           case 40:
               current.weatherType = 38;
               current.weather = '소낙눈/약';
               break;
           case 41:
               current.weatherType = 66;
               current.weather = '눈';
               break;
           case 56:
               current.weatherType = 55;
               current.weather = '번개';
               break;
           default:
               break;

       }
    }
    else if (current.pty === 0) {
        if (current.weatherType == undefined) {
            switch (current.sky) {
                case 0:
                case 1:
                    current.weather = '맑음';
                    current.weatherType = 0;
                    break;
                case 2:
                    current.weather = '구름조금';
                    current.weatherType = 1;
                    break;
                case 3:
                    current.weather = '구름많음';
                    current.weatherType = 2;
                    break;
                case 4:
                    current.weather = '흐림';
                    current.weatherType = 3;
                    break;
                default:
                    log.error('unknown sky:', current.sky);
                    break;
            }
        }
        switch (current.weatherType) {
            //비/눈/진눈깨비는 변경
            case 14:
            case 15:
            case 16:
            case 18:
            case 19:
            case 20:
            case 21:
            case 22:
            case 23:
            case 24:
            case 25:
            case 26:
            case 29:
            case 30:
            case 31:
            case 32:
            case 33:
            case 34:
            case 35:
            case 36:
            case 37:
            case 38:
            case 39:
            case 42:
            case 43:
            case 44:
            case 45:
            case 46:
            case 47:
            case 49:
            case 53:
            case 54:
            case 58:
            case 64:
            case 65:
            case 66:
                //맑음,구름조금,구름많음, 흐름
                switch (current.sky) {
                    case 1:
                       current.weather = "맑음";
                       current.weatherType = 0;
                       break;
                    case 2:
                        current.weather = "구름조금";
                        current.weatherType = 1;
                        break;
                    case 3:
                        current.weather = "구름많음";
                        current.weatherType = 2;
                        break;
                    case 4:
                        current.weather = "흐름";
                        current.weatherType = 3;
                        break;
                    default:
                        current.weather = "";
                        current.weatherType = -1;
                        break;
                }
                break;
            case 50:
            case 51:
            case 52:
                current.weather = '번개';
                current.weatherType = 55;
                break;
        }
        // icon 준비되면 적용
        // switch (current.weatherType) {
        //     case 4:
        //     case 5:
        //     case 6:
        //     case 7:
        //     case 8:
        //     case 10:
        //     case 11:
        //     case 12:
        //         current.pty = 4; //안개,황사
        //         break;
        // }
    }

    if (current.lgt) {
        //번개문구 추가는 skip
    }
};

/**
 * weather, r1d, s1d는 발생시에만 있고, sensoryTem과 dspls는 둘중 하나만 있음
 * 도시별날씨의 경우 바로 적용.
 * 매분 가지고 오는 경우에 강수(rns)도 산이랑 구분하는 게 맞는건지 잘 모르겠음.
 * @param stnWeatherList
 * @param t1h
 * @returns {*}
 * @private
 */
controllerKmaStnWeather._mergeStnWeatherList = function (stnWeatherList, opt) {
    var propertyName = ['stnId', 'stnName', 'weather', 'visibility', 'cloud', 'heavyCloud', 't1h', 'dpt', 'sensoryTem', 'dspls',
                        'r1d', 's1d', 'reh', 'wdd', 'vec', 'wsd', 'hPa', 'rs1h', 'rs1d', 'rns'];
    var propertyCount = 0;
    var mergedStnWeatherInfo;
    var self = this;

    for (var j=0; j<stnWeatherList.length; j++) {
        var stnWeatherInfo = stnWeatherList[j];
        if (stnWeatherInfo.isT1hStn && mergedStnWeatherInfo) {
            //clear t1h, dpt, sensoryTem, dspls in mergedStnWeatherInfo
            mergedStnWeatherInfo.t1h = undefined;
            mergedStnWeatherInfo.dpt = undefined;
            mergedStnWeatherInfo.sensoryTem = undefined;
            mergedStnWeatherInfo.dspls = undefined;
        }
        if (stnWeatherInfo.isRainStn && mergedStnWeatherInfo) {
            //clear r1d, s1d, rs1h, rs1d, rns in mergedStnWeatherInfo
            mergedStnWeatherInfo.r1d = undefined;
            mergedStnWeatherInfo.s1d = undefined;
            mergedStnWeatherInfo.rs1h = undefined;
            mergedStnWeatherInfo.rs1d = undefined;
            mergedStnWeatherInfo.rns = undefined;
        }

        for (var i=2; i<propertyName.length; i++) {
            if (!(opt == undefined)) {
                if (opt.skipReh) {
                    if (propertyName[i] == 'reh') {
                        continue;
                    }
                }
                if (opt.skipWsd) {
                    if (propertyName[i] == 'wsd' || propertyName[i] == 'wdd' || propertyName[i] == 'vec' ) {
                        continue;
                    }
                }
                if (opt.skipTemp) {
                    if (propertyName[i] == 't1h' || propertyName[i] == 'dpt' || propertyName[i] == 'sensoryTem' || propertyName[i] == 'dspls') {
                        continue;
                    }
                }
                if (opt.skipRain) {
                    if (propertyName[i] == 'rns' || propertyName[i] == 'r1d' || propertyName[i] == 's1d' || propertyName[i] == 'rs1h' || propertyName[i] == 'rs1d') {
                        continue;
                    }
                }
            }

            if (stnWeatherInfo[propertyName[i]] != undefined) {
                if (mergedStnWeatherInfo && mergedStnWeatherInfo[propertyName[i]] != undefined) {
                    log.silly('it already has property, skip property=', propertyName[i]);
                    continue;
                }
                if (mergedStnWeatherInfo == undefined) {
                    mergedStnWeatherInfo = {stnId: stnWeatherInfo.stnId, stnName: stnWeatherInfo.stnName};
                    propertyCount = 2;
                }
                mergedStnWeatherInfo[propertyName[i]] = stnWeatherInfo[propertyName[i]];
                if (propertyName[i] == 'weather') {
                    mergedStnWeatherInfo[propertyName[i]+'Type'] = ControllerWeatherDesc.makeWeatherType(mergedStnWeatherInfo[propertyName[i]]);
                }
                if (mergedStnWeatherInfo.stnId != stnWeatherInfo.stnId) {
                    mergedStnWeatherInfo[propertyName[i]+'Stn'] = stnWeatherInfo.stnName;
                }
                propertyCount++;
                if (propertyName.length == propertyCount) {
                    return mergedStnWeatherInfo;
                }
            }
        }
    }

    if (mergedStnWeatherInfo == undefined) {
        log.error('Fail to make stnWeather info');
        return;
    }
    log.verbose('get data of stn weather info count=', propertyCount);
    return mergedStnWeatherInfo;
};

/**
 * DB에 string을 그래도 time으로 변환해서 저장하기 때문에, 시간에 대한 고려를 잘 해야 함.
 * 원칙대로는 GMT 기준으로 DB에 저장하고, code에서 쿼리할때도 GMT 기준으로 변환해야 함. (해외인경우 한국시간과 해외시간오차 계산해야 함)
 * @param stnInfo
 * @param dateTime
 * @param callback
 * @private
 */
controllerKmaStnWeather._getStnMinute2 = function (stnInfo, dateTime, callback) {
    //20min - data자체가 3분정도 딜레이가 있음.
    var limitTime = new Date(dateTime);
    limitTime.setMinutes(limitTime.getMinutes()-20);

    KmaStnMinute2.find({stnId: parseInt(stnInfo.stnId), date: {$gt:limitTime}}, {_id: 0}).sort({date: 1}).lean().exec(function (err, stnWeatherList) {
        if (err) {
            return callback(err);
        }
        if (stnWeatherList.length == 0) {
            err = new Error('Fail to find stn Weather info of stnId='+ stnInfo.stnId);
            return callback(err);
        }

        var rns = false;
        stnWeatherList.forEach(function (weather) {
            if (weather.rns == true) {
                rns = true;
            }
        });

        //todo: check sort
        var minuteData = stnWeatherList[stnWeatherList.length-1];
        for (var key in minuteData) {
            if (key == 'date') {
                stnInfo[key] = kmaTimeLib.convertDateToYYYYoMMoDDoHHoMM(minuteData[key]);
            }
            else {
                stnInfo[key] = minuteData[key];
            }
        }

        if (rns == true) {
            stnInfo.rns = rns;
        }

        callback(err, stnInfo);
    });
};

/**
 *
 * @param stnInfo
 * @param dateTime
 * @param callback
 * @private
 */
controllerKmaStnWeather._getStnMinute = function (stnInfo, dateTime, callback) {
    KmaStnMinute.find({stnId: stnInfo.stnId}, {_id: 0}).lean().exec(function (err, stnWeatherList) {
        if (err) {
            return callback(err);
        }
        if (stnWeatherList.length == 0) {
            err = new Error('Fail to find stn Weather info of stnId=', stnInfo.stnId);
            return callback(err);
        }

        if (!stnWeatherList[0].pubDate) {
            err = new Error('It does not have any data stnId=', stnInfo.stnId);
            return callback(err);
        }

        if (stnWeatherList.length > 1) {
            log.error('stn weather info is duplicated stnId=', stnInfo.stnId);
        }

        //20min - data자체가 3분정도 딜레이가 있음.
        var limitTime = (new Date(dateTime)).getTime()-1200000;

        //log.info(dateTime);
        //log.info(stnWeatherList[0].pubDate);
        if ((new Date(stnWeatherList[0].pubDate)).getTime() < limitTime) {
            log.warn('It(Minute) was not updated yet pubDate=',stnWeatherList[0].pubDate,' stnId=',stnInfo.stnId,' stnName=', stnInfo.stnName);
            return callback();
        }

        var minuteList = stnWeatherList[0].minuteData.filter(function (data) {
            if ((new Date(data.date)).getTime() > limitTime) {
                return true;
            }
            return false;
        });

        var minuteData = minuteList[minuteList.length-1];
        if (minuteData == undefined) {
            /**
             * 몇몇 STN은 hourly 데이터만 제공하는 경우도 있음.
             */
            log.warn('It(Minute) does not have data pubDate=', dateTime, ' stnName=', stnInfo.stnName);
            return callback();
        }

        //if (self._checkRnsWork(stnInfo.stnId) != true) {
        var rnsHitRate = stnInfo.rnsHit/stnInfo.rnsCount;

        if (rnsHitRate < 0.5) {
            //log.warn("rns is not working stnId="+stnInfo.stnId+" stnName="+
            //            stnInfo.stnName+" rns hit ratio="+rnsHitRate);
            minuteData.rns = undefined;
        }

        //log.info("minuteList length="+minuteList.length);
        if (minuteData.rns != undefined && minuteList.length >= 5) {
            //limtTime안에 rain이 하나라도 true이면 rain임.
            for (var i=0; i < minuteList.length; i++) {
                if (minuteList[i].rns) {
                    minuteData.rns = true;
                    break;
                }
            }
            if (i === minuteList.length) {
                minuteData.rns = false;
            }
        }

        for (var key in minuteData) {
            stnInfo[key] = minuteData[key];
        }
        callback(err, stnInfo);
        //var stnWeatherInfo = JSON.parse(JSON.stringify(minuteData));
        //stnWeatherInfo.stnId = stnInfo.stnId;
        //stnWeatherInfo.stnName = stnInfo.stnName;
        //stnWeatherInfo.isCityWeather =  stnInfo.isCityWeather?true:false;
        //
        //mCallback(err, stnWeatherInfo);
    });

};

controllerKmaStnWeather._findRainStnMinuteList = function (stnList, stnWeatherList) {
    var rainStnList = [];
    var date;
    for (var i=0; i<stnWeatherList.length; i++) {
        var minWeather = stnWeatherList[i];
        if (rainStnList.length === 0) {
            date = minWeather.date;
        }
        if ((minWeather.rs15m > 0 && minWeather.date === date)
            || minWeather.rns === true)
        {
            var obj = rainStnList.find(function (obj) {
                return obj.stnId === minWeather.stnId
            });
            if (!obj) {
                rainStnList.push(minWeather);
            }
        }

        if (rainStnList.length >= 2) {
            break;
        }
    }

    if (rainStnList.length < 2) {
        return;
    }

    var stnWeather;
    //find nearest stn
    for (i=0; i<stnList.length; i++) {
        stnWeather = rainStnList.find(function (obj) {
            return obj.stnId == stnList[i].stnId;
        });
        if (stnWeather) {
            break;
        }
    }

    stnWeather.date = kmaTimeLib.convertDateToYYYYoMMoDDoHHoMM(stnWeather.date);

    return stnWeather;
};

/**
 * 15min내에 n개의 stn에서 비가 왔는지 확인(가장 최근에 측정된 시간에 rs15m이 0보다 크던가, rns가 true인경우)
 * n개의 stn중에서 2개 이상이면 가장 가까운 측정소 정보를 반환
 * @param stnList
 * @param dateTime
 * @param callback
 * @returns {controllerKmaStnWeather}
 * @private
 */
controllerKmaStnWeather._checkPrecipFromStnMinuteList = function (stnList, dateTime, callback) {
    var self = this;

    if (!Array.isArray(stnList)) {
        callback(new Error("mstStnList is not array"));
        return this;
    }

    //15min - data자체가 3분정도 딜레이가 있음.
    var limitTime = new Date(dateTime);
    limitTime.setMinutes(limitTime.getMinutes() - 15);

    var query;
    var array = [];
    stnList.forEach(function (stnInfo) {
        // var q = {stnId: parseInt(stnInfo.stnId), date: {$gt: limitTime}, $or: [{rns: true}, {rs15m:{$gt:0}}]};
        // var q = {stnId: parseInt(stnInfo.stnId), date: {$gt: limitTime}, rns:true};
        var q = {stnId: parseInt(stnInfo.stnId), date: {$gt: limitTime}};
        array.push(q);
    });
    query = {$or: array};

    KmaStnMinute2.find(query, {_id: 0}).sort({date: -1}).lean().exec(function (err, stnWeatherList) {
        if (err) {
            return callback(err);
        }

        if (stnWeatherList.length == 0) {
            return callback(undefined, undefined);
        }

        var stnWeather;
        try {
            stnWeather = self._findRainStnMinuteList(stnList, stnWeatherList);
        }
        catch (err) {
            return callback(err);
        }
        return callback(undefined, stnWeather);
    });
};

/**
 *
 * @param stnList
 * @param {String} dateTime
 * @param callback
 * @returns {controllerKmaStnWeather}
 * @private
 */
controllerKmaStnWeather._getStnMinuteList = function (stnList, dateTime, callback) {
    var self = this;

    if (!Array.isArray(stnList)) {
        callback(new Error("mstStnList is not array"));
        return this;
    }

    async.mapSeries(stnList,
        function (stnInfo, mCallback) {
            self._getStnMinute2(stnInfo, dateTime, function (err, stnInfo) {
                if (err) {
                    return mCallback(err);
                }
                mCallback(err, stnInfo);
            });
        },
        function (err, results) {
            if (err) {
                return callback(err);
            }
            results = results.filter(function (data) {
                return !!data;
            });
            callback(err, results);
        }
    );
};

/**
 *
 * @param stnId
 * @param fromDate
 * @param callback
 */
controllerKmaStnWeather.findHourlies = function (stnId, fromDate, callback) {
    KmaStnHourly.find({stnId: stnId}).lean().exec(function (err, stnWeatherList) {
        if (err) {
            return callback(err);
        }
        if (stnWeatherList == undefined || stnWeatherList.length == 0) {
            err = new Error('Fail to find stn Weather info of stnId=', stnId);
            return callback(err);
        }
        if (!stnWeatherList[0].pubDate) {
            err = new Error('It does not have any data stnId=', stnId);
            return callback(err);
        }
        if ((new Date(stnWeatherList[0].pubDate)).getTime() < fromDate.getTime()) {
            err = new Error('It was not updated yet pubDate=',stnWeatherList[0].pubDate,' stnId=', stnId);
            return callback(err);
        }

        if (stnWeatherList.length > 1) {
            log.error('stn weather info is duplicated stnId=', stnId);
        }

        return callback(err, stnWeatherList);
    });
};

/**
 *
 * @param stnId
 * @param fromDate
 * @param callback
 */
controllerKmaStnWeather.findHourlies2 = function (stnId, fromDate, callback) {
    stnId = parseInt(stnId);

    log.debug("find hourlies2 hourlies stnId="+stnId+" fromDate="+fromDate);

    KmaStnHourly2.find({stnId: stnId, date: {$gt:fromDate}}, {_id: 0}).sort({date: 1}).lean().exec(function (err, weatherList) {
        if (err)  {
            return callback(err);
        }
        if (weatherList == undefined || weatherList.length == 0) {
            err = new Error("Fail to find hourlies stnId="+stnId+" fromDate="+fromDate);
            return callback(err);
        }
        log.debug(JSON.stringify(weatherList));
        return callback(err, weatherList);
    });
};

/**
 *
 * @param stnInfo
 * @param limitTime 2시간 전 시간으로 들어와야 함
 * @param callback
 * @private
 */
controllerKmaStnWeather._getStnHourly2 = function (stnInfo, limitTime, callback) {
    var self = this;

    self.findHourlies2(stnInfo.stnId, limitTime, function (err, stnWeatherList) {
        if (err) {
            log.error(err);
            return callback();
        }

        var hourlyData = stnWeatherList[stnWeatherList.length-1];

        if (hourlyData == undefined) {
            log.error('It does not have data pubDate=', dateTime, ' stnName=', stnInfo.stnName);
            return callback();
        }

        for (var key in hourlyData) {
            stnInfo[key] = hourlyData[key];
        }
        stnInfo.rnsHitRate = stnInfo.rnsHit/stnInfo.rnsCount;
        callback(err, stnInfo);
    });
};

/**
 * 2시간내에 데이터 중에서 현재시간에 맞거나, 바로전 데이터를 사용한다
 * 사용하지 않음
 * @param stnInfo
 * @param dateTime 현재시간이 들어와야 함
 * @param callback
 * @private
 */
controllerKmaStnWeather._getStnHourly = function(stnInfo, dateTime, callback) {
    var self = this;
    var fromTime = new Date(dateTime);
    fromTime.setHours(fromTime.getHours()-2);

    self.findHourlies(stnInfo.stnId, fromTime, function(err, stnWeatherList) {
        if (err) {
            log.error(err);
            return callback();
        }

        var hourlyData = stnWeatherList[0].hourlyData[stnWeatherList[0].hourlyData.length-1];

        //dateTime은 현재 시간이며, 현재시간에 해당하는 데이터를 찾음, 못찾으면 마지막 데이터 사용.
        for (var i=stnWeatherList[0].hourlyData.length-1; i>=0; i--) {
            if (stnWeatherList[0].hourlyData[i].date === dateTime) {
                hourlyData = stnWeatherList[0].hourlyData[i];
                break;
            }
        }
        if (i < 0) {
            log.warn("Use previous data dateTime="+hourlyData.date);
        }

        if (hourlyData == undefined) {
            log.error('It does not have data pubDate=', dateTime, ' stnName=', stnInfo.stnName);
            return callback();
        }

        for (var key in hourlyData) {
            stnInfo[key] = hourlyData[key];
        }
        stnInfo.rnsHitRate = stnInfo.rnsHit/stnInfo.rnsCount;
        callback(err, stnInfo);

        //var stnWeatherInfo = JSON.parse(JSON.stringify(hourlyData));
        //stnWeatherInfo.stnId = stnInfo.stnId;
        //stnWeatherInfo.stnName = stnInfo.stnName;
        //stnWeatherInfo.isCityWeather =  stnInfo.isCityWeather?true:false;
        //stnWeatherInfo.rnsHitRate = stnInfo.rnsHit/stnInfo.rnsCount;
        //mCallback(err, stnWeatherInfo);
    });
};

/**
 *
 * @param stnList
 * @param dateTime
 * @param callback
 * @returns {controllerKmaStnWeather}
 * @private
 */
controllerKmaStnWeather._getStnHourlyList = function (stnList, dateTime, callback) {
    var self = this;
    if (!Array.isArray(stnList)) {
        callback(new Error("mstStnList is not array"));
        return this;
    }

    //순서를 위해서 mapSeries를 사용
    async.mapSeries(stnList,
        function (stnInfo, mCallback) {
            var fromTime = new Date(dateTime);
            fromTime.setHours(fromTime.getHours()-2);
            self._getStnHourly2(stnInfo, fromTime, function (err, stnInfo) {
                if (err) {
                    return mCallback(err);
                }
                mCallback(err, stnInfo);
            });
        },
        function (err, results) {
            if (err)  {
                return callback(err);
            }
            results = results.filter(function (data) {
                return !!data;
            });
            callback(err, results);
        });

    return this;
};

/**
 * 사용할 stn를 선정한다. 산 등 고도가 주변지역보다 너무 차이 나는 경우 제외.
 * @param stnList
 * @returns {*}
 * @private
 */
controllerKmaStnWeather._filterStnList = function (stnList) {
    return stnList.filter(function (stn) {
        if (stn.isMountain == undefined) {
            return true;
        }
        if (stn.isCityWeather) return true;

        return !stn.isMountain;
    });
};

/**
 *
 * @param coords
 * @param maxDistance
 * @param isCityWeather
 * @param limit
 * @param callback
 */
controllerKmaStnWeather.getStnList = function (coords, maxDistance, isCityWeather, limit, callback) {
    var query = {};
    if (coords) {
        if (maxDistance) {
            query.geo = {"$near":coords, "$maxDistance":maxDistance};
        }
        else {
            query.geo = {"$near":coords};
        }
    }
    if (!(isCityWeather == undefined)) {
       query.isCityWeather = isCityWeather;
    }

    log.debug("get stn list query="+JSON.stringify(query));

    KmaStnInfo.find(query, {_id: 0, __v: 0}).limit(limit).lean().exec(function (err, stnList) {
        if (err) {
            return callback(err);
        }
        if (stnList == undefined || stnList.length == 0) {
            err = new Error("Fail to find stn coords="+coords);
            return callback(err);
        }
        return callback(err, stnList);
    });
};

/**
 *
 * @param townInfo
 * @param callback
 */
controllerKmaStnWeather.getCityHourlyList = function (townInfo, callback) {
    var self = this;
    var coords = [townInfo.gCoord.lon, townInfo.gCoord.lat];
    self.getStnList(coords, 1, true, 1, function (err, kmaStnList) {
        if (err) {
            return callback(err);
        }

        log.debug(JSON.stringify(kmaStnList));

        var fromDate = new Date();
        fromDate = kmaTimeLib.toTimeZone(9, fromDate);
        fromDate.setDate(fromDate.getDate()-8);
        self.findHourlies2(kmaStnList[0].stnId, fromDate, function (err, stnWeatherList) {
            if (err) {
                return callback(err);
            }
            callback(undefined, stnWeatherList);
        });
    });
};

/**
 * KMA station은 시도별날씨 정보를 제공하는 곳과 아닌 곳이 있어서 두개 구분하고, 시도별날씨를 요청에 꼭 하나 넣도록 한다.
 * 근접한 측정소의 온도값이 다은 측정소보다 차가 크다면, 산이나 높은 고도에 있는 것으로 보고, 측정값을 제외한다.
 * @param townInfo
 * @param dateTime
 * @param t1h
 * @param callback
 * @returns {controllerKmaStnWeather}
 */
controllerKmaStnWeather.getStnHourly = function (townInfo, dateTime, t1h, callback) {
    var self = this;

    var stnDateTime = kmaTimeLib.convertYYYYMMDDHHMMtoYYYYoMMoDDoHHoMM(dateTime);

    async.waterfall([function (cb) {
        var coords = [townInfo.gCoord.lon, townInfo.gCoord.lat];
        async.parallel([function (pCallback) {
            KmaStnInfo.find({geo: {$near:coords, $maxDistance: 0.2}}).limit(5).lean().exec(function (err, kmaStnList) {
                if (err) {
                    return pCallback(err);
                }
                return pCallback(err, kmaStnList);
            });
        }, function (pCallback) {
            KmaStnInfo.find({geo: {$near:coords, $maxDistance: 1}, isCityWeather: true}).limit(1).lean().exec(function (err, kmaStnList) {
                if (err) {
                    return pCallback(err);
                }
                return pCallback(err, kmaStnList);
            });
        }], function (err, results) {
            if (err) {
                return cb(err);
            }
            var stnList = self._filterStnList(results[0].concat(results[1])) ;
            cb(err, stnList);
        });
    }, function (stnList, cb) {
        self._getStnHourlyList(stnList, stnDateTime, function (err, results) {
            if (err) {
                return cb(err);
            }
            cb(err, results);
        });
    }, function (stnHourWeatherList, cb) {
        var mergedStnWeather = self._mergeStnWeatherList(stnHourWeatherList);
        if (mergedStnWeather == undefined) {
            return cb(new Error('Fail to make stn Hourly Weather info town='+JSON.stringify(townInfo)));
        }
        else {
            mergedStnWeather.stnDateTime = stnHourWeatherList[0].date;
        }
        cb(undefined, mergedStnWeather);
    }], function (err, result) {
        if (err) {
            return callback(err);
        }
        callback(err, result);
    });

    return this;
};

/**
 * 매분 날씨 정보를 가지고 옴.
 * @param townInfo
 * @param dateTime
 * @param t1h
 * @param callback
 * @returns {controllerKmaStnWeather}
 */
controllerKmaStnWeather.getStnMinute = function (townInfo, dateTime, t1h, callback) {
    var self = this;

    var stnDateTime = kmaTimeLib.convertYYYYMMDDHHMMtoYYYYoMMoDDoHHoMM(dateTime);
    var coords = [townInfo.gCoord.lon, townInfo.gCoord.lat];

    async.waterfall([
            function (aCallback) {
                KmaStnInfo.find({geo: {$near:coords, $maxDistance: 0.2}}).limit(5).lean().exec(function (err, kmaStnList) {
                    if (err) {
                        return aCallback(err);
                    }

                    var stnList = self._filterStnList(kmaStnList) ;
                    return aCallback(err, stnList);
                });
            },
            function (stnList, aCallback) {
               self._getStnMinuteList(stnList, stnDateTime, function (err, results) {
                   if (err) {
                       return aCallback(err);
                   }
                   aCallback(err, results);
               })
            },
            function (stnMinuteWeatherList, aCallback) {
                var mergedStnWeather = self._mergeStnWeatherList(stnMinuteWeatherList);
                if (mergedStnWeather == undefined) {
                    return aCallback(new Error('Fail to make stn Minute Weather info town='+JSON.stringify(townInfo)));
                }
                else {
                    mergedStnWeather.stnDateTime = stnMinuteWeatherList[0].date;
                }
                aCallback(undefined, mergedStnWeather);
            }
        ],
        function (err, result) {
            if (err)  {
                return callback(err);
            }
            callback(err, result);
        });

    return this;
};

///**
// * stnHourly와 stnMinute의 합치면서, hourly가 동네예보와 1도 이상 차이는 측정소의 온도는 skip함.
// * @param townInfo
// * @param dateTime system time (now)
// * @param current req.current
// * @param callback
// */
//controllerKmaStnWeather.getStnCheckedMinute = function (townInfo, dateTime, current, callback) {
//    var self = this;
//
//    var stnDateTime = kmaTimeLib.convertYYYYMMDDHHMMtoYYYYoMMoDDoHHoMM(dateTime);
//    var stnDateHour = kmaTimeLib.convertYYYYMMDDHHMMtoYYYYoMMoDDoHHoZZ(dateTime);
//    var currentTime = kmaTimeLib.convertYYYYMMDDHHMMtoYYYYoMMoDDoHHoMM(current.date+current.time);
//    var coords = [townInfo.gCoord.lon, townInfo.gCoord.lat];
//    var opt = {};
//
//    async.waterfall([
//            function (aCallback) {
//                async.parallel([function (pCallback) {
//                    KmaStnInfo.find({geo: {$near:coords, $maxDistance: 0.2}}).limit(5).lean().exec(function (err, kmaStnList) {
//                        if (err) {
//                            return pCallback(err);
//                        }
//                        return pCallback(err, kmaStnList);
//                    });
//                }, function (pCallback) {
//                    KmaStnInfo.find({geo: {$near:coords, $maxDistance: 1}, isCityWeather: true}).limit(3).lean().exec(function (err, kmaStnList) {
//                        if (err) {
//                            return pCallback(err);
//                        }
//                        return pCallback(err, kmaStnList);
//                    });
//                }], function (err, results) {
//                    if (err) {
//                        return aCallback(err);
//                    }
//                    //var stnList = self._filterStnList(results[0].concat(results[1])) ;
//                    var stnList = results[0].concat(results[1]) ;
//                    aCallback(err, stnList);
//                });
//            }, function (stnList, cb) {
//                self._getStnHourlyList(stnList, currentTime, function (err, results) {
//                    if (err) {
//                        return cb(err);
//                    }
//                    cb(err, results);
//                });
//            }, function (stnHourWeatherList, aCallback) {
//                var listFiltered = [];
//                var t1hIndex;
//                var rainIndex;
//                var cityWeatherIndex;
//                var pushedIndex;
//                stnHourWeatherList.forEach(function (stnHourWeather, index) {
//                    if (current.t1h == undefined && stnHourWeather.isCityWeather) {
//                        stnHourWeather.isT1hStn = true;
//                        listFiltered.push(stnHourWeather);
//                        t1hIndex = pushedIndex = index;
//                    }
//                    if (Math.abs(stnHourWeather.t1h - current.t1h) < 1 && t1hIndex == undefined) {
//                        stnHourWeather.isT1hStn = true;
//                        listFiltered.push(stnHourWeather);
//                        t1hIndex = pushedIndex = index;
//                        if (!(current.reh == undefined) && Math.abs(current.reh - stnHourWeather.reh) >= 10) {
//                            opt.skipReh = true;
//                        }
//                        if (!(current.wsd == undefined) && !(stnHourWeather.wsd == undefined) &&
//                            Math.abs(current.wsd - stnHourWeather.wsd) >= 1) {
//                            opt.skipWsd = true;
//                        }
//                    }
//
//                    if (stnHourWeather.rnsHitRate > 0.5 && rainIndex == undefined) {
//                        stnHourWeather.isRainStn = true;
//                        if (pushedIndex != index) {
//                            listFiltered.push(stnHourWeather);
//                            pushedIndex = index;
//                        }
//                        rainIndex =  index;
//                    }
//                    if (stnHourWeather.isCityWeather && cityWeatherIndex == undefined) {
//                        if (pushedIndex != index) {
//                            listFiltered.push(stnHourWeather);
//                            pushedIndex = index;
//                        }
//                        cityWeatherIndex = index;
//                    }
//                });
//
//                if (t1hIndex == undefined) {
//                    opt.skipTemp = true;
//                    opt.skipReh = true;
//                    opt.skipWsd = true;
//                }
//                if (!(current.pty == undefined) && rainIndex == undefined) {
//                    opt.skipRain = true;
//                }
//                aCallback(undefined, listFiltered);
//            }, function (stnList, cb) {
//                if (stnDateHour != currentTime) {
//                    //update to last time
//                    self._getStnHourlyList(stnList, stnDateHour, function (err, results) {
//                        if (err) {
//                            return cb(err);
//                        }
//                        cb(err, results);
//                    });
//                }
//                else {
//                   cb(undefined, stnList);
//                }
//            }, function (stnList, aCallback) {
//                self._getStnMinuteList(stnList, stnDateTime, function (err, results) {
//                    if (err) {
//                        log.error(err);
//                        return aCallback(undefined, stnList);
//                    }
//                    if (results.length == 0) {
//                        log.error("Fail to get stn minute, so use hourly");
//                        return aCallback(undefined, stnList);
//                    }
//                    aCallback(err, results);
//                })
//            }, function (stnMinuteWeatherList, aCallback) {
//                var mergedStnWeather = self._mergeStnWeatherList(stnMinuteWeatherList, opt);
//                if (mergedStnWeather == undefined) {
//                    return aCallback(new Error('Fail to make stn checked Minute Weather info town='+JSON.stringify(townInfo)));
//                }
//                else {
//                    mergedStnWeather.stnDateTime = stnMinuteWeatherList[0].date;
//                }
//                aCallback(undefined, mergedStnWeather);
//            }
//        ],
//        function (err, result) {
//            if (err)  {
//                return callback(err);
//            }
//            callback(err, result);
//        });
//
//    return this;
//};

/**
 * cityWeather의 시간단위와 분단위 날씨를 가지고 오고, 가장 가까운 5지역에서 추가로 rns 정보를 가지고 옴
 * @param townInfo
 * @param dateTime
 * @param current
 * @param callback
 * @returns {controllerKmaStnWeather}
 */
controllerKmaStnWeather.getStnHourlyAndMinRns = function (townInfo, dateTime, current, callback) {
    var self = this;
    var coords = [townInfo.gCoord.lon, townInfo.gCoord.lat];
    var stnDateTime = kmaTimeLib.convertYYYYMMDDHHMMtoYYYYoMMoDDoHHoMM(dateTime);
    var stnDateHour = kmaTimeLib.convertYYYYMMDDHHMMtoYYYYoMMoDDoHHoZZ(dateTime);
    var stnWeather = {};

    async.waterfall([
            function (pCallback) {
                self.getStnList(coords, 1, true, 1, function(err, kmaStnList) {
                    if (err) {
                        return pCallback(err);
                    }
                    var stn = kmaStnList[0];
                    for (var key in stn) {
                        stnWeather[key] = stn[key];
                    }
                    log.debug("stnWeather="+JSON.stringify(stnWeather));
                    return pCallback(err, stn);
                });
            },
            function (stn, pCallback) {
                var fromTime = new Date(stnDateHour);
                fromTime.setHours(fromTime.getHours()-2);
                self.findHourlies2(stn.stnId, fromTime, function (err, hourlyWeatherList) {
                    if (err)  {
                        return pCallback(err);
                    }
                    var hourlyWeather = hourlyWeatherList[hourlyWeatherList.length-1];
                    for (var key in hourlyWeather) {
                        stnWeather[key] = hourlyWeather[key];
                    }
                    if (stnWeather.rns === false && stnWeather.rs15m > 0) {
                        stnWeather.rns = true;
                        stnWeather.rnsSource = 'rs15m';
                    }
                    log.debug("stnWeather="+JSON.stringify(stnWeather));
                    stnWeather.cityHourAws = hourlyWeather;
                    return pCallback(err, stn);
                });
            },
            function (stn, pCallback) {
                self._getStnMinute2(stn, stnDateTime, function (err, minuteWeather) {
                    if (err)  {
                        return pCallback(err);
                    }

                    log.debug("minuWeather="+JSON.stringify(minuteWeather));
                    for (var key in minuteWeather) {
                        stnWeather[key] = minuteWeather[key];
                    }
                    if (stnWeather.rns === false && stnWeather.rs15m > 0) {
                        stnWeather.rns = true;
                        stnWeather.rnsSource = 'rs15m';
                    }
                    stnWeather.cityMinAws = minuteWeather;
                    return pCallback(err);
                });
            },
            function (pCallback) {
                self.getStnList(coords, 0.2, undefined, 5, function (err, kmaStnList) {
                    //error가 발생해도, 기존 정보로 cover하므로 skip함.
                    if (err) {
                        log.error(err);
                        kmaStnList = [];
                    }
                    if (kmaStnList.length > 0) {
                        stnWeather.nearStnId = kmaStnList[0].stnId;
                        stnWeather.nearStnName = kmaStnList[0].stnName;
                    }
                    return pCallback(null, kmaStnList);
                });
            },
            function (stnList, aCallback) {
                if (stnList.length < 2) {
                    log.warn('Fail to find local stn townInfo:', JSON.stringify(townInfo));
                    return aCallback();
                }

                self._checkPrecipFromStnMinuteList(stnList, stnDateTime, function (err, result) {
                    if (err) {
                        log.error(err);
                    }

                    if (result == undefined) {
                        //no precip
                        if (stnWeather.rns === true || stnWeather.rs15m > 0) {
                            log.info('CheckWeather : city rns/rs15m is true but local rns/rs15m is false stnList:',
                                JSON.stringify(stnList));
                        }
                        return aCallback();
                    }
                    else {
                        if (stnWeather.rns === false && stnWeather.rs15m === 0) {
                            log.info('CheckWeather : city rns/rs1m is false but local rns/rs15m is true result: ',
                                JSON.stringify(result));
                        }
                    }

                    stnWeather.rns = result.rns;
                    stnWeather.rs15m = result.rs15m;
                    stnWeather.rnsStnId = result.stnId;
                    stnWeather.rnsStnName = result.stnName;
                    stnWeather.rnsDate = result.date;
                    if (stnWeather.rns === false && stnWeather.rs15m > 0) {
                        stnWeather.rns = true;
                        stnWeather.rnsSource = 'rs15m';
                    }
                    stnWeather.localMinAws = result;
                    aCallback();
                });
            }
        ],
        function (err) {
            if (err)  {
                return callback(err);
            }
            stnWeather.stnDateTime = stnWeather.date;
            if (stnWeather.weather) {
               stnWeather.weatherType =  ControllerWeatherDesc.makeWeatherType(stnWeather.weather);
            }

            log.debug("stnWeather="+JSON.stringify(stnWeather));
            callback(err, stnWeather);
        });

    return this;
};

module.exports = controllerKmaStnWeather;
