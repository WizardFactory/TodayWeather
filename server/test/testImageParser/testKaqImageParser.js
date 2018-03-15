/**
 * Created by Peter on 2018. 3. 12..
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
var kaqImage = config.image.kaq_korea_image;

global.log  = new Logger(__dirname + "/debug.log");

var town = require('../../models/town');

describe('Test - Airkorea Image parser ', function(){
    it('get pm10 map pixels', function(done){
        var parser = new (require('../../lib/kaq.finedust.image.parser'))();
        var image_url = './test/testImageParser/PM2_5_Animation.gif';
        var imageData = {
            width: parseInt(kaqImage.size.width),
            height: parseInt(kaqImage.size.height),
            map_width: parseInt(kaqImage.pixel_pos.right) - parseInt(kaqImage.pixel_pos.left),
            map_height: parseInt(kaqImage.pixel_pos.bottom) - parseInt(kaqImage.pixel_pos.top)
        };

        parser.getPixelMap(image_url, 'image/gif', null, function(err, pixels){
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
            };

            assert.equal(imageData.width, pixels.image_width, 'Fail to parse - wrong image width');
            assert.equal(imageData.height, pixels.image_height, 'Fail to parse - wrong image height');
            assert.equal(imageData.map_width, pixels.map_width, 'Fail to parse - wrong map width');
            assert.equal(imageData.map_height, pixels.map_height, 'Fail to parse - wrong map height');
            done();
        });
    });

    it('dust image', function(done){
        var controller = new (require('../../controllers/kaq.dust.image.controller'))();
        var image_pm10_url = './test/testImageParser/PM10_Animation.gif';
        var image_pm25_url = './test/testImageParser/PM2_5_Animation.gif';
        //var geocode = {lat: 35.8927778, lon : 129.4949194};
        //var geocode = {lat : 35.1569750, lon : 126.8533639}; // 광주광역시
        //var geocode = {lat : 37.7491361, lon : 128.8784972};    //강릉시
        //var geocode = {lat : 35.8685417, lon : 128.6035528}; // 대구광역시
        var geocode = {lat : 37.5635694, lon : 126.9800083}; // 서울특별시

        var expectedColorValue_pm10 = [
            112,104,96,80,56,44,52,44,44,36,
            28,36,36,32,32,32,32,32,32,32,40,
            44,60,44,56,44,36,28,32,28,28,24,
            24,28,36,36,44,44,40,36,32,32,36,
            32,28,16,8,12,4,8,16,12,40,28,36,
            36,28,24,24,32,32,24,4,4,4,4,8,8,
            12,16,16,16,16,16,16,16,16,12,12,
            12,12,12,12,12,12,16,16,20,20,24,
            24,24,24,28,36,40,32,28,24,24,24,
            20,16,16,20,24,32,32,28,28,28,32,
            28,24,28,24,28,32,36,44,44,36,28,
            32,24,24,20,20,20,20,16,16,12,12,12,12,12];

        var expectedColorValue_pm25 = [
            108,96,76,60,44,36,44,32,32,24,32,
            24,24,24,32,32,32,36,36,36,44,40,52,
            52,44,36,36,32,32,32,24,24,24,32,36,
            44,48,48,48,44,36,44,44,40,36,16,8,
            12,12,8,12,16,24,32,36,36,44,20,32,
            36,44,36,8,8,8,8,8,8,12,16,12,20,20,
            20,16,12,16,16,12,12,12,20,16,20,16,
            16,16,24,24,32,32,32,36,32,40,40,36,
            32,24,24,32,24,16,20,20,24,32,36,32,
            32,36,36,36,32,36,32,36,36,48,40,40,
            36,40,40,32,32,24,24,24,24,16,16,12,12,12,12,20];

        var controllerManager = require('../../controllers/controllerManager');
        global.manager = new controllerManager();
        controller.getImaggPath = function(type, callback){
            if(type === 'PM10'){
                return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: image_pm10_url});
            }
            return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: image_pm25_url});
        };

        controller.startDustImageMgr(function(err, pixel){
            if(err){
                log.info('1. ERROR!!!');
                assert.fail();
                return done();
            }
            log.info('PM10 image Count : ', pixel.PM10.data.image_count);
            controller.getDustInfo(geocode.lat, geocode.lon, 'PM10', 'airkorea', function(err, result){
                if(err){
                    log.info('2. ERROR!!!!');
                    assert.fail();
                    return done();
                }

                //log.info(JSON.stringify(result));
                log.info('PM10 pubDate : ', result.pubDate);
                for(var i = 0 ; i<expectedColorValue_pm10.length ; i++){
                    assert.equal(result.hourly[i].val, expectedColorValue_pm10[i], '1 No matched PM10 color value : '+i);
                }
                controller.getDustInfo(geocode.lat, geocode.lon, 'PM25', 'airkorea', function(err, result){
                    if(err){
                        log.info('3. ERROR!!!!');
                        assert.fail();
                        return done();
                    }

                    //log.info(JSON.stringify(result));
                    log.info('PM25 pubDate : ', result.pubDate);
                    for(var i = 0 ; i<expectedColorValue_pm25.length ; i++){
                        assert.equal(result.hourly[i].val, expectedColorValue_pm25[i], '2 No matched PM 25 color value : '+i);
                    }
                    done();
                });
            });
        });
    });

    it('get color table PM10', function(done){
        var colorPosX = 280;
        var colorPosY = [
            50, 59, 68, 77, 86, 95, 100, 109, 118, 127,
            136, 145, 152, 161, 170, 179, 188, 197, 205,
            214, 223, 232, 241, 250, 257, 266, 275, 284,
            293, 302, 311, 320
        ];
        var dustValue_pm10 = [
            999, 120, 116, 112, 108, 104, 100, 96, 92, 88,
            84, 80, 76, 72, 68, 64, 60, 56, 52, 48, 44, 40,
            36, 32, 28, 24, 20, 16, 12, 8, 4, 0];

        var expectedRes_pm10 = [
            {"r":254,"g":2,"b":0,"val":999},{"r":253,"g":19,"b":3,"val":120},
            {"r":254,"g":52,"b":1,"val":116},{"r":254,"g":71,"b":1,"val":112},
            {"r":251,"g":86,"b":4,"val":108},{"r":254,"g":123,"b":1,"val":104},
            {"r":253,"g":155,"b":2,"val":100},{"r":253,"g":155,"b":2,"val":96},
            {"r":254,"g":196,"b":1,"val":92},{"r":253,"g":213,"b":2,"val":88},
            {"r":254,"g":227,"b":1,"val":84},{"r":241,"g":251,"b":18,"val":80},
            {"r":241,"g":251,"b":18,"val":76},{"r":216,"g":254,"b":43,"val":72},
            {"r":179,"g":255,"b":79,"val":68},{"r":163,"g":255,"b":95,"val":64},
            {"r":143,"g":255,"b":115,"val":60},{"r":127,"g":254,"b":131,"val":56},
            {"r":91,"g":255,"b":167,"val":52},{"r":75,"g":255,"b":183,"val":48},
            {"r":55,"g":255,"b":203,"val":44},{"r":23,"g":255,"b":236,"val":40},
            {"r":4,"g":254,"b":255,"val":36},{"r":1,"g":243,"b":255,"val":32},
            {"r":0,"g":207,"b":255,"val":28},{"r":0,"g":191,"b":255,"val":24},
            {"r":0,"g":171,"b":255,"val":20},{"r":0,"g":135,"b":255,"val":16},
            {"r":0,"g":118,"b":255,"val":12},{"r":0,"g":103,"b":255,"val":8},
            {"r":1,"g":69,"b":253,"val":4},{"r":0,"g":48,"b":255,"val":0}];

        var parser = new (require('../../lib/kaq.finedust.image.parser'))();
        var image_url = './test/testImageParser/PM10_Animation.gif';

        parser.getPixelMap(image_url, 'image/gif', null, function(err, pixels){
            if(err){
                log.error('Error !! : ', err);
                assert.fail();
                done();
            }
            var result = [];
            for(var i=0 ; i<colorPosY.length ; i++){
                result.push({
                    r: pixels.pixels.get(0, colorPosX, colorPosY[i], 0),
                    g: pixels.pixels.get(0, colorPosX, colorPosY[i], 1),
                    b: pixels.pixels.get(0, colorPosX, colorPosY[i], 2),
                    val: dustValue_pm10[i]
                });
            }

            log.info(JSON.stringify(result));
            for(i=0 ; i<expectedRes_pm10.length ; i++){
                assert.equal(result[i].r, expectedRes_pm10[i].r, 'No matched R color value in roop '+i);
                assert.equal(result[i].g, expectedRes_pm10[i].g, 'No matched G color value in roop'+i);
                assert.equal(result[i].b, expectedRes_pm10[i].b, 'No matched B color value in roop'+i);
                assert.equal(result[i].val, expectedRes_pm10[i].val, 'No matched dust value in roop'+i);
            }
            done();
        });
    });


    it('get color table PM25', function(done){
        var colorPosX = 280;
        var colorPosY = [
            50, 59, 68, 77, 86, 95, 100, 109, 118, 127,
            136, 145, 152, 161, 170, 179, 188, 197, 205,
            214, 223, 232, 241, 250, 257, 266, 275, 284,
            293, 302, 311, 320
        ];
        var dustValue_pm25 = [
            999, 120, 116, 112, 108, 104, 100, 96, 92, 88,
            84, 80, 76, 72, 68, 64, 60, 56, 52, 48, 44, 40,
            36, 32, 28, 24, 20, 16, 12, 8, 4, 0];


        var expectedRes_pm25 =[
            {"r":255,"g":2,"b":0,"val":999},{"r":254,"g":19,"b":2,"val":120},
            {"r":254,"g":19,"b":2,"val":116},{"r":254,"g":71,"b":1,"val":112},
            {"r":254,"g":87,"b":2,"val":108},{"r":250,"g":112,"b":7,"val":104},
            {"r":254,"g":139,"b":1,"val":100},{"r":255,"g":158,"b":0,"val":96},
            {"r":255,"g":158,"b":0,"val":92},{"r":254,"g":213,"b":2,"val":88},
            {"r":255,"g":227,"b":1,"val":84},{"r":255,"g":227,"b":1,"val":80},
            {"r":231,"g":255,"b":27,"val":76},{"r":215,"g":255,"b":43,"val":72},
            {"r":218,"g":255,"b":44,"val":68},{"r":163,"g":255,"b":95,"val":64},
            {"r":143,"g":255,"b":115,"val":60},{"r":106,"g":252,"b":155,"val":56},
            {"r":91,"g":255,"b":167,"val":52},{"r":75,"g":255,"b":183,"val":48},
            {"r":23,"g":255,"b":236,"val":44},{"r":23,"g":255,"b":236,"val":40},
            {"r":3,"g":255,"b":255,"val":36},{"r":0,"g":207,"b":255,"val":32},
            {"r":0,"g":207,"b":255,"val":28},{"r":0,"g":191,"b":255,"val":24},
            {"r":0,"g":135,"b":255,"val":20},{"r":1,"g":137,"b":255,"val":16},
            {"r":0,"g":119,"b":255,"val":12},{"r":0,"g":67,"b":255,"val":8},
            {"r":0,"g":50,"b":253,"val":4},{"r":0,"g":50,"b":253,"val":0}];

        var parser = new (require('../../lib/kaq.finedust.image.parser'))();
        var image_url = './test/testImageParser/PM2_5_Animation.gif';

        parser.getPixelMap(image_url, 'image/gif', null, function(err, pixels){
            if(err){
                log.error('Error !! : ', err);
                assert.fail();
                done();
            }
            var result = [];
            for(var i=0 ; i<colorPosY.length ; i++){
                result.push({
                    r: pixels.pixels.get(0, colorPosX, colorPosY[i], 0),
                    g: pixels.pixels.get(0, colorPosX, colorPosY[i], 1),
                    b: pixels.pixels.get(0, colorPosX, colorPosY[i], 2),
                    val: dustValue_pm25[i]
                });
            }

            log.info(JSON.stringify(result));
            for(i=0 ; i<expectedRes_pm25.length ; i++){
                assert.equal(result[i].r, expectedRes_pm25[i].r, 'No matched R color value in roop #'+i);
                assert.equal(result[i].g, expectedRes_pm25[i].g, 'No matched G color value in roop #'+i);
                assert.equal(result[i].b, expectedRes_pm25[i].b, 'No matched B color value in roop #'+i);
                assert.equal(result[i].val, expectedRes_pm25[i].val, 'No matched dust value in roop #'+i);
            }
            done();
        });
    });

    it('invalid area', function(done){
        var controller = new (require('../../controllers/kaq.dust.image.controller'))();
        var image_pm10_url = './test/testImageParser/PM10_Animation.gif';
        var image_pm25_url = './test/testImageParser/PM2_5_Animation.gif';
        var geocode = {lat: 37.5081798, lon : 130.8217127};

        var controllerManager = require('../../controllers/controllerManager');
        global.manager = new controllerManager();
        controller.getImaggPath = function(type, callback){
            if(type === 'PM10'){
                return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: image_pm10_url});
            }
            return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: image_pm25_url});
        };

        controller.startDustImageMgr(function(err, pixel){
            if(err){
                log.info('1. ERROR!!!');
                assert.fail();
                return done();
            }
            log.info(pixel.PM10.data.image_count);
            controller.getDustInfo(geocode.lat, geocode.lon, 'PM10', 'airkorea', function(err, result){
                if(err){
                    log.info('2. ERROR!!!!', err);
                    return done();
                }

                assert.fail();
                done();
            });
        });
    });
});