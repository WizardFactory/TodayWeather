/**
 * Created by Peter on 2016. 5. 29..
 */
"use strict";

var print = require('tracer').colorConsole({level:'info'});

var fs = require('fs');
var async = require('async');

var modelGeocode = require('../../models/worldWeather/modelGeocode');
var modelWuForecast = require('../../models/worldWeather/modelWuForecast');
var modelWuCurrent = require('../../models/worldWeather/modelWuCurrent');
var modelDSForecast = require('../../models/worldWeather/modelDSForecast');

var config = require('../../config/config');
var metRequester = require('../../lib/MET/metRequester');
var owmRequester = require('../../lib/OWM/owmRequester');
var wuRequester = require('../../lib/WU/wuRequester');
var dsfRequester = require('../../lib/DSF/dsfRequester');
var controllerKeys = require('./controllerKeys')    ;
/**
 *
 * @constructor
 */
function ConCollector() {
    var self = this;

    self.wuLimitation = 80;  // there is limitation to get 100 datas for a mimute from WU server.

    self.itemWuCurrent = ['date', 'desc', 'code', 'tmmp', 'ftemp', 'humid', 'windspd', 'winddir', 'cloud', 'vis', 'slp', 'dewpoint'];
    self.itemDsfCurrent = ['date', 'summary', 'pre_int', 'pre_pro', 'temp', 'ftemp', 'humid', 'windspd', 'winddir', 'vis', 'cloud', 'pres', 'oz'];
    self.itemDsfDaily = ['date', 'summary', 'sunrise', 'sunset', 'moonphase',
                            'pre_int', 'pre_intmax', 'pre_intmaxt', 'pre_pro', 'pre_type',
                            'temp_min', 'temp_mint', 'temp_max', 'temp_maxt',
                            'ftemp_min', 'ftemp_mint', 'ftemp_max', 'ftemp_maxt',
                            'humid', 'windspd', 'winddir', 'vis', 'cloud', 'pres', 'oz'];
    self.MAX_DSF_COUNT = 8;
    self.MAX_WU_COUNT = 72;

    self.cKeys = new controllerKeys();
}

ConCollector.prototype.addKey = function(type, key){
    var self = this;

    self.cKeys.addKey(type, key);
};
/**
 *
 * @returns {{id: string, key: string}}
 * @private
 */
ConCollector.prototype._getWuKey = function(){
    var self = this;
    return self.cKeys.getWuKey();
};

/**
 *
 * @param n
 * @param digits
 * @returns {string}
 * @private
 */
ConCollector.prototype._leadingZeros = function(n, digits) {
    var zero = '';
    n = n.toString();

    if(n.length < digits) {
        for(var i = 0; i < digits - n.length; i++){
            zero += '0';
        }
    }
    return zero + n;
};

/**
 *
 * @param tzOffset
 * @returns {string|*}
 * @private
 * @Description : The function will return GMT time without timezone.
 */
ConCollector.prototype._getTimeString = function(tzOffset) {
    var self = this;
    var now = new Date();
    var result;
    var offset;

    if(tzOffset === undefined){
        offset = 9;
    }else{
        offset = tzOffset;
    }

    var tz = now.getTime() + (offset * 3600000);
    now.setTime(tz);

    result =
        self._leadingZeros(now.getFullYear(), 4) +
        self._leadingZeros(now.getMonth() + 1, 2) +
        self._leadingZeros(now.getDate(), 2) +
        self._leadingZeros(now.getHours(), 2) +
        self._leadingZeros(now.getMinutes(), 2);

    return result;
};

/**
 *
 * @param date
 * @returns {Date|global.Date}
 * @private
 * @Description : The function will return GMT time object, but the timezone is set to ZERO.
 */
ConCollector.prototype._getDateObj = function(date){
    var d = date.toString();
    var dateObj = new Date(d.slice(0,4)+'/'+d.slice(4,6)+'/'+ d.slice(6,8)+' '+d.slice(8,10)+':'+ d.slice(10,12));

    //log.info('dateobj :', dateObj.toString());
    //log.info(''+d.slice(0,4)+'/'+d.slice(4,6)+'/'+ d.slice(6,8)+' '+d.slice(8,10)+':'+ d.slice(10,12));
    return dateObj;
};

/**
 *
 * @param time
 * @returns {Date|global.Date}
 * @private
 */
ConCollector.prototype._getUtcTime = function(time) {
    var now = new Date();

    now.setTime(time);

    return now;
};

/**
 *
 * @param db
 * @param callback
 * @private
 */
ConCollector.prototype._getGeocodeList = function(db, callback){
    db.getGeocode(function(err, resultList){
        if(err){
            log.error('Fail to get geocode');
        }
        callback(err, resultList);
    });
};

/**
 *
 * @returns {{date: number, sunrise: number, sunset: number, moonrise: number, moonset: number, tmax: number, tmin: number, precip: number, rain: number, snow: number, prob: number, humax: number, humin: number, windspdmax: number, windgstmax: number, slpmax: number, slpmin: number}}
 * @private
 */
ConCollector.prototype._makeDefaultWuSummary = function(){
    return {
        date:       0,
        sunrise:    -100,
        sunset:     -100,
        moonrise:   -100,
        moonset:    -100,
        tmax:       -100,
        tmin:       -100,
        precip:     -100,
        rain:       -100,
        snow:       -100,
        prob:       -100,
        humax:      -100,
        humin:      -100,
        windspdmax: -100,
        windgstmax: -100,
        slpmax:     -100,
        slpmin:     -100
    };
};

