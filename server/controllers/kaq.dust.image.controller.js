/**
 * Created by Peter on 2018. 3. 12..
 */

"use strict";
//var fs = require('fs');
var url = require('url');
var async = require('async');
var kmaTimeLib = require('../lib/kmaTimeLib');
var libKaqImageParser = require('../lib/kaq.finedust.image.parser.js');
var AqiConverter = require('../lib/aqi.converter');

class KaqDustImageController{
    constructor(){
        this.colorTable = {
            PM10: [],
            PM25: []
        };
        this.value_pos = {
            PM10 : [50, 59, 68, 77, 86, 95, 100, 109, 118, 127, 136, 145, 152, 161, 170, 179, 188, 197, 205, 214, 223, 232, 241, 250, 257, 266, 275, 284, 293, 302, 311, 320],
            PM25 : [50, 62, 76, 90, 102, 114, 128, 140, 152, 164, 178, 190, 204, 216, 228, 240, 254, 268, 280, 292, 304, 318]
        };
        this.value = {
            PM10 : [150, 120, 116, 112, 108, 104, 100, 96, 92, 88, 84, 80, 76, 72, 68, 64, 60, 56, 52, 48, 44, 40, 36, 32, 28, 24, 20, 16, 12, 8, 4, 0],
            PM25 : [100, 80, 76, 72, 68, 64, 60, 56, 52, 48, 44, 40, 36, 32, 28, 24, 20, 16, 12, 8, 4, 0]
        };
        this.parser = new libKaqImageParser();
        this.imagePixels = {};
        this.coordinate = this.parser.getDefaultCoordi();
        return this;
    }

    /**
     *
     * @param path
     * @param type
     * @param callback
     * @returns {*}
     */
    parseMapImage(path, type, callback){
        if(this.parser === undefined){
            return callback(new Error('Need to init KaqDustImageController'));
        }

        this.parser.getPixelMap(path, type, this.coordinate, (err, pixelMap)=>{
            if(err){
                return callback(err);
            }
            log.info('KAQ Image > get Image Pixel map');
            return callback(null, pixelMap);
        });
    }

    /**
     *
     * @param lat
     * @param lon
     * @returns {boolean}
     * @private
     */
    _isValidGeocode(lat, lon){
        if(lat > this.coordinate.top_left.lat) return false;
        if(lat < this.coordinate.bottom_left.lat) return false;
        if(lon < this.coordinate.top_left.lon) return false;
        if(lon > this.coordinate.top_right.lon) return false;
        return true;
    }

    /**
     *
     * @param lat
     * @param lon
     * @param type
     * @param aqiUnit
     * @param callback
     * @returns {*}
     */
    getDustInfo(lat, lon, type, aqiUnit, callback){
        if(this.imagePixels[type] === undefined){
            return callback(new Error('KAQ Image > 1. There is no image information : ', type));
        }

        if(!this._isValidGeocode(lat, lon)){
            return callback(new Error('KAQ Image > 2. Invalid geocode :', lat, lon));
        }

        if(this.colorTable[type] === undefined){
            return callback(new Error('KAQ Image > 3. Invalid color grade table :', lat, lon));
        }

        let pixels = this.imagePixels[type].data;
        let x = parseInt((lon - this.coordinate.top_left.lon) / pixels.map_pixel_distance_width) + pixels.map_area.left;
        let y = parseInt((this.coordinate.top_left.lat - lat) / pixels.map_pixel_distance_height) + pixels.map_area.top;

        if(x > 180){
            x -= 6;
        }else{
            x -= 4;
        }

        if(y> 180){
            y += 5;
        }else{
            y += 3;
        }
        log.debug('KAQ Image > lat: ', lat, 'lon: ', lon);
        log.debug('KAQ Image > ', pixels.map_pixel_distance_width,  pixels.map_pixel_distance_height);
        log.debug('KAQ Image > x: ', x, 'y: ',y);

        var result = [];
        var colorTable = this.colorTable[type];
        for(var i=0 ; i < pixels.image_count ; i++){
            let err_rgb = [];
            for(var j = 0 ; j<64 ; j++){
                let w = 0;
                let h = 0;

                // TODO :  현재는 x, y좌표의 pixel이 invalid일 경우 해당 pixel을 중심으로 8*8 크기의 pixel들을 순차검색하게 되어 있는데 추후 달팽이배열처리 알고리즘으로 수정해야한다
                if(j !== 0){
                    // 정확한 x,y 좌표가 invalid한 색일 경우 좌표를 보정한다
                    w = parseInt(j/8) - 4;
                    h = parseInt(j%8) - 4;
                }

                var rgb = {
                    r: pixels.pixels.get(i, x+w, y+h, 0),
                    g: pixels.pixels.get(i, x+w, y+h, 1),
                    b: pixels.pixels.get(i, x+w, y+h, 2)
                };
                let k=0;
                for(k=0 ; k<colorTable.length ; k++){
                    if(rgb.r === colorTable[k].r &&
                        rgb.g === colorTable[k].g &&
                        rgb.b === colorTable[k].b){
                        break;
                    }
                }
                if(k<colorTable.length){
                    //log.info('Airkorea Image > Found color value : ', i, j, colorTable[k].val, k);
                    result.push(colorTable[k].val);
                    break;
                }else {
                    err_rgb.push(rgb);
                }
            }
            if(j === 64){
                // 보정된 좌표 64개 모두 invalid한 색이 나올 경우 error 처리 한다
                log.warn('KAQ Image > Fail to find color value : ', i, type);
                log.warn('KAQ Image > Need to Add it to table : ', JSON.stringify(err_rgb));
                result.push(-1);
            }
        }

        //log.info('KAQ Image > result = ', JSON.stringify(result));

        var pubDateStr = kmaTimeLib.convertYYYY_MM_DD_HHStr2YYYY_MM_DD_HHoZZ(this.imagePixels[type].pubDate);
        var pubDate = new Date(pubDateStr);
        var forecastDate = kmaTimeLib.toTimeZone(9);
        //17시, 23시 데이터는 다음날 부터 시작하고, 그 다음날 5시까지 사용되어야 하므로, 현재 시간도 함께 비교
        if (pubDate.getHours() >= 17 && pubDate.getDate() === forecastDate.getDate()) {
            forecastDate.setDate(forecastDate.getDate()+1);
        }

        var forecast = [];
        for(i=0 ; i<137 ; i++){
            var item = {};
            if(i != 0 && (i% 24) === 0){
                forecastDate.setDate(forecastDate.getDate()+1);
            }
            forecastDate.setHours(i%24);
            forecastDate.setMinutes(0);
            item.date = kmaTimeLib.convertDateToYYYY_MM_DD_HHoMM(forecastDate);
            if (result[i] !== -1) {
                item.val = result[i];
                item.grade = AqiConverter.value2grade(aqiUnit, type.toLowerCase(), result[i]);
            }

            forecast.push(item);
        }

        log.debug('KAQ Image > result = ', JSON.stringify(forecast));

        if(callback){
            callback(null, {pubDate: this.imagePixels[type].pubDate, hourly: forecast});
        }

        return result;
    }

