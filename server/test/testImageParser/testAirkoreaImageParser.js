/**
 * Created by Peter on 2017. 11. 3..
 */

"use strict";
var assert  = require('assert');
var config = require('../../config/config');
var Logger = require('../../lib/log');
var convertGeocode = require('../../utils/convertGeocode');
var keybox = require('../../config/config').keyString;
var util = require('util');
var async = require('async');
var convert = require('../../utils/coordinate2xy');

global.log  = new Logger(__dirname + "/debug.log");

var town = require('../../models/town');

describe('Test - Airkorea Image parser ', function(){
    it('get map pixels', function(done){
        var parser = require('../../lib/airkorea.finedust.image.parser');

        var image_url = './test/testImageParser/dust_test_image.png';
        var imageData = {
            width: 689,
            height: 802,
            map_width: 585,
            map_height: 718
        }

        parser.getMapPixels(image_url, 'image/png', function(err, pixels){
            if(err){
                log.error('Error !! : ', err);
                assert.equal(null, imageData, 'Fail to get pixels data');
                done();
            }

            log.info('Image W: ', pixels.image_width, 'H: ', pixels.image_height);
            log.info('Map W: ', pixels.map_width, 'H: ', pixels.map_height);
            var ret = {
                width: pixels.image_width,
                height: pixels.image_height,
                map_width: pixels.map_width,
                map_height: pixels.map_height
            }

            assert.equal(imageData.width, pixels.image_width, 'Fail to parse - wrong image width');
            assert.equal(imageData.height, pixels.image_height, 'Fail to parse - wrong image height');
            assert.equal(imageData.map_width, pixels.map_width, 'Fail to parse - wrong map width');
            assert.equal(imageData.map_height, pixels.map_height, 'Fail to parse - wrong map height');
            done();
        });
    });
});