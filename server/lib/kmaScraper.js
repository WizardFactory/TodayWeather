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
// var KmaStnDaily = require('../models/modelKmaStnDaily');
var KmaStnHourly = require('../models/modelKmaStnHourly');
var KmaStnHourly2 = require('../models/modelKmaStnHourly2');
var KmaStnMinute = require('../models/modelKmaStnMinute');
var KmaStnMinute2 = require('../models/modelKmaStnMinute2');
var KmaStnInfo = require('../models/modelKmaStnInfo');
var KmaSpecialWeatherSituation = require('../models/modelKmaSpecialWeatherSituation');

var Current = require('../models/modelCurrent');
var Town = require('../models/town');

var convertGeocode = require('../utils/convertGeocode');
var Convert = require('../utils/coordinate2xy');

var config = require('../config/config');
var CtrlS3 = require('../s3/controller.s3');

var dnscache = require('dnscache')({
    "enable" : true,
    "ttl" : 300,
    "cachesize" : 1000
});

/**
 *
 * @constructor
 */
function KmaScraper() {
    this.MAX_HOURLY_COUNT = 192; //8days * 24hours
    this.domain = "www.weather.go.kr";
}

/**
 * 분당, 시간별 들어오는 AWS weather data parsing
 * @param pubDate
 * @param $
 * @param callback
 * @returns {*}
 * @private
 */
KmaScraper.prototype._parseStnMinInfo = function(pubDate, $, callback) {

    var stnWeatherList = {pubDate: '', stnList: []};

    var strAr = $('.ehead').text().split(" ");

    stnWeatherList.pubDate = strAr[strAr.length-1];

    //actually pubDate is ''
    var err;
    if (stnWeatherList.pubDate == undefined || stnWeatherList.pubDate == '' || stnWeatherList.pubDate.length < 12) {
        err =  new Error('Fail to get weather pubdate='+stnWeatherList.pubDate);
        err.state = 'Retry';
        log.warn(err.toString());
        return callback(err);
    }

    if (pubDate) {
        if ((new Date(stnWeatherList.pubDate)).getTime() < (new Date(pubDate)).getTime()) {
            err =  new Error('Stn Minute info is not updated yet = '+ stnWeatherList.pubDate);
            err.state = 'Skip';
            return callback(err);
        }
    }

    log.info(stnWeatherList.pubDate);

    var table = $('table table');

    var propertyName = ['stnId', 'stnName', 'altitude', 'rns', 'rs15m', 'rs1h', 'rs3h', 'rs6h', 'rs12h', 'rs1d', 't1h',
                        'vec1', 'wdd1', 'wsd1', 'vec', 'wdd', 'wsd', 'reh', 'hPa', 'addr'];
    var stnIndex = 0;
    table.children('tr').each(function () {
        var td = $(this).children('td');
        if (stnIndex == 0) {
            stnIndex++; //skip header
            return;
        }

        var stnMinInfo = {};
        stnMinInfo.date = new Date(stnWeatherList.pubDate);
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

        if (pIndex > propertyName.length) {
            log.error('stnMinInfo is invalid format !! '+JSON.stringify(stnMinInfo));
        }
        else if (stnMinInfo.t1h === 0 && stnMinInfo.vec === 0 && stnMinInfo.wsd === 0 && stnMinInfo.vec1 === 0) {
           log.warn('stnMinInfo is invalid info'+JSON.stringify(stnMinInfo));
        }
        else {
            stnWeatherList.stnList.push(stnMinInfo);
            stnIndex++;
        }
    });

    callback(undefined, stnWeatherList);

    return this;
};

/**
 *
 * @param pubDate
 * @param $
 * @param callback
 * @returns {KmaScraper}
 * @private
 */