    /**
     *
     * @param type
     * @param callback
     * @returns {*}
     */
    getImaggPath(type, callback){

        // TODO : This is only for Testing, Need to implement!!!!!!
        if(type === 'PM10'){
            return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: './test/testImageParser/PM10_Animation.gif'});
        }else{
            return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: './test/testImageParser/PM2_5_Animation.gif'});
        }

    }

    /**
     *
     * @param type
     * @param pixels
     * @param callback
     */
    makeColorTable(type, pixels, callback){
        let x = 280;
        let value = this.value[type];

        this.colorTable[type] = [];
        for(var i=0 ; i < pixels.image_count ; i++){
            this.value_pos[type].forEach((y, j)=>{
                var rgb = {
                    r: pixels.pixels.get(i, x, y, 0),
                    g: pixels.pixels.get(i, x, y, 1),
                    b: pixels.pixels.get(i, x, y, 2),
                    val: value[j]
                };

                let found = this.colorTable[type].find((item)=>{
                    if(item.r == rgb.r && item.g == rgb.g && item.b == rgb.b){
                        //log.info(JSON.stringify(item));
                        //log.info(JSON.stringify(rgb));
                        return true;
                    }
                    return false;
                });

                if(found === undefined){
                    this.colorTable[type].push(rgb);
                    //log.info('Added color item ', i, j, x, y, '->', rgb);
                }
            });
            if(i ==0){
                log.info('=====> : ', JSON.stringify(this.colorTable.PM10));
            }
        }

        log.info('KAQ Image> Color Table count : ', this.colorTable[type].length);
        //log.info('KAQ Image> Color Table : ', JSON.stringify(this.colorTable[type]));


        if(callback){
            callback();
        }
    }

    /**
     *
     * @param callback
     */
    taskDustImageMgr(callback){
        log.info('KAQ Image > taskDustImageMgr -----------');
        async.waterfall(
            [
                (cb)=>{
                    this.getImaggPath('PM10', (err, pm10Path)=>{
                        if(err === '_no_image_url_') {
                            log.warn('KAQ Image > There is no image url');
                            return cb(err);
                        }
                        if(err){
                            log.error('KAQ Image > Failed to get PM10 image : ', err);
                            return cb(err);
                        }
                        log.info('KAQ Image > PM10 Path : ', pm10Path.path);
                        this.imagePixels.PM10 = undefined;
                        return cb(undefined, pm10Path);
                    });
                },
                (pm10Path, cb)=>{
                    this.parseMapImage(pm10Path.path, 'image/gif', (err, pixelMap)=>{
                        if(err){
                            return cb(err);
                        }

                        log.info('KAQ Image > Got pixel info for PM10');
                        this.imagePixels.PM10 = {};
                        this.imagePixels.PM10.pubDate = pm10Path.pubDate;
                        this.imagePixels.PM10.data = pixelMap;
                        return cb(null, pixelMap);
                    });
                },
                (pixelMap, cb)=>{
                    this.makeColorTable('PM10', pixelMap, (err)=>{
                        if(err){
                            log.error('KAQ Image > Failed to get Grade Table');
                            return cb(err);
                        }

                        return cb();
                    });
                },
                (cb)=>{
                    this.getImaggPath('PM25', (err, pm25Path)=>{
                        if(err === '_no_image_url_') {
                            log.warn('KAQ Image > There is no image url');
                            return cb(err);
                        }
                        if(err){
                            log.error('KAQ Image > Failed to get PM25 image');
                            return cb(err);
                        }
                        log.info('KAQ Image > PM25 Path : ', pm25Path.path);
                        this.imagePixels.PM25 = undefined;
                        return cb(undefined, pm25Path);
                    });
                },
                (pm25Path, cb)=>{
                    this.parseMapImage(pm25Path.path, 'image/gif', (err, pixelMap)=>{
                        if(err){
                            return cb(err);
                        }
                        log.info('KAQ Image > Got pixel info for PM25');
                        this.imagePixels.PM25 = {};
                        this.imagePixels.PM25.pubDate = pm25Path.pubDate;
                        this.imagePixels.PM25.data = pixelMap;
                        return cb(null, pixelMap);
                    });
                },
                (pixelMap, cb)=>{
                    this.makeColorTable('PM25', pixelMap, (err)=>{
                        if(err){
                            log.error('KAQ Image > Failed to get PM25 Grade Table');
                            return cb(err);
                        }

                        return cb();
                    });
                }
            ],
            (err)=>{
                if(err){
                    log.error('KAQ Image > fail to load image : ', err);
                }

                if(callback){
                    callback(err, this.imagePixels);
                }
            }
        );
    }

    /**
     *
     * @param callback
     */
    startDustImageMgr(callback){
        this.taskDustImageMgr(callback);
        this.task = setInterval(()=>{
            this.taskDustImageMgr(undefined);
        }, 60 * 60 * 1000);
    };

    /**
     *
     */
    stopDustImageMgr(){
        if(this.task){
            clearInterval(this.task);
            this.task = undefined;
        }
    };

    /**
     *
     * @param imgPaths
     * @param callback
     */
    getDustImage(imgPaths, callback) {
        log.info('KAQ Image > get dust image -----------');
        async.waterfall(
            [
                (cb)=>{
                    if (imgPaths.pm10 == undefined) {
                        log.error('KAQ PM10 Image > image path is undefined');
                        return cb(null);
                    }
                    log.info("KAQ Image > pm10 path: "+imgPaths.pm10);
                    this.parseMapImage(imgPaths.pm10, 'image/gif', (err, pixelMap)=>{
                        if(err){
                            return cb(err);
                        }

                        log.info('KAQ Image > Got pixel info for PM10');
                        this.imagePixels.PM10 = {};
                        this.imagePixels.PM10.pubDate = imgPaths.pubDate;
                        this.imagePixels.PM10.data = pixelMap;
                        return cb(null, pixelMap);
                    });
                },
                (pixelMap, cb)=>{
                    if (pixelMap  == undefined) {
                        log.error('KAQ PM10 Image > pixelMap is undefined');
                        return cb(null);
                    }
                    this.makeColorTable('PM10', pixelMap, (err)=>{
                        if(err){
                            log.error('KAQ PM10 Image > Failed to get Grade Table');
                            return cb(err);
                        }

                        return cb(null);
                    });
                },
                (cb)=>{
                    if (imgPaths.pm25 == undefined) {
                        log.error('KAQ PM25 Image > image path is undefined');
                        return cb(null);
                    }
                    log.info("KAQ Image > pm25 path: "+imgPaths.pm25);
                    this.parseMapImage(imgPaths.pm25, 'image/gif', (err, pixelMap)=>{
                        if(err){
                            return cb(err);
                        }
                        log.info('KAQ Image > Got pixel info for PM25');
                        this.imagePixels.PM25 = {};
                        this.imagePixels.PM25.pubDate = imgPaths.pubDate;
                        this.imagePixels.PM25.data = pixelMap;
                        return cb(null, pixelMap);
                    });
                },
                (pixelMap, cb)=>{
                    if (pixelMap  == undefined) {
                        log.error('KAQ PM25 Image > pixelMap is undefined');
                        return cb(null);
                    }
                    this.makeColorTable('PM25', pixelMap, (err)=>{
                        if(err){
                            log.error('KAQ Image > Failed to get PM25 Grade Table');
                            return cb(err);
                        }

                        return cb(null);
                    });
                }
            ],
            (err)=>{
                if(err){
                    log.error('KAQ Image > fail to load image');
                }

                if(callback){
                    callback(err, this.imagePixels);
                }
            }
        );
    };
}

module.exports = KaqDustImageController;