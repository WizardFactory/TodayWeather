/**
 * Created by Peter on 2017. 5. 30..
 */

"use strict";

var req = require('request');
var async = require('async');
var keys = require('../../config/config').keyString;

var axios = require('axios');

function aqiRequester(){
    var self = this;
    //example : https://api.waqi.info/feed/geo:10.3;20.7/?token=demo
    self.base_url = 'https://api.waqi.info/feed/';
    self.aqiRetryCount = 5;
    return this;
}

aqiRequester.prototype.getAqiData = function(geocode, key, callback){
    var self = this;

    if(!geocode.hasOwnProperty("lat") || !geocode.hasOwnProperty("lon")){
        callback(new Error('AQI> there is no coordinate'), {isSuccess: false});
        return;
    }

    var url = self.base_url + 'geo:' + geocode.lat + ';' + geocode.lon + '/?token=' + key;

    log.info('AQI> url : ', url);

    self.getData(url, self.aqiRetryCount, function(err, res){
        if(err){
            callback(err);
            return;
        }
        callback(err, res);
        return;
    });
};

/**
 * feed의 경우 request, https를 사용하면 옛날데이터가 받아짐
 * @param url
 * @param callback
 */
aqiRequester.prototype.getDataByAxios = function(url, callback) {
    log.info('AQI> url:'+url);
    axios.get(url)
        .then(function(response) {
            callback(null, response.data.rxs);
        })
        .catch(function(err) {
            //error is circular structure so you have to solve circular
            // const CircularJSON = require('circular-json');
            // let errStr = CircularJSON.stringify(err);
            // log.warn(errStr);
            callback(new Error("Fail to get data"));
        });
};

aqiRequester.prototype.getData = function(url, retryCount, callback){
    var self = this;
    var agentOptions = {
        ciphers: 'ALL',
        secureProtocol: 'TLSv1_method'
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
                callback(statusCode);
            }
            return;
        }

        var result;
        try {
            result = JSON.parse(body);
            log.info(result);
        }
        catch (err) {
            return callback(err);
        }

        if(result.status != 'ok'){
            callback(result.status);
        }else{
            callback(err, result);
        }
    });
};

module.exports = aqiRequester;