/**
 *
 * @returns {{date: number, time: number, utcDate: number, utcTime: number, desc: string, code: number, tmp: number, ftmp: number, winddir: number, windspd: number, windgst: number, cloudlow: number, cloudmid: number, cloudhigh: number, cloudtot: number, precip: number, rain: number, snow: number, fsnow: number, prob: number, humid: number, dewpoint: number, vis: number, splmax: number}}
 * @private
 */
ConCollector.prototype._makeDefaultWuForecast = function(){
    return {
        date:       0,         // YYYYMMDD,
        time:       0,         // HHMM
        utcDate:    0,         // YYYYMMDD,,
        utcTime:    0,         // HHMM
        desc:       '',        // string
        code:       -100,      //
        tmp:        -100,      //
        ftmp:       -100,      // 체감 온도
        winddir:    -100,      // degree(0~360), 풍향
        windspd:    -100,      // metres per second
        windgst:    -100,      // metres per second
        cloudlow:   -100,      // percent, low level cloud
        cloudmid:   -100,      // percent, mid level cloud
        cloudhigh:  -100,      // percent, high level cloud
        cloudtot:   -100,      // percent  total cloud
        precip:     -100,      // millimeters, total 강수량
        rain:       -100,      // millimeters
        snow:       -100,      // millimeters
        fsnow:      -100,      // centimetres, fresh snowfall - if accumulated
        prob:       -100,      // percent, 강수 확율
        humid:      -100,      // percent, 습도
        dewpoint:   -100,      // celcius, 이슬점
        vis:        -100,      // kilometers, 가시거
        splmax:     -100       // millibars, sea level pressure
    }
};

/**
 *
 * @returns {{date: number, desc: string, code: number, temp: number, ftemp: number, humid: number, windspd: number, winddir: number, cloud: number, vis: number, airpress: number, dewpoint: number}}
 * @private
 */
ConCollector.prototype._makeDefaultWuCurrent = function(){
    return {
        date:       -100,        // YYYYMMDDHHMM
        desc:       '',
        code:       -100,
        temp:       -100,
        ftemp:      -100,        // 체감온도
        humid:      -100,        // 습도
        windspd:    -100,        // meters per second, 풍속
        winddir:    -100,        // degree, 풍향
        cloud:      -100,        // percent, 구름량
        vis:        -100,        // kilometers, 가시거리
        airpress:   -100,        // millibars, 기압
        dewpoint:   -100         // celcius, 이슬점
    }
};

/**
 *
 * @param list
 * @param unit
 * @returns {Array}
 * @private
 */
ConCollector.prototype._divideList = function(list, unit){
    var resultList = [];
    var unitList = [];

    if(list.length < unit){
        resultList.push(list);
    }
    else{
        list.forEach(function(item, i){
            unitList.push(item);
            if(((i+1) % unit) === 0 ){
                resultList.push(unitList);
                unitList = [];
            }
        });
    }

    return resultList;
};
/**************************************************************************************/
/* WU Module
 /**************************************************************************************/
/**
 *
 * @param list
 * @param key
 * @param date
 * @param retryCount
 * @param callback
 * @private
 */
ConCollector.prototype._getAndSaveWuForecast = function(list, date, retryCount, callback){
    var self = this;
    var failList = [];

    if(list.length === 0){
        log.info('WuF> There is no geocode');
        callback(0, failList);
        return;
    }

    async.mapSeries(list,
        function(location, cb){
            var requester = new wuRequester;
            var geocode = {
                lat: parseFloat(location.lat),
                lon: parseFloat(location.lon)
            };

            modelWuForecast.find({geocode:geocode}, function(err, list){
                if(err){
                    log.error('WuF> _getAndSaveWuForecast : Fail to get DB');
                    print.error('WuF> _getAndSaveWuForecast : Fail to get DB');
                    cb(null);
                    return;
                }

                if(list.length != 0 && date != 0){
                    list.forEach(function(item){
                        // TODO : compare between date parameter and DB's date.
                    });
                }

                requester.getForecast(geocode, self._getWuKey(), function(err, result){
                    if(err){
                        print.error('WuF> get fail', location);
                        log.error('WuF> get fail', location);
                        failList.push(location);
                        cb(null);
                        return;
                    }

                    log.info(result);
                    self.saveWuForecast(geocode, date, result, function(err){
                        cb(null);
                    });
                });
            });
        },
        function(err){
            if(err){
                log.error('WuF> ');
            }

            if(retryCount > 0){
                return self._getAndSaveWuForecast(failList, date, --retryCount, callback);
            }else{
                callback(err, failList);
                return;
            }
        }
    );
};

/**
 *
 * @param list
 * @param key
 * @param date
 * @param retryCount
 * @param callback
 * @private
 */
