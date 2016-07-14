/**
 * Created by Peter on 2016. 6. 4..
 */

"use strict";

var wrRequester = require('../../lib/WU/wuRequester');
var assert  = require('assert');
var config = require('../../config/config');
var Logger = require('../../lib/log');
var convertGeocode = require('../../utils/convertGeocode');
var keybox = require('../../config/config').keyString;
global.log  = new Logger(__dirname + "/debug.log");

describe('practice', function(){

    it('', function(done){

        //var date = '10/05/2016'.split('/');
        //var value = parseInt(''+date[2]+date[1]+date[0]);

        var time = '04:50';
        time = (time.replace(':', ''));

        log.info(time);

    });
});