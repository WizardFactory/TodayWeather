/**
 * Created by aleckim on 2016. 4. 2..
 */

"use strict";

var async = require('async');
var req = require('request');
var cheerio = require('cheerio');
var Iconv = require('iconv').Iconv;
var Buffer = require('buffer').Buffer;

var kmaTimeLib = require('../lib/kmaTimeLib');
var KmaStnDaily = require('../models/modelKmaStnDaily');
var KmaStnHourly = require('../models/modelKmaStnHourly');
var KmaStnInfo = require('../models/modelKmaStnInfo');

var convertGeocode = require('../utils/convertGeocode');

/**
 *
 * @constructor
 */
function KmaScraper() {

}

/**
 * 분당, 시간별 들어오는 AWS weather data parsing
 * @param $
 * @param callback
 * @returns {KmaScraper}
 * @private
 */
KmaScraper.prototype._parseStnMinInfo = function($, callback) {

    var stnWeatherList = {pubDate: '', stnList: []};

    var strAr = $('.ehead').text().split(" ");
    stnWeatherList.pubDate = strAr[strAr.length-1];

    log.info(stnWeatherList.pubDate);

    var table = $('table table');

    var propertyName = ['stnId', 'stnName', 'altitude', 'rns', 'rs15m', 'rs1h', 'rs6h', 'rs12h', 'rs1d', 't1h',
                        'vec1', 'wdd1', 'wsd1', 'vec', 'wdd', 'wsd', 'reh', 'hPa', 'addr'];
    var stnIndex = 0;
    table.children('tr').each(function () {
        var td = $(this).children('td');
        if (stnIndex == 0) {
            stnIndex++; //skip header
            return;
        }

        var stnMinInfo = {};
        var pIndex = 0;
        td.each(function() {
            var tdText = $(this).text().replace(/\s+/, "");
            tdText = tdText.replace(/(\r\n|\n|\r)/gm,"");
            tdText = tdText.replace(/\s+/, "");
            if (tdText === '.' || tdText === '-') {
                //skip invalid data
            }
            else {
                var val;
                if (propertyName[pIndex] === 'altitude' || propertyName[pIndex] === 'reh') {
                    val = parseInt(tdText);
                    if (!isNaN(val)) {
                        stnMinInfo[propertyName[pIndex]] = parseInt(tdText);
                    }
                }
                else if (propertyName[pIndex] === 'rns') {
                    if (tdText === '○') {
                        stnMinInfo[propertyName[pIndex]] = false;
                    }
                    else if (tdText === '●') {
                        stnMinInfo[propertyName[pIndex]] = true;
                    }
                }
                else if (propertyName[pIndex] === 'rs15m' ||
                    propertyName[pIndex] === 'rs1h' ||
                    propertyName[pIndex] === 'rs6h' ||
                    propertyName[pIndex] === 'rs12h' ||
                    propertyName[pIndex] === 'rs1d' ||
                    propertyName[pIndex] === 't1h' ||
                    propertyName[pIndex] === 'vec1' ||
                    propertyName[pIndex] === 'wsd1' ||
                    propertyName[pIndex] === 'vec' ||
                    propertyName[pIndex] === 'wsd' ||
                    propertyName[pIndex] === 'hPa') {
                    val = parseFloat(tdText);
                    if (!isNaN(val)) {
                        stnMinInfo[propertyName[pIndex]] = val;
                    }
                }
                else {
                    stnMinInfo[propertyName[pIndex]] = tdText;
                }
            }
            pIndex++;
        });
        //log.info(JSON.stringify(stnMinInfo));
        stnWeatherList.stnList.push(stnMinInfo);
        stnIndex++;
    });

    callback(undefined, stnWeatherList);

    return this;
};

/**
 *
 * @param $
 * @param callback
 * @returns {KmaScraper}
 * @private
 */
KmaScraper.prototype._parseStnDayInfo = function ($, callback) {
    callback(new Error('It is not support yet'));

    //var stnWeatherList = {pubDate: '', stnList: []};
    //
    //var strAr = $('.ehead').text().split(" ");
    //stnWeatherList.pubDate = strAr[strAr.length-1];
    //$('table tbody tr td table tbody tr').each(function () {
    //    var tr = $(this);
    //});

    return this;
};

