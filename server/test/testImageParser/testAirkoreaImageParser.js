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
var airkoreaImage = config.image.airkorea_korea_image;

global.log  = new Logger(__dirname + "/debug.log");

var town = require('../../models/town');

describe('Test - Airkorea Image parser ', function(){
    it('get pm10 map pixels', function(done){
        var parser = new (require('../../lib/airkorea.finedust.image.parser'))();

        //var image_url = './test/testImageParser/dust_test_image.png';
        var image_url = './test/testImageParser/airkorea_image_pm10.gif';
        var imageData = {
            width: parseInt(airkoreaImage.size.width),
            height: parseInt(airkoreaImage.size.height),
            map_width: parseInt(airkoreaImage.pixel_pos.right) - parseInt(airkoreaImage.pixel_pos.left),
            map_height: parseInt(airkoreaImage.pixel_pos.bottom) - parseInt(airkoreaImage.pixel_pos.top)
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
/*
    it('store pixel map of Airkorea Image', function(done){
        var mongoose = require('mongoose');
        var options = { server: { socketOptions: { keepAlive: 1, connectTimeoutMS: 30000 } },
            replset: { socketOptions: { keepAlive: 1, connectTimeoutMS : 30000 } },
            mongos: true };

        mongoose.Promise = global.Promise;
        mongoose.connect(config.db.path, options, function(err) {
            if (err) {
                log.error('Could not connect to MongoDB! ' + config.db.path);
                log.error(err);
            }
        });

        var airkoreaController = new (require('../../controllers/airkorea.dust.image.controller'))();
        var image_url = './image.gif';

        airkoreaController.parseMapImage(image_url, 'image/gif', function(err, pixel){
            if(err){
                return done();
            }

            airkoreaController.savePixelMap('201711051200', '201711061800', image_url, pixel, function(err){
                if(err){
                    return done();
                }

                log.info('finished to save successfully');
                done();
            });
        });
    });
*/
    it('dust image', function(done){
        var controller = new (require('../../controllers/airkorea.dust.image.controller'))();
        var image_pm10_url = './test/testImageParser/airkorea_image_pm10.gif';
        var image_pm25_url = './test/testImageParser/airkorea_image_pm25.gif';
        var geocode = {lat: 35.8927778, lon : 129.4949194};
        /*
        var expectedRes = [
            {"r":152,"g":201,"b":228},{"r":152,"g":201,"b":228},
            {"r":152,"g":201,"b":228},{"r":54,"g":74,"b":86},
            {"r":10,"g":12,"b":12},{"r":12,"g":18,"b":23},
            {"r":12,"g":25,"b":38},{"r":22,"g":61,"b":100},
            {"r":12,"g":27,"b":12},{"r":0,"g":119,"b":0},
            {"r":52,"g":137,"b":52},{"r":67,"g":169,"b":67},
            {"r":42,"g":121,"b":200},{"r":39,"g":109,"b":180},
            {"r":51,"g":109,"b":163},{"r":81,"g":135,"b":183},
            {"r":92,"g":161,"b":221},{"r":103,"g":147,"b":178},
            {"r":82,"g":116,"b":140},{"r":112,"g":159,"b":192},
            {"r":124,"g":177,"b":214},{"r":130,"g":184,"b":222},
            {"r":135,"g":192,"b":232},{"r":100,"g":175,"b":240},
            {"r":100,"g":175,"b":240},{"r":130,"g":184,"b":222},
            {"r":76,"g":133,"b":183},{"r":70,"g":121,"b":166},
            {"r":40,"g":73,"b":103},{"r":36,"g":61,"b":84},
            {"r":23,"g":40,"b":56},{"r":1,"g":2,"b":2},
            {"r":1,"g":2,"b":2},{"r":57,"g":106,"b":151},
            {"r":100,"g":175,"b":240},{"r":100,"g":175,"b":240},
            {"r":100,"g":175,"b":240},{"r":100,"g":175,"b":240},
            {"r":100,"g":175,"b":240},{"r":100,"g":175,"b":240},
            {"r":100,"g":175,"b":240},{"r":135,"g":192,"b":232},
            {"r":135,"g":192,"b":232},{"r":100,"g":175,"b":240},
            {"r":100,"g":175,"b":240},{"r":135,"g":192,"b":232},
            {"r":135,"g":192,"b":232},{"r":135,"g":192,"b":232}];
        */
        var expectedColorValue_pm10 = [
            6,6,6,6,6,18,18,24,40,80,
            40,40,30,30,24,18,18,6,6,6,6,
            6,6,18,18,6,18,18,18,18,18,
            18,18,18,18,18,18,18,18,18,18,
            6,6,18,18,6,6,6];

        var expectedColorValue_pm25 = [
            43,22,19,15,15,12,12,12,
            12,12,12,12,12,12,12,15,
            15,19,26,22,19,15,19,22,
            26,26,26,26,22,19,19,19,
            15,15,12,12,12,12,12,12,
            12,15,19,22,22,22,22,22
        ];

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
        var colorPosX = 686;
        var colorPosY = [
                            88, 106, 128, 147, 165, 182, 205, 222, 243, 259, 279,
                            296, 320, 337, 360, 380, 400, 422, 439, 460, 479,
                            499, 517, 527, 554, 575, 595, 614, 634, 654, 672,
                            693, 711, 731, 740, 770, 789
        ];
        var dustValue_pm10 = [
                            0, 6, 12, 18, 24, 30,
                            35, 40,45, 50, 55, 60, 65, 70, 75, 80,
                            87, 94, 101, 108, 115, 122, 129, 136, 143, 150,
                            160, 170, 180, 190, 200, 220, 240, 260, 280, 320, 999
        ];

        var expectedRes_pm10 = [
            {"r":104,"g":0,"b":0,"val":999},{"r":142,"g":0,"b":0,"val":320},
            {"r":179,"g":0,"b":0,"val":280},{"r":179,"g":0,"b":0,"val":260},
            {"r":205,"g":0,"b":0,"val":240},{"r":242,"g":0,"b":0,"val":220},
            {"r":242,"g":0,"b":0,"val":200},{"r":255,"g":59,"b":59,"val":190},
            {"r":255,"g":90,"b":90,"val":180},{"r":255,"g":120,"b":120,"val":170},
            {"r":255,"g":150,"b":150,"val":160},{"r":100,"g":100,"b":0,"val":150},
            {"r":115,"g":115,"b":0,"val":143},{"r":131,"g":131,"b":0,"val":136},
            {"r":146,"g":146,"b":0,"val":129},{"r":162,"g":162,"b":0,"val":122},
            {"r":177,"g":177,"b":0,"val":115},{"r":193,"g":193,"b":0,"val":108},
            {"r":208,"g":208,"b":0,"val":101},{"r":224,"g":224,"b":0,"val":94},
            {"r":240,"g":240,"b":0,"val":87},{"r":0,"g":119,"b":0,"val":80},
            {"r":0,"g":138,"b":0,"val":75},{"r":0,"g":158,"b":0,"val":70},
            {"r":0,"g":177,"b":0,"val":65},{"r":0,"g":196,"b":0,"val":60},
            {"r":0,"g":216,"b":0,"val":55},{"r":0,"g":235,"b":0,"val":50},
            {"r":0,"g":255,"b":0,"val":45},{"r":100,"g":255,"b":100,"val":40},
            {"r":150,"g":255,"b":150,"val":35},{"r":53,"g":151,"b":250,"val":30},
            {"r":76,"g":163,"b":245,"val":24},{"r":100,"g":175,"b":240,"val":18},
            {"r":100,"g":175,"b":240,"val":12},{"r":152,"g":201,"b":228,"val":6},
            {"r":170,"g":210,"b":225,"val":0}];
        var parser = new (require('../../lib/airkorea.finedust.image.parser'))();
        var image_url = './test/testImageParser/airkorea_image_pm10.gif';

        var imageData = {
            width: parseInt(airkoreaImage.size.width),
            height: parseInt(airkoreaImage.size.width),
            map_width: parseInt(airkoreaImage.pixel_pos.right) - parseInt(airkoreaImage.pixel_pos.left),
            map_height: parseInt(airkoreaImage.pixel_pos.bottom) - parseInt(airkoreaImage.pixel_pos.top)
        };

        parser.getPixelMap(image_url, 'image/gif', null, function(err, pixels){
            if(err){
                log.error('Error !! : ', err);
                assert.equal(null, imageData, 'Fail to get pixels data');
                done();
            }
            var result = [];
            for(var i=0 ; i<colorPosY.length ; i++){
                result.push({
                    r: pixels.pixels.get(0, colorPosX, colorPosY[i], 0),
                    g: pixels.pixels.get(0, colorPosX, colorPosY[i], 1),
                    b: pixels.pixels.get(0, colorPosX, colorPosY[i], 2),
                    val: dustValue_pm10[dustValue_pm10.length - (i+1)]
                });
            }

            log.info(JSON.stringify(result));
            for(i=0 ; i<expectedRes_pm10.length ; i++){
                assert.equal(result[i].r, expectedRes_pm10[i].r, 'No matched R color value : '+i);
                assert.equal(result[i].g, expectedRes_pm10[i].g, 'No matched R color value : '+i);
                assert.equal(result[i].b, expectedRes_pm10[i].b, 'No matched R color value : '+i);
                assert.equal(result[i].val, expectedRes_pm10[i].val, 'No matched dust value : '+i);
            }
            done();
        });
    });


    it('get color table PM25', function(done){
        var colorPosX = 686;
        var colorPosY = [
            88, 106, 128, 147, 165, 182, 205, 222, 243, 259, 279,
            296, 320, 337, 360, 380, 400, 422, 439, 460, 479,
            499, 517, 527, 554, 575, 595, 614, 634, 654, 672,
            693, 711, 731, 740, 770, 789
        ];

        var dustValue_pm25 = [
            0, 3, 6, 9, 12, 15,
            19, 22, 26, 29, 32, 36, 39, 43, 46, 50,
            55, 60, 65, 70, 75, 80, 85, 90, 95, 100,
            110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 999
        ];

        var expectedRes_pm25 =[
            {"r":104,"g":0,"b":0,"val":999},{"r":142,"g":0,"b":0,"val":200},
            {"r":179,"g":0,"b":0,"val":190},{"r":179,"g":0,"b":0,"val":180},
            {"r":205,"g":0,"b":0,"val":170},{"r":230,"g":0,"b":0,"val":160},
            {"r":255,"g":0,"b":0,"val":150},{"r":255,"g":59,"b":59,"val":140},
            {"r":255,"g":90,"b":90,"val":130},{"r":255,"g":120,"b":120,"val":120},
            {"r":255,"g":150,"b":150,"val":110},{"r":107,"g":107,"b":0,"val":100},
            {"r":139,"g":139,"b":0,"val":95},{"r":139,"g":139,"b":0,"val":90},
            {"r":170,"g":170,"b":0,"val":85},{"r":139,"g":139,"b":0,"val":80},
            {"r":201,"g":201,"b":0,"val":75},{"r":201,"g":201,"b":0,"val":70},
            {"r":201,"g":201,"b":0,"val":65},{"r":201,"g":201,"b":0,"val":60},
            {"r":232,"g":232,"b":0,"val":55},{"r":0,"g":119,"b":0,"val":50},
            {"r":0,"g":138,"b":0,"val":46},{"r":0,"g":158,"b":0,"val":43},
            {"r":0,"g":178,"b":0,"val":39},{"r":0,"g":197,"b":0,"val":36},
            {"r":0,"g":216,"b":0,"val":32},{"r":0,"g":235,"b":0,"val":29},
            {"r":0,"g":255,"b":0,"val":26},{"r":100,"g":255,"b":100,"val":22},
            {"r":150,"g":255,"b":150,"val":19},{"r":53,"g":151,"b":250,"val":15},
            {"r":76,"g":163,"b":245,"val":12},{"r":100,"g":175,"b":240,"val":9},
            {"r":100,"g":175,"b":240,"val":6},{"r":152,"g":201,"b":228,"val":3},
            {"r":170,"g":209,"b":224,"val":0}];

        var parser = new (require('../../lib/airkorea.finedust.image.parser'))();
        var image_url = './test/testImageParser/airkorea_image_pm25.gif';
        var imageData = {
            width: parseInt(airkoreaImage.size.width),
            height: parseInt(airkoreaImage.size.width),
            map_width: parseInt(airkoreaImage.pixel_pos.right) - parseInt(airkoreaImage.pixel_pos.left),
            map_height: parseInt(airkoreaImage.pixel_pos.bottom) - parseInt(airkoreaImage.pixel_pos.top)
        };

        parser.getPixelMap(image_url, 'image/gif', null, function(err, pixels){
            if(err){
                log.error('Error !! : ', err);
                assert.equal(null, imageData, 'Fail to get pixels data');
                done();
            }
            var result = [];
            for(var i=0 ; i<colorPosY.length ; i++){
                result.push({
                    r: pixels.pixels.get(0, colorPosX, colorPosY[i], 0),
                    g: pixels.pixels.get(0, colorPosX, colorPosY[i], 1),
                    b: pixels.pixels.get(0, colorPosX, colorPosY[i], 2),
                    val: dustValue_pm25[dustValue_pm25.length - (i+1)]
                });
            }

            log.info(JSON.stringify(result));
            for(i=0 ; i<expectedRes_pm25.length ; i++){
                assert.equal(result[i].r, expectedRes_pm25[i].r, 'No matched R color value : '+i);
                assert.equal(result[i].g, expectedRes_pm25[i].g, 'No matched R color value : '+i);
                assert.equal(result[i].b, expectedRes_pm25[i].b, 'No matched R color value : '+i);
                assert.equal(result[i].val, expectedRes_pm25[i].val, 'No matched dust value : '+i);
            }
            done();
        });
    });

    it('invalid area', function(done){
        var controller = new (require('../../controllers/airkorea.dust.image.controller'))();
        var image_pm10_url = './test/testImageParser/airkorea_image_pm10.gif';
        var image_pm25_url = './test/testImageParser/airkorea_image_pm25.gif';
        var geocode = {lat: 37.5081798, lon : 130.8217127}; // 경상북도 울릉군 서면태하

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