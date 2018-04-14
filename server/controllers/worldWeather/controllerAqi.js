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
    log.warn("controllerAqi : Invalid time");
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
        log.info('C Aqi> same day');
    }
    else if (diffDate == 1) {
        log.info('C Aqi> next day');
        utcTime.setUTCDate(utcTime.getUTCDate()+1);
    }
    else if (diffDate == -1) {
        log.info('C Aqi> previous day');
        utcTime.setUTCDate(utcTime.getUTCDate()-1);
    }
    utcTime.setUTCHours(0);
    utcTime.setUTCMinutes(0);
    utcTime.setUTCSeconds(0);
    utcTime.setUTCMilliseconds(0);
    utcTime.setUTCMinutes(-timeOffset);

    return utcTime;
};

controllerAqi.prototype.removeAqiDb = function(geocode, callback) {
    var geo = [];

    if(typeof parseFloat(geocode.lan) != 'number' || typeof parseFloat(geocode.lat) != 'number'){
        log.error('Aqi DB> remove : Wrong geocode', geocode);
        return callback(new Error('Fail to remove Aqi data'));
    }

    geo.push(parseFloat(geocode.lon));
    geo.push(parseFloat(geocode.lat));

    var twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate()-2);

    modelAqi.remove({geo:geo, dateObj:{$lt: twoDaysAgo}}).exec(function(err){
        if(err){
            log.error('Aqi DB> fail to get db data', err);
            return callback(err);
        }
        log.info('Aqi DB > remove data from:'+twoDaysAgo);
        callback(undefined);
    });
};

controllerAqi.prototype._getItemValue = function(item, name){
    if(item[name] == undefined){
        return -100;
    }

    if(item[name].v == undefined){
        return -100;
    }

    return parseFloat(item[name].v);
};

controllerAqi.prototype._parseAQIData = function(data){
    var self = this;

    if(data == undefined || data.data === undefined){
        return undefined;
    }

    var aqi = data.data;
    var timeOffset = 0;
    if(aqi.time != undefined && aqi.time.tz != undefined && aqi.time.tz.length > 5){
        timeOffset = parseInt(aqi.time.tz.slice(0, 3));
    }

    var ret = {
        aqi: (aqi.aqi != undefined)? parseFloat(aqi.aqi):-100,
        idx: (aqi.idx != undefined)? parseFloat(aqi.idx):-100,
        timeOffset: timeOffset,
        co: -100,
        h: -100,
        no2: -100,
        o3: -100,
        p: -100,
        pm10: -100,
        pm25: -100,
        so2: -100,
        t: -100,
    };

    if(aqi.iaqi != undefined){
        var iaqi = aqi.iaqi;

        ret.co = self._getItemValue(iaqi, 'co');
        ret.h = self._getItemValue(iaqi, 'h');
        ret.no2 = self._getItemValue(iaqi, 'no2');
        ret.o3 = self._getItemValue(iaqi, 'o3');
        ret.p = self._getItemValue(iaqi, 'p');
        ret.pm10 = self._getItemValue(iaqi, 'pm10');
        ret.pm25 = self._getItemValue(iaqi, 'pm25');
        ret.so2 = self._getItemValue(iaqi, 'so2');
        ret.t = self._getItemValue(iaqi, 't');
    }

    if(aqi.time != undefined && aqi.time.s != undefined && aqi.time.s.length > 5){
        ret.mTime = aqi.time.s;
    }
    if(aqi.city != undefined && aqi.city.name != undefined){
        ret.mCity = aqi.city.name;
    }
    return ret;
};

