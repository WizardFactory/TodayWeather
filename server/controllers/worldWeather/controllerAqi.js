/**
 * Created by Peter on 2017. 6. 5..
 */
"use strict";

var fs = require('fs');
var async = require('async');

var modelAqi = require('../../models/worldWeather/modelAqi');

var config = require('../../config/config');
var controllerKeys = require('./controllerKeys');
var aqiRequester = require('../../lib/AQI/aqiRequester');
var controllerCollector = require('./controllerCollector');

function controllerAqi() {
    var self = this;

    self.cKeys = new controllerKeys();
}

controllerAqi.prototype._getAQIKey = function(){
    var self = this;
    return self.cKeys.getAqiKey();
};

/**
 *
 * @param time
 * @returns {Date|global.Date}
 * @private
 */
controllerAqi.prototype._getUtcTime = function(time) {
    var now = new Date();

    now.setTime(time);

    return now;
};

controllerAqi.prototype._getDiffDate = function (utcTime, localTime) {
    if (utcTime.getUTCFullYear() < localTime.getUTCFullYear()) {
        return 1;
    }
    else if (utcTime.getUTCFullYear() > localTime.getUTCFullYear()) {
        return -1;
    }
    else if (utcTime.getUTCFullYear() == localTime.getUTCFullYear()) {
        if (utcTime.getUTCMonth() < localTime.getUTCMonth()) {
            return 1;
        }
        else if (utcTime.getUTCMonth() > localTime.getUTCMonth()) {
            return -1;
        }
        else if (utcTime.getUTCMonth() == localTime.getUTCMonth()) {
            if (utcTime.getUTCDate() < localTime.getUTCDate()) {
                return 1;
            }
            else if (utcTime.getUTCDate() > localTime.getUTCDate()) {
                return -1;
            }
            else if (utcTime.getUTCDate() == localTime.getUTCDate()) {
                return 0;
            }
        }
    }
    log.error("Invalid time");
    return 0;
};
/**
 *
 * @param timeOffset
 * @returns {Date|global.Date}
 * @private
 */
controllerAqi.prototype._getLocalLast0H = function (timeOffset) {
    var utcTime = new Date();
    var localTime = new Date();
    localTime.setUTCMinutes(localTime.getUTCMinutes()+timeOffset);

    var diffDate = this._getDiffDate(utcTime, localTime);
    if (diffDate == 0) {
        log.info('same day');
    }
    else if (diffDate == 1) {
        log.info('next day');
        utcTime.setUTCDate(utcTime.getUTCDate()+1);
    }
    else if (diffDate == -1) {
        log.info('previous day');
        utcTime.setUTCDate(utcTime.getUTCDate()-1);
    }
    utcTime.setUTCHours(0);
    utcTime.setUTCMinutes(0);
    utcTime.setUTCSeconds(0);
    utcTime.setUTCMilliseconds(0);
    utcTime.setUTCMinutes(-timeOffset);

    return utcTime;
};

controllerAqi.prototype._removeAllAqiDb = function(geocode, callback){
    var geo = [];

    geo.push(parseFloat(geocode.lon));
    geo.push(parseFloat(geocode.lat));

    modelAqi.remove({geo:geo}).lean().exec(function(err, list){
        if(err){
            log.error('Aqi DB> fail to get db data', err);
            return callback(err);
        }
        log.silly('Aqi DB > remove all data');
        callback(undefined);
    });
};

controllerAqi.prototype._parseAQIData = function(data){
    if(data == undefined || data.data === undefined){
        return undefined;
    }

    var aqi = data.data;
    var timeOffset = 100;
    if(aqi.time != undefined && aqi.time.tz != undefined){
        timeOffset = parseInt(aqi.time.tz.slice(0, 3));
    }
    return {
        aqi: (aqi.aqi != undefined)? aqi.aqi:-100,
        idx: (aqi.idx != undefined)? aqi.idx:-100,
        timeOffset: timeOffset
    };
};

controllerAqi.prototype._saveAQI = function(geocode, date, data, callback){
    var self = this;

    try{
        var newData = self._parseAQIData(data);

        log.info('AQI> New Data : ', newData);
        var res = {
            geo: [],
            address: {},
            date: date,
            dateObj: self._getUtcTime('' + date + '000'),
            timeOffset: newData.timeOffset,
            aqi: newData.aqi,
            idx: newData.idx
        };
        res.geo.push(parseFloat(geocode.lon));
        res.geo.push(parseFloat(geocode.lat));

        log.info('Aqi> res : ', res);

        modelAqi.update({geo: res.geo, dateObj: res.dateObj}, res, {upsert:true}, function (err) {
            if(err){
                log.error('Aqi> Fail to update db data: ', geocode);
            }
        });

        if(callback){
            callback(0, res);
        }
    }
    catch(e){
        log.error('Aqi> Exception!!!');
        if(callback){
            callback(e);
        }
    }
};

controllerAqi.prototype.requestAqiData = function(geocode, From, To, timeOffset, callback){
    var self = this;
    var key = self._getAQIKey().key;
    var dataList = [];
    var requester = new aqiRequester;

    if(timeOffset > 14 || timeOffset < -11){
        timeOffset = 0;
    }

    var reqTime = self._getLocalLast0H(timeOffset*60);
    //day light saving위해 1시간 margin을 둠.
    reqTime.setUTCHours(reqTime.getUTCHours()+1);
    for(var i=From ; i<To ; i++){
        reqTime.setUTCDate(reqTime.getUTCDate()-i);
        //log.info("reqTime="+reqTime.toISOString());
        var nTime = parseInt(reqTime.getTime()/1000);
        dataList.push(nTime);
    }

    dataList.push('cur');

    self._removeAllAqiDb(geocode, function(err){
        if(err){
            log.error('Req Aqi> fail to delete all data');
            return callback(err);
        }

        async.mapSeries(dataList,
            function(date, cb){
                if(date === 'cur'){
                    date = undefined;
                }
                else {
                    log.info('date : ', (new Date(date*1000)).toISOString());
                }

                requester.getAqiData(geocode, key, function(err, result){
                    if(err){
                        log.error('Req Aqi> get fail', geocode, date);
                        cb(null, {err: 'fail to get AQI'});
                        return;
                    }


                    if(date === undefined){
                        var curTime = new Date();
                        date = parseInt(curTime.getTime() / 1000);
                        log.info('Req Aqi> cur : ', date.toString());
                    }

                    self._saveAQI(geocode, date, result, function(err, savedData){
                        return cb(null, savedData);
                    });
                });
            },
            function(err, aqiData){
                if(err){
                    log.error('Req Aqi> Fail to get AQI data');
                }
                var res = {
                    type : 'AQI',
                    geocode: geocode,
                    address: {},
                    date: 0,
                    dateObj: new Date(0),
                    timeOffset: timeOffset,
                    data: []
                };

                if(aqiData != undefined){
                    aqiData.forEach(function(item){
                        if(item.date === undefined){
                            return;
                        }

                        if(res.date === 0 || res.date < item.date){
                            res.date = item.date;
                        }
                        if(res.dateObj === 0 || res.dateObj.getTime() < item.dateObj.getTime()){
                            res.dateObj = item.dateObj;
                        }
                        if(item.timeOffset){
                            res.timeOffset = item.timeOffset;
                        }

                        res.data.push(item);
                    });
                }

                if(callback){
                    callback(err, res);
                }
            }
        );
    });

};

module.exports = controllerAqi;