ConCollector.prototype._getAndSaveWuCurrent = function(list, date, retryCount, callback){
    var self = this;
    var failList = [];

    if(list.length === 0){
        log.info('WuC> There is no geocode');
        callback(0, failList);
        return;
    }

    async.mapSeries(list,
        function(location, cb){
            var requester = new wuRequester;
            var geocode = {
                lat: parseFloat(location.lat),
                lon: parseFloat(location.lon)
            };

            modelWuCurrent.find({geocode:geocode}, function(err, list){
                if(err){
                    log.error('WuC> _getAndSaveWuCurrent : Fail to get DB');
                    cb(null);
                    return;
                }

                if(list.length != 0 && date != 0){
                    list.forEach(function(item){
                        // TODO : compare between date parameter and DB's date.
                    });
                }

                requester.getCurrent(geocode, self._getWuKey(), function(err, result){
                    if(err){
                        print.error('WuC> get fail', location);
                        log.error('WuC> get fail', location);
                        failList.push(location);
                        cb(null);
                        return;
                    }

                    log.info(result);
                    self.saveWuCurrent(geocode, date, result, function(err){
                        cb(null);
                    })
                });
            });
        },
        function(err){
            if(err){
                log.error('WuF> ');
            }

            if(retryCount > 0){
                return self._getAndSaveWuCurrent(failList, date, --retryCount, callback);
            }else{
                callback(err, failList);
                return;
            }
        }
    );
};

/**
 *
 * @param src
 * @returns {Array}
 * @private
 */
ConCollector.prototype._parseWuForecast = function(src){
    var self = this;
    var result = [];

    src.Days.forEach(function(day, index){
        var summary = {};
        var forecastList = [];

        summary = self._makeDefaultWuSummary();

        var dayDate = day.date.split('/');
        var dayDateInt = parseInt(''+dayDate[2]+dayDate[1]+dayDate[0]);
        var dateObj = new Date('' + dayDate[2] + '-' + dayDate[1] + '-' + dayDate[0]);

        summary.dateObj = dateObj;
        summary.date = dayDateInt;
        summary.sunrise = parseInt(day.sunrise_time.replace(':',''));
        summary.sunset = parseInt(day.sunset_time.replace(':',''));
        summary.moonrise = parseInt(day.moonrise_time.replace(':',''));
        summary.moonset = parseInt(day.moonset_time.replace(':',''));
        summary.tmax = parseFloat(day.temp_max_c);
        summary.tmax_f = parseFloat(day.temp_max_f);
        summary.tmin = parseFloat(day.temp_min_c);
        summary.tmin_f = parseFloat(day.temp_min_f);
        summary.precip = parseInt(day.precip_total_mm);
        summary.rain = parseInt(day.rain_total_mm);
        summary.snow = parseInt(day.snow_total_mm);
        summary.prob = parseInt(day.prob_precip_pct);
        summary.humax = parseInt(day.humid_max_pct);
        summary.humin = parseInt(day.humid_min_pct);
        summary.windspdmax = parseFloat(day.windspd_max_ms);
        summary.windspdmax_mh = parseFloat(day.windspd_max_mph);
        summary.windgstmax = parseFloat(day.windgst_max_ms);
        summary.slpmax = parseFloat(day.slp_max_mb);
        summary.slpmin = parseFloat(day.slp_min_mb);

        day.Timeframes.forEach(function(frame, idx){
            var forecast = self._makeDefaultWuForecast();

            var frameDate = frame.date.split('/');
            var frameDateInt = parseInt(''+frameDate[2]+frameDate[1]+frameDate[0]);
            forecast.date = frameDateInt;
            forecast.time = parseInt(frame.time);

            var utcDate = frame.utcdate.split('/');
            var utcDateInt = parseInt(''+utcDate[2]+utcDate[1]+utcDate[0]);
            forecast.utcDate = utcDateInt;
            forecast.utcTime = parseInt(frame.utctime);

            var timeString = self._leadingZeros(forecast.utcTime, 4);
            var dateString = ''+utcDate[2]+'-'+utcDate[1]+'-'+utcDate[0]+'T'+timeString.slice(0,2)+':'+timeString.slice(2,4)+':00';
            var dateObj = new Date(dateString);
            forecast.dateObj = dateObj;

            forecast.desc = frame.wx_desc;
            forecast.code = parseInt(frame.wx_code);
            forecast.tmp = parseFloat(frame.temp_c);
            forecast.tmp_f = parseFloat(frame.temp_f);
            forecast.ftmp = parseFloat(frame.feelslike_c);
            forecast.ftmp_f = parseFloat(frame.feelslike_f);
            forecast.winddir = parseInt(frame.winddir_deg);
            forecast.windspd = parseFloat(frame.windspd_ms);
            forecast.windspd_mh = parseFloat(frame.windspd_mph);
            forecast.windgst = parseFloat(frame.windgst_ms);
            forecast.cloudlow = parseInt(frame.cloud_low_pct);
            forecast.cloudmid = parseInt(frame.cloud_mid_pct);
            forecast.cloudhigh = parseInt(frame.cloud_high_pct);
            forecast.cloudtot = parseInt(frame.cloudtotal_pct);
            forecast.precip = parseInt(frame.precip_mm);
            forecast.rain = parseInt(frame.rain_mm);
            forecast.snow = parseInt(frame.snow_mm);
            forecast.fsnow = parseInt(frame.snow_accum_cm);

            // sometimes, the server scnd percent as '<1'. it can't be changed number.
            if(parseInt(frame.prob_precip_pct) != typeof Number){
                forecast.prob = 0
            }else{
                forecast.prob = parseInt(frame.prob_precip_pct);
            }
            forecast.humid = parseInt(frame.humid_pct);
            forecast.dewpoint = parseFloat(frame.dewpoint_c);
            forecast.vis = parseFloat(frame.vis_km);
            forecast.splmax = parseFloat(frame.slp_mb);

            forecastList.push(forecast);
        });

        result.push({summary: summary, forecast:forecastList});
    });

    return result;
};

