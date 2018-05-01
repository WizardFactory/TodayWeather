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
var kaqModelimg = config.image.kaq_korea_modelimg_image;

global.log  = new Logger(__dirname + "/debug.log");

var town = require('../../models/town');

describe('Test - KAQ modelimg_CASE4 Image parser ', function(){
    it('get pm10 map pixels', function(done){
        var parser = new (require('../../lib/kaq.finedust.image.parser'))();
        var image_url = './test/testImageParser/kma_modelimg_case4_PM2_5.09KM.Animation.gif';
        var imageData = {
            width: parseInt(kaqImage.size.width),
            height: parseInt(kaqImage.size.height),
            map_width: parseInt(kaqImage.pixel_pos.right) - parseInt(kaqImage.pixel_pos.left),
            map_height: parseInt(kaqImage.pixel_pos.bottom) - parseInt(kaqImage.pixel_pos.top)
        };

        parser.getPixelMap(image_url, 'CASE4', 'image/gif', null, function(err, pixels){
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
        var controller = new (require('../../controllers/kaq.modelimg.case.controller.js'))();
        var image_pm10_url = './test/testImageParser/kma_modelimg_case4_PM10.09KM.Animation.gif';
        var image_pm25_url = './test/testImageParser/kma_modelimg_case4_PM2_5.09KM.Animation.gif';
        var image_NO2_url = './test/testImageParser/kma_modelimg_case4_NO2.09KM.Animation.gif';
        var image_O3_url = './test/testImageParser/kma_modelimg_case4_O3.09KM.Animation.gif';
        var image_SO2_url = './test/testImageParser/kma_modelimg_case4_SO2.09KM.Animation.gif';
        //var geocode = {lat: 35.8927778, lon : 129.4949194};
        //var geocode = {lat : 35.1569750, lon : 126.8533639}; // 광주광역시
        //var geocode = {lat : 37.7491361, lon : 128.8784972};    //강릉시
        //var geocode = {lat : 35.8685417, lon : 128.6035528}; // 대구광역시
        var geocode = {lat : 37.5635694, lon : 126.9800083}; // 서울특별시

        var expectedColorValue_pm10 = [96,104,96,76,76,76,96,100,112,96,84,84,76,88,84,68,76,80,104,104,108,120,150,150,150,108,88,76,72,64,60,56,52,52,56,52,64,68,68,76,76,76,68,80,80,92,100,72,null,60,40,52,52,36,44,16,12,4,4,4,4,4,4,4,4,4,4,4,8,12,24,16,16,16,12,8,8,8,8,8,12,12,20,24,32,28,24,24,28,32,36,36,40,48,44,44,36,28,20,20,24,24,28,32,40,48,60,88,92,76,76,88,104,116,112,116,108,150,96,76,52,36,32,28,28,28,28,28,28,28,28,32,32,32,32,32,32];

        var expectedColorValue_pm25 = [60,60,60,42,48,40,60,44,60,48,46,50,50,32,38,44,48,26,60,60,60,60,60,60,60,60,60,60,60,46,42,40,42,40,44,42,50,60,60,60,60,60,60,60,60,60,60,50,null,24,16,40,42,30,32,10,16,4,4,4,2,2,2,2,2,4,4,4,4,6,8,8,8,8,6,6,4,4,4,6,8,10,14,18,22,22,22,22,24,26,28,30,32,34,32,32,28,20,16,14,16,18,20,24,30,38,60,60,60,60,60,60,60,60,60,60,60,60,60,60,38,26,24,22,22,22,22,22,24,22,22,24,24,22,20,20,22];
        var expectedColorValue_no2 = [0.0433,0.0532,0.0299,0.0299,0.0332,0.0332,0.0365,0.04,0.0466,0.0299,0.0433,0.0365,0.0433,0.0466,0.0466,0.0466,0.0433,0.0332,0.0699,0.0699,0.0699,0.0666,0.0666,0.0633,0.0666,0.0532,0.0365,0.0165,0.02,0.02,0.0165,0.02,0.0433,0.0433,0.0466,0.0866,0.0666,0.0633,0.0633,0.0565,0.0532,0.0466,0.0499,0.0466,0.0466,0.0633,0.0765,0.08,0.0633,0.0499,0.0266,0.0299,0.0332,0.0433,0.02,0.0233,0.0266,0.0266,0.0266,0.0165,0.0132,0.0099,0.0099,0.0099,0.0132,0.0132,0.0165,0.02,0.0299,0.0266,0.0332,0.0365,0.0299,0.0266,0.02,0.02,0.0132,0.0132,0.0099,0.0099,0.0132,0.0266,0.0565,0.0633,0.0499,0.0433,0.0299,0.02,0.02,0.02,0.0266,0.0299,0.0365,0.0433,0.0332,0.0233,0.02,0.0132,0.0099,0.0066,0.0066,0.0099,0.0099,0.0132,0.0165,0.0266,0.0499,0.0532,0.0433,0.0365,0.0332,0.0365,0.02,0.0299,0.0299,0.0299,0.0365,0.0466,0.0299,0.0266,0.0165,0.0132,0.0099,0.0066,0.0066,0.0066,0.0099,0.0099,0.0132,0.0165,0.0266,0.0299,0.0266,0.02,0.0165,0.0165,0.0233];
        var expectedColorValue_o3 = [0.024,0.078,0.036,0.078,0.078,0.078,0.078,0.09,0.078,0.06,0.036,0.06,0.042,0.03,0.018,0.024,0.018,0.03,0.006,0.012,0,0,0,0.006,0.012,0.018,0.036,0.048,0.06,0.072,0.072,0.072,0.066,0.06,0.03,0.006,0.018,0.018,0.03,0.03,0.03,0.042,0.048,0.036,0.036,0.024,0.018,0.018,0.036,0.048,0.078,0.072,0.072,0.084,0.09,0.084,0.072,0.048,0.03,0.036,0.042,0.042,0.042,0.042,0.042,0.036,0.036,0.03,0.03,0.018,0.024,0.018,0.006,0.03,0.036,0.036,0.036,0.042,0.048,0.048,0.042,0.006,0.006,0.018,0.006,0.006,0.048,0.048,0.042,0.042,0.036,0.03,0.018,0.006,0.024,0.03,0.036,0.048,0.054,0.054,0.054,0.06,0.06,0.06,0.054,0.054,0.03,0.024,0.03,0.042,0.042,0.036,0.036,0.03,0.03,0.024,0.036,0.018,0.036,0.054,0.066,0.066,0.072,0.072,0.072,0.066,0.066,0.066,0.06,0.054,0.042,0.036,0.036,0.042,0.042,0.042,0.03];
        var expectedColorValue_so2 = [0.0065,0.0075,0.0045,0.0065,0.0045,0.0055,0.005,0.0055,0.0065,0.006,0.007,0.0055,0.0045,0.0045,0.004,0.0045,0.0045,0.0045,0.0095,0.007,0.007,0.0075,0.009,0.0075,0.0065,0.005,0.0035,0.0025,0.002,0.0015,0.0015,0.0015,0.0025,0.0015,0.004,0.003,0.0035,0.003,0.0015,0.0015,0.005,0.002,0.0015,0.0035,0.0055,0.0015,0.003,0.0015,0.0015,0.001,0.0005,0.001,0.001,0.001,0.001,0.001,0.0005,0.0005,0.0005,0.0005,0.0005,0.0005,0.0005,0.001,0.0015,0.0005,0.002,0.001,0.001,0.001,0.0005,0.0005,0.001,0.001,0.0005,0.0005,0.0005,0.0005,0.0005,0.0005,0.001,0.0015,0.0015,0.0025,0.003,0.0025,0.003,0.0025,0.0035,0.003,0.0035,0.0035,0.0035,0.0035,0.003,0.003,0.003,0.003,0.0025,0.002,0.0025,0.0025,0.003,0.0035,0.0045,0.006,0.011,0.013,0.012,0.009,0.0075,0.0065,0.008,0.0065,0.008,0.0085,0.0065,0.008,0.0065,0.0065,0.006,0.0045,0.0045,0.004,0.0035,0.003,0.0035,0.003,0.003,0.003,0.003,0.0035,0.004,0.0035,0.004,0.0045,0.0045];


        var controllerManager = require('../../controllers/controllerManager');
        global.manager = new controllerManager();
        controller.getImaggPath = function(type, callback){
            if(type === 'PM10'){
                return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: image_pm10_url});
            }else if(type === 'PM25') {
                return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: image_pm25_url});
            }else if(type === 'NO2'){
                return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: image_NO2_url});
            }else if(type === 'O3'){
                return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: image_O3_url});
            }else if(type === 'SO2'){
                return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: image_SO2_url});

            }else{
                log.info('KAQ Modelimg Case > woring type : ', type);
                return '_no_image_url_';
            }
        };

        controller.taskModelImgCaseMgr(function(err, pixel){
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
                var list = [];
                result.hourly.forEach((item)=>{list.push(item.val)});
                log.info(JSON.stringify(list));
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
                    var list = [];
                    result.hourly.forEach((item)=>{list.push(item.val)});
                    log.info(JSON.stringify(list));
                    for(var i = 0 ; i<expectedColorValue_pm25.length ; i++){
                        assert.equal(result.hourly[i].val, expectedColorValue_pm25[i], '2 No matched PM 25 color value : '+i);
                    }


                    controller.getDustInfo(geocode.lat, geocode.lon, 'NO2', 'airkorea', function(err, result) {
                        if (err) {
                            log.info('4. ERROR!!!!');
                            assert.fail();
                            return done();
                        }

                        //log.info(JSON.stringify(result));
                        log.info('NO2 pubDate : ', result.pubDate);
                        var list = [];
                        result.hourly.forEach((item)=> {
                            list.push(item.val)
                        });
                        log.info(JSON.stringify(list));
                        for (var i = 0; i < expectedColorValue_no2.length; i++) {
                            assert.equal(result.hourly[i].val, expectedColorValue_no2[i], '3 No matched NO2 color value : ' + i);
                        }

                        controller.getDustInfo(geocode.lat, geocode.lon, 'O3', 'airkorea', function(err, result) {
                            if (err) {
                                log.info('5. ERROR!!!!');
                                assert.fail();
                                return done();
                            }

                            //log.info(JSON.stringify(result));
                            log.info('O3 pubDate : ', result.pubDate);
                            var list = [];
                            result.hourly.forEach((item)=> {
                                list.push(item.val)
                            });
                            log.info(JSON.stringify(list));
                            for (var i = 0; i < expectedColorValue_o3.length; i++) {
                                assert.equal(result.hourly[i].val, expectedColorValue_o3[i], '4 No matched O3 color value : ' + i);
                            }

                            controller.getDustInfo(geocode.lat, geocode.lon, 'SO2', 'airkorea', function(err, result) {
                                if (err) {
                                    log.info('6. ERROR!!!!');
                                    assert.fail();
                                    return done();
                                }

                                //log.info(JSON.stringify(result));
                                log.info('SO2 pubDate : ', result.pubDate);
                                var list = [];
                                result.hourly.forEach((item)=> {
                                    list.push(item.val)
                                });
                                log.info(JSON.stringify(list));
                                for (var i = 0; i < expectedColorValue_so2.length; i++) {
                                    assert.equal(result.hourly[i].val, expectedColorValue_so2[i], '5 No matched SO2 color value : ' + i);
                                }

                                done();
                            });

                        });
                    });
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

        var expectedRes_pm10 = [{"r":255,"g":11,"b":1,"val":999},{"r":253,"g":42,"b":7,"val":120},{"r":255,"g":51,"b":0,"val":116},{"r":255,"g":70,"b":0,"val":112},{"r":254,"g":87,"b":1,"val":108},{"r":254,"g":122,"b":1,"val":104},{"r":254,"g":138,"b":1,"val":100},{"r":252,"g":166,"b":4,"val":96},{"r":255,"g":195,"b":1,"val":92},{"r":255,"g":211,"b":1,"val":88},{"r":255,"g":227,"b":1,"val":84},{"r":251,"g":255,"b":6,"val":80},{"r":231,"g":255,"b":27,"val":76},{"r":215,"g":255,"b":43,"val":72},{"r":179,"g":255,"b":79,"val":68},{"r":163,"g":255,"b":95,"val":64},{"r":143,"g":255,"b":115,"val":60},{"r":122,"g":244,"b":125,"val":56},{"r":91,"g":255,"b":167,"val":52},{"r":75,"g":255,"b":183,"val":48},{"r":55,"g":255,"b":203,"val":44},{"r":23,"g":255,"b":236,"val":40},{"r":3,"g":255,"b":255,"val":36},{"r":1,"g":243,"b":255,"val":32},{"r":1,"g":207,"b":255,"val":28},{"r":1,"g":191,"b":255,"val":24},{"r":1,"g":171,"b":255,"val":20},{"r":0,"g":135,"b":255,"val":16},{"r":0,"g":119,"b":255,"val":12},{"r":0,"g":103,"b":255,"val":8},{"r":0,"g":67,"b":255,"val":4},{"r":0,"g":48,"b":255,"val":0}];

        var parser = new (require('../../lib/kaq.finedust.image.parser'))();
        var image_url = './test/testImageParser/kma_modelimg_case4_PM10.09KM.Animation.gif';

        parser.getPixelMap(image_url, 'CASE4', 'image/gif', null, function(err, pixels){
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


        var expectedRes_pm25 =[{"r":255,"g":0,"b":0,"val":999},{"r":255,"g":20,"b":1,"val":120},{"r":255,"g":51,"b":2,"val":116},{"r":255,"g":87,"b":1,"val":112},{"r":255,"g":123,"b":1,"val":108},{"r":255,"g":123,"b":1,"val":104},{"r":255,"g":139,"b":1,"val":100},{"r":255,"g":159,"b":0,"val":96},{"r":255,"g":195,"b":1,"val":92},{"r":255,"g":195,"b":1,"val":88},{"r":253,"g":232,"b":10,"val":84},{"r":251,"g":255,"b":6,"val":80},{"r":231,"g":255,"b":27,"val":76},{"r":215,"g":255,"b":43,"val":72},{"r":179,"g":255,"b":79,"val":68},{"r":175,"g":254,"b":105,"val":64},{"r":169,"g":255,"b":101,"val":60},{"r":127,"g":255,"b":131,"val":56},{"r":91,"g":255,"b":167,"val":52},{"r":76,"g":254,"b":185,"val":48},{"r":55,"g":255,"b":203,"val":44},{"r":23,"g":255,"b":236,"val":40},{"r":1,"g":243,"b":255,"val":36},{"r":11,"g":244,"b":251,"val":32},{"r":0,"g":207,"b":255,"val":28},{"r":1,"g":191,"b":255,"val":24},{"r":1,"g":171,"b":255,"val":20},{"r":2,"g":137,"b":255,"val":16},{"r":3,"g":105,"b":254,"val":12},{"r":3,"g":105,"b":254,"val":8},{"r":1,"g":68,"b":255,"val":4},{"r":1,"g":49,"b":255,"val":0}];

        var parser = new (require('../../lib/kaq.finedust.image.parser'))();
        var image_url = './test/testImageParser/kma_modelimg_case4_PM2_5.09KM.Animation.gif';

        parser.getPixelMap(image_url, 'CASE4', 'image/gif', null, function(err, pixels){
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
        var controller = new (require('../../controllers/kaq.modelimg.case.controller.js'))();
        var image_pm10_url = './test/testImageParser/kma_modelimg_case4_PM10.09KM.Animation.gif';
        var image_pm25_url = './test/testImageParser/kma_modelimg_case4_PM2_5.09KM.Animation.gif';
        var geocode = {lat: 37.5081798, lon : 130.8217127};

        var controllerManager = require('../../controllers/controllerManager');
        global.manager = new controllerManager();
        controller.getImaggPath = function(type, callback){
            if(type === 'PM10'){
                return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: image_pm10_url});
            }
            return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: image_pm25_url});
        };

        controller.taskModelImgCaseMgr(function(err, pixel){
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




describe('Test - NO2, O3, SO2 modelimg  parser ', function(){

    it('get map pixels', function(done){
        var parser = new (require('../../lib/kaq.finedust.image.parser'))();
        var image_url = './test/testImageParser/kma_modelimg_NO2.09KM.Animation.gif';
        var imageData = {
            width: parseInt(kaqModelimg.size.width),
            height: parseInt(kaqModelimg.size.height),
            map_width: parseInt(kaqModelimg.pixel_pos.right) - parseInt(kaqModelimg.pixel_pos.left),
            map_height: parseInt(kaqModelimg.pixel_pos.bottom) - parseInt(kaqModelimg.pixel_pos.top)
        };

        parser.getPixelMap(image_url, 'modelimg', 'image/gif', null, function(err, pixels){
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
        var controller = new (require('../../controllers/kaq.modelimg.controller'))();
        var image_pm10_url = './test/testImageParser/kma_modelimg_PM10.09KM.Animation.gif';
        var image_pm25_url = './test/testImageParser/kma_modelimg_PM2_5.09KM.Animation.gif';
        var image_no2_url = './test/testImageParser/kma_modelimg_NO2.09KM.Animation.gif';
        var image_o3_url = './test/testImageParser/kma_modelimg_O3.09KM.Animation.gif';
        var image_so2_url = './test/testImageParser/kma_modelimg_SO2.09KM.Animation.gif';
        //var geocode = {lat: 35.8927778, lon : 129.4949194};
        //var geocode = {lat : 35.1569750, lon : 126.8533639}; // 광주광역시
        //var geocode = {lat : 37.7491361, lon : 128.8784972};    //강릉시
        //var geocode = {lat : 35.8685417, lon : 128.6035528}; // 대구광역시
        var geocode = {lat : 37.5635694, lon : 126.9800083}; // 서울특별시
        //var geocode = {lat : 35.1322, lon : 129.1075};  // 부산광역시

        var expectedColorValue_pm10 = [
            36,44,44,44,56,60,64,68,72,72,76,76,76,60,48,36,36,
            36,36,28,32,28,40,32,36,60,44,48,32,72,72,44,52,60,
            64,76,72,64,56,40,32,28,20,20,20,20,28,28,36,40,48,
            44,40,44,44,24,4,8,12,8,8,8,8,8,12,12,12,12,12,12,12,
            12,12,12,12,12,12,16,16,16,16,4,4,4,8,8,4,4,4,4,4,4,4,
            4,4,4,4,4,4,4,4,4,4,12,16,24,28,32,36,48,40,32,32,36,36,
            36,36,36,36,36,36,36,32,28,20,24,32,32,32,32,32,32,32,28,
            28,28,28];
        var expectedColorValue_pm25 = [
            28,24,28,28,28,28,28,32,32,36,36,36,32,28,24,24,24,
            20,20,16,20,24,28,24,28,32,20,4,4,4,4,4,8,8,16,8,8,
            8,8,8,8,8,8,8,8,8,8,8,8,8,12,12,12,12,16,16,20,16,
            4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,8,8,12,16,24,
            28,32,32,32,28,20,20,20,20,20,24,20,20,20,24,24,24,
            20,24,32,32,28,28,32,28,28,28,28,24,24,24,24,24,24,
            24,24,24,24,24,20,20,20,20,24,24,24,24,24,24,20,16,
            16,20,20,20];
        var expectedColorValue_no2 = [0.0765,0.0666,0.0165,0.0565,0.0099,0.0099,0.04,0.0565,0.0765,0.0732,0.0765,0.0666,0.06,0.0565,0.0499,0.04,0.04,0.0332,0.0132,0.0099,0.0299,0.0365,0.0365,0.06,0.0532,0.0332,0.0233,0.0433,0.0165,0.0165,0.0165,0.0466,0.0532,0.0666,0.0699,0.0466,0.0466,0.0299,0.02,0.0132,0.0099,0.02,0.0099,0.0132,0.0165,0.0433,0.0565,0.0466,0.0633,0.0666,0.0666,0.0666,0.0666,0.0633,0.0433,0.0433,0.0633,0.0732,0.0732,0.0532,0.0532,0.0233,0.0165,0.0132,0.0099,0.0099,0.0132,0.0132,0.0299,0.0165,0.0565,0.06,0.0666,0.0699,0.0666,0.0699,0.0732,0.0565,0.0565,0.0565,0.0765,0.0699,0.0666,0.06,0.0732,0.0732,0.0699,0.0699,0.0732,0.0699,0.0699,0.0666,0.0565,0.0633,0.06,0.0565,0.0565,0.0666,0.0932,0.06,0.06,0.06,0.0466,0.0699,0.0666,0.08,0.08,0.06,0.0466,0.0299,0.02,0.0165,0.0132,0.0132,0.0132,0.0165,0.0365,0.0565,0.06,0.06,0.0466,0.0565,0.06,0.0365,0.0633,0.0565,0.06,0.0532,0.06,0.0666,0.0633,0.0633,0.0532,0.0499,0.0299,0.0299,0.0332];
        var expectedColorValue_o3 = [0.042,0.048,0.054,0.024,0.036,0.036,0.054,0.024,0.006,0.006,0.012,0.012,0.018,0.018,0.03,0.036,0.054,0.066,0.072,0.06,0.054,0.048,0.036,0.048,0.042,0.042,0.042,0.048,0.048,0.048,0.018,0.042,0.036,0.006,0.018,0.018,0.018,0.03,0.036,0.042,0.054,0.048,0.054,0.042,0.036,0.024,0.018,0.012,0.006,0.006,0.006,0,0.012,0.024,0.018,0.018,0.012,0.006,0.012,0.018,0.03,0.054,0.054,0.06,0.072,0.072,0.06,0.054,0.06,0.036,0.024,0.018,0.018,0.012,0.012,0.03,0.006,0.024,0.012,0.012,0,0.006,0.006,0.018,0.018,0.024,0.036,0.042,0.03,0.042,0.042,0.042,0.036,0.024,0.042,0.018,0.054,0.054,0.024,0.024,0.024,0.018,0.03,0.012,0.018,0.006,0.012,0.018,0.03,0.042,0.048,0.06,0.054,0.054,0.048,0.048,0.036,0.018,0.006,0.006,0.006,0.006,0.006,0.006,0.006,0.006,0.006,0.006,0.006,0.006,0.006,0.006,0.012,0.018,0.03,0.03,0.036];
        var expectedColorValue_so2 = [0.0025,0.003,0.003,0.003,0.003,0.0035,0.0035,0.0045,0.0055,0.0045,0.0105,0.007,0.0055,0.0065,0.0055,0.005,0.005,0.005,0.004,0.0025,0.002,0.0025,0.003,0.0025,0.0025,0.0025,0.002,0.002,0.002,0.002,0.002,0.002,0.002,0.0025,0.003,0.0105,0.0035,0.007,0.004,0.003,0.0015,0.001,0.001,0.0015,0.002,0.0025,0.004,0.005,0.0065,0.008,0.0085,0.0085,0.0085,0.011,0.0115,0.009,0.0095,0.01,0.01,0.012,0.011,0.0095,0.0075,0.0055,0.005,0.005,0.005,0.005,0.005,0.0055,0.0065,0.007,0.008,0.0105,0.008,0.008,0.0115,0.012,0.0125,0.0125,0.0095,0.01,0.01,0.0095,0.01,0.0095,0.01,0.013,0.0125,0.012,0.011,0.011,0.0105,0.007,0.007,0.007,0.007,0.0075,0.008,0.0085,0.009,0.01,0.0125,0.0135,0.015,0.015,0.0135,0.0095,0.0065,0.006,0.0045,0.004,0.0035,0.003,0.0025,0.0025,0.0025,0.003,0.0035,0.0035,0.0035,0.0035,0.003,0.0025,0.002,0.0015,0.0015,0.0015,0.009,0.01,0.01,0.0085,0.003,0.0015,0.0015,0.001,0.0015];

        var controllerManager = require('../../controllers/controllerManager');
        global.manager = new controllerManager();
        controller.getImaggPath = function(type, callback){
            if(type === 'PM10'){
                return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: image_pm10_url});
            }else if(type === 'PM25') {
                return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: image_pm25_url});
            }else if(type === 'NO2'){
                return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: image_no2_url});
            }else if(type === 'O3'){
                return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: image_o3_url});
            }else{
                return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: image_so2_url});
            }
        };

        controller.taskModelImgMgr(function(err, pixel){
            if(err){
                log.info('1. ERROR!!!');
                assert.fail();
                return done();
            }
            log.info('PM10 image Count : ', pixel.PM10.data.image_count);
            controller.getDustInfo(geocode.lat, geocode.lon, 'PM10', 'airkorea', function(err, result){
                if(err){
                    log.info('2. ERROR!!!! :', err);
                    assert.fail();
                    return done();
                }

                //log.info(JSON.stringify(result));
                //var list = [];
                //result.hourly.forEach((item)=>{list.push(item.val)});
                //log.info(JSON.stringify(list));

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

                    controller.getDustInfo(geocode.lat, geocode.lon, 'NO2', 'airkorea', function(err, result){
                        if(err){
                            log.info('4. ERROR!!!!');
                            assert.fail();
                            return done();
                        }

                        //log.info(JSON.stringify(result));
                        //var list = [];
                        //result.hourly.forEach((item)=>{list.push(item.val)});
                        //log.info(JSON.stringify(list));
                        log.info('NO2 pubDate : ', result.pubDate);
                        for(var i = 0 ; i<expectedColorValue_no2.length ; i++){
                            assert.equal(result.hourly[i].val, expectedColorValue_no2[i], '3 No matched NO2 color value : '+i);
                        }

                        controller.getDustInfo(geocode.lat, geocode.lon, 'O3', 'airkorea', function(err, result){
                            if(err){
                                log.info('5. ERROR!!!!');
                                assert.fail();
                                return done();
                            }

                            //log.info(JSON.stringify(result));
                            log.info('O3 pubDate : ', result.pubDate);
                            //var list = [];
                            //result.hourly.forEach((item)=>{list.push(item.val)});
                            //log.info(JSON.stringify(list));
                            for(var i = 0 ; i<expectedColorValue_o3.length ; i++){
                                assert.equal(result.hourly[i].val, expectedColorValue_o3[i], '4 No matched O3 color value : '+i);
                            }

                            controller.getDustInfo(geocode.lat, geocode.lon, 'SO2', 'airkorea', function(err, result){
                                if(err){
                                    log.info('6. ERROR!!!!');
                                    assert.fail();
                                    return done();
                                }

                                //log.info(JSON.stringify(result));
                                log.info('SO2 pubDate : ', result.pubDate);
                                //var list = [];
                                //result.hourly.forEach((item)=>{list.push(item.val)});
                                //log.info(JSON.stringify(list));
                                for(var i = 0 ; i<expectedColorValue_so2.length ; i++){
                                    assert.equal(result.hourly[i].val, expectedColorValue_so2[i], '5 No matched SO2 color value : '+i);
                                }
                                done();
                            });
                        });
                    });
                });
            });
        });
    });

    it('get color table PM10', function(done){
        var colorPosX = 285;
        var colorPosY = [
            45, 53, 62, 70, 79, 88, 97, 106, 115,
            123, 132, 140, 149, 158, 157, 175, 184,
            192, 200, 209, 218, 226, 234, 244, 254,
            261, 270, 279, 288, 297, 305, 313];

        var dustValue_pm10 = [
            140, 120, 116, 112, 108, 104, 100, 96, 92,
            88, 84, 80, 76, 72, 68, 64, 60, 56, 52, 48,
            44, 40, 36, 32, 28, 24, 20, 16, 12, 8, 4, 0];

        var expectedRes_pm10 = [
            {"r":255,"g":15,"b":1,"val":140},{"r":255,"g":15,"b":1,"val":120},
            {"r":255,"g":49,"b":9,"val":116},{"r":255,"g":71,"b":2,"val":112},
            {"r":255,"g":87,"b":2,"val":108},{"r":255,"g":120,"b":2,"val":104},
            {"r":255,"g":138,"b":3,"val":100},{"r":255,"g":174,"b":4,"val":96},
            {"r":254,"g":199,"b":3,"val":92},{"r":254,"g":213,"b":3,"val":88},
            {"r":253,"g":228,"b":4,"val":84},{"r":251,"g":255,"b":6,"val":80},
            {"r":231,"g":255,"b":27,"val":76},{"r":216,"g":255,"b":43,"val":72},
            {"r":216,"g":255,"b":43,"val":68},{"r":165,"g":255,"b":94,"val":64},
            {"r":143,"g":255,"b":115,"val":60},{"r":127,"g":255,"b":131,"val":56},
            {"r":91,"g":255,"b":167,"val":52},{"r":75,"g":255,"b":183,"val":48},
            {"r":55,"g":255,"b":203,"val":44},{"r":23,"g":255,"b":236,"val":40},
            {"r":3,"g":255,"b":255,"val":36},{"r":1,"g":243,"b":255,"val":32},
            {"r":1,"g":206,"b":255,"val":28},{"r":0,"g":190,"b":254,"val":24},
            {"r":0,"g":171,"b":255,"val":20},{"r":0,"g":135,"b":255,"val":16},
            {"r":0,"g":119,"b":255,"val":12},{"r":0,"g":103,"b":255,"val":8},
            {"r":4,"g":71,"b":251,"val":4},{"r":1,"g":53,"b":251,"val":0}];

        var parser = new (require('../../lib/kaq.finedust.image.parser'))();
        var image_url = './test/testImageParser/kma_modelimg_PM10.09KM.Animation.gif';

        parser.getPixelMap(image_url, 'modelimg', 'image/gif', null, function(err, pixels){
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
        var colorPosX = 285;
        var colorPosY = [
            45, 60, 72, 85, 98, 110, 125, 135, 149, 160,
            172, 184, 198, 210, 225, 235, 249, 262, 274, 288, 298, 310];
        var dustValue_pm25 = [
            100, 80, 76, 72, 68, 64, 60, 56, 52, 48,
            44, 40, 36, 32, 28, 24, 20, 16, 12, 8, 4, 0];


        var expectedRes_pm25 =[
            {"r":255,"g":4,"b":3,"val":100},{"r":255,"g":36,"b":1,"val":80},
            {"r":255,"g":73,"b":2,"val":76},{"r":255,"g":108,"b":1,"val":72},
            {"r":255,"g":139,"b":0,"val":68},{"r":255,"g":175,"b":1,"val":64},
            {"r":255,"g":211,"b":0,"val":60},{"r":244,"g":249,"b":13,"val":56},
            {"r":233,"g":253,"b":25,"val":52},{"r":199,"g":255,"b":59,"val":48},
            {"r":164,"g":255,"b":95,"val":44},{"r":143,"g":255,"b":115,"val":40},
            {"r":111,"g":255,"b":147,"val":36},{"r":75,"g":255,"b":183,"val":32},
            {"r":39,"g":255,"b":219,"val":28},{"r":3,"g":255,"b":255,"val":24},
            {"r":1,"g":225,"b":255,"val":20},{"r":0,"g":191,"b":255,"val":16},
            {"r":0,"g":155,"b":255,"val":12},{"r":1,"g":120,"b":255,"val":8},
            {"r":0,"g":83,"b":255,"val":4},{"r":0,"g":46,"b":255,"val":0}];

        var parser = new (require('../../lib/kaq.finedust.image.parser'))();
        var image_url = './test/testImageParser/kma_modelimg_PM2_5.09KM.Animation.gif';

        parser.getPixelMap(image_url, 'modelimg', 'image/gif', null, function(err, pixels){
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

    it('get color table NO2', function(done){
        var colorPosX = 285;
        var colorPosY = [45, 53, 62, 70, 79, 88, 97, 106, 115, 123, 132, 140, 149, 158, 167, 175, 184, 192, 200, 209, 218, 226, 234, 244, 254, 261, 270, 279, 288, 297, 305, 313];
        var dustValue_pm25 = [0.12, 0.1, 0.0965, 0.0932, 0.0899, 0.0866, 0.0833, 0.08, 0.0765, 0.0732, 0.0699, 0.0666, 0.0633, 0.06, 0.0565, 0.0532, 0.0499, 0.0466, 0.0433, 0.04, 0.0365, 0.0332, 0.0299, 0.0266, 0.0233, 0.020, 0.0165, 0.0132, 0.0099, 0.0066, 0.0033,0];
        var expectedRes_pm25 =[{"r":255,"g":11,"b":1,"val":0.12},{"r":255,"g":20,"b":2,"val":0.1},{"r":255,"g":51,"b":1,"val":0.0965},{"r":255,"g":51,"b":1,"val":0.0932},{"r":255,"g":87,"b":1,"val":0.0899},{"r":255,"g":122,"b":1,"val":0.0866},{"r":255,"g":139,"b":1,"val":0.0833},{"r":253,"g":169,"b":7,"val":0.08},{"r":254,"g":197,"b":2,"val":0.0765},{"r":255,"g":211,"b":1,"val":0.0732},{"r":255,"g":227,"b":1,"val":0.0699},{"r":250,"g":254,"b":8,"val":0.0666},{"r":232,"g":255,"b":27,"val":0.0633},{"r":216,"g":255,"b":43,"val":0.06},{"r":181,"g":255,"b":78,"val":0.0565},{"r":142,"g":255,"b":116,"val":0.0532},{"r":142,"g":255,"b":116,"val":0.0499},{"r":127,"g":255,"b":132,"val":0.0466},{"r":91,"g":255,"b":168,"val":0.0433},{"r":75,"g":255,"b":184,"val":0.04},{"r":56,"g":255,"b":203,"val":0.0365},{"r":24,"g":255,"b":236,"val":0.0332},{"r":3,"g":254,"b":255,"val":0.0299},{"r":2,"g":243,"b":255,"val":0.0266},{"r":1,"g":206,"b":255,"val":0.0233},{"r":1,"g":191,"b":255,"val":0.02},{"r":1,"g":171,"b":255,"val":0.0165},{"r":0,"g":135,"b":255,"val":0.0132},{"r":0,"g":119,"b":255,"val":0.0099},{"r":0,"g":103,"b":255,"val":0.0066},{"r":0,"g":67,"b":255,"val":0.0033},{"r":0,"g":46,"b":255,"val":0}];
        var parser = new (require('../../lib/kaq.finedust.image.parser'))();
        var image_url = './test/testImageParser/kma_modelimg_NO2.09KM.Animation.gif';

        parser.getPixelMap(image_url, 'modelimg', 'image/gif', null, function(err, pixels){
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

    it('get color table O3', function(done){
        var colorPosX = 285;
        var colorPosY = [45, 53, 62, 70, 79, 88, 97, 106, 115, 123, 132, 140, 149, 158, 167, 175, 184, 192, 200, 209, 218, 226, 234, 244, 254, 261, 270, 279, 288, 297, 305, 313];
        var dustValue_pm25 = [0.2, 0.18, 0.174, 0.168, 0.162, 0.156, 0.15, 0.144, 0.138, 0.132, 0.126, 0.12, 0.114, 0.108, 0.102, 0.096, 0.09, 0.084, 0.078, 0.072, 0.066, 0.06, 0.054, 0.048, 0.042, 0.036, 0.03, 0.024, 0.018, 0.012, 0.006, 0];
        var expectedRes_pm25 = [{"r":255,"g":11,"b":3,"val":0.2},{"r":255,"g":11,"b":3,"val":0.18},{"r":255,"g":52,"b":1,"val":0.174},{"r":255,"g":72,"b":1,"val":0.168},{"r":255,"g":87,"b":1,"val":0.162},{"r":255,"g":123,"b":1,"val":0.156},{"r":255,"g":139,"b":1,"val":0.15},{"r":255,"g":153,"b":1,"val":0.144},{"r":255,"g":200,"b":2,"val":0.138},{"r":253,"g":214,"b":3,"val":0.132},{"r":253,"g":214,"b":3,"val":0.126},{"r":242,"g":242,"b":17,"val":0.12},{"r":242,"g":242,"b":17,"val":0.114},{"r":215,"g":255,"b":44,"val":0.108},{"r":181,"g":255,"b":78,"val":0.102},{"r":168,"g":255,"b":90,"val":0.096},{"r":145,"g":255,"b":113,"val":0.09},{"r":125,"g":255,"b":133,"val":0.084},{"r":91,"g":255,"b":167,"val":0.078},{"r":75,"g":255,"b":183,"val":0.072},{"r":55,"g":255,"b":203,"val":0.066},{"r":23,"g":255,"b":236,"val":0.06},{"r":3,"g":255,"b":255,"val":0.054},{"r":1,"g":243,"b":255,"val":0.048},{"r":1,"g":207,"b":255,"val":0.042},{"r":1,"g":191,"b":255,"val":0.036},{"r":1,"g":171,"b":255,"val":0.03},{"r":0,"g":135,"b":255,"val":0.024},{"r":0,"g":119,"b":255,"val":0.018},{"r":0,"g":103,"b":255,"val":0.012},{"r":0,"g":67,"b":255,"val":0.006},{"r":0,"g":46,"b":255,"val":0}];
        var parser = new (require('../../lib/kaq.finedust.image.parser'))();
        var image_url = './test/testImageParser/kma_modelimg_O3.09KM.Animation.gif';

        parser.getPixelMap(image_url, 'modelimg', 'image/gif', null, function(err, pixels){
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

    it('get color table SO2', function(done){
        var colorPosX = 285;
        var colorPosY = [48, 55, 64, 73, 82, 90, 98, 107, 115, 124, 130, 140, 149, 156, 165, 173, 182, 191, 199, 201, 210, 215, 223, 231, 241, 250, 258, 266, 274, 284, 292, 300, 309];
        var dustValue_pm25 = [0.0160, 0.0150, 0.0145, 0.0140, 0.0135, 0.0130, 0.0125, 0.0120, 0.0115, 0.0110, 0.0105, 0.0100, 0.0095, 0.0090, 0.0085, 0.0080, 0.0075, 0.0070, 0.0065, 0.0060, 0.0055, 0.0050, 0.0045, 0.0040, 0.0035, 0.0030, 0.0025, 0.0020, 0.0015, 0.0010, 0.0005, 0];
        var expectedRes_pm25 = [{"r":255,"g":255,"b":255,"val":0.016},{"r":255,"g":255,"b":255,"val":0.015},{"r":255,"g":255,"b":255,"val":0.0145},{"r":255,"g":255,"b":255,"val":0.014},{"r":255,"g":255,"b":255,"val":0.0135},{"r":255,"g":255,"b":255,"val":0.013},{"r":255,"g":255,"b":255,"val":0.0125},{"r":255,"g":255,"b":255,"val":0.012},{"r":255,"g":255,"b":255,"val":0.0115},{"r":255,"g":255,"b":255,"val":0.011},{"r":255,"g":255,"b":255,"val":0.0105},{"r":255,"g":255,"b":255,"val":0.01},{"r":255,"g":255,"b":255,"val":0.0095},{"r":255,"g":255,"b":255,"val":0.009},{"r":255,"g":255,"b":255,"val":0.0085},{"r":255,"g":255,"b":255,"val":0.008},{"r":255,"g":255,"b":255,"val":0.0075},{"r":255,"g":255,"b":255,"val":0.007},{"r":255,"g":255,"b":255,"val":0.0065},{"r":255,"g":255,"b":255,"val":0.006},{"r":255,"g":255,"b":255,"val":0.0055},{"r":255,"g":255,"b":255,"val":0.005},{"r":255,"g":255,"b":255,"val":0.0045},{"r":255,"g":255,"b":255,"val":0.004},{"r":255,"g":255,"b":255,"val":0.0035},{"r":255,"g":255,"b":255,"val":0.003},{"r":255,"g":255,"b":255,"val":0.0025},{"r":255,"g":255,"b":255,"val":0.002},{"r":255,"g":255,"b":255,"val":0.0015},{"r":255,"g":255,"b":255,"val":0.001},{"r":255,"g":255,"b":255,"val":0.0005},{"r":255,"g":255,"b":255,"val":0},{"r":255,"g":255,"b":255}];
        var parser = new (require('../../lib/kaq.finedust.image.parser'))();
        var image_url = './test/testImageParser/kma_modelimg_SO2.09KM.Animation.gif';

        parser.getPixelMap(image_url, 'modelimg', 'image/gif', null, function(err, pixels){
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
        var controller = new (require('../../controllers/kaq.modelimg.controller.js'))();
        var image_pm10_url = './test/testImageParser/kma_modelimg_PM10.09KM.Animation.gif';
        var image_pm25_url = './test/testImageParser/kma_modelimg_PM2_5.09KM.Animation.gif';
        var geocode = {lat: 37.5081798, lon : 130.8217127};

        var controllerManager = require('../../controllers/controllerManager');
        global.manager = new controllerManager();
        controller.getImaggPath = function(type, callback){
            if(type === 'PM10'){
                return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: image_pm10_url});
            }
            return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: image_pm25_url});
        };

        controller.startModelimgMgr(function(err, pixel){
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