/**
 * get aws weather data
 * @param type
 * @param dateTime
 * @param callback
 * @returns {KmaScraper}
 */
KmaScraper.prototype.getAWSWeather = function (type, dateTime, callback) {
    var self = this;
    var url = 'http://www.kma.go.kr/cgi-bin/aws';
    if (type == 'min') {
        url += '/nph-aws_txt_min';
    }
    else if (type == 'hourly') {
        url += '/nph-aws_txt_min' + '?'+ dateTime + '&0&MINDB_60M&0&a';
    }
    else if (type == 'daily') {
        url += '/nph-aws_txt_day' + '?'+ dateTime +'&0&DAYDB&0&a';
    }

    log.info(url);

    req(url, {encoding: 'binary'}, function (err, response, body) {
        if (err) {
            log.error(err);
            return callback(err);
        }

        try {
            var strContents = new Buffer(body, 'binary');
            var iconv = new Iconv('euc-kr', 'UTF8');
            strContents = iconv.convert(strContents).toString();

            var $ = cheerio.load(strContents);
            if (type === 'daily') {
                self._parseStnDayInfo($, function (err, results) {
                    if (err) {
                        return callback(err);
                    }
                    callback(err, results);
                });
            }
            else {
               self._parseStnMinInfo($, function (err, results) {
                   if (err) {
                       return callback(err);
                   }
                   callback(err, results);
               });
            }
        }
        catch(e) {
        }
    });

    return this;
};

/**
 * convert korean to english
 * @param str
 * @returns {*}
 * @private
 */
KmaScraper.prototype._convertKrToEng = function (str) {
    return str.replace(/동/g, 'E').replace(/서/g,'W').replace(/남/g,'S').replace(/북/g, 'N');
};

/**
 * parsing city weather
 * @param callback
 */
KmaScraper.prototype.getCityWeather = function(callback) {
    var self = this;
    var url = 'http://www.kma.go.kr/weather/observation/currentweather.jsp';
    req(url, {encoding: 'binary'}, function (err, response, body) {
        if (err) {
            log.error(err);
            return callback(err);
        }

        var cityWeatherList = {pubDate: '', cityList: []};
        try {
            var strContents = new Buffer(body, 'binary');
            var iconv = new Iconv('euc-kr', 'UTF8');
            strContents = iconv.convert(strContents).toString();

            var $ = cheerio.load(strContents);
            cityWeatherList.pubDate = $('.table_topinfo').text();
            var propertyName = ['stnName'];

            $('.table_develop3 thead #table_header2 th').each(function () {
                var thName = $(this).text().replace(/\s+/, "");
                thName = thName.replace(/(\r\n|\n|\r)/gm,"");
                thName = thName.replace(/\s+/, "");
                log.debug('['+thName+']');
                switch (thName) {
                    case '현재일기':
                        propertyName.push('weather');
                        break;
                    case '시정km':
                        propertyName.push('visibility');
                        break;
                    case '운량1/10':
                        propertyName.push('cloud');
                        break;
                    case '중하운량':
                        propertyName.push('heavyCloud');
                        break;
                    case '현재기온':
                        propertyName.push('t1h');
                        break;
                    case '이슬점온도':
                        propertyName.push('dpt');
                        break;
                    case '체감온도':
                        propertyName.push('sensoryTem');
                        break;
                    case '불쾌지수':
                        propertyName.push('dspls');
                        break;
                    case '일강수mm':
                        propertyName.push('r1d');
                        break;
                    case '적설cm':
                        propertyName.push('s1d');
                        break;
                    case '습도%':
                        propertyName.push('reh');
                        break;
                    case '풍향':
                        propertyName.push('wdd');
                        break;
                    case '풍속m/s':
                        propertyName.push('wsd');
                        break;
                    case '해면기압':
                        propertyName.push('hPa');
                        break;
                    default :
                        log.error('unknown city weather property=',thName);
                        propertyName.push('unknown');
                        break;
                }
            });

            $('.table_develop3 tbody tr').each(function() {
                var cityWeather = {} ;

                var i = 0;
                $(this).children('td').filter(function() {
                    var val = 0;

                    var tdText = $(this).text().replace(/\s+/, "");
                    tdText = tdText.replace(/(\r\n|\n|\r)/gm,"");
                    tdText = tdText.replace(/\s+/, "");

                    if ($(this).children().first().is('a')) {
                        tdText = $(this).children().first().text().replace(/\s+/, "");
                        tdText = tdText.replace(/(\r\n|\n|\r)/gm,"");
                        tdText = tdText.replace(/\s+/, "");
                        //aws에서  station name이 백령임
                        if (tdText === '백령도') {
                            tdText = '백령';
                        }
                        cityWeather[propertyName[i]] = tdText;
                    }
                    else {
                        if (propertyName[i] === 'visibility' ||
                            propertyName[i] === 'cloud' ||
                            propertyName[i] === 'heavyCloud' ||
                            propertyName[i] === 'dspls' ||
                            propertyName[i] === 'reh') {
                            val = parseInt(tdText);
                            if (!isNaN(val)) {
                                cityWeather[propertyName[i]] = val;
                            }
                        }
                        else if (propertyName[i] === 't1h' ||
                            propertyName[i] === 'sensoryTem' ||
                            propertyName[i] === 'dpt' ||
                            propertyName[i] === 'r1d' ||
                            propertyName[i] === 's1d' ||
                            propertyName[i] === 'wsd' ||
                            propertyName[i] === 'hPa') {
                            val = parseFloat(tdText);
                            if (!isNaN(val)) {
                                cityWeather[propertyName[i]] = val;
                            }
                        }
                        else if (propertyName[i] === 'wdd') {
                            cityWeather[propertyName[i]] = self._convertKrToEng(tdText);
                        }
                        else {
                            if (tdText.length != 0) {
                                cityWeather[propertyName[i]] = tdText;
                            }
                        }
                    }
                    i++;
                });
                if (cityWeather.stnName) {
                    //log.info(JSON.stringify(cityWeather));
                    cityWeatherList.cityList.push(cityWeather);
                }
            });
            callback(err, cityWeatherList);
        }
        catch(e) {
            return callback(e);
        }
    });
};

