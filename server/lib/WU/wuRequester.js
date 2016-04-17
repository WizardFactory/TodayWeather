/**
 * Created by Peter on 2016. 4. 17..
 */

"use strict";

var req = require('request');
var async = require('async');
var keys = require('../../config/config').keyString;

function wuRequester(){
    var self = this;
    return this;
}

wuRequester.prototype.collectCurrent = function(list, callback){
    return this.collect('current', list, callback);
};

wuRequester.prototype.collectForecast = function(list, callback){
    return this.collect('forecast', list, callback);
};

wuRequester.prototype.collect = function(type, list, callback){
    var self = this;
    var base_url = 'http://api.weatherunlocked.com/api/';//51.50,-0.12?app_id={APP_ID}&app_key={APP_KEY}

    async.mapSeries(list,
        function(item, cb){
            if(!item.lat || !item.lon){
                cb(new Error('WU> there is no coordinate'), {isSuccess: false});
                return;
            }
            var url = base_url + type + '/' + item.lat + ',' + item.lon;
            url += '?app_id=' + keys.wu_id + '&app_key=' + keys.wu_key;

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

    log.info('WU> get data : ', url);
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