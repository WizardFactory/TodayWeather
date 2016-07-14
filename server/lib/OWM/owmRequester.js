/**
 * Created by Peter on 2016. 2. 29..
 */

"use strict";

var req = require('request');
var xml2json  = require('xml2js').parseString;
var async = require('async');
var keys = require('../../config/config').keyString;

function owmRequester(){
    var self = this;

    return this;
}

owmRequester.prototype.collectForecast = function(list, callback){
    var self = this;
    var base_url = 'http://api.openweathermap.org/data/2.5/forecast';//&lat=43.06&lon=141.34&APPID=&mode=xml';

    async.mapSeries(list,
        function(item, cb){
            if(!item.lat || !item.lon){
                cb(new Error('OWM> there is no coordinate'), {isSuccess: false});
                return;
            }
            var url = base_url + '?lat=' + item.lat + '&lon=' + item.lon;
            url += '&APPID=' + keys.owm_key + '&mode=xml';

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
                log.err(err);
                log.error('OWM> There are failed items in the result list');
            }
            callback(err, results);
        }
    );

    return this;
};

owmRequester.prototype.getData = function(url, callback){
    var self = this;

    log.info('OWM> get data : ', url);
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
            log.debug('OWM> ERROR!!! StatusCode : ', statusCode);
            if(callback){
                callback(err);
            }
            return;
        }

        xml2json(body, function(err, result){
            try {
                //log.info(result);
                log.info(result.weatherdata.forecast);

            }
            catch(e){
                log.error('OWM> & Error!!!');
            }
            finally{
                if(callback){
                    callback(err, result);
                }
            }
        });
    });
};

module.exports = owmRequester;