/**
 *
 * @param date
 * @param callback
 * @returns {KmaScraper}
 * @private
 */
KmaScraper.prototype._checkPubdate = function(date, callback)  {
    KmaStnHourly.find({}).lean().exec(function (err, stnHourlyList) {
        if (err) {
            return callback(err);
        }
        if (stnHourlyList.length === 0) {
            return  callback(err, false);
        }

        for (var i=0; i<stnHourlyList.length; i++) {
            if (stnHourlyList[i].pubDate != date) {
                log.info('stnId='+stnHourlyList[i]+' pubDate='+stnHourlyList[i].pubDate+' current='+date);
                return  callback(err, false);
            }
        }

        log.info('kma stn weather already updated');
        return callback(err, true);
    });

    return this;
};

/**
 *
 * @param pubDate
 * @param stnWeatherInfo
 * @returns {{date: *, weather: *, visibility: (*|string), cloud: *, heavyCloud: *, t1h: *, dpt: *, sensoryTem: *, dspls: (*|lSchema.dspls|{lastUpdateDate, data}), r1d: *, s1d: *, reh: *, wdd: *, vec: (*|vec|{type, default}), wsd: *, hPa: *, rs1h: *, rs1d: *, rns: *}}
 * @private
 */
KmaScraper.prototype._makeDailyData = function(pubDate, stnWeatherInfo) {
    return {
        date : pubDate,
        weather : stnWeatherInfo.weather,
        visibility : stnWeatherInfo.visibility,
        cloud : stnWeatherInfo.cloud,
        heavyCloud : stnWeatherInfo.heavyCloud,
        t1h : stnWeatherInfo.t1h,
        dpt : stnWeatherInfo.dpt,
        sensoryTem: stnWeatherInfo.sensoryTem,
        dspls: stnWeatherInfo.dspls, //불쾌지수
        r1d: stnWeatherInfo.r1d,
        s1d: stnWeatherInfo.s1d,
        reh: stnWeatherInfo.reh,
        wdd: stnWeatherInfo.wdd, //ESE, SW, ..
        vec: stnWeatherInfo.vec, //143.7
        wsd: stnWeatherInfo.wsd,
        hPa: stnWeatherInfo.hPa,
        rs1h: stnWeatherInfo.rs1h, //rain or snow or rain/snow from AWS
        rs1d: stnWeatherInfo.rs1d,
        rns: stnWeatherInfo.rns
    };
};

