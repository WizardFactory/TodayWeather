/**
 * Created by Peter on 2017. 3. 1..
 */

"use strict";

var req = require('request');
var async = require('async');
var keys = require('../../config/config').keyString;

function awRequester(){
    var self = this;

    self.base_url = 'http://dataservice.accuweather.com/';
    return this;
}

awRequester.prototype.getLocationKey = function(geocode, key, callback){
    var self = this;

    if(geocode.lat == undefined || geocode.lon == undefined){
        callback(new Error('AW> there is no coordinate'), {isSuccess: false});
        return;
    }

    var url = self.base_url + 'locations/v1/cities/geoposition/search?apikey=' + key + '&q='+ geocode.lat + ',' + geocode.lon;;
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

awRequester.prototype.getDailyForecast = function(locationKey, key, days, callback){
    var self = this;

    if(locationKey == undefined){
        callback(new Error('AW> there is no locationKey'), {isSuccess: false});
        return;
    }

    if(days == undefined || typeof days != 'number'){
        days = 5;
    }

    var url = self.base_url + 'forecasts/v1/daily/' + days + 'day/' + locationKey + '?apikey=' + key + '&details=true';

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

awRequester.prototype.getHourlyForecast = function(locationKey, key, hourly, callback){
    var self = this;

    if(locationKey == undefined){
        callback(new Error('AW> there is no locationKey'), {isSuccess: false});
        return;
    }

    if(hourly == undefined || typeof hourly != 'number'){
        hourly = 12;
    }

    var url = self.base_url + 'forecasts/v1/hourly/' + hourly + 'hour/' + locationKey + '?apikey=' + key + '&details=true';

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

awRequester.prototype.getCurrent = function(locationKey, key, callback){
    var self = this;

    if(locationKey == undefined){
        callback(new Error('AW> there is no locationKey'), {isSuccess: false});
        return;
    }

    var url = self.base_url + 'currentconditions/v1/' + locationKey + '?apikey=' + key + '&details=true';

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

awRequester.prototype.collect = function(list, date, key, callback){
    var self = this;

    async.mapSeries(list,
        function(item, cb){
            if(!item.lat || !item.lon){
                cb(new Error('AW> there is no coordinate'), {isSuccess: false});
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
                log.error('AW> There are failed items in the result list');
            }
            callback(err, results);
        }
    );

    return this;
};

awRequester.prototype.getData = function(url, callback){
    var self = this;

    log.silly('AW> get data : ', url);
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
            log.debug('AW> ERROR!!! StatusCode : ', statusCode);
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

module.exports = awRequester;