/**
 *
 * @param src
 * @param date
 * @returns {{date: *, desc: *, code: Number, temp: Number, ftemp: Number, humid: Number, windspd: Number, winddir: Number, cloud: Number, vis: Number, slp: Number, dewpoint: Number}}
 * @private
 */
ConCollector.prototype._parseWuCurrent = function(src, date){
    var self = this;
    var result = {
        dateObj:    self._getDateObj(date),
        date:       date,
        desc:       src.wx_desc,
        code:       parseInt(src.wx_code),
        temp:       parseFloat(src.temp_c),
        temp_f:       parseFloat(src.temp_f),
        ftemp:      parseFloat(src.feelslike_c),
        ftemp_f:      parseFloat(src.feelslike_f),
        humid:      parseInt(src.humid_pct),
        windspd:    parseFloat(src.windspd_ms),
        windspd_mh:    parseFloat(src.windspd_mph),
        winddir:    parseFloat(src.winddir_deg),
        cloud:      parseInt(src.cloudtotal_pct),
        vis:        parseFloat(src.vis_km),
        slp:        parseFloat(src.slp_mb),
        dewpoint:   parseFloat(src.dewpoint_c)
    };
    return result;
};

/**
 *
 * @param newData
 * @param list
 * @returns {*}
 * @private
 */
ConCollector.prototype._addWuCurrentToList = function(newData, list){
    var self = this;
    var isExist = false;

    list.forEach(function(oldData, index){
        if(oldData.date === newData.date){
            self.itemWuCurrent.forEach(function(itemName){
                list[index][itemName] = newData[itemName];
            });

            print.info('updated olditem : ', newData.date);
            isExist = true;
        }
    });

    if(!isExist){
        list.push(newData);
    }
    return list;
};

/**
 *
 * @param self
 * @param list
 * @param date
 * @param isRetry
 * @param callback
 */
ConCollector.prototype.processWuForecast = function(self, list, date, isRetry, callback){
    var failList = [];

    try{
        print.info('WuF> Total count: ', list.length);
        var dividedList = self._divideList(list, self.wuLimitation);
        print.info('WuF> divided count : ', dividedList.length);

        self._getAndSaveWuForecast(dividedList.shift(), date, isRetry, function(err, resultList) {
            failList.concat(resultList);
            if(dividedList.length === 0){
                log.info('WuF> Finish to collect WU forecast');
                callback(0, failList);
                return;
            }
        });

        if(dividedList.length > 0){
            var timer = setInterval(function(){
                print.info('WuF> Do task : ', dividedList.length);
                self._getAndSaveWuForecast(dividedList.shift(), date, isRetry, function(err, resultList){
                    failList.concat(resultList);

                    if(dividedList.length === 0){
                        print.info('WuF> clear interval timer');
                        clearInterval(timer);
                        callback(0, failList);
                        return;
                    }
                });
            }, 60 * 1000);
        }
    }
    catch(e){
        print.error('Exception!!!');
        log.error('WuF> Exception!!!');
        if(callback){
            callback(e);
        }
    }
};

/**
 *
 * @param self
 * @param list
 * @param date
 * @param isRetry
 * @param callback
 */
ConCollector.prototype.processWuCurrent = function(self, list, date, isRetry, callback){
    var failList = [];

    try{
        print.info('WuC> Total count: ', list.length);
        var dividedList = self._divideList(list, self.wuLimitation);
        print.info('WuC> divided count : ', dividedList.length);

        self._getAndSaveWuCurrent(dividedList.shift(), date, isRetry, function(err, resultList) {
            failList.concat(resultList);
            if(dividedList.length === 0){
                log.info('WuC> Finish to collect WU forecast');
                callback(0, failList);
                return;
            }
        });

        if(dividedList.length > 0){
            var timer = setInterval(function(){
                print.info('WuC> Do task : ', dividedList.length);
                self._getAndSaveWuCurrent(dividedList.shift(), date, isRetry, function(err, resultList){
                    failList.concat(resultList);

                    if(dividedList.length === 0){
                        print.info('WuC> clear interval timer');
                        clearInterval(timer);
                        callback(0, failList);
                        return;
                    }
                });
            }, 60 * 1000);
        }
    }
    catch(e){
        print.error('Exception!!!');
        log.error('WuC> Exception!!!');
        if(callback){
            callback(e);
        }
    }
};

/**
 *
 * @param geocode
 * @param date
 * @param data
 * @param callback
 */