/**
 *
 * @param addr
 * @param retryCount
 * @param callback
 * @returns {*}
 * @private
 */
KmaScraper.prototype._recursiveConvertGeoCode = function(addr, retryCount, callback) {
    var self = this;
    if (retryCount <= 0)  {
        return callback(new Error("Fail to recursive convert geo code"));
    }

    convertGeocode(addr, "", "", function (err, result) {
        if (err) {
            retryCount--;
            log.warn('fail by err retry convert addr=',addr);
            return self._recursiveConvertGeoCode(addr, retryCount, callback)
        }

        //가끔 error없이 lat, lon이 없는 상태로 넘어오는 경우가 있음.
        if (result.lat == undefined || result.lon == undefined) {
            retryCount--;
            log.warn('fail by undefined retry convert addr=',addr);
            return self._recursiveConvertGeoCode(addr, retryCount, callback)
        }

        callback(err, result);
    });
};

/**
 *
 * @param stnWeatherInfo
 * @param callback
 * @returns {KmaScraper}
 * @private
 */
KmaScraper.prototype._saveStnInfo = function (stnWeatherInfo, callback) {
    var self = this;

    KmaStnInfo.find({stnId: stnWeatherInfo.stnId}, function (err, stnList) {
        if (err) {
            return callback(err);
        }
        if (stnList.length > 0) {
            //already saved;
            return callback(err, stnWeatherInfo.stnId);
        }

        var addr = stnWeatherInfo.addr.replace(/\(산간\)/g, '');

        self._recursiveConvertGeoCode(addr, 30, function (err, result) {
            if(err) {
                return callback(err);
            }

            log.info('addr='+addr+' result'+JSON.stringify(result));
            var kmaStnInfo = new KmaStnInfo({
                stnId: stnWeatherInfo.stnId,
                stnName: stnWeatherInfo.stnName,
                addr: stnWeatherInfo.addr,
                isCityWeather: stnWeatherInfo.isCityWeather,
                altitude: stnWeatherInfo.altitude,
                geo: [result.lon, result.lat]
            });
            kmaStnInfo.save(function (err) {
                if (err) {
                    return callback(err);
                }
                callback(err, stnWeatherInfo.stnId);
            });
        });
    });

    return this;
};

/**
 *
 * @param stnWeatherInfo
 * @param pubDate
 * @param callback
 * @returns {KmaScraper}
 * @private
 */
KmaScraper.prototype._saveStnHourly = function (stnWeatherInfo, pubDate, callback) {
    var self = this;

    KmaStnHourly.find({stnId: stnWeatherInfo.stnId}, function (err, stnHourlyList) {
        if (err) {
            return callback(err);
        }

        if (stnHourlyList.length == 0) {
            //save
            var kmaStnHourly = new KmaStnHourly({
                stnId: stnWeatherInfo.stnId,
                stnName: stnWeatherInfo.stnName,
                pubDate: pubDate,
                hourlyData: []
            });

            kmaStnHourly.hourlyData.push(self._makeDailyData(pubDate, stnWeatherInfo));
            kmaStnHourly.save(function (err) {
                if (err) {
                    return callback(err);
                }
                return callback(err, {stnId:stnWeatherInfo.stnId, pubDate: pubDate});
            });
            return;
        }

        if (stnHourlyList.length > 1) {
            log.error('stnHourlyInfo is duplicated stnId=', stnWeatherInfo.stnId);
        }

        stnHourlyList[0].hourlyData.forEach(function (dbHourlyData) {
            if (dbHourlyData.date === pubDate) {
                log.warn('stn weather info is already saved stnId=', stnWeatherInfo.stnId,
                    ' pubDate=', pubDate);

                return callback(err, {stnId:stnWeatherInfo.stnId, pubDate: pubDate});
            }
        });

        stnHourlyList[0].pubDate = pubDate;
        stnHourlyList[0].hourlyData.push(self._makeDailyData(pubDate, stnWeatherInfo));
        stnHourlyList[0].save(function (err) {
            if (err) {
                return callback(err);
            }
            return callback(err, {stnId:stnWeatherInfo.stnId, pubDate: pubDate});
        });
    });

    return this;
};

