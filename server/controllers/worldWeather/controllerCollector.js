/**
 * Created by Peter on 2016. 5. 29..
 */
"use strict";

var print = require('tracer').colorConsole({level:'info'});

var fs = require('fs');
var async = require('async');

var modelGeocode = require('../../models/worldWeather/modelGeocode');
var modelWuForecast = require('../../models/worldWeather/modelWuForecast');

var config = require('../../config/config');
var metRequester = require('../../lib/MET/metRequester');
var owmRequester = require('../../lib/OWM/owmRequester');
var wuRequester = require('../../lib/WU/wuRequester');


function ConCollector() {
    var self = this;

    self.keybox = config.keyString;
}

ConCollector.prototype.leadingZeros = function(n, digits) {
    var zero = '';
    n = n.toString();

    if(n.length < digits) {
        for(var i = 0; i < digits - n.length; i++){
            zero += '0';
        }
    }
    return zero + n;
};

ConCollector.prototype.getTimeString = function(tzOffset) {
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
        self.leadingZeros(now.getFullYear(), 4) +
        self.leadingZeros(now.getMonth() + 1, 2) +
        self.leadingZeros(now.getDate(), 2) +
        self.leadingZeros(now.getHours(), 2) +
        self.leadingZeros(now.getMinutes(), 2);

    return result;
};

ConCollector.prototype.collectWeather = function(funcList, isRetry, callback){
    var self = this;

    try{
        async.waterfall([
                function(first_cb){
                    // 1. get location list which contains either geocode or city name.
                    self.getGeocodeList(modelGeocode, function(err, list){
                        if(err){
                            print.error('Fail to get geocode list');
                            first_cb('fail:getGeocodeList');
                            return;
                        }

                        first_cb(undefined, list);
                    });
                },
                function(geocodeList, first_cb){

                    async.mapSeries(funcList,
                        function(funcCollector, sec_cb){
                            funcCollector(geocodeList, isRetry, function(err, failList){
                                if(err){
                                    var errString = 'Fail to funcCollect[' + funcList.indexOf(funcCollector) + ']';
                                    print.error(errString);
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
                                print.error('Collecting is not completed!! : ', sec_err);
                                first_cb('fail:collecting');
                                return;
                            }
                            print.info('Collecting is completed!!');
                            first_cb(null);
                        }
                    );

                }
            ],
            function(first_err){
                if(first_err){
                    print.error('Something was wrong:', first_err);
                }
                print.info('Finish : collectWeather');
                callback(first_err);
            }
        );
    }catch(e){
        print.error('Exception!!!');
        if(callback){
            callback(e);
        }
    }
};

ConCollector.prototype.getGeocodeList = function(db, callback){
    db.getGeocode(function(err, resultList){
        if(err){
            print.error('Fail to get geocode');
        }
        callback(err, resultList);
    });
};

ConCollector.prototype.processWuForecast = function(list, isRetry, callback){
    var self = this;
    var key = self.getWuKey();
    var failList = [];

    if(list.length === 0){
        print.info('WuF> There is no geocode');
        callback(0, failList);
        return;
    }
    try{
        async.mapSeries(list,
            function(location, cb){
                var requester = new wuRequester;
                requester.getForecast(location.geocode, key, function(err, result){
                    if(err){
                        print.error('WuF> get fail', location);
                        failList.push(location);
                        cb(null);
                        return;
                    }

                    log.info(result);
                    self.saveWuForecast(location.geocode, result, function(err){
                        cb(null);
                    })
                });
            },
            function(err){
                if(err){
                    print.error('');
                }

                if(isRetry > 0){
                    return self.processWuForecast(failList, --isRetry, callback);
                }else{
                    callback(err, failList);
                    return;
                }
            }
        );
    }
    catch(e){
        print.error('Exception!!!');
        if(callback){
            callback(e);
        }
    }
};

ConCollector.prototype.processWuCurrent = function(list, callback){
    var self = this;
};

ConCollector.prototype.makeDefaultWuSummary = function(){
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

ConCollector.prototype.makeDefaultWuForecast = function(){
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

ConCollector.prototype.parseWuForecast = function(src){
    var self = this;
    var result = [];

    src.Days.forEach(function(day, index){
        var summary = {};
        var forecastList = [];

        summary = self.makeDefaultWuSummary();

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
        summary.windspdmax = parseInt(day.windspd_max_ms);
        summary.windgstmax = parseInt(day.windgst_max_ms);
        summary.slpmax = parseInt(day.slp_max_mb);
        summary.slpmin = parseInt(day.slp_min_mb);

        day.Timeframes.forEach(function(frame, idx){
            var forecast = {};

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
            forecast.windspd = parseInt(frame.windspd_ms);
            forecast.windgst = parseInt(frame.windgst_ms);
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
            forecast.dewpoint = parseInt(frame.dewpoint_c);
            forecast.vis = parseInt(frame.vis_km);
            forecast.splmax = parseInt(frame.slp_mb);

            forecastList.push(forecast);
        });

        result.push({summary: summary, forecast:forecastList});
    });

    return result;
};

ConCollector.prototype.saveWuForecast = function(geocode, data, callback){
    var self = this;

    try{
        modelWuForecast.find({geocode:geocode}, function(err, list){
            if(err){
                print.error('WuF> fail to find from DB');
                callback(err);
                return;
            }

            var curDate = parseInt(self.getTimeString());
            var newData = self.parseWuForecast(data);

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
                var newItem = new modelWuForecast({geocode:geocode, address:{}, days:newData});
                newItem.save(function(err){
                    if(err){
                        log.error('WuF> fail to add the new data to DB :', geocode);
                    }
                    if(callback){
                        callback(err);
                    }
                });
                //print.info('WuF> add new Item : ', newData);
            }else{
                list.forEach(function(data, index){
                    data.date = curDate;
                    data.days = [];
                    data.days = newData;
                    //log.info(data);
                    data.save(function(err){
                        if(err){
                            log.error('WuF> fail to save to DB :', geocode);
                        }

                        if(callback){
                            callback(err);
                        }
                    });
                });
            }
        });
    }catch(e){
        print.error('WuF> Exception!!!');
        if(callback){
            callback(e);
        }
    }
};

ConCollector.prototype.saveWuCurrent = function(){
    var self = this;
};

ConCollector.prototype.getWuKey = function(){
    var self = this;
    return {id: self.keybox.wu_id, key: self.keybox.wu_key};
};

module.exports = ConCollector;
