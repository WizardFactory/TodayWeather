/**
 * Created by Peter on 2016. 3. 2..
 */

"use strict";

var assert  = require('assert');
var config = require('../../config/config');
var Logger = require('../../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var controllerRequester = require('../../controllers/worldWeather/controllerWorldWeather');
var requester = new controllerRequester();

describe('unit test - routeWeather', function(){
    it('test controller routeWeather', function(done){

        var param = {params: {version: '010000', category:'current'}, query: {key: 'seojungsu', gcode: '36.00,140.00'}};

        requester.checkApiVersion(param,0, function(){
            log.info('end check version');
        });

        requester.queryWeather(param, 0, function(){
            log.info('end query weather');
            done();
        });
    });
});
