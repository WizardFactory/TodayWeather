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

var config = require('../../config/config');
var metRequester = require('../../lib/MET/metRequester');
var owmRequester = require('../../lib/OWM/owmRequester');
var wuRequester = require('../../lib/WU/wuRequester');


function ConCollector() {
    var self = this;

    self.keybox = config.keyString;
    self.wuLimitation = 80;  // there is limitation to get 100 datas for a mimute from WU server.

    self.itemWuCurrent = ['date', 'desc', 'code', 'tmmp', 'ftemp', 'humid', 'windspd', 'winddir', 'cloud', 'vis', 'slp', 'dewpoint'];
}

ConCollector.prototype._getWuKey = function(){
    var self = this;
    return {id: self.keybox.wu_id, key: self.keybox.wu_key};
};

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

    var tz = now.getTime() + (now.getTimezoneOffset() * 60000) + (offset * 3600000);
    now.setTime(tz);

    result =
        self._leadingZeros(now.getFullYear(), 4) +
        self._leadingZeros(now.getMonth() + 1, 2) +
        self._leadingZeros(now.getDate(), 2) +
        self._leadingZeros(now.getHours(), 2) +
        self._leadingZeros(now.getMinutes(), 2);

    return result;
};


ConCollector.prototype._getGeocodeList = function(db, callback){
    db.getGeocode(function(err, resultList){
        if(err){
            log.error('Fail to get geocode');
        }
        callback(err, resultList);
    });
};

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

ConCollector.prototype._getAndSaveWuForecast = function(list, key, date, retryCount, callback){
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

                requester.getForecast(geocode, key, function(err, result){
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
                return self._getAndSaveWuForecast(failList, key, date, --retryCount, callback);
            }else{
                callback(err, failList);
                return;
            }
        }
    );
};


ConCollector.prototype._getAndSaveWuCurrent = function(list, key, date, retryCount, callback){
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

                requester.getCurrent(geocode, key, function(err, result){
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
                return self._getAndSaveWuCurrent(failList, key, date, --retryCount, callback);
            }else{
                callback(err, failList);
                return;
            }
        }
    );
};

