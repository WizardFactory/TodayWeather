/**
 * Created by Peter on 2016. 8. 18..
 */

"use strict";

var req = require('request');
var async = require('async');
var keys = require('../../config/config').keyString;

function dsfRequester(){
    var self = this;
    //self.base_url = 'https://api.forecast.io/forecast/';
    self.base_url = 'https://api.darksky.net/forecast/';
    self.defRetryCount = 5;
    return this;
}

dsfRequester.prototype.getForecast = function(geocode, date, key, callback){
    var self = this;

    if(geocode == undefined || !geocode.hasOwnProperty('lat') || !geocode.hasOwnProperty('lon')) {
        callback(new Error('DSF> there is no coordinate'), {isSuccess: false});
        return;
    }

    var url = self.base_url + key + '/' + geocode.lat + ',' + geocode.lon;
    if(date != undefined){
        url += ',' + date;
    }

    log.info('DFS> get data :', url);
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

dsfRequester.prototype.collect = function(list, date, key, callback){
    var self = this;

    async.mapSeries(list,
        function(item, cb){
            if(!item.lat || !item.lon){
                cb(new Error('DSF> there is no coordinate'), {isSuccess: false});
                return;
            }
            var url = self.base_url + key + '/' + item.lat + ',' + item.lon;
            if(date != undefined){
                url += ',' + date;
            }

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
                log.error('DSF> There are failed items in the result list');
            }
            callback(err, results);
        }
    );

    return this;
};


dsfRequester.prototype.get = function(url, option, callback){
    return req.get(url, option, callback);
};

dsfRequester.prototype.getData = function(url, retryCount, callback){
    var self = this;
    var agentOptions = {
        ciphers: 'ALL',
        secureProtocol: 'TLSv1_method',
    };

    log.silly('DFS> get data : ', url);
    self.get(url, {timeout: 1000 * 5, agentOptions: agentOptions}, function(err, response, body){
        if(err) {
            if((err.code === "ECONNRESET" || err.code === "ETIMEDOUT") && retryCount > 0){
                log.warn('DFS> 1. Retry to get caused by ' + err.code + ' : ', retryCount, ', url:'+url);
                return self.getData(url, retryCount-- , callback);
            }
            else {
                err.message += ' url:'+url;
                log.warn(err);
            }
            if(callback){
                callback(err);
            }
            return;
        }
        var statusCode = response.statusCode;

        if(statusCode === 404 || statusCode === 403){
            log.debug('DFS> ERROR!!! StatusCode : ', statusCode);
            if(callback){
                callback(1);
            }
            return;
        }

        try{
            var result = JSON.parse(body);
        }catch(e){
            log.warn('DSF> Wong JSON : ', body);
            if(retryCount > 0){
                log.warn('DFS> 2. Retry to get caused by wrong JSON, retrycount(', retryCount, ')');
                return self.getData(url, retryCount-- , callback);
            }

            if(callback){
                callback(e);
            }
            return;
        }
        // log.info(result);
        if(callback){
            callback(err, result);
        }
    });
};

module.exports = dsfRequester;