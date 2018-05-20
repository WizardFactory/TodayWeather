/**
 * Created by Peter on 2017. 3. 20..
 */

"use strict";

var req = require('request');
var async = require('async');
var keys = require('../../config/config').keyString;

function faRequester(){
    var self = this;

    self.base_url = 'http://apitest.foreca.net/';
    self.defRetryCount = 5;
    return this;
}

faRequester.prototype.getForecast = function(geocode, key, callback){
    var self = this;

    if(!geocode.lat || !geocode.lon){
        callback(new Error('FC> there is no coordinate'), {isSuccess: false});
        return;
    }

    // ex. http://apitest.foreca.net/?lon=24.934&lat=60.1755&key={keys}&format=json
    var url = self.base_url + '?lon=' + geocode.lat + '&lat=' + geocode.lon + '&key=' + key + '&format=json';

    log.info(url);
    self.getData(url, self.defRetryCount, function(err, res){
        if(err){
            callback(err, {isSuccess: false});
            return;
        }
        if(res != undefined){
            res.isSuccess = true;
        }
        callback(err, res);
        return;
    });
};

faRequester.prototype.collect = function(list, key, callback){
    var self = this;

    async.mapSeries(list,
        function(item, cb){
            if(!item.lat || !item.lon){
                cb(new Error('FC> there is no coordinate'), {isSuccess: false});
                return;
            }
            var url = self.base_url + '?lon=' + item.lon + '&lat=' + item.lat + '&key=' + key + '&format=json';

            self.getData(url, self.defRetryCount, function(err, res){
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
                log.error('FC> There are failed items in the result list');
            }
            callback(err, results);
        }
    );

    return this;
};

faRequester.prototype.get = function(url, option, callback){
    return req.get(url, option, callback);
};

faRequester.prototype.getData = function(url, retryCount, callback){
    var self = this;

    log.silly('FC> get data : ', url);
    self.get(url, {timeout: 1000 * 5}, function(err, response, body){
        if(err) {
            log.warn(err);
            if((err.code === "ECONNRESET" || err.code === "ETIMEDOUT") && retryCount > 0){
                log.warn('FC> Retry to get caused by' + err.code + ' : ', retryCount);
                return self.getData(url, --retryCount, callback);
            }
            if(callback){
                callback(err);
            }
            return;
        }
        var statusCode = response.statusCode;

        if(statusCode === 404 || statusCode === 403){
            log.debug('FC> ERROR!!! StatusCode : ', statusCode);
            if(callback){
                callback(1);
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

module.exports = faRequester;
