/**
 * Created by Peter on 2017. 6. 3..
 */

"use strict";

var req = require('request');
var aqiRequester = require('../../lib/AQI/aqiRequester');
var assert  = require('assert');
var config = require('../../config/config');
var Logger = require('../../lib/log');
var convertGeocode = require('../../utils/convertGeocode');
var keybox = require('../../config/config').keyString;
global.log  = new Logger(__dirname + "/debug.log");

describe('unit test - DSF', function(){

    //경기도 광주시 오포읍 : 127.2551387,37.4293942
    it('get aqi value by using geocode', function(done){
        var aqi = new aqiRequester();

        aqi.getAqiData({lat:127.2551387, lon:37.4293942}, keybox.aqi_keys[0].key, function(err, result){
            if(err){
                log.error('!!! failed to get AQI data');
                log.error(err);
                done();
                return;
            }

            log.info('!!! Successed to get AQI data');
            log.info(result);
            done();

        });
    });
});

