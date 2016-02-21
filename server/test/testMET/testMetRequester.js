/**
 * Created by Peter on 2016. 2. 21..
 */
"use strict";

var metRequester = require('../../lib/MET/metRequester');
var assert  = require('assert');
var config = require('../../config/config');
var Logger = require('../../lib/log');
var convertGeocode = require('../../utils/convertGeocode');

global.log  = new Logger(__dirname + "/debug.log");

describe('unit test - get town forecast in lib/collect class', function(){
    it('get weather by MET', function(done){
        var met = new metRequester;
        var list = [
            {
                address: '221B Baker Street London NW1 England',
                lat: 51.52,
                lon: -0.15
            },
            /*
            {
                address: 'Place du Palais 84000 Avignon France',
                lat: 43.95,
                lon: 4.80
            },
            {
                address: 'Piazza del colosseo 1 00184 Rom Italy',
                lat: 41.89,
                lon: 12.49
            },
            {
                address: 'Parthenon 10558 Athens Greece',
                lat: 37.97,
                lon: 23.72
            }
            */
        ];

        met.collectForecast(list, function(err, result){
            if(err){
                log.error('!!! failed to get weather data');
                log.error(err);
                done();
                return;
            }

            log.info('!!! Successed to get weather data');
            //log.info(result);
            done();

        });
    });
});
