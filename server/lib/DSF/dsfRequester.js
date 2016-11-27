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
    return this;
}

dsfRequester.prototype.getForecast = function(geocode, date, key, callback){
    var self = this;

    if(!geocode.lat || !geocode.lon){
        callback(new Error('DSF> there is no coordinate'), {isSuccess: false});
        return;
    }

    var url = self.base_url + key + '/' + geocode.lat + ',' + geocode.lon;
    if(date != undefined){
        url += ',' + date;
    }

    log.info(url);
    self.getData(url, function(err, res){
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
                log.error('DSF> There are failed items in the result list');
            }
            callback(err, results);
        }
    );

    return this;
};

dsfRequester.prototype.getData = function(url, callback){
    var self = this;

    log.silly('DFS> get data : ', url);
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
            log.debug('DFS> ERROR!!! StatusCode : ', statusCode);
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

module.exports = dsfRequester;