ConCollector.prototype.saveWuForecast = function(geocode, date, data, callback){
    var self = this;

    try{
        modelWuForecast.find({geocode:geocode}, function(err, list){
            if(err){
                log.error('WuF> fail to find from DB');
                callback(err);
                return;
            }
            var newData = self._parseWuForecast(data);

            // for debug
            //newData.forEach(function(a){
            //    print.info(a.summary);
            //    a.forecast.forEach(function(b){
            //        print.info(b);
            //    })
            //});

            if(list.length === 0){
                print.info('WuF> First time');
                //var newItem = new modelWuForecast({geocode: geocode, address: {country:'', city:'', zipcode:0, postcode:0}, date:curDate, days: newData});
                var newItem = new modelWuForecast({geocode:geocode, address:{}, date:date, dateObj: self._getDateObj(date), days:newData});
                newItem.save(function(err){
                    if(err){
                        log.error('WuF> fail to add the new data to DB :', geocode);
                        print.error('WuF> fail to add the new data to DB :', geocode);
                    }
                    if(callback){
                        callback(err, newData);
                    }
                });
                //print.info('WuF> add new Item : ', newData);
            }else{
                list.forEach(function(data, index){
                    data.date = date;
                    data.days = [];
                    data.days = newData;
                    data.dateObj = self._getDateObj(date);

                    //log.info(data);
                    data.save(function(err){
                        if(err){
                            log.error('WuF> fail to save to DB :', geocode);
                        }

                        if(callback){
                            callback(err, newData);
                        }
                    });
                });
            }
        });
    }catch(e){
        log.error('WuF> Exception!!!');
        if(callback){
            callback(e);
        }
    }
};

/**
 *
 * @param geocode
 * @param date
 * @param data
 * @param callback
 */
ConCollector.prototype.saveWuCurrent = function(geocode, date, data, callback){
    var self = this;

    try{
        modelWuCurrent.find({geocode:geocode}, function(err, list){
            if(err){
                log.error('WuC> fail to find from DB');
                callback(err);
                return;
            }
            var newData = self._parseWuCurrent(data, date);

            // for debug
            //print.info(newData);

            if(list.length === 0){
                var dataList = [];
                dataList.push(newData);
                print.info('WuC> First time');
                var newItem = new modelWuCurrent({geocode:geocode, address:{}, date:date, dateObj: self._getDateObj(date),dataList:dataList});
                newItem.save(function(err){
                    if(err){
                        log.error('WuC> fail to add the new data to DB :', geocode);
                        print.error('WuC> fail to add the new data to DB :', geocode);
                    }
                    if(callback){
                        callback(err, newData);
                    }
                });
                //print.info('WuC> add new Item : ', newData);
            }else{
                list.forEach(function(data, index){
                    data.date = date;
                    data.dateObj = self._getDateObj(date);
                    data.dataList = self._addWuCurrentToList(newData, data.dataList);

                    data.dataList.sort(function(a, b){
                        if(a.date > b.date){
                            return 1;
                        }
                        if(a.date < b.date){
                            return -1;
                        }
                        return 0;
                    });

                    if(data.dataList.length > self.MAX_WU_COUNT){
                        data.dataList.shift();
                    }
                    //log.info(data);
                    data.save(function(err){
                        if(err){
                            log.error('WuC> fail to save to DB :', geocode);
                        }

                        if(callback){
                            callback(err, newData);
                        }
                    });
                });
            }
        });
    }catch(e){
        log.error('WuF> Exception!!!');
        if(callback){
            callback(e);
        }
    }
};

/**
 *
 * @param geocode
 * @param callback
 */
ConCollector.prototype.requestWuData = function(geocode, callback){
    var self = this;
    var date = parseInt(self._getTimeString(0).slice(0,10) + '00');
    var requester = new wuRequester;

    async.waterfall([
            function(cb){
                // get forecast
                requester.getForecast(geocode, self._getWuKey(), function(err, result){
                    if(err){
                        print.error('rWuD> Fail to requestWuData on Forecast');
                        log.error('rWuD> Fail to requestWuData on Forecast');
                        cb('rWuD> Fail to requestWuData on Forecast');
                        return;
                    }

                    log.info('WU Forecase : ', result);
                    self.saveWuForecast(geocode, date, result, function(err, forecastData){
                        cb(undefined, 1);
                    });
                });
            },
            function(forecastData, cb){
                // get current
                var wuData = {
                    forecast: forecastData,
                    current: {}
                };
                requester.getCurrent(geocode, self._getWuKey(), function(err, result){
                    if(err){
                        print.error('rWuD> fail to requestWuData on Current');
                        log.error('rWuD> fail to requestWuData on Current');
                        cb('rWuD> fail to requestWuData on Current', wuData);
                        return;
                    }

                    log.info('WU Current : ', result);
                    self.saveWuCurrent(geocode, date, result, function(err, currentData){
                        cb(undefined, 1);
                    });
                });
            }
        ],
        function(err, wuData){
            if(err){
                log.error(err);
            }

            if(wuData){
                callback(err, wuData);
            }else{
                callback(err);
            }
        }
    );
};
/**************************************************************************************/
/* DSF Module
/**************************************************************************************/
/**
 *
 * @returns {{key: string}}
 * @private
 */
ConCollector.prototype._getDSFKey = function(){
    var self = this;
    return self.cKeys.getDsfKey();
};

/**
 *
 * @param src
 * @returns {string}
 * @private
 */
ConCollector.prototype._convertTimeToDate = function(src){
    var self = this;
    var date = new Date();
    date.setTime(src);

    var result =
        self._leadingZeros(date.getFullYear(), 4) +
        self._leadingZeros(date.getMonth() + 1, 2) +
        self._leadingZeros(date.getDate(), 2) +
        self._leadingZeros(date.getHours(), 2) +
        self._leadingZeros(date.getMinutes(), 2);

    return result;
};

/**
 *
 * @param src
 * @returns {*}
 * @private
 */
