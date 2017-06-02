/**
 * Created by Peter on 2017. 5. 30..
 */

"use strict";

var req = require('request');
var async = require('async');
var keys = require('../../config/config').keyString;


function aqiRequester(){
    var self = this;
    //example : https://api.waqi.info/feed/geo:10.3;20.7/?token=demo
    self.base_url = 'https://api.waqi.info/feed/';
    self.defRetryCount = 5;
    return this;
}

aqiRequester.prototype.getAqiData = function(geocode, key, callback){
    var self = this;

    if(!geocode.lat || !geocode.lon){
        callback(new Error('AQI> there is no coordinate'), {isSuccess: false});
        return;
    }

    var url = self.base_url + 'geo:' + geocode.lat + ';' + geocode.lon + '/?token=' + key;

    log.info('QUI> url : ', url);

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

aqiRequester.prototype.getData = function(url, retryCount, callback){
    var self = this;
    var agentOptions = {
        ciphers: 'ALL',
        secureProtocol: 'TLSv1_method',
    };

    log.silly('AQI> get data : ', url);
    req.get(url, {timeout: 1000 * 5, agentOptions: agentOptions}, function(err, response, body){
        if(err) {
            log.warn(err);
            if((err.code === "ECONNRESET" || err.code === "ETIMEDOUT") && retryCount > 0){
                log.warn('AQI> Retry to get caused by' + err.code + ' : ', retryCount);
                return self.getData(url, retryCount-- , callback);
            }
            if(callback){
                callback(err);
            }
            return;
        }
        var statusCode = response.statusCode;

        if(statusCode === 404 || statusCode === 403){
            log.debug('AQI> ERROR!!! StatusCode : ', statusCode);
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

module.exports = aqiRequester;