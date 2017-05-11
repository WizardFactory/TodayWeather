/**
 * Created by Peter on 2017. 3. 2..
 */
"use strict";

var awRequester = require('../../lib/AW/awRequester');
var assert  = require('assert');
var config = require('../../config/config');
var Logger = require('../../lib/log');
var convertGeocode = require('../../utils/convertGeocode');
var keybox = require('../../config/config').keyString;
global.log  = new Logger(__dirname + "/debug.log");

describe('unit test - AW', function(){
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
         {
         address: 'Kita6Jonishi 4-Chome',
         lat: 43.06,
         lon: 141.34
         },
         */
        {
            address : 'Beijing West Railway Station Lianhuachi East Road, Feeder Road, Beijing',
            lat:39.66,
            lon:116.40
        }

    ];
    var locationKey = 2171835;  // default NY

    it('get location key by AW', function(done){
        var aw = new awRequester();
        aw.getLocationKey(list[0], keybox.aw_keys[0].key, function(err, res){
            if(err){
                log.error('!!! failed to get location key');
                log.error(err);
                done();
                return;
            }
            log.info(res);
            locationKey = res.Key;

            log.info('Location Key : ' + locationKey);
            done();
        });
    });

    it('get one day(daily) weather by AW', function(done) {
        var aw = new awRequester();
        aw.getDailyForecast(locationKey, keybox.aw_keys[0].key, 1, function(err, res){
            if(err){
                log.error('!!! failed to daily weather');
                log.error(err);
                done();
                return;
            }
            log.info('======= One day weather ========================');
            log.info(res);
            log.info('========================================================================\n\n');

            done();
        });
    });

    it('get five days(daily) weather by AW', function(done) {
        var aw = new awRequester();
        aw.getDailyForecast(locationKey, keybox.aw_keys[0].key, 5, function(err, res){
            if(err){
                log.error('!!! failed to daily weather');
                log.error(err);
                done();
                return;
            }
            log.info('======= Five days weather ========================');
            log.info(res);
            log.info('========================================================================\n\n');

            done();
        });
    });

    it('get one hour(hourly) weather by AW', function(done) {
        var aw = new awRequester();
        aw.getHourlyForecast(locationKey, keybox.aw_keys[0].key, 1, function(err, res){
            if(err){
                log.error('!!! failed to hourly weather');
                log.error(err);
                done();
                return;
            }
            log.info('======= One hour weather ========================');
            log.info(res);
            log.info('========================================================================\n\n');

            done();
        });
    });

    it('get twelve hours(hourly) weather by AW', function(done) {
        var aw = new awRequester();
        aw.getHourlyForecast(locationKey, keybox.aw_keys[0].key, 12, function(err, res){
            if(err){
                log.error('!!! failed to hourly weather');
                log.error(err);
                done();
                return;
            }
            log.info('======= Twelve hours weather ========================');
            log.info(res);
            log.info('========================================================================\n\n');

            done();
        });
    });

    it('get current weather by AW', function(done) {
        var aw = new awRequester();
        aw.getCurrent(locationKey, keybox.aw_keys[0].key, function(err, res){
            if(err){
                log.error('!!! failed to current weather');
                log.error(err);
                done();
                return;
            }
            log.info('======= Current weather ========================');
            log.info(res);
            log.info('========================================================================\n\n');

            done();
        });
    });
});