ConCollector.prototype._getFloatItem = function(src){
    if(src == undefined){
        return -100;
    }else {
        return parseFloat(src);
    }
};

/**
 *
 * @param src
 * @returns {{current: {}, hourly: {summary: string, data: Array}, daily: {summary: string, data: Array}}}
 * @private
 */
ConCollector.prototype._parseDSForecast = function(src){
    var self = this;
    var result = {
        current: {},
        hourly: {
            summary:'',
            data:[]
        },
        daily: {
            summary:'',
            data:[]
        }
    };

    // Currently data
    if(src.currently){
        var date = new Date();
        date.setTime(src.currently.time + '000');

        result.current.dateObj = self._getUtcTime(src.currently.time + '000');
        result.current.date = parseInt(self._convertTimeToDate(src.currently.time + '000'));
        result.current.summary = src.currently.summary;
        result.current.pre_int = self._getFloatItem(src.currently.precipIntensity);
        result.current.pre_pro = self._getFloatItem(src.currently.precipProbability);
        if(src.currently.precipType){
            result.current.pre_type = src.currently.precipType;
        }
        result.current.temp = self._getFloatItem(src.currently.temperature);
        result.current.ftemp = self._getFloatItem(src.currently.apparentTemperature);
        result.current.humid = self._getFloatItem(src.currently.humidity);
        result.current.windspd = self._getFloatItem(src.currently.windSpeed);
        result.current.winddir = self._getFloatItem(src.currently.windBearing);
        result.current.vis = self._getFloatItem(src.currently.visibility);
        result.current.cloud = self._getFloatItem(src.currently.cloudCover);
        result.current.pres = self._getFloatItem(src.currently.pressure);
        result.current.oz = self._getFloatItem(src.currently.ozone);
    }

    // hourly data
    if(src.hourly){
        result.hourly.summary = src.hourly.summary;
        src.hourly.data.forEach(function(item){
            var hourlyData = {};

            hourlyData.dateObj = self._getUtcTime(item.time + '000');
            hourlyData.date = parseInt(self._convertTimeToDate(item.time + '000'));
            if(item.summary){
                hourlyData.summary = item.summary;
            }
            hourlyData.pre_int = self._getFloatItem(item.precipIntensity);
            hourlyData.pre_pro = self._getFloatItem(item.precipProbability);
            if(item.precipType){
                hourlyData.pre_type = item.precipType;
            }
            hourlyData.temp = self._getFloatItem(item.temperature);
            hourlyData.ftemp = self._getFloatItem(item.apparentTemperature);
            hourlyData.humid = self._getFloatItem(item.humidity);
            hourlyData.windspd = self._getFloatItem(item.windSpeed);
            hourlyData.winddir = self._getFloatItem(item.windBearing);
            hourlyData.vis = self._getFloatItem(item.visibility);
            hourlyData.cloud = self._getFloatItem(item.cloudCover);
            hourlyData.pres = self._getFloatItem(item.pressure);
            hourlyData.oz = self._getFloatItem(item.ozone);

            result.hourly.data.push(hourlyData);
        });
    }

    if(src.daily){
        result.daily.summary = src.daily.summary;
        src.daily.data.forEach(function(item, index){
            var dailyData = {};

            dailyData.dateObj = self._getUtcTime(item.time + '000');
            dailyData.date = parseInt(self._convertTimeToDate(item.time + '000'));
            dailyData.summary = item.summary;
            dailyData.sunrise = parseInt(self._convertTimeToDate(item.sunriseTime + '000'));
            dailyData.sunrset = parseInt(self._convertTimeToDate(item.sunsetTime + '000'));
            dailyData.moonphase = self._getFloatItem(item.moonPhase);
            dailyData.pre_int = self._getFloatItem(item.precipIntensity);
            dailyData.pre_intmax = self._getFloatItem(item.precipIntensityMax);
            dailyData.pre_intmaxt = parseInt(self._convertTimeToDate(item.precipIntensityMaxTime + '000'));
            dailyData.pre_pro = self._getFloatItem(item.precipProbability);
            if(item.precipType){
                dailyData.pre_type = item.precipType;
            }
            dailyData.temp_min = self._getFloatItem(item.temperatureMin);
            dailyData.temp_mint = parseInt(self._convertTimeToDate(item.temperatureMinTime + '000'));
            dailyData.temp_max = self._getFloatItem(item.temperatureMax);
            dailyData.temp_maxt = parseInt(self._convertTimeToDate(item.temperatureMaxTime + '000'));
            dailyData.ftemp_min = self._getFloatItem(item.apparentTemperatureMin);
            dailyData.ftemp_mint = parseInt(self._convertTimeToDate(item.apparentTemperatureMinTime + '000'));
            dailyData.ftemp_max = self._getFloatItem(item.apparentTemperatureMax);
            dailyData.ftemp_maxt = parseInt(self._convertTimeToDate(item.apparentTemperatureMaxTime + '000'));
            dailyData.humid = self._getFloatItem(item.humidity);
            dailyData.windspd = self._getFloatItem(item.windSpeed);
            dailyData.winddir = self._getFloatItem(item.windBearing);
            dailyData.vis = self._getFloatItem(item.visibility);
            dailyData.cloud = self._getFloatItem(item.cloudCover);
            dailyData.pres = self._getFloatItem(item.pressure);
            dailyData.oz = self._getFloatItem(item.ozone);

            result.daily.data.push(dailyData);
        });
    }

    return result;
};

