/**
 * Created by Peter on 2016. 3. 29..
 */
"use strict";

var assert  = require('assert');
var config = require('../../config/config');
var Logger = require('../../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var controllerRequester = require('../../controllers/worldWeather/controllerRequester');
var requester = new controllerRequester();

describe('unit test - routeRequester', function(){
    it('test controller Requester', function(done){

        var param = {params: {category:'MET', command: 'req_code'}, query: {key: 'seojungsu', gcode: '36.00,140.00'}};

        requester.checkKey(param,0, function(){
            log.info('end check key');
        });

        requester.runCommand(param, 0, function(){
            log.info('end run command');
            done();
        });
    });
});