/**
 * stnInfo를 먼저 저장하고, stnHourly 저장한다.
 * @param weatherList
 * @param callback
 * @private
 */
KmaScraper.prototype._saveKmaStnHourlyList = function (weatherList, callback) {
    var self = this;
   async.map(weatherList.stnList, function (stnWeatherInfo, mapCallback) {

       async.waterfall([function (wfCallback) {
          self._saveStnInfo(stnWeatherInfo, function (err) {
              if (err) {
                  return wfCallback(err);
              }
              wfCallback(err);
          });
       }, function (wfCallback) {
          self._saveStnHourly(stnWeatherInfo, weatherList.pubDate, function (err, savedList) {
              if (err) {
                  return wfCallback(err);
              }
              wfCallback(err, savedList);
          });
       }], function (err, savedList) {
           if (err) {
               return mapCallback(err);
           }
           mapCallback(err, savedList);
       });

   }, function (err, results) {
       if (err) {
           return callback(err);
       }

       callback(err, results);
   });
};

/**
 *
 * @param awsList
 * @param cityList
 * @returns {*}
 * @private
 */
KmaScraper.prototype._mergeAWSandCity = function(awsList, cityList) {
    cityList.forEach(function (cityWeatherInfo) {
        for (var i=0; i<awsList.length; i++)  {
            if (cityWeatherInfo.stnName === awsList[i].stnName) {
                for (var key in cityWeatherInfo ) {
                    awsList[i][key] = cityWeatherInfo[key];
                }
                awsList[i].isCityWeather = true;
                log.silly(JSON.stringify(awsList[i]));
                return;
            }
        }
        if (i >= awsList.length) {
            log.error("AWS and City Fail to find stnName=[", cityWeatherInfo.stnName,"]");
        }
    });

    return awsList;
};

/**
 *
 * @param callback
 */
KmaScraper.prototype.getStnHourlyWeather = function (callback) {
    var self = this;
    var pubDate = kmaTimeLib.convertDateToYYYYoMMoDDoHHoZZ();

    log.info('get stn hourly weather');

    async.waterfall([function (cb) {
        //check update time
        self._checkPubdate(pubDate, function (err, isLatest) {
            if (err) {
                return cb(err);
            }
            if (isLatest) {
                return cb('skip');
            }
            cb();
        });
    }, function (cb) {
        log.info('get aws weather');
        self.getAWSWeather('hourly', pubDate, function (err, weatherList) {
           if (err)  {
               return cb(err);
           }
            return cb(err, weatherList);
        });
    }, function (awsWeatherList, cb) {
        self.getCityWeather(function (err, cityWeatherList) {
            if (err) {
                return cb(err);
            }
            if (awsWeatherList.pubDate != cityWeatherList.pubDate) {
                log.error("pubdate is different aws.pubDate=", awsWeatherList.pubDate,
                    " city.pubDate=", cityWeatherList.pubDate);
            }

            var weatherList = self._mergeAWSandCity(awsWeatherList.stnList, cityWeatherList.cityList);
            //weatherList.forEach(function (awsInfo) {
            //   log.info(JSON.stringify(awsInfo)) ;
            //});
            cb(err, {pubDate: awsWeatherList.pubDate, stnList: weatherList});
        })
    }, function (weatherList, cb) {
        log.info('wl stnlist='+weatherList.stnList.length);
        self._saveKmaStnHourlyList(weatherList, function (err, results) {
            if (err) {
                return cb(err);
            }
            return cb(err, results);
        });
    }], function (err, results) {
        if (err) {
            return callback(err);
        }
        callback(err, results);
    });

};

module.exports = KmaScraper;