ConCollector.prototype._parseWuForecast = function(src){
    var self = this;
    var result = [];

    src.Days.forEach(function(day, index){
        var summary = {};
        var forecastList = [];

        summary = self._makeDefaultWuSummary();

        var dayDate = day.date.split('/');
        dayDate = parseInt(''+dayDate[2]+dayDate[1]+dayDate[0]);

        summary.date = dayDate;
        summary.sunrise = parseInt(day.sunrise_time.replace(':',''));
        summary.sunset = parseInt(day.sunset_time.replace(':',''));
        summary.moonrise = parseInt(day.moonrise_time.replace(':',''));
        summary.moonset = parseInt(day.moonset_time.replace(':',''));
        summary.tmax = parseFloat(day.temp_max_c);
        summary.tmin = parseFloat(day.temp_min_c);
        summary.precip = parseInt(day.precip_total_mm);
        summary.rain = parseInt(day.rain_total_mm);
        summary.snow = parseInt(day.snow_total_mm);
        summary.prob = parseInt(day.prob_precip_pct);
        summary.humax = parseInt(day.humid_max_pct);
        summary.humin = parseInt(day.humid_min_pct);
        summary.windspdmax = parseFloat(day.windspd_max_ms);
        summary.windgstmax = parseFloat(day.windgst_max_ms);
        summary.slpmax = parseFloat(day.slp_max_mb);
        summary.slpmin = parseFloat(day.slp_min_mb);

        day.Timeframes.forEach(function(frame, idx){
            var forecast = self._makeDefaultWuForecast();

            var frameDate = frame.date.split('/');
            frameDate = parseInt(''+frameDate[2]+frameDate[1]+frameDate[0]);

            forecast.date = frameDate;
            forecast.time = parseInt(frame.time);

            var utcDate = frame.utcdate.split('/');
            utcDate = parseInt(''+utcDate[2]+utcDate[1]+utcDate[0]);

            forecast.utcDate = utcDate;
            forecast.utcTime = parseInt(frame.utctime);
            forecast.desc = frame.wx_desc;
            forecast.code = parseInt(frame.wx_code);
            forecast.tmp = parseFloat(frame.temp_c);
            forecast.ftmp = parseFloat(frame.feelslike_c);
            forecast.winddir = parseInt(frame.winddir_deg);
            forecast.windspd = parseFloat(frame.windspd_ms);
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

ConCollector.prototype._parseWuCurrent = function(src, date){
    var self = this;
    var result = {
        date:       date,
        desc:       src.wx_desc,
        code:       parseInt(src.wx_code),
        temp:       parseFloat(src.temp_c),
        ftemp:      parseFloat(src.feelslike_c),
        humid:      parseInt(src.humid_pct),
        windspd:    parseFloat(src.windspd_ms),
        winddir:    parseFloat(src.winddir_deg),
        cloud:      parseInt(src.cloudtotal_pct),
        vis:        parseFloat(src.vis_km),
        slp:        parseFloat(src.slp_mb),
        dewpoint:   parseFloat(src.dewpoint_c)
    };
    return result;
};

ConCollector.prototype._addWuCurrentToList = function(newData, list){
    var self = this;

    list.forEach(function(oldData, index){
        if(oldData.date === newData.date){
            self.itemWuCurrent.forEach(function(itemName){
                list[index][itemName] = newData[itemName];
            });

            print.info('updated olditem : ', newData.date);
        }
    });

    list.push(newData);

    return list;
};

ConCollector.prototype.processWuForecast = function(self, list, date, isRetry, callback){
    var key = self._getWuKey();
    var failList = [];

    try{
        print.info('WuF> Total count: ', list.length);
        var dividedList = self._divideList(list, self.wuLimitation);
        print.info('WuF> divided count : ', dividedList.length);

        self._getAndSaveWuForecast(dividedList.shift(), key, date, isRetry, function(err, resultList) {
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
                self._getAndSaveWuForecast(dividedList.shift(), key, date, isRetry, function(err, resultList){
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

ConCollector.prototype.processWuCurrent = function(self, list, date, isRetry, callback){
    var key = self._getWuKey();
    var failList = [];

    try{
        print.info('WuC> Total count: ', list.length);
        var dividedList = self._divideList(list, self.wuLimitation);
        print.info('WuC> divided count : ', dividedList.length);

        self._getAndSaveWuCurrent(dividedList.shift(), key, date, isRetry, function(err, resultList) {
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
                self._getAndSaveWuCurrent(dividedList.shift(), key, date, isRetry, function(err, resultList){
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
                var newItem = new modelWuForecast({geocode:geocode, address:{}, date:date, days:newData});
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
                var newItem = new modelWuCurrent({geocode:geocode, address:{}, date:date, dataList:dataList});
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

                    if(data.dataList.length > 72){
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

ConCollector.prototype.requestWuData = function(geocode, callback){
    var self = this;
    var date = parseInt(self._getTimeString(9).slice(0,10) + '00');
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

                    log.info(result);
                    self.saveWuForecast(geocode, date, result, function(err, forecastData){
                        cb(undefined, forecastData);
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

                    log.info(result);
                    self.saveWuCurrent(geocode, date, result, function(err, currentData){
                        wuData.current = currentData;
                        cb(undefined, wuData);
                    });
                });
            }
        ],
        function(err, wuData){
            if(err){
                log.err(err);
            }

            if(wuData){
                callback(err, wuData);
            }else{
                callback(err);
            }
        }
    );
};

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

ConCollector.prototype.runTask = function(isAll, callback){
    var self = this;
    var minute = (new Date()).getUTCMinutes();
    var funcList = [];

    log.info('RT> check collector based on the minute : ', minute);

    if(minute === 30 || isAll){
        funcList.push(self.processWuCurrent);
    }

    if(minute === 1 || isAll){
        funcList.push(self.processWuForecast);
    }

    var date = parseInt(self._getTimeString(9).slice(0,10) + '00');
    print.info('rT> Cur date : ', date);

    if(funcList.length > 0){
        self.collectWeather(funcList, date, 2, function(err){
            if(err){
                log.error('RT> Something is wrong!!!');
                return;
            }

            log.info('RT>  Complete to collect weather data : ', self._getTimeString(9));

            if(callback){
                callback(err);
            }
        });
    }
};

ConCollector.prototype.doCollect = function(){
    var self = this;

    global.collector = self;

    self.runTask(true);
    setInterval(function() {
        self.runTask(false);
    }, 1000*60);


};

module.exports = ConCollector;