/**
 *
 * @param geocode
 * @param date
 * @param data
 * @param callback
 */
ConCollector.prototype.saveDSForecast = function(geocode, date, data, callback){
    var self = this;

    try{
        modelDSForecast.find({geocode:geocode}, function(err, list){
            if(err){
                log.error('Dsf> fail to find from DB');
                callback(err);
                return;
            }
            var newData = self._parseDSForecast(data);
            var timeOffset = -100;
            var weatherData = [];
            weatherData.push({
                current : newData.current,
                hourly : newData.hourly,
                daily: newData.daily
            });
            // for debug
            //log.info('C> ', newData.current);
            //log.info('H> ', newData.hourly.summary);
            //newData.hourly.data.forEach(function(item){
            //    log.info('H> ', item);
            //});
            //log.info('D> ',newData.daily.summary);
            //newData.daily.data.forEach(function(item){
            //    log.info('D> ',item);
            //});

            if(data.offset){
                timeOffset = parseInt(data.offset);
            }
            if(list.length === 0){
                print.info('Dsf> First time');
                var newItem = new modelDSForecast({geocode:geocode,
                                                    address:{},
                                                    date:date,
                                                    dateObj: self._getUtcTime(''+date +'000'),
                                                    timeoffset:timeOffset,
                                                    data : weatherData
                });
                newItem.save(function(err){
                    if(err){
                        log.error('Dsf> fail to add the new data to DB :', geocode, err);
                        print.error('Dsf> fail to add the new data to DB :', geocode);
                    }
                    if(callback){
                        callback(err, newData);
                    }
                });
                //print.info('WuF> add new Item : ', newData);
            }else{
                list.forEach(function(data, index){
                    var isExist = false;
                    if(data.date < date){
                        data.date = date;
                    }
                    var pubDate = self._getUtcTime('' + date +'000');
                    if(data.dateObj.getTime() < pubDate.getTime()){
                        data.dateObj = pubDate;
                    }
                    data.data.forEach(function(dbItem){
                        if(dbItem.current.dateObj.getYear() === newData.current.dateObj.getYear() &&
                            dbItem.current.dateObj.getMonth() === newData.current.dateObj.getMonth() &&
                            dbItem.current.dateObj.getDay() === newData.current.dateObj.getDay() &&
                            dbItem.current.dateObj.getHours() === newData.current.dateObj.getHours()) {
                            dbItem.current = newData.current;
                            dbItem.hourly = newData.hourly;
                            dbItem.daily = newData.daily;
                            isExist = true;
                        }
                    });

                    if(!isExist){
                        data.data.push({
                            current : newData.current,
                            hourly : newData.hourly,
                            daily: newData.daily
                        });
                    }

                    data.data.sort(function(a, b){
                        if(a.current.date > b.current.date){
                            return 1;
                        }
                        if(a.current.date < b.current.date){
                            return -1;
                        }
                        return 0;
                    });

                    if(data.data.length > self.MAX_DSF_COUNT){
                        data.data.shift();
                    }

                    //log.info(data);
                    data.save(function(err){
                        if(err){
                            log.error('Dsf> fail to save to DB :', geocode);
                        }

                        if(callback){
                            callback(err, newData);
                        }
                    });
                });
            }
        });
    }catch(e){
        log.error('Dsf> Exception!!!');
        if(callback){
            callback(e);
        }
    }
};

/**
 *
 * @param list
 * @param key
 * @param date
 * @param retryCount
 * @param callback
 * @private
 */
ConCollector.prototype._getAndSaveDSForecast = function(list, date, retryCount, callback){
    var self = this;
    var failList = [];

    if(list.length === 0){
        log.info('Dsf> There is no geocode');
        callback(0, failList);
        return;
    }

    async.mapSeries(list,
        function(location, cb){
            var requester = new dsfRequester;
            var geocode = {
                lat: parseFloat(location.lat),
                lon: parseFloat(location.lon)
            };

            modelDSForecast.find({geocode:geocode}, function(err, list){
                if(err){
                    log.error('Dsf> _getAndSaveWuForecast : Fail to get DB');
                    print.error('Dsf> _getAndSaveWuForecast : Fail to get DB');
                    cb(null);
                    return;
                }

                if(list.length != 0 && date != 0){
                    list.forEach(function(item){
                        // TODO : compare between date parameter and DB's date.
                    });
                }

                requester.getForecast(geocode, undefined, self._getDSFKey().key, function(err, result){
                    if(err){
                        print.error('Dsf> get fail', location);
                        log.error('Dsf> get fail', location);
                        failList.push(location);
                        cb(null);
                        return;
                    }

                    log.info(result);
                    self.saveDSForecast(geocode, date, result, function(err){
                        cb(null);
                    });
                });
            });
        },
        function(err){
            if(err){
                log.error('Dsf> ');
            }

            if(retryCount > 0){
                return self._getAndSaveDSForecast(failList, date, --retryCount, callback);
            }else{
                callback(err, failList);
                return;
            }
        }
    );
};

/**
 *
 * @param self
 * @param list
 * @param date : NOTE!!! : UCT timestring
 * @param isRetry
 * @param callback
 */