KmaScraper.prototype._parseStnDayInfo = function (pubDate, $, callback) {
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
 * KMA에서 parameter format 변경되었음.
 * get aws weather data
 * @param type
 * @param dateTime
 * @param callback
 * @returns {KmaScraper}
 */
KmaScraper.prototype.getAWSWeather = function (type, dateTime, callback) {
    var self = this;
    var url = this._getKmaDomain()+'/cgi-bin/aws';
    var pubDateTime;
    if (type == 'min') {
        url += '/nph-aws_txt_min';
    }
    else if (type == 'hourly') {
        pubDateTime = kmaTimeLib.convertYYYYoMMoDDoHHoMMtoYYYYMMDDHHMM(dateTime);
        url += '/nph-aws_txt_min' + '?'+ pubDateTime + '&0&MINDB_60M&0&m';
    }
    else if (type == 'daily') {
        pubDateTime = kmaTimeLib.convertYYYYoMMoDDoHHoMMtoYYYYMMDDHHMM(dateTime);
        url += '/nph-aws_txt_day' + '?'+ pubDateTime +'&0&DAYDB&0&m';
    }

    log.info(url);

    req(url, {timeout: 30000, encoding: 'binary'}, function (err, response, body) {
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
                self._parseStnDayInfo(dateTime, $, function (err, results) {
                    if (err) {
                        return callback(err);
                    }
                    callback(err, results);
                });
            }
            else {
               self._parseStnMinInfo(dateTime, $, function (err, results) {
                   if (err) {
                       return callback(err);
                   }
                   log.info(results.stnList.length);
                   callback(err, results);
               });
            }
        }
        catch(e) {
            callback(e);
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
 *
 * @param pubDate
 * @param callback
 */
KmaScraper.prototype.getCityWeather = function(pubDate, callback) {
    var self = this;
    var url = this._getKmaDomain()+'/weather/observation/currentweather.jsp';
    if (pubDate) {
        url += '?tm='+pubDate;
    }
    log.info(url);
    req(url, {timeout: 30000, encoding: 'binary'}, function (err, response, body) {
        if (err) {
            return callback(err);
        }

        var cityWeatherList = {pubDate: '', cityList: []};
        try {
            var strContents = new Buffer(body, 'binary');
            var iconv = new Iconv('euc-kr', 'UTF8');
            strContents = iconv.convert(strContents).toString();

            var $ = cheerio.load(strContents);
            cityWeatherList.pubDate = $('.table_topinfo').text();
            cityWeatherList.pubDate = cityWeatherList.pubDate.replace('기상실황표','');

            if ((new Date(cityWeatherList.pubDate)).getTime() < (new Date(pubDate)).getTime()) {
                err = new Error('city weather is not updated yes pubDate='+cityWeatherList.pubDate);
                log.warn(err);
                return callback(err);
            }
            var propertyName = ['stnId', 'stnName'];

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
                        tdText = $(this).children().first().attr('href');
                        var textArray = tdText.split('&');
                        for (var j=0; j<textArray.length; j++) {
                            if (textArray[j].indexOf('stn=') == 0) {
                                tdText = textArray[j].slice(4);
                                cityWeather[propertyName[i]] = tdText;
                                i++;
                                break;
                            }
                        }
                        if (j === textArray.length) {
                            log.error('Fail to find stnId for getting city weather!!');
                            //skip stnId property
                            i++;
                        }

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
                            //weather(현재일기)가 없는 경우도 특이사항없다는 정보임
                            //DB상에서는 city weather stn만이 weather값을 가짐
                            cityWeather[propertyName[i]] = tdText;
                        }
                    }
                    i++;
                });

                cityWeather.date = new Date(cityWeatherList.pubDate);

                if (cityWeather.stnId) {
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
    KmaStnHourly2.find({date:date}).limit(1).lean().exec(function (err, stnHourlyList) {
        if (err) {
            return callback(err);
        }
        if (stnHourlyList.length === 0) {
            return  callback(err, false);
        }
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

    //AWS가 고장났을때, 도시날씨만 동작하므로 addr이 없음. stnInfo는 skip함.
    if (stnWeatherInfo.stnId == undefined || stnWeatherInfo.addr == undefined) {
        log.warn("stnWeatherInfo don't have stnId or addr, skip save stnInfo name="+stnWeatherInfo.stnName);
        return callback();
    }

    KmaStnInfo.find({stnId: stnWeatherInfo.stnId}, function (err, stnList) {
        if (err) {
            return callback(err);
        }
        if (stnList.length > 0) {
            //already saved;
            if (stnList.length > 1) {
                log.error({state: 'conflict', stnId:stnWeatherInfo.stnId});
            }
            var savedStnInfo = stnList[0];
            if (savedStnInfo.isCityWeather !== stnWeatherInfo.isCityWeather) {
               savedStnInfo.isCityWeather = stnWeatherInfo.isCityWeather;
               log.info({state: 'update', kmaStnInfo: savedStnInfo.toString()});
               savedStnInfo.save(function (err) {
                   if (err) {
                       log.error({stnId:savedStnInfo.stnId, action:'save', error:err});
                   }
                   return callback(err, stnWeatherInfo.stnId);
               });
            }
            else {
                return callback(err, stnWeatherInfo.stnId);
            }
        }
        else {
            var addr = stnWeatherInfo.addr.replace(/\(산간\)/g, '');

            self._recursiveConvertGeoCode(addr, 30, function (err, result) {
                if(err) {
                    return callback(err);
                }

                log.debug('addr='+addr+' result'+JSON.stringify(result));
                var kmaStnInfo = new KmaStnInfo({
                    stnId: stnWeatherInfo.stnId,
                    stnName: stnWeatherInfo.stnName,
                    addr: stnWeatherInfo.addr,
                    isCityWeather: stnWeatherInfo.isCityWeather,
                    altitude: stnWeatherInfo.altitude,
                    geo: [result.lon, result.lat]
                });

                log.info({state: 'new', kmaStnInfo: kmaStnInfo.toString()});
                kmaStnInfo.save(function (err) {
                    if (err) {
                        return callback(err);
                    }
                    callback(err, stnWeatherInfo.stnId);
                });
            });
        }
    });

    return this;
};

/**
 * 한개의 정보를 저장함.
 * @param stnWeatherInfo
 * @param pubDate
 * @param callback
 * @returns {KmaScraper}
 * @private
 */
KmaScraper.prototype._saveStnMinute = function (stnWeatherInfo, pubDate, callback) {
    var self = this;

    KmaStnMinute.find({stnId: stnWeatherInfo.stnId}, function (err, stnMinuteList) {
        if (err) {
            return callback(err);
        }
        if (stnMinuteList.length > 1) {
            log.error('stnHourlyInfo is duplicated stnId=', stnWeatherInfo.stnId);
        }

        var kmaStnMinute;
        if (stnMinuteList.length == 0) {
            kmaStnMinute = new KmaStnMinute({
                stnId: stnWeatherInfo.stnId,
                stnName: stnWeatherInfo.stnName,
                pubDate: pubDate,
                minuteData: []
            });
        }
        else {
            kmaStnMinute = stnMinuteList[0];
            /**
             * 가끔씩 이전 시간의 데이터가 들어옴. 38mins->39mins->38mins
             */
            if ((new Date(kmaStnMinute.pubDate)).getTime() >= (new Date(pubDate)).getTime()) {
                //log.info('already latest data');
                return callback(err, {stnId:stnWeatherInfo.stnId, pubDate: pubDate});
            }

            kmaStnMinute.pubDate = pubDate;
        }

        kmaStnMinute.minuteData.push(self._makeDailyData(pubDate, stnWeatherInfo));
        //2h 저장함. current data로 hitRate계산시 필요함.
        if (kmaStnMinute.minuteData.length > 120) {
            var index = kmaStnMinute.minuteData.length - 120;
            kmaStnMinute.minuteData = kmaStnMinute.minuteData.slice(index, kmaStnMinute.minuteData.length);
        }

        kmaStnMinute.save(function (err) {
            if (err) {
                return callback(err);
            }
            return callback(err, {stnId:stnWeatherInfo.stnId, pubDate: pubDate});
        });
    });

    return this;
};

// KmaScraper.prototype._saveKmaStnMinuteList = function (weatherList, callback) {
//     var self = this;
//
//     async.map(weatherList.stnList,
//         function (stnWeatherInfo, mapCallback) {
//             self._saveStnMinute(stnWeatherInfo, weatherList.pubDate, function (err, savedList) {
//                 if (err) {
//                     return mapCallback(err);
//                 }
//                 mapCallback(err, savedList);
//             });
//         },
//         function (err, results) {
//             if (err) {
//                 return callback(err);
//             }
//
//             callback(err, results);
//         });
//
//     return this;
// };

KmaScraper.prototype._saveKmaStnMinute2List = function (weatherList, callback) {
    var self = this;

    async.map(weatherList.stnList,
        function (stnWeatherInfo, mapCallback) {
            self._saveStnMinute2(stnWeatherInfo, weatherList.pubDate, function (err, savedList) {
                if (err) {
                    return mapCallback(err);
                }
                mapCallback(err, savedList);
            });
        },
        function (err, results) {
            if (err) {
                return callback(err);
            }

            callback(err, results);
        });

    return this;
};

KmaScraper.prototype._saveStnHourly2 = function (stnWeatherInfo, pubDate, callback) {
    KmaStnHourly2.update({stnId:stnWeatherInfo.stnId, date:stnWeatherInfo.date}, stnWeatherInfo, {upsert:true},
        function (err) {
            if (err) {
                log.error(err.message + "in insert DB(KmaStnHourly)");
                log.warn(JSON.stringify(stnWeatherInfo));
            }
            return callback(err);
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

        //skip check date to overwrite new data
        //var dataLen = stnHourlyList[0].hourlyData.length;
        //for (var i=dataLen-1; i>=0; i--) {
        //    var dbHourlyData = stnHourlyList[0].hourlyData[i];
        //    if (dbHourlyData.date === pubDate) {
        //        log.warn('stn weather info is already saved stnId=', stnWeatherInfo.stnId,
        //            ' pubDate=', pubDate);
        //
        //        return callback(err, {stnId:stnWeatherInfo.stnId, pubDate: pubDate});
        //    }
        //}

        if (pubDate > stnHourlyList[0].pubDate) {
            stnHourlyList[0].pubDate = pubDate;
        }

        var newHourlyData = self._makeDailyData(pubDate, stnWeatherInfo);

        for (var i=stnHourlyList[0].hourlyData.length-1; i>=0; i--) {
            var hourlyData =  stnHourlyList[0].hourlyData[i];
            if (newHourlyData.date == hourlyData.date) {
                break;
            }
        }
        if (i >= 0) {
            stnHourlyList[0].hourlyData[i] = newHourlyData;
        }
        else {
            stnHourlyList[0].hourlyData.push(newHourlyData);
            stnHourlyList[0].hourlyData.sort(function(a, b){
                if(a.date > b.date){
                    return 1;
                }
                if(a.date < b.date){
                    return -1;
                }
                return 0;
            });
        }

        if(stnHourlyList[0].hourlyData.length > self.MAX_HOURLY_COUNT){
            stnHourlyList[0].hourlyData = stnHourlyList[0].hourlyData.slice((stnHourlyList[0].hourlyData.length - self.MAX_HOURLY_COUNT));
        }

        stnHourlyList[0].save(function (err) {
            if (err) {
                return callback(err);
            }
            return callback(err, {stnId:stnWeatherInfo.stnId, pubDate: pubDate});
        });
    });

    return this;
};

KmaScraper.prototype._saveKmaStnHourly2List = function (weatherList, callback) {
    var self = this;
    async.map(weatherList.stnList, function (stnWeatherInfo, mapCallback) {
        async.waterfall([
                function (wfCallback) {
                    self._saveStnInfo(stnWeatherInfo, function (err) {
                        if (err) {
                            return wfCallback(err);
                        }
                        wfCallback(err);
                    });
                },
                function (wfCallback) {
                    self._saveStnHourly2(stnWeatherInfo, weatherList.pubDate, function (err, savedList) {
                        if (err) {
                            return wfCallback(err);
                        }
                        wfCallback(err, savedList);
                    });
                }
            ],
            function (err, savedList) {
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
 * stnInfo를 먼저 저장하고, stnHourly 저장한다.
 * @param weatherList
 * @param callback
 * @private
 */
// KmaScraper.prototype._saveKmaStnHourlyList = function (weatherList, callback) {
//     var self = this;
//    async.map(weatherList.stnList, function (stnWeatherInfo, mapCallback) {
//
//        async.waterfall([function (wfCallback) {
//           self._saveStnInfo(stnWeatherInfo, function (err) {
//               if (err) {
//                   return wfCallback(err);
//               }
//               wfCallback(err);
//           });
//        }, function (wfCallback) {
//           self._saveStnHourly(stnWeatherInfo, weatherList.pubDate, function (err, savedList) {
//               if (err) {
//                   return wfCallback(err);
//               }
//               wfCallback(err, savedList);
//           });
//        }], function (err, savedList) {
//            if (err) {
//                return mapCallback(err);
//            }
//            mapCallback(err, savedList);
//        });
//
//    }, function (err, results) {
//        if (err) {
//            return callback(err);
//        }
//
//        callback(err, results);
//    });
// };

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
            if (cityWeatherInfo.stnId === awsList[i].stnId) {
                for (var key in cityWeatherInfo ) {
                    awsList[i][key] = cityWeatherInfo[key];
                }
                awsList[i].isCityWeather = true;
                log.silly(JSON.stringify(awsList[i]));
                return;
            }
        }
        if (i >= awsList.length) {
            log.warn("AWS and City Fail to find stnId=["+cityWeatherInfo.stnId+"] stnName=[", cityWeatherInfo.stnName,"]");
            awsList.push(cityWeatherInfo);
            awsList[awsList.length-1].isCityWeather = true;
        }
    });

    return awsList;
};

/**
 *
 * @param callback
 */
KmaScraper.prototype.getStnMinuteWeather = function (callback) {
    var self = this;
    log.info('get stn every minute weather');

    async.waterfall([
        function (cb) {
            self.getAWSWeather('min', undefined, function (err, weatherList) {
                if (err) {
                    return cb(err);
                }
                return cb(err, {pubDate: weatherList.pubDate, stnList: weatherList.stnList});
            });
        },
        //function (weatherList, cb) {
        //    log.info('save1 wl stnlist='+weatherList.stnList.length+' time='+new Date());
        //    self._saveKmaStnMinuteList(weatherList, function (err, results) {
        //        log.info('done1 wl stnlist='+weatherList.stnList.length+' time='+new Date());
        //        if (err) {
        //            return cb(err);
        //        }
        //        return cb(err, weatherList);
        //    });
        //},
        function (weatherList, cb) {
            log.info('save2 wl stnlist='+weatherList.stnList.length+' time='+new Date());
            self._saveKmaStnMinute2List(weatherList, function (err, results) {
                log.info('done2 wl stnlist='+weatherList.stnList.length+' time='+new Date());
                if (err) {
                    return cb(err);
                }
                return cb(err, results);
            });
        },
        function (results, cb) {
            self._removeOldData("Minute");
            cb(null, results);
        }
    ], function (err, results) {
        if (err) {
            return callback(err);
        }
        callback(err, results);
    });
};

/**
 *
 * @param days
 * @param callback
 * @returns {KmaScraper}
 */
KmaScraper.prototype.getStnPastHourlyWeather = function (days, callback) {
    var self = this;
    var pubDateCount = days*24;
    var pubDateList = [];
    var date = kmaTimeLib.toTimeZone(9);

    for (var i=0; i<pubDateCount; i++) {
        date.setHours(date.getHours()-1);
        pubDateList.push(new Date(date));
    }
    //log.info(pubDateList);
    async.mapLimit(pubDateList, 3,
        function (pubDate, aCallback) {
            self.getStnHourlyWeather(pubDate, function (err, results) {
                if (err == 'skip') {
                    return aCallback(undefined, results);
                }
                aCallback(err, results);
            });
        },
        function (err, results) {
            if (err)  {
                return callback(err);
            }
            callback(err, results);
        });

    return this;
};

KmaScraper.prototype._removeOldData = function (name, callback) {
    var removeDate = new Date();
    if (name == 'Hourly') {
        removeDate.setDate(removeDate.getDate()-10);
        KmaStnHourly2.remove({"date": {$lt:removeDate} }, function (err) {
            log.info('removed stn '+name+' date from date : '+removeDate);
            if (callback)callback(err);
        });
    }
    else {
        removeDate.setDate(removeDate.getDate()-1);
        KmaStnMinute2.remove({"date": {$lt:removeDate} }, function(err){
            log.info('removed stn '+name+' date from date : '+removeDate);
            if (callback)callback(err);
        });
    }
};

KmaScraper.prototype._uploadS3 = function(obj, callback) {
    if (config.s3 == undefined || config.s3.bucketName == undefined || config.s3.bucketName.length === 0) {
        return callback(new Error('undefined s3 information'));
    }

    var ctrlS3 = new CtrlS3(config.s3.region, config.s3.bucketName);
    var s3Path = obj.prefix;
    var dataString = JSON.stringify(obj.data, null, 2);
    ctrlS3.uploadData(dataString, s3Path)
        .then(function (result) {
           callback(null, result);
        })
        .catch(function (err) {
            callback(err);
        });
};

/**
 *
 * @param day
 * @param callback
 */
KmaScraper.prototype.getStnHourlyWeather = function (day, callback) {
    var self = this;
    var pubDate = kmaTimeLib.convertDateToYYYYoMMoDDoHHoZZ(day);

    log.info('get stn hourly weather pubdate='+pubDate, 'day='+day);

    async.waterfall([
        //skip check pubdate to overwrite new data
        //stn 마다 모두 확인하는 것이 아니기 때문에, 최종으로 check없이 한번더 저장필요.
        //update every time
        //function (cb) {
        //    //check update time
        //    self._checkPubdate(pubDate, function (err, hasData) {
        //        if (err) {
        //            return cb(err);
        //        }
        //        if (hasData) {
        //            return cb('skip');
        //        }
        //        cb();
        //    });
        //},
        function (cb) {
            log.info('get aws weather');
            //retry
            async.retry({
                    times:10,
                    interval:1000,
                    errorFilter: function(err) {
                        return err.state == 'Retry'; // only retry on a specific error
                    }
                },
                function (retryCallback) {
                self.getAWSWeather('hourly', pubDate, function (err, weatherList) {
                    if (err)  {
                        return retryCallback(err);
                    }
                    return retryCallback(err, weatherList);
                });
            }, function (err, weatherList) {
                if (err)  {
                    return cb(err);
                }
                return cb(err, weatherList);
            });
        },
        function (awsWeatherList, cb) {
            async.retry({times:10, interval:1000},
                function (callback) {
                    self.getCityWeather(pubDate, function (err, cityWeatherList) {
                        callback(err, cityWeatherList);
                    });
                },
                function (err, cityWeatherList) {
                    if (awsWeatherList.pubDate != cityWeatherList.pubDate) {
                        log.error("pubdate is different aws.pubDate=", awsWeatherList.pubDate,
                            " city.pubDate=", cityWeatherList.pubDate);
                    }

                    var weatherList = self._mergeAWSandCity(awsWeatherList.stnList, cityWeatherList.cityList);
                    //weatherList.forEach(function (awsInfo) {
                    //   log.info(JSON.stringify(awsInfo)) ;
                    //});
                    cb(err, {pubDate: awsWeatherList.pubDate, stnList: weatherList});
                });
        },
        function (weatherList, cb) {
            var prefix = 'kma/aws/hourly/' + weatherList.pubDate + '-kmaAwsHourly.json';
            self._uploadS3({prefix:prefix, data: weatherList}, function (err, result) {
                if (err) {
                    log.error(err);
                }
                else {
                    log.debug(result);
                }
            });

            cb(null, weatherList);
        },
        //function (weatherList, cb) {
        //    log.info('save1 wl stnlist='+weatherList.stnList.length+' time='+new Date());
        //    self._saveKmaStnHourlyList(weatherList, function (err, results) {
        //        log.info('done1 wl stnlist='+weatherList.stnList.length+' time='+new Date());
        //        if (err) {
        //            return cb(err);
        //        }
        //        return cb(err, weatherList);
        //    });},
        function (weatherList, cb) {
            log.info('save2 wl stnlist='+weatherList.stnList.length+' time='+new Date());
            self._saveKmaStnHourly2List(weatherList, function (err, results) {
                log.info('done2 wl stnlist='+weatherList.stnList.length+' time='+new Date());
                if (err) {
                    return cb(err);
                }
                return cb(err, results);
            });
        },
        function (results, cb) {
            self._removeOldData("Hourly");
            cb(null, results);
        }
    ], function (err, results) {
        if (err) {
            return callback(err);
        }
        callback(err, results);
    });
};

/**
 * towns에 측정소 주소를 추가하였음. 일부 섬지역은 current를 제공하지 않음.
 * @param mOriCoord
 * @param callback
 * @private
 */
KmaScraper.prototype._findCurrent = function(mOriCoord, callback) {
   var mCoordList = [];

    mCoordList.push(mOriCoord);
    //mCoordList.push({mx:mOriCoord.mx+1, my:mOriCoord.my});
    //mCoordList.push({mx:mOriCoord.mx-1, my:mOriCoord.my});
    //mCoordList.push({mx:mOriCoord.mx, my:mOriCoord.my+1});
    //mCoordList.push({mx:mOriCoord.mx, my:mOriCoord.my-1});
    //mCoordList.push({mx:mOriCoord.mx+1, my:mOriCoord.my+1});
    //mCoordList.push({mx:mOriCoord.mx-1, my:mOriCoord.my-1});

    async.mapSeries(mCoordList, function (mCoord, aCallback) {
        Current.find({"mCoord.mx": mCoord.mx, "mCoord.my":mCoord.my}).lean().exec(function (err, currentList) {
            if (err) {
                return aCallback();
            }
            if (currentList.length == 0) {
                return aCallback();
            }
            var current = currentList[0];
            return aCallback(true, current);
        });
    }, function (isFind, results) {
        if (isFind == true) {
            return callback(undefined, results[results.length-1]);
        }

        callback(new Error("Fail to get current info"));
    });
};

KmaScraper.prototype._updateRnsHitRate = function(stnInfo, callback) {
    var self = this;
    var geocode = {lon:stnInfo.geo[0], lat:stnInfo.geo[1]};
    var conv = new Convert(geocode, {}).toLocation();
    var mCoord = {};
    mCoord.mx = conv.getLocation().x;
    mCoord.my = conv.getLocation().y;

    async.waterfall([
            function (aCallback) {
                self._findCurrent(mCoord, function (err, currentList) {
                    if (err) {
                        return aCallback(new Error("Fail to get current info stnId="+stnInfo.stnId+" mCoord="+JSON.stringify(mCoord))+" address="+stnInfo.addr);
                    }

                    var current = currentList.currentData[currentList.currentData.length-1];

                    if (current.pty > 0 || current.rn1 > 0) {
                        log.info("stnId="+stnInfo.stnId+" it is raining");
                        return aCallback(undefined, current);
                    }

                    aCallback("stnId="+stnInfo.stnId+" It was not raining");
                });
            },
            function (current, aCallback) {
                KmaStnMinute.find({"stnId": stnInfo.stnId}).lean().exec(function (err, stnWeatherList) {
                    if (err) {
                        return aCallback(err);
                    }
                    if (stnWeatherList.length == 0) {
                       return aCallback(new Error("Fail to get weather info stnId="+stnInfo.stnId)) ;
                    }
                    var endTime = kmaTimeLib.convertStringToDate(current.date+current.time).getTime();
                    var startTime = endTime - 3600000;
                    var minuteList = stnWeatherList[0].minuteData.filter(function (data) {
                        var dataTime = (new Date(data.date)).getTime();
                        return startTime < dataTime && dataTime <= endTime;
                    });

                    if (minuteList.length < 15)  {
                        return aCallback(new Error("Need more minute weather"));
                    }
                    var rnsCount = 0;
                    var rns = false;
                    for (var i=0; i<minuteList.length; i++) {
                        if (minuteList[i].rns == undefined) {

                        }
                        else if (minuteList[i].rns == true) {
                            rnsCount++;
                            rns = true;
                        }
                        else if (minuteList[i].rns == false) {
                            rnsCount++;
                        }
                    }
                    if (rnsCount > 0) {
                        return aCallback(undefined, rns);
                    }
                    aCallback("no rns information stnId="+stnInfo.stnId);
                });
            },
            function (isHit, aCallback) {
                if (stnInfo.rnsHit == undefined) {
                    stnInfo.rnsHit = 0;
                }
                if (stnInfo.rnsCount == undefined) {
                    stnInfo.rnsCount = 0;
                }

                if (isHit) {
                    stnInfo.rnsHit = stnInfo.rnsHit + 1;
                }
                stnInfo.rnsCount = stnInfo.rnsCount + 1;

                log.info('Update stnId='+stnInfo.stnId+" rnsHit="+stnInfo.rnsHit+" rnsCount="+stnInfo.rnsCount);
                stnInfo.save(function (err) {
                    if (err) {
                        log.error(err);
                    }
                });

                aCallback(undefined, stnInfo.rnsHit/stnInfo.rnsCount);
            }
        ],
        function (err, result) {
            if (err)  {
                log.verbose(err);
            }

            callback(undefined, result);
        });
};

/**
 * current에서 비가 온 경우 aws에서 1시간 이내에 비가 온 적이 있다면, hit.
 */
KmaScraper.prototype.updateRnsHitRates = function (callback) {
    var self = this;
    KmaStnInfo.find().exec(function (err, kmaStnList) {
        if (err) {
            return callback(err);
        }

        async.mapSeries(kmaStnList,
            function (stnInfo, mCallback) {
                self._updateRnsHitRate(stnInfo, function (err, result) {
                    if (err) {
                        return mCallback(err);
                    }
                    mCallback(err, result);
                });
            },
            function (err, results) {
                if (err) {
                    return callback(err);
                }
                callback(err, results);
            }
        );
    });
};

/**
 * rns(강수)가 동작하지는 않는 측정소 리스트. resetRnsHitRates를 실행하면 아래 리스트 0/1이 되고, 나머지 측정소는 1/1로 설정됨.
 * @param stnId
 * @returns {boolean}
 * @private
 */
KmaScraper.prototype._checkRnsWork = function (stnId) {
    var noWorkRns = ["364", "365", "366", "368", "409", "458", "459", "460", "461", "476", "488", "492", "548", "556"];
    for (var i=0; i<noWorkRns.length; i++) {
        if (stnId == noWorkRns[i]) {
            return false;
        }
    }
    return true;
};

/**
 * rns 확률값을 초기화 한다.
 * @param callback
 */
KmaScraper.prototype.resetRnsHitRates = function (callback) {
    var self = this;
    KmaStnInfo.find().exec(function (err, kmaStnList) {
        if (err) {
            return callback(err);
        }
        async.map(kmaStnList, function(stn, aCallback) {
                if (self._checkRnsWork(stn.stnId)) {
                    stn.rnsHit = 1;
                    stn.rnsCount = 1;
                }
                else {
                    stn.rnsHit = 0;
                    stn.rnsCount = 1;
                }
                stn.save(function(err) {
                    aCallback(err);
                });
            },
            function(err, results) {
               callback(err, results) ;
            });
    });
};

/**
 * 측정소의 address가 글자들이 붙어 있어 분리해야 함.
 * @param addr
 * @returns {{first: *, second: *, third: *}}
 * @private
 */
KmaScraper.prototype._parseStnAddress = function (addr) {
    var address = addr.replace(" ", "").replace("(산간)", "");
    var sido = ["광역시", "도", "시"];
    var sigungu = ["시흥시", "양구군", "완주군", "파주시", "공주시", "완도군", "고흥군", "신안군", "의성군", "군위군", "김천시",
        "영덕군", "제주시", "거제시", "구미시", "구례군", "구리시", "구로구", "구", "시", "군"];
    var i;
    var index;
    //log.info("addr="+addr+"!");
    //log.info("address="+address+"!");
    for (i=0; i<sido.length; i++) {
        index = address.indexOf(sido[i]);
        if (0< index && index < 7) {
            if (sido[i] == "광역시") {
                index+=2;
            }
            break;
        }
    }
    var first = address.slice(0, index+1);
    var rest = address.slice(index+1, address.length);

    for (i=0; i<sigungu.length; i++) {
        index = rest.indexOf(sigungu[i]);
        //log.info(sigungu[i]+"="+index);
        if (index >= 0) {
            if (sigungu[i].length == 3) {
                index+=2;
            }
            break;
        }
    }

    var second = rest.slice(0, index+1);
    var third = rest.slice(index+1, rest.length);

    //log.info(first+"\t\t"+second+"\t\t"+third);
    return {first: first, second: second, third: third};
};

/**
 * 측정소가 있는 위치의 날씨 정보를 저장하기 위해서, towns에 측정소 위치를 저장한다.
 * 동네예보를 제공하지 않는 지역들이 있음.섬지역임.
 * areaNo를 추가하지 않기 때문에 생활지수,보건지수를 구하지 못함.
 * @param callback
 */
KmaScraper.prototype.addStnAddressToTown = function (callback) {
    var self = this;
    var noWorkCoord = [{mx: 66, my:54}, {mx:60, my:49}, {mx:51, my:94}, {mx:30, my:58}, {mx:44, my:107}, {mx:60, my:49}];

    KmaStnInfo.find().lean().exec(function (err, kmaStnList) {
        if (err) {
            return callback(err);
        }

        async.map(kmaStnList,
            function (kmaStn, aCallback) {
                kmaStn.town = self._parseStnAddress(kmaStn.addr);
                kmaStn.geocode = {lat:kmaStn.geo[1], lon:kmaStn.geo[0]};
                var conv = new Convert(kmaStn.geocode, {}).toLocation();
                kmaStn.mCoord = {};
                kmaStn.mCoord.mx = conv.getLocation().x;
                kmaStn.mCoord.my = conv.getLocation().y;
                for (var i=0; i<noWorkCoord.length; i++) {
                    if (kmaStn.mCoord.mx == noWorkCoord[i].mx && kmaStn.mCoord.my == noWorkCoord[i].my) {
                        log.info("stnId="+kmaStn.stnId+" this area is not supported");
                        return aCallback(err, kmaStn.addr);
                    }
                }

                Town.find({"mCoord.mx": kmaStn.mCoord.mx, "mCoord.my": kmaStn.mCoord.my}).lean().exec(function (err, result) {
                    if (err) {
                        return log.error(err);
                    }
                    if (result.length == 0) {
                        var town = new Town();
                        town.town = kmaStn.town;
                        town.gCoord = kmaStn.geocode;
                        town.mCoord = kmaStn.mCoord;
                        log.info('save town='+JSON.stringify(kmaStn.town));
                        town.save(function (err) {
                            aCallback(err, kmaStn.addr);
                        });
                    }
                    else {
                        log.info('already saved town='+JSON.stringify(kmaStn.town));
                        aCallback(err, kmaStn.addr);
                    }
                });
            },
            function (err, results) {
                return callback(err, results);
            });
    });
};

/**
 * 고도 필드의 배경이 rgb(255, 255, 187), stnName에 (레)가 들어간 경우, 주변 지역보다 많이 높은 경우.
 * 부산(레), 가야산, 북악산, 팔공산, 백운산, 토함산, 매곡
 * @param stnId
 * @private
 */
KmaScraper.prototype._checkMountain = function (stnId) {
    var mountainList = ["100", "116", "160", "175", "216", "311", "314", "315", "316", "318",
                        "320", "422", "497", "498", "554", "579", "659", "674", "682", "694",
                        "695", "753", "782", "831", "853", "856", "859", "867", "868", "869",
                        "870", "871", "872", "873", "875", "878", "879", "943"];
    for (var i=0; i<mountainList.length; i++) {
        if (stnId == mountainList[i]) {
            return true;
        }
    }
    return false;
};

/**
 * db에 isMountain에 대한 값을 설정한다.
 * 고도 필드의 배경색이 rgb(255, 255, 187); 인것과 일부 주변지역에 비해 고도가 높은 지역을 mountain으로 설정하여
 * 관측정보에서 제외한다.
 * @param callback
 */
KmaScraper.prototype.resetMoutainInfo = function(callback) {
    var self = this;
    KmaStnInfo.find().exec(function (err, kmaStnList) {
        if (err) {
            return callback(err);
        }
        async.map(kmaStnList, function(stn, aCallback) {
                stn.isMountain = self._checkMountain(stn.stnId);
                stn.save(function(err) {
                    aCallback(err);
                });
            },
            function(err, results) {
                callback(err, results) ;
            });
    });
};

KmaScraper.prototype._saveStnMinute2 = function (stnWeatherInfo, pubDate, callback) {

    KmaStnMinute2.update({stnId:stnWeatherInfo.stnId, date:stnWeatherInfo.date}, stnWeatherInfo, {upsert:true},
        function (err) {
            if (err) {
                log.error(err.message + "in insert DB(KmaStnMinute)");
                log.warn(JSON.stringify(stnWeatherInfo));
            }
            return callback(err);
        });

    return this;
};

/**
 *
 * @returns {string}
 * @private
 */
KmaScraper.prototype._getKmaDomain = function () {
 return "http://"+this.domain;
};

/**
 * 기상특보 현황 : 2017년 06월 21일 11시 00분 이후 (2017년 06월 21일 10시 00분 발표)
 * 예비 기상특보 현황 : 2017년 06월 21일 10시 00분 발표
 * 기상정보 : 2017년 06월 22일 04시 00분 발표
 * @param html
 * @private
 */
KmaScraper.prototype._getAnnouncement = function (html) {
    //기상특보 현황 : 2017년 06월 19일 18시 00분
    var pubDateStr = html.children('dt').text();
    pubDateStr = pubDateStr.replace(/\t/g, '');
    pubDateStr = pubDateStr.replace(/\r\n/g, '');
    if (pubDateStr.indexOf('(') != -1) {
        pubDateStr = pubDateStr.slice(pubDateStr.indexOf('(')+1, pubDateStr.indexOf('발표')-1);
    }
    else {
        pubDateStr = pubDateStr.slice(pubDateStr.indexOf(':')+2, pubDateStr.indexOf('발표')-1);
    }

    return kmaTimeLib.convertKoreaStr2Date(pubDateStr);
};

/**
 *
 * @returns {string}
 */
KmaScraper.prototype.getSpecialWeatherSituationUrl = function () {
   return this._getKmaDomain()+"/weather/warning/status.jsp";
};

/**
 *
 * @param specialHtml
 * @param type
 * @returns {{}}
 * @private
 */
KmaScraper.prototype._parseSpecialHtml = function (specialHtml, type) {

    var announcement = this._getAnnouncement(specialHtml);
    var imageUrl = this._getKmaDomain() + specialHtml.find('img').attr('src');

    var body = specialHtml.children('dd').text();
    body = body.replace(/\t/g, '');
    body = body.replace(/\r\n/g, '');
    var bodyArray = body.split('<참고사항>');
    var situationStr = bodyArray[0];
    situationStr = situationStr.replace(/\s+/g, '');

    var comment = bodyArray[1];

    var situationList;
    var situationArray;
    if (type == KmaSpecialWeatherSituation.TYPE_SPECIAL) {
        situationArray = situationStr.split('o');
        situationList = KmaSpecialWeatherSituation.strArray2SituationList(situationArray);
    }
    else if (type == KmaSpecialWeatherSituation.TYPE_PRELIMINARY_SPECIAL) {
        //(1)호우예비특보o06월29일저녁:제주도(제주도산지)o06월29일밤:제주도(제주도남부)
        var re = new RegExp(/\([0-9]\)/);
        situationArray = situationStr.split(re);
        for (var i=0; i<situationArray.length; i++) {
            // o없음
            //(1)풍량예비특보o0620일아침:제주도남쪽먼바다
            if (situationArray[i].indexOf("없음") >= 0) {
                situationArray[i] = situationArray[i].slice(1);
            }
            else {
                situationArray[i] = situationArray[i].slice(2);
                situationArray[i] = situationArray[i].replace(/:/g, '-');
                situationArray[i] = situationArray[i].replace(/o/g, ':');
            }
        }
        //호우예비특보:06월29일저녁-제주도(제주도산지):06월29일밤-제주도(제주도남부)
        situationList = KmaSpecialWeatherSituation.strArray2SituationList(situationArray);
    }

    var special = {};
    special.announcement = announcement;
    special.type = type;
    special.imageUrl = imageUrl;
    special.situationList = situationList;
    special.comment = comment;
    return special;
};

/**
 *
 * @param html
 * @param type
 * @returns {{}}
 * @private
 */
KmaScraper.prototype._parseWeatherInformationHtml = function (html, type) {
    var weatherInformation = {};
    weatherInformation.announcement = this._getAnnouncement(html);

    var body = html.children('dd').children('ul').children('li').text();
    body = body.replace(/\t/g, '');
    body = body.replace(/\r\n/g, '');
    weatherInformation.comment = body;
    weatherInformation.type = type;

    return weatherInformation;
};

/**
 *
 * @param $
 * @param callback
 */
KmaScraper.prototype.parseSpecialWeatherSituationList = function ($, callback) {
    var self = this;
    var specialWeatherSituationList = [];

    log.info("prase kma special weather");

    try {
        var specialHtml = $('.special_report_list2').eq(0);
        var preliminarySpecialHtml = $('.special_report_list2').eq(1);
        var weatherNewsHtml = $('.special_report_list3').eq(0);
        var weatherNewsHtml2 = $('.special_report_list3').eq(1);

        /**
         *기상특보 현황 : 2017년 06월 18일 15시 00분 이후 (2017년 06월 18일 15시 00분 발표)
         */
        var specialWeatherSituation;
        specialWeatherSituation = self._parseSpecialHtml(specialHtml, KmaSpecialWeatherSituation.TYPE_SPECIAL);
        specialWeatherSituationList.push(specialWeatherSituation);

        specialWeatherSituation = {};
        specialWeatherSituation = self._parseSpecialHtml(preliminarySpecialHtml, KmaSpecialWeatherSituation.TYPE_PRELIMINARY_SPECIAL);
        specialWeatherSituationList.push(specialWeatherSituation);

        var weatherFlashHtml;
        var weatherInformationHtml;
        if (weatherNewsHtml2.length > 0) {
            weatherFlashHtml = weatherNewsHtml;
            weatherInformationHtml = weatherNewsHtml2;
        }
        else {
            weatherInformationHtml = weatherNewsHtml;
        }

        if (weatherFlashHtml && weatherFlashHtml.length > 0) {
            specialWeatherSituation = {};
            specialWeatherSituation = self._parseWeatherInformationHtml(weatherFlashHtml, KmaSpecialWeatherSituation.TYPE_WEATHER_FLASH);
            specialWeatherSituationList.push(specialWeatherSituation);
        }

        if (weatherFlashHtml && weatherInformationHtml.length > 0) {
            specialWeatherSituation = {};
            specialWeatherSituation = self._parseWeatherInformationHtml(weatherInformationHtml, KmaSpecialWeatherSituation.TYPE_WEATHER_INFORMATION);
            specialWeatherSituationList.push(specialWeatherSituation);
        }
    }
    catch(err) {
        return callback(err);
    }

    callback(null, specialWeatherSituationList);
};

KmaScraper.prototype.requestSpecialWeatherSituation = function (callback) {
    var self = this;
    var url = self.getSpecialWeatherSituationUrl();

    log.info("kma special weather url="+url);

    req(url, {timeout: 30000, encoding: 'binary'}, function (err, response, body) {
        if (err) {
            log.error(err);
            return callback(err);
        }
        try {
            var strContents = new Buffer(body, 'binary');
            var iconv = new Iconv('euc-kr', 'UTF8');
            strContents = iconv.convert(strContents).toString();

            var $ = cheerio.load(strContents);
        }
        catch(err) {
            return callback(err);
        }

        callback(null, $);
    });
};

/**
 *
 * @param sws
 * @param callback
 */
KmaScraper.prototype.findSpecialWeatherSituation = function (sws, callback) {
   KmaSpecialWeatherSituation.find({announcement: sws.announcement, type: sws.type}).limit(1).lean().exec(function (err, result) {
       if (err) {
           log.error(err.message + "in find DB(KmaSpecialWeatherSituation)");
           return callback(err);
       }
       return callback(null, result);
   });
};

/**
 *
 * @param sws
 * @param callback
 */
KmaScraper.prototype.updateSpecialWeatherSituation = function (sws, callback) {
   KmaSpecialWeatherSituation.update({announcement: sws.announcement, type: sws.type}, sws, {upsert:true}, function (err) {
       if (err) {
           log.error(err.message + "in insert DB(KmaSpecialWeatherSituation)");
           log.warn(JSON.stringify(sws));
       }
       return callback(err);
   });
};

/**
 *
 * @param callback
 */
KmaScraper.prototype.gatherSpecialWeatherSituation = function (callback) {
    var self = this;
    async.waterfall([
            function(cb) {
                self.requestSpecialWeatherSituation(function (err, result) {
                    if (err) {
                        return cb(err);
                    }
                    return cb(null, result)
                });
            },
            function ($, cb) {
                self.parseSpecialWeatherSituationList($, function (err, swsList) {
                    if (err) {
                        return cb(err);
                    }
                    cb(err, swsList);
                });
            },
            function (swsList, cb) {
                async.map(swsList, function (sws, mCallback) {
                    self.findSpecialWeatherSituation(sws, function (err, result) {
                        if (err) {
                            return mCallback(err);
                        }
                        if (result && result.length > 0) {
                            return mCallback(err);
                        }
                        mCallback(err, sws);
                    });
                }, function (err, newSwsList) {
                    if (err) {
                        return cb(err);
                    }
                    if (newSwsList == undefined) {
                        return cb('skip');
                    }
                    newSwsList = newSwsList.filter(function (sws) {
                        return sws != undefined;

                    });
                    if (newSwsList.length <= 0) {
                        return cb('skip');
                    }
                    cb(err, newSwsList);
                });
            },
            function (swsList, cb) {
                async.map(swsList,
                    function (sws, mCallback) {
                        self.updateSpecialWeatherSituation(sws, function (err) {
                            mCallback(err);
                        });
                    },
                    function (err) {
                       cb(err);
                    });
            }
        ],
        function (err) {
            return callback(err);
        });
};

module.exports = KmaScraper;


