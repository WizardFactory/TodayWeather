/**
 * Created by Peter on 2016. 4. 17..
 */

"use strict";

var req = require('request');
var async = require('async');
var keys = require('../../config/config').keyString;

function wuRequester(){
    var self = this;
    self.base_url = 'http://api.weatherunlocked.com/api/';//51.50,-0.12?app_id={APP_ID}&app_key={APP_KEY}

    return this;
}

wuRequester.prototype.getCurrent = function(geocode, key, callback){
    var self = this;

    if(!geocode.lat || !geocode.lon){
        callback(new Error('WU> there is no coordinate'), {isSuccess: false});
        return;
    }
    var url = self.base_url + 'current' + '/' + geocode.lat + ',' + geocode.lon;
    url += '?app_id=' + key.id + '&app_key=' + key.key;

    self.getData(url, function(err, res){
        if(err){
            callback(err, {isSuccess: false});
            return;
        }
        res.isSuccess = true;
        callback(err, res);
        return;
    });

    return;
};

wuRequester.prototype.getForecast = function(geocode, key, callback){
    var self = this;

    if(!geocode.lat || !geocode.lon){
        callback(new Error('WU> there is no coordinate'), {isSuccess: false});
        return;
    }
    var url = self.base_url + 'forecast' + '/' + geocode.lat + ',' + geocode.lon;
    url += '?app_id=' + key.id + '&app_key=' + key.key;

    self.getData(url, function(err, res){
        if(err){
            callback(err, {isSuccess: false});
            return;
        }
        res.isSuccess = true;
        callback(err, res);
        return;
    });
};

wuRequester.prototype.collectCurrent = function(list, key, callback){
    return this.collect('current', list, key, callback);
};

wuRequester.prototype.collectForecast = function(list, key, callback){
    return this.collect('forecast', list, key, callback);
};


wuRequester.prototype.collect = function(type, list, key, callback){
    var self = this;
    var base_url = 'http://api.weatherunlocked.com/api/';//51.50,-0.12?app_id={APP_ID}&app_key={APP_KEY}

    async.mapSeries(list,
        function(item, cb){
            if(!item.lat || !item.lon){
                cb(new Error('WU> there is no coordinate'), {isSuccess: false});
                return;
            }
            var url = base_url + type + '/' + item.lat + ',' + item.lon;
            url += '?app_id=' + key.id + '&app_key=' + key.key;

            self.getData(url, function(err, res){
                if(err){
                    cb(err, {isSuccess: false, lat: item.lat, lon: item.lon});
                    return;
                }
                res.isSuccess = true;
                res.lat = item.lat;
                res.lon = item.lon;
                cb(err, res);
                return;
            });
        },
        function(err, results){
            if(err){
                log.error(err);
                log.error('WU> There are failed items in the result list');
            }
            callback(err, results);
        }
    );

    return this;
};

wuRequester.prototype.getData = function(url, callback){
    var self = this;

    log.silly('WU> get data : ', url);
    req.get(url, {timeout: 1000 * 5}, function(err, response, body){
        if(err) {
            log.warn(err);
            if(callback){
                callback(err);
            }
            return;
        }
        var statusCode = response.statusCode;

        if(statusCode === 404 || statusCode === 403){
            log.debug('WU> ERROR!!! StatusCode : ', statusCode);
            if(callback){
                callback(err);
            }
            return;
        }

        var result = JSON.parse(body);
        //log.info(result);
        if(callback){
            callback(err, result);
        }
    });
};

module.exports = wuRequester;