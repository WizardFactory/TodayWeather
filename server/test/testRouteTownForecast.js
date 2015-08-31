/**
 * Created by Peter on 2015. 8. 25..
 */
"use strict";

var assert  = require('assert');
var config = require('../config/config');
var collect = require('../lib/collectTownForecast');
var Logger = require('../lib/log');

global.log  = new Logger(__dirname + "/debug.log");
/*
describe('unit test - routeTownForecast class', function(){

    it('routes/routeTownForecast : get towns SHORT info', function(done) {
    });
});
*/