/**
 * Created by Peter on 2016. 2. 18..
 */

"use strict";

var req = require('request');
var xml2json  = require('xml2js').parseString;
var async = require('async');

/**
 *
 * @returns {metRequester}
 */
function metRequester(){
    var self = this;

    return this;
}

/**
 *
 * @param list
 * @param callback
 * @returns {metRequester}
 */
metRequester.prototype.collectForecast = function(list, callback){
    var self = this;
    var base_url = 'http://api.yr.no/weatherapi/locationforecast/1.9/';//?lat=60.10;lon=9.58';

    async.mapSeries(list,
        function(item, cb){
            if(!item.lat || !item.lon){
                cb(new Error('there is no coordinate'), {isSuccess: false});
                return;
            }
            var url = base_url + '?lat=' + item.lat + ';lon=' + item.lon;
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
                log.error('There are failed items in the result list');
            }
            callback(err, results);
        }
    );

    return this;
};

/**
 *
 * @param url
 * @param callback
 */
metRequester.prototype.getData = function(url, callback){
    var self = this;

    log.info('get data : ', url);
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
            log.debug('ERROR!!! StatusCode : ', statusCode);
            if(callback){
                callback(err);
            }
            return;
        }

        xml2json(body, function(err, result){
            try {
                //log.info(result);
                //log.info(result.weatherdata);
                //log.info(result.weatherdata.meta);
                //log.info(result.weatherdata.meta[0].model);
                //log.info(result.weatherdata.product[0].time[0].location[0]);
                //log.info(result.weatherdata.product[0].time[0].location[0].temperature[0]);
                log.info(typeof result.weatherdata.product[0].time[0].location[0].temperature[0]);
            }
            catch(e){
                log.error('& Error!!!');
            }
            finally{
                if(callback){
                    callback(err, result);
                }
            }
        });
    });
};

module.exports = metRequester;
