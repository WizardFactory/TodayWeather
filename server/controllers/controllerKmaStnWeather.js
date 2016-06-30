/**
 * Created by aleckim on 2016. 4. 4..
 */

'use strict';

var async = require('async');

var KmaStnDaily = require('../models/modelKmaStnDaily');
var KmaStnHourly = require('../models/modelKmaStnHourly');
var KmaStnInfo = require('../models/modelKmaStnInfo');
var kmaTimeLib = require('../lib/kmaTimeLib');

var Scrape = require('../lib/kmaScraper');

function controllerKmaStnWeather() {

}

/**
 * weather, r1d, s1d는 발생시에만 있고, sensoryTem과 dspls는 둘중 하나만 있음
 * 도시별날씨의 경우 바로 적용.
 * @param stnWeatherList
 * @param t1h
 * @returns {*}
 * @private
 */
controllerKmaStnWeather._mergeStnWeatherList = function (stnWeatherList, t1h) {
    var propertyName = ['stnId', 'stnName', 'weather', 'visibility', 'cloud', 'heavyCloud', 't1h', 'dpt', 'sensoryTem', 'dspls',
                        'r1d', 's1d', 'reh', 'wdd', 'vec', 'wsd', 'hPa', 'rs1h', 'rs1d', 'rns'];
    var propertyCount = 0;
    var mergedStnWeatherInfo;
    var tmpDiff = 0;
    var nextTmpDiff = 0;

    for (var j=0; j<stnWeatherList.length; j++) {
        var stnWeatherInfo = stnWeatherList[j];

        if (stnWeatherInfo.t1h == undefined) {
            continue;
        }

        //도시별날씨라면 적용함.
        if (stnWeatherInfo.isCityWeather == false) {
            if (t1h != undefined) {
                tmpDiff = Math.abs(t1h - stnWeatherInfo.t1h);
                if (stnWeatherList[j+1] && stnWeatherList[j+1].t1h != undefined) {
                    nextTmpDiff =  Math.abs(t1h - stnWeatherList[j+1].t1h);
                    if (tmpDiff > nextTmpDiff) {
                        continue;
                    }
                }
                else {
                    //하나 뿐이거나, 마지막꺼는 잘 못 될 수 있어서 사용 안함.
                    //다음 측정소에서 정보를 못 가지고 오는 경우에도 버림.
                    continue;
                }
            }

            if (j >= 2 && mergedStnWeatherInfo == undefined) {
                //기본 값이 근접 1,2에서 못 만들면 버림.
                break;
            }
        }

        for (var i=2; i<propertyName.length; i++) {
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
 *
 * @param stnList
 * @param dateTime
 * @param callback
 * @returns {controllerKmaStnWeather}
 * @private
 */
controllerKmaStnWeather._getStnHourlyList = function (stnList, dateTime, callback) {
    if (!Array.isArray(stnList)) {
        callback(new Error("mstStnList is not array"));
        return this;
    }

    //순서를 위해서 mapSeries를 사용
    async.mapSeries(stnList, function (stnInfo, mCallback) {
       KmaStnHourly.find({stnId: stnInfo.stnId}).lean().exec(function (err, stnWeatherList) {
           if (err) {
               log.error(err);
               //it will removed
               return mCallback();
           }
           if (stnWeatherList.length === 0) {
               log.error('Fail to find stn Weather info of stnName=', stnInfo.stnName);
               return mCallback();
           }

           if (stnWeatherList.length > 1) {
               log.error('stn weather info is duplicated stnName=', stnInfo.stnName);
           }

           if (!stnWeatherList[0].pubDate) {
               log.warn('It does not have any data stnName=', stnInfo.stnName);
               return mCallback();
           }

           if ((new Date(stnWeatherList[0].pubDate)).getTime()+3600000 < (new Date(dateTime)).getTime()) {
               log.warn('It was not updated yet pubDate=',stnWeatherList[0].pubDate,' stnName=', stnInfo.stnName);
               return mCallback();
           }

           var hourlyData = stnWeatherList[0].hourlyData[0];

           //for (var i=stnWeatherList[0].hourlyData.length-1; i>=0; i--) {
           //    if (stnWeatherList[0].hourlyData[i].date === dateTime) {
           //        hourlyData = stnWeatherList[0].hourlyData[i];
           //        break;
           //    }
           //}

           if (hourlyData == undefined) {
               log.error('It does not have data pubDate=', dateTime, ' stnName=', stnInfo.stnName);
               return mCallback();
           }

           var stnWeatherInfo = JSON.parse(JSON.stringify(hourlyData));
           stnWeatherInfo.stnId = stnInfo.stnId;
           stnWeatherInfo.stnName = stnInfo.stnName;
           stnWeatherInfo.isCityWeather =  stnInfo.isCityWeather?true:false;

           mCallback(err, stnWeatherInfo);
       });
    }, function (err, results) {
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

    var stnDateTime = kmaTimeLib.convertYYYYMMDDHHMMtoYYYYoMMoDDoMMoZZ(dateTime);

    async.waterfall([function (cb) {
        var coords = [townInfo.gCoord.lon, townInfo.gCoord.lat];
        async.parallel([function (pCallback) {
            KmaStnInfo.find({geo: {$near:coords, $maxDistance: 0.3}}).limit(5).lean().exec(function (err, kmaStnList) {
                if (err) {
                    return pCallback(err);
                }
                return pCallback(err, kmaStnList);
            });
        }, function (pCallback) {
            KmaStnInfo.find({geo: {$near:coords, $maxDistance: 0.3}, isCityWeather: true}).limit(1).lean().exec(function (err, kmaStnList) {
                if (err) {
                    return pCallback(err);
                }
                return pCallback(err, kmaStnList);
            });
        }], function (err, results) {
            if (err) {
                return cb(err);
            }
            cb(err, results[0].concat(results[1]));
        });
    }, function (stnList, cb) {
        self._getStnHourlyList(stnList, stnDateTime, function (err, results) {
            if (err) {
                return cb(err);
            }
            cb(err, results);
        });
    }, function (stnHourWeatherList, cb) {
        var mergedStnWeather = self._mergeStnWeatherList(stnHourWeatherList, t1h);
        if (mergedStnWeather == undefined) {
            return cb(new Error('Fail to make stn Weather info town='+JSON.stringify(townInfo)));
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

module.exports = controllerKmaStnWeather;