controllerAqi.prototype._saveAQI = function(geocode, date, data, callback){
    var self = this;

    var query;
    var res;

    try{
        var newData = self._parseAQIData(data);
        if(isNaN(newData.aqi)){
            newData.aqi = -100;
            log.error('AQI> Invalid AQI Data: ', JSON.stringify(newData));
        }

        log.info('AQI> New Data : ', newData);
        res = {
            geo: [],
            address: {},
            date: date,
            dateObj: self._getUtcTime('' + date + '000'),
            timeOffset: newData.timeOffset,
            aqi: newData.aqi,
            idx: newData.idx,
            co: newData.co,
            h: newData.h,
            no2: newData.no2,
            o3: newData.o3,
            p: newData.p,
            pm10: newData.pm10,
            pm25: newData.pm25,
            so2: newData.so2,
            t: newData.t
        };
        if(newData.mTime){
            res.mTime = newData.mTime;
        }
        if(newData.mCity){
            res.mCity = newData.mCity;
        }

        res.geo.push(parseFloat(geocode.lon));
        res.geo.push(parseFloat(geocode.lat));

        log.info('Aqi> res : ', res);

        query = {geo: res.geo, dateObj: res.dateObj};
    }
    catch(e){
        log.error('Aqi> Exception!!!');
        if (callback) {
            callback(e);
        }
        return;
    }

    modelAqi.update(query, res, {upsert:true}, function (err) {
        if(err){
            log.error('Aqi> Fail to update db data: ', geocode, err);
        }
    });

    if (callback) {
        callback(null, res);
    }
};

controllerAqi.prototype._feed2data = function(feed) {
    var data = {};
    //aqi
    //idx
    //city : {geo, name, url}
    //dominentpol : 'pm25';
    //iaqi : { co : {v:Number}, h, no2, p, pm25, t
    //time : {s, tz, v}

    var msg = feed.obs[0].msg;
    data.aqi = msg.aqi;
    data.idx = msg.city.idx;
    data.city = {geo: msg.city.geo, name: msg.city.name, url: msg.city.url};
    data.iaqi = {};
    msg.iaqi.forEach(function (obj) {
        data.iaqi[obj.p] = {v:obj.v[0]};
    });

    if (msg.time.utc == undefined) {
        log.error('It can be an old feed!!!');
        throw new Error('It can be an old feed!!!');
    }
    data.time = msg.time.utc;

    return data;
};

/**
 * old feed이거나, data format이 안맞으면 retry
 * @param idx
 * @param callback
 * @private
 */
controllerAqi.prototype._getFeed = function(idx, callback) {
    var self = this;
    var requester = new aqiRequester;
    var url;
    async.retry(3, function (callback) {
            async.waterfall([
                    function (callback) {
                        url = 'https://api.waqi.info/api/feed/@' + idx + '/obs.en.json';
                        requester.getDataByAxios(url, function(err, result) {
                            callback(err, result);
                        });
                    },
                    function (result, callback) {
                        var data;
                        try {
                            data = self._feed2data(result);
                        }
                        catch (err) {
                            return callback(err);
                        }
                        callback(null, {data:data});
                    }
                ],
                function(err, result) {
                    if (err) {
                        log.warn(err);
                        log.warn(JSON.stringify({url: url, invalidFeed:result}));
                    }
                    callback(err, result);
                });
        },
        callback);
};

controllerAqi.prototype.requestAqiDataFromFeed = function(geocode, idx, timeOffset, callback) {
    var self = this;

    async.waterfall([
            function (callback) {
                self._getFeed(idx, callback);
            },
            function (result, callback) {
                var curTime = new Date();
                var date = parseInt(curTime.getTime() / 1000);
                log.info('Req AqiFromFeed > cur : ', date.toString());
                self._saveAQI(geocode, date, result, function(err, savedData) {
                    return callback(null, savedData);
                });
            }
        ],
        function (err, item) {
            if(err){
                return callback(err);
            }
            if (item == undefined) {
                return callback(new Error('Req AqiFromFeed > Fail to get aqi data'));
            }

            var res;
            try {
                res = {
                    type : 'AQI',
                    geocode: geocode,
                    address: {},
                    date: 0,
                    dateObj: new Date(0),
                    timeOffset: timeOffset,
                    data: []
                };

                if (res.date === 0 || res.date < item.date) {
                    res.date = item.date;
                }
                if (res.dateObj === 0 || res.dateObj.getTime() < item.dateObj.getTime()) {
                    res.dateObj = item.dateObj;
                }
                if (item.timeOffset) {
                    res.timeOffset = item.timeOffset;
                }
                res.data.push(item);
            }
            catch (e) {
                return callback(e);
            }

            callback(null, res);
        });
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
                    log.warn(err);
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

    self.removeAqiDb(geocode, function(err) {
        if(err){
            log.error('Req Aqi> fail to delete all data');
        }
    });
};

module.exports = controllerAqi;