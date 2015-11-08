/**
 * Created by Peter on 2015. 8. 4..
 */
"use strict";

var assert  = require('assert');
var config = require('../config/config');
//var keydata = require('../config/config');
var collect = require('../lib/collectTownForecast');
var Logger = require('../lib/log');
var convert = require('../utils/coordinate2xy');
var fs = require('fs');
var convertGeocode = require('../utils/convertGeocode');
var controllerTownRss = require('../controllers/controllerShortRss');

describe('unit test - get short rss by using controllerShortRss', function(){

    it('controller/controllerShortRss', function(done){
        var date = new Date(2015, 10, 20, 15, 30);
        log.info('now:', date.toString());

        //date.setDate(date.getTime());
        date.setTime(date.getTime() + (5 * 3600000));
        log.info('time 1:', date.toString());
        log.info('year:', '' + date.getFullYear() + date.getMonth() + date.getDay() + date.getHours() + date.getMinutes());

        done();
    });
});