ConCollector.prototype.processDSForecast = function(self, list, date, isRetry, callback){
    var failList = [];

    try{
        print.info('Dsf> Total count: ', list.length);
        var dividedList = self._divideList(list, self.wuLimitation);
        print.info('Dsf> divided count : ', dividedList.length);

        self._getAndSaveDSForecast(dividedList.shift(), date, isRetry, function(err, resultList) {
            failList.concat(resultList);
            if(dividedList.length === 0){
                log.info('Dsf> Finish to collect WU forecast');
                callback(0, failList);
                return;
            }
        });

        if(dividedList.length > 0){
            var timer = setInterval(function(){
                print.info('Dsf> Do task : ', dividedList.length);
                self._getAndSaveDSForecast(dividedList.shift(), date, isRetry, function(err, resultList){
                    failList.concat(resultList);

                    if(dividedList.length === 0){
                        print.info('Dsf> clear interval timer');
                        clearInterval(timer);
                        callback(0, failList);
                        return;
                    }
                });
            }, 60 * 1000);
        }
    }
    catch(e){
        print.error('Exception!!!');
        log.error('Dsf> Exception!!!');
        if(callback){
            callback(e);
        }
    }
};

/**
 *
 * @param geocode
 * @param callback
 */
ConCollector.prototype.requestDsfData = function(geocode, From, To, callback){
    var self = this;
    var key = self._getDSFKey().key;
    var dataList = [];
    var requester = new dsfRequester;

    for(var i=From ; i<To ; i++){
        var dateString = self._getTimeString(0 - (24 * i)).slice(0,10) + '00';
        var now = self._getDateObj(dateString).getTime() / 1000;
        dataList.push(now);
    }
    dataList.push('cur');

    async.mapSeries(dataList,
        function(date, cb){
            // get forecast
            log.info('date : ', date);
            if(date === 'cur'){
                date = undefined;
            }
            requester.getForecast(geocode, date, key, function(err, result){
                if(err){
                    print.error('Req Dsf> get fail', geocode);
                    log.error('Req Dsf> get fail', geocode);
                    cb(null);
                    return;
                }

                log.info(result);
                if(date === undefined){
                    var dateString = self._getTimeString(0).slice(0,10) + '00';
                    date = self._getDateObj(dateString).getTime() / 1000;
                }
                self.saveDSForecast(geocode, date, result, function(err){
                    cb(null, result);
                });
            });
        },
        function(err, DsfData){
            if(err){
                log.error(err);
            }

            if(DsfData){
                callback(err, DsfData);
            }else{
                callback(err);
            }
        }
    );
};

/**************************************************************************************/

/**
 *
 * @param funcList
 * @param date
 * @param isRetry
 * @param callback
 */
ConCollector.prototype.collectWeather = function(funcList, date, isRetry, callback){
    var self = this;

    try{
        async.waterfall([
                function(first_cb){
                    // 1. get location list which contains either geocode or city name.
                    self._getGeocodeList(modelGeocode, function(err, list){
                        if(err){
                            log.error('Fail to get geocode list');
                            first_cb('fail:_getGeocodeList');
                            return;
                        }

                        log.info('Success to get geocode List : ', list.length);
                        first_cb(undefined, list);
                    });
                },
                function(geocodeList, first_cb){

                    async.mapSeries(funcList,
                        function(funcCollector, sec_cb){
                            funcCollector(self, geocodeList, date, isRetry, function(err, failList){
                                if(err){
                                    var errString = 'Fail to funcCollect[' + funcList.indexOf(funcCollector) + ']';
                                    log.error(errString);
                                    // it always return success, even though there is error to get data,
                                    sec_cb(null);
                                    return;
                                }
                                sec_cb(null);
                                return;
                            });
                        },
                        function(sec_err){
                            if(sec_err){
                                log.error('Collecting is not completed!! : ', sec_err);
                                first_cb('fail:collecting');
                                return;
                            }
                            log.info('Collecting is completed!!');
                            first_cb(null);
                        }
                    );

                }
            ],
            function(first_err){
                if(first_err){
                    log.error('Something was wrong:', first_err);
                }
                log.info('Finish : collectWeather');
                callback(first_err);
            }
        );
    }catch(e){
        log.error('Exception!!!');
        if(callback){
            callback(e);
        }
    }
};

/**
 *
 * @param isAll
 * @param callback
 */
ConCollector.prototype.runTask = function(isAll, callback){
    var self = this;
    var minute = (new Date()).getUTCMinutes();
    var funcList = [];

    log.silly('RT> check collector based on the minute : ', minute);

    if(minute === 30 || isAll){
        funcList.push(self.processWuCurrent);
    }

    if(minute === 1 || isAll){
        funcList.push(self.processWuForecast);
    }

    var date = parseInt(self._getTimeString(0).slice(0,10) + '00');

    if(funcList.length > 0){
        log.info('rT> run task:', funcList.length, date);
        self.collectWeather(funcList, date, 2, function(err){
            if(err){
                log.error('RT> Something is wrong!!!');
                return;
            }

            log.info('RT>  Complete to collect weather data : ', self._getTimeString(0));

            if(callback){
                callback(err);
            }
        });
    }
};

/**
 *
 */
ConCollector.prototype.doCollect = function(){
    var self = this;

    if(global.collector === undefined){
        global.collector = self;
    }

    self.runTask(true);
    setInterval(function() {
        self.runTask(false);
    }, 1000*60);


};

module.exports = ConCollector;
