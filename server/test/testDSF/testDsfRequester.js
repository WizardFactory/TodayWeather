/**
 * Created by Peter on 2016. 8. 18..
 */
"use strict";

var dsfRequester = require('../../lib/DSF/dsfRequester');
var assert  = require('assert');
var config = require('../../config/config');
var Logger = require('../../lib/log');
var convertGeocode = require('../../utils/convertGeocode');
var keybox = require('../../config/config').keyString;
global.log  = new Logger(__dirname + "/debug.log");

describe('unit test - DSF', function(){
    var list = [
        /*
         {
         address: '221B Baker Street London NW1 England',
         lat: 51.52,
         lon: -0.15
         },
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
         },
         {
         address: 'Akihabara Station 17-6',
         lat: 35.70,
         lon: 139.77

         },
         {
         address: 'Fukuoka Station 321',
         lat: 33.57,
         lon: 130.42
         },
         */
         {
         address: 'Kita6Jonishi 4-Chome',
         lat: 43.06,
         lon: 141.34
         },
        {
            address : 'Beijing West Railway Station Lianhuachi East Road, Feeder Road, Beijing',
            lat:39.66,
            lon:116.40
        }

    ];

    it('get current weather by DSF', function(done){
        var dsf = new dsfRequester();
        dsf.collect(list, undefined, keybox.dsf_key, function(err, result){
            if(err){
                log.error('!!! failed to get current weather data');
                log.error(err);
                done();
                return;
            }

            log.info('!!! Successed to get current weather data');
            log.info(result);
            done();

        });
    });

    it('get previous weather by DFS', function(done){
        var dsf = new dsfRequester();
        var date = '2016-08-11T12:00:00-0900';

        dsf.collect(list, date, keybox.dsf_key, function(err, result){
            if(err){
                log.error('!!! failed to get previous weather data');
                log.error(err);
                done();
                return;
            }

            log.info('!!! Successed to get previous weather data');
            log.info(result);
            done();

        });
    });

    it('get one current item by DSF', function(done){
        var dsf = new dsfRequester();
        dsf.getForecast({lat:39.66, lon:116.40}, undefined, keybox.dsf_key, function(err, result){
            if(err){
                log.error('!!! failed to get current weather data');
                log.error(err);
                done();
                return;
            }

            log.info('!!! Successed to get current weather data');
            log.info(result);
            done();

        });
    });

    it('get one previous item by DSF', function(done){
        var dsf = new dsfRequester();
        var date = '2016-08-11T12:00:00-0900';

        dsf.getForecast({lat:39.66, lon:116.40}, date, keybox.dsf_key, function(err, result){
            if(err){
                log.error('!!! failed to get previous weather data');
                log.error(err);
                done();
                return;
            }

            log.info('!!! Successed to get previous weather data');
            log.info(result);
            done();

        });
    });
/*
    it('time test', function(done){
        var date = new Date();
        date.setTime(1470873600000);
        var time = date.getTime();

        log.info('time : ', time);
        log.info('year:', date.getFullYear());
        log.info('month:', date.getMonth()+1);
        log.info('days:', date.getDate());
        log.info('Time : ', date.getHours(), ':', date.getMinutes(), ':', date.getSeconds());

        done();
    });
*/
});
