/**
 * Created by Peter on 2016. 11. 20..
 */
"use strict";

var assert  = require('assert');
var config = require('../../config/config');
var Logger = require('../../lib/log');
var controllerKeys = require('../../controllers/worldWeather/controllerKeys');
var mongoose = require('mongoose');

global.log  = new Logger(__dirname + "/debug.log");

describe('controller unit test - collector', function(){
    it('test controller keys', function(done){
        var cKeys = new controllerKeys();

        var owm = cKeys.getOwmKey();
        var wu = cKeys.getWuKey();
        var dsf = cKeys.getDsfKey();

        log.info('owm key : ', owm);
        log.info('wu key : ', wu);
        log.info('dsf key : ', dsf);

        cKeys.setKeyLimit('dsf', 3);
        cKeys.addKey('dsf', {key: '1111111111'});
        cKeys.addKey('dsf', {key: '2222222222'});
        cKeys.addKey('dsf', {key: '3333333333'});

        for(var i = 0 ; i< 12 ; i++){
            dsf = cKeys.getDsfKey();
            log.info('dsf key[', i, '] : ', dsf);
        }

        var nextDate = new Date();
        nextDate.setDate(nextDate.getDay() + 1);

        log.info('Set another day to dsf key info');

        cKeys.setDate('dsf', nextDate);

        for(var i = 0 ; i< 13 ; i++){
            dsf = cKeys.getDsfKey();
            log.info('dsf key[', i, '] : ', dsf);
        }

        done();
    });
});